/**
 * Habit model.
 *
 * A habit is a weekly schedule plus a log of the days it was actually done. The
 * widget keeps both inside its config, so the existing dashboard persistence
 * (localStorage, exports and the embedded single-file snapshot) carries them with
 * no extra storage layer. This module holds the pure part — normalising whatever
 * was loaded, ticking a day off, and the streak/rate arithmetic — leaving the
 * component with rendering and local drafts only.
 *
 * Two rules decide every number in here:
 *
 * - **Scheduled days only.** `daily` counts every day, `weekdays` Monday–Friday
 *   and `custom` the `Date#getDay()` values in `days`. An **empty `days` list on
 *   a `custom` habit means "never scheduled"**, not "every day": a schedule the
 *   user has not filled in yet must not invent a streak out of nothing, so every
 *   function here treats such a habit as having no scheduled days at all. A
 *   logged day the habit was not scheduled on is ignored too — the schedule says
 *   what counts, the log says what happened.
 * - **Today is never a miss yet.** A scheduled day that has not been ticked off
 *   today is *pending*: it neither counts towards the current streak nor breaks
 *   it. Ticking it off afterwards extends the streak by one.
 *
 * Days are walked with `addDays`/`dayKey` from `@/lib/time`, never by adding
 * milliseconds, because a local day is 23 or 25 hours long twice a year and a
 * naive loop would lose (or double) a day across a DST change.
 *
 * Pure: no React, no DOM, no network — and unit tested next door.
 */
import { addDays, dayKey, daysBetween, isValidDayKey, parseDayKey, startOfDay } from './time';
import { asBoolean, asNumber, asString, clamp, createId, isRecord } from './utils';

/** Most habits one widget holds. */
export const MAX_HABITS = 12;

/** Most days one habit's log holds — a bit over a year of a daily habit. */
export const MAX_LOG_DAYS = 400;

/** Longest habit name kept, in characters. */
export const HABIT_NAME_MAX = 60;

/**
 * Longest emoji kept, in code points. One is the common case; two allows a flag
 * or an emoji with a variation selector without letting a paste fill the row.
 */
export const HABIT_EMOJI_MAX = 2;

/** Weeks the grid may show, and the default ("a four-week grid"). */
export const MIN_WEEKS = 2;
export const MAX_WEEKS = 12;
export const DEFAULT_WEEKS = 4;

export type HabitSchedule = 'daily' | 'weekdays' | 'custom';

export const HABIT_SCHEDULES: readonly HabitSchedule[] = ['daily', 'weekdays', 'custom'];

export function isHabitSchedule(value: unknown): value is HabitSchedule {
  return HABIT_SCHEDULES.includes(value as HabitSchedule);
}

/** One habit: what it is called and which days it was done. */
export type Habit = {
  id: string;
  name: string;
  /** Single character or short glyph shown next to the name; may be ''. */
  emoji: string;
  schedule: HabitSchedule;
  /** `Date#getDay()` values (0 = Sunday) that count, when `schedule` is 'custom'. */
  days: number[];
  /** Local `YYYY-MM-DD` keys of the days this habit was done, newest last. */
  log: string[];
};

/** Normalised habits widget config. */
export type HabitsConfig = { habits: Habit[]; weeks: number; showHeatmap: boolean };

/* ------------------------------------------------------------------ helpers */

const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
const MONTH_SHORT = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

/** A weekday and date a person can read, e.g. `Mon 9 Feb`. */
function dayLabel(date: Date): string {
  return `${WEEKDAY_SHORT[date.getDay()]} ${date.getDate()} ${MONTH_SHORT[date.getMonth()]}`;
}

/** Trim a name, collapse its whitespace and cap its length. */
function normalizeName(value: unknown): string {
  return asString(value).replace(/\s+/g, ' ').trim().slice(0, HABIT_NAME_MAX);
}

/** Keep at most {@link HABIT_EMOJI_MAX} code points (never half a surrogate pair). */
function normalizeEmoji(value: unknown): string {
  return Array.from(asString(value).trim()).slice(0, HABIT_EMOJI_MAX).join('');
}

/** Keep whole `Date#getDay()` values, deduped and ascending. */
function normalizeDays(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  const days = new Set<number>();
  for (const item of value) {
    if (typeof item === 'number' && Number.isInteger(item) && item >= 0 && item <= 6) days.add(item);
  }
  return [...days].sort((a, b) => a - b);
}

/**
 * Valid, unique day keys that are today or older, oldest first, the newest
 * {@link MAX_LOG_DAYS} kept.
 */
