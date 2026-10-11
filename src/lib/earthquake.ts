/**
 * Recent earthquakes from the USGS "latest earthquakes" feeds.
 *
 * The provider publishes one static GeoJSON file per magnitude threshold and
 * time window (`2.5_day.geojson` and friends), refreshed every minute, keyless
 * and CORS-enabled. Three things about that data are easy to get wrong, and this
 * module is where they are pinned down:
 *
 * - **Longitude comes first.** GeoJSON stores `coordinates` as
 *   `[longitude, latitude, depth]`, the reverse of how every human writes a
 *   location. Reading it in the intuitive order puts Lisbon in Somalia, so the
 *   swap is done once, here, and unit tested.
 * - **A quiet feed is not an outage.** A window with nothing to report is served
 *   as a valid `FeatureCollection` with an empty `features` array, and USGS does
 *   the same for a URL it does not recognise: a `200` carrying `404 File Not
 *   Found` as plain text. Mapping a real empty feed therefore yields "nothing
 *   recorded", while a payload that is plainly not GeoJSON throws, so the widget
 *   can say "unavailable" instead of pretending the planet was quiet.
 * - **Absent is not zero.** A magnitude can be `null` (an unreviewed event) and
 *   `felt` is `-1` when no one has reported shaking; both stay `null` rather
 *   than becoming a confident `0`.
 *
 * Distances are never invented either: `withDistance` only annotates quakes that
 * carry coordinates, and `withinRadius` keeps only those.
 */
import { distanceKm } from '@/lib/geo';
import { HttpError, requestJson } from '@/lib/http';
import type { AccentTone } from '@/types';

/** USGS rebuilds every feed once a minute; five minutes is polite and keeps a dashboard quiet. */
export const QUAKE_REFRESH_MS = 5 * 60 * 1000;

/** How long the shared HTTP layer may reuse a feed payload. */
export const QUAKE_TTL_MS = 5 * 60 * 1000;

export type QuakeFeed = 'significant' | '4.5' | '2.5' | '1.0' | 'all';
export type QuakeWindow = 'hour' | 'day' | 'week' | 'month';

/** Feed thresholds, in the order the settings select offers them. */
export const QUAKE_FEEDS: readonly { id: QuakeFeed; label: string }[] = [
  { id: 'significant', label: 'Significant only' },
  { id: '4.5', label: 'M4.5+' },
  { id: '2.5', label: 'M2.5+' },
  { id: '1.0', label: 'M1.0+' },
  { id: 'all', label: 'All earthquakes' },
];

export const QUAKE_WINDOWS: readonly { id: QuakeWindow; label: string }[] = [
  { id: 'hour', label: 'Past hour' },
  { id: 'day', label: 'Past day' },
  { id: 'week', label: 'Past week' },
  { id: 'month', label: 'Past month' },
];

/** One event, as much as the summary feed knows about it. */
export interface Quake {
  id: string;
  magnitude: number | null;
  place: string;
  /** Epoch ms the quake happened. */
  time: number;
  url: string;
  depthKm: number | null;
  coordinates: { latitude: number; longitude: number } | null;
  tsunami: boolean;
  /** Number of reports, when the provider counted any. */
  felt: number | null;
  alert: string | null;
  /** Filled in by `withDistance` when a centre is known. */
  distanceKm?: number;
}

export interface QuakeFeedResult {
  quakes: Quake[];
  /** Epoch ms the provider generated the feed. */
  generatedAt: number | null;
  /** How many features the feed carried before the cap. */
  total: number;
}

const QUAKE_ENDPOINT = 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary';

/**
 * Windows each feed is published for.
 *
 * Magnitude feeds exist for all four windows. The "significant" list is a
 * curated digest and USGS only publishes it for the **day** and the **week**;
 * asking for `significant_hour` or `significant_month` is not a quieter answer,
 * it is no feed at all, so those requests are redirected rather than sent.
 */
const SERVED_WINDOWS: Record<QuakeFeed, readonly QuakeWindow[]> = {
  significant: ['day', 'week'],
  '4.5': ['hour', 'day', 'week', 'month'],
  '2.5': ['hour', 'day', 'week', 'month'],
  '1.0': ['hour', 'day', 'week', 'month'],
  all: ['hour', 'day', 'week', 'month'],
};

