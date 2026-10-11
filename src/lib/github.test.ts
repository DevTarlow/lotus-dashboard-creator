import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HttpError, resetHttp } from '@/lib/http';
import {
  conclusionTone,
  fetchRepoSnapshot,
  isValidRepoSlug,
  mapRelease,
  mapRepo,
  mapWorkflowRun,
  normalizeRepoSlug,
} from '@/lib/github';

/** A trimmed but faithful `/repos` payload. */
const REPO_PAYLOAD = {
  full_name: 'react/react',
  description: 'The library for web and native user interfaces.',
  html_url: 'https://github.com/react/react',
  stargazers_count: 241_500,
  forks_count: 49_800,
  open_issues_count: 812,
  language: 'JavaScript',
  license: { spdx_id: 'MIT', name: 'MIT License' },
  default_branch: 'main',
  pushed_at: '2026-02-01T09:12:00Z',
  archived: false,
  fork: false,
};

const RELEASE_PAYLOAD = {
  tag_name: 'v19.3.0',
  name: 'React 19.3',
  html_url: 'https://github.com/react/react/releases/tag/v19.3.0',
  published_at: '2026-01-28T12:00:00Z',
  prerelease: false,
};

const RUNS_PAYLOAD = {
  workflow_runs: [
    {
      name: 'CI',
      head_branch: 'main',
      status: 'completed',
      conclusion: 'success',
      html_url: 'https://github.com/react/react/actions/runs/1',
      updated_at: '2026-02-01T09:20:00Z',
    },
  ],
};

function jsonResponse(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
  });
}

beforeEach(() => {
  resetHttp();
});

describe('repo slugs', () => {
  it('accepts well-formed owner/name pairs', () => {
    expect(isValidRepoSlug('react/react')).toBe(true);
    expect(isValidRepoSlug('some-user/some-repo.js')).toBe(true);
    expect(isValidRepoSlug('a/b')).toBe(true);
  });

  it('rejects anything that could smuggle a path or a query into the URL', () => {
    for (const value of ['react', 'react/', '/react', 'react/react/extra', 'react/react?x=1', 'react/../secrets', 'a b/c', 'react/react#main', '']) {
      expect(isValidRepoSlug(value), value).toBe(false);
    }
  });

  it('normalises a pasted URL, a trailing .git and whitespace', () => {
    expect(normalizeRepoSlug(' https://github.com/react/react ')).toBe('react/react');
    expect(normalizeRepoSlug('http://www.github.com/react/react.git')).toBe('react/react');
    expect(normalizeRepoSlug('github.com/react/react/')).toBe('react/react');
    expect(normalizeRepoSlug('react/react/tree/main/packages')).toBe('react/react');
    expect(normalizeRepoSlug('react/react#readme')).toBe('react/react');
  });

  it('returns an empty string rather than a broken slug', () => {
    expect(normalizeRepoSlug('react')).toBe('');
    expect(normalizeRepoSlug('   ')).toBe('');
    expect(normalizeRepoSlug(42)).toBe('');
    expect(normalizeRepoSlug(null)).toBe('');
  });
});

describe('mapping', () => {
  it('maps the repository payload', () => {
    const repo = mapRepo(REPO_PAYLOAD);
    expect(repo).toMatchObject({
      fullName: 'react/react',
      stars: 241_500,
      forks: 49_800,
      openIssues: 812,
      license: 'MIT',
      defaultBranch: 'main',
      archived: false,
    });
    expect(repo?.pushedAt).toBe('2026-02-01T09:12:00Z');
  });

  it('refuses a payload that is not a repository', () => {
    expect(mapRepo(null)).toBeNull();
    expect(mapRepo({ message: 'Not Found' })).toBeNull();
    expect(mapRepo('nope')).toBeNull();
  });

  it('tolerates missing optional fields', () => {
    const repo = mapRepo({ full_name: 'a/b' });
    expect(repo).toMatchObject({ stars: 0, forks: 0, openIssues: 0, language: null, license: null });
    expect(repo?.url).toBe('https://github.com/a/b');
    expect(repo?.defaultBranch).toBe('main');
  });

  it('falls back to the licence name when the API says NOASSERTION', () => {
    expect(mapRepo({ full_name: 'a/b', license: { spdx_id: 'NOASSERTION', name: 'Custom' } })?.license).toBe('Custom');
    expect(mapRepo({ full_name: 'a/b', license: { spdx_id: 'Apache-2.0' } })?.license).toBe('Apache-2.0');
  });

  it('maps a release, and rejects an empty one', () => {
    expect(mapRelease(RELEASE_PAYLOAD)).toMatchObject({ tag: 'v19.3.0', name: 'React 19.3', prerelease: false });
    expect(mapRelease({})).toBeNull();
    expect(mapRelease({ tag_name: '' })).toBeNull();
    expect(mapRelease(null)).toBeNull();
  });

  it('takes the newest workflow run, and handles an empty list', () => {
    expect(mapWorkflowRun(RUNS_PAYLOAD)).toMatchObject({ name: 'CI', branch: 'main', conclusion: 'success' });
    expect(mapWorkflowRun({ workflow_runs: [] })).toBeNull();
    expect(mapWorkflowRun({})).toBeNull();
  });

  it('tones a run by its conclusion', () => {
    expect(conclusionTone('success', 'completed')).toBe('emerald');
    expect(conclusionTone('failure', 'completed')).toBe('rose');
    expect(conclusionTone('timed_out', 'completed')).toBe('rose');
    expect(conclusionTone('cancelled', 'completed')).toBe('slate');
    expect(conclusionTone(null, 'in_progress')).toBe('amber');
    expect(conclusionTone('weird', 'completed')).toBe('sky');
  });
});

