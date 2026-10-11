/**
 * Calendar model.
 *
 * The calendar widget keeps its dates inside its widget config — a local
 * `YYYY-MM-DD` plus a line of text — so the whole diary is a serialisable array
 * that survives an export, a template and the embedded single-file snapshot.
 *
 * This module holds the pure part. The month grid itself is not rebuilt here:
 * {@link buildMonth} wraps `monthMatrix` from `@/lib/time`, which already knows
 * how to align a six-week window to a week start and how to key its days, and
 * only decorates those cells with the day's events, the public holidays and the
 * accessible label. Public holidays arrive from `@/lib/holidays`; nothing here
 * touches the network or the DOM.
 *
 * Config is untrusted input (an import or a hand-edited file can hold anything),
 * so every entry point accepts `unknown` where a value comes from config and
 * repairs it rather than throwing.
 */
import { addMonths, dayKey, isoWeek, monthMatrix, parseDayKey, weekStartFor } from './time';
import { asString, createId, isRecord, truncate } from './utils';
import type { Holiday } from './holidays';

/** Most events one calendar may hold, so a runaway import cannot bloat storage. */
export const MAX_EVENTS = 200;

/** Longest event line, in characters. */
export const MAX_EVENT_TEXT = 120;

/** One dated line in the calendar. */
export interface CalendarEvent {
  id: string;
  /** Local `YYYY-MM-DD`. */
  date: string;
  text: string;
}

/** How the widget decides which day a week starts on. */
export type CalendarWeekStart = 'auto' | 'monday' | 'sunday';

