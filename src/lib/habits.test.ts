import { afterAll, describe, expect, it } from 'vitest';
import {
  DEFAULT_WEEKS,
  HABIT_NAME_MAX,
  MAX_HABITS,
  MAX_LOG_DAYS,
  MAX_WEEKS,
  MIN_WEEKS,
  addHabit,
  bestStreak,
  completionRate,
  currentStreak,
  formatStreak,
  habitGrid,
  isDoneOn,
  isEverScheduled,
  isScheduledOn,
  normalizeHabits,
  normalizeHabitsConfig,
  normalizeWeeks,
  removeHabit,
  summarizeHabits,
  todayTotals,
  toggleDay,
  updateHabit,
  type Habit,
} from '@/lib/habits';
import { addDays, dayKey, parseDayKey } from '@/lib/time';

/**
 * Every date in this suite is pinned, except the few that must be relative to
 * the real clock (the "future day key" rule and `summarizeHabits`, which has no
 * `now` parameter). The host time zone is restored afterwards.
 */
const originalTimeZone = process.env.TZ;

afterAll(() => {
  process.env.TZ = originalTimeZone;
});

/** Local midday on a pinned day key. */
function at(key: string, hour = 12): Date {
  const date = parseDayKey(key);
  if (!date) throw new Error(`bad fixture date: ${key}`);
  date.setHours(hour);
  return date;
}

function habit(patch: Partial<Habit> = {}): Habit {
  return { id: 'h1', name: 'Run', emoji: '🏃', schedule: 'daily', days: [], log: [], ...patch };
}

/** Day keys for the last `count` days, oldest first, ending today. */
function recentKeys(count: number): string[] {
  const today = new Date();
  return Array.from({ length: count }, (_, index) => dayKey(addDays(today, index - (count - 1))));
}

// A pinned, unremarkable week: Mon 9 Feb – Sun 15 Feb 2026.
const MON = '2026-02-09';
const TUE = '2026-02-10';
const WED = '2026-02-11';
const THU = '2026-02-12';
const FRI = '2026-02-13';
const SAT = '2026-02-14';
const SUN = '2026-02-15';

/** The same weekdays one week earlier: the days a Monday can look back on. */
const LAST_MON = '2026-02-02';
const LAST_TUE = '2026-02-03';
const LAST_WED = '2026-02-04';
const LAST_THU = '2026-02-05';
const LAST_FRI = '2026-02-06';
const LAST_SAT = '2026-02-07';
const LAST_SUN = '2026-02-08';

