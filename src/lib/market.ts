/**
 * Live crypto prices from CoinGecko — free, no API key, no signup, CORS enabled
 * — plus live stock quotes from Finnhub, which needs the user's own free key.
 *
 * Stock data is deliberately never simulated. Showing an invented number next to
 * a real ticker symbol is misleading however it is labelled, so a stock symbol
 * either has a live quote or is reported as unavailable with a prompt to connect
 * a provider. Every keyless stock source was checked and rejected: the
 * unofficial Yahoo endpoints send no `access-control-allow-origin` header (and
 * now 401 on `/v7/finance/quote`), Stooq serves a JavaScript proof-of-work
 * challenge, Nasdaq's API has no CORS header, and Alpha Vantage, Finnhub,
 * Twelve Data and FMP all reject keyless requests outright. Equity quotes carry
 * per-user exchange licensing fees, which is why a key is unavoidable.
 */
import type { AssetKind, Quote } from '@/lib/mock/market';
import { getQuote as getSimulatedQuote } from '@/lib/mock/market';

export const COINGECKO_API = 'https://api.coingecko.com/api/v3';

/** Stock quotes come from Finnhub on the user's own free key. */
export const FINNHUB_API = 'https://finnhub.io/api/v1';

/** Where a user goes to get a free key. Shown in the widget and in Settings. */
export const FINNHUB_SIGNUP_URL = 'https://finnhub.io/register';

/**
 * How long live quotes are trusted before refetching.
 *
 * CoinGecko's keyless tier is documented at roughly 10–30 calls/minute and
 * explicitly "not suitable for … scheduled polling", so this deliberately polls
 * far slower than the simulated ticker did. One batched request covers every
 * crypto symbol on the dashboard.
 */
export const MARKET_REFRESH_MS = 60 * 1000;

/** Thrown when a live lookup fails, so callers can fall back or prompt. */
export class MarketError extends Error {
  /**
   * Machine-readable reason. `missing-key` and `invalid-key` both mean "the
   * user can fix this by signing up", so the UI prompts rather than apologises.
   */
  readonly code?: 'missing-key' | 'invalid-key' | 'rate-limit' | 'unreachable' | 'not-found';

  constructor(message: string, code?: MarketError['code']) {
    super(message);
    this.name = 'MarketError';
    this.code = code;
  }
}

/**
 * Curated symbol → CoinGecko id map.
 *
 * This exists because symbol lookup is genuinely unsafe to guess: CoinGecko has
 * 20k+ coins and anyone can mint one, so `/search?query=ada` leads with a token
 * called "ada-the-dog" and `query=eth` leads with bridged wrapped variants.
 * Matching a symbol to the wrong coin would show a scam token's price with a
 * straight face. Each id below was verified against its market-cap rank, and a
 * symbol absent from this map is never looked up live.
 */
export const COIN_IDS: Readonly<Record<string, string>> = {
  BTC: 'bitcoin',
  ETH: 'ethereum',
  USDT: 'tether',
  BNB: 'binancecoin',
  SOL: 'solana',
  USDC: 'usd-coin',
  XRP: 'ripple',
  DOGE: 'dogecoin',
  ADA: 'cardano',
  TRX: 'tron',
  AVAX: 'avalanche-2',
  LINK: 'chainlink',
  DOT: 'polkadot',
  MATIC: 'matic-network',
  LTC: 'litecoin',
  BCH: 'bitcoin-cash',
  XLM: 'stellar',
  ATOM: 'cosmos',
  UNI: 'uniswap',
  ETC: 'ethereum-classic',
  FIL: 'filecoin',
  NEAR: 'near',
  APT: 'aptos',
  ARB: 'arbitrum',
  OP: 'optimism',
  INJ: 'injective-protocol',
  SUI: 'sui',
  SEI: 'sei-network',
  TIA: 'celestia',
  RUNE: 'thorchain',
  AAVE: 'aave',
  ALGO: 'algorand',
  VET: 'vechain',
  ICP: 'internet-computer',
  HBAR: 'hedera-hashgraph',
  MKR: 'maker',
  GRT: 'the-graph',
  SAND: 'the-sandbox',
  MANA: 'decentraland',
  EOS: 'eos',
  XTZ: 'tezos',
  FLOW: 'flow',
  CHZ: 'chiliz',
  CRV: 'curve-dao-token',
  SNX: 'havven',
  COMP: 'compound-governance-token',
  ZEC: 'zcash',
  DASH: 'dash',
  NEO: 'neo',
  IOTA: 'iota',
};

/** The CoinGecko id for a symbol, or `undefined` when it is not a known coin. */
export function coinIdFor(symbol: string): string | undefined {
  return COIN_IDS[symbol.trim().toUpperCase()];
}