function normalizeLog(value: unknown, now: Date): string[] {
  if (!Array.isArray(value)) return [];
  const todayKey = dayKey(now);
  const keys = new Set<string>();
  for (const item of value) {
    const key = asString(item).trim();
    if (!isValidDayKey(key) || keys.has(key)) continue;
    const age = daysBetween(key, todayKey);
    // A day in the future cannot have happened yet (a hand-edited config, or a
    // clock that moved backwards) — dropping it is more honest than counting it.
    if (age === null || age < 0) continue;
    keys.add(key);
  }
  // Keys are zero padded, so lexicographic order is chronological order.
  return [...keys].sort().slice(-MAX_LOG_DAYS);
}

/** Repair one loaded habit, or `null` when there is nothing usable in it. */
function coerceHabit(value: unknown, now: Date, seen: Set<string>): Habit | null {
  if (!isRecord(value)) return null;
  const name = normalizeName(value.name);
  // A habit with no name cannot be shown or ticked, so it is dropped rather than
  // given an invented one that would sit in the list forever.
  if (name === '') return null;
  const rawId = asString(value.id).trim();
  const id = rawId === '' || seen.has(rawId) ? createId('habit') : rawId;
  seen.add(id);
  return {
    id,
    name,
    emoji: normalizeEmoji(value.emoji),
    schedule: isHabitSchedule(value.schedule) ? value.schedule : 'daily',
    days: normalizeDays(value.days),
    log: normalizeLog(value.log, now),
  };
}

/* --------------------------------------------------------------- normalising */

/**
 * Normalise anything loaded from storage, an import or the settings form into a
 * usable habit list.
 *
 * Rubbish is dropped rather than repaired into something the user never asked
 * for: non-objects, nameless habits, malformed or future day keys, duplicate ids
 * and junk `days` values. The list is capped at {@link MAX_HABITS} and each log at
 * {@link MAX_LOG_DAYS}. `now` is a parameter so tests can pin the "future" line.
 */
export function normalizeHabits(value: unknown, now: Date = new Date()): Habit[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const habits: Habit[] = [];
  for (const item of value) {
    const habit = coerceHabit(item, now, seen);
    if (habit) habits.push(habit);
    if (habits.length >= MAX_HABITS) break;
  }
  return habits;
}

/** Clamp the grid width into the range the settings form offers. */
export function normalizeWeeks(value: unknown): number {
  return clamp(Math.round(asNumber(value, DEFAULT_WEEKS)), MIN_WEEKS, MAX_WEEKS);
}

/** Normalise a whole habits config; `showHeatmap` defaults to on. */
export function normalizeHabitsConfig(value: unknown, now: Date = new Date()): HabitsConfig {
  const record = isRecord(value) ? value : {};
  return {
    habits: normalizeHabits(record.habits, now),
    weeks: normalizeWeeks(record.weeks),
    showHeatmap: asBoolean(record.showHeatmap, true),
  };
}

/* ------------------------------------------------------------------ schedule */

/**
 * `true` when the habit counts on `date`. A `custom` habit with an empty `days`
 * list is never scheduled (see the module header).
 */
export function isScheduledOn(habit: Habit, date: Date): boolean {
  switch (habit.schedule) {
    case 'weekdays': {
      const day = date.getDay();
      return day >= 1 && day <= 5;
    }
    case 'custom':
      return habit.days.includes(date.getDay());
    default:
      return true;
  }
}

/** `true` when the log holds this day key. */
export function isDoneOn(habit: Habit, key: string): boolean {
  return habit.log.includes(key);
}

/**
 * `true` when the habit has any scheduled day at all.
 *
 * Only a `custom` habit with an empty `days` list answers `false`; the widget
 * uses that to explain why such a habit can never have a streak.
 */
export function isEverScheduled(habit: Habit): boolean {
  return habit.schedule === 'custom' ? habit.days.length > 0 : true;
}

/**
 * The scheduled day before `date`, or `null` when the habit has no scheduled day
 * at all. The schedule repeats weekly, so the walk is at most six rest days.
 */
function previousScheduled(habit: Habit, date: Date): Date | null {
  let cursor = addDays(date, -1);
  for (let step = 0; step < 7; step += 1) {
    if (isScheduledOn(habit, cursor)) return cursor;
    cursor = addDays(cursor, -1);
  }
  return null;
}

/* ------------------------------------------------------------------- actions */

/**
 * Tick `key` off, or un-tick it, returning a new habit. A day the habit is not
 * scheduled on is ignored — the log only ever records days that count — and so
 * is a malformed key. The habit is returned *unchanged* (the same object) when
 * there is nothing to do, so a caller can skip a pointless config write.
 */
