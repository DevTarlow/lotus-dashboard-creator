import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CURRENCIES_KEY,
  CURRENCY_LIST_TTL_MS,
  CURRENCY_REFRESH_MS,
  FRANKFURTER_BASE,
  SERIES_DAYS,
  convertCurrency,
  currencyFallbackOptions,
  currencyOptions,
  fetchCurrencies,
  fetchLatest,
  fetchSeries,
  formatMoney,
  isSupportedCurrency,
  latestKey,
  normalizeCurrencyPair,
  parseCurrencies,
  parseLatestRates,
  parseSeries,
  seriesKey,
} from '@/lib/currency';
import { isCached, resetHttp } from '@/lib/http';
import { addDays, dayKey } from '@/lib/time';

/**
 * Fixtures in the provider's own shape. The ECB publishes on working days only,
 * so a real range payload simply has no key for a Saturday or a holiday.
 */
const CURRENCIES = { EUR: 'Euro', GBP: 'British Pound', USD: 'United States Dollar', JPY: 'Japanese Yen' };

const RATES: Record<string, number> = { EUR: 0.89, GBP: 0.79, JPY: 148.2 };

const LATEST = { amount: 1, base: 'USD', date: '2026-10-09', rates: { EUR: 0.89, GBP: 0.79 } };

const RANGE = {
  amount: 1,
  base: 'USD',
  start_date: '2026-09-09',
  end_date: '2026-10-09',
  rates: {
    // Deliberately out of order, with a gap (a day the provider did not publish)
    // and one entry that could not be a rate.
    '2026-10-09': { EUR: 0.89 },
    '2026-10-07': { EUR: 0.88 },
    '2026-10-06': { EUR: 0.87 },
    '2026-10-03': { EUR: 'nonsense' },
    '2026-10-02': { EUR: 0.86 },
  },
};

