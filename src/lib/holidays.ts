/**
 * The Nager.Date public-holiday provider.
 *
 * `date.nager.at` is keyless, sends `access-control-allow-origin: *` and needs no
 * signup, so a calendar can mark the public holidays of one country without
 * asking the user for anything. `GET /api/v3/PublicHolidays/{year}/{country}`
 * answers an array of
 * `{ date, localName, name, countryCode, global, counties, launchYear, types }`.
 *
 * Two rules the mapping keeps:
 * - a country the API does not know answers non-OK, which becomes an
 *   {@link HttpError} rather than an empty list — "no holiday data for XX" and
 *   "a year without holidays" must never look the same;
 * - a payload that is not a list of holidays is a parse error, never a silently
 *   empty calendar.
 *
 * The response is cached for half a day: public holidays change once a year, so
 * a dashboard with several calendars should still ask at most once.
 */
import { HttpError, requestJson } from '@/lib/http';
import { dayKey, parseDayKey } from '@/lib/time';
import { asString, isRecord } from '@/lib/utils';

/** A holiday list changes once a year; half a day keeps the request count at one. */
export const HOLIDAY_REFRESH_MS = 12 * 60 * 60 * 1000;

/**
 * Curated ISO-2 codes for the country picker, in the order they should read.
 *
 * Only countries Nager.Date serves are listed, so a choice from this menu can
 * never be the "unknown country" case. A config carrying any other two-letter
 * code is still honoured and reported honestly instead of being dropped.
 */
export const HOLIDAY_COUNTRIES: readonly { code: string; name: string }[] = [
  { code: 'AU', name: 'Australia' },
  { code: 'AT', name: 'Austria' },
  { code: 'BR', name: 'Brazil' },
  { code: 'CA', name: 'Canada' },
  { code: 'FI', name: 'Finland' },
  { code: 'FR', name: 'France' },
  { code: 'DE', name: 'Germany' },
  { code: 'IE', name: 'Ireland' },
  { code: 'IT', name: 'Italy' },
  { code: 'JP', name: 'Japan' },
  { code: 'MX', name: 'Mexico' },
  { code: 'NL', name: 'Netherlands' },
  { code: 'NZ', name: 'New Zealand' },
  { code: 'NO', name: 'Norway' },
  { code: 'PL', name: 'Poland' },
  { code: 'PT', name: 'Portugal' },
  { code: 'ES', name: 'Spain' },
  { code: 'SE', name: 'Sweden' },
  { code: 'CH', name: 'Switzerland' },
  { code: 'GB', name: 'United Kingdom' },
  { code: 'US', name: 'United States' },
];

/** One public holiday, as far as the calendar needs to know. */
export interface Holiday {
  /** Local `YYYY-MM-DD`. */
  date: string;
  /** English name, e.g. `Carnival`. */
  name: string;
  /** The country's own name, e.g. `Carnaval`. */
  localName: string;
  /** `false` for a regional holiday (one canton, one state) rather than a national one. */
  global: boolean;
}

const NAGER_API = 'https://date.nager.at/api/v3';

/** Cache and de-duplication key for one country-year request. */
export function holidayCacheKey(country: string, year: number): string {
  return `nager:holidays:${country}:${year}`;
}

/**
 * Read a country code out of untrusted config: `null` unless it is exactly two
 * letters. A well-formed but unknown code is kept, so the API can answer for
 * itself and the widget can say which country it could not read.
 */
export function normalizeCountryCode(value: unknown): string | null {
  const code = asString(value).trim().toUpperCase();
  return /^[A-Z]{2}$/.test(code) ? code : null;
}

/** Display name for a configured country, or `''` when holidays are off. */
export function holidayCountryName(code: string | null): string {
  const normalized = normalizeCountryCode(code);
  if (normalized === null) return '';
  return HOLIDAY_COUNTRIES.find((country) => country.code === normalized)?.name ?? normalized;
}

/**
 * Map the provider payload, or `null` when it is not a holiday list.
 *
 * Individual entries that carry no readable date or no name at all are dropped —
 * one odd row should not cost the year — but a non-empty payload in which
 * *nothing* could be read is treated as a parse failure.
 */
export function mapHolidays(payload: unknown): Holiday[] | null {
  if (!Array.isArray(payload)) return null;

  const holidays: Holiday[] = [];
  for (const entry of payload) {
    if (!isRecord(entry)) continue;
    const date = parseDayKey(asString(entry.date));
    if (date === null) continue;
    const name = asString(entry.name).trim();
    const localName = asString(entry.localName).trim() || name;
    const label = name || localName;
    if (label === '') continue;
    holidays.push({
      date: dayKey(date),
      name: label,
      localName: localName || label,
      // Only an explicit `false` marks a county holiday: an absent flag must not
      // turn a national one into a regional one.
      global: entry.global !== false,
    });
  }

  if (holidays.length === 0 && payload.length > 0) return null;
  return holidays;
}

/**
 * The public holidays of `country` in `year`.
 *
 * Rejects with an `HttpError`: `http` with a status for a country the API does
 * not serve, `parse` for a payload that is not a holiday list.
 */
export async function fetchHolidays(country: string, year: number, signal: AbortSignal): Promise<Holiday[]> {
  const code = normalizeCountryCode(country);
  if (code === null) {
    throw new HttpError(`“${asString(country)}” is not a two-letter country code.`, 'parse');
  }

  const requestedYear = Number.isFinite(year) ? Math.trunc(year) : new Date().getFullYear();
  const response = await requestJson<unknown>(
    holidayCacheKey(code, requestedYear),
    `${NAGER_API}/PublicHolidays/${requestedYear}/${code}`,
    { ttlMs: HOLIDAY_REFRESH_MS, signal },
  );

  const holidays = mapHolidays(response.data);
  if (holidays === null) {
    throw new HttpError('The holiday provider sent a payload that was not a list of holidays.', 'parse');
  }
  return holidays;
}

/** Group holidays by their day key, keeping the provider's order. */
export function holidaysByDate(holidays: readonly Holiday[]): Map<string, Holiday[]> {
  const byDate = new Map<string, Holiday[]>();
  for (const holiday of holidays) {
    const bucket = byDate.get(holiday.date);
    if (bucket) bucket.push(holiday);
    else byDate.set(holiday.date, [holiday]);
  }
  return byDate;
}

/**
 * The soonest holiday on or after `from`, or `null` when the list has none left
 * (which is what the end of a year looks like) or `from` is not a date.
 */
export function nextHoliday(holidays: readonly Holiday[], from: string): Holiday | null {
  const anchor = parseDayKey(from);
  if (anchor === null) return null;
  const start = dayKey(anchor);

  let next: Holiday | null = null;
  for (const holiday of holidays) {
    // The keys are `YYYY-MM-DD`, so the comparison is already chronological.
    if (parseDayKey(holiday.date) === null || holiday.date < start) continue;
    if (next === null || holiday.date < next.date) next = holiday;
  }
  return next;
}
