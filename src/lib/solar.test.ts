import { describe, expect, it } from 'vitest';
import { daylightProgress, solarTimes } from '@/lib/solar';

/**
 * Published sun times, as whole minutes on the location's own clock.
 *
 * They come from the US Naval Observatory's Astronomical Applications API
 * (`https://aa.usno.navy.mil/api/rstt/oneday`), cross-checked against
 * timeanddate's tables, which agree to the minute. The equator case is worth
 * spelling out: USNO reports 06:04/18:11 UTC for 2026-03-20, not the
 * 05:58/18:02 a symmetric "12:00 ± 6 h plus refraction" estimate suggests —
 * the equation of time is about +7 minutes in late March, and the sun keeps
 * civil time rather than mean time.
 */
const TOLERANCE_MINUTES = 8;

const LONDON = { latitude: 51.5074, longitude: -0.1278 };
const SYDNEY = { latitude: -33.8688, longitude: 151.2093 };
const TROMSO = { latitude: 69.6492, longitude: 18.9553 };
const EQUATOR = { latitude: 0, longitude: 0 };

/** Minutes past local midnight on `timeZone`'s wall clock. */
function minutesOfDay(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const read = (type: Intl.DateTimeFormatPartTypes): number => Number(parts.find((part) => part.type === type)?.value);
  return read('hour') * 60 + read('minute');
}