describe('normalizeHabits', () => {
  it('returns an empty list for anything that is not a list of habits', () => {
    expect(normalizeHabits(undefined)).toEqual([]);
    expect(normalizeHabits(null)).toEqual([]);
    expect(normalizeHabits('Run every day')).toEqual([]);
    expect(normalizeHabits({ name: 'Run' })).toEqual([]);
    expect(normalizeHabits([1, 'Run', null, [], true])).toEqual([]);
  });

  it('drops habits with no usable name and tidies the ones it keeps', () => {
    const habits = normalizeHabits([{ name: '   ' }, { name: 42 }, { name: '  Run   every  day ' }]);
    expect(habits).toHaveLength(1);
    expect(habits[0].name).toBe('Run every day');
  });

  it('clamps the name length', () => {
    const [long] = normalizeHabits([{ name: 'x'.repeat(200) }]);
    expect(long.name).toHaveLength(HABIT_NAME_MAX);
  });

  it('keeps a short emoji glyph and discards the rest', () => {
    expect(normalizeHabits([{ name: 'A', emoji: '🏃' }])[0].emoji).toBe('🏃');
    // Code points, not UTF-16 units: a surrogate pair is never cut in half.
    expect(normalizeHabits([{ name: 'A', emoji: '🏃🏃🏃' }])[0].emoji).toBe('🏃🏃');
    expect(normalizeHabits([{ name: 'A', emoji: 42 }])[0].emoji).toBe('');
  });

  it('falls back to a daily schedule when the stored one is unknown', () => {
    expect(normalizeHabits([{ name: 'A', schedule: 'sometimes' }])[0].schedule).toBe('daily');
    expect(normalizeHabits([{ name: 'A', schedule: 'weekdays' }])[0].schedule).toBe('weekdays');
    expect(normalizeHabits([{ name: 'A', schedule: 'custom' }])[0].schedule).toBe('custom');
  });

  it('keeps only whole weekday numbers, deduped and sorted', () => {
    const [first] = normalizeHabits([{ name: 'A', schedule: 'custom', days: [9, -1, 2, 2, '3', 6.7, 0, 6] }]);
    expect(first.days).toEqual([0, 2, 6]);
    expect(normalizeHabits([{ name: 'A', days: 'Mon' }])[0].days).toEqual([]);
  });

  it('dedupes, sorts and repairs the log', () => {
    const [first] = normalizeHabits(
      [{ name: 'A', log: [WED, MON, WED, '', 'nope', '2026-02-30', 42, TUE] }],
      at(SUN),
    );
    expect(first.log).toEqual([MON, TUE, WED]);
  });

  it('drops day keys in the future, which cannot have happened', () => {
    const today = dayKey(new Date());
    const tomorrow = dayKey(addDays(new Date(), 1));
    const [first] = normalizeHabits([{ name: 'A', log: [today, tomorrow, '2999-01-01'] }]);
    expect(first.log).toEqual([today]);
  });

  it('keeps a real leap day but not a fake one', () => {
    const [first] = normalizeHabits([{ name: 'A', log: ['2024-02-29', '2026-02-29'] }], at('2026-03-01'));
    expect(first.log).toEqual(['2024-02-29']);
  });

  it('caps the log at the newest MAX_LOG_DAYS days', () => {
    const keys = recentKeys(MAX_LOG_DAYS + 20);
    const [first] = normalizeHabits([{ name: 'A', log: [...keys].reverse() }]);
    expect(first.log).toHaveLength(MAX_LOG_DAYS);
    expect(first.log[first.log.length - 1]).toBe(keys[keys.length - 1]);
    expect(first.log).not.toContain(keys[0]);
  });

  it('gives every habit a unique id', () => {
    const habits = normalizeHabits([{ id: 'dup', name: 'A' }, { id: 'dup', name: 'B' }, { name: 'C' }]);
    expect(habits).toHaveLength(3);
    expect(new Set(habits.map((entry) => entry.id)).size).toBe(3);
    expect(habits.every((entry) => entry.id !== '')).toBe(true);
  });

  it('caps the list at MAX_HABITS', () => {
    const habits = normalizeHabits(Array.from({ length: MAX_HABITS + 5 }, (_, index) => ({ name: `Habit ${index}` })));
    expect(habits).toHaveLength(MAX_HABITS);
  });
});

describe('isScheduledOn', () => {
  it('schedules a daily habit every day', () => {
    const daily = habit();
    expect([MON, TUE, WED, THU, FRI, SAT, SUN].every((key) => isScheduledOn(daily, at(key)))).toBe(true);
  });

  it('leaves the weekend out of a weekdays habit', () => {
    const weekdays = habit({ schedule: 'weekdays' });
    expect(isScheduledOn(weekdays, at(MON))).toBe(true);
    expect(isScheduledOn(weekdays, at(FRI))).toBe(true);
    expect(isScheduledOn(weekdays, at(SAT))).toBe(false);
    expect(isScheduledOn(weekdays, at(SUN))).toBe(false);
  });

  it('follows the chosen days of a custom habit', () => {
    const custom = habit({ schedule: 'custom', days: [1, 3] });
    expect(isScheduledOn(custom, at(MON))).toBe(true);
    expect(isScheduledOn(custom, at(TUE))).toBe(false);
    expect(isScheduledOn(custom, at(WED))).toBe(true);
  });

  it('never schedules a custom habit with no days chosen', () => {
    const custom = habit({ schedule: 'custom', days: [] });
    for (let day = 0; day < 7; day += 1) {
      expect(isScheduledOn(custom, addDays(at(SUN), day))).toBe(false);
    }
    expect(isEverScheduled(custom)).toBe(false);
    expect(isEverScheduled(habit({ schedule: 'weekdays' }))).toBe(true);
  });
});

describe('isDoneOn', () => {
  it('reads the log', () => {
    const done = habit({ log: [MON, WED] });
    expect(isDoneOn(done, MON)).toBe(true);
    expect(isDoneOn(done, WED)).toBe(true);
    expect(isDoneOn(done, TUE)).toBe(false);
  });
});

