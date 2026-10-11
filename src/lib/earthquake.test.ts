import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  feedsForWindow,
  fetchQuakes,
  isFeedWindowServed,
  magnitudeBand,
  mapQuakeFeed,
  QUAKE_FEEDS,
  QUAKE_TTL_MS,
  QUAKE_WINDOWS,
  quakeFeedUrl,
  resolveFeedWindow,
  sortQuakes,
  strongest,
  withDistance,
  withinRadius,
  type Quake,
} from '@/lib/earthquake';
import { HttpError, resetHttp } from '@/lib/http';

/**
 * A trimmed `2.5_day.geojson` payload with the awkward parts left in: the
 * coordinates are in GeoJSON order (longitude first, so `-9.14` puts this quake
 * off the Portuguese coast and not in Somalia), one feature has no geometry at
 * all, and one has a `null` magnitude — both of which the real feeds contain.
 */
const PAYLOAD = {
  type: 'FeatureCollection',
  metadata: {
    generated: 1_760_000_000_000,
    url: 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson',
    title: 'USGS Magnitude 2.5+ Earthquakes, Past Day',
    status: 200,
    api: '1.14.1',
    count: 3,
  },
  features: [
    {
      type: 'Feature',
      properties: {
        mag: 4.6,
        place: '20 km W of Lisbon, Portugal',
        time: 1_759_999_000_000,
        url: 'https://earthquake.usgs.gov/earthquakes/eventpage/us7000abcd',
        felt: 12,
        alert: 'green',
        tsunami: 1,
      },
      geometry: { type: 'Point', coordinates: [-9.14, 38.72, 12.5] },
      id: 'us7000abcd',
    },
    {
      type: 'Feature',
      properties: {
        mag: 3.1,
        place: '5 km S of Naples, Italy',
        time: 1_759_998_000_000,
        url: 'https://earthquake.usgs.gov/earthquakes/eventpage/us7000abce',
        felt: -1,
        alert: null,
        tsunami: 0,
      },
      geometry: { type: 'Point', coordinates: [14.25, 40.84, 8] },
      id: 'us7000abce',
    },
    {
      type: 'Feature',
      properties: {
        mag: 2.7,
        place: 'Central Mid-Atlantic Ridge',
        time: 1_759_997_000_000,
        url: 'https://earthquake.usgs.gov/earthquakes/eventpage/us7000abcf',
        felt: null,
        alert: null,
        tsunami: 0,
      },
      geometry: null,
      id: 'us7000abcf',
    },
  ],
};

/** Lisbon, the widget's default place. */
const LISBON = { latitude: 38.72, longitude: -9.14 };

function feature(overrides: {
  id?: string;
  mag?: number | null;
  time?: number;
  coordinates?: unknown;
  felt?: number | null;
}): Record<string, unknown> {
  return {
    type: 'Feature',
    properties: {
      mag: overrides.mag === undefined ? 4 : overrides.mag,
      place: 'Somewhere',
      time: overrides.time ?? 1_759_999_000_000,
      url: 'https://earthquake.usgs.gov/earthquakes/eventpage/x',
      felt: overrides.felt ?? null,
      alert: null,
      tsunami: 0,
    },
    geometry: { type: 'Point', coordinates: overrides.coordinates ?? [0, 0, 10] },
    id: overrides.id ?? 'id',
  };
}

