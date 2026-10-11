/**
 * Calendar and clock arithmetic.
 *
 * Every date-shaped widget (calendar, countdown, habits, tasks, timer, world
 * clock) needs the same handful of operations, and the naive versions of them are
 * subtly wrong: `toISOString()` reports a UTC day rather than the user's, a
 * millisecond division calls a 23-hour day "not a day", and `setMonth` overflows
 * from 31 January into March. The helpers here are the correct versions, kept
 * pure and unit tested so the widgets can stay thin.
 *
 * Day keys are the app's interchange format for "a date without a time":
 * `YYYY-MM-DD` in the **local** calendar, which is what a user means by "today".
 */

/** Milliseconds in a nominal day. Never use it to count calendar days — use {@link daysBetween}. */
export const DAY_MS = 86_400_000;

/** Synodic-ish helpers such as week numbers need the ISO week start: Monday. */
const DEFAULT_WEEK_START = 1 as const;

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/** Midnight at the start of the given instant's local day. */
export function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/** Add whole calendar days, immune to DST shifts. */
export function addDays(date: Date, days: number): Date {
  const next = startOfDay(date);
  next.setDate(next.getDate() + days);
  return next;
}

/** Local `YYYY-MM-DD` key for an instant. */
export function dayKey(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** `true` for a well-formed, real calendar date key. */
export function isValidDayKey(key: string): boolean {
  return parseDayKey(key) !== null;
}

/**
 * Parse a `YYYY-MM-DD` key into local midnight, or `null` when the key is
 * malformed or names a date that does not exist (2026-02-30).
 */
export function parseDayKey(key: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(year, month - 1, day);
  // Rejects overflow such as 31 February, which `Date` would roll forward.
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return date;
}

/** `dayKey` for a key or instant, so callers can accept either. */
export function toDayKey(value: string | Date): string | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : dayKey(value);
  return isValidDayKey(value) ? value : null;
}

/** Calendar days from `from` to `to`; negative when `to` is in the past. */
export function daysBetween(from: string | Date, to: string | Date): number | null {
  const startKey = toDayKey(from);
  const endKey = toDayKey(to);
  if (!startKey || !endKey) return null;
  const [sy, sm, sd] = startKey.split('-').map(Number);
  const [ey, em, ed] = endKey.split('-').map(Number);
  // UTC midnight on purpose: the difference of two calendar dates is a whole
  // number of days even when the local day in between was 23 or 25 hours long.
  return Math.round((Date.UTC(ey, em - 1, ed) - Date.UTC(sy, sm - 1, sd)) / DAY_MS);
}

/** Whole calendar days until `target` from `from` (default: now). */
export function daysUntil(target: string | Date, from: string | Date = new Date()): number | null {
  return daysBetween(from, target);
}

/** Midnight on the first day of the month. */
export function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

/** Add whole months, always landing on the first of the month. */
export function addMonths(date: Date, months: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + months, 1);
}

/** Days in a month (1-based month, so `2026, 2` is February). */
export function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

export interface MonthCell {
  /** Local `YYYY-MM-DD`. */
  key: string;
  date: Date;
  /** Day of the month. */
  day: number;
  /** `false` for the leading/trailing days borrowed from the neighbouring months. */
  inMonth: boolean;
}

/**
 * A six-row, seven-column month grid, aligned to `weekStart` (0 = Sunday,
 * 1 = Monday). Always 42 cells, so the calendar never changes height.
 */
export function monthMatrix(year: number, month: number, weekStart: number = DEFAULT_WEEK_START): MonthCell[][] {
  const first = new Date(year, month - 1, 1);
  const offset = (first.getDay() - (weekStart === 0 ? 0 : 1) + 7) % 7;
  const start = addDays(first, -offset);

  const weeks: MonthCell[][] = [];
  for (let week = 0; week < 6; week += 1) {
    const row: MonthCell[] = [];
    for (let day = 0; day < 7; day += 1) {
      const date = addDays(start, week * 7 + day);
      row.push({
        key: dayKey(date),
        date,
        day: date.getDate(),
        inMonth: date.getMonth() === month - 1 && date.getFullYear() === year,
      });
    }
    weeks.push(row);
  }
  return weeks;
}

/** ISO-8601 week number (weeks start on Monday; week 1 contains the first Thursday). */
export function isoWeek(date: Date): number {
  const target = startOfDay(date);
  // Thursday of the same ISO week decides the year.
  target.setDate(target.getDate() + 3 - ((target.getDay() + 6) % 7));
  const firstThursday = new Date(target.getFullYear(), 0, 4);
  firstThursday.setDate(firstThursday.getDate() + 3 - ((firstThursday.getDay() + 6) % 7));
  return 1 + Math.round((target.getTime() - firstThursday.getTime()) / (7 * DAY_MS));
}

/**
 * First day of the week for a locale: 0 = Sunday, 1 = Monday.
 * Falls back to Monday when the runtime does not expose `Intl.Locale.weekInfo`.
 */
export function weekStartFor(locale: string): 0 | 1 {
  try {
    const info = (new Intl.Locale(locale) as Intl.Locale & { weekInfo?: { firstDay?: number } }).weekInfo;
    if (info?.firstDay === 7) return 0;
    if (typeof info?.firstDay === 'number') return 1;
  } catch {
    // Unknown locale tag: the default below is the safe answer.
  }
  return DEFAULT_WEEK_START;
}

/**
 * Offset of `timeZone` from UTC in minutes at the given instant, DST included.
 *
 * Derived by formatting the instant in the target zone and reading the wall clock
 * back as if it were UTC — no `Intl.DateTimeFormat` short-offset support needed.
 */
export function zoneOffsetMinutes(date: Date, timeZone: string): number {
  if (timeZone === 'UTC' || timeZone === 'Etc/UTC') return 0;
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).formatToParts(date);
    const read = (type: Intl.DateTimeFormatPartTypes): number => {
      const value = parts.find((part) => part.type === type)?.value;
      return value === undefined ? 0 : Number(value);
    };
    const asUtc = Date.UTC(
      read('year'),
      read('month') - 1,
      read('day'),
      read('hour') % 24,
      read('minute'),
      read('second'),
    );
    return Math.round((asUtc - date.getTime()) / 60_000);
  } catch {
    return 0;
  }
}

/** Compact duration, e.g. `2h 05m`, `5m 03s`, `42s`. Negatives clamp to zero. */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(Number.isFinite(ms) ? ms / 1000 : 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours > 0) return `${hours}h ${pad(minutes)}m`;
  if (minutes > 0) return `${minutes}m ${pad(seconds)}s`;
  return `${seconds}s`;
}

/** Clock-style duration: `1:05:09` above an hour, `05:09` below it. */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(Number.isFinite(ms) ? ms / 1000 : 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours > 0) return `${hours}:${pad(minutes)}:${pad(seconds)}`;
  return `${pad(minutes)}:${pad(seconds)}`;
}

/** Label for a whole-day distance: "Today", "Tomorrow", "in 5 days", "3 days ago". */
export function relativeDayLabel(days: number): string {
  if (days === 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  if (days === -1) return 'Yesterday';
  if (days > 1) return `in ${days} days`;
  return `${Math.abs(days)} days ago`;
}

/** Signed offset label, e.g. `+3h`, `−5:30`, `same time`. */
export function formatOffset(minutes: number): string {
  if (minutes === 0) return 'same time';
  const sign = minutes > 0 ? '+' : '−';
  const total = Math.abs(minutes);
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  if (rest === 0) return `${sign}${hours}h`;
  if (hours === 0) return `${sign}${rest}m`;
  return `${sign}${hours}:${pad(rest)}`;
}