export function toggleDay(habit: Habit, key: string): Habit {
  const date = parseDayKey(key);
  if (!date || !isScheduledOn(habit, date)) return habit;
  const log = habit.log.includes(key)
    ? habit.log.filter((entry) => entry !== key)
    : [...habit.log, key].sort().slice(-MAX_LOG_DAYS);
  return { ...habit, log };
}

/**
 * Consecutive scheduled days done, counting back from today.
 *
 * A scheduled today that has not been ticked off yet is pending, so the count
 * starts from yesterday; rest days are skipped without breaking the run. A habit
 * with no scheduled days (or none done) has a streak of zero.
 */
export function currentStreak(habit: Habit, now: Date = new Date()): number {
  if (!isEverScheduled(habit)) return 0;

  let cursor = startOfDay(now);
  if (isScheduledOn(habit, cursor) && !isDoneOn(habit, dayKey(cursor))) {
    // Not done *yet* today: measure from yesterday rather than calling it a miss.
    cursor = addDays(cursor, -1);
  }

  let streak = 0;
  for (;;) {
    if (!isScheduledOn(habit, cursor)) {
      // Invisible day: neither counts nor breaks (a missed Saturday never breaks
      // a weekdays habit). The weekly pattern guarantees this walk terminates.
      cursor = addDays(cursor, -1);
      continue;
    }
    if (!isDoneOn(habit, dayKey(cursor))) break;
    streak += 1;
    cursor = addDays(cursor, -1);
  }
  return streak;
}

/**
 * Longest run of consecutive scheduled days in the whole log.
 *
 * Reads the log rather than walking calendar days, so a log spanning years costs
 * one small step per entry. An unsorted or duplicated log is tolerated instead
 * of trusted, and a logged day that is not scheduled is ignored.
 */
export function bestStreak(habit: Habit): number {
  if (!isEverScheduled(habit)) return 0;
  let best = 0;
  let run = 0;
  let previousKey: string | null = null;
  for (const key of [...new Set(habit.log.filter(isValidDayKey))].sort()) {
    const date = parseDayKey(key);
    if (!date || !isScheduledOn(habit, date)) continue;
    const before = previousScheduled(habit, date);
    run = before !== null && dayKey(before) === previousKey ? run + 1 : 1;
    previousKey = key;
    best = Math.max(best, run);
  }
  return best;
}

/**
 * Share of the *scheduled* days in the last `days` calendar days (today included)
 * that were done, 0…1.
 *
 * Dividing by the number of scheduled days rather than by the window length is
 * what keeps a weekdays habit from being punished for its weekends. Zero when the
 * window holds no scheduled day at all, and when `days` is not a positive number.
 * A scheduled today that is still pending counts as a miss here — the window is
 * "what happened in these days", not "the streak so far".
 */
export function completionRate(habit: Habit, days: number, now: Date = new Date()): number {
  const requested = Math.floor(days);
  if (!Number.isFinite(requested) || requested <= 0) return 0;
  // A log holds at most MAX_LOG_DAYS days, so a longer window cannot be measured.
  const window = Math.min(requested, MAX_LOG_DAYS);

  let scheduled = 0;
  let done = 0;
  let cursor = startOfDay(now);
  for (let offset = 0; offset < window; offset += 1) {
    if (isScheduledOn(habit, cursor)) {
      scheduled += 1;
      if (isDoneOn(habit, dayKey(cursor))) done += 1;
    }
    cursor = addDays(cursor, -1);
  }
  return scheduled === 0 ? 0 : done / scheduled;
}

/* ---------------------------------------------------------------------- grid */

export interface HabitGridCell {
  /** Local `YYYY-MM-DD` key of the day this cell stands for. */
  key: string;
  /** `true` when every habit scheduled that day was done. */
  done: boolean;
  /** `true` when at least one of the habits is scheduled that day. */
  scheduled: boolean;
  /** Accessible description, e.g. `Mon 9 Feb — done`. */
  label: string;
}

export interface HabitGridColumn {
  /** Key of the column's first day (oldest), stable across renders. */
  key: string;
  /** Seven days, oldest at the top. */
  cells: HabitGridCell[];
}

/** Weeks a single grid may span, whatever a hand-edited config asks for. */
function gridWeeks(value: unknown): number {
  return clamp(Math.round(asNumber(value, DEFAULT_WEEKS)), 1, MAX_WEEKS);
}

/**
 * A grid of the last `weeks` weeks for the given habits: `weeks` columns of seven
 * days, oldest column first, the last column ending on today.
 *
 * Columns are rolling seven-day windows rather than calendar weeks, which is what
 * makes the last column end on today — the cell a user looks for first. Cell
 * `done` is `true` only when every habit scheduled that day was done, so the grid
 * stays honest for a single habit (the widget draws one Heatmap per habit) and
 * still meaningful if a caller passes several.
 */