describe('toggleDay', () => {
  it('adds the day, keeping the log sorted and the habit immutable', () => {
    const before = habit({ log: [MON, FRI] });
    const after = toggleDay(before, WED);
    expect(after.log).toEqual([MON, WED, FRI]);
    expect(before.log).toEqual([MON, FRI]);
    expect(after).not.toBe(before);
  });

  it('sorts a log that arrived out of order', () => {
    const after = toggleDay(habit({ log: [FRI, MON] }), WED);
    expect(after.log).toEqual([MON, WED, FRI]);
  });

  it('removes a day that is already ticked', () => {
    expect(toggleDay(habit({ log: [MON, WED] }), MON).log).toEqual([WED]);
  });

  it('ignores a day the habit is not scheduled on', () => {
    const weekdays = habit({ schedule: 'weekdays' });
    expect(toggleDay(weekdays, SAT)).toBe(weekdays);
    const never = habit({ schedule: 'custom', days: [] });
    expect(toggleDay(never, MON)).toBe(never);
  });

  it('ignores a malformed key', () => {
    const daily = habit();
    expect(toggleDay(daily, 'yesterday')).toBe(daily);
    expect(toggleDay(daily, '2026-02-30')).toBe(daily);
  });

  it('caps the log at MAX_LOG_DAYS, dropping the oldest day', () => {
    const keys = recentKeys(MAX_LOG_DAYS + 1);
    const today = keys[keys.length - 1];
    // A full log that does not yet hold today, so the toggle has to add a day.
    const full = habit({ log: keys.slice(0, MAX_LOG_DAYS) });
    const after = toggleDay(full, today);
    expect(after.log).toHaveLength(MAX_LOG_DAYS);
    expect(after.log).toContain(today);
    expect(after.log).not.toContain(keys[0]);
  });
});

describe('currentStreak', () => {
  it('has no streak without a log', () => {
    expect(currentStreak(habit(), at(MON))).toBe(0);
  });

  it('does not let an unticked today break the streak', () => {
    // Fri–Sun done, Monday not ticked off yet.
    expect(currentStreak(habit({ log: [LAST_FRI, LAST_SAT, LAST_SUN] }), at(MON))).toBe(3);
    // Ticking Monday off extends it.
    expect(currentStreak(habit({ log: [LAST_FRI, LAST_SAT, LAST_SUN, MON] }), at(MON))).toBe(4);
  });

  it('stops at a missed scheduled day in the middle of the log', () => {
    // Mon, Tue, Thu and Fri done; Wednesday missed. Saturday is not done yet.
    const run = habit({ log: [LAST_MON, LAST_TUE, LAST_THU, LAST_FRI] });
    expect(currentStreak(run, at(LAST_SAT))).toBe(2);
    expect(currentStreak(run, at(SUN))).toBe(0);
  });

  it('is not broken by the weekend of a weekdays habit', () => {
    const weekdays = habit({ schedule: 'weekdays', log: [LAST_THU, LAST_FRI] });
    // Measured on the Saturday, on the Sunday, and on a Monday not yet ticked.
    expect(currentStreak(weekdays, at(LAST_SAT))).toBe(2);
    expect(currentStreak(weekdays, at(LAST_SUN))).toBe(2);
    expect(currentStreak(weekdays, at(MON))).toBe(2);
  });

  it('counts only the chosen days of a custom habit', () => {
    const custom = habit({ schedule: 'custom', days: [1, 3, 5], log: ['2026-02-02', '2026-02-04', '2026-02-06'] });
    expect(currentStreak(custom, at('2026-02-07'))).toBe(3);
  });

  it('counts a custom habit that repeats weekly with long gaps', () => {
    const mondays = habit({ schedule: 'custom', days: [1], log: ['2026-01-19', '2026-01-26', '2026-02-02', MON] });
    expect(currentStreak(mondays, at(MON))).toBe(4);
    expect(currentStreak(mondays, at('2026-02-16'))).toBe(4);
  });

  it('ignores a logged day the habit was not scheduled on', () => {
    const weekdays = habit({ schedule: 'weekdays', log: [SAT] });
    expect(currentStreak(weekdays, at(SUN))).toBe(0);
  });

  it('has no streak when the habit is never scheduled', () => {
    const never = habit({ schedule: 'custom', days: [], log: [FRI, SAT, SUN] });
    expect(currentStreak(never, at(MON))).toBe(0);
  });

  it('counts across a DST change, in both directions', () => {
    process.env.TZ = 'America/New_York';
    try {
      // 2026-03-08 is 23 hours long, 2026-11-01 is 25.
      const spring = habit({ log: ['2026-03-05', '2026-03-06', '2026-03-07', '2026-03-08', '2026-03-09'] });
      expect(currentStreak(spring, at('2026-03-09'))).toBe(5);
      const autumn = habit({ log: ['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02'] });
      expect(currentStreak(autumn, at('2026-11-02'))).toBe(4);
    } finally {
      process.env.TZ = originalTimeZone;
    }
  });
});

