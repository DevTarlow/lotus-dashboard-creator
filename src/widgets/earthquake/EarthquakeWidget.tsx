import { useMemo } from 'react';
import { ExternalLinkIcon, MapPinIcon, QuakeIcon, RefreshIcon } from '@/components/icons';
import { Badge, Button, EmptyState, SourceBadge, TONE_TEXT } from '@/components/ui';
import { useNow } from '@/hooks/useNow';
import { useResource } from '@/hooks/useResource';
import {
  QUAKE_FEEDS,
  QUAKE_REFRESH_MS,
  QUAKE_WINDOWS,
  fetchQuakes,
  magnitudeBand,
  resolveFeedWindow,
  sortQuakes,
  strongest,
  withDistance,
  withinRadius,
  type Quake,
  type QuakeFeed,
  type QuakeFeedResult,
  type QuakeWindow,
} from '@/lib/earthquake';
import { geocodeCity, placeLabel, type GeoPlace } from '@/lib/geocode';
import { formatDistance } from '@/lib/geo';
import { clamp, cn, formatRelativeTime } from '@/lib/utils';
import type { SettingField, WidgetProps } from '@/types';
import { defineWidget } from '@/widgets/define';

export type EarthquakeConfig = {
  /** Which USGS summary feed to read. */
  feed: QuakeFeed;
  /** How far back to look. */
  window: QuakeWindow;
  /** Keep only quakes near `city` instead of showing the worldwide feed. */
  nearOnly: boolean;
  /** Place resolved when `nearOnly` is on. */
  city: string;
  radiusKm: number;
  /** How many quakes to list. */
  limit: number;
};

const DEFAULT_EARTHQUAKE_CONFIG: EarthquakeConfig = {
  feed: '2.5',
  window: 'day',
  nearOnly: false,
  city: 'Lisbon',
  radiusKm: 500,
  limit: 8,
};

const SETTINGS: readonly SettingField[] = [
  {
    key: 'feed',
    label: 'Feed',
    type: 'select',
    options: QUAKE_FEEDS.map((entry) => ({ label: entry.label, value: entry.id })),
    help: 'Live from the USGS “latest earthquakes” feeds — no API key needed. Their “significant” digest is published for the past day and week only.',
  },
  {
    key: 'window',
    label: 'Time window',
    type: 'select',
    options: QUAKE_WINDOWS.map((entry) => ({ label: entry.label, value: entry.id })),
  },
  { key: 'limit', label: 'How many to list', type: 'number', min: 1, max: 20, step: 1 },
  {
    key: 'nearOnly',
    label: 'Only near a place',
    type: 'switch',
    help: 'Distances are great-circle, measured from the place below. Off means the worldwide feed.',
  },
  { key: 'city', label: 'Place', type: 'text', placeholder: 'Lisbon', maxLength: 48 },
  { key: 'radiusKm', label: 'Radius', type: 'number', min: 50, max: 5000, step: 50, unit: 'km' },
];

/** What one load produced: the worldwide feed, or a place plus what is near it. */
interface QuakeState {
  place: GeoPlace | null;
  nearOnly: boolean;
  feed: QuakeFeedResult | null;
  /** The feed the provider actually served, after the fallback. */
  served: { feed: QuakeFeed; window: QuakeWindow } | null;
}

const FEED_LABEL = (feed: QuakeFeed): string =>
  QUAKE_FEEDS.find((entry) => entry.id === feed)?.label ?? feed;

const WINDOW_LABEL = (window: QuakeWindow): string =>
  (QUAKE_WINDOWS.find((entry) => entry.id === window)?.label ?? window).toLowerCase();

/** Config is untrusted input: only accept an id the selects can produce. */
function asFeed(value: unknown): QuakeFeed {
  return QUAKE_FEEDS.some((entry) => entry.id === value) ? (value as QuakeFeed) : DEFAULT_EARTHQUAKE_CONFIG.feed;
}