function feed(features: unknown[]): Record<string, unknown> {
  return { type: 'FeatureCollection', metadata: { generated: 1_760_000_000_000, count: features.length }, features };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('quakeFeedUrl', () => {
  it('builds the documented URL for every feed and window', () => {
    expect(quakeFeedUrl('all', 'hour')).toBe(
      'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_hour.geojson',
    );
    expect(quakeFeedUrl('all', 'day')).toBe(
      'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson',
    );
    expect(quakeFeedUrl('significant', 'day')).toBe(
      'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/significant_day.geojson',
    );
    expect(quakeFeedUrl('4.5', 'week')).toBe(
      'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_week.geojson',
    );
    expect(quakeFeedUrl('2.5', 'month')).toBe(
      'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_month.geojson',
    );
    expect(quakeFeedUrl('1.0', 'day')).toBe(
      'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/1.0_day.geojson',
    );
  });

  it('offers every feed and every window in the settings tables', () => {
    expect(QUAKE_FEEDS.map((entry) => entry.id)).toEqual(['significant', '4.5', '2.5', '1.0', 'all']);
    expect(QUAKE_WINDOWS.map((entry) => entry.id)).toEqual(['hour', 'day', 'week', 'month']);
  });

  it('knows which combinations USGS serves', () => {
    // The magnitude feeds exist for every window; "significant" is a curated
    // digest that USGS publishes for the day and the week only.
    expect(isFeedWindowServed('significant', 'hour')).toBe(false);
    expect(isFeedWindowServed('significant', 'day')).toBe(true);
    expect(isFeedWindowServed('significant', 'week')).toBe(true);
    expect(isFeedWindowServed('significant', 'month')).toBe(false);
    for (const feed of ['4.5', '2.5', '1.0', 'all'] as const) {
      for (const window of QUAKE_WINDOWS) {
        expect(isFeedWindowServed(feed, window.id), `${feed}_${window.id}`).toBe(true);
      }
    }
    expect(feedsForWindow('hour')).toEqual(['4.5', '2.5', '1.0', 'all']);
    expect(feedsForWindow('day')).toEqual(['significant', '4.5', '2.5', '1.0', 'all']);
  });

  it('falls back to a served window instead of asking for a URL that 404s', () => {
    expect(resolveFeedWindow('significant', 'hour')).toEqual({ feed: 'significant', window: 'day' });
    expect(resolveFeedWindow('significant', 'month')).toEqual({ feed: 'significant', window: 'week' });
    expect(resolveFeedWindow('2.5', 'day')).toEqual({ feed: '2.5', window: 'day' });
    expect(quakeFeedUrl('significant', 'hour')).toBe(
      'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/significant_day.geojson',
    );
    // A hand-edited config can hold anything; the resolver stays total.
    expect(resolveFeedWindow('nonsense' as never, 'day')).toEqual({ feed: 'nonsense', window: 'day' });
  });
});

describe('mapQuakeFeed', () => {
  it('maps a full payload, reading coordinates as [longitude, latitude, depth]', () => {
    const result = mapQuakeFeed(PAYLOAD);

    expect(result.generatedAt).toBe(1_760_000_000_000);
    expect(result.total).toBe(3);
    expect(result.quakes).toHaveLength(3);

    const [first] = result.quakes;
    expect(first.id).toBe('us7000abcd');
    expect(first.magnitude).toBe(4.6);
    expect(first.place).toBe('20 km W of Lisbon, Portugal');
    expect(first.time).toBe(1_759_999_000_000);
    expect(first.url).toBe('https://earthquake.usgs.gov/earthquakes/eventpage/us7000abcd');
    expect(first.depthKm).toBe(12.5);
    expect(first.tsunami).toBe(true);
    expect(first.felt).toBe(12);
    expect(first.alert).toBe('green');
    // The trap: -9.14 is the longitude and 38.72 the latitude.
    expect(first.coordinates).toEqual({ latitude: 38.72, longitude: -9.14 });
  });

  it('treats felt: -1 and a missing alert as unknown, not as zero', () => {
    const [, second] = mapQuakeFeed(PAYLOAD).quakes;
    expect(second.felt).toBeNull();
    expect(second.alert).toBeNull();
    expect(second.tsunami).toBe(false);
  });

  it('keeps a quake whose geometry is missing, without coordinates or depth', () => {
    const [, , third] = mapQuakeFeed(PAYLOAD).quakes;
    expect(third.place).toBe('Central Mid-Atlantic Ridge');
    expect(third.magnitude).toBe(2.7);
    expect(third.coordinates).toBeNull();
    expect(third.depthKm).toBeNull();
  });

  it('keeps a null magnitude and drops a geometry that is not a point', () => {
    const result = mapQuakeFeed(
      feed([
        feature({ mag: null, id: 'a' }),
        { ...feature({ id: 'b' }), geometry: { type: 'Polygon', coordinates: [[[0, 0]]] } },
        { ...feature({ id: 'c' }), geometry: { type: 'Point', coordinates: ['x', 'y', 1] } },
        { ...feature({ id: 'd' }), geometry: { type: 'Point', coordinates: [181, 91, 1] } },
      ]),
    );

    expect(result.quakes.map((quake) => quake.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(result.quakes[0].magnitude).toBeNull();
    expect(result.quakes[0].coordinates).toEqual({ latitude: 0, longitude: 0 });
    expect(result.quakes[1].coordinates).toBeNull();
    expect(result.quakes[2].coordinates).toBeNull();
    expect(result.quakes[3].coordinates).toBeNull();
  });

  it('synthesises an id when the feature carries none', () => {
    const payload = feed([{ ...feature({ time: 1_759_999_000_000 }), id: undefined }]);
    const [quake] = mapQuakeFeed(payload).quakes;
    expect(quake.id).toBe('1759999000000:0,0');
  });

  it('reads an empty FeatureCollection as nothing recorded', () => {
    const result = mapQuakeFeed({ type: 'FeatureCollection', metadata: { count: 0 }, features: [] });
    expect(result).toEqual({ quakes: [], generatedAt: null, total: 0 });
  });

  it('reports the provider count even when a feature could not be read', () => {
    const result = mapQuakeFeed(feed([feature({ id: 'a' }), { type: 'Feature' }, null]));
    expect(result.quakes).toHaveLength(1);
    expect(result.total).toBe(3);
    // Without a `metadata.count`, the readable features are the best available answer.
    expect(mapQuakeFeed({ type: 'FeatureCollection', features: [feature({ id: 'a' })] }).total).toBe(1);
  });

  it('throws a parse error for a payload that is not a feed at all', () => {
    // USGS serves its "404 File Not Found" text with a 200, so this is the
    // difference between "unavailable" and "the world was quiet".
    for (const junk of ['404 File Not Found', '<html><body>oops</body></html>', null, undefined, 42, [], true]) {
      expect(() => mapQuakeFeed(junk), String(junk)).toThrow(HttpError);
    }
    try {
      mapQuakeFeed('404 File Not Found');
    } catch (error) {
      expect((error as HttpError).code).toBe('parse');
    }
    expect(() => mapQuakeFeed({ type: 'FeatureCollection', features: 'nope' })).toThrow(HttpError);
    expect(mapQuakeFeed({ type: 'FeatureCollection', features: [] }).quakes).toEqual([]);
  });
});

describe('sortQuakes and strongest', () => {
  const quakes = mapQuakeFeed(PAYLOAD).quakes;
  const older = (magnitude: number, time: number, id: string): Quake => ({
    ...quakes[0],
    id,
    magnitude,
    time,
    coordinates: null,
  });

  it('sorts most recent first without mutating the input', () => {
    const input = [older(3, 100, 'a'), older(4, 300, 'b'), older(5, 200, 'c')];
    expect(sortQuakes(input).map((quake) => quake.id)).toEqual(['b', 'c', 'a']);
    expect(input.map((quake) => quake.id)).toEqual(['a', 'b', 'c']);
  });

  it('picks the strongest and breaks ties by recency', () => {
    expect(strongest(quakes)?.id).toBe('us7000abcd');
    expect(strongest([older(4, 100, 'a'), older(4, 500, 'b'), older(3, 900, 'c')])?.id).toBe('b');
    expect(strongest([older(2, 100, 'a'), older(6.1, 50, 'b')])?.id).toBe('b');
  });

  it('ignores unknown magnitudes and an empty list', () => {
    expect(strongest([])).toBeNull();
    expect(strongest([{ ...quakes[0], magnitude: null, id: 'unknown' }])).toBeNull();
  });
});

describe('magnitudeBand', () => {
  it('names every class at its boundaries', () => {
    expect(magnitudeBand(null)).toEqual({ label: 'Unknown', tone: 'slate' });
    expect(magnitudeBand(1.9)).toEqual({ label: 'Micro', tone: 'slate' });
    expect(magnitudeBand(2)).toEqual({ label: 'Minor', tone: 'sky' });
    expect(magnitudeBand(3.9)).toEqual({ label: 'Minor', tone: 'sky' });
    expect(magnitudeBand(4)).toEqual({ label: 'Light', tone: 'amber' });
    expect(magnitudeBand(4.9)).toEqual({ label: 'Light', tone: 'amber' });
    expect(magnitudeBand(5)).toEqual({ label: 'Moderate', tone: 'amber' });
    expect(magnitudeBand(5.9)).toEqual({ label: 'Moderate', tone: 'amber' });
    expect(magnitudeBand(6)).toEqual({ label: 'Strong', tone: 'rose' });
    expect(magnitudeBand(6.9)).toEqual({ label: 'Strong', tone: 'rose' });
    expect(magnitudeBand(7)).toEqual({ label: 'Major', tone: 'rose' });
    expect(magnitudeBand(9.1)).toEqual({ label: 'Major', tone: 'rose' });
  });
});

describe('withDistance and withinRadius', () => {
  const quakes = mapQuakeFeed(PAYLOAD).quakes;

  it('annotates quakes that have coordinates and leaves the rest alone', () => {
    const annotated = withDistance(quakes, LISBON);

    expect(annotated[0].distanceKm).toBeCloseTo(0, 1);
    expect(annotated[1].distanceKm).toBeGreaterThan(1500);
    expect(annotated[2].distanceKm).toBeUndefined();
    expect('distanceKm' in annotated[2]).toBe(false);
  });

  it('does not mutate its input or its quakes', () => {
    const snapshot = JSON.parse(JSON.stringify(quakes)) as Quake[];
    const annotated = withDistance(quakes, LISBON);

    expect(quakes).toEqual(snapshot);
    expect(annotated).not.toBe(quakes);
    expect(annotated[0]).not.toBe(quakes[0]);
    // A quake with nothing to annotate is handed back unchanged.
    expect(annotated[2]).toBe(quakes[2]);
  });

  it('keeps only quakes with a distance inside the radius', () => {
    const annotated = withDistance(quakes, LISBON);

    expect(withinRadius(annotated, 100).map((quake) => quake.id)).toEqual(['us7000abcd']);
    expect(withinRadius(annotated, 5000).map((quake) => quake.id)).toEqual(['us7000abcd', 'us7000abce']);
    // No coordinates means no distance, so it can never be "near".
    expect(withinRadius(annotated, 100_000)).toHaveLength(2);
    expect(withinRadius(quakes, 100)).toEqual([]);
    expect(withinRadius(annotated, Number.NaN)).toEqual([]);
  });
});

describe('fetchQuakes', () => {
  beforeEach(() => {
    resetHttp();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('requests the USGS feed and maps it', async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(jsonResponse(PAYLOAD)));
    vi.stubGlobal('fetch', fetchMock);

    const result = await fetchQuakes('2.5', 'day', new AbortController().signal);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_day.geojson',
    );
    expect(result.fromCache).toBe(false);
    expect(result.data.quakes).toHaveLength(3);
    expect(result.data.generatedAt).toBe(1_760_000_000_000);
  });

  it('shares one payload between two widgets watching the same feed', async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(jsonResponse(PAYLOAD)));
    vi.stubGlobal('fetch', fetchMock);

    const first = await fetchQuakes('all', 'hour', new AbortController().signal);
    const second = await fetchQuakes('all', 'hour', new AbortController().signal);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(first.fromCache).toBe(false);
    expect(second.fromCache).toBe(true);
    expect(QUAKE_TTL_MS).toBe(5 * 60 * 1000);
  });

  it('throws a parse error when the provider answers with its 404 text', async () => {
    // USGS returns this body with a 200 status.
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(new Response('404 File Not Found'))));

    await expect(fetchQuakes('significant', 'day', new AbortController().signal)).rejects.toMatchObject({
      name: 'HttpError',
      code: 'parse',
    });
  });

  it('propagates an abort', async () => {
    const controller = new AbortController();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(() => {
        controller.abort();
        return Promise.reject(new DOMException('aborted', 'AbortError'));
      }),
    );

    await expect(fetchQuakes('2.5', 'day', controller.signal)).rejects.toThrow(/abort/i);
  });
});
