import { useMemo, useState } from 'react';
import { GlobeIcon, PlusIcon, TrashIcon } from '@/components/icons';
import { Button, EmptyState, IconButton, SelectInput, TONE_TEXT } from '@/components/ui';
import { useNow } from '@/hooks/useNow';
import { cn, createId } from '@/lib/utils';
import {
  bestOverlap,
  MAX_ZONES,
  normalizeZones,
  overlapSlots,
  ZONE_PRESETS,
  zoneLabel,
  zoneRows,
  type ClockZone,
  type WorldClockConfig,
} from '@/lib/worldclock';
import type { SettingField, WidgetProps } from '@/types';
import { defineWidget } from '@/widgets/define';

// The config shape lives in the lib, next to the code that normalises it; these
// re-exports are what the registry and the integrator import.
export type { ClockZone, WorldClockConfig };

/** Kept next to the definition as well as the lib: new instances need a name. */
const DEFAULT_ZONES: ClockZone[] = [
  { id: 'zone-london', label: 'London', timeZone: 'Europe/London' },
  { id: 'zone-new-york', label: 'New York', timeZone: 'America/New_York' },
  { id: 'zone-tokyo', label: 'Tokyo', timeZone: 'Asia/Tokyo' },
];

const DEFAULT_CONFIG: WorldClockConfig = {
  zones: DEFAULT_ZONES,
  hour12: false,
  workStart: 9,
  workEnd: 17,
  showOverlap: true,
  showDates: true,
};

const SETTINGS: readonly SettingField[] = [
  { key: 'hour12', label: '12-hour clock', type: 'switch' },
  { key: 'workStart', label: 'Working day starts', type: 'number', min: 0, max: 23, unit: ':00' },
  { key: 'workEnd', label: 'Working day ends', type: 'number', min: 0, max: 23, unit: ':00' },
  { key: 'showOverlap', label: 'Show shared working hours', type: 'switch' },
  { key: 'showDates', label: 'Show the date in each zone', type: 'switch' },
];

/** Colours for the availability strip: one tone, intensity by ratio. */
const SLOT_RGB = '14 165 233';
const HOUR_RGB = '100 116 139';

/** "14:00", and "24:00" for the far end of a window that reaches midnight. */
function hourLabel(hour: number): string {
  return `${String(hour % 24).padStart(2, '0')}:00`;
}

/** The offset label without its sign, so the row can colour the sign itself. */
function offsetParts(label: string): { sign: string; rest: string } {
  if (label.startsWith('+') || label.startsWith('−')) {
    return { sign: label.slice(0, 1), rest: label.slice(1) };
  }
  return { sign: '', rest: label };
}

/**
 * Several time zones at once, with the hours they share.
 *
 * The widget is `Intl`-only: no provider, no request, no badge. Every offset is
 * computed against the viewer's own zone at the current instant, so a caller in
 * Berlin sees Tokyo as "+7h" in winter and "+8h" once the clocks change.
 */