export function habitGrid(
  habits: readonly Habit[],
  weeks: number,
  now: Date = new Date(),
): { columns: HabitGridColumn[] } {
  const span = gridWeeks(weeks) * 7;
  const start = addDays(startOfDay(now), -(span - 1));
  const columns: HabitGridColumn[] = [];

  for (let week = 0; week < span / 7; week += 1) {
    const cells: HabitGridCell[] = [];
    for (let day = 0; day < 7; day += 1) {
      const date = addDays(start, week * 7 + day);
      const key = dayKey(date);
      const due = habits.filter((habit) => isScheduledOn(habit, date));
      const scheduled = due.length > 0;
      const done = scheduled && due.every((habit) => isDoneOn(habit, key));
      const state = done ? 'done' : scheduled ? 'missed' : 'not scheduled';
      cells.push({ key, done, scheduled, label: `${dayLabel(date)} — ${state}` });
    }
    columns.push({ key: cells[0].key, cells });
  }
  return { columns };
}

/* -------------------------------------------------------------------- totals */

/** How many habits are scheduled today, and how many of those are done. */
export function todayTotals(habits: readonly Habit[], now: Date = new Date()): { scheduled: number; done: number } {
  const today = startOfDay(now);
  const key = dayKey(today);
  let scheduled = 0;
  let done = 0;
  for (const habit of habits) {
    if (!isScheduledOn(habit, today)) continue;
    scheduled += 1;
    if (isDoneOn(habit, key)) done += 1;
  }
  return { scheduled, done };
}

/* ------------------------------------------------------------------ mutation */

/**
 * Append a habit with an empty log. A blank name, or a list already at
 * {@link MAX_HABITS}, leaves the array untouched (the same array is returned).
 *
 * A `custom` habit starts on Monday–Friday: an empty day list would mean "never
 * scheduled", which is a dead habit rather than a useful starting point.
 */
export function addHabit(habits: readonly Habit[], name: string, schedule: HabitSchedule = 'daily'): Habit[] {
  const trimmed = normalizeName(name);
  if (trimmed === '' || habits.length >= MAX_HABITS) return habits as Habit[];
  return [
    ...habits,
    {
      id: createId('habit'),
      name: trimmed,
      emoji: '',
      schedule,
      days: schedule === 'custom' ? [1, 2, 3, 4, 5] : [],
      log: [],
    },
  ];
}

/** Remove a habit. An unknown id returns the array unchanged. */
export function removeHabit(habits: readonly Habit[], id: string): Habit[] {
  const next = habits.filter((habit) => habit.id !== id);
  return next.length === habits.length ? (habits as Habit[]) : next;
}

/**
 * Patch one habit, re-validating the result so a bad patch (a `days` entry of 9,
 * a 500 character name, a future log key) cannot reach storage. The id cannot be
 * changed, an unknown id returns the array unchanged, and a patch that blanks the
 * name keeps the old one — an empty field is a half-finished rename, not a reason
 * to lose the habit.
 */
export function updateHabit(habits: readonly Habit[], id: string, patch: Partial<Omit<Habit, 'id'>>): Habit[] {
  const index = habits.findIndex((habit) => habit.id === id);
  if (index === -1) return habits as Habit[];
  const current = habits[index];
  const merged: Habit = { ...current, ...patch, id: current.id };
  if (normalizeName(merged.name) === '') merged.name = current.name;
  const next = [...habits];
  next[index] = coerceHabit(merged, new Date(), new Set()) ?? current;
  return next;
}

/**
 * Short subtitle for the widget header, e.g. `2 habits · 5 day streak` (the best
 * current streak across the habits) or `No habits yet`. With no streak anywhere
 * it reports just the count rather than a dispiriting "0 day streak".
 */
export function summarizeHabits(config: unknown): string {
  const { habits } = normalizeHabitsConfig(config);
  if (habits.length === 0) return 'No habits yet';
  const count = `${habits.length} habit${habits.length === 1 ? '' : 's'}`;
  const best = habits.reduce((max, habit) => Math.max(max, currentStreak(habit)), 0);
  return best === 0 ? count : `${count} · ${best} day streak`;
}

/** Streak label for the checklist: `5 days`, `1 day`, or `—` for no streak yet. */
export function formatStreak(days: number): string {
  if (!Number.isFinite(days) || days <= 0) return '—';
  return days === 1 ? '1 day' : `${Math.round(days)} days`;
}
