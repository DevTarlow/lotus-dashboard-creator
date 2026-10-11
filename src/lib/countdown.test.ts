import { describe, expect, it } from 'vitest';
import {
  COUNTDOWN_TONES,
  DEFAULT_COUNTDOWN_TONE,
  EVENT_LABEL_MAX,
  MAX_EVENTS,
  addEvent,
  countdownRows,
  daysUntilEvent,
  formatCountdown,
  formatCountdownParts,
  nextOccurrence,
  normalizeEvents,
  removeEvent,
  updateEvent,
  type CountdownEvent,
} from '@/lib/countdown';
import { dayKey } from '@/lib/time';

/** Local wall-clock instant; the model is defined in local time throughout. */
const at = (year: number, month: number, day: number, hour = 0, minute = 0): Date =>
  new Date(year, month - 1, day, hour, minute, 0, 0);

const ev = (patch: Partial<CountdownEvent> = {}): CountdownEvent => ({
  id: 'e1',
  label: 'Holiday',
  date: '2026-06-15',
  time: null,
  annual: false,
  tone: 'violet',
  ...patch,
});

describe('nextOccurrence', () => {
  it('resolves an all-day event to local midnight of its day', () => {
    const target = nextOccurrence(ev({ date: '2026-06-15' }), at(2026, 6, 1, 13, 30));
    expect(dayKey(target)).toBe('2026-06-15');
    expect(target.getTime()).toBe(at(2026, 6, 15).getTime());
  });

  it('uses the event time for a timed event', () => {
    const target = nextOccurrence(ev({ date: '2026-06-15', time: '18:30' }), at(2026, 6, 1, 13, 30));
    expect(dayKey(target)).toBe('2026-06-15');
    expect(target.getHours()).toBe(18);
    expect(target.getMinutes()).toBe(30);
  });

  it('keeps a one-off event on its own date once it has passed', () => {
    expect(dayKey(nextOccurrence(ev({ date: '2026-01-02' }), at(2026, 6, 1)))).toBe('2026-01-02');
  });

  it('rolls an annual event that has already passed over to next year', () => {
    const now = at(2026, 6, 1, 10);
    expect(dayKey(nextOccurrence(ev({ date: '2019-01-01', annual: true }), now))).toBe('2027-01-01');
    expect(dayKey(nextOccurrence(ev({ date: '2019-05-31', annual: true }), now))).toBe('2027-05-31');
  });

  it('keeps an all-day annual event on today for the whole day', () => {
    const anniversary = ev({ date: '2019-06-01', annual: true });
    expect(dayKey(nextOccurrence(anniversary, at(2026, 6, 1, 0, 1)))).toBe('2026-06-01');
    expect(dayKey(nextOccurrence(anniversary, at(2026, 6, 1, 23, 59)))).toBe('2026-06-01');
  });

  it('rolls a timed annual event over as soon as its moment has passed', () => {
    const now = at(2026, 6, 1, 10);
    const later = nextOccurrence(ev({ date: '2019-06-01', time: '21:00', annual: true }), now);
    expect(dayKey(later)).toBe('2026-06-01');
    expect(later.getHours()).toBe(21);

    const earlier = nextOccurrence(ev({ date: '2019-06-01', time: '09:00', annual: true }), now);
    expect(dayKey(earlier)).toBe('2027-06-01');
    expect(earlier.getHours()).toBe(9);
  });

  it('waits for the next leap year for an annual 29 February event', () => {
    const leapDay = ev({ date: '2024-02-29', annual: true });
    expect(dayKey(nextOccurrence(leapDay, at(2024, 1, 15)))).toBe('2024-02-29');
    expect(dayKey(nextOccurrence(leapDay, at(2024, 2, 29, 12)))).toBe('2024-02-29');
    expect(dayKey(nextOccurrence(leapDay, at(2023, 3, 1)))).toBe('2024-02-29');
    expect(dayKey(nextOccurrence(leapDay, at(2024, 3, 1)))).toBe('2028-02-29');
    expect(dayKey(nextOccurrence(leapDay, at(2025, 2, 28)))).toBe('2028-02-29');
    expect(dayKey(nextOccurrence(leapDay, at(2027, 12, 31)))).toBe('2028-02-29');
  });

  it('bridges the eight-year gap around the non-leap century year 2100', () => {
    const leapDay = ev({ date: '2096-02-29', annual: true });
    expect(dayKey(nextOccurrence(leapDay, at(2097, 1, 1)))).toBe('2104-02-29');
    expect(dayKey(nextOccurrence(leapDay, at(2100, 1, 1)))).toBe('2104-02-29');
  });

  it('treats an unparseable date as today instead of throwing', () => {
    expect(dayKey(nextOccurrence(ev({ date: 'tomorrow' }), at(2026, 6, 1, 8)))).toBe('2026-06-01');
  });
});

