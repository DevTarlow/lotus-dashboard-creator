/**
 * Sun times for a calendar day — NOAA's solar-position algorithm, rewritten as
 * pure TypeScript with no dependencies and no clock of its own.
 *
 * Sources: NOAA Global Monitoring Laboratory's "Solar Calculator"
 * (<https://gml.noaa.gov/grad/solcalc/>), whose fractional-year equations for
 * the equation of time and the solar declination are used as published, along
 * with its zenith angles — 90.833° for sunrise/sunset (the horizon plus
 * refraction and the solar semidiameter), 96° for civil twilight and 84° for
 * the 6° altitude that opens the evening golden hour. The published values the
 * tests assert against come from the US Naval Observatory's Astronomical
 * Applications API.
 *
 * Every instant is a parameter: nothing here reads the system clock, so the
 * dashboard can ask for "today in Tokyo" from a browser in Europe and get a
 * deterministic answer. The location's calendar day is resolved with
 * `Intl.DateTimeFormat`, and the events are returned as absolute instants.
 */

/** Degrees → radians. */
const DEG = Math.PI / 180;

const MS_PER_MINUTE = 60_000;
const MS_PER_DAY = 86_400_000;
const MINUTES_PER_DAY = 1440;

/** NOAA's zenith angles: sunrise/sunset, civil twilight, 6° altitude. */
const SUNRISE_ZENITH = 90.833;
const CIVIL_ZENITH = 96;
const GOLDEN_ZENITH = 84;

export interface SolarTimes {
  /** Absolute instants; null when the event does not occur that day (polar day/night). */
  sunrise: Date | null;
  sunset: Date | null;
  solarNoon: Date;
  /** Whole minutes between sunrise and sunset; 0 when the sun does not rise. */
  daylightMinutes: number;
  /** Sun 6° below the horizon — present even in a polar night, absent in a polar summer. */
  civilDawn: Date | null;
  civilDusk: Date | null;
  /** Evening golden hour: sun between 6° and the horizon. */
  goldenHourStart: Date | null;
  goldenHourEnd: Date | null;
  polarDay: boolean;
  polarNight: boolean;
}

interface CalendarDay {
  year: number;
  month: number;
  day: number;
}

/** Where the sun stands, over one day, relative to a given zenith angle. */
type ZenithCrossing =
  | { kind: 'crosses'; hourAngle: number }
  | { kind: 'always-above' }
  | { kind: 'always-below' };

/** `Intl.DateTimeFormat` instances are expensive; one per zone is plenty. */
const dayFormatters = new Map<string, Intl.DateTimeFormat>();

function dayFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = dayFormatters.get(timeZone);
  if (!formatter) {
    // `en-CA` renders the short date as `YYYY-MM-DD`, which parses trivially.
    formatter = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
    dayFormatters.set(timeZone, formatter);
  }
  return formatter;
}

/** The calendar day `date` falls on in `timeZone`, or on the host when unset/unknown. */
function localCalendarDay(date: Date, timeZone: string | undefined): CalendarDay {
  if (timeZone) {
    try {
      const [year, month, day] = dayFormatter(timeZone).format(date).split('-').map(Number);
      if (year && month && day) return { year, month, day };
    } catch {
      // Unknown or unsupported IANA zone: fall back to the host's own day.
    }
  }
  return { year: date.getFullYear(), month: date.getMonth() + 1, day: date.getDate() };
}

/** Day of the year, 1..366, for a calendar day (UTC arithmetic — no zone involved). */
function dayOfYear({ year, month, day }: CalendarDay): number {
  return Math.round((Date.UTC(year, month - 1, day) - Date.UTC(year, 0, 1)) / MS_PER_DAY) + 1;
}

/**
 * Equation of time (minutes) and solar declination (radians) for a day.
 *
 * NOAA's fractional year carries an `(hour - 12) / 24` term; evaluating at local
 * solar noon (where it vanishes) is the usual single-pass choice and keeps
 * sunrise and sunset exactly symmetric about `solarNoon`.
 */
function solarPosition(yearDay: number): { equationOfTime: number; declination: number } {
  const gamma = ((2 * Math.PI) / 365) * (yearDay - 1);
  const cos = Math.cos(gamma);
  const sin = Math.sin(gamma);

  return {
    equationOfTime:
      229.18 *
      (0.000075 + 0.001868 * cos - 0.032077 * sin - 0.014615 * Math.cos(2 * gamma) - 0.040849 * Math.sin(2 * gamma)),
    declination:
      0.006918 -
      0.399912 * cos +
      0.070257 * sin -
      0.006758 * Math.cos(2 * gamma) +
      0.000907 * Math.sin(2 * gamma) -
      0.002697 * Math.cos(3 * gamma) +
      0.00148 * Math.sin(3 * gamma),
  };
}