/** Build a real `Response`, so the http layer is exercised rather than imitated. */
function jsonResponse(body: unknown, status = 200): Response {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function respondWith(body: unknown, status = 200) {
  return vi.fn().mockImplementation(() => Promise.resolve(jsonResponse(body, status)));
}

/** Answers a `/latest` call from the symbols it was asked for, like the provider. */
function latestMock() {
  return vi.fn().mockImplementation((input: string) => {
    const url = new URL(input);
    const symbols = (url.searchParams.get('symbols') ?? '').split(',').filter((code) => code !== '');
    const rates = Object.fromEntries(symbols.map((code) => [code, RATES[code] ?? 0.5]));
    return Promise.resolve(
      jsonResponse({ amount: 1, base: url.searchParams.get('base'), date: '2026-10-09', rates }),
    );
  });
}

function urlsOf(mock: { mock: { calls: unknown[][] } }): string[] {
  return mock.mock.calls.map((call) => String(call[0]));
}

/** The abort signal a widget's `useResource` loader would hand in. */
const signal = new AbortController().signal;

beforeEach(() => {
  resetHttp();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  resetHttp();
});

describe('currency list', () => {
  it('requests /currencies once and maps code → name', async () => {
    const mock = respondWith(CURRENCIES);
    vi.stubGlobal('fetch', mock);

    const names = await fetchCurrencies(signal);

    expect(urlsOf(mock)).toEqual([`${FRANKFURTER_BASE}/currencies`]);
    expect(names).toEqual(CURRENCIES);
    expect(names.EUR).toBe('Euro');
  });

  it('reuses the cached list for a day', async () => {
    const mock = respondWith(CURRENCIES);
    vi.stubGlobal('fetch', mock);

    await fetchCurrencies(signal);
    expect(isCached(CURRENCIES_KEY, CURRENCY_LIST_TTL_MS)).toBe(true);

    const again = await fetchCurrencies(signal);
    expect(again).toEqual(CURRENCIES);
    expect(mock).toHaveBeenCalledTimes(1);
  });

  it('rejects a payload that is not a map of names', async () => {
    for (const payload of [null, [], {}, 'EUR', { EUR: 1 }]) {
      resetHttp();
      vi.stubGlobal('fetch', respondWith(payload));
      await expect(fetchCurrencies(signal), JSON.stringify(payload)).rejects.toMatchObject({
        name: 'HttpError',
        code: 'parse',
      });
    }
  });

  it('parses a hand-built payload directly', () => {
    expect(parseCurrencies({ eur: 'Euro' })).toEqual({ EUR: 'Euro' });
    expect(() => parseCurrencies(null)).toThrow(/currency list/);
    expect(() => parseCurrencies({})).toThrow(/empty currency list/);
  });
});

describe('latest rates', () => {
  it('requests only the quotes it was asked for', async () => {
    const mock = latestMock();
    vi.stubGlobal('fetch', mock);

    const rates = await fetchLatest('USD', ['EUR', 'GBP'], signal);

    expect(urlsOf(mock)).toEqual([`${FRANKFURTER_BASE}/latest?base=USD&symbols=EUR,GBP`]);
    expect(rates).toEqual({ base: 'USD', date: '2026-10-09', rates: { EUR: 0.89, GBP: 0.79 } });
  });

  it('de-duplicates and sorts the symbol list so the request is stable', async () => {
    const mock = latestMock();
    vi.stubGlobal('fetch', mock);

    await fetchLatest('usd', ['gbp', 'EUR', 'GBP'], signal);

    expect(urlsOf(mock)).toEqual([`${FRANKFURTER_BASE}/latest?base=USD&symbols=EUR,GBP`]);
  });

  it('answers base === quote with a rate of 1 and no request at all', async () => {
    const mock = latestMock();
    vi.stubGlobal('fetch', mock);

    const rates = await fetchLatest('eur', ['EUR'], signal);

    expect(mock).not.toHaveBeenCalled();
    expect(rates.base).toBe('EUR');
    expect(rates.date).toBe(dayKey(new Date()));
    expect(rates.rates).toEqual({ EUR: 1 });
  });

  it('mixes the identity rate into a request for other quotes', async () => {
    const mock = latestMock();
    vi.stubGlobal('fetch', mock);

    const rates = await fetchLatest('USD', ['USD', 'EUR'], signal);

    expect(urlsOf(mock)).toEqual([`${FRANKFURTER_BASE}/latest?base=USD&symbols=EUR`]);
    expect(rates.rates).toEqual({ USD: 1, EUR: 0.89 });
  });

  it('makes no request when there is nothing to ask for', async () => {
    const mock = latestMock();
    vi.stubGlobal('fetch', mock);

    const rates = await fetchLatest('USD', [], signal);

    expect(mock).not.toHaveBeenCalled();
    expect(rates).toEqual({ base: 'USD', date: dayKey(new Date()), rates: {} });
  });

  it('keys the cache by base and symbol set, so two panels never share a payload', async () => {
    const mock = latestMock();
    vi.stubGlobal('fetch', mock);

    const eur = await fetchLatest('USD', ['EUR'], signal);
    // A cached payload for the same base would not contain GBP: the second call
    // must go to the network rather than be handed the first answer.
    expect(isCached(latestKey('USD', ['EUR']), CURRENCY_REFRESH_MS)).toBe(true);
    expect(isCached(latestKey('USD', ['GBP']), CURRENCY_REFRESH_MS)).toBe(false);

    const gbp = await fetchLatest('USD', ['GBP'], signal);

    expect(mock).toHaveBeenCalledTimes(2);
    expect(eur.rates).toEqual({ EUR: 0.89 });
    expect(gbp.rates).toEqual({ GBP: 0.79 });
  });

  it('reuses one request for a repeated pair', async () => {
    const mock = latestMock();
    vi.stubGlobal('fetch', mock);

    await fetchLatest('USD', ['EUR'], signal);
    const second = await fetchLatest('USD', ['EUR'], signal);

    expect(mock).toHaveBeenCalledTimes(1);
    expect(second.rates).toEqual({ EUR: 0.89 });
  });

  it('surfaces the provider’s refusal of an unknown symbol instead of inventing a rate', async () => {
    const mock = vi.fn().mockImplementation(() => Promise.resolve(jsonResponse({ message: 'not found' }, 404)));
    vi.stubGlobal('fetch', mock);

    await expect(fetchLatest('USD', ['ZZZ'], signal)).rejects.toMatchObject({
      name: 'HttpError',
      code: 'http',
      status: 404,
    });
    expect(urlsOf(mock)).toEqual([`${FRANKFURTER_BASE}/latest?base=USD&symbols=ZZZ`]);
  });

  it('rejects a payload that does not carry the requested rate', async () => {
    vi.stubGlobal('fetch', respondWith({ amount: 1, base: 'USD', date: '2026-10-09', rates: { GBP: 0.79 } }));

    await expect(fetchLatest('USD', ['EUR'], signal)).rejects.toMatchObject({ code: 'parse' });
  });

  it('rejects a payload that answers for another base', async () => {
    vi.stubGlobal('fetch', respondWith({ amount: 1, base: 'GBP', date: '2026-10-09', rates: { EUR: 0.89 } }));

    await expect(fetchLatest('USD', ['EUR'], signal)).rejects.toMatchObject({ code: 'parse' });
  });

  it('rejects malformed payloads', async () => {
    const payloads = [
      null,
      [],
      { base: 'USD', date: '2026-10-09' },
      { base: 'USD', date: 'not-a-date', rates: { EUR: 0.89 } },
      { base: 'USD', date: '2026-10-09', rates: 'EUR' },
      { base: 'USD', date: '2026-10-09', rates: { EUR: '0.89' } },
    ];
    for (const payload of payloads) {
      resetHttp();
      vi.stubGlobal('fetch', respondWith(payload));
      await expect(fetchLatest('USD', ['EUR'], signal), JSON.stringify(payload)).rejects.toMatchObject({
        code: 'parse',
      });
    }
  });

  it('parses a hand-built payload directly', () => {
    expect(parseLatestRates(LATEST)).toEqual({ base: 'USD', date: '2026-10-09', rates: { EUR: 0.89, GBP: 0.79 } });
    expect(() => parseLatestRates({ base: 'USD', date: '2026-10-09', rates: {} })).toThrow(/no usable rates/);
  });
});

describe('rate history', () => {
  it('flattens the day map into an ascending series', async () => {
    const mock = respondWith(RANGE);
    vi.stubGlobal('fetch', mock);

    const series = await fetchSeries('USD', 'EUR', SERIES_DAYS, signal);

    const start = dayKey(addDays(new Date(), -SERIES_DAYS));
    expect(urlsOf(mock)).toEqual([`${FRANKFURTER_BASE}/${start}..?base=USD&symbols=EUR`]);
    expect(series.base).toBe('USD');
    expect(series.quote).toBe('EUR');
    expect(series.points.map((point) => point.date)).toEqual([
      '2026-10-02',
      '2026-10-06',
      '2026-10-07',
      '2026-10-09',
    ]);
    expect(series.points.map((point) => point.rate)).toEqual([0.86, 0.87, 0.88, 0.89]);
  });

  it('asks for a history at most once a day', async () => {
    const mock = respondWith(RANGE);
    vi.stubGlobal('fetch', mock);

    await fetchSeries('USD', 'EUR', SERIES_DAYS, signal);
    await fetchSeries('USD', 'EUR', SERIES_DAYS, signal);

    expect(mock).toHaveBeenCalledTimes(1);
    expect(isCached(seriesKey('USD', 'EUR', SERIES_DAYS), CURRENCY_LIST_TTL_MS)).toBe(true);
  });

  it('returns an empty series for base === quote without a request', async () => {
    const mock = respondWith(RANGE);
    vi.stubGlobal('fetch', mock);

    const series = await fetchSeries('USD', 'usd', SERIES_DAYS, signal);

    expect(mock).not.toHaveBeenCalled();
    expect(series).toEqual({ base: 'USD', quote: 'USD', points: [] });
  });

  it('rejects a range with no usable point for the quote', async () => {
    const payloads = [
      {},
      { base: 'USD', rates: {} },
      { base: 'USD', rates: { '2026-10-09': { GBP: 0.79 } } },
      { base: 'USD', rates: { 'not-a-date': { EUR: 0.89 } } },
    ];
    for (const payload of payloads) {
      resetHttp();
      vi.stubGlobal('fetch', respondWith(payload));
      await expect(fetchSeries('USD', 'EUR', SERIES_DAYS, signal), JSON.stringify(payload)).rejects.toMatchObject({
        code: 'parse',
      });
    }
  });

  it('parses and sorts a hand-built payload directly', () => {
    const series = parseSeries(
      { base: 'usd', rates: { '2026-10-09': { EUR: 0.89 }, '2026-10-01': { EUR: 0.85 } } },
      'eur',
    );
    expect(series).toEqual({
      base: 'USD',
      quote: 'EUR',
      points: [
        { date: '2026-10-01', rate: 0.85 },
        { date: '2026-10-09', rate: 0.89 },
      ],
    });
  });
});

describe('convertCurrency', () => {
  it('multiplies the amount by the published rate', () => {
    expect(convertCurrency(100, 0.89)).toBeCloseTo(89, 10);
    expect(convertCurrency(1, 1)).toBe(1);
    expect(convertCurrency(0, 0.89)).toBe(0);
    expect(convertCurrency(-5, 2)).toBe(-10);
  });

  it('keeps a missing rate distinguishable from zero', () => {
    expect(convertCurrency(10, Number.NaN)).toBeNaN();
    expect(convertCurrency(Number.NaN, 0.89)).toBeNaN();
    expect(convertCurrency(10, Number.POSITIVE_INFINITY)).toBeNaN();
  });
});

describe('formatMoney', () => {
  it('labels the amount with its ISO code', () => {
    // The code rather than a symbol: `$` is USD, CAD and AUD alike.
    expect(formatMoney(1234.5, 'USD')).toBe('USD 1,234.50');
    expect(formatMoney(0.89, 'EUR')).toBe('EUR 0.8900');
    expect(formatMoney(12, 'usd')).toBe('USD 12.00');
    expect(formatMoney(0, 'GBP')).toBe('GBP 0.00');
  });

  it('shows an unknown-but-well-formed code as itself', () => {
    expect(formatMoney(12, 'ZZZ')).toBe('ZZZ 12.00');
  });

  it('falls back to a plain number for a code Intl rejects', () => {
    expect(formatMoney(1234.5, '')).toBe('1,234.5');
    expect(formatMoney(1234.5, 'US')).toBe('1,234.5');
    expect(formatMoney(1234.5, 'nope!')).toBe('1,234.5');
  });

  it('never renders NaN', () => {
    expect(formatMoney(Number.NaN, 'USD')).toBe('USD 0.00');
  });
});

describe('supported currencies', () => {
  const SUPPORTED = ['AUD', 'EUR', 'GBP', 'USD'];

  it('matches a stored code case-insensitively', () => {
    expect(isSupportedCurrency('eur', SUPPORTED)).toBe(true);
    expect(isSupportedCurrency(' EUR ', SUPPORTED)).toBe(true);
    expect(isSupportedCurrency('ZZZ', SUPPORTED)).toBe(false);
    expect(isSupportedCurrency('', SUPPORTED)).toBe(false);
  });

  it('keeps a pair the list supports', () => {
    expect(normalizeCurrencyPair('gbp', 'usd', SUPPORTED)).toEqual({ base: 'GBP', quote: 'USD' });
    // A pair of the same currency is valid, and converts at exactly 1.
    expect(normalizeCurrencyPair('usd', 'usd', SUPPORTED)).toEqual({ base: 'USD', quote: 'USD' });
  });

  it('falls back when a stored code is not in the supported list', () => {
    expect(normalizeCurrencyPair('ZZZ', 'GBP', SUPPORTED)).toEqual({ base: 'USD', quote: 'GBP' });
    expect(normalizeCurrencyPair('GBP', 'ZZZ', SUPPORTED)).toEqual({ base: 'GBP', quote: 'EUR' });
    expect(normalizeCurrencyPair('', '', SUPPORTED)).toEqual({ base: 'USD', quote: 'EUR' });
  });

  it('uses the first published code when even the defaults are unsupported', () => {
    expect(normalizeCurrencyPair('ZZZ', 'QQQ', ['SEK', 'NOK'])).toEqual({ base: 'SEK', quote: 'SEK' });
  });

  it('leaves the stored pair alone while the list is unavailable', () => {
    // No list means no authority to correct against: an empty picker that still
    // shows the stored codes beats silently rewriting the user's pair.
    expect(normalizeCurrencyPair('gbp', 'jpy', [])).toEqual({ base: 'GBP', quote: 'JPY' });
    expect(normalizeCurrencyPair('', '', [])).toEqual({ base: 'USD', quote: 'EUR' });
  });
});

describe('picker options', () => {
  it('sorts by currency name and keeps the code readable', () => {
    expect(currencyOptions(CURRENCIES)).toEqual([
      { value: 'GBP', label: 'GBP · British Pound' },
      { value: 'EUR', label: 'EUR · Euro' },
      { value: 'JPY', label: 'JPY · Japanese Yen' },
      { value: 'USD', label: 'USD · United States Dollar' },
    ]);
  });

  it('offers the stored codes as a fallback list', () => {
    expect(currencyFallbackOptions(['usd', 'EUR', 'USD', ''])).toEqual([
      { value: 'USD', label: 'USD' },
      { value: 'EUR', label: 'EUR' },
    ]);
    expect(currencyFallbackOptions([])).toEqual([]);
  });
});
