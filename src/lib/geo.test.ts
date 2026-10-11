import { describe, expect, it } from 'vitest';
import { distanceKm, formatCoordinates, formatDistance, normalizeCoordinates } from '@/lib/geo';

/** Readable aliases so the expectations below read like the places they name. */
const lisbon = { latitude: 38.7223, longitude: -9.1393 };
const madrid = { latitude: 40.4168, longitude: -3.7038 };
const london = { latitude: 51.5074, longitude: -0.1278 };
const newYork = { latitude: 40.7128, longitude: -74.006 };

describe('distanceKm', () => {
  it('measures Lisbon → Madrid at roughly 502 km', () => {
    expect(distanceKm(lisbon, madrid)).toBeGreaterThan(502 - 5);
    expect(distanceKm(lisbon, madrid)).toBeLessThan(502 + 5);
  });

  it('measures London → New York at roughly 5570 km', () => {
    expect(Math.abs(distanceKm(london, newYork) - 5570)).toBeLessThanOrEqual(30);
  });

  it('returns exactly 0 for identical points', () => {
    expect(distanceKm(london, london)).toBe(0);
  });

  it('measures antipodal points at roughly 20015 km', () => {
    expect(Math.abs(distanceKm({ latitude: 0, longitude: 0 }, { latitude: 0, longitude: 180 }) - 20015)).toBeLessThanOrEqual(50);
  });

  it('is symmetric', () => {
    expect(distanceKm(lisbon, newYork)).toBe(distanceKm(newYork, lisbon));
  });

  it('does not mutate its arguments', () => {
    const a = { ...lisbon };
    distanceKm(a, madrid);
    expect(a).toEqual(lisbon);
  });
});

describe('formatDistance', () => {
  it('keeps one decimal below ten units, sub-kilometre included', () => {
    expect(formatDistance(0.42)).toBe('0.4 km');
    expect(formatDistance(0.96)).toBe('1.0 km');
    expect(formatDistance(1.2)).toBe('1.2 km');
    expect(formatDistance(9.94)).toBe('9.9 km');
  });

  it('drops pointless decimals for large values', () => {
    expect(formatDistance(340.2)).toBe('340 km');
    expect(formatDistance(1000)).toBe('1,000 km');
    expect(formatDistance(20015.1)).toBe('20,015 km');
  });

  it('converts to miles when asked (1 km ≈ 0.621371 mi)', () => {
    expect(formatDistance(1, 'mi')).toBe('≈0.6 mi');
    expect(formatDistance(1.609344, 'mi')).toBe('≈1.0 mi');
  });

  it('never renders "NaN" for non-finite input', () => {
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(formatDistance(value)).not.toContain('NaN');
      expect(formatDistance(value, 'mi')).not.toContain('NaN');
    }
    expect(formatDistance(Number.NaN)).toBe('—');
  });
});

describe('formatCoordinates', () => {
  it('selects the hemisphere letters', () => {
    expect(formatCoordinates({ latitude: 38.72, longitude: -9.14 })).toBe('38.7°N, 9.1°W');
    expect(formatCoordinates({ latitude: -33.87, longitude: 151.21 })).toBe('33.9°S, 151.2°E');
    expect(formatCoordinates({ latitude: 51.5074, longitude: -0.1278 })).toBe('51.5°N, 0.1°W');
  });

  it('rounds each axis to one decimal independently', () => {
    expect(formatCoordinates({ latitude: 40.7128, longitude: -74.006 })).toBe('40.7°N, 74.0°W');
    expect(formatCoordinates({ latitude: 89.96, longitude: 179.99 })).toBe('90.0°N, 180.0°E');
  });

  it('handles the equator and prime meridian as positive zero', () => {
    expect(formatCoordinates({ latitude: 0, longitude: 0 })).toBe('0.0°N, 0.0°E');
    expect(formatCoordinates({ latitude: -0, longitude: -0 })).toBe('0.0°N, 0.0°E');
    expect(formatCoordinates({ latitude: -0.04, longitude: -0.04 })).toBe('0.0°S, 0.0°W');
  });
});

describe('normalizeCoordinates', () => {
  it('clamps latitude to [-90, 90]', () => {
    expect(normalizeCoordinates({ latitude: 123.4, longitude: 0 }).latitude).toBe(90);
    expect(normalizeCoordinates({ latitude: -123.4, longitude: 0 }).latitude).toBe(-90);
    expect(normalizeCoordinates({ latitude: 45, longitude: 0 }).latitude).toBe(45);
  });

  it('wraps longitude past ±180 into [-180, 180)', () => {
    expect(normalizeCoordinates({ latitude: 0, longitude: 190 }).longitude).toBe(-170);
    expect(normalizeCoordinates({ latitude: 0, longitude: -190 }).longitude).toBe(170);
    expect(normalizeCoordinates({ latitude: 0, longitude: 540 }).longitude).toBe(-180);
    expect(normalizeCoordinates({ latitude: 0, longitude: 180 }).longitude).toBe(-180);
  });

  it('treats NaN as 0 so bad config from an import cannot spread', () => {
    expect(normalizeCoordinates({ latitude: Number.NaN, longitude: Number.NaN })).toEqual({ latitude: 0, longitude: 0 });
    expect(normalizeCoordinates({ latitude: Number.NaN, longitude: 20 })).toEqual({ latitude: 0, longitude: 20 });
    expect(formatCoordinates({ latitude: Number.NaN, longitude: Number.NaN })).not.toContain('NaN');
  });
});