/** Hour angle (degrees) at which the sun crosses `zenith`, if it crosses at all. */
function crossingAt(zenith: number, latitude: number, declination: number): ZenithCrossing {
  const latitudeRad = latitude * DEG;
  const cosHourAngle =
    (Math.cos(zenith * DEG) - Math.sin(latitudeRad) * Math.sin(declination)) /
    (Math.cos(latitudeRad) * Math.cos(declination));

  if (cosHourAngle < -1) return { kind: 'always-above' };
  // `cos > 1` and the NaN a degenerate pole can produce both mean "never up".
  if (!(cosHourAngle <= 1)) return { kind: 'always-below' };
  return { kind: 'crosses', hourAngle: Math.acos(cosHourAngle) / DEG };
}

/** Clamp latitude into [-90, 90]; non-finite input becomes the equator. */
function clampLatitude(latitude: number): number {
  return Number.isFinite(latitude) ? Math.min(90, Math.max(-90, latitude)) : 0;
}

/** Normalise longitude into [-180, 180); non-finite input becomes the prime meridian. */
function normaliseLongitude(longitude: number): number {
  if (!Number.isFinite(longitude)) return 0;
  return (((longitude + 180) % 360) + 360) % 360 - 180;
}

/** Sun times for the local calendar day at `latitude`/`longitude`. `timeZone` (IANA) selects that day; omit it to use the host's local day. */
export function solarTimes(date: Date, latitude: number, longitude: number, timeZone?: string): SolarTimes {
  // An invalid date would poison every result, so it reads as the Unix epoch.
  const instant = Number.isNaN(date.getTime()) ? new Date(0) : date;
  const lat = clampLatitude(latitude);
  const lon = normaliseLongitude(longitude);

  const day = localCalendarDay(instant, timeZone);
  const utcMidnight = Date.UTC(day.year, day.month - 1, day.day);
  const { equationOfTime, declination } = solarPosition(dayOfYear(day));

  // Local solar noon, in minutes from 00:00 UTC on `day`. Events sit at
  // `noon ± 4 · hourAngle`; the offsets go negative (or past 1440) whenever the
  // local day starts on another UTC date, which `Date` absorbs for us.
  const noonMinutes = 720 - 4 * lon - equationOfTime;
  const at = (minutes: number): Date => new Date(utcMidnight + minutes * MS_PER_MINUTE);

  const horizon = crossingAt(SUNRISE_ZENITH, lat, declination);
  const civil = crossingAt(CIVIL_ZENITH, lat, declination);
  const golden = crossingAt(GOLDEN_ZENITH, lat, declination);

  const polarDay = horizon.kind === 'always-above';
  const polarNight = horizon.kind === 'always-below';

  const sunrise = horizon.kind === 'crosses' ? at(noonMinutes - 4 * horizon.hourAngle) : null;
  const sunset = horizon.kind === 'crosses' ? at(noonMinutes + 4 * horizon.hourAngle) : null;

  // Civil twilight is bounded by 6° below the horizon, not by the horizon, so it
  // survives a polar night (Tromsø in December has civil dawn at 09:31 and civil
  // dusk at 13:53) and is absent in a polar summer.
  const civilDawn = civil.kind === 'crosses' ? at(noonMinutes - 4 * civil.hourAngle) : null;
  const civilDusk = civil.kind === 'crosses' ? at(noonMinutes + 4 * civil.hourAngle) : null;

  // The evening golden hour is *bounded below by the horizon*, so it needs both
  // a 6° crossing and a sunset: null on a polar day, where the sun dips to 6°
  // but never sets. `goldenHourEnd` is that sunset instant.
  const goldenHourStart = sunset && golden.kind === 'crosses' ? at(noonMinutes + 4 * golden.hourAngle) : null;
  const goldenHourEnd = goldenHourStart ? sunset : null;

  return {
    sunrise,
    sunset,
    solarNoon: at(noonMinutes),
    daylightMinutes:
      sunrise && sunset
        ? Math.round((sunset.getTime() - sunrise.getTime()) / MS_PER_MINUTE)
        : polarDay
          ? MINUTES_PER_DAY
          : 0,
    civilDawn,
    civilDusk,
    goldenHourStart,
    goldenHourEnd,
    polarDay,
    polarNight,
  };
}

/** Fraction 0..1 of the daylight window elapsed at `now`, or null when there is no sunrise/sunset that day. */
export function daylightProgress(times: SolarTimes, now: Date): number | null {
  const { sunrise, sunset } = times;
  if (!sunrise || !sunset) return null;

  const window = sunset.getTime() - sunrise.getTime();
  const elapsed = (now.getTime() - sunrise.getTime()) / window;
  if (!Number.isFinite(elapsed)) return null;

  // Clamped so the result stays a fraction: 0 before sunrise, 1 after sunset.
  return Math.min(1, Math.max(0, elapsed));
}
