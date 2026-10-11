/**
 * Sun and moon for a place, as the panel needs to print it.
 *
 * `src/lib/solar.ts` answers "when does the sun rise", in absolute instants, for
 * any calendar day; `src/lib/moon.ts` answers "what is the phase". This module
 * is the layer in between: it turns those numbers into the handful of strings a
 * widget shows, and it exists for one reason that is easy to get wrong —
 * **every time here is rendered in the place's own time zone**.
 *
 * A browser in Berlin asking about Tokyo must print Tokyo's sunrise on Tokyo's
 * clock, so the times are formatted with `Intl.DateTimeFormat` and
 * `timeZone: place.timeZone` rather than the viewer's. That is also why the
 * module takes a whole {@link GeoPlace} instead of loose coordinates: the zone
 * is not optional detail, it is half the answer.
 *
 * Nothing here invents a number. Where the sun does not rise or set, the widget
 * gets `null`s and an honest sentence saying so, and the civil-twilight window
 * is kept even through a polar night because `solarTimes` deliberately reports
 * it (see that module's header).
 */
import type { GeoPlace } from '@/lib/geocode';
import { placeLabel } from '@/lib/geocode';
import { moonInfo, type MoonInfo } from '@/lib/moon';
import { daylightProgress, solarTimes, type SolarTimes } from '@/lib/solar';
import { DAY_MS, zoneOffsetMinutes } from '@/lib/time';

/** Stand-in for a time that does not happen that day. */
const NO_TIME = '—';

/** Sentinel for "today's daylight could not be compared with yesterday's". */
const NO_DELTA = Number.NaN;

/** One day of sun and moon for a place, already worded for display. */
export interface SunDay {
  times: SolarTimes;
  moon: MoonInfo;
  /** "07:41" / "7:41 am" in the place's own time zone, or a polar note. */
  sunriseLabel: string;
  sunsetLabel: string;
  solarNoonLabel: string;
  /** "13h 25m", or "No daylight" / "Midnight sun". */
  daylightLabel: string;
  /** Minutes gained (positive) or lost (negative) against the previous day, or null in a polar case. */
  daylightDeltaMinutes: number | null;
  /** Honest one-liner for the polar cases, or null. */
  polarNote: string | null;
  /** 0…1 through today's daylight window, or null. */
  progress: number | null;
}

/** `Intl` construction is not free, and the widgets re-render every minute. */
const TIME_FORMATTERS = new Map<string, Intl.DateTimeFormat>();

/**
 * The place's-zone formatter for one clock convention. Only `en-GB` gives "07:41".
 *
 * The hour is `2-digit` in the 24-hour case and `numeric` in the 12-hour one:
 * ICU does not zero-pad a `numeric` hour under `h23`, so "0:00" is what midnight
 * would otherwise print as — a label nobody writes.
 */
function zoneFormatter(timeZone: string, hour12: boolean): Intl.DateTimeFormat {
  const key = `${timeZone}\u0000${hour12 ? '12' : '24'}`;
  let formatter = TIME_FORMATTERS.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      hour: hour12 ? 'numeric' : '2-digit',
      minute: '2-digit',
      // `hour12: false` buys "24:00" at midnight in some ICU builds; `h23` is
      // the only spelling that reliably starts the day at "00:00".
      ...(hour12 ? { hour12: true } : { hourCycle: 'h23' as const }),
    });
    TIME_FORMATTERS.set(key, formatter);
  }
  return formatter;
}

/** Read one formatted part, or `undefined` when the formatter did not emit it. */
function partOf(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): string | undefined {
  const value = parts.find((part) => part.type === type)?.value;
  return value === undefined || value === '' ? undefined : value;
}

/** The clock the day is anchored to, in minutes past midnight where the place is. */
const INITIAL_ANCHOR_MINUTES = 12 * 60;

/**
 * The place's own calendar day for `now`, and where in that day to read it.
 *
 * Callers hand over "now", which belongs to the *viewer's* day: at 23:00 in Los
 * Angeles it is already tomorrow in Lisbon, and the panel would show tomorrow's
 * sunrise under today's date. So the viewer's calendar date is carried over to
 * the place and the local time is floored at midday. Midday is always inside the
 * place's own day in every zone (UTC+14 through UTC−12), and it is normally
 * inside the daylight window too — before sunrise only above the arctic circle
 * in summer, where `daylightProgress` clamps it to zero anyway.
 *
 * The day is assembled with `Date.UTC` from the *viewer's* year, month and day,
 * because `solarTimes` reads that UTC date as the place's calendar day. That is
 * what keeps the answer the same whatever zone the browser happens to be in.
 */
