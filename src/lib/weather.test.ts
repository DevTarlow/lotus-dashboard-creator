import { describe, expect, it, vi } from 'vitest';
import {
  conditionFromCode,
  fetchWeather,
  isWeatherSnapshot,
  mapHourlyForecast,
  parseClockHour,
  parseWeatherResponse,
  preferredTemperatureUnit,
  resolvedRegion,
  WeatherError,
  zoneOffsetFromLongitude,
} from '@/lib/weather';

/**
 * A trimmed-down `format=j1` payload with the awkward parts left in. Note that
 * it carries no UTC offset — the real payload has none either.
 */
const PAYLOAD = {
  current_condition: [
    {
      temp_C: '16',
      FeelsLikeC: '15',
      humidity: '59',
      windspeedKmph: '6',
      weatherCode: '122',
      weatherDesc: [{ value: 'Overcast ' }],
      observation_time: '03:30 AM',
    },
  ],
  nearest_area: [
    {
      areaName: [{ value: 'Alcantara' }],
      region: [{ value: 'Lisboa' }],
      country: [{ value: 'Portugal' }],
      latitude: '38.700',
      longitude: '-9.167',
    },
  ],
  weather: [
    {
      date: '2026-06-15',
      maxtempC: '27',
      mintempC: '16',
      astronomy: [{ sunrise: '07:41 AM', sunset: '07:06 PM' }],
      // A full day, as wttr.in sends it: eight slots labelled in minutes.
      hourly: [
        { time: '0', tempC: '14', weatherCode: '113', chanceofrain: '0' },
        { time: '300', tempC: '15', weatherCode: '113', chanceofrain: '0' },
        { time: '600', tempC: '15', weatherCode: '113', chanceofrain: '0' },
        { time: '900', tempC: '21', weatherCode: '116', chanceofrain: '10' },
        { time: '1200', tempC: '24', weatherCode: '176', chanceofrain: '55' },
        { time: '1500', tempC: '26', weatherCode: '200', chanceofrain: '80' },
        { time: '1800', tempC: '25', weatherCode: '113', chanceofrain: '0' },
        { time: '2100', tempC: '24', weatherCode: '116', chanceofrain: '5' },
      ],
    },
  ],
};

/** UTC epoch builder, so expectations never depend on the test machine's zone. */
function utcEpoch(month: number, day: number, hour = 0, minute = 0): number {
  return Date.UTC(2026, month - 1, day, hour, minute, 0, 0);
}

/**
 * 15 June 2026 at 17:00 UTC. The fixture's coordinates (-9.167°) resolve to a
 * whole-hour offset of -60 minutes, so it is 16:00 at the location.
 */
const NOW = utcEpoch(6, 15, 17, 0);

