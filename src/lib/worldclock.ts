/**
 * World clock model.
 *
 * A world clock is one question asked several times: *what time is it there,
 * and is anybody in?* Everything that answers it — validating a zone, turning a
 * stretch of zones into clock rows, counting how many offices are open at each
 * hour of the viewer's day — lives here, pure and unit tested, so the widget is
 * only layout.
 *
 * Two rules shape the module:
 *
 * - **Zones are untrusted input.** They arrive from an exported JSON file, a
 *   hand-edited snapshot or the settings form, so every entry is put through
 *   {@link isValidTimeZone} before it is used. `Intl` throws a `RangeError` on
 *   rubbish, and a widget must not throw while drawing.
 * - **The maths is borrowed, not copied.** {@link zoneOffsetMinutes},
 *   {@link dayKey} and {@link formatOffset} already implement the DST-correct
 *   versions; a second implementation would disagree with the first one day a
 *   year and nobody would notice until then.
 *
 * The "day" of every row is deliberately the viewer's own day (`dayKey`), not a
 * UTC one: "Tokyo is already on tomorrow" is only true relative to the person
 * reading the widget.
 */
import { dayKey, daysBetween, formatOffset, zoneOffsetMinutes } from './time';
import { asString, createId, isRecord } from './utils';

/** Hard cap on rows, so a runaway import cannot fill the widget. */
export const MAX_ZONES = 8;

/**
 * Curated cities offered by the in-widget picker.
 *
 * A short, ordered list beats the 400+ entry IANA database: every one of these
 * is a city someone actually schedules a call with, and each label is the city
 * rather than the region.
 */
export const ZONE_PRESETS: readonly { label: string; timeZone: string }[] = [
  { label: 'UTC', timeZone: 'UTC' },
  { label: 'London', timeZone: 'Europe/London' },
  { label: 'Berlin', timeZone: 'Europe/Berlin' },
  { label: 'Lisbon', timeZone: 'Europe/Lisbon' },
  { label: 'New York', timeZone: 'America/New_York' },
  { label: 'Chicago', timeZone: 'America/Chicago' },
  { label: 'Denver', timeZone: 'America/Denver' },
  { label: 'Los Angeles', timeZone: 'America/Los_Angeles' },
  { label: 'São Paulo', timeZone: 'America/Sao_Paulo' },
  { label: 'Dubai', timeZone: 'Asia/Dubai' },
  { label: 'Kolkata', timeZone: 'Asia/Kolkata' },
  { label: 'Singapore', timeZone: 'Asia/Singapore' },
  { label: 'Tokyo', timeZone: 'Asia/Tokyo' },
  { label: 'Sydney', timeZone: 'Australia/Sydney' },
];

/** One clock face: a city the user wants to keep an eye on. */
export interface ClockZone {
  id: string;
  label: string;
  timeZone: string;
}

/**
 * The widget's stored config.
 *
 * Declared here rather than next to the component so the lib is the one place a
 * change to the shape has to be made — the component only renders it.
 */
export type WorldClockConfig = {
  zones: ClockZone[];
  hour12: boolean;
  workStart: number;
  workEnd: number;
  showOverlap: boolean;
  showDates: boolean;
};

type TimeZoneStyle = 'clock' | 'calendar' | 'hour';

/**
 * Creating `Intl` formatters is expensive and {@link overlapSlots} asks for 24
 * walls of clock per zone, so they are cached by zone + style.
 */
