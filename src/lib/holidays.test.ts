import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HttpError, resetHttp } from '@/lib/http';
import {
  HOLIDAY_COUNTRIES,
  fetchHolidays,
  holidayCacheKey,
  holidayCountryName,
  holidaysByDate,
  mapHolidays,
  nextHoliday,
  normalizeCountryCode,
  type Holiday,
} from '@/lib/holidays';

/**
 * A trimmed but faithful `PublicHolidays/2026/PT` payload, including a
 * regional holiday (`global: false`) and the `localName`/`name` pair.
 */
const PAYLOAD = [
  {
    date: '2026-01-01',
    localName: 'Ano Novo',
    name: "New Year's Day",
    countryCode: 'PT',
    fixed: false,
    global: true,
    counties: null,
    launchYear: null,
    types: ['Public'],
  },
  {
    date: '2026-02-17',
    localName: 'Carnaval',
    name: 'Carnival',
    countryCode: 'PT',
    fixed: false,
    global: true,
    counties: null,
    launchYear: null,
    types: ['Optional'],
  },
  {
    date: '2026-06-01',
    localName: 'Dia dos Açores',
    name: 'Azores Day',
    countryCode: 'PT',
    fixed: false,
    global: false,
    counties: ['PT-20'],
    launchYear: null,
    types: ['Public'],
  },
  {
    date: '2026-12-25',
    localName: 'Natal',
    name: 'Christmas Day',
    countryCode: 'PT',
    fixed: false,
    global: true,
    counties: null,
    launchYear: null,
    types: ['Public'],
  },
];

