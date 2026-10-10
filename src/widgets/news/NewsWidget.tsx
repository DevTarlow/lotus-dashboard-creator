import { useMemo, useState } from 'react';
import { ChevronDownIcon, NewsIcon, RefreshIcon } from '@/components/icons';
import { Badge } from '@/components/ui';
import { useNow, useTimeBucket } from '@/hooks/useNow';
import { getNewsFeed, NEWS_BUCKET_MS, NEWS_TOPICS, topicLabel, type NewsTopic } from '@/lib/mock/news';
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

/** Simulated RSS-style feed with expandable summaries. */
export function NewsWidget({ config, updateConfig }: WidgetProps<NewsConfig>) {
  const bucket = useTimeBucket(NEWS_BUCKET_MS);
  const [refreshKey, setRefreshKey] = useState(0);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const now = useNow(60000);

  const articles = useMemo(
    () =>
      getNewsFeed({
        topic: config.topic,
        limit: config.limit,
        now: bucket * NEWS_BUCKET_MS,
        seedOffset: refreshKey,
      }),
    [config.topic, config.limit, bucket, refreshKey],
  );

  return (
    <div className="flex h-full flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        {config.showTopicBar ? (
          <div className="flex min-w-0 flex-1 gap-1 overflow-x-auto pb-0.5">
            {TOPIC_FILTERS.map((topic) => {
              const active = config.topic === topic;
              return (
                <button
                  key={topic}
                  type="button"
                  onClick={() => updateConfig({ topic })}
                  aria-pressed={active}
                  className={cn(
                    'shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold transition',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/60',
                    active
                      ? 'bg-violet-600 text-white dark:bg-violet-500'
                      : 'bg-slate-100 text-slate-500 hover:bg-slate-200 hover:text-slate-700 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-slate-200',
                  )}
                >
                  {topicLabel(topic)}
                </button>
              );
            })}
          </div>
        ) : (
          <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">{topicLabel(config.topic)}</span>
        )}
        <button
          type="button"
          onClick={() => setRefreshKey((key) => key + 1)}
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
          return (
            <li key={article.id}>
              <button
                type="button"
                onClick={() => setExpandedId(expanded ? null : article.id)}
                aria-expanded={expanded}
                className="group/item flex w-full items-start gap-2 py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/50"
              >
                <span className="min-w-0 flex-1">
                  <span className="line-clamp-2 text-[13px] font-medium leading-snug text-slate-700 transition group-hover/item:text-violet-700 dark:text-slate-200 dark:group-hover/item:text-violet-300">
                    {article.title}
                  </span>
                  <span className="mt-0.5 flex items-center gap-1.5 text-[10px] text-slate-400 dark:text-slate-500">
                    <span className="font-semibold uppercase tracking-wide">{article.source}</span>
                    <span aria-hidden="true">·</span>
                    <span>{formatRelativeTime(article.publishedAt, now.getTime())}</span>
                    <span aria-hidden="true">·</span>
                    <span>{article.readingMinutes} min read</span>
                  </span>
                  {config.showSummary && expanded ? (
                    <span className="mt-1.5 block text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                      {article.summary}
                    </span>
                  ) : null}
                </span>
                {config.showSummary ? (
                  <ChevronDownIcon
                    className={cn(
                      'mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-300 transition-transform dark:text-slate-600',
                      expanded && 'rotate-180',
                    )}
                  />
                ) : null}
              </button>
            </li>
          );
        })}
      </ul>

      <div className="flex items-center justify-between">
        <Badge tone="slate" icon={<NewsIcon className="h-3 w-3" />}>
          Simulated feed
        </Badge>
        <span className="text-[10px] text-slate-400 dark:text-slate-500">{articles.length} headlines</span>
      </div>
    </div>
  );
}

export const newsWidget = defineWidget<NewsConfig>({
  type: 'news',
  name: 'News feed',
  summary: 'A rotating, simulated headline feed with topic filters.',
  category: 'news',
  keywords: ['rss', 'news', 'headlines', 'feed', 'reader'],
  icon: NewsIcon,
  accent: 'rose',
  defaultSize: { w: 6, h: 7, minW: 3, minH: 5 },
  defaultConfig: DEFAULT_NEWS_CONFIG,
  settings: SETTINGS,
  summarize: (config) => `${topicLabel(config.topic)} · ${config.limit} items`,
  component: NewsWidget,
});