function anchorInPlace(now: Date, timeZone: string): { start: Date; minutes: number } {
  // An unparseable instant has no time of day to carry, and would otherwise be
  // read as the epoch and label a 1970 sunrise. Midday it is.
  const reference = Number.isFinite(now.getTime()) ? now : new Date();
  const start = new Date(Date.UTC(reference.getFullYear(), reference.getMonth(), reference.getDate()));

  // Where the viewer's clock stands, restated on the place's wall clock.
  const placeOffset = zoneOffsetMinutes(start, timeZone);
  const hostOffset = -start.getTimezoneOffset();
  const localMinutes = reference.getHours() * 60 + reference.getMinutes() + (placeOffset - hostOffset);

  return {
    start,
    minutes: Math.max(INITIAL_ANCHOR_MINUTES, Math.min(23 * 60 + 59, localMinutes)),
  };
}

/** The same wall clock on a day `dayOffset` days away. Whole days, so DST cannot shift it. */
function anchorAt(start: Date, minutes: number, dayOffset: number): Date {
  return new Date(start.getTime() + dayOffset * DAY_MS + minutes * 60_000);
}


/**
 * A clock time on `timeZone`'s wall clock — "07:41" or "7:41 am".
 *
 * `null` (and an invalid `Date`) reads as {@link NO_TIME}: a missing sunrise is
 * a normal winter answer at high latitude, not an error.
 *
 * An unknown IANA zone throws `RangeError` from `Intl`, and that is deliberate:
 * the zone comes from the geocoder, so it is a bug worth seeing rather than
 * silently swapping in the viewer's clock — the one mistake this module exists
 * to prevent. Callers holding a hand-edited zone should check it first.
 */
export function formatZoneTime(date: Date | null, timeZone: string, hour12 = false): string {
  if (!date || !Number.isFinite(date.getTime())) return NO_TIME;

  const parts = zoneFormatter(timeZone, hour12).formatToParts(date);
  const hour = partOf(parts, 'hour');
  const minute = partOf(parts, 'minute');
  if (hour === undefined || minute === undefined) return NO_TIME;

  // `minute` is always two digits, so midnight and noon keep their ":00".
  const clock = `${hour}:${minute}`;
  const dayPeriod = partOf(parts, 'dayPeriod');
  return dayPeriod === undefined ? clock : `${clock} ${dayPeriod.toLowerCase()}`;
}

/** "12h 03m"; a part-hour or part-minute window still reads as `0h 35m`. */
function formatDaylight(minutes: number): string {
  const total = Math.max(0, Math.round(Number.isFinite(minutes) ? minutes : 0));
  return `${Math.floor(total / 60)}h ${String(total % 60).padStart(2, '0')}m`;
}

/** The "6h 14m" figure in the middle of the daylight ring: 24h once the sun never sets. */
export function formatDaylightShort(minutes: number): string {
  const total = Math.max(0, Math.round(Number.isFinite(minutes) ? minutes : 0));
  if (total >= 24 * 60) return '24h';
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}

/** "2m more daylight than yesterday" / "3m less" / "Same as yesterday". */
export function formatDaylightDelta(minutes: number): string {
  const rounded = Math.round(minutes);
  if (rounded === 0) return 'Same as yesterday';
  return `${Math.abs(rounded)}m ${rounded > 0 ? 'more' : 'less'} daylight than yesterday`;
}

/**
 * Minutes gained or lost against the previous day, or `null` when the two days
 * cannot be compared — a polar day or night, or a value a caller could not
 * compute. Takes whole minutes rather than dates so the caller can build
 * yesterday's `SolarTimes` from the same place (see {@link buildSunDay}).
 */
export function daylightDelta(solarMinutes: number | null, previousSolarMinutes: number | null): number | null {
  if (solarMinutes === null || previousSolarMinutes === null) return null;
  if (!Number.isFinite(solarMinutes) || !Number.isFinite(previousSolarMinutes)) return null;
  return solarMinutes - previousSolarMinutes;
}

/** "09:31 – 13:53" for the two ends of a window, or null when either is missing. */
function windowLabel(start: Date | null, end: Date | null, timeZone: string, hour12: boolean): string | null {
  if (!start || !end) return null;
  return `${formatZoneTime(start, timeZone, hour12)} – ${formatZoneTime(end, timeZone, hour12)}`;
}

/** The civil-twilight window, when the day has one — a polar night still does. */
function twilightWindowLabel(times: SolarTimes, timeZone: string, hour12: boolean): string | null {
  return windowLabel(times.civilDawn, times.civilDusk, timeZone, hour12);
}

/** The evening golden hour, which needs a horizon crossing and so a real sunset. */
export function goldenHourLabel(times: SolarTimes, timeZone: string, hour12 = false): string | null {
  return windowLabel(times.goldenHourStart, times.goldenHourEnd, timeZone, hour12);
}

