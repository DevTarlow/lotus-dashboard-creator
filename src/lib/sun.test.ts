import { describe, expect, it } from 'vitest';
import type { GeoPlace } from '@/lib/geocode';
import { placeLabel } from '@/lib/geocode';
import { solarTimes } from '@/lib/solar';
import { addDays } from '@/lib/time';
import {
  buildSunDay,
  daylightDelta,
  formatDaylightDelta,
  formatDaylightShort,
  formatZoneTime,
  rememberPlace,
  resolvedPlaceFor,
  sunSummarize,
  type SunDay,
} from '@/lib/sun';

/**
 * The assertions below deliberately compare against `solarTimes` output rather
 * than hand-typed times. `solar.ts` is already verified against the US Naval
 * Observatory, so re-typing "06:11" here would add a second, weaker copy of that
 * fixture and would break for the wrong reason if the solar model is ever tuned.
 * What is under test in *this* file is the formatting and the polar wording —
 * chiefly that a time is rendered in the place's zone, not the host's.
 */

function place(name: string, latitude: number, longitude: number, timeZone: string): GeoPlace {
  return { name, country: 'Portugal', admin1: null, latitude, longitude, timeZone, population: null };
}

const LISBON = place('Lisbon', 38.7167, -9.1333, 'Europe/Lisbon');
const TROMSO = { ...place('Tromsø', 69.6492, 18.9553, 'Europe/Oslo'), country: 'Norway' };

/** Midday UTC, so the instant sits on the intended date for every zone tested. */
const at = (day: string): Date => new Date(`${day}T12:00:00Z`);

/** The same wall-clock string the module promises, built independently here. */
function zoneClock(date: Date | null, timeZone: string, hour12 = false): string {
  if (!date) return '—';
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    // `2-digit` in the 24-hour case: ICU leaves a `numeric` hour unpadded under
    // `h23`, so this is what keeps midnight reading "00:00".
    hour: hour12 ? 'numeric' : '2-digit',
    minute: '2-digit',
    ...(hour12 ? { hour12: true } : { hourCycle: 'h23' as const }),
  }).format(date);
}

