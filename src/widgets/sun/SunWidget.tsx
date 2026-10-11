import { useCallback, useMemo } from 'react';
import { RefreshIcon, SunMoonIcon } from '@/components/icons';
import { Button, EmptyState, IconButton, Ring, SourceBadge } from '@/components/ui';
import { useNow } from '@/hooks/useNow';
import { useResource } from '@/hooks/useResource';
import { GEOCODE_TTL_MS, geocodeCity, placeLabel, type GeoPlace } from '@/lib/geocode';
import {
  buildSunDay,
  formatDaylightDelta,
  formatDaylightShort,
  formatZoneTime,
  goldenHourLabel,
  rememberPlace,
  resolvedPlaceFor,
  sunSummarize,
  type SunDay,
} from '@/lib/sun';
import { asBoolean, asString, cn } from '@/lib/utils';
import type { SettingField, WidgetProps } from '@/types';
import { defineWidget } from '@/widgets/define';

export type SunConfig = {
  /** City to resolve; the place decides the zone its times are printed in. */
  city: string;
  showMoon: boolean;
  showTwilight: boolean;
  showGoldenHour: boolean;
  showProgress: boolean;
};

const DEFAULT_SUN_CONFIG: SunConfig = {
  // No city until the user names one: the panel asks for a place rather than
  // reporting another city's sunrise. Templates that mean a specific place set
  // it explicitly, and all three environment panels share one geocode lookup.
  city: '',
  showMoon: true,
  showTwilight: true,
  showGoldenHour: true,
  showProgress: true,
};

const SETTINGS: readonly SettingField[] = [
  {
    key: 'city',
    label: 'City',
    type: 'text',
    placeholder: 'Lisbon',
    maxLength: 48,
    help: 'The place decides the time zone the times are shown in — sunrise is printed on its clock, not yours. Add a country to narrow the match.',
  },
  { key: 'showMoon', label: 'Show the moon phase', type: 'switch' },
  { key: 'showTwilight', label: 'Show civil twilight', type: 'switch' },
  { key: 'showGoldenHour', label: 'Show the golden hour', type: 'switch' },
  { key: 'showProgress', label: 'Show the daylight ring', type: 'switch' },
];

/**
 * A fresh lookup every day matches the geocoder's own TTL: `geocodeCity` caches
 * its answer for {@link GEOCODE_TTL_MS} and `useResource` asks at most once per
 * window, so re-typing a city is a cache hit rather than a second request.
 */
const REFRESH_MS = GEOCODE_TTL_MS;

/** How often the panel re-reads the clock, so a real sunrise rolls over on its own. */
const TICK_MS = 5 * 60_000;

/** `undefined` only on a runtime without `Intl`; typed as optional in the DOM lib. */
const VIEWER_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC';

/** The day as it is rendered: config is untrusted, so it is read through this. */
interface SunView {
  city: string;
  cityKey: string;
  showMoon: boolean;
  showTwilight: boolean;
  showGoldenHour: boolean;
  showProgress: boolean;
}

function normalise(config: SunConfig): SunView {
  const city = asString(config.city).trim().replace(/\s+/g, ' ');
  return {
    city,
    cityKey: city.toLowerCase(),
    showMoon: asBoolean(config.showMoon, true),
    showTwilight: asBoolean(config.showTwilight, true),
    showGoldenHour: asBoolean(config.showGoldenHour, true),
    showProgress: asBoolean(config.showProgress, true),
  };
}

/** "America/Argentina/Buenos_Aires" → "America/Argentina/Buenos Aires". */
function zoneLabel(timeZone: string): string {
  return timeZone.replace(/_/g, ' ');
}

/** Civil twilight as one line: "09:31 – 13:53" on the place's clock. */
function twilightLabel(times: SunDay['times'], timeZone: string): string | null {
  if (!times.civilDawn || !times.civilDusk) return null;
  return `${formatZoneTime(times.civilDawn, timeZone)} – ${formatZoneTime(times.civilDusk, timeZone)}`;
}

/** One labelled figure in the grid under the ring. */
function Figure({ label, value, title }: { label: string; value: string; title?: string }) {
  return (
    <div className="min-w-0" title={title}>
      <dt className="truncate text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
        {label}
      </dt>
      <dd className="truncate text-sm font-semibold text-slate-800 tabular-nums dark:text-slate-100">{value}</dd>
    </div>
  );
}

/** A secondary reading, e.g. the golden hour window. */
function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2 text-[11px]">
      <span className="shrink-0 text-slate-400 dark:text-slate-500">{label}</span>
      <span className="truncate font-medium text-slate-700 tabular-nums dark:text-slate-200">{value}</span>
    </div>
  );
}

