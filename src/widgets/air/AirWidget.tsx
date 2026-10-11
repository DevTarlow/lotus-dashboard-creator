import { useMemo } from 'react';
import { AirIcon, MapPinIcon, RefreshIcon } from '@/components/icons';
import { Badge, Button, EmptyState, SourceBadge, StatTile, ProgressBar, TONE_FILL } from '@/components/ui';
import { useNow } from '@/hooks/useNow';
import { useResource } from '@/hooks/useResource';
import { cn } from '@/lib/utils';
import {
  AIR_REFRESH_MS,
  aqiBand,
  fetchAir,
  isEmptyReading,
  pollenRows,
  pollutantRows,
  uvBand,
  type AirSnapshot,
} from '@/lib/air';
import { geocodeCity, placeLabel, type GeoPlace } from '@/lib/geocode';
import type { SettingField, WidgetProps } from '@/types';
import { defineWidget } from '@/widgets/define';

export type AirConfig = {
  city: string;
  showUv: boolean;
  showPollen: boolean;
  showPollutants: boolean;
  showHours: boolean;
};

const DEFAULT_AIR_CONFIG: AirConfig = {
  city: 'Lisbon',
  showUv: true,
  showPollen: true,
  showPollutants: false,
  showHours: true,
};

const SETTINGS: readonly SettingField[] = [
  {
    key: 'city',
    label: 'City',
    type: 'text',
    placeholder: 'Lisbon',
    maxLength: 48,
    help: 'Live from Open-Meteo — no API key needed. Narrow the search with a country, e.g. “Portland, Maine”.',
  },
  { key: 'showUv', label: 'Show the UV index', type: 'switch' },
  { key: 'showHours', label: 'Show the next hours', type: 'switch' },
  { key: 'showPollen', label: 'Show pollen, where reported', type: 'switch', help: 'Pollen is modelled mostly for Europe and only in season.' },
  { key: 'showPollutants', label: 'Show the pollutant breakdown', type: 'switch' },
];

interface AirData {
  place: GeoPlace | null;
  snapshot: AirSnapshot | null;
}

const HOUR_LABEL = new Intl.DateTimeFormat(undefined, { hour: 'numeric' });

