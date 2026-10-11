import { describe, expect, it } from 'vitest';
import {
  MAX_EVENTS,
  MAX_EVENT_TEXT,
  addEvent,
  buildMonth,
  eventsByDate,
  monthTitle,
  normalizeEvents,
  removeEvent,
  resolveWeekStart,
  shiftMonth,
  updateEvent,
  weekdayLabels,
  type CalendarCell,
  type CalendarEvent,
  type CalendarWeekStart,
} from '@/lib/calendar';
import type { Holiday } from '@/lib/holidays';
import { isoWeek, parseDayKey, weekStartFor } from '@/lib/time';

const event = (id: string, date: string, text: string): CalendarEvent => ({ id, date, text });

const holiday = (date: string, name: string, localName = name, global = true): Holiday => ({
  date,
  name,
  localName,
  global,
});

/** Look one day up in a built grid, failing loudly when the key is not there. */
function cellAt(weeks: CalendarCell[][], key: string): CalendarCell {
  const cell = weeks.flat().find((entry) => entry.key === key);
  if (!cell) throw new Error(`No cell for ${key}`);
  return cell;
}

describe('normalizeEvents', () => {
  it('reads a clean list unchanged', () => {
    const input = [event('a', '2026-02-12', 'Dentist'), event('b', '2026-02-17', 'Carnival lunch')];
    expect(normalizeEvents(input)).toEqual(input);
  });

  it('drops anything that is not an event', () => {
    const input = [
      null,
      42,
      'event',
      {},
      { id: 'no-date', text: 'text' },
      { id: 'bad-date', date: '2026-02-30', text: 'text' },
      { id: 'month-13', date: '2026-13-01', text: 'text' },
      { id: 'not-a-key', date: 'next tuesday', text: 'text' },
      { id: 'no-text', date: '2026-02-12' },
      { id: 'empty-text', date: '2026-02-12', text: '   ' },
      event('ok', '2026-02-12', 'Keep me'),
    ];
    expect(normalizeEvents(input)).toEqual([event('ok', '2026-02-12', 'Keep me')]);
  });

  it('answers an empty list for every unusable shape', () => {
    expect(normalizeEvents(undefined)).toEqual([]);
    expect(normalizeEvents(null)).toEqual([]);
    expect(normalizeEvents('2026-02-12')).toEqual([]);
    expect(normalizeEvents({ 0: event('a', '2026-02-12', 'x') })).toEqual([]);
    expect(normalizeEvents([])).toEqual([]);
  });

  it('gives a duplicated id a fresh one instead of colliding', () => {
    const normalized = normalizeEvents([
      event('dup', '2026-02-12', 'First'),
      event('dup', '2026-02-13', 'Second'),
      event('dup', '2026-02-14', 'Third'),
    ]);

    expect(normalized).toHaveLength(3);
    expect(new Set(normalized.map((entry) => entry.id)).size).toBe(3);
    expect(normalized.map((entry) => entry.text)).toEqual(['First', 'Second', 'Third']);
  });

  it('names an event that arrived without an id', () => {
    const [entry] = normalizeEvents([{ date: '2026-02-12', text: 'Dentist' }]);
    expect(entry.id).not.toBe('');
    expect(entry.id).toMatch(/^event/);
  });

  it('collapses text to one line and caps it', () => {
    const [long] = normalizeEvents([{ id: 'a', date: '2026-02-12', text: `  two\n\nlines  ` }]);
    expect(long.text).toBe('two lines');

    const [capped] = normalizeEvents([{ id: 'b', date: '2026-02-12', text: 'x'.repeat(400) }]);
    expect(capped.text).toHaveLength(MAX_EVENT_TEXT);
    expect(capped.text.endsWith('…')).toBe(true);
  });

  it('caps the list', () => {
    const many = Array.from({ length: MAX_EVENTS + 25 }, (_, index) =>
      event(`id-${index}`, '2026-02-12', `Event ${index}`),
    );
    const normalized = normalizeEvents(many);

    expect(normalized).toHaveLength(MAX_EVENTS);
    expect(normalized[0].text).toBe('Event 0');
    expect(normalized[MAX_EVENTS - 1].text).toBe(`Event ${MAX_EVENTS - 1}`);
  });

  it('never mutates its input', () => {
    const source = Object.freeze([
      Object.freeze({ id: 'dup', date: '2026-02-12', text: '  First  ' }),
      Object.freeze({ id: 'dup', date: '2026-02-12', text: 'Second' }),
    ]);
    const snapshot = JSON.parse(JSON.stringify(source));

    const normalized = normalizeEvents(source);

    expect(normalized).not.toBe(source);
    expect(normalized[0]).not.toBe(source[0]);
    expect(normalized[0].text).toBe('First');
    expect(source).toEqual(snapshot);
  });
});

