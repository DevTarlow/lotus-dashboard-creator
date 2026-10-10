import { describe, expect, it, vi } from 'vitest';
import {
  COIN_IDS,
  coinIdFor,
  fetchCryptoQuotes,
  fetchStockQuotes,
  isLiveSymbol,
  kindFor,
  MarketError,
  parseCoinMarket,
  parseStockQuote,
  resampleSpark,
} from '@/lib/market';
import { getQuote } from '@/lib/mock/market';

/** A trimmed `/coins/markets` entry with the awkward parts left in. */
const ENTRY = {
  id: 'bitcoin',
  symbol: 'btc',
  name: 'Bitcoin',
  current_price: 82587,
  high_24h: 83398,
  low_24h: 82180,
  price_change_percentage_24h: 0.25,
  sparkline_in_7d: { price: Array.from({ length: 168 }, (_, index) => 80000 + index * 10) },
};

const NOW = Date.UTC(2026, 9, 10, 12, 0, 0);

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('market symbol resolution', () => {
  it('maps known crypto symbols to curated CoinGecko ids', () => {
    expect(coinIdFor('BTC')).toBe('bitcoin');
    expect(coinIdFor(' btc ')).toBe('bitcoin');
    expect(coinIdFor('ETH')).toBe('ethereum');
    expect(coinIdFor('SOL')).toBe('solana');
  });

  it('refuses to guess at unknown or stock symbols', () => {
    // The whole point of the curated map: a symbol that is not in it is never
    // looked up, because symbol search can resolve to a different token.
    expect(coinIdFor('AAPL')).toBeUndefined();
    expect(coinIdFor('NVDA')).toBeUndefined();
    expect(coinIdFor('ZZZZ')).toBeUndefined();
    expect(coinIdFor('')).toBeUndefined();
    expect(isLiveSymbol('BTC')).toBe(true);
    expect(isLiveSymbol('AAPL')).toBe(false);
  });

  it('keeps every curated id unique', () => {
    const ids = Object.values(COIN_IDS);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('CoinGecko payload parsing', () => {
  it('produces a quote the widget can render', () => {
    const quote = parseCoinMarket(ENTRY, NOW);

    expect(quote.symbol).toBe('BTC');
    expect(quote.name).toBe('Bitcoin');
    expect(quote.kind).toBe('crypto');
    expect(quote.currency).toBe('USD');
    expect(quote.price).toBe(82587);
    expect(quote.high).toBe(83398);
    expect(quote.low).toBe(82180);
    expect(quote.changePercent).toBe(0.25);
    expect(quote.changeWindow).toBe('24h');
    expect(quote.source).toBe('live');
    expect(quote.updatedAt).toBe(NOW);
    expect(quote.spark).toHaveLength(28);
  });

  it('derives an absolute change coherent with the percentage', () => {
    const quote = parseCoinMarket(ENTRY, NOW);
    // `price - changeAbs` should reproduce the 24h reference price.
    expect(quote.price - quote.changeAbs).toBeCloseTo(quote.price / (1 + quote.changePercent / 100), 6);
  });

  it('downsamples the 7-day sparkline and anchors it to the present', () => {
    const spark = resampleSpark(Array.from({ length: 168 }, (_, index) => index), 28);
    expect(spark).toHaveLength(28);
    // End-anchored: the final sample is the newest point, so a sparkline drawn
    // from this lands on the live price rather than a value from days ago.
    expect(spark[27]).toBe(167);
    // The window still reaches back towards the start, just not to index 0.
    expect(spark[0]).toBeLessThan(20);
    // Uniform strides, oldest first.
    expect([...spark].sort((a, b) => a - b)).toEqual(spark);
    // Short arrays are passed through untouched.
    expect(resampleSpark([1, 2, 3], 28)).toEqual([1, 2, 3]);
    expect(resampleSpark(undefined)).toEqual([]);
    expect(resampleSpark(['x', null, 5])).toEqual([5]);
  });

  it('survives missing and malformed entries', () => {
    expect(() => parseCoinMarket({}, NOW)).toThrow(MarketError);
    expect(() => parseCoinMarket({ id: 'bitcoin' }, NOW)).toThrow(MarketError);
    expect(() => parseCoinMarket(null, NOW)).toThrow(MarketError);

    // A minimal entry still yields a usable quote.
    const bare = parseCoinMarket({ id: 'x', symbol: 'x', current_price: 5 }, NOW);
    expect(bare.price).toBe(5);
    expect(bare.changePercent).toBe(0);
    expect(bare.high).toBe(5);
    expect(bare.low).toBe(5);
    expect(bare.spark).toEqual([5, 5]);
  });
});

describe('fetchCryptoQuotes', () => {
  it('batches every crypto symbol into one request', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse([ENTRY]));
    await fetchCryptoQuotes(['BTC', 'ETH', 'AAPL', 'ZZZZ'], {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      now: NOW,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const url = String(fetchImpl.mock.calls[0][0]);
    expect(url).toContain('/coins/markets');
    expect(url).toContain('ids=bitcoin,ethereum');
    // Stocks and unknown symbols must never reach the request.
    expect(url).not.toContain('AAPL');
    expect(url).not.toContain('ZZZZ');
  });

  it('skips the network entirely when nothing is live', async () => {
    const fetchImpl = vi.fn();
    const quotes = await fetchCryptoQuotes(['AAPL', 'NVDA'], {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(quotes).toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('names the rate limit instead of failing silently', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('slow down', { status: 429 }));
    await expect(
      fetchCryptoQuotes(['BTC'], { fetchImpl: fetchImpl as unknown as typeof fetch }),
    ).rejects.toThrow(/rate limit/i);
  });

  it('treats an empty array as the failure it is', async () => {
    // CoinGecko answers an unknown id with [] and HTTP 200, which would
    // otherwise look like a successful fetch of nothing.
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse([]));
    await expect(
      fetchCryptoQuotes(['BTC'], { fetchImpl: fetchImpl as unknown as typeof fetch }),
    ).rejects.toThrow(/No live prices/);
  });

  it('reports transport errors and unreadable bodies', async () => {
    const down = vi.fn().mockRejectedValue(new TypeError('network down'));
    await expect(
      fetchCryptoQuotes(['BTC'], { fetchImpl: down as unknown as typeof fetch }),
    ).rejects.toThrow(/unreachable/);

    const html = vi.fn().mockResolvedValue(new Response('<html>nope</html>', { status: 200 }));
    await expect(
      fetchCryptoQuotes(['BTC'], { fetchImpl: html as unknown as typeof fetch }),
    ).rejects.toThrow(MarketError);
  });

  it('propagates an abort rather than masking it', async () => {
    const controller = new AbortController();
    const fetchImpl = vi.fn().mockImplementation(() => {
      controller.abort();
      return Promise.reject(new DOMException('aborted', 'AbortError'));
    });
    await expect(
      fetchCryptoQuotes(['BTC'], {
        signal: controller.signal,
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/aborted/i);
  });
});

describe('simulated quotes stay labelled', () => {
  it('marks the mock provider as simulated and names its window', () => {
    const quote = getQuote('AAPL', NOW);
    expect(quote.source).toBe('simulated');
    expect(quote.changeWindow).toBe('session');
  });

  it('labels a symbol by the coin map, not by name heuristics', () => {
    // ARB and OP look like tickers but are known coins; they must not be sent
    // to the stock provider looking for a Finnhub quote.
    expect(kindFor('ARB')).toBe('crypto');
    expect(kindFor('OP')).toBe('crypto');
    expect(kindFor('AAPL')).toBe('stock');
    expect(kindFor('NVDA')).toBe('stock');
  });
});

/** A Finnhub `/quote` response for a live symbol. */
const STOCK = { c: 336.64, d: -3.78, dp: -1.11, h: 338.61, l: 330.7, o: 337.2, pc: 340.42, t: 1786000000 };

function stockResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('Finnhub stock parsing', () => {
  it('maps the quote fields the widget renders', () => {
    const quote = parseStockQuote(STOCK, 'aapl', NOW);
    expect(quote.symbol).toBe('AAPL');
    expect(quote.kind).toBe('stock');
    expect(quote.price).toBe(336.64);
    expect(quote.changeAbs).toBe(-3.78);
    expect(quote.changePercent).toBe(-1.11);
    expect(quote.changeWindow).toBe('session');
    expect(quote.high).toBe(338.61);
    expect(quote.low).toBe(330.7);
    expect(quote.source).toBe('live');
    // No free OHLC history, so no line is drawn rather than an invented one.
    expect(quote.spark).toEqual([]);
  });

  it('rejects an unknown ticker, which Finnhub answers with zeroes', () => {
    // Not an HTTP error: a bogus symbol returns 200 with every field zero.
    expect(() => parseStockQuote({ c: 0, d: 0, dp: 0, h: 0, l: 0, o: 0, pc: 0, t: 0 }, 'ZZZZ', NOW)).toThrow(
      MarketError,
    );
  });

  it('flags an error body as a bad key', () => {
    try {
      parseStockQuote({ error: 'Invalid API key.' }, 'AAPL', NOW);
      throw new Error('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(MarketError);
      expect((error as MarketError).code).toBe('invalid-key');
    }
  });
});

describe('fetchStockQuotes', () => {
  it('requests one quote per symbol with the supplied key', async () => {
    // A fresh Response per call: a body can only be read once, so sharing one
    // object would fail the second parse rather than exercise the code.
    const fetchImpl = vi.fn().mockImplementation(() => Promise.resolve(stockResponse(STOCK)));
    const quotes = await fetchStockQuotes(['AAPL', 'NVDA'], 'test-key', {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      now: NOW,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    for (const call of fetchImpl.mock.calls) {
      const url = String(call[0]);
      expect(url).toContain('/quote?symbol=');
      expect(url).toContain('token=test-key');
    }
    expect(quotes.map((quote) => quote.symbol).sort()).toEqual(['AAPL', 'NVDA']);
  });

  it('refuses to call without a key', async () => {
    const fetchImpl = vi.fn();
    await expect(
      fetchStockQuotes(['AAPL'], '   ', { fetchImpl: fetchImpl as unknown as typeof fetch }),
    ).rejects.toMatchObject({ code: 'missing-key' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('maps 401 to an invalid-key error the UI can act on', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('{"error":"Invalid API key."}', { status: 401 }));
    await expect(
      fetchStockQuotes(['AAPL'], 'bad', { fetchImpl: fetchImpl as unknown as typeof fetch }),
    ).rejects.toMatchObject({ code: 'invalid-key' });
  });

  it('names a rate limit', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('slow down', { status: 429 }));
    await expect(
      fetchStockQuotes(['AAPL'], 'k', { fetchImpl: fetchImpl as unknown as typeof fetch }),
    ).rejects.toMatchObject({ code: 'rate-limit' });
  });

  it('keeps a partial success instead of discarding good quotes', async () => {
    const fetchImpl = vi.fn().mockImplementation((url: string) =>
      String(url).includes('ZZZZ')
        ? Promise.resolve(stockResponse({ c: 0, d: 0, dp: 0, h: 0, l: 0, o: 0, pc: 0, t: 0 }))
        : Promise.resolve(stockResponse(STOCK)),
    );
    const quotes = await fetchStockQuotes(['AAPL', 'ZZZZ'], 'k', {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      now: NOW,
    });
    expect(quotes).toHaveLength(1);
    expect(quotes[0].symbol).toBe('AAPL');
  });

  it('reports a total failure rather than returning nothing quietly', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError('network down'));
    await expect(
      fetchStockQuotes(['AAPL'], 'k', { fetchImpl: fetchImpl as unknown as typeof fetch }),
    ).rejects.toMatchObject({ code: 'unreachable' });
  });
});