/** The one-line truth about a polar day or polar night, or null on an ordinary day. */
function polarNoteFor(times: SolarTimes, timeZone: string, hour12: boolean): string | null {
  if (times.polarDay) {
    return 'The sun stays above the horizon all day — it does not rise or set.';
  }
  if (!times.polarNight) return null;

  const twilight = twilightWindowLabel(times, timeZone, hour12);
  // A polar night without a civil-twilight window is possible: it just means the
  // sun never even reaches 6° below the horizon.
  if (!twilight) return 'The sun stays below the horizon all day — it does not rise.';
  return `The sun stays below the horizon all day; civil twilight runs ${twilight}.`;
}

/** The place as the widget names it, or the typed city while nothing is resolved. */
export function sunSummarize(input: { place: GeoPlace | null; city: string }): string {
  if (input.place) return placeLabel(input.place);
  // No city at all: the header says what to do rather than leaving a gap.
  return input.city.trim() || 'Set a place';
}

/**
 * How many resolved places the widget header remembers.
 *
 * `summarize` is handed the *config*, not the geocoder's answer, so the
 * component parks the place it resolved here for the header to read. Bounded so
 * a session that types a hundred city names cannot grow it without limit; the
 * oldest entry goes first, and a miss only costs the subtitle its country.
 */
const RESOLVED_PLACES_MAX = 50;

const resolvedPlaces = new Map<string, GeoPlace>();

/** The cache key for a typed city name: case and spacing are the user's, not the place's. */
function placeKey(city: string): string {
  return city.trim().replace(/\s+/g, ' ').toLowerCase();
}

/** Remember which place a city name matched, for {@link resolvedPlaceFor}. */
export function rememberPlace(place: GeoPlace): GeoPlace {
  const key = placeKey(place.name);
  if (key !== '') {
    resolvedPlaces.delete(key);
    resolvedPlaces.set(key, place);
    if (resolvedPlaces.size > RESOLVED_PLACES_MAX) {
      const oldest = resolvedPlaces.keys().next();
      if (!oldest.done) resolvedPlaces.delete(oldest.value);
    }
  }
  return place;
}

/** The place a typed city last resolved to in this session, or null before it has. */
export function resolvedPlaceFor(city: string): GeoPlace | null {
  return resolvedPlaces.get(placeKey(city)) ?? null;
}

/** {@link buildSunDay}'s options; `hour12` picks the clock convention. */
export interface BuildSunDayOptions {
  hour12?: boolean;
}

/**
 * Today's sun and moon for `place`, worded for display.
 *
 * "Today" is the place's own calendar day, which `solarTimes` resolves from
 * `place.timeZone`; `now` only ever supplies the instant. The day is read at the
 * place's midday or later (see {@link anchorInPlace}) so a viewer in another zone
 * gets that place's date rather than their own, and yesterday's figures — the
 * comparison the delta needs — come from the same wall clock a day earlier.
 */
export function buildSunDay(place: GeoPlace, now: Date, options: BuildSunDayOptions = {}): SunDay {
  const hour12 = options.hour12 === true;
  const { timeZone } = place;
  const { start, minutes } = anchorInPlace(now, timeZone);
  const instant = anchorAt(start, minutes, 0);
  const times = solarTimes(instant, place.latitude, place.longitude, timeZone);
  // Yesterday is the same wall clock a whole day earlier, built from the same
  // place — the one comparison the delta needs.
  const yesterday = solarTimes(anchorAt(start, minutes, -1), place.latitude, place.longitude, timeZone);

  const daylightLabel = times.polarDay
    ? 'Midnight sun'
    : times.polarNight || !times.sunrise || !times.sunset
      ? 'No daylight'
      : formatDaylight(times.daylightMinutes);

  // Both ends of a polar day read "Midnight sun" and "No daylight" instead of a
  // clock time, so "1440 − 1440 = 0" would claim a comparison that means nothing.
  const delta =
    times.polarDay || times.polarNight
      ? NO_DELTA
      : (daylightDelta(times.daylightMinutes, yesterday.daylightMinutes) ?? NO_DELTA);

  return {
    times,
    moon: moonInfo(instant),
    sunriseLabel: formatZoneTime(times.sunrise, timeZone, hour12),
    sunsetLabel: formatZoneTime(times.sunset, timeZone, hour12),
    solarNoonLabel: formatZoneTime(times.solarNoon, timeZone, hour12),
    daylightLabel,
    daylightDeltaMinutes: Number.isFinite(delta) ? delta : null,
    polarNote: polarNoteFor(times, timeZone, hour12),
    // `daylightProgress` already answers null for a polar day/night and for an
    // unparseable instant, which is exactly the contract the ring needs.
    progress: daylightProgress(times, instant),
  };
}
