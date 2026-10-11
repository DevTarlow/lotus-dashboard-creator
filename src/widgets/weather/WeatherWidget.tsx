import { useState, type FormEvent } from 'react';
import { RefreshIcon, WeatherIcon } from '@/components/icons';
import { Button, Badge } from '@/components/ui';
import { useWeather } from '@/hooks/useWeather';
import { preferredTemperatureUnit } from '@/lib/weather';
import { formatTemperature, temperatureUnit, type TemperatureUnit } from '@/lib/mock/weather';
import { cn } from '@/lib/utils';
import type { SettingField, WidgetProps } from '@/types';
import { defineWidget } from '@/widgets/define';
import { WeatherGlyph } from '@/widgets/shared';

export type WeatherConfig = {
  city: string;
  unit: TemperatureUnit;
  showForecast: boolean;
  showDetails: boolean;
  showLocation: boolean;
};

const DEFAULT_WEATHER_CONFIG: WeatherConfig = {
  // No city until the user names one. Baking in a city made a first visit claim
  // to know where you are, and the setting was behind a hover-only gear.
  city: '',
  // Metric unless the browser's locale says otherwise.
  unit: preferredTemperatureUnit(
    typeof navigator === 'undefined' ? undefined : navigator.language,
  ),
  showForecast: true,
  showDetails: true,
  showLocation: true,
};

const SETTINGS: readonly SettingField[] = [
  {
    key: 'city',
    label: 'City',
    type: 'text',
    placeholder: 'Lisbon',
    maxLength: 48,
    help: 'Live weather from wttr.in — no API key needed. Narrow the search with a country, e.g. “Portland, Maine”.',
  },
  {
    key: 'unit',
    label: 'Units',
    type: 'select',
    options: [
      { label: 'Celsius (°C)', value: 'metric' },
      { label: 'Fahrenheit (°F)', value: 'imperial' },
    ],
  },
  { key: 'showForecast', label: 'Show hourly outlook', type: 'switch' },
  { key: 'showDetails', label: 'Show details', type: 'switch' },
  { key: 'showLocation', label: 'Show resolved location', type: 'switch', help: 'Confirms which place the name matched.' },
];

const TIME_FORMAT = new Intl.DateTimeFormat(undefined, { hour: 'numeric' });
const UPDATED_FORMAT = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });

const OUTLOOK_LABELS = {
  hourly: 'Next hours',
  today: 'Today',
} as const;

/**
 * The very first thing a weather panel needs is a place.
 *
 * Asking for it here, in the card, beats instructing the user to find the
 * settings gear — the widget already owns the config write either way.
 */
function CityPrompt({ city, onSet }: { city: string; onSet: (city: string) => void }) {
  const [draft, setDraft] = useState(city);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const next = draft.trim();
    if (next) onSet(next);
  };

  return (
    <form onSubmit={submit} className="flex w-full max-w-[13rem] flex-col items-center gap-2">
      <label className="sr-only" htmlFor="weather-city-prompt">
        City
      </label>
      <input
        id="weather-city-prompt"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        placeholder="Lisbon"
        maxLength={48}
        autoComplete="off"
        className="w-full rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-center text-xs text-slate-700 outline-none transition placeholder:text-slate-400 focus:ring-2 focus:ring-violet-500/30 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
      />
      <Button size="sm" variant="primary" type="submit" disabled={draft.trim() === ''}>
        Show the forecast
      </Button>
      <p className="text-[10px] text-slate-400 dark:text-slate-500">No API key needed.</p>
    </form>
  );
}

