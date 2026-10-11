/**
 * Live weather from wttr.in — free, no API key, no signup, CORS enabled.
 *
 * `wttr.is` is the vendor's own recommended endpoint for automated clients (the
 * README points scripts, status bars and monitoring tools at it), so it is used
 * in preference to the `wttr.in` host.
 *
 * Everything here is deliberately pure apart from `fetchWeather`, which accepts
 * an injected fetch implementation so the unit suite never touches the network:
 * raw payload in, `WeatherSnapshot` out. The snapshot type is shared with the
 * simulated provider in `@/lib/mock/weather`, which means the widget does not
 * care where its numbers came from — and a failed request falls back cleanly.
 */
import type { HourlyForecast, WeatherCondition, WeatherSnapshot } from '@/lib/mock/weather';
import type { TemperatureUnit } from '@/lib/mock/weather';

/** Preferred host — the vendor recommends `wttr.is` for programmatic clients. */
export const WTTR_BASE_URL = 'https://wttr.is';

/** Fallback host, used only if the preferred one fails at the transport level. */
export const WTTR_FALLBACK_BASE_URL = 'https://wttr.in';

/**
 * How long a live snapshot is trusted before the widget refetches.
 *
 * wttr.in serves cached upstream data and caps how often it updates, so a
 * quarter-hour window keeps the panel current while staying a polite client.
 */
export const WEATHER_REFRESH_MS = 15 * 60 * 1000;

/**
 * Regions whose weather forecasts are conventionally in Fahrenheit.
 *
 * A first visit has to pick a unit before the user has chosen anything, and the
 * browser exposes no direct answer — the locale's region subtag is the best
 * signal there is. Getting it wrong is one click in the widget's settings; the
 * list is deliberately the well-known cases rather than a guess at the rest.
 */
const IMPERIAL_REGIONS = new Set(['US', 'BS', 'BZ', 'PW', 'FM', 'MH', 'LR', 'MM', 'GU', 'PR', 'VI', 'AS']);

/** The temperature unit a BCP-47 locale implies, defaulting to metric. */
export function preferredTemperatureUnit(locale: string | undefined): TemperatureUnit {
  if (!locale) return 'metric';
  const region = locale.split(/[-_]/)[1];
  return region && IMPERIAL_REGIONS.has(region.toUpperCase()) ? 'imperial' : 'metric';
}

/** Thrown when the live lookup fails, so callers can fall back to simulated data. */
export class WeatherError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WeatherError';
  }
}

/**
 * WorldWeatherOnline condition codes, grouped by the glyphs this app can draw.
 * Source: the vendor's published condition-code table (113 … 395).
 */