describe('bestStreak', () => {
  it('is zero for an empty log', () => {
    expect(bestStreak(habit())).toBe(0);
    expect(bestStreak(habit({ schedule: 'custom', days: [], log: [MON] }))).toBe(0);
  });

  it('finds the longest run, not the current one', () => {
    const run = habit({ log: [LAST_MON, LAST_TUE, LAST_WED, LAST_FRI, LAST_SAT] });
    expect(bestStreak(run)).toBe(3);
    expect(currentStreak(run, at(SUN))).toBe(0);
  });

  it('bridges the weekend of a weekdays habit', () => {
    const weekdays = habit({ schedule: 'weekdays', log: [LAST_THU, LAST_FRI, MON, TUE] });
    expect(bestStreak(weekdays)).toBe(4);
  });

  it('counts only the chosen days of a custom habit', () => {
    const tuesdays = habit({ schedule: 'custom', days: [2], log: ['2026-02-03', '2026-02-10', '2026-02-17', WED] });
    expect(bestStreak(tuesdays)).toBe(3);
  });

  it('tolerates an unsorted, duplicated log', () => {
    expect(bestStreak(habit({ log: [FRI, WED, THU, WED] }))).toBe(3);
  });
});

describe('completionRate', () => {
  it('is zero for a window that cannot hold a scheduled day', () => {
    expect(completionRate(habit({ log: [MON] }), 0, at(MON))).toBe(0);
    expect(completionRate(habit({ log: [MON] }), -7, at(MON))).toBe(0);
    expect(completionRate(habit({ log: [MON] }), Number.NaN, at(MON))).toBe(0);
    expect(completionRate(habit({ log: [MON] }), Number.POSITIVE_INFINITY, at(MON))).toBe(0);
  });

  it('is zero when nothing is scheduled in the window', () => {
    expect(completionRate(habit({ schedule: 'custom', days: [] }), 7, at(MON))).toBe(0);
    // A weekdays habit over a weekend-only window: two days, no scheduled day.
    expect(completionRate(habit({ schedule: 'weekdays' }), 2, at(SUN))).toBe(0);
  });

  it('is one when every scheduled day in the window is done', () => {
    expect(completionRate(habit({ log: recentKeys(7) }), 7, new Date())).toBe(1);
  });

  it('divides by the scheduled days, not by the window length', () => {
    // Seven-day window ending Sunday 1 March 2026: five weekdays, four of them done.
    const weekdays = habit({
      schedule: 'weekdays',
      log: ['2026-02-23', '2026-02-24', '2026-02-26', '2026-02-27'],
    });
    expect(completionRate(weekdays, 7, at('2026-03-01'))).toBeCloseTo(4 / 5);
  });

  it('counts a pending today against the window', () => {
    expect(completionRate(habit({ log: recentKeys(7).slice(0, 6) }), 7, new Date())).toBeCloseTo(6 / 7);
  });

  it('never walks further back than the log can hold', () => {
    expect(completionRate(habit({ log: recentKeys(MAX_LOG_DAYS) }), 100_000, new Date())).toBe(1);
  });
});

