import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resetHttp } from '@/lib/http';
import {
  aqiBand,
  fetchAir,
  hourOf,
  isEmptyReading,
  mapAirPayload,
  pollenBand,
  pollenRows,
  pollutantRows,
  uvBand,
} from '@/lib/air';

/** A trimmed but faithful air-quality payload. */
const PAYLOAD = {
  latitude: 38.75,
  longitude: -9.14,
  timezone: 'Europe/Lisbon',
  utc_offset_seconds: 3600,
  current: {
    time: '2026-06-15T14:00',
    interval: 3600,
    us_aqi: 42,
    pm2_5: 8.4,
    pm10: 12.1,
    ozone: 71,
    nitrogen_dioxide: 5.2,
    sulphur_dioxide: 0.8,
    carbon_monoxide: 120,
    uv_index: 7.4,
    grass_pollen: 12.5,
    birch_pollen: 0.4,
    alder_pollen: 0,
    ragweed_pollen: null,
    mugwort_pollen: null,
  },
  hourly: {
    time: Array.from({ length: 24 }, (_, hour) => `2026-06-15T${String(hour).padStart(2, '0')}:00`),
    us_aqi: Array.from({ length: 24 }, (_, hour) => 30 + hour),
    uv_index: Array.from({ length: 24 }, (_, hour) => (hour >= 6 && hour <= 18 ? hour - 6 : null)),
  },
};

beforeEach(() => {
  resetHttp();
});

describe('hourOf', () => {
  it('parses the hour from the provider format', () => {
    expect(hourOf('2026-06-15T00:00')).toBe(0);
    expect(hourOf('2026-06-15T23:00')).toBe(23);
  });

  it('does not throw on rubbish', () => {
    expect(hourOf('')).toBe(0);
    expect(hourOf('nonsense')).toBe(0);
  });
});

describe('mapAirPayload', () => {
  it('maps the current reading, the hours and the day\u2019s UV peak', () => {
    const snapshot = mapAirPayload(PAYLOAD);
    expect(snapshot).not.toBeNull();
    expect(snapshot?.current).toMatchObject({ usAqi: 42, pm2_5: 8.4, uvIndex: 7.4 });
    expect(snapshot?.current.pollen.grass).toBe(12.5);
    expect(snapshot?.current.pollen.ragweed).toBeNull();
    expect(snapshot?.timeZone).toBe('Europe/Lisbon');
  });

  it('starts the hourly strip at the hour the reading belongs to', () => {
    const snapshot = mapAirPayload(PAYLOAD);
    // The provider only forecasts today, so a reading taken at 14:00 leaves
    // ten hours: 14:00 through 23:00.
    expect(snapshot?.hours).toHaveLength(10);
    expect(snapshot?.hours[0].hour).toBe(14);
    expect(snapshot?.hours[9].hour).toBe(23);
    // The day's UV peak (18:00 in this fixture) is reported even though it sits
    // inside the strip, not just the hours ahead.
    expect(snapshot?.uvMaxToday).toBe(12);
  });

  it('starts at the beginning when the reading\u2019s hour is not in the strip', () => {
    const payload = {
      ...PAYLOAD,
      hourly: { ...PAYLOAD.hourly, time: ['2026-06-15T00:00', '2026-06-15T01:00', '2026-06-15T02:00'] },
    };
    const snapshot = mapAirPayload(payload);
    expect(snapshot?.hours).toHaveLength(3);
    expect(snapshot?.hours[0].hour).toBe(0);
  });

  it('refuses a payload without current conditions', () => {
    expect(mapAirPayload({})).toBeNull();
    expect(mapAirPayload({ current: null })).toBeNull();
    expect(mapAirPayload(null)).toBeNull();
    expect(mapAirPayload({ current: { time: 'x' } })?.current.usAqi).toBeNull();
  });

  it('treats missing hourly arrays as empty rather than as an error', () => {
    const snapshot = mapAirPayload({ current: { time: '2026-06-15T09:00', us_aqi: 10 } });
    expect(snapshot?.hours).toEqual([]);
    expect(snapshot?.uvMaxToday).toBeNull();
    expect(snapshot?.timeZone).toBeNull();
  });
});

