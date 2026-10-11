import { useMemo } from 'react';
import { ExternalLinkIcon, OnThisDayIcon, RefreshIcon } from '@/components/icons';
import { Badge, Button, EmptyState, SourceBadge } from '@/components/ui';
import { useNow } from '@/hooks/useNow';
import { useResource } from '@/hooks/useResource';
import { dayKey } from '@/lib/time';
import { cn } from '@/lib/utils';
import {
  ONTHISDAY_KINDS,
  ONTHISDAY_TTL_MS,
  agoLabel,
  fetchOnThisDay,
  type OnThisDayItem,
  type OnThisDayKind,
} from '@/lib/onthisday';
import type { SettingField, WidgetProps } from '@/types';
import { defineWidget } from '@/widgets/define';

export type OnThisDayConfig = {
  kind: OnThisDayKind;
  limit: number;
  showImages: boolean;
};

const DEFAULT_ONTHISDAY_CONFIG: OnThisDayConfig = {
  kind: 'selected',
  limit: 6,
  showImages: true,
};

const SETTINGS: readonly SettingField[] = [
  {
    key: 'kind',
    label: 'Desk',
    type: 'select',
    options: ONTHISDAY_KINDS.map((entry) => ({ label: entry.label, value: entry.id })),
    help: 'From the Wikimedia “on this day” feeds — no API key needed. Content is CC BY-SA.',
  },
  { key: 'limit', label: 'Items shown', type: 'number', min: 1, max: 12, step: 1 },
  { key: 'showImages', label: 'Show article thumbnails', type: 'switch' },
];

const HEADING = new Intl.DateTimeFormat(undefined, { month: 'long', day: 'numeric' });

function kindLabel(kind: OnThisDayKind): string {
  return ONTHISDAY_KINDS.find((entry) => entry.id === kind)?.label ?? kind;
}

/** One entry: year, sentence, and the article it came from. */
function Item({ item, now, showImages }: { item: OnThisDayItem; now: Date; showImages: boolean }) {
  const ago = agoLabel(item.year, now);
  const thumbnail = showImages ? item.page?.thumbnail : null;

  return (
    <li className="flex gap-2.5">
      {thumbnail ? (
        <img
          src={thumbnail}
          alt=""
          loading="lazy"
          className="hidden h-12 w-12 shrink-0 rounded-md object-cover @sm:block"
        />
      ) : null}
      <div className="min-w-0 flex-1">
        <p className="text-[11px] leading-snug text-slate-600 dark:text-slate-300">{item.text}</p>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[10px] text-slate-400 dark:text-slate-500">
          {item.year !== null ? <span className="font-semibold tabular-nums text-slate-500 dark:text-slate-400">{item.year}</span> : null}
          {ago ? <span>{ago}</span> : null}
          {item.page?.url ? (
            <a
              href={item.page.url}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex min-w-0 items-center gap-1 text-violet-600 hover:underline dark:text-violet-300"
            >
              <span className="max-w-[16ch] truncate">{item.page.label}</span>
              <ExternalLinkIcon className="h-2.5 w-2.5 shrink-0" />
            </a>
          ) : null}
        </p>
      </div>
    </li>
  );
}

/** A day's history from the Wikimedia feeds. */
export function OnThisDayWidget({ config }: WidgetProps<OnThisDayConfig>) {
  const now = useNow(60_000);
  const today = useMemo(() => dayKey(now), [now]);
  const limit = Math.max(1, Math.min(12, Math.round(config.limit) || 6));

  const { data, error, errorCode, errorStatus, pending, fromCache, refresh } = useResource<OnThisDayItem[]>({
    // The date is part of the key, so a dashboard left open overnight rolls to
    // the new day's feed instead of showing yesterday's.
    key: `onthisday:${config.kind}:${today}`,
    refreshMs: ONTHISDAY_TTL_MS,
    load: async (signal) => {
      const result = await fetchOnThisDay(config.kind, new Date(), signal);
      return { data: result.items, fromCache: result.fromCache };
    },
  });

  const items = data ?? [];

  return (
    <div className="@container flex h-full flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <h3 className="truncate text-[13px] font-semibold text-slate-800 dark:text-slate-100">
            {HEADING.format(now)}
          </h3>
          <p className="truncate text-[10px] text-slate-400 dark:text-slate-500">{kindLabel(config.kind)}</p>
        </div>
        <Badge tone="violet">Wikipedia</Badge>
      </div>

      {error && items.length === 0 ? (
        <EmptyState
          size="sm"
          icon={<OnThisDayIcon className="h-4 w-4" />}
          title={errorCode === 'network' ? 'Offline' : 'Could not read the day’s history'}
          description={error}
          action={
            <Button size="sm" variant="secondary" icon={<RefreshIcon className="h-3.5 w-3.5" />} onClick={refresh}>
              Try again
            </Button>
          }
        />
      ) : null}

      {pending && items.length === 0 ? (
        <EmptyState size="sm" icon={<OnThisDayIcon className="h-4 w-4" />} title="Reading Wikimedia…" description={kindLabel(config.kind)} />
      ) : null}

      {items.length > 0 ? (
        <ul className="min-h-0 flex-1 space-y-2.5 overflow-hidden">
          {items.slice(0, limit).map((item) => (
            <Item key={item.id} item={item} now={now} showImages={config.showImages} />
          ))}
        </ul>
      ) : null}

      {items.length > limit ? (
        <p className="text-[10px] text-slate-400 dark:text-slate-500">
          {items.length - limit} more from this day — raise “Items shown” in the settings.
        </p>
      ) : null}

      <div className={cn('mt-auto flex flex-wrap items-center gap-2 pt-1 text-[10px] text-slate-400 dark:text-slate-500')}>
        <SourceBadge input={{ pending, error, errorCode, status: errorStatus, fromCache }} />
        <a
          href="https://en.wikipedia.org/wiki/Wikipedia:On_this_day"
          target="_blank"
          rel="noreferrer noopener"
          className="hover:text-violet-600 hover:underline dark:hover:text-violet-300"
        >
          Wikipedia, CC BY-SA
        </a>
      </div>
    </div>
  );
}

export const onThisDayWidget = defineWidget<OnThisDayConfig>({
  type: 'onthisday',
  name: 'On this day',
  summary: 'What happened on today’s date, from Wikipedia.',
  category: 'news',
  keywords: ['history', 'wikipedia', 'anniversary', 'birthday', 'today', 'this day'],
  icon: OnThisDayIcon,
  accent: 'violet',
  badge: 'Live',
  defaultSize: { w: 6, h: 6, minW: 3, minH: 4 },
  defaultConfig: DEFAULT_ONTHISDAY_CONFIG,
  settings: SETTINGS,
  summarize: (config) => kindLabel(config.kind),
  component: OnThisDayWidget,
});
