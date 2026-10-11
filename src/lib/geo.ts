/**
 * Geographic helpers — great-circle distance and coordinate labels.
 *
 * Pure maths, no DOM and no network. `distanceKm` is exact for the haversine
 * model, while the two formatters round for display: sub-unit distances keep one
 * decimal, anything larger is shown as a whole number with thousands separators.
 * Non-finite input never leaks into a label — formatters fall back to an em dash.
 *
 * Coordinates that arrive from imported files or widget config are not trusted,
 * so `normalizeCoordinates` clamps latitude to [-90, 90] and wraps longitude into
 * [-180, 180). `NaN` becomes `0` rather than propagating through the app.
 */

/** A WGS84 point. Values are degrees, north and east positive. */
export interface Coordinates {
  latitude: number;
  longitude: number;
}

/** Mean Earth radius in kilometres — the value used by the haversine formula. */
const EARTH_RADIUS_KM = 6371.0088;

/** Shown when a formatter is handed something that is not a finite number. */
const INVALID = '—';

const DEGREE = Math.PI / 180;
const KM_PER_MILE = 0.621371;

/** Great-circle distance in kilometres (haversine, mean Earth radius 6371.0088 km). */
export function distanceKm(a: Coordinates, b: Coordinates): number {
  const from = normalizeCoordinates(a);
  const to = normalizeCoordinates(b);
  const deltaLat = (to.latitude - from.latitude) * DEGREE;
  const deltaLon = (to.longitude - from.longitude) * DEGREE;
  const halfLat = Math.sin(deltaLat / 2);
  const halfLon = Math.sin(deltaLon / 2);
  const h = halfLat * halfLat + Math.cos(from.latitude * DEGREE) * Math.cos(to.latitude * DEGREE) * halfLon * halfLon;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Short human distance, e.g. "1.2 km", "340 km", "12,400 km" (or miles when asked). */
export function formatDistance(km: number, unit: 'km' | 'mi' = 'km'): string {
  const prefix = unit === 'mi' ? '≈' : '';
  if (!Number.isFinite(km)) return `${prefix}${INVALID}`;
  const value = unit === 'mi' ? km * KM_PER_MILE : km;
  const label = unit === 'mi' ? 'mi' : 'km';
  const rounded = Math.abs(value) < 10 ? value.toFixed(1) : Math.round(value).toLocaleString('en-US');
  return `${prefix}${rounded} ${label}`;
}

/** `` `${degrees.toFixed(1)}°N` ``-style label, e.g. 38.72 → "38.7°N", -9.14 → "9.1°W". */
export function formatCoordinates(coords: Coordinates): string {
  const { latitude, longitude } = normalizeCoordinates(coords);
  const north = latitude < 0 ? 'S' : 'N';
  const east = longitude < 0 ? 'W' : 'E';
  return `${Math.abs(latitude).toFixed(1)}°${north}, ${Math.abs(longitude).toFixed(1)}°${east}`;
}

/** Clamp latitude to [-90, 90] and wrap longitude into [-180, 180); used on imported/config coordinates. */
export function normalizeCoordinates(coords: Coordinates): Coordinates {
  const latitude = Number.isFinite(coords.latitude) ? coords.latitude : 0;
  const longitude = Number.isFinite(coords.longitude) ? coords.longitude : 0;
  // `|| 0` keeps a clamped or wrapped `-0` from flipping the hemisphere label.
  return {
    latitude: Math.min(90, Math.max(-90, latitude)) || 0,
    longitude: ((((longitude + 180) % 360) + 360) % 360) - 180 || 0,
  };
}
