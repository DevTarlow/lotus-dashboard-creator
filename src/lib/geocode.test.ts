import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetHttp } from '@/lib/http';
import { GEOCODE_TTL_MS, geocodeCity, geocodeCities, mapGeocodeResults, placeLabel } from '@/lib/geocode';

/** A trimmed Open-Meteo geocoding payload. */
const PAYLOAD = {
  results: [
    {
      id: 2267057,
      name: 'Lisbon',
      latitude: 38.72509,
      longitude: -9.1498,
      country_code: 'PT',
      timezone: 'Europe/Lisbon',
      population: 517_802,
      country: 'Portugal',
      admin1: 'Lisbon District',
    },
  ],
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

beforeEach(() => {
  resetHttp();
});

describe('mapGeocodeResults', () => {
  it('maps the provider payload', () => {
    expect(mapGeocodeResults(PAYLOAD)).toEqual([
      {
        name: 'Lisbon',
        country: 'Portugal',
        admin1: 'Lisbon District',
        latitude: 38.72509,
        longitude: -9.1498,
        timeZone: 'Europe/Lisbon',
        population: 517_802,
      },
    ]);
  });

  it('returns an empty list for no matches or a foreign payload', () => {
    expect(mapGeocodeResults({})).toEqual([]);
    expect(mapGeocodeResults({ results: [] })).toEqual([]);
    expect(mapGeocodeResults({ results: 'nope' })).toEqual([]);
    expect(mapGeocodeResults(null)).toEqual([]);
  });

  it('drops entries that could not be used as coordinates', () => {
    const mapped = mapGeocodeResults({
      results: [
        { name: 'Nowhere', latitude: 'x', longitude: 1 },
        { name: '', latitude: 1, longitude: 2 },
        { name: 'Somewhere', latitude: 1, longitude: 2 },
      ],
    });
    expect(mapped).toHaveLength(1);
    expect(mapped[0]).toMatchObject({ name: 'Somewhere', timeZone: 'UTC', admin1: null, population: null });
  });
});

describe('placeLabel', () => {
  it('joins the parts it has', () => {
    expect(
      placeLabel({ name: 'Lisbon', country: 'Portugal', admin1: 'Lisbon District', latitude: 0, longitude: 0, timeZone: 'UTC', population: null }),
    ).toBe('Lisbon, Lisbon District, Portugal');
    expect(
      placeLabel({ name: 'Lisbon', country: 'Portugal', admin1: null, latitude: 0, longitude: 0, timeZone: 'UTC', population: null }),
    ).toBe('Lisbon, Portugal');
    expect(
      placeLabel({ name: 'Atlantis', country: '', admin1: null, latitude: 0, longitude: 0, timeZone: 'UTC', population: null }),
    ).toBe('Atlantis');
  });
});

describe('geocodeCities', () => {
  it('asks the provider with the query and the count', async () => {
    const mock = vi.fn().mockImplementation(() => Promise.resolve(jsonResponse(PAYLOAD)));
    vi.stubGlobal('fetch', mock);

    const places = await geocodeCities('Lisbon', new AbortController().signal, 3);

    expect(places).toHaveLength(1);
    const url = String(mock.mock.calls[0][0]);
    expect(url).toContain('name=Lisbon');
    expect(url).toContain('count=3');
    expect(url).toContain('format=json');
    vi.unstubAllGlobals();
  });

  it('encodes a query with spaces and accents', async () => {
    const mock = vi.fn().mockImplementation(() => Promise.resolve(jsonResponse({ results: [] })));
    vi.stubGlobal('fetch', mock);

    await geocodeCities('São Paulo', new AbortController().signal);

    expect(String(mock.mock.calls[0][0])).toContain('name=S%C3%A3o%20Paulo');
    vi.unstubAllGlobals();
  });

  it('clamps the count and defaults it', async () => {
    const mock = vi.fn().mockImplementation(() => Promise.resolve(jsonResponse({ results: [] })));
    vi.stubGlobal('fetch', mock);

    await geocodeCities('Lisbon', new AbortController().signal, 9999);
    expect(String(mock.mock.calls[0][0])).toContain('count=10');

    vi.unstubAllGlobals();
  });

  it('makes no request for an empty query', async () => {
    const mock = vi.fn();
    vi.stubGlobal('fetch', mock);

    expect(await geocodeCities('   ', new AbortController().signal)).toEqual([]);
    expect(mock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('shares one lookup between callers, but not between different counts', async () => {
    const mock = vi.fn().mockImplementation(() => Promise.resolve(jsonResponse(PAYLOAD)));
    vi.stubGlobal('fetch', mock);
    const signal = new AbortController().signal;

    await Promise.all([geocodeCities('Lisbon', signal), geocodeCities('lisbon ', signal)]);
    expect(mock).toHaveBeenCalledTimes(1);

    await geocodeCities('Lisbon', signal, 2);
    expect(mock).toHaveBeenCalledTimes(2);

    // A repeat within the window is served from the cache.
    await geocodeCities('Lisbon', signal);
    expect(mock).toHaveBeenCalledTimes(2);
    expect(GEOCODE_TTL_MS).toBeGreaterThan(60 * 60 * 1000);
    vi.unstubAllGlobals();
  });

  it('rejects on a transport failure rather than inventing a place', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await expect(geocodeCities('Lisbon', new AbortController().signal)).rejects.toMatchObject({ code: 'network' });
    vi.unstubAllGlobals();
  });
});

describe('geocodeCity', () => {
  it('returns the first match, or null when there is none', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(jsonResponse(PAYLOAD))));
    expect((await geocodeCity('Lisbon', new AbortController().signal))?.name).toBe('Lisbon');
    vi.unstubAllGlobals();

    resetHttp();
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(jsonResponse({ results: [] }))));
    expect(await geocodeCity('Nowhereville', new AbortController().signal)).toBeNull();
    vi.unstubAllGlobals();
  });
});