/** The offset the parser derives for the fixture's Lisbon coordinates. */
const LISBON_OFFSET = -60;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('wttr.in condition mapping', () => {
  it('maps the published WorldWeatherOnline code table', () => {
    expect(conditionFromCode(113)).toBe('clear');
    expect(conditionFromCode(116)).toBe('partly-cloudy');
    expect(conditionFromCode(119)).toBe('cloudy');
    expect(conditionFromCode(122)).toBe('cloudy');
    expect(conditionFromCode(143)).toBe('fog');
    expect(conditionFromCode(248)).toBe('fog');
    expect(conditionFromCode(263)).toBe('drizzle');
    expect(conditionFromCode(293)).toBe('rain');
    expect(conditionFromCode(308)).toBe('rain');
    expect(conditionFromCode(182)).toBe('sleet');
    expect(conditionFromCode(317)).toBe('sleet');
    expect(conditionFromCode(323)).toBe('snow');
    expect(conditionFromCode(230)).toBe('snow');
    expect(conditionFromCode(386)).toBe('storm');
    expect(conditionFromCode(395)).toBe('storm');
  });

  it('covers every code the API documents', () => {
    const documented = [
      113, 116, 119, 122, 143, 176, 179, 182, 185, 200, 227, 230, 248, 260, 263, 266, 281, 284, 293, 296,
      299, 302, 305, 308, 311, 314, 317, 320, 323, 326, 329, 332, 335, 338, 350, 353, 356, 359, 362, 365,
      368, 371, 374, 377, 386, 389, 392, 395,
    ];
    for (const code of documented) {
      expect(conditionFromCode(code), `code ${code}`).toBeTruthy();
    }
  });

  it('falls back to the description for an unknown code', () => {
    expect(conditionFromCode(9999, 'Thundery outbreaks in nearby')).toBe('storm');
    expect(conditionFromCode(undefined, 'Light drizzle')).toBe('drizzle');
    expect(conditionFromCode(undefined, 'Patchy light snow')).toBe('snow');
    expect(conditionFromCode(undefined, 'Blowing snow')).toBe('snow');
    expect(conditionFromCode(undefined, 'Freezing fog')).toBe('fog');
    expect(conditionFromCode(undefined, 'Light freezing rain')).toBe('sleet');
    expect(conditionFromCode(undefined, 'Heavy rain')).toBe('rain');
    expect(conditionFromCode(undefined, 'Sunny')).toBe('clear');
    expect(conditionFromCode(undefined)).toBe('cloudy');
  });

  it('parses the 12-hour clock strings the API returns', () => {
    expect(parseClockHour('07:41 AM')).toBeCloseTo(7.68, 2);
    expect(parseClockHour('12:00 PM')).toBe(12);
    expect(parseClockHour('12:30 AM')).toBeCloseTo(0.5, 2);
    expect(parseClockHour('07:06 PM')).toBeCloseTo(19.1, 2);
    expect(parseClockHour('not a time')).toBeUndefined();
    expect(parseClockHour(undefined)).toBeUndefined();
  });

  it('derives a whole-hour offset from longitude', () => {
    // The real coordinates wttr.in reports for these cities.
    expect(zoneOffsetFromLongitude(-9.167)).toBe(-60); // Lisbon
    expect(zoneOffsetFromLongitude(139.218)).toBe(540); // Tokyo, UTC+9
    expect(zoneOffsetFromLongitude(-21.95)).toBe(-60); // Reykjavik (really UTC+0)
    expect(zoneOffsetFromLongitude(0)).toBe(0); // Greenwich
    expect(zoneOffsetFromLongitude(179.9)).toBe(720); // dateline, UTC+12
    expect(zoneOffsetFromLongitude(-179.9)).toBe(-720);
  });
});