describe('habitGrid', () => {
  it('returns one column per week, seven days each, ending today', () => {
    const { columns } = habitGrid([habit()], 4, at(SUN));
    expect(columns).toHaveLength(4);
    expect(columns.every((column) => column.cells.length === 7)).toBe(true);

    const cells = columns.flatMap((column) => column.cells);
    expect(cells).toHaveLength(28);
    expect(cells[0].key).toBe('2026-01-19');
    expect(cells[cells.length - 1].key).toBe(SUN);
    // Columns are rolling seven-day windows, so they do not share a weekday.
    expect(columns.map((column) => column.key)).toEqual([
      '2026-01-19',
      '2026-01-26',
      '2026-02-02',
      '2026-02-09',
    ]);
    expect(new Set(cells.map((cell) => cell.key)).size).toBe(28);
  });

  it('labels each cell with the day and what happened', () => {
    // The Saturday is logged although the habit is not scheduled on it.
    const weekdays = habit({ schedule: 'weekdays', log: [FRI, SAT] });
    const { columns } = habitGrid([weekdays], 2, at(SUN));
    const byKey = new Map(columns.flatMap((column) => column.cells).map((cell) => [cell.key, cell]));

    expect(byKey.get(FRI)?.label).toBe('Fri 13 Feb: done');
    expect(byKey.get(FRI)?.done).toBe(true);
    expect(byKey.get(MON)?.label).toBe('Mon 9 Feb: missed');
    expect(byKey.get(MON)?.scheduled).toBe(true);
    expect(byKey.get(SAT)?.label).toBe('Sat 14 Feb: not scheduled');
    expect(byKey.get(SAT)?.scheduled).toBe(false);
    // A rest day that was logged anyway is not a day the habit counted.
    expect(byKey.get(SAT)?.done).toBe(false);
  });

  it('clamps the number of weeks it will draw', () => {
    expect(habitGrid([habit()], 0, at(SUN)).columns).toHaveLength(1);
    expect(habitGrid([habit()], -3, at(SUN)).columns).toHaveLength(1);
    expect(habitGrid([habit()], 500, at(SUN)).columns).toHaveLength(MAX_WEEKS);
    expect(habitGrid([habit()], Number.NaN, at(SUN)).columns).toHaveLength(DEFAULT_WEEKS);
  });

  it('marks a day done only when every scheduled habit was kept', () => {
    const run = habit({ id: 'a', log: [MON] });
    const read = habit({ id: 'b', name: 'Read', log: [] });
    const { columns } = habitGrid([run, read], 1, at(MON));
    const today = columns[0].cells[6];
    expect(today.scheduled).toBe(true);
    expect(today.done).toBe(false);

    const both = habitGrid([run, habit({ id: 'b', log: [MON] })], 1, at(MON));
    expect(both.columns[0].cells[6].done).toBe(true);
  });

  it('reports an empty habit list as all rest days', () => {
    const { columns } = habitGrid([], 1, at(SUN));
    expect(columns[0].cells.every((cell) => !cell.scheduled && !cell.done)).toBe(true);
  });
});

describe('todayTotals', () => {
  it('counts only the habits scheduled today, and how many are done', () => {
    const habits = [
      habit({ id: 'a', log: [MON] }),
      habit({ id: 'b', log: [] }),
      habit({ id: 'c', schedule: 'weekdays', log: [MON] }),
    ];
    expect(todayTotals(habits, at(MON))).toEqual({ scheduled: 3, done: 2 });
    // Saturday: the weekdays habit does not count, so neither does its logged day.
    expect(todayTotals(habits, at(SAT))).toEqual({ scheduled: 2, done: 0 });
  });

  it('is empty for no habits', () => {
    expect(todayTotals([], at(MON))).toEqual({ scheduled: 0, done: 0 });
  });
});

describe('addHabit', () => {
  it('appends a habit with an empty log and a generated id', () => {
    const before: Habit[] = [];
    const next = addHabit(before, '  Read   a book  ');
    expect(before).toEqual([]);
    expect(next).toHaveLength(1);
    expect(next[0].name).toBe('Read a book');
    expect(next[0].id).not.toBe('');
    expect(next[0]).toMatchObject({ emoji: '', schedule: 'daily', days: [], log: [] });
  });

  it('starts a custom habit on weekdays rather than never', () => {
    const [custom] = addHabit([], 'Gym', 'custom');
    expect(custom.days).toEqual([1, 2, 3, 4, 5]);
    expect(addHabit([], 'Gym', 'weekdays')[0].days).toEqual([]);
  });

  it('refuses a blank name and is capped at MAX_HABITS', () => {
    const habits = [habit()];
    expect(addHabit(habits, '   ')).toBe(habits);
    const full = Array.from({ length: MAX_HABITS }, (_, index) => habit({ id: `h${index}` }));
    expect(addHabit(full, 'One more')).toBe(full);
  });
});