interface DayBodyProps {
  day: SunDay;
  place: GeoPlace;
  view: SunView;
}

/**
 * The readings themselves.
 *
 * The two optional windows are dropped by a container query rather than by a
 * measurement in JS, so a narrow widget keeps the ring, the times and the moon
 * and loses the twilight and golden hour first — the order the card needs to
 * stay readable when it is only two columns wide.
 */
function DayBody({ day, place, view }: DayBodyProps) {
  const delta = day.daylightDeltaMinutes;
  const timeZone = place.timeZone;
  const goldenHour = goldenHourLabel(day.times, timeZone);
  const twilight = twilightLabel(day.times, timeZone);
  const showWindows = (view.showGoldenHour && goldenHour !== null) || (view.showTwilight && twilight !== null);
  const compactDaylight = formatDaylightShort(day.times.daylightMinutes);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2.5">
      {view.showProgress && day.progress !== null ? (
        <div className="flex items-center gap-3 overflow-hidden">
          <Ring
            value={day.progress}
            size={84}
            thickness={9}
            tone="amber"
            label="Daylight progress"
            className="@max-[11rem]:!h-[68px] @max-[11rem]:!w-[68px]"
          >
            <span className="px-1 text-center text-[13px] font-semibold leading-tight" title={`${compactDaylight} of daylight`}>
              {compactDaylight}
            </span>
          </Ring>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
              Daylight
            </p>
            {/* The ring already states the length, so this line only earns its
                place when the wording differs from it — which is the polar day
                and night cases, where there is no ring at all. */}
            {day.daylightLabel === compactDaylight ? null : (
              <p className="truncate text-sm font-semibold text-slate-800 dark:text-slate-100">{day.daylightLabel}</p>
            )}
            <p
              className={cn(
                'truncate text-[11px]',
                delta === null || delta === 0
                  ? 'text-slate-400 dark:text-slate-500'
                  : 'font-medium text-amber-600 dark:text-amber-400',
              )}
            >
              {delta === null ? 'Nothing to compare' : formatDaylightDelta(delta)}
            </p>
          </div>
        </div>
      ) : (
        // Without the ring the length still belongs on screen, and one line is
        // all a two-column widget can spare for it.
        <p className="text-xs font-semibold text-slate-800 dark:text-slate-100">
          {day.daylightLabel}
          {delta === null || delta === 0 ? null : (
            <span className="ml-1.5 font-normal text-slate-400 dark:text-slate-500">{formatDaylightDelta(delta)}</span>
          )}
        </p>
      )}

      {/* The polar explanation belongs directly under the daylight figure it
          explains, not below three other blocks that a short widget clips away. */}
      {day.polarNote ? (
        <p className="text-[11px] leading-snug text-slate-500 dark:text-slate-400">{day.polarNote}</p>
      ) : null}

      <dl className="@max-[7rem]:grid-cols-1 grid grid-cols-2 gap-x-3 gap-y-2">
        <Figure label="Sunrise" value={day.sunriseLabel} />
        <Figure label="Sunset" value={day.sunsetLabel} />
        <Figure label="Solar noon" value={day.solarNoonLabel} />
        {view.showMoon ? (
          <Figure
            label="Moon"
            value={`${day.moon.emoji} ${Math.round(day.moon.illumination * 100)}%`}
            title={`${day.moon.label} · ${Math.round(day.moon.illumination * 100)}% illuminated · ${Math.round(day.moon.ageDays)} days old`}
          />
        ) : null}
      </dl>

      {showWindows ? (
        <div className="@max-[13rem]:hidden space-y-0.5">
          {view.showGoldenHour && goldenHour !== null ? <Line label="Golden hour" value={goldenHour} /> : null}
          {view.showTwilight && twilight !== null ? <Line label="Civil twilight" value={twilight} /> : null}
          {/* Same row as the windows: one line of card height, and the phase name
              is the most expendable reading here. */}
          {view.showMoon ? <Line label="Moon" value={`${day.moon.emoji} ${day.moon.label}`} /> : null}
        </div>
      ) : null}
    </div>
  );
}