describe('wttr.in payload parsing', () => {
  it('produces a snapshot the widget can render', () => {
    const snapshot = parseWeatherResponse(PAYLOAD, 'Lisbon', NOW);

    expect(snapshot.city).toBe('Lisbon');
    expect(snapshot.region).toBe('Lisboa, Portugal');
    expect(snapshot.condition).toBe('cloudy');
    expect(snapshot.summary).toBe('Overcast');
    expect(snapshot.temperatureC).toBe(16);
    expect(snapshot.feelsLikeC).toBe(15);
    expect(snapshot.humidity).toBe(59);
    expect(snapshot.windKph).toBe(6);
    expect(snapshot.highC).toBe(27);
    expect(snapshot.lowC).toBe(16);
    expect(snapshot.sunriseHour).toBeCloseTo(7.68, 2);
    expect(snapshot.sunsetHour).toBeCloseTo(19.1, 2);
    expect(snapshot.simulated).toBe(false);
  });

  it('reports the fetch time and keeps the supplied observation label', () => {
    const snapshot = parseWeatherResponse(PAYLOAD, 'Lisbon', NOW);
    // `observation_time` can trail the data by hours, so it stays a label and
    // never masquerades as the moment the data was received.
    expect(snapshot.updatedAt).toBe(NOW);
    expect(snapshot.observedAt).toBe('03:30 AM');
  });

  it('omits the observation label when the payload has none', () => {
    const bare = parseWeatherResponse({ current_condition: [{ temp_C: '9' }] }, 'Oslo', NOW);
    expect(bare.updatedAt).toBe(NOW);
    expect(bare.observedAt).toBeUndefined();
  });

  it('places each slot using the coordinates, not the viewer clock', () => {
    // At 16:00 local the 15:00 slot has passed, so the outlook opens at 20:00
    // local — proof the location's clock drives the filter.
    const hourly = mapHourlyForecast(PAYLOAD, NOW, 6, LISBON_OFFSET);

    expect(hourly.map((hour) => hour.temperatureC)).toEqual([24, 26, 25, 24]);
    expect(hourly.map((hour) => hour.condition)).toEqual([
      'rain',
      'storm',
      'clear',
      'partly-cloudy',
    ]);
    expect(hourly.map((hour) => hour.precipitationChance)).toEqual([55, 80, 0, 5]);
    // 12:00 location-local on the 15th is 13:00 UTC with a -60 offset.
    expect(new Date(hourly[0].timestamp).toISOString()).toBe('2026-06-15T21:00:00.000Z');
    expect(new Set(hourly.map((hour) => hour.timestamp)).size).toBe(hourly.length);
  });

  it('widens the gap where the forecast rolls into the next day', () => {
    // 06:00 local, so the whole day is still ahead.
    const early = utcEpoch(6, 15, 7, 0);
    const hourly = mapHourlyForecast(PAYLOAD, early, 6, LISBON_OFFSET);

    expect(hourly).toHaveLength(6);
    expect(hourly.map((hour) => hour.temperatureC)).toEqual([15, 21, 24, 26, 25, 24]);
    // 3-hourly, except 21:00 → the next day's 00:00 slot, which is 5.
    for (let index = 1; index < hourly.length; index += 1) {
      const gap = hourly[index].timestamp - hourly[index - 1].timestamp;
      expect(gap === 3 * 3600000 || gap === 5 * 3600000, `gap ${gap}`).toBe(true);
    }
  });

  it('drops slots that have already passed', () => {
    const early = utcEpoch(6, 15, 7, 0);
    expect(mapHourlyForecast(PAYLOAD, early, 6, LISBON_OFFSET)).toHaveLength(6);
    // Later the same day, the earliest slots are gone.
    const trimmed = mapHourlyForecast(PAYLOAD, utcEpoch(6, 15, 20, 0), 6, LISBON_OFFSET);
    expect(trimmed.map((hour) => hour.temperatureC)).toEqual([24, 26, 25, 24]);
    expect(trimmed[0].timestamp).toBeGreaterThan(utcEpoch(6, 15, 20, 0));
  });

  it('caps the outlook at the requested number of slots', () => {
    const early = utcEpoch(6, 15, 7, 0);
    expect(mapHourlyForecast(PAYLOAD, early, 2, LISBON_OFFSET).map((hour) => hour.temperatureC)).toEqual([15, 21]);
  });

  it('survives missing, empty and malformed payloads', () => {
    expect(mapHourlyForecast({}, NOW)).toEqual([]);
    expect(mapHourlyForecast({ weather: [{}] }, NOW)).toEqual([]);
    expect(mapHourlyForecast({ weather: [{ date: 'nonsense', hourly: [{ time: '900' }] }] }, NOW)).toEqual([]);
    expect(resolvedRegion({})).toBeUndefined();
    expect(resolvedRegion({ nearest_area: [] })).toBeUndefined();

    expect(() => parseWeatherResponse({}, 'Lisbon', NOW)).toThrow(WeatherError);
    expect(() => parseWeatherResponse({ current_condition: [] }, 'Lisbon', NOW)).toThrow(WeatherError);

    // A payload with only current conditions still yields a usable snapshot.
    const bare = parseWeatherResponse(
      { current_condition: [{ temp_C: '9', weatherCode: '113' }] },
      'Oslo',
      NOW,
    );
    expect(bare.temperatureC).toBe(9);
    expect(bare.feelsLikeC).toBe(9);
    expect(bare.highC).toBe(9);
    expect(bare.hourly).toEqual([]);
    expect(bare.region).toBeUndefined();
  });

  it('reads region and country only when present', () => {
    expect(resolvedRegion({ nearest_area: [{ region: [{ value: 'Oregon' }] }] })).toBe('Oregon');
    expect(
      resolvedRegion({ nearest_area: [{ region: [{ value: 'Portugal' }], country: [{ value: 'Portugal' }] }] }),
    ).toBe('Portugal');
    expect(resolvedRegion({ nearest_area: [{ latitude: '1' }] })).toBeUndefined();
  });

  it('validates a persisted snapshot', () => {
    expect(isWeatherSnapshot(parseWeatherResponse(PAYLOAD, 'Lisbon', NOW))).toBe(true);
    expect(isWeatherSnapshot({ city: 'Lisbon' })).toBe(false);
    expect(isWeatherSnapshot(null)).toBe(false);
  });
});