const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string, style: TimeZoneStyle, hour12: boolean): Intl.DateTimeFormat {
  const key = `${timeZone}|${style}|${hour12 ? '12' : '24'}`;
  const cached = formatterCache.get(key);
  if (cached) return cached;

  const options: Intl.DateTimeFormatOptions =
    style === 'calendar'
      ? { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit' }
      : style === 'hour'
        ? { timeZone, hourCycle: 'h23', hour: '2-digit', minute: '2-digit' }
        : hour12
        ? // No explicit `dayPeriod`: asking for one makes current ICU emit its
          // flexible period ("in the morning") instead of "AM"/"PM".
          { timeZone, hour12: true, hour: 'numeric', minute: '2-digit' }
        : { timeZone, hourCycle: 'h23', hour: '2-digit', minute: '2-digit' };

  const created = new Intl.DateTimeFormat('en-US', options);
  formatterCache.set(key, created);
  return created;
}

/** The zone `Intl` would use for the person reading the widget. */
function systemTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/**
 * `true` when `Intl` can resolve the zone. Never throws, whatever it is handed:
 * a stored zone can be a number, an empty string or a deleted IANA id.
 */
export function isValidTimeZone(timeZone: string): boolean {
  if (typeof timeZone !== 'string' || timeZone.trim() === '') return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format(0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Normalise a stored zone list: drop entries `Intl` cannot resolve, de-duplicate
 * by zone, repair missing ids and labels, and cap the list at {@link MAX_ZONES}.
 *
 * Non-array input (a hand-edited file, an older config) yields an empty list
 * rather than a throw; the widget shows its "add a zone" state from there.
 */
export function normalizeZones(value: unknown): ClockZone[] {
  if (!Array.isArray(value)) return [];

  const zones: ClockZone[] = [];
  const seenIds = new Set<string>();
  const seenZones = new Set<string>();

  for (const entry of value) {
    if (zones.length >= MAX_ZONES) break;
    if (!isRecord(entry)) continue;

    const timeZone = asString(entry.timeZone).trim();
    // A zone with no name is nothing we can draw; a valid one is mandatory.
    if (timeZone === '' || seenZones.has(timeZone) || !isValidTimeZone(timeZone)) continue;
    seenZones.add(timeZone);

    const label = asString(entry.label).trim() || zoneLabel(timeZone);
    const id = asString(entry.id).trim();
    const uniqueId = id === '' || seenIds.has(id) ? createId('zone') : id;
    seenIds.add(uniqueId);

    zones.push({ id: uniqueId, label, timeZone });
  }

  return zones;
}

/** Display name for a zone id: `Europe/Berlin` → `Berlin`, `UTC` stays `UTC`. */
export function zoneLabel(timeZone: string): string {
  const trimmed = timeZone.trim();
  if (trimmed === '') return 'Unknown zone';
  const tail = trimmed.split('/').pop() ?? trimmed;
  return tail.replace(/_/g, ' ');
}

/** Wall clock in a zone, composed from parts so `en-US` cannot reorder it. */
function wallClock(now: Date, timeZone: string, hour12: boolean): string {
  const parts = formatter(timeZone, 'clock', hour12).formatToParts(now);
  const read = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? '';
  const time = `${read('hour')}:${read('minute')}`;
  const period = read('dayPeriod');
  return hour12 && period !== '' ? `${time} ${period.toUpperCase()}` : time;
}

/** Local calendar day in a zone, as a `dayKey` the date helpers understand. */
function zoneDayKey(now: Date, timeZone: string): string {
  const parts = formatter(timeZone, 'calendar', false).formatToParts(now);
  const read = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? '';
  return `${read('year')}-${read('month')}-${read('day')}`;
}

/** Local hour 0…23 in a zone; the DST-safe way to ask "what time is it there". */
function zoneHour(now: Date, timeZone: string): number {
  const parts = formatter(timeZone, 'hour', false).formatToParts(now);
  const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? '0');
  return Number.isFinite(hour) ? ((Math.trunc(hour) % 24) + 24) % 24 : 0;
}

/** One clock face, ready to render. */
export interface ZoneRow {
  id: string;
  label: string;
  timeZone: string;
  valid: boolean;
  /** Formatted wall-clock time, e.g. "14:05" or "2:05 pm". */
  time: string;
  /** "Today" / "Tomorrow" / "Yesterday" relative to the viewer's local day. */
  dayLabel: string;
  /** Minutes ahead of the viewer's own zone, DST included. */
  offsetMinutes: number;
  /** `formatOffset` output, e.g. "+3h", "−5h", "same time". */
  offsetLabel: string;
  /** Local hour 0…23 in that zone, for the availability strip. */
  localHour: number;
  /** True when `localHour` sits inside `workStart`…`workEnd`. */
  businessHours: boolean;
}

/**
 * Build one row per zone at the given instant.
 *
 * A zone `Intl` cannot resolve keeps its place in the list with `valid: false`
 * and an empty time, so the user can see *which* zone is broken and remove it
 * instead of watching a made-up clock.
 */
export function zoneRows(
  zones: readonly ClockZone[],
  now: Date,
  options: { hour12: boolean; workStart: number; workEnd: number },
): ZoneRow[] {
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) return [];

  const start = wholeHour(options.workStart, 9);
  const end = wholeHour(options.workEnd, 17);
  const viewerOffset = zoneOffsetMinutes(now, systemTimeZone());
  const viewerDay = dayKey(now);

  return zones.map((zone) => {
    if (!isValidTimeZone(zone.timeZone)) {
      return {
        id: zone.id,
        label: zone.label,
        timeZone: zone.timeZone,
        valid: false,
        time: '',
        dayLabel: 'Today',
        offsetMinutes: 0,
        offsetLabel: '',
        localHour: 0,
        businessHours: false,
      };
    }

    const offsetMinutes = zoneOffsetMinutes(now, zone.timeZone) - viewerOffset;
    const localHour = zoneHour(now, zone.timeZone);
    const dayOffset = daysBetween(viewerDay, zoneDayKey(now, zone.timeZone)) ?? 0;

    return {
      id: zone.id,
      label: zone.label,
      timeZone: zone.timeZone,
      valid: true,
      time: wallClock(now, zone.timeZone, options.hour12),
      dayLabel: dayOffsetLabel(dayOffset),
      offsetMinutes,
      offsetLabel: formatOffset(offsetMinutes),
      localHour,
      businessHours: isBusinessHour(localHour, start, end),
    };
  });
}

/** Whole hours only, clamped to a day; junk input falls back to the default. */
function wholeHour(value: number, fallback: number): number {
  const hour = Number.isFinite(value) ? Math.trunc(value) : fallback;
  return Math.min(23, Math.max(0, hour));
}

/** Content of the "today" chip, relative to the viewer's own day. */
export function dayOffsetLabel(offsetDays: number): string {
  if (offsetDays === 0) return 'Today';
  if (offsetDays === 1) return 'Tomorrow';
  if (offsetDays === -1) return 'Yesterday';
  const days = Math.abs(offsetDays);
  return offsetDays > 0 ? `in ${days} days` : `${days} days ago`;
}

/**
 * `true` when a local time is inside the working window.
 *
 * The window wraps when `end` is at or before `start` (22:00 → 06:00 is the
 * night shift), and the end hour itself is outside the window: 17:00 → 09:00 is
 * eight hours of work, which is what "9 to 5" means everywhere.
 */
export function isBusinessHour(localHour: number, workStart: number, workEnd: number): boolean {
  return isBusinessMinute(
    Number.isFinite(localHour) ? localHour * 60 : 0,
    wholeHour(workStart, 9) * 60,
    wholeHour(workEnd, 17) * 60,
  );
}

/**
 * The minute-precision core of {@link isBusinessHour}.
 *
 * Working in minutes rather than hours is what keeps the half-hour zones honest:
 * in Kolkata (+05:30) the viewer's 17:00 is 22:30 local, and rounding that to the
 * hour would open or close an office half an hour early. Minutes wrap past
 * midnight exactly the way the hour version does.
 */
export function isBusinessMinute(localMinute: number, startMinute: number, endMinute: number): boolean {
  if (startMinute === endMinute) return false;
  const minute = (((localMinute % 1440) + 1440) % 1440) | 0;
  if (startMinute < endMinute) return minute >= startMinute && minute < endMinute;
  return minute >= startMinute || minute < endMinute;
}

/** One hour of the viewer's day, with the offices open during it. */
export interface OverlapSlot {
  hour: number;
  available: number;
  ratio: number;
  inBusiness: boolean;
}

/**
 * How many zones are inside their own office hours at each hour of the
 * *viewer's* day — the "when can we all talk?" strip.
 *
 * The slot index is the viewer's local hour, which is the only frame both a
 * scheduler and the reader share. An unresolvable zone is skipped rather than
 * counted as either open or closed.
 */
export function overlapSlots(
  zones: readonly ClockZone[],
  now: Date,
  workStart: number,
  workEnd: number,
): OverlapSlot[] {
  const usable = zones.filter((zone) => isValidTimeZone(zone.timeZone));
  const viewerOffset = zoneOffsetMinutes(now, systemTimeZone());
  const startMinute = wholeHour(workStart, 9) * 60;
  const endMinute = wholeHour(workEnd, 17) * 60;

  /**
   * Instant of the viewer's local hour. Going through UTC arithmetic keeps the
   * hour labels on the viewer's wall clock even on the two days a year their own
   * midnight is not six hours before their noon.
   */
  const hourInstant = (hour: number): Date =>
    new Date(new Date(now.getTime() + viewerOffset * 60_000).setUTCHours(hour, 0, 0, 0) - viewerOffset * 60_000);

  // One probe per zone covers 364 days of the year; a zone that changes offset
  // *during* this day (the DST switch) is re-probed per slot, because an office
  // open at 16:00 is exactly the thing a stale offset gets wrong.
  const localMinutes = usable.map((zone) => {
    const first = zoneOffsetMinutes(hourInstant(0), zone.timeZone);
    const last = zoneOffsetMinutes(hourInstant(23), zone.timeZone);
    return (hour: number): number =>
      hour * 60 + (first === last ? first : zoneOffsetMinutes(hourInstant(hour), zone.timeZone));
  });

  return Array.from({ length: 24 }, (_, hour) => {
    let available = 0;
    for (const localMinute of localMinutes) {
      if (isBusinessMinute(localMinute(hour), startMinute, endMinute)) available += 1;
    }
    return {
      hour,
      available,
      ratio: usable.length === 0 ? 0 : available / usable.length,
      inBusiness: isBusinessMinute(hour * 60, startMinute, endMinute),
    };
  });
}

/**
 * Longest contiguous run of hours that fit the most people, as whole viewer
 * hours: `{ startHour: 14, endHour: 17, available: 3 }` reads "14:00–17:00".
 *
 * `null` only when there is nothing to report at all (an empty strip), because
 * the widget has to be able to say "no shared window" rather than print a
 * one-zone "window": with a peak of 1 the best run *is* that lone zone's own
 * office hours, which is a useful thing to show, not an overlap.
 */
export function bestOverlap(
  slots: readonly OverlapSlot[],
): { startHour: number; endHour: number; available: number } | null {
  if (slots.length === 0) return null;
  const peak = Math.max(...slots.map((slot) => slot.available));
  if (peak <= 0) return null;

  let best: { startHour: number; endHour: number; available: number } | null = null;
  let bestLength = 0;
  let index = 0;
  while (index < slots.length) {
    if (slots[index].available !== peak) {
      index += 1;
      continue;
    }
    const start = index;
    while (index < slots.length && slots[index].available === peak) index += 1;
    const length = index - start;
    // A longer run wins; a tie keeps the earlier, which is the one the reader
    // scans first.
    if (length > bestLength) {
      bestLength = length;
      best = { startHour: slots[start].hour, endHour: slots[index - 1].hour + 1, available: peak };
    }
  }
  return best;
}