describe('bands', () => {
  it('bands the AQI on the EPA breakpoints', () => {
    expect(aqiBand(0).id).toBe('good');
    expect(aqiBand(50).id).toBe('good');
    expect(aqiBand(51).id).toBe('moderate');
    expect(aqiBand(100).id).toBe('moderate');
    expect(aqiBand(101).id).toBe('unhealthy-sensitive');
    expect(aqiBand(175).id).toBe('unhealthy');
    expect(aqiBand(250).id).toBe('very-unhealthy');
    expect(aqiBand(400).id).toBe('hazardous');
  });

  it('says so when the AQI is unknown', () => {
    expect(aqiBand(null).id).toBe('unknown');
    expect(aqiBand(Number.NaN).id).toBe('unknown');
    expect(aqiBand(-1).id).toBe('unknown');
    expect(aqiBand(null).advice).not.toBe('');
  });

  it('bands the UV index on the WHO scale', () => {
    expect(uvBand(0).id).toBe('low');
    expect(uvBand(2.9).id).toBe('low');
    expect(uvBand(3).id).toBe('moderate');
    expect(uvBand(6).id).toBe('high');
    expect(uvBand(8).id).toBe('very-high');
    expect(uvBand(11).id).toBe('extreme');
    expect(uvBand(null).id).toBe('unknown');
  });

  it('bands pollen on the provider scale', () => {
    expect(pollenBand(0).id).toBe('none');
    expect(pollenBand(0.5).id).toBe('none');
    expect(pollenBand(5).id).toBe('low');
    expect(pollenBand(20).id).toBe('moderate');
    expect(pollenBand(80).id).toBe('high');
    expect(pollenBand(120).id).toBe('very-high');
    expect(pollenBand(null).id).toBe('unknown');
  });
});

describe('rows', () => {
  it('lists only the pollen that has a reading, strongest first', () => {
    const snapshot = mapAirPayload(PAYLOAD);
    const rows = pollenRows(snapshot!.current.pollen);
    expect(rows.map((row) => row.id)).toEqual(['grass', 'birch', 'alder']);
    expect(rows[0].value).toBe(12.5);
  });

  it('keeps the pollutant order and its units', () => {
    const rows = pollutantRows(mapAirPayload(PAYLOAD)!.current);
    expect(rows.map((row) => row.id)).toEqual(['pm2_5', 'pm10', 'ozone', 'no2', 'so2', 'co']);
    expect(rows[0].unit).toBe('µg/m³');
    expect(rows[0].value).toBe(8.4);
  });

  it('recognises a reading with nothing in it', () => {
    expect(isEmptyReading(mapAirPayload({ current: { time: 'x' } })!.current)).toBe(true);
    expect(isEmptyReading(mapAirPayload(PAYLOAD)!.current)).toBe(false);
  });
});

describe('fetchAir', () => {
  const place = {
    name: 'Lisbon',
    country: 'Portugal',
    admin1: null,
    latitude: 38.7251,
    longitude: -9.1498,
    timeZone: 'Europe/Lisbon',
    population: null,
  };

  it('asks for the documented fields and caches the answer', async () => {
    const mock = vi.fn().mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify(PAYLOAD), { status: 200, headers: { 'content-type': 'application/json' } })),
    );
    vi.stubGlobal('fetch', mock);
    const signal = new AbortController().signal;

    const first = await fetchAir(place, signal);
    const second = await fetchAir(place, signal);

    const url = String(mock.mock.calls[0][0]);
    expect(url).toContain('latitude=38.7251');
    expect(url).toContain('longitude=-9.1498');
    expect(url).toContain('us_aqi');
    expect(url).toContain('timezone=auto');
    expect(first.data?.current.usAqi).toBe(42);
    expect(first.fromCache).toBe(false);
    expect(second.fromCache).toBe(true);
    expect(mock).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });

  it('surfaces a transport failure', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await expect(fetchAir(place, new AbortController().signal)).rejects.toMatchObject({ code: 'network' });
    vi.unstubAllGlobals();
  });
});