describe('fetchRepoSnapshot', () => {
  it('asks for everything in one pass and reports the rate limit', async () => {
    const mock = vi.fn().mockImplementation((url: string) => {
      if (url.endsWith('/releases/latest')) return Promise.resolve(jsonResponse(RELEASE_PAYLOAD));
      if (url.includes('/actions/runs')) return Promise.resolve(jsonResponse(RUNS_PAYLOAD));
      return Promise.resolve(jsonResponse(REPO_PAYLOAD, { headers: { 'x-ratelimit-remaining': '57' } }));
    });
    vi.stubGlobal('fetch', mock);

    const snapshot = await fetchRepoSnapshot('react/react', {
      token: '',
      showRelease: true,
      showWorkflow: true,
      signal: new AbortController().signal,
    });

    expect(snapshot.repo.fullName).toBe('react/react');
    expect(snapshot.release?.tag).toBe('v19.3.0');
    expect(snapshot.run?.conclusion).toBe('success');
    expect(snapshot.rateLimitRemaining).toBe(57);
    expect(snapshot.fromCache).toBe(false);
    expect(mock).toHaveBeenCalledTimes(3);
    // Anonymous by default: no Authorization header at all.
    for (const call of mock.mock.calls) {
      expect((call[1] as RequestInit).headers).not.toHaveProperty('Authorization');
    }
    vi.unstubAllGlobals();
  });

  it('sends the token as a bearer header when one is set', async () => {
    const mock = vi.fn().mockImplementation((url: string) =>
      Promise.resolve(jsonResponse(url.includes('/actions') || url.includes('/releases') ? RUNS_PAYLOAD : REPO_PAYLOAD)),
    );
    vi.stubGlobal('fetch', mock);

    await fetchRepoSnapshot('react/react', {
      token: 'ghp_example',
      showRelease: false,
      showWorkflow: true,
      signal: new AbortController().signal,
    });

    const headers = mock.mock.calls[0][1].headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer ghp_example');
    // The release half was switched off, so it is never requested.
    expect(mock.mock.calls.some((call) => String(call[0]).includes('/releases'))).toBe(false);
    vi.unstubAllGlobals();
  });

  it('treats a missing release or Actions run as absent, not as an error', async () => {
    const mock = vi.fn().mockImplementation((url: string) => {
      if (url.includes('/releases')) return Promise.resolve(jsonResponse({ message: 'Not Found' }, { status: 404 }));
      if (url.includes('/actions')) return Promise.resolve(jsonResponse({ message: 'Not Found' }, { status: 404 }));
      return Promise.resolve(jsonResponse(REPO_PAYLOAD));
    });
    vi.stubGlobal('fetch', mock);

    const snapshot = await fetchRepoSnapshot('new/repo', {
      token: '',
      showRelease: true,
      showWorkflow: true,
      signal: new AbortController().signal,
    });

    expect(snapshot.release).toBeNull();
    expect(snapshot.run).toBeNull();
    expect(snapshot.repo.fullName).toBe('react/react');
    vi.unstubAllGlobals();
  });

  it('surfaces a repository that cannot be read', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ message: 'Not Found' }, { status: 404 })));

    await expect(
      fetchRepoSnapshot('ghost/repo', {
        token: '',
        showRelease: false,
        showWorkflow: false,
        signal: new AbortController().signal,
      }),
    ).rejects.toBeInstanceOf(HttpError);

    vi.unstubAllGlobals();
  });

  it('refuses a payload that is not a repository', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ message: 'weird' })));

    await expect(
      fetchRepoSnapshot('a/b', {
        token: '',
        showRelease: false,
        showWorkflow: false,
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({ code: 'parse' });

    vi.unstubAllGlobals();
  });
});