describe('daysUntilEvent', () => {
  const now = at(2026, 6, 1, 10);

  it('counts whole calendar days to the next occurrence', () => {
    expect(daysUntilEvent(ev({ date: '2026-06-01' }), now)).toBe(0);
    expect(daysUntilEvent(ev({ date: '2026-06-02' }), now)).toBe(1);
    expect(daysUntilEvent(ev({ date: '2026-06-21' }), now)).toBe(20);
  });

  it('counts a timed event earlier today as today, not yesterday', () => {
    expect(daysUntilEvent(ev({ date: '2026-06-01', time: '08:00' }), now)).toBe(0);
  });

  it('goes negative for a one-off event whose day is over', () => {
    expect(daysUntilEvent(ev({ date: '2026-05-30' }), now)).toBe(-2);
  });

  it('follows the annual rollover', () => {
    expect(daysUntilEvent(ev({ date: '2019-06-01', annual: true }), now)).toBe(0);
    expect(daysUntilEvent(ev({ date: '2019-06-02', annual: true }), now)).toBe(1);
  });
});

describe('countdownRows', () => {
  const now = at(2026, 6, 1, 10);
  const today = ev({ id: 'today', label: 'Birthday', date: '2026-06-01' });
  const tomorrow = ev({ id: 'soon', label: 'Trip', date: '2026-06-02' });
  const later = ev({ id: 'later', label: 'Holiday', date: '2026-07-01' });
  const yesterday = ev({ id: 'yesterday', label: 'Launch', date: '2026-05-31' });
  const older = ev({ id: 'older', label: 'Old', date: '2026-05-20' });

  it('orders soonest first and hides past events by default', () => {
    const rows = countdownRows([later, yesterday, tomorrow, today], now, { showPast: false });
    expect(rows.map((row) => row.event.id)).toEqual(['today', 'soon', 'later']);
  });

  it('puts passed events after the upcoming ones, most recent first, when showPast is on', () => {
    const rows = countdownRows([older, tomorrow, yesterday, today], now, { showPast: true });
    expect(rows.map((row) => row.event.id)).toEqual(['today', 'soon', 'yesterday', 'older']);
  });

  it('never reports a negative remaining time', () => {
    const rows = countdownRows([yesterday, older], now, { showPast: true });
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.remainingMs === 0)).toBe(true);
  });

  it('calls an all-day event today "Today" and leaves it un-passed', () => {
    const [row] = countdownRows([today], now, { showPast: false });
    expect(row.label).toBe('Today');
    expect(row.isToday).toBe(true);
    expect(row.passed).toBe(false);
    expect(row.remainingMs).toBe(0);
  });

  it('keeps a timed event that has already happened today visible as "Today"', () => {
    const standup = ev({ id: 'standup', label: 'Standup', date: '2026-06-01', time: '09:00' });
    const [row] = countdownRows([standup], now, { showPast: false });
    expect(row.isToday).toBe(true);
    expect(row.passed).toBe(false);
    expect(row.remainingMs).toBe(0);
    expect(row.label).toBe('Today');
  });

  it('marks a one-off event whose day is over as passed', () => {
    const [row] = countdownRows([yesterday], now, { showPast: true });
    expect(row.passed).toBe(true);
    expect(row.isToday).toBe(false);
    expect(row.label).toBe('Passed');
  });

  it('counts a timed event later today down to the second', () => {
    const dinner = ev({ id: 'dinner', label: 'Dinner', date: '2026-06-01', time: '18:30' });
    expect(countdownRows([dinner], now, { showPast: false })[0].label).toBe('8h 30m 00s');
    expect(countdownRows([dinner], now, { showPast: false, showSeconds: false })[0].label).toBe('8h 30m');
  });

  it('skips entries that are not real dates instead of inventing one', () => {
    const rows = countdownRows([ev({ id: 'broken', date: '2026-02-30' }), tomorrow], now, { showPast: false });
    expect(rows.map((row) => row.event.id)).toEqual(['soon']);
  });

  it('measures a one-off event over the 30 days before its date', () => {
    const midnight = at(2026, 6, 1);
    const half = ev({ id: 'half', date: '2026-06-16' });
    expect(countdownRows([half], midnight, { showPast: false })[0].progress).toBeCloseTo(0.5, 5);

    const far = ev({ id: 'far', date: '2026-08-01' });
    expect(countdownRows([far], midnight, { showPast: false })[0].progress).toBe(0);

    expect(countdownRows([yesterday], midnight, { showPast: true })[0].progress).toBe(1);
  });

  it('measures an annual event from its previous occurrence to the next one', () => {
    const newYear = ev({ id: 'new-year', date: '2019-01-01', annual: true });
    const rows = countdownRows([newYear], at(2026, 7, 2), { showPast: false });
    expect(dayKey(rows[0].target)).toBe('2027-01-01');
    expect(rows[0].progress).toBeCloseTo(0.5, 1);
  });

  it('clamps progress into 0…1', () => {
    const rows = countdownRows([later, yesterday, older], now, { showPast: true });
    for (const row of rows) {
      expect(row.progress).toBeGreaterThanOrEqual(0);
      expect(row.progress).toBeLessThanOrEqual(1);
    }
  });
});