function asWindow(value: unknown): QuakeWindow {
  return QUAKE_WINDOWS.some((entry) => entry.id === value)
    ? (value as QuakeWindow)
    : DEFAULT_EARTHQUAKE_CONFIG.window;
}

/** A quake the feed could not place is still a real quake, so it gets a dash. */
function depthLabel(depthKm: number | null): string {
  return depthKm === null ? 'depth —' : `depth ${Math.round(depthKm)} km`;
}

function feltLabel(quake: Quake): string | null {
  if (quake.tsunami) return 'tsunami flagged';
  if (quake.felt !== null && quake.felt > 0) {
    return `${quake.felt.toLocaleString('en-US')} felt report${quake.felt === 1 ? '' : 's'}`;
  }
  return null;
}

interface QuakeRowProps {
  quake: Quake;
  now: number;
}

/** One list row: magnitude chip, place, time ago and (near-mode only) distance. */
function QuakeRow({ quake, now }: QuakeRowProps) {
  const band = magnitudeBand(quake.magnitude);
  return (
    <li className="flex items-center gap-2 border-b border-slate-100 py-1 text-xs last:border-0 dark:border-slate-800">
      <span
        className={cn(
          'w-9 shrink-0 rounded-md py-0.5 text-center text-[11px] font-semibold tabular-nums',
          TONE_TEXT[band.tone],
          band.tone === 'slate' ? 'bg-slate-100 dark:bg-slate-800' : 'bg-slate-50 dark:bg-slate-800/60',
        )}
        title={band.label}
      >
        {quake.magnitude === null ? '—' : `M${quake.magnitude.toFixed(1)}`}
      </span>
      <span className="min-w-0 flex-1 truncate text-slate-600 dark:text-slate-300" title={quake.place}>
        {quake.place || 'Unknown location'}
      </span>
      {quake.distanceKm === undefined ? null : (
        <span className="shrink-0 text-[10px] tabular-nums text-slate-400 dark:text-slate-500">
          {formatDistance(quake.distanceKm)}
        </span>
      )}
      <span className="shrink-0 text-[10px] tabular-nums text-slate-400 dark:text-slate-500">
        {formatRelativeTime(quake.time, now)}
      </span>
      {quake.url === '' ? null : (
        <a
          href={quake.url}
          target="_blank"
          rel="noreferrer noopener"
          aria-label={`USGS event page for ${quake.place || 'this earthquake'}`}
          className="shrink-0 rounded p-0.5 text-slate-400 transition-colors hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300"
        >
          <ExternalLinkIcon className="h-3.5 w-3.5" />
        </a>
      )}
    </li>
  );
}