const holiday = (date: string, name: string, localName = name, global = true): Holiday => ({
  date,
  name,
  localName,
  global,
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/** Stub `fetch` with one canned answer and hand the mock back for assertions. */
function stubFetch(response: Response): ReturnType<typeof vi.fn> {
  const mock = vi.fn().mockResolvedValue(response);
  vi.stubGlobal('fetch', mock);
  return mock;
}

beforeEach(() => {
  resetHttp();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('HOLIDAY_COUNTRIES', () => {
  it('is a curated, sorted list of ISO-2 codes', () => {
    expect(HOLIDAY_COUNTRIES.length).toBeGreaterThanOrEqual(15);
    expect(new Set(HOLIDAY_COUNTRIES.map((entry) => entry.code)).size).toBe(HOLIDAY_COUNTRIES.length);
    for (const entry of HOLIDAY_COUNTRIES) {
      expect(entry.code).toMatch(/^[A-Z]{2}$/);
      expect(entry.name).not.toBe('');
    }
    // The menu reads better in alphabetical order, which is the order it ships in.
    const names = HOLIDAY_COUNTRIES.map((entry) => entry.name);
    expect([...names].sort((a, b) => a.localeCompare(b, 'en'))).toEqual(names);
    expect(names).toContain('Portugal');
    expect(names).toContain('United States');
  });
});

describe('normalizeCountryCode', () => {
  it('accepts a two-letter code whatever its case or padding', () => {
    expect(normalizeCountryCode('pt')).toBe('PT');
    expect(normalizeCountryCode(' us ')).toBe('US');
  });

  it('rejects everything that is not one', () => {
    expect(normalizeCountryCode(null)).toBeNull();
    expect(normalizeCountryCode('')).toBeNull();
    expect(normalizeCountryCode('   ')).toBeNull();
    expect(normalizeCountryCode('PRT')).toBeNull();
    expect(normalizeCountryCode('P1')).toBeNull();
    expect(normalizeCountryCode(42)).toBeNull();
    expect(normalizeCountryCode({ code: 'PT' })).toBeNull();
  });
});

describe('holidayCountryName', () => {
  it('names the countries the picker offers', () => {
    expect(holidayCountryName('PT')).toBe('Portugal');
    expect(holidayCountryName('pt')).toBe('Portugal');
    expect(holidayCountryName('US')).toBe('United States');
  });

  it('answers nothing when holidays are off', () => {
    expect(holidayCountryName(null)).toBe('');
    expect(holidayCountryName('')).toBe('');
    expect(holidayCountryName('junk')).toBe('');
  });

  it('falls back to the code for a country it does not list', () => {
    // Well-formed but unknown: the request still goes out and the widget can say
    // which country it could not read.
    expect(holidayCountryName('XX')).toBe('XX');
  });
});

describe('mapHolidays', () => {
  it('maps the provider payload', () => {
    expect(mapHolidays(PAYLOAD)).toEqual([
      holiday('2026-01-01', "New Year's Day", 'Ano Novo'),
      holiday('2026-02-17', 'Carnival', 'Carnaval'),
      holiday('2026-06-01', 'Azores Day', 'Dia dos Açores', false),
      holiday('2026-12-25', 'Christmas Day', 'Natal'),
    ]);
  });

  it('keeps the local name as a fallback when there is no English one', () => {
    expect(mapHolidays([{ date: '2026-01-01', localName: 'Ano Novo' }])).toEqual([
      holiday('2026-01-01', 'Ano Novo', 'Ano Novo'),
    ]);
  });

  it('drops an odd row but keeps the rest of the year', () => {
    const mapped = mapHolidays([
      PAYLOAD[0],
      null,
      { date: '2026-02-30', name: 'Not a real day' },
      { date: '2026-03-01' },
      PAYLOAD[1],
    ]);

    expect(mapped?.map((entry) => entry.name)).toEqual(["New Year's Day", 'Carnival']);
  });

  it('refuses a payload that is not a holiday list', () => {
    expect(mapHolidays({ holidays: PAYLOAD })).toBeNull();
    expect(mapHolidays('nope')).toBeNull();
    expect(mapHolidays(null)).toBeNull();
    // A non-empty array in which nothing could be read is not "no holidays".
    expect(mapHolidays([{}])).toBeNull();
    expect(mapHolidays([{ date: '2026-02-30', name: 'X' }])).toBeNull();
  });

  it('treats an empty list as a year without holidays', () => {
    expect(mapHolidays([])).toEqual([]);
  });
});

describe('fetchHolidays', () => {
  it('requests the country and the year, and maps the answer', async () => {
    const mock = stubFetch(jsonResponse(PAYLOAD));

    const holidays = await fetchHolidays('pt', 2026, new AbortController().signal);

    expect(mock).toHaveBeenCalledTimes(1);
    expect(mock.mock.calls[0][0]).toBe('https://date.nager.at/api/v3/PublicHolidays/2026/PT');
    expect(holidays).toHaveLength(4);
    expect(holidays[2]).toEqual(holiday('2026-06-01', 'Azores Day', 'Dia dos Açores', false));
    expect(holidays[2].global).toBe(false);
    expect(holidays[0].global).toBe(true);
  });

  it('shares one request between callers in the same window', async () => {
    const mock = stubFetch(jsonResponse(PAYLOAD));
    const signal = new AbortController().signal;

    const first = await fetchHolidays('PT', 2026, signal);
    const second = await fetchHolidays('PT', 2026, signal);

    expect(mock).toHaveBeenCalledTimes(1);
    expect(second).toEqual(first);
    expect(holidayCacheKey('PT', 2026)).toBe('nager:holidays:PT:2026');
  });

  it('treats a year without holidays as data, not as a failure', async () => {
    stubFetch(jsonResponse([]));
    await expect(fetchHolidays('PT', 2026, new AbortController().signal)).resolves.toEqual([]);
  });

  it('rejects a payload that is not a list of holidays', async () => {
    for (const body of [{ message: 'weird' }, 'nope', [{}], [{ date: '2026-02-30', name: 'X' }]]) {
      resetHttp();
      stubFetch(jsonResponse(body));
      await expect(fetchHolidays('PT', 2026, new AbortController().signal)).rejects.toMatchObject({
        code: 'parse',
      });
    }
  });

  it('reports a country the provider does not know as an HTTP failure', async () => {
    const mock = stubFetch(jsonResponse({ message: 'Country code not found' }, 404));

    const failure = await fetchHolidays('XX', 2026, new AbortController().signal).catch(
      (error: unknown) => error,
    );

    expect(failure).toBeInstanceOf(HttpError);
    expect(failure).toMatchObject({ code: 'http', status: 404 });
    expect(mock).toHaveBeenCalledTimes(1);
    expect(mock.mock.calls[0][0]).toContain('/PublicHolidays/2026/XX');
  });

  it('refuses a country code that is not one, without asking the network', async () => {
    const mock = stubFetch(jsonResponse(PAYLOAD));

    await expect(fetchHolidays('nope', 2026, new AbortController().signal)).rejects.toMatchObject({
      code: 'parse',
    });
    expect(mock).not.toHaveBeenCalled();
  });

  it('propagates an abort instead of masking it as a failure', async () => {
    const mock = stubFetch(jsonResponse(PAYLOAD));
    const controller = new AbortController();
    controller.abort();

    await expect(fetchHolidays('PT', 2026, controller.signal)).rejects.toMatchObject({ code: 'aborted' });
    expect(mock).not.toHaveBeenCalled();
  });
});

describe('holidaysByDate', () => {
  it('groups holidays under their own day, in order', () => {
    const byDate = holidaysByDate([
      holiday('2026-01-01', "New Year's Day", 'Ano Novo'),
      holiday('2026-06-01', 'Azores Day', 'Dia dos Açores', false),
      holiday('2026-01-01', 'Family Day'),
    ]);

    expect([...byDate.keys()]).toEqual(['2026-01-01', '2026-06-01']);
    expect(byDate.get('2026-01-01')?.map((entry) => entry.name)).toEqual(["New Year's Day", 'Family Day']);
    expect(byDate.get('2026-06-01')?.[0].global).toBe(false);
    expect(byDate.get('2026-02-17')).toBeUndefined();
  });

  it('answers an empty map for no holidays', () => {
    expect(holidaysByDate([]).size).toBe(0);
  });
});

describe('nextHoliday', () => {
  const year = [
    holiday('2026-02-17', 'Carnival', 'Carnaval'),
    holiday('2026-06-01', 'Azores Day', 'Dia dos Açores', false),
    holiday('2026-12-25', 'Christmas Day', 'Natal'),
  ];

  it('finds the soonest one still ahead', () => {
    expect(nextHoliday(year, '2026-03-01')?.name).toBe('Azores Day');
    expect(nextHoliday(year, '2026-01-01')?.name).toBe('Carnival');
  });

  it('counts a holiday that is today', () => {
    expect(nextHoliday(year, '2026-06-01')?.name).toBe('Azores Day');
    expect(nextHoliday(year, '2026-12-25')?.name).toBe('Christmas Day');
  });

  it('answers nothing once the last one has passed', () => {
    expect(nextHoliday(year, '2026-12-26')).toBeNull();
    expect(nextHoliday(year, '2030-01-01')).toBeNull();
  });

  it('answers nothing for an empty list', () => {
    expect(nextHoliday([], '2026-06-01')).toBeNull();
  });

  it('does not depend on the provider’s order', () => {
    const shuffled = [year[2], year[0], year[1]];
    expect(nextHoliday(shuffled, '2026-01-01')?.name).toBe('Carnival');
    expect(nextHoliday(shuffled, '2026-06-02')?.name).toBe('Christmas Day');
  });

  it('answers nothing for a date it cannot read, and skips rows it cannot read', () => {
    expect(nextHoliday(year, 'whenever')).toBeNull();
    expect(nextHoliday([holiday('not-a-date', 'Nonsense'), year[2]], '2026-01-01')?.name).toBe('Christmas Day');
  });
});