/** `Intl` formatters are expensive to construct, so they are cached per locale. */
const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(locale: string | undefined, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${locale ?? ''}:${JSON.stringify(options)}`;
  const cached = formatters.get(key);
  if (cached) return cached;
  const created = new Intl.DateTimeFormat(locale, options);
  formatters.set(key, created);
  return created;
}

/** Collapse an event line to a single, trimmed line of at most {@link MAX_EVENT_TEXT}. */
function cleanText(value: unknown): string {
  return truncate(asString(value).replace(/\s+/g, ' ').trim(), MAX_EVENT_TEXT);
}

/**
 * Normalise whatever was loaded from storage into usable events.
 *
 * Entries are dropped when they have no readable date or no text to show, and a
 * duplicated id is replaced rather than allowed to collide in a React list.
 * The input is never mutated: the returned array and its events are fresh.
 */
export function normalizeEvents(value: unknown): CalendarEvent[] {
  if (!Array.isArray(value)) return [];

  const events: CalendarEvent[] = [];
  const seen = new Set<string>();

  for (const raw of value) {
    if (events.length >= MAX_EVENTS) break;
    if (!isRecord(raw)) continue;
    const date = parseDayKey(asString(raw.date));
    if (date === null) continue;
    const text = cleanText(raw.text);
    if (text === '') continue;

    const storedId = asString(raw.id).trim();
    const id = storedId === '' || seen.has(storedId) ? createId('event') : storedId;
    seen.add(id);
    events.push({ id, date: dayKey(date), text });
  }

  return events;
}

/**
 * Which day a week starts on: the explicit setting, or the locale's own answer
 * for `auto`. `weekStartFor` is the single source of that truth in the app.
 */
export function resolveWeekStart(setting: CalendarWeekStart, locale: string): 0 | 1 {
  if (setting === 'monday') return 1;
  if (setting === 'sunday') return 0;
  return weekStartFor(locale);
}

/** Group events by their day key, keeping the order they were added in. */
export function eventsByDate(events: readonly CalendarEvent[]): Map<string, CalendarEvent[]> {
  const byDate = new Map<string, CalendarEvent[]>();
  for (const event of events) {
    const bucket = byDate.get(event.date);
    if (bucket) bucket.push(event);
    else byDate.set(event.date, [event]);
  }
  return byDate;
}

/** The same reference, so a caller can tell that a mutation changed nothing. */
function unchanged(events: readonly CalendarEvent[]): CalendarEvent[] {
  return events as CalendarEvent[];
}

/**
 * Add an event on `date`.
 *
 * An unreadable date, an empty line or a full list leaves the array untouched
 * (same reference), which is how the widget knows there is nothing to persist.
 */
export function addEvent(events: readonly CalendarEvent[], date: string, text: string): CalendarEvent[] {
  if (events.length >= MAX_EVENTS) return unchanged(events);
  const parsed = parseDayKey(date);
  if (parsed === null) return unchanged(events);
  const clean = cleanText(text);
  if (clean === '') return unchanged(events);
  return [...events, { id: createId('event'), date: dayKey(parsed), text: clean }];
}

/**
 * Rewrite one event's text. An unknown id is a no-op; clearing the text removes
 * the event, because a line with nothing to show is not a line.
 */
export function updateEvent(events: readonly CalendarEvent[], id: string, text: string): CalendarEvent[] {
  const index = events.findIndex((event) => event.id === id);
  if (index === -1) return unchanged(events);
  const clean = cleanText(text);
  if (clean === '') return removeEvent(events, id);
  return events.map((event, at) => (at === index ? { ...event, text: clean } : event));
}

/** Remove one event. An unknown id leaves the array untouched. */
export function removeEvent(events: readonly CalendarEvent[], id: string): CalendarEvent[] {
  const next = events.filter((event) => event.id !== id);
  return next.length === events.length ? unchanged(events) : next;
}

/** A year and a 1-based month, the shape every other date helper here takes. */
export interface YearMonth {
  year: number;
  /** 1 = January. */
  month: number;
}

function wholeOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? Math.trunc(value) : fallback;
}

/**
 * Move `delta` months from a 1-based month, rolling the year over in both
 * directions — December + 1 is January of the next year, January − 1 is December
 * of the previous one.
 */
export function shiftMonth(year: number, month: number, delta: number): YearMonth {
  // Via a Date so the rollover is the calendar's, not arithmetic that has to
  // remember how many months a year has.
  const anchor = addMonths(new Date(wholeOr(year, 1970), wholeOr(month, 1) - 1, 1), wholeOr(delta, 0));
  return { year: anchor.getFullYear(), month: anchor.getMonth() + 1 };
}

/** Month and year, e.g. `February 2026`, in the given locale. */
export function monthTitle(year: number, month: number, locale?: string): string {
  return formatter(locale, { month: 'long', year: 'numeric' }).format(
    new Date(wholeOr(year, 1970), wholeOr(month, 1) - 1, 1),
  );
}

/**
 * Seven short weekday names, rotated so the first one is `weekStart`.
 *
 * The anchor week is 2024-01-07 (a Sunday), which makes the rotation exact
 * without depending on the runtime's own week-start guess.
 */
export function weekdayLabels(weekStart: 0 | 1, locale?: string): string[] {
  const start = weekStart === 0 ? 0 : 1;
  const format = formatter(locale, { weekday: 'short' });
  return Array.from({ length: 7 }, (_, index) => format.format(new Date(2024, 0, 7 + start + index)));
}

/** One rendered day of the month grid. */
export interface CalendarCell {
  /** Local `YYYY-MM-DD`. */
  key: string;
  day: number;
  /** `false` for the leading/trailing days borrowed from the neighbouring months. */
  inMonth: boolean;
  isToday: boolean;
  /** Saturday or Sunday, whichever week the grid starts on. */
  isWeekend: boolean;
  events: CalendarEvent[];
  holidays: Holiday[];
  /** Screen-reader label, e.g. `12 February 2026, 2 events, public holiday: Carnival`. */
  label: string;
}

export interface BuildMonthOptions {
  weekStart: 0 | 1;
  /** Today's local day key, so the grid can mark it. */
  today: string;
  events: Map<string, CalendarEvent[]>;
  holidays: Map<string, Holiday[]>;
  /**
   * BCP-47 tag for the label's date. Optional because the contract's options do
   * not carry a locale; the runtime's own locale is used when it is omitted.
   */
  locale?: string;
}

function cellLabel(
  date: Date,
  events: readonly CalendarEvent[],
  holidays: readonly Holiday[],
  locale: string | undefined,
): string {
  const parts = [formatter(locale, { day: 'numeric', month: 'long', year: 'numeric' }).format(date)];
  if (events.length === 1) parts.push('1 event');
  else if (events.length > 1) parts.push(`${events.length} events`);
  if (holidays.length === 1) parts.push(`public holiday: ${holidays[0].name}`);
  else if (holidays.length > 1) parts.push(`public holidays: ${holidays.map((holiday) => holiday.name).join(', ')}`);
  return parts.join(', ');
}

/**
 * The six-week grid for a month, decorated for rendering.
 *
 * `monthMatrix` always answers 42 cells, so the calendar never changes height;
 * the week numbers come from the ISO week of each row's first day, which keeps
 * them aligned with the rows whatever the week start is.
 */
export function buildMonth(
  year: number,
  month: number,
  options: BuildMonthOptions,
): { weekNumbers: number[]; weeks: CalendarCell[][] } {
  const matrix = monthMatrix(year, month, options.weekStart);

  const weeks = matrix.map((row) =>
    row.map((cell) => {
      const dayEvents = options.events.get(cell.key) ?? [];
      const dayHolidays = options.holidays.get(cell.key) ?? [];
      const weekday = cell.date.getDay();
      return {
        key: cell.key,
        day: cell.day,
        inMonth: cell.inMonth,
        isToday: cell.key === options.today,
        isWeekend: weekday === 0 || weekday === 6,
        events: dayEvents,
        holidays: dayHolidays,
        label: cellLabel(cell.date, dayEvents, dayHolidays, options.locale),
      };
    }),
  );

  return { weekNumbers: matrix.map((row) => isoWeek(row[0].date)), weeks };
}