/** Recent earthquakes worldwide, and any near a place you care about. */
export function EarthquakeWidget({ config }: WidgetProps<EarthquakeConfig>) {
  const feedChoice = asFeed(config.feed);
  const windowChoice = asWindow(config.window);
  const nearOnly = config.nearOnly === true;
  const city = config.city.trim();
  const radiusKm = clamp(config.radiusKm, 50, 5000);
  const limit = Math.round(clamp(config.limit, 1, 20));
  // The relative labels are the only thing that ticks; a tick must never write
  // to config, so the clock below stays local state.
  const now = useNow(60_000).getTime();

  // Flags, not values: `useResource` compares the key by position, so the loader
  // stays stable while the settings change and the key carries the change.
  const { data, error, errorCode, errorStatus, pending, fromCache, refresh } = useResource<QuakeState>({
    key: `quakes:${feedChoice}:${windowChoice}:${nearOnly ? 1 : 0}:${nearOnly ? city.toLowerCase() : ''}`,
    refreshMs: QUAKE_REFRESH_MS,
    enabled: !nearOnly || city !== '',
    load: async (signal) => {
      if (!nearOnly) {
        const feed = await fetchQuakes(feedChoice, windowChoice, signal);
        return {
          data: { place: null, nearOnly: false, feed: feed.data, served: resolveFeedWindow(feedChoice, windowChoice) },
          fromCache: feed.fromCache,
        };
      }
      const place = await geocodeCity(city, signal);
      // An unmatched place is not an empty feed: say so instead of showing zero.
      if (!place) {
        return { data: { place: null, nearOnly: true, feed: null, served: null }, fromCache: false };
      }
      const feed = await fetchQuakes(feedChoice, windowChoice, signal);
      return {
        data: { place, nearOnly: true, feed: feed.data, served: resolveFeedWindow(feedChoice, windowChoice) },
        fromCache: feed.fromCache,
      };
    },
  });

  const state = data;

  /** Sorted, distance-annotated and filtered for the current settings. */
  const quakes = useMemo(() => {
    const raw = state?.feed?.quakes ?? [];
    if (state?.nearOnly && state.place) {
      return withinRadius(withDistance(raw, state.place), radiusKm);
    }
    // Worldwide: distances belong to a place the user asked about, so there are none.
    return sortQuakes(raw);
  }, [state, radiusKm]);

  const top = useMemo(() => strongest(quakes), [quakes]);
  const shown = quakes.slice(0, limit);
  const count = quakes.length;
  const topFelt = top === null ? null : feltLabel(top);

  if (nearOnly && city === '') {
    return (
      <EmptyState
        size="sm"
        icon={<MapPinIcon className="h-4 w-4" />}
        title="Which place?"
        description="Set a city in the settings to watch the earthquakes near it."
      />
    );
  }

  if (error && !data) {
    return (
      <EmptyState
        size="sm"
        icon={<QuakeIcon className="h-4 w-4" />}
        title={errorCode === 'network' ? 'Offline' : 'Could not read the earthquake feed'}
        description={error}
        action={
          <Button size="sm" variant="secondary" icon={<RefreshIcon className="h-3.5 w-3.5" />} onClick={refresh}>
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
        icon={<QuakeIcon className="h-4 w-4" />}
        title="Reading the USGS feed…"
        description={nearOnly ? city : `${FEED_LABEL(feedChoice)} · ${WINDOW_LABEL(windowChoice)}`}
      />
    );
  }

  if (data.nearOnly && data.place === null) {
    return (
      <EmptyState
        size="sm"
        icon={<MapPinIcon className="h-4 w-4" />}
        title={`No match for “${city}”`}
        description="Try adding a country, for instance “Portland, Maine”."
      />
    );
  }

  const feedResult = data.feed;
  const served = data.served ?? resolveFeedWindow(feedChoice, windowChoice);
  // A stored feed the provider no longer serves is shown as what was read.
  const title =
    served.feed === feedChoice
      ? `${FEED_LABEL(feedChoice)} · ${WINDOW_LABEL(served.window)}`
      : `${FEED_LABEL(feedChoice)} · ${WINDOW_LABEL(served.window)} (this feed stops there)`;

  return (
    <div className="@container flex h-full flex-col gap-2 text-slate-700 dark:text-slate-200">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-[11px] font-medium text-slate-500 dark:text-slate-400" title={title}>
            {title}
          </p>
          {data.place ? (
            <p
              className="flex items-center gap-1 truncate text-[10px] text-slate-400 dark:text-slate-500"
              title={placeLabel(data.place)}
            >
              <MapPinIcon className="h-3 w-3 shrink-0" />
              {placeLabel(data.place)}
            </p>
          ) : null}
        </div>
        <Badge tone={count > 0 ? 'rose' : 'slate'} className="tabular-nums">
          {count} recorded
        </Badge>
      </div>

      {error ? (
        <p className="truncate text-[10px] text-amber-600 dark:text-amber-400" title={error}>
          Refresh failed ({error}) — showing the last feed.
        </p>
      ) : null}

      {top === null ? null : (
        <div className="rounded-lg bg-slate-50 p-2 dark:bg-slate-800/60">
          <div className="flex items-baseline gap-2">
            <span className={cn('text-2xl font-semibold leading-none tabular-nums', TONE_TEXT[magnitudeBand(top.magnitude).tone])}>
              {top.magnitude === null ? '—' : `M${top.magnitude.toFixed(1)}`}
            </span>
            <Badge tone={magnitudeBand(top.magnitude).tone}>{magnitudeBand(top.magnitude).label}</Badge>
            {top.tsunami ? <Badge tone="sky">Tsunami flag</Badge> : null}
          </div>
          <p className="mt-1 truncate text-xs font-medium text-slate-700 dark:text-slate-200" title={top.place}>
            {top.place || 'Unknown location'}
          </p>
          <p className="mt-0.5 truncate text-[10px] text-slate-400 dark:text-slate-500">
            {[
              depthLabel(top.depthKm),
              formatRelativeTime(top.time, now),
              topFelt,
              top.distanceKm === undefined ? null : `${formatDistance(top.distanceKm)} away`,
            ]
              .filter((part): part is string => Boolean(part))
              .join(' · ')}
          </p>
        </div>
      )}

      {shown.length === 0 ? (
        <p className="flex flex-1 items-center justify-center px-2 text-center text-[11px] text-slate-400 dark:text-slate-500">
          {data.nearOnly
            ? `Nothing above ${FEED_LABEL(feedChoice)} within ${formatDistance(radiusKm)} of ${data.place?.name ?? city} in the ${WINDOW_LABEL(served.window)} — widen the radius or lower the threshold.`
            : `Nothing at ${FEED_LABEL(feedChoice)} in the ${WINDOW_LABEL(served.window)} — lower the threshold.`}
        </p>
      ) : (
        <ul role="list" className="min-h-0 flex-1 overflow-y-auto">
          {shown.map((quake) => (
            <QuakeRow key={quake.id} quake={quake} now={now} />
          ))}
        </ul>
      )}

      {count > shown.length ? (
        <p className="text-[10px] text-slate-400 dark:text-slate-500">
          Showing the {shown.length} most recent of {count}.
        </p>
      ) : null}

      <div className="mt-auto flex items-center justify-between gap-2 text-[10px] text-slate-400 dark:text-slate-500">
        <SourceBadge input={{ pending, error, errorCode, status: errorStatus, fromCache }} />
        {/* The feed's own generation time: it is what makes every "4m ago" honest. */}
        <span className="truncate text-right">
          {feedResult?.generatedAt === null || feedResult === null
            ? 'feed time unknown'
            : `feed built ${formatRelativeTime(feedResult.generatedAt, now)}`}
        </span>
      </div>
    </div>
  );
}

export const earthquakeWidget = defineWidget<EarthquakeConfig>({
  type: 'earthquake',
  name: 'Seismic watch',
  summary: 'Recent earthquakes worldwide, and any near a place you care about.',
  category: 'environment',
  keywords: ['earthquake', 'quake', 'seismic', 'usgs', 'magnitude', 'tsunami', 'richter'],
  icon: QuakeIcon,
  accent: 'rose',
  badge: 'Live',
  defaultSize: { w: 6, h: 7, minW: 3, minH: 4 },
  defaultConfig: DEFAULT_EARTHQUAKE_CONFIG,
  settings: SETTINGS,
  summarize: (config) => {
    const near = config.nearOnly === true;
    const name = config.city.trim() || 'Set a place';
    const radius = `${Math.round(clamp(config.radiusKm, 50, 5000)).toLocaleString('en-US')} km`;
    if (near) return `Near ${name} · ${radius}`;
    // The window is what makes the chip count meaningful: "M2.5+ · past day".
    return `${FEED_LABEL(asFeed(config.feed))} · ${WINDOW_LABEL(asWindow(config.window))}`;
  },
  component: EarthquakeWidget,
});
