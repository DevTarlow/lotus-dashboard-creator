/**
 * The GitHub provider for the repository widget.
 *
 * `api.github.com` is keyless and sends `access-control-allow-origin: *`, so a
 * public repository can be watched without a signup — but an anonymous caller is
 * allowed **60 requests per hour per address**, which a dashboard with a couple
 * of repository panels can genuinely exhaust. The widget therefore reports the
 * remaining quota (the API sends `x-ratelimit-remaining` on every response) and
 * offers an optional personal access token, which raises the limit to 5,000 and
 * is the only reason a token is supported at all.
 *
 * Two rules the mapping code keeps:
 * - a repository without releases (or without Actions runs) is not an error:
 *   `404` on those sub-resources becomes `null`, and the widget simply does not
 *   show that section;
 * - a payload that does not look like a repository is a parse error, never a
 *   half-filled card.
 */
import { HttpError, requestJson } from '@/lib/http';
import type { AccentTone } from '@/types';

/** One refresh per repository per window; the API calls are heavyweight. */
export const GITHUB_REFRESH_MS = 15 * 60 * 1000;

const GITHUB_API = 'https://api.github.com';

const HEADERS = {
  Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28',
};

export interface RepoStats {
  fullName: string;
  description: string;
  url: string;
  stars: number;
  forks: number;
  openIssues: number;
  language: string | null;
  license: string | null;
  defaultBranch: string;
  /** ISO timestamp of the last push, or null when the API omitted it. */
  pushedAt: string | null;
  archived: boolean;
  isFork: boolean;
}

export interface ReleaseInfo {
  tag: string;
  name: string;
  url: string;
  publishedAt: string | null;
  prerelease: boolean;
}

export interface WorkflowRun {
  name: string;
  branch: string | null;
  status: string | null;
  conclusion: string | null;
  url: string;
  updatedAt: string | null;
}

export interface GithubSnapshot {
  repo: RepoStats;
  release: ReleaseInfo | null;
  run: WorkflowRun | null;
  /** Requests left in the current hour window, when the API reported it. */
  rateLimitRemaining: number | null;
  /** `true` when the repository payload came from the session cache. */
  fromCache: boolean;
}

/**
 * `true` for a well-formed `owner/name` slug.
 *
 * GitHub logins and repository names are restricted to alphanumerics, `-`, `_`
 * and `.`, which rules out the injection of a path or query into the request URL.
 */
export function isValidRepoSlug(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9._-]{1,100}$/.test(value.trim());
}