describe('removeHabit', () => {
  it('removes by id and leaves unknown ids alone', () => {
    const habits = [habit({ id: 'a' }), habit({ id: 'b' })];
    const next = removeHabit(habits, 'a');
    expect(next.map((entry) => entry.id)).toEqual(['b']);
    expect(habits).toHaveLength(2);
    expect(removeHabit(habits, 'nope')).toBe(habits);
  });
});

describe('updateHabit', () => {
  it('patches one habit immutably', () => {
    const habits = [habit({ id: 'a' }), habit({ id: 'b', name: 'Read' })];
    const next = updateHabit(habits, 'b', { name: 'Read more', emoji: '📚', schedule: 'weekdays' });
    expect(next[1]).toMatchObject({ id: 'b', name: 'Read more', emoji: '📚', schedule: 'weekdays' });
    expect(next[0]).toBe(habits[0]);
    expect(habits[1].name).toBe('Read');
  });

  it('re-validates the patched fields', () => {
    const habits = [habit({ id: 'a' })];
    expect(updateHabit(habits, 'a', { schedule: 'custom', days: [9, 3, 3] })[0].days).toEqual([3]);
    expect(updateHabit(habits, 'a', { name: 'x'.repeat(200) })[0].name).toHaveLength(HABIT_NAME_MAX);
    expect(updateHabit(habits, 'a', { emoji: '🏃🏃🏃' })[0].emoji).toBe('🏃🏃');
  });

  it('keeps the old name when a patch blanks it', () => {
    const habits = [habit({ id: 'a', name: 'Run' })];
    expect(updateHabit(habits, 'a', { name: '   ' })[0].name).toBe('Run');
  });

  it('leaves unknown ids alone', () => {
    const habits = [habit({ id: 'a' })];
    expect(updateHabit(habits, 'nope', { name: 'Other' })).toBe(habits);
  });
});

describe('normalizeWeeks', () => {
  it('clamps the grid width into the range the settings form offers', () => {
    expect(normalizeWeeks(1)).toBe(MIN_WEEKS);
    expect(normalizeWeeks(99)).toBe(MAX_WEEKS);
    expect(normalizeWeeks(7.6)).toBe(8);
    expect(normalizeWeeks('8')).toBe(8);
    expect(normalizeWeeks('lots')).toBe(DEFAULT_WEEKS);
    expect(normalizeWeeks(undefined)).toBe(DEFAULT_WEEKS);
  });
});

describe('normalizeHabitsConfig', () => {
  it('repairs a hand-edited config', () => {
    const config = normalizeHabitsConfig({ habits: [{ name: 'Run' }], weeks: 40, showHeatmap: 'yes' }, at(MON));
    expect(config.habits).toHaveLength(1);
    expect(config.weeks).toBe(MAX_WEEKS);
    expect(config.showHeatmap).toBe(true);
  });

  it('defaults the optional keys', () => {
    expect(normalizeHabitsConfig(undefined)).toEqual({ habits: [], weeks: DEFAULT_WEEKS, showHeatmap: true });
    expect(normalizeHabitsConfig({ showHeatmap: false }).showHeatmap).toBe(false);
  });
});

describe('summarizeHabits', () => {
  it('says so when there are no habits', () => {
    expect(summarizeHabits({ habits: [] })).toBe('No habits yet');
    expect(summarizeHabits(undefined)).toBe('No habits yet');
    expect(summarizeHabits({ habits: [{ name: '  ' }] })).toBe('No habits yet');
  });

  it('reports the count and the best current streak', () => {
    // Built from the real clock, because the summary has no `now` parameter.
    const five = recentKeys(5);
    const config = {
      habits: [habit({ id: 'a', log: five }), habit({ id: 'b', name: 'Read', log: [five[3]] })],
    };
    expect(summarizeHabits(config)).toBe('2 habits · 5 day streak');
  });

  it('reports just the count while every streak is zero', () => {
    expect(summarizeHabits({ habits: [habit(), habit({ id: 'b', name: 'Read' })] })).toBe('2 habits');
    expect(summarizeHabits({ habits: [habit()] })).toBe('1 habit');
  });
});

describe('formatStreak', () => {
  it('reads as a day count, and as a dash when there is no streak yet', () => {
    expect(formatStreak(0)).toBe('—');
    expect(formatStreak(-3)).toBe('—');
    expect(formatStreak(Number.NaN)).toBe('—');
    expect(formatStreak(1)).toBe('1 day');
    expect(formatStreak(5)).toBe('5 days');
  });
});
