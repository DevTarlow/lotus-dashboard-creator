/**
 * City → coordinates, for the widgets that need a place rather than a name.
 *
 * The weather widget can hand wttr.in a city name and let it resolve the place,
 * but the air-quality, sun and seismic widgets compute or query against a
 * latitude and longitude — and each of them also wants the location's own IANA
 * time zone so "sunrise" means sunrise *there*, not where the viewer is sitting.
 *
 * Open-Meteo's geocoding service is keyless, sends
 * `access-control-allow-origin: *`, and answers with all of that in one request.
 * Results are cached for a day through the shared HTTP layer, so three widgets
 * pointed at Lisbon produce one lookup between them.
 */
import { requestJson } from '@/lib/http';

/** A city, resolved as far as the geocoder knows it. */
export interface GeoPlace {
  name: string;
  country: string;
  /** First-level administrative area, when the provider knows it. */
  admin1: string | null;
  latitude: number;
  longitude: number;
  /** IANA zone of the place itself, e.g. `Europe/Lisbon`. */
  timeZone: string;
  population: number | null;
}

/** Places change slowly; a day-long window is generous and keeps the API quiet. */
export const GEOCODE_TTL_MS = 24 * 60 * 60 * 1000;

const GEOCODE_ENDPOINT = 'https://geocoding-api.open-meteo.com/v1/search';

/** How many matches a single search may return. */
export const MAX_GEOCODE_RESULTS = 10;

function asText(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function asNumberOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** Map the geocoding payload; entries without usable coordinates are dropped. */
export function mapGeocodeResults(payload: unknown): GeoPlace[] {
  if (typeof payload !== 'object' || payload === null) return [];
  const results = (payload as { results?: unknown }).results;
  if (!Array.isArray(results)) return [];

  const places: GeoPlace[] = [];
  for (const entry of results) {
    if (typeof entry !== 'object' || entry === null) continue;
    const record = entry as Record<string, unknown>;
    const latitude = asNumberOrNull(record.latitude);
    const longitude = asNumberOrNull(record.longitude);
    const name = asText(record.name);
    if (latitude === null || longitude === null || name === '') continue;
    places.push({
      name,
      country: asText(record.country),
      admin1: asText(record.admin1) || null,
      latitude,
      longitude,
      timeZone: asText(record.timezone) || 'UTC',
      population: asNumberOrNull(record.population),
    });
  }
  return places;
}

/** "Lisbon, Portugal" / "Portland, Oregon, United States". */
export function placeLabel(place: GeoPlace): string {
  return [place.name, place.admin1, place.country].filter((part): part is string => Boolean(part)).join(', ');
}

/**
 * Search for a place by name. Returns `[]` for an empty query, an unknown city
 * or a payload that does not look like a search result — "no match" is a normal
 * answer, not an error, and the widgets say so rather than guessing a place.
 */
export async function geocodeCities(
  query: string,
  signal: AbortSignal,
  count: number = MAX_GEOCODE_RESULTS,
): Promise<GeoPlace[]> {
  const trimmed = query.trim();
  if (trimmed === '') return [];

  const wanted = Math.max(1, Math.min(MAX_GEOCODE_RESULTS, Math.round(count)));
  const url = `${GEOCODE_ENDPOINT}?name=${encodeURIComponent(trimmed)}&count=${wanted}&language=en&format=json`;
  const key = `geocode:${trimmed.toLowerCase()}:${wanted}`;

  const response = await requestJson<unknown>(key, url, { ttlMs: GEOCODE_TTL_MS, signal });
  return mapGeocodeResults(response.data);
}

/** The single best match for a city name, or `null` when nothing matched. */
export async function geocodeCity(query: string, signal: AbortSignal): Promise<GeoPlace | null> {
  const matches = await geocodeCities(query, signal, 1);
  return matches[0] ?? null;
}