/** Minutes as the label spells them: "14h 53m". */
function expectedDaylight(minutes: number): string {
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`;
}

/** Fail loudly rather than assert through a possibly-null field. */
function sunDay(day: SunDay | null): SunDay {
  if (!day) throw new Error('expected a SunDay');
  return day;
}

describe('buildSunDay', () => {
  it('labels a Lisbon summer day in the place’s own zone', () => {
    const now = at('2026-06-21');
    const day = buildSunDay(LISBON, now);
    const times = solarTimes(now, LISBON.latitude, LISBON.longitude, LISBON.timeZone);

    expect(day.times.polarDay).toBe(false);
    expect(day.times.polarNight).toBe(false);
    expect(day.sunriseLabel).toBe(zoneClock(times.sunrise, LISBON.timeZone));
    expect(day.sunsetLabel).toBe(zoneClock(times.sunset, LISBON.timeZone));
    expect(day.solarNoonLabel).toBe(zoneClock(times.solarNoon, LISBON.timeZone));
    // 24-hour labels are zero-padded; a bare "6:11" would mean the wrong locale.
    expect(day.sunriseLabel).toMatch(/^\d{2}:\d{2}$/);
    expect(day.daylightLabel).toBe(expectedDaylight(times.daylightMinutes));
    expect(day.daylightLabel).toMatch(/^\d{1,2}h \d{2}m$/);
    expect(day.polarNote).toBeNull();
    expect(day.progress).toBeGreaterThanOrEqual(0);
    expect(day.progress).toBeLessThanOrEqual(1);
    expect(day.moon.label).not.toBe('');
  });

  it('labels a Lisbon winter day, which is shorter than the summer one', () => {
    const now = at('2026-12-21');
    const day = buildSunDay(LISBON, now);
    const times = solarTimes(now, LISBON.latitude, LISBON.longitude, LISBON.timeZone);

    expect(day.daylightLabel).toBe(expectedDaylight(times.daylightMinutes));
    expect(times.daylightMinutes).toBeLessThan(12 * 60);
    // The solstice is the turning point of the year, so the difference against
    // the previous day is under a minute and rounds away — an honest "same as
    // yesterday" rather than a made-up figure.
    expect(day.daylightDeltaMinutes).toBe(0);
    expect(formatDaylightDelta(day.daylightDeltaMinutes ?? 0)).toBe('Same as yesterday');
    expect(day.polarNote).toBeNull();
  });

  it('reports the daylight the day lost once the year is well past the solstice', () => {
    // 15 November in Lisbon is on the steep part of the curve, losing a couple
    // of minutes a day — the case the "less daylight than yesterday" line is for.
    const now = at('2026-11-15');
    const day = buildSunDay(LISBON, now);
    const times = solarTimes(now, LISBON.latitude, LISBON.longitude, LISBON.timeZone);
    const yesterday = solarTimes(addDays(now, -1), LISBON.latitude, LISBON.longitude, LISBON.timeZone);

    expect(day.daylightDeltaMinutes).toBe(times.daylightMinutes - yesterday.daylightMinutes);
    expect(day.daylightDeltaMinutes).toBeLessThan(0);
    expect(formatDaylightDelta(day.daylightDeltaMinutes ?? 0)).toMatch(/^\d+m less daylight than yesterday$/);
  });

  it('reports the daylight gained in spring, when the minutes come back', () => {
    const now = at('2026-03-21');
    const day = buildSunDay(LISBON, now);
    const times = solarTimes(now, LISBON.latitude, LISBON.longitude, LISBON.timeZone);
    const yesterday = solarTimes(addDays(now, -1), LISBON.latitude, LISBON.longitude, LISBON.timeZone);

    expect(day.daylightDeltaMinutes).toBe(times.daylightMinutes - yesterday.daylightMinutes);
    expect(day.daylightDeltaMinutes).toBeGreaterThan(0);
  });

  it('switches to a 12-hour clock without touching the daylight figures', () => {
    const now = at('2026-06-21');
    const twelve = buildSunDay(LISBON, now, { hour12: true });
    const twentyFour = buildSunDay(LISBON, now);
    const times = solarTimes(now, LISBON.latitude, LISBON.longitude, LISBON.timeZone);

    expect(twelve.sunriseLabel).toBe(zoneClock(times.sunrise, LISBON.timeZone, true));
    expect(twelve.sunriseLabel).toMatch(/ (am|pm)$/);
    expect(twelve.sunsetLabel).toBe(zoneClock(times.sunset, LISBON.timeZone, true));
    expect(twelve.solarNoonLabel).toBe(zoneClock(times.solarNoon, LISBON.timeZone, true));
    // Only the clock convention changes; the length of the day does not.
    expect(twelve.daylightLabel).toBe(twentyFour.daylightLabel);
    expect(twelve.daylightDeltaMinutes).toBe(twentyFour.daylightDeltaMinutes);
  });

  it('reports a polar day with no times at all', () => {
    const now = at('2026-06-21');
    const day = buildSunDay(TROMSO, now);
    const times = solarTimes(now, TROMSO.latitude, TROMSO.longitude, TROMSO.timeZone);

    expect(times.polarDay).toBe(true);
    expect(day.times.polarDay).toBe(true);
    expect(day.daylightLabel).toBe('Midnight sun');
    expect(day.sunriseLabel).toBe('—');
    expect(day.sunsetLabel).toBe('—');
    expect(day.polarNote).toMatch(/does not rise or set/);
    // Nothing to compare and nothing to be a fraction of.
    expect(day.daylightDeltaMinutes).toBeNull();
    expect(day.progress).toBeNull();
    // Solar noon is still a real event on a polar day, at the place's own clock.
    expect(day.solarNoonLabel).toBe(zoneClock(times.solarNoon, TROMSO.timeZone));
  });

  it('reports a polar night with its civil twilight window', () => {
    const now = at('2026-12-21');
    const day = buildSunDay(TROMSO, now);
    const times = solarTimes(now, TROMSO.latitude, TROMSO.longitude, TROMSO.timeZone);

    expect(times.polarNight).toBe(true);
    expect(day.times.polarNight).toBe(true);
    expect(day.daylightLabel).toBe('No daylight');
    expect(day.sunriseLabel).toBe('—');
    expect(day.sunsetLabel).toBe('—');
    // The solar module keeps twilight through a polar night; the note must use
    // it rather than claiming the day is uniformly black.
    expect(times.civilDawn).not.toBeNull();
    expect(times.civilDusk).not.toBeNull();
    expect(day.polarNote).toMatch(/civil twilight/);
    expect(day.polarNote).toContain(zoneClock(times.civilDawn, TROMSO.timeZone));
    expect(day.polarNote).toContain(zoneClock(times.civilDusk, TROMSO.timeZone));
    expect(day.daylightDeltaMinutes).toBeNull();
    expect(day.progress).toBeNull();
  });

  it('keeps the same local day when the viewer is on the other side of midnight', () => {
    // 23:00 in Los Angeles is already the next morning in Lisbon. The widget
    // must show Lisbon's 21st, not its 22nd.
    const day = buildSunDay(LISBON, new Date('2026-06-21T23:00:00Z'));
    const noon = new Date('2026-06-21T12:00:00Z');

    expect(day.sunriseLabel).toBe(buildSunDay(LISBON, noon).sunriseLabel);
    expect(day.daylightLabel).toBe(buildSunDay(LISBON, noon).daylightLabel);
  });

  it('stays total for an unparseable instant, falling back to the viewer’s day', () => {
    const day = buildSunDay(LISBON, new Date(Number.NaN));

    // Not a 1970 sunrise: the instant has no time of day to carry, so the widget
    // anchors to the viewer's own midday rather than inventing a date.
    expect(day.sunriseLabel).toMatch(/^\d{2}:\d{2}$/);
    expect(day.daylightLabel).toMatch(/^\d{1,2}h \d{2}m$/);
    expect(day.progress === null || (day.progress >= 0 && day.progress <= 1)).toBe(true);
    expect(day.polarNote).toBeNull();
  });
});

describe('formatZoneTime', () => {
  it('reads a missing instant as a dash', () => {
    expect(formatZoneTime(null, 'Europe/Lisbon')).toBe('—');
    expect(formatZoneTime(new Date(Number.NaN), 'Europe/Lisbon')).toBe('—');
  });

  it('prints midnight from the place’s own clock, both ways round', () => {
    // Midnight in Lisbon is 23:00 UTC the day before.
    const midnight = new Date('2026-06-20T23:00:00Z');

    expect(formatZoneTime(midnight, 'Europe/Lisbon')).toBe('00:00');
    expect(formatZoneTime(midnight, 'Europe/Lisbon', true)).toBe('12:00 am');
  });

  it('uses the place’s zone rather than the host’s', () => {
    const instant = new Date('2026-06-21T12:00:00Z');

    expect(formatZoneTime(instant, 'Europe/Lisbon')).toBe('13:00');
    expect(formatZoneTime(instant, 'UTC')).toBe('12:00');
    expect(formatZoneTime(instant, 'Asia/Tokyo')).toBe('21:00');
  });

  it('throws for an unknown zone rather than silently using the viewer’s clock', () => {
    // Documented behaviour: the zone comes from the geocoder, so an unknown one
    // is a bug. Falling back to the host would print a plausible wrong time.
    expect(() => formatZoneTime(new Date('2026-06-21T12:00:00Z'), 'Mars/Olympus_Mons')).toThrow(RangeError);
  });
});

describe('daylightDelta', () => {
  it('is positive when the day is longer than the one before', () => {
    expect(daylightDelta(600, 598)).toBe(2);
    expect(daylightDelta(1440, 1439)).toBe(1);
  });

  it('is negative when the day is shorter', () => {
    expect(daylightDelta(469, 472)).toBe(-3);
    expect(daylightDelta(0, 30)).toBe(-30);
  });

  it('is zero for two identical days, and null when either side is unknown', () => {
    expect(daylightDelta(893, 893)).toBe(0);
    expect(daylightDelta(null, 893)).toBeNull();
    expect(daylightDelta(893, null)).toBeNull();
    expect(daylightDelta(null, null)).toBeNull();
    // A polar day reports 1440 minutes, so the caller has to null it out — this
    // function must never turn "always light" into a confident "0 minutes more".
    expect(daylightDelta(Number.NaN, 900)).toBeNull();
    expect(daylightDelta(900, Number.POSITIVE_INFINITY)).toBeNull();
  });
});

describe('formatDaylightDelta', () => {
  it('words the change in whole minutes', () => {
    expect(formatDaylightDelta(2)).toBe('2m more daylight than yesterday');
    expect(formatDaylightDelta(-3)).toBe('3m less daylight than yesterday');
    expect(formatDaylightDelta(1)).toBe('1m more daylight than yesterday');
    expect(formatDaylightDelta(0)).toBe('Same as yesterday');
    expect(formatDaylightDelta(-0.4)).toBe('Same as yesterday');
  });
});

describe('formatDaylightShort', () => {
  it('drops the minutes when they are zero, and caps at a whole day', () => {
    expect(formatDaylightShort(893)).toBe('14h 53m');
    expect(formatDaylightShort(780)).toBe('13h');
    expect(formatDaylightShort(1440)).toBe('24h');
    expect(formatDaylightShort(0)).toBe('0h');
  });
});

describe('sunSummarize', () => {
  it('prefers the resolved place once there is one', () => {
    expect(sunSummarize({ place: LISBON, city: 'lisbon' })).toBe('Lisbon, Portugal');
    expect(sunSummarize({ place: LISBON, city: 'lisbon' })).toBe(placeLabel(LISBON));
  });

  it('shows the typed city while nothing is resolved, and prompts with no city at all', () => {
    expect(sunSummarize({ place: null, city: '  Porto  ' })).toBe('Porto');
    // A blank header line reads as a bug; say what the panel needs instead.
    expect(sunSummarize({ place: null, city: '' })).toBe('Set a place');
  });
});

describe('resolved place memory', () => {
  it('remembers a place per city name, ignoring case and stray spacing', () => {
    rememberPlace(LISBON);

    expect(resolvedPlaceFor('Lisbon')).toBe(LISBON);
    expect(resolvedPlaceFor('  lisbon ')).toBe(LISBON);
    // The subtitle the header shows once the widget has resolved the city.
    expect(sunSummarize({ place: resolvedPlaceFor('LISBON'), city: 'LISBON' })).toBe('Lisbon, Portugal');
  });

  it('has nothing for a city that was never resolved', () => {
    expect(resolvedPlaceFor('Ushuaia')).toBeNull();
    expect(resolvedPlaceFor('')).toBeNull();
    expect(sunSummarize({ place: resolvedPlaceFor('Ushuaia'), city: 'Ushuaia' })).toBe('Ushuaia');
  });

  it('stays bounded, so a session that tries many names cannot grow it forever', () => {
    for (let index = 0; index < 60; index += 1) rememberPlace(place(`City${index}`, 0, 0, 'UTC'));

    // The earliest names have been evicted; the newest is still there.
    expect(resolvedPlaceFor('City0')).toBeNull();
    expect(resolvedPlaceFor('City59')).not.toBeNull();
    expect(resolvedPlaceFor('Lisbon')).toBeNull();
  });
});

describe('SunDay contract', () => {
  it('never reports progress or a delta outside its documented domain', () => {
    const days = [
      buildSunDay(LISBON, at('2026-06-21')),
      buildSunDay(LISBON, at('2026-12-21')),
      buildSunDay(TROMSO, at('2026-06-21')),
      buildSunDay(TROMSO, at('2026-12-21')),
      buildSunDay(LISBON, at('2026-06-21'), { hour12: true }),
    ];

    for (const day of days) {
      expect(day.progress === null || (day.progress >= 0 && day.progress <= 1)).toBe(true);
      expect(day.moon.illumination).toBeGreaterThanOrEqual(0);
      expect(day.moon.illumination).toBeLessThanOrEqual(1);
      // A delta of zero is a real answer ("same as yesterday") and stays zero;
      // only the polar cases drop it to null.
      expect(day.daylightDeltaMinutes === null || Number.isFinite(day.daylightDeltaMinutes)).toBe(true);
      expect(new Date(day.times.solarNoon.getTime()).getTime()).toBe(day.times.solarNoon.getTime());
    }
  });

  it('carries the daylight window of the day it labels', () => {
    const day = sunDay(buildSunDay(LISBON, at('2026-06-21')));
    const window = day.times.sunset!.getTime() - day.times.sunrise!.getTime();

    expect(day.times.daylightMinutes).toBe(Math.round(window / 60_000));
    // The ring is drawn from the same window: an anchor inside the place's own
    // afternoon, not the viewer's clock and not before sunrise.
    expect(day.progress).not.toBeNull();
    expect(day.progress!).toBeGreaterThan(0.1);
    expect(day.progress!).toBeLessThan(0.9);
  });
});