describe('resolveWeekStart', () => {
  it('honours the explicit settings', () => {
    expect(resolveWeekStart('monday', 'en-US')).toBe(1);
    expect(resolveWeekStart('sunday', 'en-GB')).toBe(0);
  });

  it('follows the locale for auto', () => {
    expect(resolveWeekStart('auto', 'en-US')).toBe(0);
    expect(resolveWeekStart('auto', 'en-GB')).toBe(1);
    expect(resolveWeekStart('auto', 'en-GB')).toBe(weekStartFor('en-GB'));
  });

  it('falls back to the locale for a setting it does not know', () => {
    expect(resolveWeekStart('fortnightly' as CalendarWeekStart, 'en-US')).toBe(0);
  });
});

describe('eventsByDate', () => {
  it('groups events under their own day, in order', () => {
    const byDate = eventsByDate([
      event('a', '2026-02-12', 'Dentist'),
      event('b', '2026-02-17', 'Carnival lunch'),
      event('c', '2026-02-12', 'Call mum'),
    ]);

    expect([...byDate.keys()]).toEqual(['2026-02-12', '2026-02-17']);
    expect(byDate.get('2026-02-12')?.map((entry) => entry.text)).toEqual(['Dentist', 'Call mum']);
    expect(byDate.get('2026-02-17')?.map((entry) => entry.text)).toEqual(['Carnival lunch']);
    expect(byDate.get('2026-02-13')).toBeUndefined();
  });

  it('answers an empty map for no events', () => {
    expect(eventsByDate([]).size).toBe(0);
  });
});

describe('addEvent', () => {
  it('appends a cleaned event with a fresh id', () => {
    const before = [event('a', '2026-02-12', 'Dentist')];
    const after = addEvent(before, '2026-02-17', '  Carnival   lunch ');

    expect(after).toHaveLength(2);
    expect(after[0]).toBe(before[0]);
    expect(after[1].date).toBe('2026-02-17');
    expect(after[1].text).toBe('Carnival lunch');
    expect(after[1].id).not.toBe('');
    expect(after[1].id).not.toBe('a');
    expect(before).toHaveLength(1);
  });

  it('refuses an unreadable date, an empty line and a full list', () => {
    const before = [event('a', '2026-02-12', 'Dentist')];

    expect(addEvent(before, '2026-02-30', 'Nope')).toBe(before);
    expect(addEvent(before, 'whenever', 'Nope')).toBe(before);
    expect(addEvent(before, '2026-02-12', '   ')).toBe(before);

    const full = Array.from({ length: MAX_EVENTS }, (_, index) => event(`id-${index}`, '2026-02-12', 'x'));
    expect(addEvent(full, '2026-02-12', 'One too many')).toBe(full);
  });

  it('canonicalises a date that needed trimming', () => {
    const [added] = addEvent([], ' 2026-02-17 ', 'Carnival');
    expect(added.date).toBe('2026-02-17');
  });
});

describe('updateEvent', () => {
  it('rewrites one line and leaves the rest alone', () => {
    const before = [event('a', '2026-02-12', 'Dentist'), event('b', '2026-02-17', 'Carnival lunch')];
    const after = updateEvent(before, 'b', '  Carnival   dinner ');

    expect(after.map((entry) => entry.text)).toEqual(['Dentist', 'Carnival dinner']);
    expect(after[0]).toBe(before[0]);
    expect(before[1].text).toBe('Carnival lunch');
  });

  it('is a no-op for an unknown id', () => {
    const before = [event('a', '2026-02-12', 'Dentist')];
    expect(updateEvent(before, 'ghost', 'New text')).toBe(before);
  });

  it('removes the event when its text is cleared', () => {
    const before = [event('a', '2026-02-12', 'Dentist'), event('b', '2026-02-17', 'Carnival lunch')];
    expect(updateEvent(before, 'a', '   ').map((entry) => entry.id)).toEqual(['b']);
  });
});

