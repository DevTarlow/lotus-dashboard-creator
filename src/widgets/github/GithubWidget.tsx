import { useMemo } from 'react';
import { ExternalLinkIcon, RepoIcon } from '@/components/icons';
import { Badge, Button, EmptyState, SourceBadge, StatTile } from '@/components/ui';
import { useNow } from '@/hooks/useNow';
import { useResource } from '@/hooks/useResource';
import { formatRelativeTime } from '@/lib/utils';
import {
  conclusionTone,
  fetchRepoSnapshot,
  GITHUB_REFRESH_MS,
  normalizeRepoSlug,
  type GithubSnapshot,
} from '@/lib/github';
import { usePrefsStore } from '@/store/prefsStore';
import type { SettingField, WidgetProps } from '@/types';
import { defineWidget } from '@/widgets/define';

export type GithubConfig = {
  /** `owner/name`; a pasted URL is accepted too. */
  repo: string;
  showReleases: boolean;
  showWorkflow: boolean;
};

const DEFAULT_GITHUB_CONFIG: GithubConfig = {
  repo: 'react/react',
  showReleases: true,
  showWorkflow: true,
};

const SETTINGS: readonly SettingField[] = [
  {
    key: 'repo',
    label: 'Repository',
    type: 'text',
    placeholder: 'owner/name',
    maxLength: 120,
    help: 'A public repository needs no key. The name is read from api.github.com, 60 times an hour per address.',
  },
  { key: 'showReleases', label: 'Show the latest release', type: 'switch' },
  { key: 'showWorkflow', label: 'Show the latest workflow run', type: 'switch' },
  {
    key: 'githubToken',
    label: 'GitHub token',
    type: 'password',
    placeholder: 'ghp_…',
    help: 'Optional. Raises the hourly limit to 5,000 and reaches private repositories. Kept in this browser and sent only to GitHub.',
    link: { href: 'https://github.com/settings/tokens', label: 'Create a token' },
  },
];

const NUMBER = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 });

function LinkRow({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      className="inline-flex min-w-0 items-center gap-1 text-violet-600 underline-offset-2 hover:underline dark:text-violet-300"
    >
      <span className="truncate">{children}</span>
      <ExternalLinkIcon className="h-3 w-3 shrink-0" />
    </a>
  );
}