describe('formatCountdown', () => {
  it('reports anything due as passed, never a zeroed-out countdown', () => {
    expect(formatCountdown(0, true)).toBe('Passed');
    expect(formatCountdown(-5_000, true)).toBe('Passed');
    expect(formatCountdown(Number.NaN, true)).toBe('Passed');
    expect(formatCountdown(Number.POSITIVE_INFINITY, true)).toBe('Passed');
  });

  it('calls the last minute "Less than a minute"', () => {
    expect(formatCountdown(1, true)).toBe('Less than a minute');
    expect(formatCountdown(59_999, true)).toBe('Less than a minute');
    expect(formatCountdown(59_999, false)).toBe('Less than a minute');
  });

  it('crosses the minute, hour and day boundaries', () => {
    expect(formatCountdown(60_000, true)).toBe('1m 00s');
    expect(formatCountdown(60_000, false)).toBe('1m');
    expect(formatCountdown(3_599_000, true)).toBe('59m 59s');
    expect(formatCountdown(3_600_000, true)).toBe('1h 00m 00s');
    expect(formatCountdown(3_600_000, false)).toBe('1h 00m');
  });

  it('formats a sub-day countdown with seconds only when asked', () => {
    const threeHoursTwenty = ((3 * 60 + 20) * 60 + 5) * 1000;
    expect(formatCountdown(threeHoursTwenty, true)).toBe('3h 20m 05s');
    expect(formatCountdown(threeHoursTwenty, false)).toBe('3h 20m');
  });

  it('drops seconds at day scale either way', () => {
    const twelveDays = ((12 * 24 + 4) * 3600 + 9 * 60) * 1000;
    expect(formatCountdown(twelveDays, true)).toBe('12d 4h 09m');
    expect(formatCountdown(twelveDays, false)).toBe('12d 4h 09m');
  });
});