describe('removeEvent', () => {
  it('removes one event', () => {
    const before = [event('a', '2026-02-12', 'Dentist'), event('b', '2026-02-17', 'Carnival lunch')];
    expect(removeEvent(before, 'a')).toEqual([before[1]]);
    expect(before).toHaveLength(2);
  });

  it('is a no-op for an unknown id', () => {
    const before = [event('a', '2026-02-12', 'Dentist')];
    expect(removeEvent(before, 'ghost')).toBe(before);
  });
});

describe('shiftMonth', () => {
  it('rolls over in both directions', () => {
    expect(shiftMonth(2026, 12, 1)).toEqual({ year: 2027, month: 1 });
    expect(shiftMonth(2026, 1, -1)).toEqual({ year: 2025, month: 12 });
    expect(shiftMonth(2026, 11, 1)).toEqual({ year: 2026, month: 12 });
    expect(shiftMonth(2026, 2, -1)).toEqual({ year: 2026, month: 1 });
  });

  it('moves by more than a year at a time', () => {
    expect(shiftMonth(2026, 3, -15)).toEqual({ year: 2024, month: 12 });
    expect(shiftMonth(2026, 1, 12)).toEqual({ year: 2027, month: 1 });
    expect(shiftMonth(2026, 5, 0)).toEqual({ year: 2026, month: 5 });
    expect(shiftMonth(2026, 5, 24)).toEqual({ year: 2028, month: 5 });
  });

  it('survives junk instead of producing an invalid date', () => {
    expect(shiftMonth(Number.NaN, Number.NaN, Number.NaN)).toEqual({ year: 1970, month: 1 });
  });
});

describe('monthTitle', () => {
  it('names the month and the year', () => {
    expect(monthTitle(2026, 2, 'en-GB')).toBe('February 2026');
    expect(monthTitle(2026, 12, 'en-GB')).toBe('December 2026');
    expect(monthTitle(2028, 2, 'en-GB')).toBe('February 2028');
  });

  it('honours the locale', () => {
    expect(monthTitle(2026, 2, 'de-DE')).toBe('Februar 2026');
  });
});