/** True when a symbol can be fetched live (crypto only, and a known coin). */
export function isLiveSymbol(symbol: string): boolean {
  return coinIdFor(symbol) !== undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function asNumber(value: unknown): number | undefined {
  const parsed = typeof value === 'number' ? value : Number.parseFloat(String(value));
  return Number.isFinite(parsed) ? parsed : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

/**
 * Reduces CoinGecko's 168 hourly sparkline points to `points` samples.
 *
 * The array is a fixed 7-day window regardless of when it is requested, so the
 * first sample is always ~7 days old. Sampling is anchored to the end of the
 * array, which keeps the line's final value equal to the current price — the
 * shape the simulated provider produced, where the last sample is `price`.
 */
export function resampleSpark(spark: unknown, points = 28): number[] {
  const values = Array.isArray(spark)
    ? spark.map(asNumber).filter((value): value is number => value !== undefined)
    : [];
  if (values.length <= points) return values;
  const step = (values.length - 1) / (points - 1);
  const sampled: number[] = [];
  // Walk backwards so the final sample is the newest value, then flip.
  for (let index = 0; index < points; index += 1) {
    sampled.push(values[Math.round(values.length - 1 - index * step)]);
  }
  return sampled.reverse();
}

/**
 * Converts one `/coins/markets` entry into the app's `Quote` shape.
 *
 * `changeAbs` is rewritten as price-minus-change so it stays coherent with the
 * percentage: live quotes report a 24 hour change, while the simulated provider
 * measured from the start of the UTC day, so the two cannot share a reference.
 *
 * @throws {MarketError} when the entry carries no usable price.
 */
export function parseCoinMarket(entry: unknown, now = Date.now()): Quote {
  if (!isRecord(entry)) throw new MarketError('Unexpected market response.');

  const price = asNumber(entry.current_price);
  const id = asString(entry.id);
  if (price === undefined || id === undefined) {
    throw new MarketError('A coin entry was missing its price.');
  }

  const symbol = (asString(entry.symbol) ?? id).toUpperCase();
  const changePercent = asNumber(entry.price_change_percentage_24h) ?? 0;
  const spark = resampleSpark(isRecord(entry.sparkline_in_7d) ? entry.sparkline_in_7d.price : undefined);

  return {
    symbol,
    name: asString(entry.name) ?? symbol,
    kind: 'crypto',
    // The request pins `vs_currency=usd`, so the response carries no currency.
    currency: 'USD',
    price,
    // Derived so `price - changeAbs` reproduces the 24 hour reference price.
    changeAbs: (price * changePercent) / (100 + changePercent),
    changePercent,
    changeWindow: '24h',
    high: asNumber(entry.high_24h) ?? price,
    low: asNumber(entry.low_24h) ?? price,
    spark: spark.length > 0 ? spark : [price, price],
    source: 'live',
    updatedAt: now,
  };
}

export interface FetchQuotesOptions {
  signal?: AbortSignal;
  /** Injected for tests; defaults to the global `fetch`. */
  fetchImpl?: typeof fetch;
  /** Clock override, so parsed timestamps are deterministic under test. */
  now?: number;
}

/**
 * Looks up live quotes for the crypto symbols among `symbols`.
 *
 * Unknown or stock symbols are skipped rather than failing the batch, so a mixed
 * watchlist still gets live data for the part that can have it. One request
 * covers every coin.
 *
 * @throws {MarketError} on a transport error, a rate limit or an unreadable body.
 */
export async function fetchCryptoQuotes(
  symbols: readonly string[],
  { signal, fetchImpl = fetch, now = Date.now() }: FetchQuotesOptions = {},
): Promise<Quote[]> {
  const wanted = new Map<string, string>();
  for (const symbol of symbols) {
    const id = coinIdFor(symbol);
    if (id) wanted.set(id, symbol.trim().toUpperCase());
  }
  if (wanted.size === 0) return [];

  const url =
    `${COINGECKO_API}/coins/markets?vs_currency=usd&sparkline=true` +
    `&price_change_percentage=24h&ids=${[...wanted.keys()].join(',')}`;

  let response: Response;
  try {
    response = await fetchImpl(url, { signal, headers: { Accept: 'application/json' } });
  } catch (error) {
    if (signal?.aborted || (error instanceof DOMException && error.name === 'AbortError')) throw error;
    throw new MarketError('CoinGecko is unreachable.');
  }

  if (response.status === 429) {
    // The keyless pool is shared per IP and is documented to be tight.
    throw new MarketError('CoinGecko is asking us to slow down, so these prices are simulated.');
  }
  if (!response.ok) throw new MarketError(`CoinGecko responded with ${response.status}.`);

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new MarketError('CoinGecko returned an unreadable response.');
  }
  // An unknown id yields `[]` with HTTP 200 rather than an error, so an empty
  // array is a real (and silent) failure mode worth naming.
  if (!Array.isArray(payload)) throw new MarketError('Unexpected market response.');
  if (payload.length === 0) throw new MarketError('No live prices returned for those symbols.');

  return payload.map((entry) => parseCoinMarket(entry, now));
}

/**
 * A simulated quote, used only when a live crypto lookup fails.
 *
 * Stocks never come from here: an invented price against a real ticker is
 * misleading even when labelled, so an unavailable stock is reported as
 * unavailable rather than filled in.
 */
export function simulatedCryptoQuote(symbol: string, now: number): Quote {
  return { ...getSimulatedQuote(symbol, now), source: 'simulated' };
}

/**
 * The asset class to label a symbol with.
 *
 * Prefers the curated coin map over name heuristics: a symbol like `ARB` or
 * `OP` would otherwise be synthesised as a stock and then look for a Finnhub
 * quote that does not exist.
 */
export function kindFor(symbol: string): AssetKind {
  return isLiveSymbol(symbol) ? 'crypto' : 'stock';
}

/**
 * Converts one Finnhub `/quote` response into the app's `Quote` shape.
 *
 * Finnhub reports a session change (`d`/`dp` against the previous close) and a
 * day range, but no sparkline on the free tier, so `spark` is empty and the
 * widget draws no line rather than inventing one.
 *
 * @throws {MarketError} when the symbol has no quote (Finnhub answers an unknown
 *   ticker with zeroes and HTTP 200, which is not a real price).
 */
export function parseStockQuote(payload: unknown, symbol: string, now = Date.now()): Quote {
  if (!isRecord(payload)) throw new MarketError('Unexpected quote response.');
  // Finnhub answers a bad key with `{"error": "..."}` at this level.
  if (payload.error !== undefined) {
    throw new MarketError('Finnhub rejected the request.', 'invalid-key');
  }

  const price = asNumber(payload.c);
  const previousClose = asNumber(payload.pc);
  const changePercent = asNumber(payload.dp);
  // An unknown ticker comes back as all zeroes rather than an error.
  if (price === undefined || price === 0) {
    throw new MarketError(`No quote available for ${symbol}.`, 'not-found');
  }

  return {
    symbol: symbol.trim().toUpperCase(),
    name: symbol.trim().toUpperCase(),
    kind: 'stock',
    currency: 'USD',
    price,
    changeAbs: asNumber(payload.d) ?? (previousClose === undefined ? 0 : price - previousClose),
    changePercent: changePercent ?? 0,
    changeWindow: 'session',
    high: asNumber(payload.h) ?? price,
    low: asNumber(payload.l) ?? price,
    // No free OHLC history, so there is no line to draw.
    spark: [],
    source: 'live',
    updatedAt: now,
  };
}

/**
 * Live stock quotes for `symbols`, one request each.
 *
 * Finnhub has no batch quote endpoint on the free tier, so this fans out and
 * tolerates partial failure: symbols that fail are simply absent from the result
 * and the caller reports them as unavailable. A bad key fails fast, because
 * every subsequent request would fail identically.
 *
 * @throws {MarketError} `missing-key` when no key is set, otherwise the first
 *   authentication, rate-limit or transport failure.
 */
export async function fetchStockQuotes(
  symbols: readonly string[],
  apiKey: string,
  { signal, fetchImpl = fetch, now = Date.now() }: FetchQuotesOptions = {},
): Promise<Quote[]> {
  const key = apiKey.trim();
  if (!key) throw new MarketError('No Finnhub key yet.', 'missing-key');

  const wanted = [...new Set(symbols.map((symbol) => symbol.trim().toUpperCase()).filter(Boolean))];
  if (wanted.length === 0) return [];

  const results = await Promise.allSettled(
    wanted.map(async (symbol) => {
      const url = `${FINNHUB_API}/quote?symbol=${encodeURIComponent(symbol)}&token=${encodeURIComponent(key)}`;
      let response: Response;
      try {
        response = await fetchImpl(url, { signal, headers: { Accept: 'application/json' } });
      } catch (error) {
        if (signal?.aborted || (error instanceof DOMException && error.name === 'AbortError')) throw error;
        throw new MarketError('Finnhub is unreachable.', 'unreachable');
      }

      if (response.status === 401 || response.status === 403) {
        throw new MarketError('Finnhub did not accept that key.', 'invalid-key');
      }
      if (response.status === 429) {
        throw new MarketError('Finnhub rate limit reached.', 'rate-limit');
      }
      if (!response.ok) throw new MarketError(`Finnhub responded with ${response.status}.`, 'unreachable');

      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        throw new MarketError('Finnhub returned an unreadable response.', 'unreachable');
      }
      return parseStockQuote(payload, symbol, now);
    }),
  );

  const quotes: Quote[] = [];
  let firstError: MarketError | null = null;
  for (const result of results) {
    if (result.status === 'fulfilled') {
      quotes.push(result.value);
    } else if (result.reason instanceof MarketError) {
      firstError ??= result.reason;
    }
  }

  // An abort is a cancellation, not a failure to report.
  if (signal?.aborted) throw new DOMException('aborted', 'AbortError');
  // Surface a total failure, but keep a partial success useful.
  if (quotes.length === 0) {
    throw firstError ?? new MarketError('No stock quotes available.', 'not-found');
  }
  return quotes;
}