describe('fetchWeather', () => {
  it('requests the encoded city and returns a parsed snapshot', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(PAYLOAD));
    const snapshot = await fetchWeather('New York', { fetchImpl: fetchImpl as unknown as typeof fetch, now: NOW });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0][0]).toBe('https://wttr.is/New+York?format=j1');
    expect(snapshot.city).toBe('New York');
    expect(snapshot.temperatureC).toBe(16);
  });

  it('falls back to the secondary host when the first fails', async () => {
    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('network down'))
      .mockResolvedValueOnce(jsonResponse(PAYLOAD));

    const snapshot = await fetchWeather('Lisbon', { fetchImpl: fetchImpl as unknown as typeof fetch, now: NOW });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[0][0]).toContain('https://wttr.is/');
    expect(fetchImpl.mock.calls[1][0]).toContain('https://wttr.in/');
    expect(snapshot.city).toBe('Lisbon');
  });

  it('reports an unknown location without retrying the second host', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('location not found', { status: 500 }));

    await expect(
      fetchWeather('Zzzznotacity', { fetchImpl: fetchImpl as unknown as typeof fetch, now: NOW }),
    ).rejects.toThrow(/No weather found/);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('rejects when a host answers with HTML instead of JSON', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('<html>nope</html>', { status: 200 }));

    await expect(
      fetchWeather('Lisbon', { fetchImpl: fetchImpl as unknown as typeof fetch, now: NOW }),
    ).rejects.toThrow(WeatherError);
  });

  it('rejects an empty city without touching the network', async () => {
    const fetchImpl = vi.fn();

    await expect(
      fetchWeather('   ', { fetchImpl: fetchImpl as unknown as typeof fetch }),
    ).rejects.toThrow(/Enter a city/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('propagates an abort instead of masking it as a failure', async () => {
    const controller = new AbortController();
    const fetchImpl = vi.fn().mockImplementation(() => {
      controller.abort();
      return Promise.reject(new DOMException('aborted', 'AbortError'));
    });

    await expect(
      fetchWeather('Lisbon', {
        signal: controller.signal,
        fetchImpl: fetchImpl as unknown as typeof fetch,
        now: NOW,
      }),
    ).rejects.toThrow(/aborted/i);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe('preferredTemperatureUnit', () => {
  it('reads the region subtag of a locale', () => {
    expect(preferredTemperatureUnit('en-US')).toBe('imperial');
    expect(preferredTemperatureUnit('en-US-POSIX')).toBe('imperial');
    expect(preferredTemperatureUnit('en_GB')).toBe('metric');
    expect(preferredTemperatureUnit('de-DE')).toBe('metric');
    expect(preferredTemperatureUnit('en-LR')).toBe('imperial');
  });

  it('defaults to metric when there is no locale at all', () => {
    // Server rendering and a locked-down browser both hand us nothing.
    expect(preferredTemperatureUnit(undefined)).toBe('metric');
    expect(preferredTemperatureUnit('')).toBe('metric');
    expect(preferredTemperatureUnit('en')).toBe('metric');
  });
});