describe('weekdayLabels', () => {
  it('rotates to the requested week start', () => {
    expect(weekdayLabels(1, 'en-GB')).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
    expect(weekdayLabels(0, 'en-GB')).toEqual(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']);
  });

  it('always answers seven distinct labels', () => {
    for (const weekStart of [0, 1] as const) {
      const labels = weekdayLabels(weekStart, 'en-GB');
      expect(labels).toHaveLength(7);
      expect(new Set(labels).size).toBe(7);
    }
  });
});

describe('buildMonth', () => {
  const options = {
    weekStart: 1 as const,
    today: '2026-02-12',
    events: new Map<string, CalendarEvent[]>(),
    holidays: new Map<string, Holiday[]>(),
  };

  it('is always six weeks of seven days', () => {
    const grid = buildMonth(2026, 2, options);

    expect(grid.weeks).toHaveLength(6);
    for (const week of grid.weeks) expect(week).toHaveLength(7);
    expect(grid.weekNumbers).toHaveLength(6);
    expect(new Set(grid.weeks.flat().map((cell) => cell.key)).size).toBe(42);
  });

  it('aligns the ISO week numbers with the rows', () => {
    const grid = buildMonth(2026, 2, options);

    // 26 January 2026 opens ISO week 5, and the six rows run to week 10.
    expect(grid.weekNumbers).toEqual([5, 6, 7, 8, 9, 10]);
    expect(isoWeek(parseDayKey(grid.weeks[0][0].key) as Date)).toBe(grid.weekNumbers[0]);
  });

  it('marks the borrowed days of a month that starts on a Sunday', () => {
    // 1 February 2026 is a Sunday, so a Monday-start grid opens on 26 January.
    const monday = buildMonth(2026, 2, options);
    expect(monday.weeks[0][0].key).toBe('2026-01-26');
    expect(monday.weeks[0][0].inMonth).toBe(false);
    expect(monday.weeks[0][5].key).toBe('2026-01-31');
    expect(monday.weeks[0][5].inMonth).toBe(false);
    expect(monday.weeks[0][6].key).toBe('2026-02-01');
    expect(monday.weeks[0][6].inMonth).toBe(true);

    const sunday = buildMonth(2026, 2, { ...options, weekStart: 0 });
    expect(sunday.weeks[0][0].key).toBe('2026-02-01');
    expect(sunday.weeks[0][0].inMonth).toBe(true);
    expect(sunday.weeks[5][6].key).toBe('2026-03-14');
    expect(sunday.weeks[5][6].inMonth).toBe(false);
  });

  it('counts the days of a leap February', () => {
    const leap = buildMonth(2028, 2, { ...options, today: '2028-02-29' });
    const inMonth = leap.weeks.flat().filter((cell) => cell.inMonth);

    expect(inMonth).toHaveLength(29);
    expect(inMonth[inMonth.length - 1].key).toBe('2028-02-29');
    expect(cellAt(leap.weeks, '2028-02-29').isToday).toBe(true);
    expect(cellAt(leap.weeks, '2028-02-29').day).toBe(29);
  });

  it('marks today once and only inside the grid', () => {
    const grid = buildMonth(2026, 2, options);
    const today = grid.weeks.flat().filter((cell) => cell.isToday);

    expect(today).toHaveLength(1);
    expect(today[0].key).toBe('2026-02-12');

    const elsewhere = buildMonth(2026, 2, { ...options, today: '2026-03-20' });
    expect(elsewhere.weeks.flat().some((cell) => cell.isToday)).toBe(false);
  });

  it('marks weekends whichever day the week starts on', () => {
    // 31 January 2026 is a Saturday and 1 February a Sunday.
    const monday = buildMonth(2026, 2, options);
    expect(monday.weeks[0][5].isWeekend).toBe(true);
    expect(monday.weeks[0][6].isWeekend).toBe(true);
    expect(monday.weeks[0][0].isWeekend).toBe(false);

    const sunday = buildMonth(2026, 2, { ...options, weekStart: 0 });
    expect(sunday.weeks[0][0].isWeekend).toBe(true);
    expect(sunday.weeks[0][1].isWeekend).toBe(false);
    expect(sunday.weeks[0][6].isWeekend).toBe(true);
  });

  it('attaches the day’s events and holidays to its cell', () => {
    const events = eventsByDate([
      event('a', '2026-02-12', 'Dentist'),
      event('b', '2026-02-12', 'Call mum'),
      event('c', '2026-02-13', 'Lunch'),
    ]);
    const holidays = new Map([['2026-02-12', [holiday('2026-02-12', 'Carnival', 'Carnaval')]]]);

    const grid = buildMonth(2026, 2, { ...options, events, holidays, locale: 'en-GB' });

    expect(cellAt(grid.weeks, '2026-02-12').events.map((entry) => entry.text)).toEqual(['Dentist', 'Call mum']);
    expect(cellAt(grid.weeks, '2026-02-12').holidays.map((entry) => entry.name)).toEqual(['Carnival']);
    expect(cellAt(grid.weeks, '2026-02-13').events).toHaveLength(1);
    expect(cellAt(grid.weeks, '2026-02-13').holidays).toEqual([]);
  });

  it('builds the accessible label from the date, the events and the holidays', () => {
    const events = eventsByDate([
      event('a', '2026-02-12', 'Dentist'),
      event('b', '2026-02-12', 'Call mum'),
    ]);
    const holidays = new Map([['2026-02-12', [holiday('2026-02-12', 'Carnival', 'Carnaval')]]]);
    const grid = buildMonth(2026, 2, { ...options, events, holidays, locale: 'en-GB' });

    expect(cellAt(grid.weeks, '2026-02-12').label).toBe(
      '12 February 2026, 2 events, public holiday: Carnival',
    );
    expect(cellAt(grid.weeks, '2026-02-11').label).toBe('11 February 2026');
  });

  it('reads the singular and the plural of both annotations', () => {
    const events = eventsByDate([event('a', '2026-02-12', 'Dentist')]);
    const holidays = new Map([
      [
        '2026-02-12',
        [holiday('2026-02-12', 'Carnival', 'Carnaval'), holiday('2026-02-12', 'Family Day')],
      ],
    ]);
    const grid = buildMonth(2026, 2, { ...options, events, holidays, locale: 'en-GB' });

    expect(cellAt(grid.weeks, '2026-02-12').label).toBe(
      '12 February 2026, 1 event, public holidays: Carnival, Family Day',
    );
  });

  it('has an empty-holiday path that leaves the cells bare', () => {
    const grid = buildMonth(2026, 2, { ...options, locale: 'en-GB' });

    for (const cell of grid.weeks.flat()) {
      expect(cell.holidays).toEqual([]);
      expect(cell.events).toEqual([]);
      expect(cell.label).not.toContain('public holiday');
      expect(cell.label).not.toContain('event');
    }
  });
});
