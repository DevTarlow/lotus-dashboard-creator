/**
 * Countdown model.
 *
 * The countdown widget keeps its events inside the widget config, so the whole
 * model is a serialisable list of dated events. This module holds the pure part:
 * repairing whatever was loaded from storage into usable events, resolving when
 * each event next happens, and describing the time that is left.
 *
 * Four decisions shape everything below.
 *
 * - **Annual events** repeat on their month/day, so the stored year is only the
 *   anchor for that month/day and the next occurrence is the first one still
 *   ahead. An all-day annual event stays on today's occurrence for the whole day
 *   (it *is* today); a timed one rolls over to next year as soon as its moment
 *   has passed, because then the party is over.
 * - **29 February**: in a year with no 29 February the event does not slide to
 *   28 February or 1 March — it waits for the next leap year. An annual
 *   29 February event is therefore a four-yearly countdown (eight-yearly around
 *   the non-leap century year 2100), which keeps the date honest instead of
 *   inventing one.
 * - **All-day events** resolve to local midnight of their day, so a remaining
 *   time of zero during that day means "today", not "passed". {@link
 *   CountdownRow.passed} is about the *day* being over: a timed event earlier
 *   today has happened, but it is still today.
 * - **Progress** for the ring needs a window, and an event carries no creation
 *   time. An annual event is measured from its previous occurrence to the next
 *   one; a one-off event gets a 30-day window ending on its date, so anything
 *   further out shows an empty ring until it enters that window.
 */
import { DAY_MS, dayKey, daysBetween, isValidDayKey, parseDayKey, startOfDay } from './time';
import { asBoolean, asString, clamp, createId, isRecord, truncate } from './utils';

/** Accent tones an event may carry (mirrors `AccentTone` from the UI kit). */
export type CountdownTone = 'violet' | 'sky' | 'amber' | 'emerald' | 'rose' | 'slate';

/** One dated event inside the widget config. */
export interface CountdownEvent {
  id: string;
  label: string;
  /** Local `YYYY-MM-DD` of the (next) occurrence, or of the original date for annual events. */
  date: string;
  /** Optional local `HH:mm`; absence means the event is all-day. */
  time: string | null;
  /** Annual events roll over to the next year once they have passed. */
  annual: boolean;
  tone: CountdownTone;
}

/** Normalised countdown widget config. */
export interface CountdownConfig {
  events: CountdownEvent[];
  showSeconds: boolean;
  showPast: boolean;
}

/** Hard cap on events — a longer list is a calendar, not a countdown. */
export const MAX_EVENTS = 12;

/** Longest label kept by {@link normalizeEvents}; anything longer is clipped. */
export const EVENT_LABEL_MAX = 60;

/** Every tone an event may use, in picker order. */
export const COUNTDOWN_TONES: readonly CountdownTone[] = ['violet', 'sky', 'amber', 'emerald', 'rose', 'slate'];

/** Tone given to events that arrive without a usable one. */
export const DEFAULT_COUNTDOWN_TONE: CountdownTone = 'violet';

export function isCountdownTone(value: unknown): value is CountdownTone {
  return COUNTDOWN_TONES.includes(value as CountdownTone);
}

/** `HH:mm`, 24-hour, exactly two digits each. */
const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

/**
 * How many years a rollover search may look ahead. Leap years can be eight
 * years apart (2096 → 2104, because 2100 is not a leap year), and one extra
 * step lets the annual rollover start from "last year" without a special case.
 */
const MAX_YEARS_AHEAD = 8;

/** Nominal progress window for a one-off event, in milliseconds. */
const ONE_OFF_PROGRESS_WINDOW_MS = 30 * DAY_MS;