/**
 * Where to look when a combination is not served, nearest window first: a
 * "past day" request that cannot be met is better answered by a week of data
 * than by a silent 404 that reads as an outage.
 */
const WINDOW_FALLBACK: readonly QuakeWindow[] = ['hour', 'day', 'week', 'month'];

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asFiniteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** The feed and window a request will actually use, after any fallback. */
export function resolveFeedWindow(
  feed: QuakeFeed,
  requested: QuakeWindow,
): { feed: QuakeFeed; window: QuakeWindow } {
  // Config is untrusted input, so a stored `feed` that is not in the table at
  // all still has to resolve to something the provider serves.
  const served = (SERVED_WINDOWS as Record<string, readonly QuakeWindow[] | undefined>)[feed] ?? ['day'];
  if (served.includes(requested)) return { feed, window: requested };
  const fromRequested = WINDOW_FALLBACK.indexOf(requested);
  const nearest = [...served].sort(
    (a, b) =>
      Math.abs(WINDOW_FALLBACK.indexOf(a) - fromRequested) -
      Math.abs(WINDOW_FALLBACK.indexOf(b) - fromRequested),
  );
  // A feed with no windows at all cannot happen with the table above, but the
  // index is typed `QuakeWindow | undefined` and a fallback keeps it total.
  return { feed, window: nearest[0] ?? served[0] ?? 'day' };
}

/** `true` when USGS publishes this feed for this window. */
export function isFeedWindowServed(feed: QuakeFeed, window: QuakeWindow): boolean {
  return ((SERVED_WINDOWS as Record<string, readonly QuakeWindow[] | undefined>)[feed] ?? []).includes(window);
}

/** Which feeds publish a given window; the settings form can use it to hide dead options. */
export function feedsForWindow(window: QuakeWindow): QuakeFeed[] {
  return QUAKE_FEEDS.map((entry) => entry.id).filter((id) => isFeedWindowServed(id, window));
}

/** The GeoJSON URL for a feed, falling back to a served combination when needed. */
export function quakeFeedUrl(feed: QuakeFeed, window: QuakeWindow): string {
  const resolved = resolveFeedWindow(feed, window);
  return `${QUAKE_ENDPOINT}/${resolved.feed}_${resolved.window}.geojson`;
}

/**
 * Read `geometry.coordinates` as `[longitude, latitude, depth]` — GeoJSON order.
 * Anything that is not a usable point leaves the quake without coordinates
 * rather than on the null island.
 */
function readCoordinates(geometry: unknown): { coordinates: Quake['coordinates']; depthKm: number | null } {
  const record = asRecord(geometry);
  if (record === null || record.type !== 'Point' || !Array.isArray(record.coordinates)) {
    return { coordinates: null, depthKm: null };
  }
  const longitude = asFiniteNumber(record.coordinates[0]);
  const latitude = asFiniteNumber(record.coordinates[1]);
  if (longitude === null || latitude === null) return { coordinates: null, depthKm: null };
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return { coordinates: null, depthKm: null };
  return {
    coordinates: { latitude, longitude },
    depthKm: asFiniteNumber(record.coordinates[2]),
  };
}

function mapFeature(feature: unknown): Quake | null {
  const record = asRecord(feature);
  if (record === null) return null;
  const properties = asRecord(record.properties);
  if (properties === null) return null;

  const time = asFiniteNumber(properties.time);
  if (time === null) return null;

  // USGS marks "nobody reported feeling this" with -1; that is not a count.
  const felt = asFiniteNumber(properties.felt);
  const alert = asText(properties.alert);
  const { coordinates, depthKm } = readCoordinates(record.geometry);
  const id = asText(record.id);

  return {
    // Without an id, time plus the point is as unique as the feed gets.
    id: id !== '' ? id : `${time}:${coordinates?.latitude ?? ''},${coordinates?.longitude ?? ''}`,
    magnitude: asFiniteNumber(properties.mag),
    place: asText(properties.place),
    time,
    url: asText(properties.url),
    depthKm,
    coordinates,
    tsunami: properties.tsunami === 1,
    felt: felt === null || felt < 0 ? null : felt,
    alert: alert === '' ? null : alert,
  };
}