describe('formatCountdownParts', () => {
  it('puts days on the first line with hours and minutes below', () => {
    const twelveDays = ((12 * 24 + 4) * 3600 + 9 * 60) * 1000;
    expect(formatCountdownParts(twelveDays, true)).toEqual({ primary: '12d', secondary: '4h 09m' });
  });

  it('falls through hours, minutes and the last minute', () => {
    const threeHoursTwenty = (3 * 3600 + 20 * 60 + 5) * 1000;
    expect(formatCountdownParts(threeHoursTwenty, true)).toEqual({ primary: '3h', secondary: '20m 05s' });
    expect(formatCountdownParts(threeHoursTwenty, false)).toEqual({ primary: '3h', secondary: '20m' });
    expect(formatCountdownParts((20 * 60 + 5) * 1000, true)).toEqual({ primary: '20m', secondary: '05s' });
    expect(formatCountdownParts((20 * 60 + 5) * 1000, false)).toEqual({ primary: '20m', secondary: '' });
    expect(formatCountdownParts(30_000, true)).toEqual({ primary: '<1m', secondary: '' });
    expect(formatCountdownParts(0, true)).toEqual({ primary: 'Passed', secondary: '' });
  });
});

describe('addEvent, removeEvent and updateEvent', () => {
  const events: CountdownEvent[] = [ev({ id: 'a' }), ev({ id: 'b', label: 'Trip' })];

  it('adds an event with a fresh id', () => {
    const next = addEvent(events, { label: 'New year', date: '2027-01-01', time: null, annual: true, tone: 'amber' });
    expect(next).toHaveLength(3);
    expect(next[2]).toMatchObject({ label: 'New year', date: '2027-01-01', annual: true, tone: 'amber' });
    expect(next[2].id).not.toBe('');
    expect(next[2].id).not.toBe('a');
  });

  it('refuses to grow past MAX_EVENTS', () => {
    const full = Array.from({ length: MAX_EVENTS }, (_, index) => ev({ id: `e${index}` }));
    const next = addEvent(full, { label: 'One too many', date: '2027-01-01', time: null, annual: false, tone: 'slate' });
    expect(next).toBe(full);
    expect(next).toHaveLength(MAX_EVENTS);
  });

  it('removes by id and leaves the other events alone', () => {
    const next = removeEvent(events, 'a');
    expect(next.map((event) => event.id)).toEqual(['b']);
    expect(next[0]).toBe(events[1]);
    expect(removeEvent(events, 'missing')).toBe(events);
  });

  it('patches by id and never rewrites the id', () => {
    const next = updateEvent(events, 'b', { label: 'Trip 2', time: '09:00' });
    expect(next[1]).toEqual({
      id: 'b',
      label: 'Trip 2',
      date: '2026-06-15',
      time: '09:00',
      annual: false,
      tone: 'violet',
    });
    expect(next[0]).toBe(events[0]);
    expect(updateEvent(events, 'missing', { label: 'x' })).toBe(events);
    // A hand-written id in the patch must not become the new identity.
    expect(updateEvent(events, 'b', { id: 'hacked' } as Partial<CountdownEvent>)[1].id).toBe('b');
  });

  it('never mutates the input list or its events', () => {
    const before = events.map((event) => ({ ...event }));
    addEvent(events, { label: 'New', date: '2027-01-01', time: null, annual: false, tone: 'sky' });
    removeEvent(events, 'a');
    updateEvent(events, 'a', { label: 'Changed' });
    expect(events).toEqual(before);
  });
});

