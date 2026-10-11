import { afterAll, describe, expect, it } from 'vitest';
import {
  addDays,
  addMonths,
  dayKey,
  daysBetween,
  daysUntil,
  daysInMonth,
  formatClock,
  formatDuration,
  formatOffset,
  isValidDayKey,
  isoWeek,
  monthMatrix,
  parseDayKey,
  relativeDayLabel,
  startOfDay,
  startOfMonth,
  toDayKey,
  weekStartFor,
  zoneOffsetMinutes,
} from '@/lib/time';

const originalTimeZone = process.env.TZ;

afterAll(() => {
  process.env.TZ = originalTimeZone;
});

describe('day keys', () => {
  it('formats a local day key, not a UTC one', () => {
    // 23:30 local on the 31st must stay the 31st even east of UTC.
    process.env.TZ = 'Asia/Tokyo';
    expect(dayKey(new Date(2026, 0, 31, 23, 30))).toBe('2026-01-31');
    process.env.TZ = 'America/Los_Angeles';
    // 00:30 local on the 1st must not fall back to the previous UTC day.
    expect(dayKey(new Date(2026, 2, 1, 0, 30))).toBe('2026-03-01');
    process.env.TZ = originalTimeZone;
  });

  it('parses a key into local midnight', () => {
    const parsed = parseDayKey('2026-06-15');
    expect(parsed).not.toBeNull();
    expect(parsed?.getFullYear()).toBe(2026);
    expect(parsed?.getMonth()).toBe(5);
    expect(parsed?.getDate()).toBe(15);
    expect(parsed?.getHours()).toBe(0);
  });

  it('rejects malformed and impossible keys', () => {
    for (const key of ['', '2026-6-15', '2026/06/15', 'yesterday', '2026-13-01', '2026-02-30', '2026-00-10']) {
      expect(isValidDayKey(key), key).toBe(false);
      expect(parseDayKey(key), key).toBeNull();
    }
    // A real leap day is fine; a fake one is not.
    expect(isValidDayKey('2024-02-29')).toBe(true);
    expect(isValidDayKey('2026-02-29')).toBe(false);
  });

  it('accepts either a key or an instant', () => {
    expect(toDayKey('2026-06-15')).toBe('2026-06-15');
    expect(toDayKey(new Date(2026, 5, 15, 13, 0))).toBe('2026-06-15');
    expect(toDayKey('nope')).toBeNull();
    expect(toDayKey(new Date('nope'))).toBeNull();
  });
});

describe('calendar arithmetic', () => {
  it('counts whole days across a DST change', () => {
    // US DST starts on 2026-03-08: that local day is 23 hours long.
    process.env.TZ = 'America/New_York';
    expect(daysBetween('2026-03-07', '2026-03-09')).toBe(2);
    expect(daysBetween('2026-03-09', '2026-03-07')).toBe(-2);
    // And the autumn change, where the day is 25 hours long.
    expect(daysBetween('2026-10-31', '2026-11-02')).toBe(2);
    process.env.TZ = originalTimeZone;
  });

  it('counts days across month, year and leap boundaries', () => {
    expect(daysBetween('2026-01-31', '2026-02-01')).toBe(1);
    expect(daysBetween('2026-12-31', '2027-01-01')).toBe(1);
    expect(daysBetween('2024-02-28', '2024-03-01')).toBe(2);
    expect(daysBetween('2026-02-28', '2026-03-01')).toBe(1);
    expect(daysBetween('2026-06-15', '2026-06-15')).toBe(0);
  });

  it('returns null for unusable input rather than NaN', () => {
    expect(daysBetween('nope', '2026-06-15')).toBeNull();
    expect(daysUntil('2026-06-15', 'also-nope')).toBeNull();
  });

  it('adds days without DST drift', () => {
    process.env.TZ = 'America/New_York';
    const start = new Date(2026, 2, 7, 12, 0);
    const later = addDays(start, 2);
    expect(dayKey(later)).toBe('2026-03-09');
    expect(later.getHours()).toBe(0);
    process.env.TZ = originalTimeZone;
  });

  it('normalises to the start of the day and month', () => {
    const date = new Date(2026, 5, 15, 18, 45, 30);
    expect(startOfDay(date).getHours()).toBe(0);
    expect(dayKey(startOfMonth(date))).toBe('2026-06-01');
    expect(dayKey(addMonths(date, 1))).toBe('2026-07-01');
    expect(dayKey(addMonths(date, -6))).toBe('2025-12-01');
    // 31 January is the classic `setMonth` overflow trap.
    expect(dayKey(addMonths(new Date(2026, 0, 31), 1))).toBe('2026-02-01');
  });

  it('knows how long each month is', () => {
    expect(daysInMonth(2026, 2)).toBe(28);
    expect(daysInMonth(2024, 2)).toBe(29);
    expect(daysInMonth(2026, 4)).toBe(30);
    expect(daysInMonth(2026, 12)).toBe(31);
  });

  it('labels relative days', () => {
    expect(relativeDayLabel(0)).toBe('Today');
    expect(relativeDayLabel(1)).toBe('Tomorrow');
    expect(relativeDayLabel(-1)).toBe('Yesterday');
    expect(relativeDayLabel(5)).toBe('in 5 days');
    expect(relativeDayLabel(-3)).toBe('3 days ago');
  });
});