/** Live statistics for one GitHub repository. */
export function GithubWidget({ config }: WidgetProps<GithubConfig>) {
  const token = usePrefsStore((state) => state.githubToken);
  const now = useNow(60_000);
  const slug = useMemo(() => normalizeRepoSlug(config.repo), [config.repo]);
  const anonymous = token.trim() === '';

  const { data, error, errorStatus, pending, fromCache, refresh } = useResource<GithubSnapshot>({
    key: `github:${slug}:${anonymous ? 'anon' : 'auth'}:${config.showReleases ? 'r' : '-'}${config.showWorkflow ? 'w' : '-'}`,
    refreshMs: GITHUB_REFRESH_MS,
    enabled: slug !== '',
    load: async (signal) => {
      const snapshot = await fetchRepoSnapshot(slug, {
        token,
        showRelease: config.showReleases,
        showWorkflow: config.showWorkflow,
        signal,
      });
      return { data: snapshot, fromCache: snapshot.fromCache };
    },
  });

  if (slug === '') {
    return (
      <EmptyState
        size="sm"
        icon={<RepoIcon className="h-4 w-4" />}
        title="Which repository?"
        description={`Enter a repository as “owner/name” in the settings — “${config.repo || 'react/react'}” is not one.`}
      />
    );
  }

  if (error && !data) {
    const limit = errorStatus === 403;
    return (
      <EmptyState
        size="sm"
        icon={<RepoIcon className="h-4 w-4" />}
        title={limit ? 'GitHub’s hourly limit is used up' : 'Could not read the repository'}
        description={
          limit
            ? 'Anonymous requests are capped at 60 an hour. Add your own token in the settings to raise the limit.'
            : error
        }
        action={
          <Button size="sm" variant="secondary" onClick={refresh}>
            Try again
          </Button>
        }
      />
    );
  }

  if (pending || !data) {
    return (
      <EmptyState
        size="sm"
        icon={<RepoIcon className="h-4 w-4" />}
        title="Reading GitHub…"
        description={slug}
      />
    );
  }

  const { repo, release, run, rateLimitRemaining } = data;
  const pushed = repo.pushedAt === null ? null : Date.parse(repo.pushedAt);
  const lowQuota = anonymous && rateLimitRemaining !== null && rateLimitRemaining <= 10;

  return (
    <div className="@container flex h-full flex-col gap-2.5 text-slate-700 dark:text-slate-200">
      <div className="min-w-0">
        <div className="flex items-center gap-1.5">
          <LinkRow href={repo.url}>{repo.fullName}</LinkRow>
          {repo.archived ? <Badge tone="amber">Archived</Badge> : null}
          {repo.isFork ? <Badge tone="slate">Fork</Badge> : null}
        </div>
        {repo.description !== '' ? (
          <p className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-slate-500 dark:text-slate-400">
            {repo.description}
          </p>
        ) : null}
      </div>

      <div className="grid grid-cols-3 gap-1.5">
        <StatTile label="Stars" value={NUMBER.format(repo.stars)} tone="amber" />
        <StatTile label="Forks" value={NUMBER.format(repo.forks)} tone="sky" />
        <StatTile label="Issues" value={NUMBER.format(repo.openIssues)} tone="rose" />
      </div>

      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
        <div className="flex justify-between gap-2 border-b border-slate-100 py-0.5 dark:border-slate-800">
          <dt className="text-slate-400 dark:text-slate-500">Language</dt>
          <dd className="truncate font-medium">{repo.language ?? '—'}</dd>
        </div>
        <div className="flex justify-between gap-2 border-b border-slate-100 py-0.5 dark:border-slate-800">
          <dt className="text-slate-400 dark:text-slate-500">Licence</dt>
          <dd className="truncate font-medium">{repo.license ?? '—'}</dd>
        </div>
        <div className="flex justify-between gap-2 border-b border-slate-100 py-0.5 dark:border-slate-800">
          <dt className="text-slate-400 dark:text-slate-500">Branch</dt>
          <dd className="truncate font-medium">{repo.defaultBranch}</dd>
        </div>
        <div className="flex justify-between gap-2 border-b border-slate-100 py-0.5 dark:border-slate-800">
          <dt className="text-slate-400 dark:text-slate-500">Pushed</dt>
          <dd className="truncate font-medium">{pushed === null ? '—' : formatRelativeTime(pushed, now.getTime())}</dd>
        </div>
      </dl>

      {config.showReleases ? (
        release ? (
          <div className="flex min-w-0 items-center gap-2 text-[11px]">
            <Badge tone="emerald">{release.tag}</Badge>
            <LinkRow href={release.url}>{release.name}</LinkRow>
            {release.publishedAt ? (
              <span className="ml-auto shrink-0 text-slate-400 dark:text-slate-500">
                {formatRelativeTime(Date.parse(release.publishedAt), now.getTime())}
              </span>
            ) : null}
          </div>
        ) : (
          <p className="text-[11px] text-slate-400 dark:text-slate-500">No published releases.</p>
        )
      ) : null}

      {config.showWorkflow ? (
        run ? (
          <div className="flex min-w-0 items-center gap-2 text-[11px]">
            <Badge tone={conclusionTone(run.conclusion, run.status)}>
              {run.status !== null && run.status !== 'completed' ? run.status.replace(/_/g, ' ') : (run.conclusion ?? 'unknown')}
            </Badge>
            <LinkRow href={run.url}>{run.name}</LinkRow>
            {run.branch ? <span className="truncate text-slate-400 dark:text-slate-500">{run.branch}</span> : null}
          </div>
        ) : (
          <p className="text-[11px] text-slate-400 dark:text-slate-500">No workflow runs (or Actions is not used).</p>
        )
      ) : null}

      <div className="mt-auto flex flex-wrap items-center gap-2 pt-1">
        <SourceBadge input={{ pending, error, errorCode: error ? 'http' : null, status: errorStatus, fromCache }} />
        {rateLimitRemaining !== null ? (
          <span className="text-[10px] text-slate-400 dark:text-slate-500">
            {rateLimitRemaining} GitHub requests left this hour
          </span>
        ) : null}
        {lowQuota ? (
          <span className="text-[10px] text-amber-600 dark:text-amber-400">
            Add a token in settings for a higher limit
          </span>
        ) : null}
      </div>
    </div>
  );
}

export const githubWidget = defineWidget<GithubConfig>({
  type: 'github',
  name: 'Repository',
  summary: 'Stars, issues, the latest release and the newest workflow run.',
  category: 'utilities',
  keywords: ['github', 'repo', 'stars', 'issues', 'release', 'ci', 'workflow', 'developer'],
  icon: RepoIcon,
  accent: 'slate',
  badge: 'Live',
  defaultSize: { w: 4, h: 6, minW: 3, minH: 4 },
  defaultConfig: DEFAULT_GITHUB_CONFIG,
  settings: SETTINGS,
  summarize: (config) => {
    const slug = normalizeRepoSlug(config.repo);
    return slug === '' ? 'Enter a repository' : slug;
  },
  component: GithubWidget,
});