/** `YYYY-MM-DD` on `timeZone`'s calendar. */
function dayKey(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

/** Fail loudly rather than assert through a possibly-null event. */
function instant(date: Date | null): Date {
  if (!date) throw new Error('expected an instant, got null');
  return date;
}

function expectMinutesClose(actual: Date | null, expectedMinutes: number, timeZone: string): void {
  const local = minutesOfDay(instant(actual), timeZone);
  expect(Math.abs(local - expectedMinutes)).toBeLessThanOrEqual(TOLERANCE_MINUTES);
}

const at = (isoDay: string): Date => new Date(`${isoDay}T12:00:00Z`);

describe('solarTimes', () => {
  it('matches USNO for London at the June solstice', () => {
    const times = solarTimes(at('2026-06-21'), LONDON.latitude, LONDON.longitude, 'Europe/London');

    expectMinutesClose(times.sunrise, 4 * 60 + 43, 'Europe/London');
    expectMinutesClose(times.sunset, 21 * 60 + 21, 'Europe/London');
    // Civil twilight at both ends of the day; refraction is why they differ
    // from sunrise/sunset by minutes rather than by nothing.
    expectMinutesClose(times.civilDawn, 3 * 60 + 55, 'Europe/London');
    expectMinutesClose(times.civilDusk, 22 * 60 + 9, 'Europe/London');
    expect(times.polarDay).toBe(false);
    expect(times.polarNight).toBe(false);
    expect(Math.abs(times.daylightMinutes - 998)).toBeLessThanOrEqual(TOLERANCE_MINUTES);
  });

  it('matches USNO for London at the December solstice', () => {
    const times = solarTimes(at('2026-12-21'), LONDON.latitude, LONDON.longitude, 'Europe/London');

    expectMinutesClose(times.sunrise, 8 * 60 + 4, 'Europe/London');
    expectMinutesClose(times.sunset, 15 * 60 + 53, 'Europe/London');
    expect(Math.abs(times.daylightMinutes - 469)).toBeLessThanOrEqual(TOLERANCE_MINUTES);
    expect(instant(times.sunset).getTime()).toBeGreaterThan(instant(times.sunrise).getTime());
  });

  it('matches USNO on the equator at the March equinox, where refraction stretches the day', () => {
    const times = solarTimes(at('2026-03-20'), EQUATOR.latitude, EQUATOR.longitude, 'UTC');

    expectMinutesClose(times.sunrise, 6 * 60 + 4, 'UTC');
    expectMinutesClose(times.sunset, 18 * 60 + 11, 'UTC');
    // 12 h plus the ~7 minutes the refracted disc spends above the horizon.
    expect(times.daylightMinutes).toBeGreaterThan(720);
    expect(times.daylightMinutes).toBeLessThanOrEqual(12 * 60 + 15);
  });

  it('matches USNO for Sydney at the June solstice (southern winter)', () => {
    const times = solarTimes(at('2026-06-21'), SYDNEY.latitude, SYDNEY.longitude, 'Australia/Sydney');

    expectMinutesClose(times.sunrise, 7 * 60 + 1, 'Australia/Sydney');
    expectMinutesClose(times.sunset, 16 * 60 + 54, 'Australia/Sydney');
    expect(times.daylightMinutes).toBeLessThan(10 * 60);
  });

  it('reports polar day at Tromsø in June, with no sunrise or sunset', () => {
    const times = solarTimes(at('2026-06-21'), TROMSO.latitude, TROMSO.longitude, 'Europe/Oslo');

    expect(times.polarDay).toBe(true);
    expect(times.polarNight).toBe(false);
    expect(times.sunrise).toBeNull();
    expect(times.sunset).toBeNull();
    expect(times.daylightMinutes).toBe(1440);
    // The midnight sun never reaches the horizon, so there is no bounded
    // evening golden hour either, even though it does dip to 6° altitude.
    expect(times.goldenHourStart).toBeNull();
    expect(times.goldenHourEnd).toBeNull();
    // Solar noon still exists: USNO gives the upper transit at 12:46 local.
    expectMinutesClose(times.solarNoon, 12 * 60 + 46, 'Europe/Oslo');
  });

  it('reports polar night at Tromsø in December, where civil twilight still happens', () => {
    const times = solarTimes(at('2026-12-21'), TROMSO.latitude, TROMSO.longitude, 'Europe/Oslo');

    expect(times.polarNight).toBe(true);
    expect(times.polarDay).toBe(false);
    expect(times.sunrise).toBeNull();
    expect(times.sunset).toBeNull();
    expect(times.daylightMinutes).toBe(0);
    expect(times.goldenHourStart).toBeNull();
    // 6° below the horizon is reached even when 0° is not: USNO lists civil
    // twilight from 09:31 to 13:53.
    expectMinutesClose(times.civilDawn, 9 * 60 + 31, 'Europe/Oslo');
    expectMinutesClose(times.civilDusk, 13 * 60 + 53, 'Europe/Oslo');
  });

  it('puts solar noon between sunrise and sunset, at the longitude’s own noon', () => {
    const cases = [
      { ...LONDON, zone: 'Europe/London', day: '2026-06-21' },
      { ...LONDON, zone: 'Europe/London', day: '2026-12-21' },
      { ...SYDNEY, zone: 'Australia/Sydney', day: '2026-06-21' },
      { latitude: 35.6762, longitude: 139.6503, zone: 'Asia/Tokyo', day: '2026-06-21' },
      { ...EQUATOR, zone: 'UTC', day: '2026-03-20' },
    ];

    for (const { latitude, longitude, zone, day } of cases) {
      const times = solarTimes(at(day), latitude, longitude, zone);
      const sunrise = instant(times.sunrise);
      const sunset = instant(times.sunset);
      const noon = times.solarNoon;

      expect(noon.getTime()).toBeGreaterThan(sunrise.getTime());
      expect(noon.getTime()).toBeLessThan(sunset.getTime());
      // Sunrise and sunset are symmetric about it, by construction.
      expect(Math.abs(noon.getTime() - (sunrise.getTime() + sunset.getTime()) / 2)).toBeLessThanOrEqual(60_000);
      // Minutes past UTC midnight, compared with the longitude's mean noon:
      // the difference is the equation of time, which never exceeds ~17 minutes.
      const utcMinutes = noon.getUTCHours() * 60 + noon.getUTCMinutes() + noon.getUTCSeconds() / 60;
      expect(Math.abs(utcMinutes - (720 - 4 * longitude))).toBeLessThanOrEqual(20);
    }
  });

  it('places the evening golden hour between solar noon and sunset', () => {
    const times = solarTimes(at('2026-06-21'), LONDON.latitude, LONDON.longitude, 'Europe/London');
    const start = instant(times.goldenHourStart);
    const sunset = instant(times.sunset);

    expect(start.getTime()).toBeGreaterThan(times.solarNoon.getTime());
    expect(start.getTime()).toBeLessThan(sunset.getTime());
    expect(times.goldenHourEnd?.getTime()).toBe(sunset.getTime());
    // The 6°-to-horizon window is a small slice of a long midsummer evening.
    const goldenMinutes = (sunset.getTime() - start.getTime()) / 60_000;
    expect(goldenMinutes).toBeGreaterThan(20);
    expect(goldenMinutes).toBeLessThan(90);
  });

  it('keeps a just-after-midnight sunset on the day it belongs to', () => {
    // Reykjavík's midsummer sun sets at 00:04 — already the next local date.
    // USNO still lists it as 21 June's sunset (02:55 rise, 00:04 set), and the
    // daylight window runs 21 h 10 min across the midnight boundary.
    const times = solarTimes(at('2026-06-21'), 64.1466, -21.9426, 'Atlantic/Reykjavik');

    expect(dayKey(instant(times.sunrise), 'Atlantic/Reykjavik')).toBe('2026-06-21');
    expect(dayKey(instant(times.sunset), 'Atlantic/Reykjavik')).toBe('2026-06-22');
    expect(Math.abs(times.daylightMinutes - (21 * 60 + 10))).toBeLessThanOrEqual(TOLERANCE_MINUTES);
  });

  it('selects the calendar day from the time zone', () => {
    // 05:00 on 21 June in Tokyo, but still 20 June in UTC (and in the host zone).
    const evening = new Date('2026-06-20T20:00:00Z');
    const tokyo = solarTimes(evening, 35.6762, 139.6503, 'Asia/Tokyo');

    expect(evening.toISOString().slice(0, 10)).toBe('2026-06-20');
    expect(dayKey(instant(tokyo.sunrise), 'Asia/Tokyo')).toBe('2026-06-21');
    // USNO: sunrise 04:26 and sunset 19:00 on Tokyo's clock.
    expectMinutesClose(tokyo.sunrise, 4 * 60 + 26, 'Asia/Tokyo');
    expectMinutesClose(tokyo.sunset, 19 * 60, 'Asia/Tokyo');
    // Tokyo's 21st is still the 20th in UTC, so the instant is a day earlier.
    expect(dayKey(instant(tokyo.sunrise), 'UTC')).toBe('2026-06-20');
  });

  it('clamps latitude, wraps longitude and survives an unknown zone', () => {
    const day = at('2026-06-21');
    // 95° north has no meaning beyond the pole, so it reads as the pole itself.
    const pole = solarTimes(day, 90, 0, 'UTC');
    const clamped = solarTimes(day, 95, 0, 'UTC');
    expect(clamped.polarDay).toBe(pole.polarDay);
    expect(clamped.daylightMinutes).toBe(pole.daylightMinutes);
    expect(clamped.sunrise).toBeNull();

    // 400° east is 40° east.
    const wrapped = solarTimes(day, LONDON.latitude, 400, 'Europe/London');
    const expected = solarTimes(day, LONDON.latitude, 40, 'Europe/London');
    expect(wrapped.sunrise?.getTime()).toBe(expected.sunrise?.getTime());
    expect(wrapped.solarNoon.getTime()).toBe(expected.solarNoon.getTime());

    // An unknown IANA zone falls back to the host's own day instead of throwing.
    const bogus = solarTimes(day, LONDON.latitude, LONDON.longitude, 'Mars/Olympus_Mons');
    const host = solarTimes(day, LONDON.latitude, LONDON.longitude);
    expect(bogus.sunrise?.getTime()).toBe(host.sunrise?.getTime());
    expect(bogus.solarNoon.getTime()).toBe(host.solarNoon.getTime());
  });

  it('stays total for an invalid date and non-finite coordinates', () => {
    const times = solarTimes(new Date(Number.NaN), Number.NaN, Number.NaN);

    expect(Number.isFinite(times.solarNoon.getTime())).toBe(true);
    expect(Number.isFinite(instant(times.sunrise).getTime())).toBe(true);
  });
});

describe('daylightProgress', () => {
  const times = solarTimes(at('2026-06-21'), LONDON.latitude, LONDON.longitude, 'Europe/London');

  it('runs from 0 at sunrise through 0.5 at solar noon to 1 at sunset', () => {
    const sunrise = instant(times.sunrise);
    const sunset = instant(times.sunset);

    expect(daylightProgress(times, sunrise)).toBeCloseTo(0, 6);
    expect(daylightProgress(times, times.solarNoon)).toBeCloseTo(0.5, 2);
    expect(daylightProgress(times, sunset)).toBeCloseTo(1, 6);

    const quarter = new Date((sunrise.getTime() + times.solarNoon.getTime()) / 2);
    expect(daylightProgress(times, quarter)).toBeCloseTo(0.25, 2);
  });

  it('clamps outside the daylight window and ignores an invalid instant', () => {
    const sunrise = instant(times.sunrise);
    const sunset = instant(times.sunset);
    const hour = 3_600_000;

    expect(daylightProgress(times, new Date(sunrise.getTime() - 3 * hour))).toBe(0);
    expect(daylightProgress(times, new Date(sunset.getTime() + 3 * hour))).toBe(1);
    expect(daylightProgress(times, new Date(Number.NaN))).toBeNull();
  });

  it('is null when the sun does not rise or set', () => {
    const polarDay = solarTimes(at('2026-06-21'), TROMSO.latitude, TROMSO.longitude, 'Europe/Oslo');
    const polarNight = solarTimes(at('2026-12-21'), TROMSO.latitude, TROMSO.longitude, 'Europe/Oslo');

    expect(daylightProgress(polarDay, at('2026-06-21'))).toBeNull();
    expect(daylightProgress(polarNight, at('2026-12-21'))).toBeNull();
  });
});