describe('monthMatrix', () => {
  it('always produces six full weeks', () => {
    for (let month = 1; month <= 12; month += 1) {
      const weeks = monthMatrix(2026, month, 1);
      expect(weeks).toHaveLength(6);
      for (const week of weeks) expect(week).toHaveLength(7);
    }
  });

  it('includes exactly the days of the month', () => {
    const weeks = monthMatrix(2026, 2, 1);
    const inMonth = weeks.flat().filter((cell) => cell.inMonth);
    expect(inMonth).toHaveLength(28);
    expect(inMonth[0].key).toBe('2026-02-01');
    expect(inMonth[27].key).toBe('2026-02-28');

    const leap = monthMatrix(2024, 2, 1).flat().filter((cell) => cell.inMonth);
    expect(leap).toHaveLength(29);
  });

  it('aligns the first cell to the requested week start', () => {
    // 2026-02-01 is a Sunday.
    const monday = monthMatrix(2026, 2, 1);
    expect(monday[0][0].key).toBe('2026-01-26');
    expect(monday[0][0].date.getDay()).toBe(1);

    const sunday = monthMatrix(2026, 2, 0);
    expect(sunday[0][0].key).toBe('2026-02-01');
    expect(sunday[0][0].date.getDay()).toBe(0);
  });

  it('covers every day of the month contiguously', () => {
    const cells = monthMatrix(2026, 3, 1).flat();
    for (let index = 1; index < cells.length; index += 1) {
      expect(daysBetween(cells[index - 1].key, cells[index].key)).toBe(1);
    }
  });
});

describe('isoWeek', () => {
  it('matches the published ISO week numbers', () => {
    // 2021-01-01 was a Friday, so it belongs to the last week of 2020.
    expect(isoWeek(new Date(2021, 0, 1))).toBe(53);
    expect(isoWeek(new Date(2021, 0, 4))).toBe(1);
    expect(isoWeek(new Date(2020, 11, 31))).toBe(53);
    expect(isoWeek(new Date(2026, 0, 1))).toBe(1);
    expect(isoWeek(new Date(2026, 0, 5))).toBe(2);
  });

  it('is stable across a whole year', () => {
    const weeks = new Set<number>();
    for (let day = 0; day < 365; day += 1) weeks.add(isoWeek(addDays(new Date(2026, 0, 1), day)));
    expect(Math.min(...weeks)).toBe(1);
    expect(Math.max(...weeks)).toBeGreaterThanOrEqual(52);
  });
});

describe('weekStartFor', () => {
  it('reads the locale week start where the runtime exposes it', () => {
    expect(weekStartFor('en-US')).toBe(0);
    expect(weekStartFor('de-DE')).toBe(1);
    expect(weekStartFor('en-GB')).toBe(1);
  });

  it('falls back to Monday for a tag it cannot read', () => {
    expect(weekStartFor('not a locale tag')).toBe(1);
    expect(weekStartFor('')).toBe(1);
  });
});

describe('zoneOffsetMinutes', () => {
  it('handles whole-hour zones', () => {
    expect(zoneOffsetMinutes(new Date(Date.UTC(2026, 0, 15, 12)), 'Europe/Berlin')).toBe(60);
    expect(zoneOffsetMinutes(new Date(Date.UTC(2026, 6, 15, 12)), 'Europe/Berlin')).toBe(120);
    expect(zoneOffsetMinutes(new Date(Date.UTC(2026, 0, 15, 12)), 'UTC')).toBe(0);
  });

  it('handles half-hour zones', () => {
    expect(zoneOffsetMinutes(new Date(Date.UTC(2026, 0, 15, 12)), 'Asia/Kolkata')).toBe(330);
    expect(zoneOffsetMinutes(new Date(Date.UTC(2026, 6, 15, 12)), 'Australia/Adelaide')).toBe(570);
  });

  it('follows a DST transition hour by hour', () => {
    // New York springs forward at 07:00 UTC on 2026-03-08.
    expect(zoneOffsetMinutes(new Date(Date.UTC(2026, 2, 8, 6)), 'America/New_York')).toBe(-300);
    expect(zoneOffsetMinutes(new Date(Date.UTC(2026, 2, 8, 12)), 'America/New_York')).toBe(-240);
    // Berlin springs forward at 01:00 UTC on 2026-03-29.
    expect(zoneOffsetMinutes(new Date(Date.UTC(2026, 2, 29, 0, 30)), 'Europe/Berlin')).toBe(60);
    expect(zoneOffsetMinutes(new Date(Date.UTC(2026, 2, 29, 1, 30)), 'Europe/Berlin')).toBe(120);
  });

  it('returns 0 rather than throwing for an unknown zone', () => {
    expect(zoneOffsetMinutes(new Date(), 'Mars/Olympus')).toBe(0);
  });
});

describe('formatting', () => {
  it('formats durations compactly', () => {
    expect(formatDuration(0)).toBe('0s');
    expect(formatDuration(42_000)).toBe('42s');
    expect(formatDuration(63_000)).toBe('1m 03s');
    expect(formatDuration(2 * 3_600_000 + 5 * 60_000)).toBe('2h 05m');
    // Negatives and rubbish clamp instead of rendering nonsense.
    expect(formatDuration(-5000)).toBe('0s');
    expect(formatDuration(Number.NaN)).toBe('0s');
    expect(formatDuration(Number.POSITIVE_INFINITY)).toBe('0s');
  });

  it('formats clock durations', () => {
    expect(formatClock(0)).toBe('00:00');
    expect(formatClock(9_000)).toBe('00:09');
    expect(formatClock(65_000)).toBe('01:05');
    expect(formatClock(3_600_000 + 5 * 60_000 + 9_000)).toBe('1:05:09');
    expect(formatClock(-1)).toBe('00:00');
  });

  it('formats time-zone offsets', () => {
    expect(formatOffset(0)).toBe('same time');
    expect(formatOffset(60)).toBe('+1h');
    expect(formatOffset(-300)).toBe('−5h');
    expect(formatOffset(330)).toBe('+5:30');
    expect(formatOffset(-45)).toBe('−45m');
  });
});
