import { useMemo } from 'react';
import { ClockIcon } from '@/components/icons';
import { useNow } from '@/hooks/useNow';
import type { SettingField, WidgetProps } from '@/types';
import { defineWidget } from '@/widgets/define';

export type ClockConfig = {
  /** Caption shown above the time. */
  label: string;
  /** `local` or an IANA time zone id. */
  timeZone: string;
  hour12: boolean;
  showSeconds: boolean;
  showDate: boolean;
};

const TIME_ZONE_OPTIONS: ReadonlyArray<{ label: string; value: string }> = [
  { label: 'Local time', value: 'local' },
  { label: 'UTC', value: 'UTC' },
  { label: 'New York', value: 'America/New_York' },
  { label: 'London', value: 'Europe/London' },
  { label: 'Berlin', value: 'Europe/Berlin' },
  { label: 'Dubai', value: 'Asia/Dubai' },
  { label: 'Kolkata', value: 'Asia/Kolkata' },
  { label: 'Singapore', value: 'Asia/Singapore' },
  { label: 'Tokyo', value: 'Asia/Tokyo' },
  { label: 'Sydney', value: 'Australia/Sydney' },
];

const DEFAULT_CLOCK_CONFIG: ClockConfig = {
  label: 'Local time',
  timeZone: 'local',
  hour12: false,
  showSeconds: true,
  showDate: true,
};

const SETTINGS: readonly SettingField[] = [
  { key: 'label', label: 'Caption', type: 'text', placeholder: 'Local time', maxLength: 40 },
  { key: 'timeZone', label: 'Time zone', type: 'select', options: TIME_ZONE_OPTIONS },
  { key: 'hour12', label: '12-hour clock', type: 'switch' },
  { key: 'showSeconds', label: 'Show seconds', type: 'switch' },
  { key: 'showDate', label: 'Show date', type: 'switch' },
];

interface TimeParts {
  hour: string;
  minute: string;
  second: string;
  dayPeriod: string;
  /** Fraction of the day that has elapsed, 0…1. */
  progress: number;
}

function readTimeParts(now: Date, timeZone: string | undefined, hour12: boolean): TimeParts {
  const formatter = new Intl.DateTimeFormat('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12,
    timeZone,
  });
  const parts = formatter.formatToParts(now);
  const lookup = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? '';

  const hour = lookup('hour');
  const minute = lookup('minute');
  const second = lookup('second');
  const hours24 = Number(hour) % 24 + (lookup('dayPeriod').toUpperCase() === 'PM' && Number(hour) !== 12 ? 12 : 0);

  return {
    hour,
    minute,
    second,
    dayPeriod: lookup('dayPeriod'),
    progress: (hours24 * 3600 + Number(minute) * 60 + Number(second)) / 86400,
  };
}

/** Live clock with a day-progress bar and configurable time zone. */
export function ClockWidget({ config }: WidgetProps<ClockConfig>) {
  const now = useNow(config.showSeconds ? 1000 : 15000);
  const timeZone = config.timeZone === 'local' ? undefined : config.timeZone;

  const { time, dateLabel, zoneLabel } = useMemo(() => {
    const parts = readTimeParts(now, timeZone, config.hour12);
    const date = new Intl.DateTimeFormat(undefined, {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      timeZone,
    }).format(now);
    const zone =
      timeZone ??
      Intl.DateTimeFormat().resolvedOptions().timeZone ??
      'Local';
    return { time: parts, dateLabel: date, zoneLabel: zone.replace(/_/g, ' ') };
  }, [now, timeZone, config.hour12]);

  const percent = Math.round(time.progress * 100);

  return (
    <div className="flex h-full flex-col justify-between gap-4">
      <div>
        <p className="truncate text-[11px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
          {config.label || 'Time'}
        </p>
        <div className="mt-1.5 flex items-end gap-1.5 text-slate-900 dark:text-white">
          <span className="text-[2.6rem] font-semibold leading-none tracking-tight tabular-nums">
            {time.hour}:{time.minute}
          </span>
          {config.showSeconds ? (
            <span className="pb-1 text-lg font-medium tabular-nums text-slate-400 dark:text-slate-500">
              {time.second}
            </span>
          ) : null}
          {config.hour12 && time.dayPeriod ? (
            <span className="pb-1.5 text-xs font-bold uppercase text-violet-500 dark:text-violet-300">
              {time.dayPeriod}
            </span>
          ) : null}
        </div>
        {config.showDate ? (
          <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">{dateLabel}</p>
        ) : null}
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-[11px] font-medium text-slate-400 dark:text-slate-500">
          <span>Day progress</span>
          <span className="tabular-nums">{percent}%</span>
        </div>
        <div
          className="h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800"
          role="progressbar"
          aria-label="Day progress"
          aria-valuenow={percent}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div
            className="h-full rounded-full bg-gradient-to-r from-violet-500 via-indigo-400 to-sky-400 transition-[width] duration-700 ease-out"
            style={{ width: `${Math.max(2, percent)}%` }}
          />
        </div>
        <p className="truncate text-[11px] text-slate-400 dark:text-slate-500">{zoneLabel}</p>
      </div>
    </div>
  );
}

export const clockWidget = defineWidget<ClockConfig>({
  type: 'clock',
  name: 'Clock',
  summary: 'Live time for any time zone, with a day-progress bar.',
  category: 'essentials',
  keywords: ['time', 'date', 'timezone', 'watch'],
  icon: ClockIcon,
  accent: 'violet',
  badge: 'Live',
  defaultSize: { w: 3, h: 6, minW: 2, minH: 4 },
  defaultConfig: DEFAULT_CLOCK_CONFIG,
  settings: SETTINGS,
  summarize: (config) => (config.timeZone === 'local' ? 'Local time' : config.timeZone.replace(/_/g, ' ')),
  component: ClockWidget,
});
