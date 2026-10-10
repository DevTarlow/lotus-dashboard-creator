import { useMemo } from 'react';
import { RefreshIcon, WeatherIcon } from '@/components/icons';
import { Badge } from '@/components/ui';
import { useTimeBucket } from '@/hooks/useNow';
import {
  formatTemperature,
  getWeather,
  temperatureUnit,
  WEATHER_BUCKET_MS,
  type TemperatureUnit,
} from '@/lib/mock/weather';
import { cn } from '@/lib/utils';
import type { SettingField, WidgetProps } from '@/types';
import { defineWidget } from '@/widgets/define';
import { WeatherGlyph } from '@/widgets/shared';

export type WeatherConfig = {
  city: string;
  unit: TemperatureUnit;
  showForecast: boolean;
  showDetails: boolean;
};

const DEFAULT_WEATHER_CONFIG: WeatherConfig = {
  city: 'Lisbon',
  unit: 'metric',
  showForecast: true,
  showDetails: true,
};

const SETTINGS: readonly SettingField[] = [
  { key: 'city', label: 'City', type: 'text', placeholder: 'Lisbon', maxLength: 48, help: 'Any city name works — the forecast is simulated locally.' },
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
];

function hourLabel(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric' }).format(new Date(timestamp));
}

/** Simulated weather overview with an hourly outlook. */
export function WeatherWidget({ config }: WidgetProps<WeatherConfig>) {
  const bucket = useTimeBucket(WEATHER_BUCKET_MS);
  const weather = useMemo(
    () => getWeather(config.city, bucket * WEATHER_BUCKET_MS),
    [config.city, bucket],
  );
  const unit = temperatureUnit(config.unit);

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-slate-900 dark:text-white">{weather.city}</p>
          <p className="truncate text-xs text-slate-500 dark:text-slate-400">{weather.summary}</p>
        </div>
        <WeatherGlyph condition={weather.condition} className="h-9 w-9 text-violet-500 dark:text-violet-400" />
      </div>

      <div className="flex items-end gap-2">
        <span className="text-4xl font-semibold leading-none tracking-tight text-slate-900 tabular-nums dark:text-white">
          {formatTemperature(weather.temperatureC, config.unit)}
        </span>
        <span className="pb-0.5 text-xs font-medium text-slate-400 dark:text-slate-500">{unit}</span>
        <span className="ml-auto pb-0.5 text-right text-[11px] leading-tight text-slate-400 dark:text-slate-500">
          H {formatTemperature(weather.highC, config.unit)}
          <br />
          L {formatTemperature(weather.lowC, config.unit)}
        </span>
      </div>

      {config.showDetails ? (
        <dl className="grid grid-cols-3 gap-2 text-center">
          {[
            { label: 'Feels', value: formatTemperature(weather.feelsLikeC, config.unit) },
            { label: 'Humidity', value: `${weather.humidity}%` },
            { label: 'Wind', value: `${weather.windKph}` },
          ].map((item) => (
            <div
              key={item.label}
              className="rounded-lg bg-slate-50 px-2 py-1.5 dark:bg-slate-800/60"
            >
              <dt className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                {item.label}
              </dt>
              <dd className="text-sm font-semibold text-slate-700 tabular-nums dark:text-slate-200">{item.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}

      {config.showForecast ? (
        <div className="mt-auto flex items-end justify-between gap-1 border-t border-slate-100 pt-2 dark:border-slate-800">
          {weather.hourly.map((hour) => (
            <div key={hour.timestamp} className="flex flex-1 flex-col items-center gap-1">
              <span className="text-[10px] font-medium text-slate-400 dark:text-slate-500">{hourLabel(hour.timestamp)}</span>
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
      ) : null}

      <div className="flex items-center justify-between gap-2">
        <Badge tone="slate" icon={<RefreshIcon className="h-3 w-3" />}>
          Simulated
        </Badge>
        <span className="text-[10px] text-slate-400 dark:text-slate-500">
          updated{' '}
          {new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(
            new Date(weather.updatedAt),
          )}
        </span>
      </div>
    </div>
  );
}

export const weatherWidget = defineWidget<WeatherConfig>({
  type: 'weather',
  name: 'Weather',
  summary: 'Simulated forecast with hourly outlook — no API key required.',
  category: 'essentials',
  keywords: ['forecast', 'temperature', 'city', 'climate'],
  icon: WeatherIcon,
  accent: 'sky',
  defaultSize: { w: 3, h: 7, minW: 2, minH: 5 },
  defaultConfig: DEFAULT_WEATHER_CONFIG,
  settings: SETTINGS,
  summarize: (config) => `${config.city} · ${config.unit === 'metric' ? '°C' : '°F'}`,
  component: WeatherWidget,
});