describe('normalizeEvents', () => {
  it('returns an empty list for anything that is not an array', () => {
    expect(normalizeEvents(undefined)).toEqual([]);
    expect(normalizeEvents(null)).toEqual([]);
    expect(normalizeEvents('nope')).toEqual([]);
    expect(normalizeEvents({ events: [] })).toEqual([]);
  });

  it('drops entries that are not usable events', () => {
    const events = normalizeEvents([
      null,
      42,
      'Holiday',
      {},
      { label: 'No date', date: '' },
      { label: 'Impossible', date: '2026-02-30' },
      { label: 'Wrong shape', date: '15/06/2026' },
      { label: '   ', date: '2026-06-15' },
      { label: 'Kept', date: '2026-06-15' },
    ]);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ label: 'Kept', date: '2026-06-15', time: null, annual: false, tone: 'violet' });
  });

  it('trims and clamps the label', () => {
    const [event] = normalizeEvents([{ label: `  ${'x'.repeat(90)}  `, date: '2026-06-15' }]);
    expect(event.label).toHaveLength(EVENT_LABEL_MAX);
    expect(event.label).not.toContain(' ');
    expect(event.label.endsWith('…')).toBe(true);
  });

  it('accepts a real HH:mm and degrades a broken one to all-day', () => {
    expect(normalizeEvents([{ label: 'A', date: '2026-06-15', time: '18:30' }])[0].time).toBe('18:30');
    expect(normalizeEvents([{ label: 'A', date: '2026-06-15', time: '9:00' }])[0].time).toBeNull();
    expect(normalizeEvents([{ label: 'A', date: '2026-06-15', time: '25:00' }])[0].time).toBeNull();
    expect(normalizeEvents([{ label: 'A', date: '2026-06-15', time: '18:30:00' }])[0].time).toBeNull();
    expect(normalizeEvents([{ label: 'A', date: '2026-06-15', time: '' }])[0].time).toBeNull();
  });

  it('keeps a valid tone and annual flag, defaulting everything else', () => {
    const [event] = normalizeEvents([{ label: 'A', date: '2026-06-15', annual: true, tone: 'amber' }]);
    expect(event).toMatchObject({ annual: true, tone: 'amber' });

    const [fallback] = normalizeEvents([{ label: 'B', date: '2026-06-15', annual: 'yes', tone: 'chartreuse' }]);
    expect(fallback).toMatchObject({ annual: false, tone: DEFAULT_COUNTDOWN_TONE });
    expect(COUNTDOWN_TONES).toContain(fallback.tone);
  });

  it('keeps stored ids, generates missing ones and repairs duplicates', () => {
    const events = normalizeEvents([
      { id: 'mine', label: 'A', date: '2026-06-15' },
      { id: 'mine', label: 'B', date: '2026-06-16' },
      { id: '   ', label: 'C', date: '2026-06-17' },
    ]);
    expect(events[0].id).toBe('mine');
    expect(events[1].id).not.toBe('mine');
    expect(events[2].id).not.toBe('');
    expect(new Set(events.map((event) => event.id)).size).toBe(3);
  });

  it('keeps two events that merely share a date', () => {
    const events = normalizeEvents([
      { label: 'A', date: '2026-06-15' },
      { label: 'B', date: '2026-06-15' },
    ]);
    expect(events).toHaveLength(2);
  });

  it('caps the list at MAX_EVENTS', () => {
    const many = Array.from({ length: MAX_EVENTS + 3 }, (_, index) => ({ label: `E${index}`, date: '2026-06-15' }));
    expect(normalizeEvents(many)).toHaveLength(MAX_EVENTS);
  });

  it('is idempotent, so a normalised list can be persisted as-is', () => {
    const once = normalizeEvents([{ label: 'A', date: '2026-06-15', annual: true }]);
    expect(normalizeEvents(once)).toEqual(once);
  });

  it('does not mutate its input', () => {
    const input = [{ id: 'a', label: 'A', date: '2026-06-15', time: null, annual: true, tone: 'rose' }];
    const snapshot = structuredClone(input);
    normalizeEvents(input);
    expect(input).toEqual(snapshot);
  });
});
