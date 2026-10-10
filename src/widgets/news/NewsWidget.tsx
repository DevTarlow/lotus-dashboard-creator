import { useId, useState } from 'react';
import { ChevronDownIcon, NewsIcon, RefreshIcon } from '@/components/icons';
import { Badge } from '@/components/ui';
import { useNews } from '@/hooks/useNews';
import { useNow } from '@/hooks/useNow';
import { isNewsTopic, NEWS_TOPICS, topicLabel, type NewsTopic } from '@/lib/mock/news';
import { cn, formatRelativeTime } from '@/lib/utils';
import type { SettingField, WidgetProps } from '@/types';
import { defineWidget } from '@/widgets/define';

export type NewsConfig = {
  topic: NewsTopic | 'all';
  limit: number;
  showSummary: boolean;
  showTopicBar: boolean;
};

const DEFAULT_NEWS_CONFIG: NewsConfig = {
  topic: 'all',
  limit: 6,
  showSummary: true,
  showTopicBar: true,
};

const SETTINGS: readonly SettingField[] = [
  {
    key: 'topic',
    label: 'Topic',
    type: 'select',
    options: [{ label: 'All topics', value: 'all' }, ...NEWS_TOPICS.map((topic) => ({ label: topic.label, value: topic.id }))],
  },
  { key: 'limit', label: 'Headlines', type: 'number', min: 3, max: 12, step: 1 },
  { key: 'showSummary', label: 'Expandable summaries', type: 'switch' },
  { key: 'showTopicBar', label: 'Show topic filter', type: 'switch' },
];

const TOPIC_FILTERS: readonly (NewsTopic | 'all')[] = ['all', ...NEWS_TOPICS.map((topic) => topic.id)];

/**
 * Live headlines from keyless providers, with a labelled simulated fallback.
 *
 * Live rows link out to the publisher. Summaries are only offered when the
 * source actually ships one, and read time is only shown when the provider
 * reports it — nothing in this panel is estimated.
 */
export function NewsWidget({ config, updateConfig }: WidgetProps<NewsConfig>) {
  const summaryId = useId();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const now = useNow(60000);
  // Configs can arrive from an older export whose topic no longer exists.
  const topic = isNewsTopic(config.topic) ? config.topic : 'all';
  const { articles, source, providers, failed, error, pending, refresh } = useNews(topic, config.limit);

  const live = source === 'live';
  const providerNames = providers.join(', ');
  const badgeTitle = live
    ? `Live from ${providerNames}${failed.length > 0 ? `. Unavailable: ${failed.join(', ')}` : ''}`
    : (error ?? 'No live news provider answered — showing the simulated feed.');

  return (
    <div className="flex h-full flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        {config.showTopicBar ? (
          <div className="flex min-w-0 flex-1 gap-1 overflow-x-auto pb-0.5">
            {TOPIC_FILTERS.map((entry) => {
              const active = topic === entry;
              return (
                <button
                  key={entry}
                  type="button"
                  onClick={() => updateConfig({ topic: entry })}
                  aria-pressed={active}
                  className={cn(
                    'shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold transition',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/60',
                    active
                      ? 'bg-violet-600 text-white dark:bg-violet-500'
                      : 'bg-slate-100 text-slate-500 hover:bg-slate-200 hover:text-slate-700 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-slate-200',
                  )}
                >
                  {topicLabel(entry)}
                </button>
              );
            })}
          </div>
        ) : (
          <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">{topicLabel(topic)}</span>
        )}
        <button
          type="button"
          onClick={refresh}
          aria-label="Refresh feed"
          title="Refresh feed"
          className="shrink-0 rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/60 dark:hover:bg-slate-800 dark:hover:text-slate-200"
        >
          <RefreshIcon className="h-3.5 w-3.5" />
        </button>
      </div>

      <ul className="min-h-0 flex-1 divide-y divide-slate-100 overflow-y-auto dark:divide-slate-800">
        {articles.map((article) => {
          const expanded = expandedId === article.id;
          const expandable = config.showSummary && article.summary !== undefined;
          const bodyId = `${summaryId}-${article.id}`;
          return (
            <li key={article.id} className="flex items-start gap-2 py-2">
              <div className="min-w-0 flex-1">
                {article.url === undefined ? (
                  <span className="line-clamp-2 block text-[13px] font-medium leading-snug text-slate-700 dark:text-slate-200">
                    {article.title}
                  </span>
                ) : (
                  <a
                    href={article.url}
                    target="_blank"
                    rel="noreferrer noopener"
                    title={article.title}
                    className="line-clamp-2 block text-[13px] font-medium leading-snug text-slate-700 transition hover:text-violet-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/50 dark:text-slate-200 dark:hover:text-violet-300"
                  >
                    {article.title}
                  </a>
                )}
                <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[10px] text-slate-400 dark:text-slate-500">
                  <span className="font-semibold uppercase tracking-wide">{article.source}</span>
                  <span aria-hidden="true">·</span>
                  <span>{formatRelativeTime(article.publishedAt, now.getTime())}</span>
                  {article.readingMinutes === undefined ? null : (
                    <>
                      <span aria-hidden="true">·</span>
                      <span>{article.readingMinutes} min read</span>
                    </>
                  )}
                </span>
                {expandable && expanded ? (
                  <span id={bodyId} className="mt-1.5 block text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                    {article.summary}
                  </span>
                ) : null}
              </div>
              {expandable ? (
                <button
                  type="button"
                  onClick={() => setExpandedId(expanded ? null : article.id)}
                  aria-expanded={expanded}
                  aria-controls={bodyId}
                  aria-label={expanded ? `Hide summary of ${article.title}` : `Show summary of ${article.title}`}
                  className="mt-0.5 shrink-0 rounded-md p-0.5 text-slate-300 transition hover:text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/60 dark:text-slate-600 dark:hover:text-slate-300"
                >
                  <ChevronDownIcon className={cn('h-3.5 w-3.5 transition-transform', expanded && 'rotate-180')} />
                </button>
              ) : null}
            </li>
          );
        })}
      </ul>

      <div className="flex items-center justify-between gap-2">
        <Badge
          tone={live ? 'emerald' : 'slate'}
          icon={<NewsIcon className="h-3 w-3" />}
          title={badgeTitle}
          className="max-w-[65%] overflow-hidden"
        >
          <span className="truncate">
            {live
              ? providers.length === 1
                ? `Live · ${providers[0]}`
                : `Live · ${providers.length} sources`
              : pending
                ? 'Loading…'
                : 'Simulated feed'}
          </span>
        </Badge>
        <span className="min-w-0 truncate text-[10px] text-slate-400 dark:text-slate-500">
          {live || !error ? `${articles.length} headlines` : error}
        </span>
      </div>
    </div>
  );
}

export const newsWidget = defineWidget<NewsConfig>({
  type: 'news',
  name: 'News feed',
  summary: 'Live headlines from keyless providers with topic filters, source links and expandable summaries.',
  category: 'news',
  keywords: ['rss', 'news', 'headlines', 'feed', 'reader'],
  icon: NewsIcon,
  accent: 'rose',
  badge: 'Live',
  defaultSize: { w: 6, h: 7, minW: 3, minH: 5 },
  defaultConfig: DEFAULT_NEWS_CONFIG,
  settings: SETTINGS,
  summarize: (config) => `${topicLabel(config.topic)} · ${config.limit} items`,
  component: NewsWidget,
});