/** Air quality, UV and pollen for one place. */
export function AirWidget({ config }: WidgetProps<AirConfig>) {
  const now = useNow(15 * 60_000);
  const city = config.city.trim();

  const { data, error, errorCode, errorStatus, pending, fromCache, refresh } = useResource<AirData>({
    key: `air:${city.toLowerCase()}`,
    refreshMs: AIR_REFRESH_MS,
    enabled: city !== '',
    load: async (signal) => {
      const place = await geocodeCity(city, signal);
      if (!place) return { data: { place: null, snapshot: null }, fromCache: false };
      const air = await fetchAir(place, signal);
      return { data: { place, snapshot: air.data }, fromCache: air.fromCache };
    },
  });

  const band = useMemo(() => aqiBand(data?.snapshot?.current.usAqi ?? null), [data]);
  const uv = useMemo(() => uvBand(data?.snapshot?.current.uvIndex ?? null), [data]);
  const pollen = useMemo(() => (data?.snapshot ? pollenRows(data.snapshot.current.pollen) : []), [data]);
  const pollutants = useMemo(
    () => (data?.snapshot ? pollutantRows(data.snapshot.current).filter((row) => row.value !== null) : []),
    [data],
  );

  if (city === '') {
    return (
      <EmptyState
        size="sm"
        icon={<AirIcon className="h-4 w-4" />}
        title="Which place?"
        description="Set a city in the settings to see its air quality, UV and pollen."
      />
    );
  }

  if (error && !data) {
    return (
      <EmptyState
        size="sm"
        icon={<AirIcon className="h-4 w-4" />}
        title={errorCode === 'network' ? 'Offline' : 'Could not read the air quality'}
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
    return <EmptyState size="sm" icon={<AirIcon className="h-4 w-4" />} title="Reading Open-Meteo…" description={city} />;
  }

  if (data.place === null) {
    return (
      <EmptyState
        size="sm"
        icon={<MapPinIcon className="h-4 w-4" />}
        title={`No match for “${city}”`}
        description="Try adding a country, for instance “Portland, Maine”."
      />
    );
  }

  const snapshot = data.snapshot;
  if (snapshot === null || isEmptyReading(snapshot.current)) {
    return (
      <EmptyState
        size="sm"
        icon={<AirIcon className="h-4 w-4" />}
        title="No reading for this place"
        description="Open-Meteo answered without current air-quality data here. Pollen is only modelled in some regions."
      />
    );
  }

  const current = snapshot.current;
  const aqi = current.usAqi;
  const peak = Math.max(...snapshot.hours.map((hour) => hour.usAqi ?? 0), 1);

  return (
    <div className="@container flex h-full flex-col gap-2.5 text-slate-700 dark:text-slate-200">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="flex items-center gap-1 truncate text-[11px] text-slate-400 dark:text-slate-500" title={placeLabel(data.place)}>
            <MapPinIcon className="h-3 w-3 shrink-0" />
            {data.place.name}
          </p>
          <div className="mt-0.5 flex items-baseline gap-1.5">
            <span className="text-3xl font-semibold leading-none tabular-nums">{aqi ?? '—'}</span>
            <span className="text-[11px] font-medium text-slate-400 dark:text-slate-500">US AQI</span>
          </div>
        </div>
        <Badge tone={band.tone}>{band.label}</Badge>
      </div>

      <p className="text-[11px] leading-snug text-slate-500 dark:text-slate-400">{band.advice}</p>

      {config.showHours && snapshot.hours.length > 1 ? (
        <div>
          <div className="flex h-12 items-end gap-[3px]" role="img" aria-label="Air quality for the next hours">
            {snapshot.hours.map((hour) => {
              const hourBand = aqiBand(hour.usAqi);
              const height = Math.max(6, Math.round(((hour.usAqi ?? 0) / peak) * 100));
              return (
                <div
                  key={hour.time}
                  className={cn('min-w-0 flex-1 rounded-sm', TONE_FILL[hourBand.tone])}
                  style={{ height: `${height}%` }}
                  title={`${hour.hour}:00 · ${hour.usAqi ?? '—'} AQI${hour.uvIndex !== null ? ` · UV ${hour.uvIndex.toFixed(1)}` : ''}`}
                />
              );
            })}
          </div>
          <div className="mt-1 flex justify-between text-[10px] text-slate-400 dark:text-slate-500">
            <span>
              {HOUR_LABEL.format(new Date(now.getFullYear(), now.getMonth(), now.getDate(), snapshot.hours[0].hour))}
            </span>
            <span>{snapshot.hours.length} hours</span>
          </div>
        </div>
      ) : null}

      {config.showUv ? (
        <StatTile
          label={`UV index${snapshot.uvMaxToday !== null ? ` · peak ${snapshot.uvMaxToday.toFixed(1)}` : ''}`}
          value={current.uvIndex === null ? '—' : current.uvIndex.toFixed(1)}
          hint={uv.advice}
          tone={uv.tone}
        />
      ) : null}

      {config.showPollen && pollen.length > 0 ? (
        <div className="space-y-1">
          <h4 className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">Pollen</h4>
          {pollen.slice(0, 4).map((row) => (
            <div key={row.id} className="flex items-center gap-2 text-[11px]">
              <span className="w-14 shrink-0 text-slate-500 dark:text-slate-400">{row.label}</span>
              <ProgressBar value={Math.min(1, (row.value ?? 0) / 100)} tone={row.band.tone} className="flex-1" />
              <span className="w-20 shrink-0 text-right tabular-nums text-slate-500 dark:text-slate-400">{row.band.label}</span>
            </div>
          ))}
        </div>
      ) : null}

      {config.showPollutants && pollutants.length > 0 ? (
        <dl className="grid grid-cols-2 gap-x-3">
          {pollutants.map((row) => (
            <div
              key={row.id}
              className="flex items-baseline justify-between gap-2 border-b border-slate-100 py-0.5 text-[11px] dark:border-slate-800"
            >
              <dt className="text-slate-400 dark:text-slate-500">{row.label}</dt>
              <dd className="font-medium tabular-nums">
                {row.value?.toFixed(1)} <span className="text-slate-400 dark:text-slate-500">{row.unit}</span>
              </dd>
            </div>
          ))}
        </dl>
      ) : null}

      <div className="mt-auto flex flex-wrap items-center gap-2 pt-1 text-[10px] text-slate-400 dark:text-slate-500">
        <SourceBadge input={{ pending, error, errorCode, status: errorStatus, fromCache }} />
        <span className="truncate">Open-Meteo · {snapshot.timeZone ?? data.place.timeZone}</span>
      </div>
    </div>
  );
}

export const airWidget = defineWidget<AirConfig>({
  type: 'air',
  name: 'Air quality & UV',
  summary: 'Air quality, UV index and pollen, live from Open-Meteo.',
  category: 'environment',
  keywords: ['air', 'aqi', 'pollution', 'pm2.5', 'uv', 'pollen', 'allergy', 'smog'],
  icon: AirIcon,
  accent: 'emerald',
  badge: 'Live',
  defaultSize: { w: 3, h: 6, minW: 2, minH: 4 },
  defaultConfig: DEFAULT_AIR_CONFIG,
  settings: SETTINGS,
  summarize: (config) => config.city.trim() || 'Set a city',
  component: AirWidget,
});