/** Live weather with a simulated fallback when the network is unavailable. */
export function WeatherWidget({ config, updateConfig }: WidgetProps<WeatherConfig>) {
  const { weather, source, error, pending } = useWeather(config.city);
  const unit = temperatureUnit(config.unit);
  const live = source === 'live';

  // Nothing to forecast for an unnamed place: ask, rather than showing a
  // simulated reading for a city that does not exist.
  if (config.city.trim() === '') {
    return (
      <div className="@container flex h-full flex-col items-center justify-center gap-3 text-center">
        <WeatherIcon className="h-6 w-6 text-slate-300 dark:text-slate-600" />
        <div>
          <p className="text-sm font-semibold text-slate-700 dark:text-slate-200">Which city?</p>
          <p className="mt-0.5 text-xs text-slate-400 dark:text-slate-500">Type a place to see its forecast.</p>
        </div>
        <CityPrompt city={config.city} onSet={(city) => updateConfig({ city })} />
      </div>
    );
  }

  // Hourly slots while any remain today, otherwise today's summary.
  const mode = weather.hourly.length > 0 ? 'hourly' : 'today';
  const { highC, lowC } = weather;
  const hasRange = Number.isFinite(highC) && Number.isFinite(lowC) && highC >= lowC;
  const details = [
    { label: 'Feels', value: formatTemperature(weather.feelsLikeC, config.unit) },
    { label: 'Humidity', value: `${weather.humidity}%` },
    { label: 'Wind', value: `${weather.windKph}` },
    { label: 'High', value: formatTemperature(weather.highC, config.unit) },
    { label: 'Low', value: formatTemperature(weather.lowC, config.unit) },
  ];
  // A widget only three rows tall can show the temperature or the details, not
  // both, so the container decides which set is visible.
  const location = [weather.city, weather.region].filter(Boolean).join(' · ');

  return (
    <div className="@container flex h-full flex-col gap-2">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-slate-900 dark:text-white">{weather.city}</p>
          <p className="truncate text-xs text-slate-500 dark:text-slate-400">{weather.summary}</p>
          {config.showLocation && weather.region ? (
            <p className="truncate text-[10px] text-slate-400 dark:text-slate-500" title={location}>
              {weather.region}
            </p>
          ) : null}
        </div>
        <WeatherGlyph condition={weather.condition} className="h-9 w-9 text-violet-500 dark:text-violet-300" />
      </div>

      <div className="flex items-end gap-2">
        <span className="text-4xl font-semibold leading-none tracking-tight text-slate-900 tabular-nums dark:text-white">
          {formatTemperature(weather.temperatureC, config.unit)}
        </span>
        <span className="pb-0.5 text-xs font-medium text-slate-400 dark:text-slate-500">{unit}</span>
        {hasRange ? (
          <span className="ml-auto pb-0.5 text-right text-[11px] leading-tight text-slate-400 dark:text-slate-500">
            H {formatTemperature(weather.highC, config.unit)}
            <br />
            L {formatTemperature(weather.lowC, config.unit)}
          </span>
        ) : null}
      </div>

      {config.showDetails || config.showForecast ? (
        <div className="flex min-h-0 flex-1 flex-col gap-2">
          {config.showDetails ? (
            <dl className="grid grid-cols-3 gap-2 text-center">
              {details.map((item) => (
                <div
                  key={item.label}
                  className="rounded-lg bg-slate-50 px-2 py-1.5 dark:bg-slate-800/60"
                >
                  <dt className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                    {item.label}
                  </dt>
                  <dd className="text-sm font-semibold text-slate-700 tabular-nums dark:text-slate-200">
                    {item.value}
                  </dd>
                </div>
              ))}
            </dl>
          ) : null}

          {/* The detail tiles and the outlook are alternatives, so a short
              widget drops the forecast instead of pushing it out of sight. */}
          <div
            className={cn(
              'mt-auto border-t border-slate-100 pt-2 dark:border-slate-800',
              mode === 'hourly' ? 'hidden @[14rem]:block' : 'hidden @[8rem]:block',
            )}
          >
            <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
              {OUTLOOK_LABELS[mode]}
            </p>
            {mode === 'hourly' ? (
              <div className="flex items-end justify-between gap-1">
                {weather.hourly.map((hour) => (
                  <div key={hour.timestamp} className="flex flex-1 flex-col items-center gap-1">
                    <span className="text-[10px] font-medium text-slate-400 dark:text-slate-500">
                      {TIME_FORMAT.format(new Date(hour.timestamp))}
                    </span>
                    <WeatherGlyph
                      condition={hour.condition}
                      className={cn('h-4 w-4', hour.precipitationChance > 50 ? 'text-sky-500' : 'text-slate-400')}
                    />
                    <span className="text-[11px] font-semibold text-slate-600 tabular-nums dark:text-slate-300">
                      {formatTemperature(hour.temperatureC, config.unit)}
                    </span>
                  </div>
                ))}
              </div>
            ) : hasRange ? (
              <div className="flex h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                <span className="w-1/3 bg-sky-200 dark:bg-sky-500/30" />
                <span className="flex-1 bg-gradient-to-r from-sky-400 via-amber-400 to-rose-400" />
                <span className="w-1/3 bg-rose-200 dark:bg-rose-500/30" />
              </div>
            ) : (
              <p className="text-xs text-slate-400 dark:text-slate-500">No outlook data available.</p>
            )}
          </div>
        </div>
      ) : null}

      <div className="mt-auto flex items-center justify-between gap-2">
        <Badge
          tone={live ? 'sky' : 'slate'}
          icon={<RefreshIcon className={cn('h-3 w-3', pending && 'animate-spin')} />}
          title={
            live
              ? `Live from wttr.in${weather.observedAt ? `, observed ${weather.observedAt} local` : ''}`
              : error ?? 'Simulated locally — live weather unavailable'
          }
        >
          {live ? 'Live' : 'Simulated'}
        </Badge>
        {/* Prefer the provider's own reading time: wttr.in can cache an
            observation for hours, and "updated 04:12" would overstate it. */}
        <span className="truncate text-[10px] text-slate-400 dark:text-slate-500">
          {weather.observedAt ? `observed ${weather.observedAt}` : `updated ${UPDATED_FORMAT.format(new Date(weather.updatedAt))}`}
        </span>
      </div>
    </div>
  );
}

export const weatherWidget = defineWidget<WeatherConfig>({
  type: 'weather',
  name: 'Weather',
  summary: 'Live forecast from wttr.in with a simulated offline fallback — no API key required.',
  category: 'essentials',
  keywords: ['forecast', 'temperature', 'city', 'climate'],
  icon: WeatherIcon,
  accent: 'sky',
  defaultSize: { w: 3, h: 7, minW: 2, minH: 5 },
  defaultConfig: DEFAULT_WEATHER_CONFIG,
  settings: SETTINGS,
  summarize: (config) => (config.city.trim() ? `${config.city} · ${config.unit === 'metric' ? '°C' : '°F'}` : 'Set a city'),
  component: WeatherWidget,
});