/** Normalise whatever the user pasted into a bare `owner/name`, or `''`. */
export function normalizeRepoSlug(value: unknown): string {
  if (typeof value !== 'string') return '';
  let slug = value.trim();
  // A pasted URL is the common case; accept it rather than making the user edit it.
  slug = slug.replace(/^https?:\/\/(?:www\.)?github\.com\//i, '');
  // …and so is a bare host without a scheme.
  slug = slug.replace(/^(?:www\.)?github\.com\//i, '');
  slug = slug.replace(/\.git$/i, '');
  slug = slug.replace(/[?#].*$/, '');
  slug = slug.replace(/^\/+|\/+$/g, '');
  const parts = slug.split('/').filter((part) => part !== '');
  if (parts.length < 2) return '';
  const candidate = `${parts[0]}/${parts[1]}`;
  return isValidRepoSlug(candidate) ? candidate : '';
}

function asCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** Map the `/repos/{owner}/{name}` payload, or `null` when it is not one. */
export function mapRepo(payload: unknown): RepoStats | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const record = payload as Record<string, unknown>;
  const fullName = asText(record.full_name);
  if (fullName === '') return null;
  const license = record.license as { spdx_id?: unknown; name?: unknown } | null | undefined;

  return {
    fullName,
    description: asText(record.description),
    url: asText(record.html_url) || `https://github.com/${fullName}`,
    stars: asCount(record.stargazers_count),
    forks: asCount(record.forks_count),
    openIssues: asCount(record.open_issues_count),
    language: typeof record.language === 'string' ? record.language : null,
    license: typeof license?.spdx_id === 'string' && license.spdx_id !== 'NOASSERTION'
      ? license.spdx_id
      : typeof license?.name === 'string'
        ? license.name
        : null,
    defaultBranch: asText(record.default_branch) || 'main',
    pushedAt: typeof record.pushed_at === 'string' ? record.pushed_at : null,
    archived: record.archived === true,
    isFork: record.fork === true,
  };
}

/** Map `/releases/latest`. A repository with no releases answers `404`. */
export function mapRelease(payload: unknown): ReleaseInfo | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const record = payload as Record<string, unknown>;
  const tag = asText(record.tag_name);
  if (tag === '') return null;
  return {
    tag,
    name: asText(record.name) || tag,
    url: asText(record.html_url) || '',
    publishedAt: typeof record.published_at === 'string' ? record.published_at : null,
    prerelease: record.prerelease === true,
  };
}

/** Map the newest entry of `/actions/runs`. */
export function mapWorkflowRun(payload: unknown): WorkflowRun | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const runs = (payload as { workflow_runs?: unknown }).workflow_runs;
  if (!Array.isArray(runs) || runs.length === 0) return null;
  const run = runs[0] as Record<string, unknown>;
  return {
    name: asText(run.name) || asText(run.display_title) || 'Workflow',
    branch: typeof run.head_branch === 'string' ? run.head_branch : null,
    status: typeof run.status === 'string' ? run.status : null,
    conclusion: typeof run.conclusion === 'string' ? run.conclusion : null,
    url: asText(run.html_url) || '',
    updatedAt: typeof run.updated_at === 'string' ? run.updated_at : null,
  };
}

/** Accent tone for a run conclusion, so the badge reads at a glance. */
export function conclusionTone(conclusion: string | null, status: string | null): AccentTone {
  if (status !== null && status !== 'completed') return 'amber';
  switch (conclusion) {
    case 'success':
      return 'emerald';
    case 'failure':
    case 'timed_out':
    case 'startup_failure':
      return 'rose';
    case 'cancelled':
    case 'skipped':
    case 'neutral':
      return 'slate';
    default:
      return 'sky';
  }
}

async function fetchOptional<T>(
  key: string,
  url: string,
  token: string,
  map: (payload: unknown) => T | null,
  signal: AbortSignal,
): Promise<T | null> {
  try {
    const response = await requestJson<unknown>(key, url, {
      ttlMs: GITHUB_REFRESH_MS,
      signal,
      headers: withAuth(token),
    });
    return map(response.data);
  } catch (error) {
    // A repository without releases or without Actions is normal, not a failure.
    if (error instanceof HttpError && error.status === 404) return null;
    throw error;
  }
}

function withAuth(token: string): Record<string, string> {
  const trimmed = token.trim();
  return trimmed === '' ? HEADERS : { ...HEADERS, Authorization: `Bearer ${trimmed}` };
}

/**
 * Everything the widget shows, in as few requests as the settings allow.
 *
 * Cached per authentication state: an authenticated call can see a private
 * repository whose payload differs from the anonymous one.
 */
export async function fetchRepoSnapshot(
  slug: string,
  options: { token: string; showRelease: boolean; showWorkflow: boolean; signal: AbortSignal },
): Promise<GithubSnapshot> {
  const { token, showRelease, showWorkflow, signal } = options;
  const authScope = token.trim() === '' ? 'anon' : 'auth';
  const repoKey = `github:repo:${slug}:${authScope}`;

  const response = await requestJson<unknown>(repoKey, `${GITHUB_API}/repos/${slug}`, {
    ttlMs: GITHUB_REFRESH_MS,
    signal,
    headers: withAuth(token),
  });

  const repo = mapRepo(response.data);
  if (!repo) throw new HttpError('GitHub sent a payload that did not look like a repository.', 'parse');

  const [release, run] = await Promise.all([
    showRelease
      ? fetchOptional(
          `github:release:${slug}:${authScope}`,
          `${GITHUB_API}/repos/${slug}/releases/latest`,
          token,
          mapRelease,
          signal,
        )
      : Promise.resolve(null),
    showWorkflow
      ? fetchOptional(
          `github:runs:${slug}:${authScope}`,
          `${GITHUB_API}/repos/${slug}/actions/runs?per_page=1&exclude_pull_requests=true`,
          token,
          mapWorkflowRun,
          signal,
        )
      : Promise.resolve(null),
  ]);

  return { repo, release, run, rateLimitRemaining: response.rateLimitRemaining, fromCache: response.fromCache };
}