/**
 * Map a summary feed. A payload that is not a `FeatureCollection` — an HTML or
 * plain-text error page served with a `200`, or a bare string — throws, because
 * calling that "no earthquakes" would be a lie; every other shape yields what it
 * managed to carry.
 */
export function mapQuakeFeed(payload: unknown): QuakeFeedResult {
  const record = asRecord(payload);
  if (record === null || record.type !== 'FeatureCollection' || !Array.isArray(record.features)) {
    throw new HttpError('The earthquake feed did not look like GeoJSON.', 'parse');
  }

  const metadata = asRecord(record.metadata);
  const generated = metadata === null ? null : asFiniteNumber(metadata.generated);
  const count = metadata === null ? null : asFiniteNumber(metadata.count);
  const features = record.features as unknown[];

  const quakes: Quake[] = [];
  for (const feature of features) {
    const quake = mapFeature(feature);
    if (quake !== null) quakes.push(quake);
  }

  return {
    quakes,
    generatedAt: generated,
    // The provider's own count when it sent one; otherwise what we could read.
    total: count === null ? quakes.length : Math.max(quakes.length, Math.round(count)),
  };
}

/** Most recent first. */
export function sortQuakes(quakes: readonly Quake[]): Quake[] {
  return [...quakes].sort((a, b) => b.time - a.time);
}

/** The highest magnitude in the set; ties go to the more recent quake. */
export function strongest(quakes: readonly Quake[]): Quake | null {
  let best: Quake | null = null;
  for (const quake of quakes) {
    if (quake.magnitude === null) continue;
    if (
      best === null ||
      quake.magnitude > (best.magnitude ?? Number.NEGATIVE_INFINITY) ||
      (quake.magnitude === best.magnitude && quake.time > best.time)
    ) {
      best = quake;
    }
  }
  return best;
}

/**
 * Annotate each quake with its distance from `centre`. Returns new objects and
 * leaves quakes without coordinates untouched — no distance is better than a
 * distance measured from a point nobody knows.
 */
export function withDistance(
  quakes: readonly Quake[],
  centre: { latitude: number; longitude: number },
): Quake[] {
  return quakes.map((quake) =>
    quake.coordinates === null
      ? quake
      : { ...quake, distanceKm: distanceKm(centre, quake.coordinates) },
  );
}

/** Keep only quakes `withDistance` placed within the radius. */
export function withinRadius(quakes: readonly Quake[], radiusKm: number): Quake[] {
  if (!Number.isFinite(radiusKm)) return [];
  return quakes.filter((quake) => quake.distanceKm !== undefined && quake.distanceKm <= radiusKm);
}

/**
 * The magnitude class USGS's own colour scale describes, plus the accent tone
 * the widget paints it with.
 */
export function magnitudeBand(magnitude: number | null): { label: string; tone: AccentTone } {
  if (magnitude === null || !Number.isFinite(magnitude)) return { label: 'Unknown', tone: 'slate' };
  if (magnitude < 2) return { label: 'Micro', tone: 'slate' };
  if (magnitude < 4) return { label: 'Minor', tone: 'sky' };
  if (magnitude < 5) return { label: 'Light', tone: 'amber' };
  if (magnitude < 6) return { label: 'Moderate', tone: 'amber' };
  if (magnitude < 7) return { label: 'Strong', tone: 'rose' };
  return { label: 'Major', tone: 'rose' };
}

/**
 * Fetch and map one feed through the shared HTTP layer, so two widgets watching
 * the same feed share a single request.
 */
export async function fetchQuakes(
  feed: QuakeFeed,
  window: QuakeWindow,
  signal: AbortSignal,
): Promise<{ data: QuakeFeedResult; fromCache: boolean }> {
  const resolved = resolveFeedWindow(feed, window);
  const url = quakeFeedUrl(resolved.feed, resolved.window);
  const response = await requestJson<unknown>(`usgs-quakes:${resolved.feed}_${resolved.window}`, url, {
    ttlMs: QUAKE_TTL_MS,
    signal,
  });
  return { data: mapQuakeFeed(response.data), fromCache: response.fromCache };
}