export function WorldClockWidget({ config, updateConfig }: WidgetProps<WorldClockConfig>) {
  // 15 seconds: the rows only print hours and minutes, so a second-by-second
  // re-render would cost far more than it could ever show. Nothing is written to
  // config from this tick.
  const now = useNow(15_000);

  // Config is untrusted input (an import, a hand-edited snapshot), so the rows
  // are built from the normalised list rather than from `config.zones` directly.
  const zones = useMemo(() => normalizeZones(config.zones), [config.zones]);
  const [picking, setPicking] = useState(false);

  const rows = useMemo(
    () => zoneRows(zones, now, { hour12: config.hour12, workStart: config.workStart, workEnd: config.workEnd }),
    [zones, now, config.hour12, config.workStart, config.workEnd],
  );
  // Keyed by the day, not the instant: the strip answers a question about the
  // viewer's day, and rebuilding it every 15 seconds would be waste.
  const viewerDay = now.toDateString();
  const slots = useMemo(
    () => overlapSlots(zones, now, config.workStart, config.workEnd),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [zones, viewerDay, config.workStart, config.workEnd],
  );
  const best = useMemo(() => bestOverlap(slots), [slots]);

  const addedZones = useMemo(() => new Set(zones.map((zone) => zone.timeZone)), [zones]);
  const presets = useMemo(() => ZONE_PRESETS.filter((preset) => !addedZones.has(preset.timeZone)), [addedZones]);

  const viewerZone = zoneLabel(Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
  const viewerTime = useMemo(
    () =>
      new Intl.DateTimeFormat('en-US', {
        hour12: config.hour12,
        hour: '2-digit',
        minute: '2-digit',
      }).format(now),
    [now, config.hour12],
  );

  const officeCount = rows.filter((row) => row.businessHours).length;
  const canAdd = zones.length < MAX_ZONES && presets.length > 0;

  const addZone = (timeZone: string): void => {
    const preset = ZONE_PRESETS.find((entry) => entry.timeZone === timeZone);
    if (!preset) return;
    // `normalizeZones` drops duplicates as well, so a race between two clicks
    // cannot produce two Tokyos.
    const next = normalizeZones([...zones, { id: createId('zone'), label: preset.label, timeZone: preset.timeZone }]);
    updateConfig({ zones: next });
    setPicking(false);
  };

  const removeZone = (id: string): void => {
    updateConfig({ zones: zones.filter((zone) => zone.id !== id) });
  };

  return (
    <div className="@container flex h-full min-h-0 flex-col gap-2">
      {rows.length === 0 ? (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center">
          <EmptyState
            size="sm"
            icon={<GlobeIcon className="h-4 w-4" />}
            title="No time zones yet"
            description={
              canAdd
                ? 'Add a city to see its time, and the hours your working days share.'
                : 'Every time zone Intl knows is already on this clock.'
            }
          />
        </div>
      ) : (
        <ul className="min-h-0 flex-1 space-y-1.5 overflow-y-auto pr-0.5" aria-label="Time zones">
          {rows.map((row) => {
            const offset = offsetParts(row.offsetLabel);
            return (
              <li key={row.id} className="group/zone flex items-center gap-2 rounded-lg px-1 py-1 hover:bg-slate-50 dark:hover:bg-slate-800/60">
                <span
                  className={cn(
                    'h-1.5 w-1.5 shrink-0 rounded-full',
                    !row.valid
                      ? 'bg-slate-300 dark:bg-slate-600'
                      : row.businessHours
                        ? 'bg-emerald-500 dark:bg-emerald-400'
                        : 'bg-slate-300 dark:bg-slate-600',
                  )}
                  aria-hidden="true"
                />
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="flex items-center gap-1.5">
                    <span className="truncate text-xs font-semibold text-slate-700 dark:text-slate-200">
                      {row.label || zoneLabel(row.timeZone)}
                    </span>
                    {row.valid ? (
                      config.showDates ? (
                        <span className="shrink-0 rounded-full bg-slate-100 px-1.5 py-px text-[9px] font-medium text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                          {row.dayLabel}
                        </span>
                      ) : null
                    ) : (
                      <span className="shrink-0 rounded-full bg-rose-100 px-1.5 py-px text-[9px] font-semibold text-rose-600 dark:bg-rose-500/15 dark:text-rose-300">
                        Unknown zone
                      </span>
                    )}
                  </span>
                  <span className="flex items-baseline gap-1.5 truncate text-[10px] text-slate-400 dark:text-slate-500">
                    {row.valid ? (
                      row.offsetLabel === 'same time' ? (
                        <span className="truncate">{row.offsetLabel}</span>
                      ) : (
                        <>
                          <span className="truncate tabular-nums">
                            <span className={offset.sign ? TONE_TEXT.emerald : undefined}>{offset.sign}</span>
                            {offset.rest}
                          </span>
                          <span className="truncate">{viewerZone}</span>
                        </>
                      )
                    ) : (
                      <span className="truncate">Intl cannot resolve this time zone</span>
                    )}
                  </span>
                </div>
                <span
                  className={cn(
                    'shrink-0 text-sm font-semibold tabular-nums',
                    row.valid ? 'text-slate-900 dark:text-white' : 'text-slate-400 dark:text-slate-500',
                  )}
                >
                  {/* The ghost keeps the column width when a broken zone prints
                      its dash, so the list does not jitter. */}
                  {row.valid ? row.time : <span aria-hidden="true">--:--</span>}
                </span>
                {row.valid ? null : <span className="sr-only">Time unknown</span>}
                <IconButton
                  label={`Remove ${row.label || zoneLabel(row.timeZone)}`}
                  size="icon-sm"
                  variant="danger"
                  icon={<TrashIcon className="h-3.5 w-3.5" />}
                  className="shrink-0 opacity-0 transition focus-visible:opacity-100 group-hover/zone:opacity-100"
                  onClick={() => removeZone(row.id)}
                />
              </li>
            );
          })}
        </ul>
      )}

      {config.showOverlap && zones.length > 0 ? (
        <div className="shrink-0 border-t border-slate-100 pt-2 dark:border-slate-800">
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
            Working hours
          </p>
          <div
            className="flex h-9 items-end gap-px"
            role="img"
            aria-label={`Zones in office hours for each hour of your day in ${viewerZone}`}
          >
            {slots.map((slot) => (
              <span key={slot.hour} className="relative h-full flex-1">
                {slot.ratio > 0 ? (
                  <span
                    className="absolute inset-x-0 bottom-0 rounded-[2px]"
                    style={{ height: `${Math.round(slot.ratio * 100)}%`, backgroundColor: `rgb(${SLOT_RGB} / 0.55)` }}
                  />
                ) : null}
                {/* The viewer's own office hours get an underline, so "3 zones
                    available at 22:00" can be read against their own day. */}
                {slot.inBusiness ? (
                  <span
                    className="absolute inset-x-0 bottom-0 h-[3px] rounded-[2px]"
                    style={{ backgroundColor: `rgb(${HOUR_RGB} / 0.5)` }}
                  />
                ) : null}
              </span>
            ))}
          </div>
          <div className="mt-1 flex justify-between text-[9px] text-slate-400 tabular-nums dark:text-slate-500">
            {[0, 6, 12, 18, 23].map((hour) => (
              <span key={hour}>{String(hour).padStart(2, '0')}</span>
            ))}
          </div>
          <p className="mt-1 truncate text-[10px] text-slate-500 dark:text-slate-400">
            {best === null ? (
              'No hour of your day falls inside anyone’s working hours.'
            ) : best.available > 1 ? (
              <>
                Best overlap ·{' '}
                <span className="font-semibold tabular-nums text-slate-700 dark:text-slate-200">
                  {hourLabel(best.startHour)}–{hourLabel(best.endHour)}
                </span>{' '}
                ({best.available} zones)
              </>
            ) : (
              <>
                No shared window · busiest hour is{' '}
                <span className="font-semibold tabular-nums text-slate-700 dark:text-slate-200">
                  {hourLabel(best.startHour)}
                </span>{' '}
                with 1 zone
              </>
            )}
          </p>
        </div>
      ) : null}

      <div className="mt-auto flex shrink-0 items-center gap-2">
        {officeCount > 0 ? (
          <span className="flex items-center gap-1 text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden="true" />
            <span className="tabular-nums">{officeCount}</span> in office hours
          </span>
        ) : (
          <span className="text-[10px] text-slate-400 dark:text-slate-500">Nobody is at work</span>
        )}
        <span className="ml-auto truncate text-[10px] tabular-nums text-slate-400 dark:text-slate-500">
          Your time · {viewerTime} {viewerZone}
        </span>
      </div>

      {picking ? (
        <div className="flex shrink-0 items-center gap-2">
          <SelectInput
            aria-label="Add a time zone"
            className="h-8 px-2 py-1 text-xs"
            value=""
            autoFocus
            options={[
              { label: 'Choose a city…', value: '' },
              ...presets.map((preset) => ({ label: preset.label, value: preset.timeZone })),
            ]}
            onChange={(event) => {
              if (event.target.value !== '') addZone(event.target.value);
            }}
          />
          <Button size="sm" variant="ghost" onClick={() => setPicking(false)}>
            Cancel
          </Button>
        </div>
      ) : (
        <Button
          size="sm"
          variant="ghost"
          fullWidth
          disabled={!canAdd}
          icon={<PlusIcon className="h-3.5 w-3.5" />}
          onClick={() => setPicking(true)}
        >
          {zones.length === 0
            ? 'Add a time zone'
            : canAdd
              ? 'Add zone'
              : `All ${MAX_ZONES} zones used`}
        </Button>
      )}
    </div>
  );
}

export const worldClockWidget = defineWidget<WorldClockConfig>({
  type: 'worldclock',
  name: 'World clock',
  summary: 'Several time zones at once, with the hours they share.',
  category: 'utilities',
  keywords: ['time', 'timezone', 'clock', 'world', 'zones', 'meeting', 'overlap'],
  icon: GlobeIcon,
  accent: 'sky',
  defaultSize: { w: 3, h: 6, minW: 2, minH: 4 },
  defaultConfig: DEFAULT_CONFIG,
  settings: SETTINGS,
  summarize: (config) => {
    const zones = normalizeZones(config.zones);
    if (zones.length === 0) return 'No time zones';
    return zones
      .slice(0, 2)
      .map((zone) => zone.label)
      .join(', ');
  },
  component: WorldClockWidget,
});