/** The states a panel with no place to show can be in. */
function NoPlace({
  reason,
  city,
  error,
  onRetry,
}: {
  reason: 'empty' | 'loading' | 'error';
  city?: string;
  error?: string | null;
  onRetry?: () => void;
}) {
  if (reason === 'loading') {
    return (
      <EmptyState
        size="sm"
        icon={<SunMoonIcon className="h-4 w-4" />}
        title={`Finding ${city ?? 'the place'}…`}
        description="Looking up its coordinates and its own time zone."
      />
    );
  }

  if (reason === 'error') {
    return (
      <EmptyState
        size="sm"
        icon={<SunMoonIcon className="h-4 w-4" />}
        title="Could not look that place up"
        description={error ?? 'The geocoder did not answer.'}
        action={
          <Button size="sm" variant="secondary" icon={<RefreshIcon className="h-3.5 w-3.5" />} onClick={onRetry}>
            Try again
          </Button>
        }
      />
    );
  }

  return (
    <EmptyState
      size="sm"
      icon={<SunMoonIcon className="h-4 w-4" />}
      title={city ? `No match for “${city}”` : 'Which place?'}
      description={
        city
          ? 'Try adding a country, for example “Portland, Maine”.'
          : 'Set a city in the settings to see its sunrise, sunset and moon.'
      }
    />
  );
}

/**
 * Sunrise, sunset, daylight and the moon phase for one place — every time on
 * that place's own clock, which is the whole point of resolving the city at all.
 *
 * No place means no readings: the panel explains what to do rather than showing
 * a plausible-looking sky for a city that was never found.
 */
export function SunWidget({ config }: WidgetProps<SunConfig>) {
  const view = useMemo(() => normalise(config), [config]);
  const now = useNow(TICK_MS);

  const load = useCallback(
    async (signal: AbortSignal) => {
      const place = await geocodeCity(view.city, signal);
      // Park the match so `summarize` can name the place in the widget header.
      if (place) rememberPlace(place);
      return { data: place, fromCache: false };
    },
    [view.city],
  );

  const { data, error, errorCode, errorStatus, pending, fromCache, refresh } = useResource<GeoPlace | null>({
    key: `sun:${view.cityKey}`,
    refreshMs: REFRESH_MS,
    enabled: view.city !== '',
    load,
  });

  if (view.city === '') return <NoPlace reason="empty" />;
  if (error && !data) return <NoPlace reason="error" error={error} onRetry={refresh} />;
  if (!data) return <NoPlace reason={pending ? 'loading' : 'empty'} city={view.city} />;

  const day = buildSunDay(data, now);
  const dayLabel = new Intl.DateTimeFormat('en-GB', {
    timeZone: data.timeZone,
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  }).format(now);

  return (
    <div className="@container flex h-full flex-col gap-2.5 overflow-hidden text-slate-700 dark:text-slate-200">
      <div className="flex min-w-0 items-start justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <SunMoonIcon className="h-4 w-4 shrink-0 text-amber-500 dark:text-amber-400" />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-slate-900 dark:text-white" title={placeLabel(data)}>
              {placeLabel(data)}
            </p>
            <p
              className="truncate text-[10px] text-slate-400 dark:text-slate-500"
              title={data.timeZone !== VIEWER_ZONE ? `Sunrise and sunset are shown on ${zoneLabel(data.timeZone)} time, not ${zoneLabel(VIEWER_ZONE)}` : zoneLabel(data.timeZone)}
            >
              {zoneLabel(data.timeZone)}
            </p>
          </div>
        </div>
        <IconButton
          label="Look the place up again"
          size="icon-sm"
          className="shrink-0"
          disabled={pending}
          icon={<RefreshIcon className={cn('h-3.5 w-3.5', pending && 'animate-spin')} />}
          onClick={refresh}
        />
      </div>

      <DayBody day={day} place={data} view={view} />

      <div className="mt-auto flex items-center justify-between gap-2">
        <SourceBadge
          input={{ pending, error, errorCode, status: errorStatus, fromCache }}
          className="max-w-[70%] overflow-hidden"
        />
        {/* The place's own date, which is the second thing a viewer in another
            zone gets wrong — and the first thing they look for after sunrise. */}
        <span className="truncate text-[10px] text-slate-400 dark:text-slate-500">{dayLabel}</span>
      </div>
    </div>
  );
}

export const sunWidget = defineWidget<SunConfig>({
  type: 'sun',
  name: 'Sun & moon',
  summary: 'Sunrise, sunset, daylight and the moon phase for a place.',
  category: 'environment',
  keywords: ['sunrise', 'sunset', 'daylight', 'moon', 'twilight', 'golden hour', 'sun'],
  icon: SunMoonIcon,
  accent: 'amber',
  defaultSize: { w: 3, h: 6, minW: 2, minH: 5 },
  defaultConfig: DEFAULT_SUN_CONFIG,
  settings: SETTINGS,
  // The resolved place when this session has looked the city up, else what the
  // user typed — the same sentence the panel's own header shows.
  summarize: (config) => sunSummarize({ place: resolvedPlaceFor(asString(config.city)), city: asString(config.city) }),
  component: SunWidget,
});