interface TimeOfDay {
  hours: number;
  minutes: number;
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/** Parse `HH:mm` into its parts, or `null` for anything else (including `null`). */
function parseTime(value: string | null): TimeOfDay | null {
  if (value === null) return null;
  const match = TIME_PATTERN.exec(value.trim());
  if (!match) return null;
  return { hours: Number(match[1]), minutes: Number(match[2]) };
}

/**
 * `month`/`dayOfMonth` in `year`, at `time` or local midnight, or `null` when
 * that day does not exist in that year (29 February in a common year — `Date`
 * would silently roll it into 1 March).
 */
function occurrenceIn(year: number, month: number, dayOfMonth: number, time: TimeOfDay | null): Date | null {
  const date = new Date(year, month, dayOfMonth, time?.hours ?? 0, time?.minutes ?? 0, 0, 0);
  if (date.getFullYear() !== year || date.getMonth() !== month || date.getDate() !== dayOfMonth) return null;
  return date;
}

/* ------------------------------------------------------------ normalisation */

/** Persisted shape of one event, before repair. */
interface StoredEvent {
  id?: unknown;
  label?: unknown;
  date?: unknown;
  time?: unknown;
  annual?: unknown;
  tone?: unknown;
}

/** Repair one stored event, or `null` when it is beyond saving. */
function coerceEvent(value: unknown, seen: Set<string>): CountdownEvent | null {
  if (!isRecord(value)) return null;
  const source = value as StoredEvent;
  const label = truncate(asString(source.label).trim(), EVENT_LABEL_MAX);
  const date = asString(source.date).trim();
  // A countdown without a name or without a real date has nothing to render.
  if (label === '' || !isValidDayKey(date)) return null;

  const rawId = asString(source.id).trim();
  const id = rawId === '' || seen.has(rawId) ? createId('event') : rawId;
  seen.add(id);

  const rawTime = asString(source.time).trim();

  return {
    id,
    label,
    date,
    // An unusable time degrades to "all-day" rather than dropping the event.
    time: parseTime(rawTime) === null ? null : rawTime,
    annual: asBoolean(source.annual, false),
    tone: isCountdownTone(source.tone) ? source.tone : DEFAULT_COUNTDOWN_TONE,
  };
}

/**
 * Normalise any loaded value into a usable event list.
 *
 * Config is untrusted input (an import or a hand-edited file can hold anything),
 * so every field is validated: rubbish entries and events without a real
 * `YYYY-MM-DD` date are dropped, labels are clipped and trimmed, a malformed
 * `HH:mm` degrades to an all-day event, `annual` defaults to `false` and the
 * tone to {@link DEFAULT_COUNTDOWN_TONE}. Missing ids are generated and
 * duplicated ids are replaced, because ids are React keys and row identities;
 * two events that merely share a date are different events and both survive.
 * The result never exceeds {@link MAX_EVENTS} entries.
 */
export function normalizeEvents(value: unknown): CountdownEvent[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const events: CountdownEvent[] = [];
  for (const raw of value) {
    if (events.length >= MAX_EVENTS) break;
    const event = coerceEvent(raw, seen);
    if (event) events.push(event);
  }
  return events;
}

/* ---------------------------------------------------------------- occurrence */

/**
 * The instant an event is counted down to.
 *
 * Annual events roll over: the first matching month/day that is still ahead
 * wins. "Still ahead" means the whole day for an all-day event and the instant
 * itself for a timed one, which is what keeps an all-day anniversary on "Today"
 * all day. A stored year in the future is ignored — for an annual event only the
 * month/day carries meaning.
 *
 * An unparseable date (only reachable outside {@link normalizeEvents}) is
 * treated as today, so a hand-edited file renders as "Today" rather than
 * throwing.
 */
export function nextOccurrence(event: CountdownEvent, now: Date): Date {
  const anchor = parseDayKey(event.date);
  if (!anchor) return startOfDay(now);

  const time = parseTime(event.time);
  const month = anchor.getMonth();
  const dayOfMonth = anchor.getDate();
  const occurrence = (year: number): Date | null => occurrenceIn(year, month, dayOfMonth, time);

  if (!event.annual) return occurrence(anchor.getFullYear()) ?? anchor;

  const isOver = (instant: Date): boolean =>
    time ? instant.getTime() <= now.getTime() : dayKey(instant) < dayKey(now);

  for (let offset = 0; offset <= MAX_YEARS_AHEAD; offset += 1) {
    const candidate = occurrence(now.getFullYear() + offset);
    if (candidate && !isOver(candidate)) return candidate;
  }
  // Unreachable for a real month/day; the anchor keeps the widget honest.
  return anchor;
}

/** Whole calendar days from `now` to the event's next occurrence (negative once a one-off is past). */
export function daysUntilEvent(event: CountdownEvent, now: Date): number {
  return daysBetween(now, nextOccurrence(event, now)) ?? 0;
}

/** The occurrence one year — or, for 29 February, one leap year — before `target`. */
function previousAnnualOccurrence(target: Date): Date {
  const time: TimeOfDay = { hours: target.getHours(), minutes: target.getMinutes() };
  for (let years = 1; years <= MAX_YEARS_AHEAD + 1; years += 1) {
    const candidate = occurrenceIn(target.getFullYear() - years, target.getMonth(), target.getDate(), time);
    if (candidate) return candidate;
  }
  return new Date(target.getTime() - DAY_MS);
}

/* -------------------------------------------------------------------- rows */

export interface CountdownRow {
  event: CountdownEvent;
  /** The instant being counted down to. */
  target: Date;
  /** Milliseconds until the target; 0 once it is in the past. */
  remainingMs: number;
  /** Human countdown, e.g. "12d 4h 09m" / "3h 20m 05s" / "Today". */
  label: string;
  /** 0…1 progress from the previous occurrence to `target`, for the ring. */
  progress: number;
  /** True while the event is happening today (or its instant has passed and it is not annual). */
  isToday: boolean;
  passed: boolean;
}

function buildRow(event: CountdownEvent, now: Date, showSeconds: boolean): CountdownRow {
  const target = nextOccurrence(event, now);
  const remainingMs = Math.max(0, target.getTime() - now.getTime());
  const days = daysUntilEvent(event, now);
  const isToday = days === 0;
  // `passed` is about the day being over: an event later today, or one whose
  // time has gone today, is still "Today" and stays visible.
  const passed = !isToday && remainingMs === 0;

  const start = event.annual
    ? previousAnnualOccurrence(target)
    : new Date(target.getTime() - ONE_OFF_PROGRESS_WINDOW_MS);
  const span = target.getTime() - start.getTime();
  const progress = span <= 0 ? 1 : clamp((now.getTime() - start.getTime()) / span, 0, 1);

  return {
    event,
    target,
    remainingMs,
    label: isToday && remainingMs === 0 ? 'Today' : formatCountdown(remainingMs, showSeconds),
    progress,
    isToday,
    passed,
  };
}

/**
 * Build the display rows: soonest first, and — when `showPast` is on — the
 * events whose day is over after them, most recent first.
 *
 * `showPast: false` hides past events but keeps today's, however late in the day
 * it is. `showSeconds` only shapes {@link CountdownRow.label}; it defaults to
 * `true` so a caller that only cares about ordering can ignore it.
 */
export function countdownRows(
  events: readonly CountdownEvent[],
  now: Date,
  options: { showPast: boolean; showSeconds?: boolean },
): CountdownRow[] {
  const showSeconds = options.showSeconds ?? true;
  const rows: CountdownRow[] = [];
  for (const event of events) {
    // Only reachable for a config that skipped the normaliser.
    if (!isValidDayKey(event.date)) continue;
    const row = buildRow(event, now, showSeconds);
    if (!options.showPast && row.passed) continue;
    rows.push(row);
  }

  const upcoming = rows.filter((row) => !row.passed).sort((a, b) => a.target.getTime() - b.target.getTime());
  const past = rows.filter((row) => row.passed).sort((a, b) => b.target.getTime() - a.target.getTime());
  return [...upcoming, ...past];
}

/* --------------------------------------------------------------- formatting */

/**
 * Human countdown.
 *
 * Never renders a zeroed-out "0d 0h 0m 0s": anything already due is "Passed",
 * and the last minute is "Less than a minute" instead of a jittery per-second
 * countdown. `showSeconds` decides whether seconds appear at all once a minute
 * or more is left; beyond a day they are dropped either way, because a
 * day-scale countdown does not need them.
 */
export function formatCountdown(ms: number, showSeconds: boolean): string {
  if (!Number.isFinite(ms) || ms <= 0) return 'Passed';
  const total = Math.floor(ms / 1000);
  if (total < 60) return 'Less than a minute';

  const days = Math.floor(total / 86_400);
  const hours = Math.floor((total % 86_400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;

  if (days > 0) return `${days}d ${hours}h ${pad(minutes)}m`;
  if (hours > 0) {
    return showSeconds ? `${hours}h ${pad(minutes)}m ${pad(seconds)}s` : `${hours}h ${pad(minutes)}m`;
  }
  return showSeconds ? `${minutes}m ${pad(seconds)}s` : `${minutes}m`;
}

/** Compact two-line countdown for the centre of a {@link Ring}. */
export interface CountdownParts {
  /** Large first line: `12d`, `4h`, `20m`, `<1m` or `Passed`. */
  primary: string;
  /** Smaller second line holding the next two units, empty when there is nothing useful to add. */
  secondary: string;
}

/**
 * Split a countdown for the ring centre: days on the first line with hours and
 * minutes below, then hours, then minutes — the same units as
 * {@link formatCountdown}, but shaped for a small circle.
 */
export function formatCountdownParts(ms: number, showSeconds: boolean): CountdownParts {
  if (!Number.isFinite(ms) || ms <= 0) return { primary: 'Passed', secondary: '' };
  const total = Math.floor(ms / 1000);
  const days = Math.floor(total / 86_400);
  const hours = Math.floor((total % 86_400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;

  if (days > 0) return { primary: `${days}d`, secondary: `${hours}h ${pad(minutes)}m` };
  if (hours > 0) {
    return { primary: `${hours}h`, secondary: showSeconds ? `${pad(minutes)}m ${pad(seconds)}s` : `${pad(minutes)}m` };
  }
  if (minutes > 0) return { primary: `${minutes}m`, secondary: showSeconds ? `${pad(seconds)}s` : '' };
  return { primary: '<1m', secondary: '' };
}

/* ----------------------------------------------------------------- mutators */

/**
 * Append an event with a fresh id. The list is capped at {@link MAX_EVENTS};
 * adding to a full list is a no-op that returns the input unchanged.
 */
export function addEvent(events: readonly CountdownEvent[], event: Omit<CountdownEvent, 'id'>): CountdownEvent[] {
  if (events.length >= MAX_EVENTS) return events as CountdownEvent[];
  return [...events, { ...event, id: createId('event') }];
}

/** Remove one event. An unknown id returns the input unchanged. */
export function removeEvent(events: readonly CountdownEvent[], id: string): CountdownEvent[] {
  const next = events.filter((event) => event.id !== id);
  return next.length === events.length ? (events as CountdownEvent[]) : next;
}

/** Patch one event, keeping its id. An unknown id returns the input unchanged. */
export function updateEvent(
  events: readonly CountdownEvent[],
  id: string,
  patch: Partial<Omit<CountdownEvent, 'id'>>,
): CountdownEvent[] {
  let changed = false;
  const next = events.map((event) => {
    if (event.id !== id) return event;
    changed = true;
    return { ...event, ...patch, id: event.id };
  });
  return changed ? next : (events as CountdownEvent[]);
}