const CONDITION_BY_CODE: Record<number, WeatherCondition> = {
  113: 'clear',
  116: 'partly-cloudy',
  119: 'cloudy',
  122: 'cloudy',
  143: 'fog',
  176: 'rain',
  179: 'snow',
  182: 'sleet',
  185: 'sleet',
  200: 'storm',
  227: 'snow',
  230: 'snow',
  248: 'fog',
  260: 'fog',
  263: 'drizzle',
  266: 'drizzle',
  281: 'sleet',
  284: 'sleet',
  293: 'rain',
  296: 'rain',
  299: 'rain',
  302: 'rain',
  305: 'rain',
  308: 'rain',
  311: 'sleet',
  314: 'sleet',
  317: 'sleet',
  320: 'sleet',
  323: 'snow',
  326: 'snow',
  329: 'snow',
  332: 'snow',
  335: 'snow',
  338: 'snow',
  350: 'sleet',
  353: 'rain',
  356: 'rain',
  359: 'rain',
  362: 'sleet',
  365: 'sleet',
  368: 'snow',
  371: 'snow',
  374: 'sleet',
  377: 'sleet',
  386: 'storm',
  389: 'storm',
  392: 'storm',
  395: 'storm',
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * wttr.in is loose with types — it sends numbers as strings and wraps some
 * scalars in arrays of `{ value }` — so every read goes through a coercion
 * helper that returns `undefined` rather than `NaN` or `[object Object]`.
 */
function asNumber(value: unknown): number | undefined {
  const parsed = typeof value === 'number' ? value : Number.parseFloat(String(value));
  return Number.isFinite(parsed) ? parsed : undefined;
}

/** Reads the `[{ value }]` wrapper wttr.in uses for text fields. */
function asValue(value: unknown): string | undefined {
  if (typeof value === 'string') return value.trim() || undefined;
  if (Array.isArray(value)) {
    for (const entry of value) {
      const inner = asValue(entry);
      if (inner) return inner;
    }
    return undefined;
  }
  if (isRecord(value)) return asValue(value.value);
  return undefined;
}

/** Maps a WorldWeatherOnline code (and its text) onto a drawable condition. */
export function conditionFromCode(code: number | undefined, description?: string): WeatherCondition {
  if (code !== undefined) {
    const mapped = CONDITION_BY_CODE[code];
    if (mapped) return mapped;
  }
  const text = description?.toLowerCase() ?? '';
  if (/thunder/.test(text)) return 'storm';
  if (/snow|blizzard|ice pellets/.test(text)) return 'snow';
  if (/sleet|freezing (rain|drizzle)/.test(text)) return 'sleet';
  if (/drizzle/.test(text)) return 'drizzle';
  if (/rain|shower/.test(text)) return 'rain';
  if (/fog|mist/.test(text)) return 'fog';
  if (/overcast/.test(text)) return 'cloudy';
  if (/cloud/.test(text)) return 'partly-cloudy';
  if (/sunny|clear/.test(text)) return 'clear';
  return 'cloudy';
}

/** Parses a `"07:41 AM"` style clock into minutes since local midnight. */
function parseClockMinutes(value: unknown): number | undefined {
  const match = /^\s*(\d{1,2}):(\d{2})\s*([AaPp][Mm])\s*$/.exec(String(value ?? ''));
  if (!match) return undefined;
  const [, rawHour, rawMinute, meridiem] = match;
  const hour = (Number(rawHour) % 12) + (meridiem.toLowerCase() === 'pm' ? 12 : 0);
  return hour * 60 + Number(rawMinute);
}

/** Parses `"07:41 AM"` into decimal hours (7.68). */
export function parseClockHour(value: unknown): number | undefined {
  const minutes = parseClockMinutes(value);
  return minutes === undefined ? undefined : Number((minutes / 60).toFixed(2));
}

/**
 * How far the location's wall clock sits from UTC, in minutes.
 *
 * `format=j1` carries no UTC offset or timezone name, so it is derived from the
 * coordinates. Longitude is exact enough for this purpose (the widget labels
 * hours within a few hours of reality) and, unlike comparing the reported
 * `observation_time` against the viewer's clock, it cannot produce a nonsense
 * offset — that comparison is ambiguous without also knowing the location's
 * calendar date.
 */
export function zoneOffsetFromLongitude(longitude: number): number {
  return Math.round(longitude / 15) * 60;
}

/** Clamps a candidate offset into the range of real-world UTC offsets. */
function normalizeOffset(minutes: number): number {
  let offset = Math.round(minutes / 30) * 30;
  while (offset > 840) offset -= 1440; // > UTC+14
  while (offset < -720) offset += 1440; // < UTC-12
  return offset;
}

/**
 * Best-effort offset from the reported observation time, used only when the
 * payload has no coordinates. Ambiguous by nature, so the result is clamped to
 * a real-world range and rounded to the half hour.
 */
function inferZoneOffsetMinutes(observationTime: unknown, now: number): number {
  const minutes = parseClockMinutes(observationTime);
  if (minutes === undefined) return 0;
  const local = new Date(now);
  const localMinutes = local.getHours() * 60 + local.getMinutes();
  return normalizeOffset(localMinutes - minutes);
}

/** The offset to use for a payload, preferring its coordinates. */
function resolveZoneOffset(payload: Record<string, unknown>, observationTime: unknown, now: number): number {
  const area = Array.isArray(payload.nearest_area) ? payload.nearest_area.find(isRecord) : undefined;
  const longitude = asNumber(area?.longitude);
  if (longitude !== undefined && longitude >= -180 && longitude <= 180) {
    return zoneOffsetFromLongitude(longitude);
  }
  return inferZoneOffsetMinutes(observationTime, now);
}

/** Epoch ms for a wall clock at a location, from a calendar date and a number of
 * minutes past midnight there.
 *
 * Built with `Date.UTC` so the result never depends on the viewer's timezone.
 */
function zonedTimestamp(
  year: number,
  month: number,
  day: number,
  minutesOfDay: number,
  zoneOffsetMinutes: number,
): number {
  const wallClock = Date.UTC(year, month - 1, day, 0, 0, 0, 0) + minutesOfDay * 60000;
  return wallClock - zoneOffsetMinutes * 60000;
}

/** Reads a `{ sunrise }` style field that wttr.in may or may not wrap in an array. */
function readAstronomy(astronomy: unknown, key: 'sunrise' | 'sunset'): unknown {
  const entry = Array.isArray(astronomy) ? astronomy.find(isRecord) : astronomy;
  if (isRecord(entry) && entry[key] !== undefined) return entry[key];
  return isRecord(astronomy) ? astronomy[key] : undefined;
}

/**
 * The region line shown under the city — wttr.in resolves a bare name to the
 * nearest sub-district ("Alcantara" for Lisbon), so this is what tells the user
 * which place their query actually matched.
 */
export function resolvedRegion(payload: unknown): string | undefined {
  if (!isRecord(payload)) return undefined;
  const area = Array.isArray(payload.nearest_area) ? payload.nearest_area.find(isRecord) : undefined;
  if (!area) return undefined;
  const parts = [asValue(area.region), asValue(area.country)];
  const unique = parts.filter((part, index) => part && parts.indexOf(part) === index);
  return unique.length > 0 ? unique.join(', ') : undefined;
}

/**
 * The next `hours` 3-hourly slots, including the one in progress.
 *
 * wttr.in reports eight slots of three hours per day, each labelled with the
 * minutes past local midnight (0, 300, 600 …), so a six-slot outlook spans
 * roughly 18 hours and rolls into the following day.
 *
 * @param zoneOffsetMinutes location clock offset from the viewer's; derived
 *   from the payload's coordinates when omitted.
 */
export function mapHourlyForecast(
  payload: unknown,
  now: number,
  hours = 6,
  zoneOffsetMinutes?: number,
): HourlyForecast[] {
  const root = isRecord(payload) ? payload : {};
  const days = Array.isArray(root.weather) ? root.weather : [];
  const current = Array.isArray(root.current_condition) ? root.current_condition.find(isRecord) : undefined;
  const offset = zoneOffsetMinutes ?? resolveZoneOffset(root, current?.observation_time, now);
  const forecast: HourlyForecast[] = [];

  for (const day of days) {
    if (!isRecord(day)) continue;
    const date = typeof day.date === 'string' ? day.date : undefined;
    if (!date) continue;
    const slots = Array.isArray(day.hourly) ? day.hourly : [];

    for (const slot of slots) {
      if (!isRecord(slot)) continue;
      // Despite the name, `time` is minutes past local midnight.
      const slotMinutes = asNumber(slot.time);
      if (slotMinutes === undefined) continue;
      const parts = date.split('-').map(Number);
      const [year, month, dayOfMonth] = parts;
      if (parts.length !== 3 || !year || !month || !dayOfMonth) continue;
      const timestamp = zonedTimestamp(year, month, dayOfMonth, slotMinutes, offset);
      if (timestamp < now) continue;

      forecast.push({
        timestamp,
        temperatureC: asNumber(slot.tempC) ?? 0,
        condition: conditionFromCode(asNumber(slot.weatherCode), asValue(slot.weatherDesc)),
        precipitationChance: asNumber(slot.chanceofrain) ?? 0,
      });
      if (forecast.length >= hours) return forecast;
    }
  }

  return forecast;
}

/** Narrows unknown data (e.g. a stale persisted snapshot) to `WeatherSnapshot`. */
export function isWeatherSnapshot(value: unknown): value is WeatherSnapshot {
  if (!isRecord(value)) return false;
  return (
    typeof value.city === 'string' &&
    typeof value.temperatureC === 'number' &&
    typeof value.condition === 'string' &&
    typeof value.summary === 'string' &&
    Array.isArray(value.hourly) &&
    typeof value.updatedAt === 'number'
  );
}

/**
 * Converts a raw `format=j1` payload into the app's snapshot shape.
 *
 * @param city the user's query, kept as the display label so the widget shows
 *   what was asked for rather than the nearest sub-district wttr.in resolved.
 * @throws {WeatherError} when the payload carries no usable current conditions.
 */
export function parseWeatherResponse(payload: unknown, city: string, now = Date.now()): WeatherSnapshot {
  if (!isRecord(payload)) throw new WeatherError('Unexpected weather response.');

  const current = Array.isArray(payload.current_condition)
    ? payload.current_condition.find(isRecord)
    : undefined;
  if (!current) throw new WeatherError('The weather service returned no current conditions.');

  const zoneOffsetMinutes = resolveZoneOffset(payload, current.observation_time, now);
  const days = Array.isArray(payload.weather) ? payload.weather.filter(isRecord) : [];
  const today = days[0];
  const hourly = mapHourlyForecast(payload, now, 6, zoneOffsetMinutes);

  // The payload's `observation_time` is a wall clock at the location and can
  // trail the hourly data by hours (wttr.in serves cached upstream readings),
  // so it is carried as a label rather than converted into a timestamp that
  // would claim a freshness the data may not have.
  const observedAt = asValue(current.observation_time);

  const description = asValue(current.weatherDesc);
  const condition = conditionFromCode(asNumber(current.weatherCode), description);
  const temperatureC = asNumber(current.temp_C) ?? 0;
  const summary = description ?? 'Current conditions';

  // Sunrise/sunset are only meaningful when the payload provides them; the
  // widget renders them defensively, so 0/0 is an acceptable "unknown".
  const sunrise = parseClockHour(readAstronomy(today?.astronomy, 'sunrise'));
  const sunset = parseClockHour(readAstronomy(today?.astronomy, 'sunset'));

  return {
    city,
    region: resolvedRegion(payload),
    condition,
    temperatureC,
    feelsLikeC: asNumber(current.FeelsLikeC) ?? temperatureC,
    humidity: Math.round(asNumber(current.humidity) ?? 0),
    windKph: Math.round(asNumber(current.windspeedKmph) ?? 0),
    highC: asNumber(today?.maxtempC) ?? temperatureC,
    lowC: asNumber(today?.mintempC) ?? temperatureC,
    summary,
    sunriseHour: sunrise ?? 0,
    sunsetHour: sunset ?? 0,
    hourly,
    simulated: false,
    observedAt,
    updatedAt: now,
  };
}

export interface FetchWeatherOptions {
  signal?: AbortSignal;
  /** Injected for tests; defaults to the global `fetch`. */
  fetchImpl?: typeof fetch;
  /** Clock override, so parsed timestamps are deterministic under test. */
  now?: number;
}

function currentHost(baseUrl: string): string {
  return baseUrl.replace(/^https?:\/\//, '');
}

/**
 * Looks up live weather for a place name.
 *
 * @throws {WeatherError} on an unknown location, a non-JSON response (wttr.in
 *   answers some failures with HTML) or a transport error, so the caller can
 *   fall back to the simulated provider.
 */
export async function fetchWeather(
  city: string,
  { signal, fetchImpl = fetch, now = Date.now() }: FetchWeatherOptions = {},
): Promise<WeatherSnapshot> {
  const query = city.trim();
  if (!query) throw new WeatherError('Enter a city to load live weather.');

  const path = `/${encodeURIComponent(query).replace(/%20/g, '+')}?format=j1`;
  const hosts = [WTTR_BASE_URL, WTTR_FALLBACK_BASE_URL];
  let lastError: WeatherError | null = null;

  for (const host of hosts) {
    let response: Response;
    try {
      response = await fetchImpl(`${host}${path}`, { signal, headers: { Accept: 'application/json' } });
    } catch (error) {
      // Let an intentional abort propagate untouched.
      if (signal?.aborted || (error instanceof DOMException && error.name === 'AbortError')) throw error;
      lastError = new WeatherError(`${currentHost(host)} is unreachable.`);
      continue;
    }

    if (!response.ok) {
      lastError = new WeatherError(
        response.status === 500
          ? `No weather found for “${query}”.`
          : `${currentHost(host)} responded with ${response.status}.`,
      );
      continue;
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      lastError = new WeatherError(`${currentHost(host)} returned an unreadable response.`);
      continue;
    }

    try {
      return parseWeatherResponse(payload, query, now);
    } catch (error) {
      if (error instanceof WeatherError) throw error;
      throw new WeatherError('Could not read the weather response.');
    }
  }

  throw lastError ?? new WeatherError('Live weather is unavailable.');
}

/** Re-exported so the widget needs a single import for both data sources. */
export type { HourlyForecast, TemperatureUnit, WeatherCondition, WeatherSnapshot };
