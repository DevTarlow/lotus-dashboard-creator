/**
 * Simulated market data.
 *
 * Prices come from a smooth, seeded pseudo-noise function instead of a random
 * walk, which means a quote is a *pure function* of (symbol, timestamp): no
 * state, no drift between renders, identical on every reload — yet it still
 * moves believably as time passes.
 */
import { createSeededRandom, hashString } from '@/lib/utils';

export type AssetKind = 'crypto' | 'stock';

/** Where a quote came from. */
export type QuoteSource = 'live' | 'simulated';

/** The window a quote's change is measured over. */
export type ChangeWindow = '24h' | 'session';

export interface AssetDefinition {
  symbol: string;
  name: string;
  kind: AssetKind;
  /** Reference price in `currency`. */
  base: number;
  /** Relative amplitude of the simulated swing (0.05 = ±5%). */
  volatility: number;
  currency: string;
}

export interface Quote {
  symbol: string;
  name: string;
  kind: AssetKind;
  currency: string;
  price: number;
  /** Absolute change over `changeWindow`. */
  changeAbs: number;
  /** Percentage change over `changeWindow`. */
  changePercent: number;
  /** What `changeAbs`/`changePercent` are measured over. */
  changeWindow: ChangeWindow;
  /** Intraday range. */
  high: number;
  low: number;
  /** Normalised price history for the sparkline. */
  spark: readonly number[];
  /** Where this quote came from — the UI labels live and simulated rows. */
  source: QuoteSource;
  updatedAt: number;
}

export const MARKET_UNIVERSE: readonly AssetDefinition[] = [
  { symbol: 'BTC', name: 'Bitcoin', kind: 'crypto', base: 68250, volatility: 0.055, currency: 'USD' },
  { symbol: 'ETH', name: 'Ethereum', kind: 'crypto', base: 3480, volatility: 0.065, currency: 'USD' },
  { symbol: 'SOL', name: 'Solana', kind: 'crypto', base: 172.4, volatility: 0.09, currency: 'USD' },
  { symbol: 'ADA', name: 'Cardano', kind: 'crypto', base: 0.58, volatility: 0.085, currency: 'USD' },
  { symbol: 'DOT', name: 'Polkadot', kind: 'crypto', base: 7.15, volatility: 0.08, currency: 'USD' },
  { symbol: 'LINK', name: 'Chainlink', kind: 'crypto', base: 17.3, volatility: 0.082, currency: 'USD' },
  { symbol: 'AAPL', name: 'Apple Inc.', kind: 'stock', base: 224.5, volatility: 0.022, currency: 'USD' },
  { symbol: 'MSFT', name: 'Microsoft Corp.', kind: 'stock', base: 418.2, volatility: 0.02, currency: 'USD' },
  { symbol: 'NVDA', name: 'NVIDIA Corp.', kind: 'stock', base: 121.8, volatility: 0.045, currency: 'USD' },
  { symbol: 'TSLA', name: 'Tesla Inc.', kind: 'stock', base: 248.6, volatility: 0.05, currency: 'USD' },
  { symbol: 'AMZN', name: 'Amazon.com Inc.', kind: 'stock', base: 186.4, volatility: 0.028, currency: 'USD' },
  { symbol: 'GOOGL', name: 'Alphabet Inc.', kind: 'stock', base: 165.7, volatility: 0.026, currency: 'USD' },
  { symbol: 'SPX', name: 'S&P 500 Index', kind: 'stock', base: 5620, volatility: 0.012, currency: 'USD' },
];

const UNIVERSE_BY_SYMBOL = new Map(MARKET_UNIVERSE.map((asset) => [asset.symbol, asset]));

/** Symbols offered by the widget's symbol picker. */
export const MARKET_SYMBOLS: readonly string[] = MARKET_UNIVERSE.map((asset) => asset.symbol);

export function findAsset(symbol: string): AssetDefinition | undefined {
  return UNIVERSE_BY_SYMBOL.get(symbol.trim().toUpperCase());
}

/** Build a synthetic asset so users can track any symbol they type. */
function synthesizeAsset(symbol: string): AssetDefinition {
  const normalised = symbol.trim().toUpperCase() || 'N/A';
  const random = createSeededRandom(hashString(normalised));
  const isIndex = /^\^|INDEX$/.test(normalised);
  return {
    symbol: normalised,
    name: `${normalised} (simulated)`,
    kind: isIndex ? 'stock' : random() > 0.5 ? 'crypto' : 'stock',
    base: Number((4 + random() * 420).toFixed(2)),
    volatility: 0.03 + random() * 0.06,
    currency: 'USD',
  };
}

/** Resolve a symbol to its definition, synthesising unknown ones. */
export function resolveAsset(symbol: string): AssetDefinition {
  return findAsset(symbol) ?? synthesizeAsset(symbol);
}

const TAU = Math.PI * 2;

function phase(seed: number, shift: number): number {
  return (((seed >>> shift) % 1024) / 1024) * TAU;
}

/** Smooth, deterministic noise in roughly [-1, 1]. */
function noise(time: number, seed: number): number {
  return (
    Math.sin(time * 0.31 + phase(seed, 0)) * 0.55 +
    Math.sin(time * 0.87 + phase(seed, 8)) * 0.3 +
    Math.sin(time * 2.13 + phase(seed, 16)) * 0.15
  );
}

/** Price of an asset at a given moment — the single source of truth. */
export function priceAt(asset: AssetDefinition, timestamp: number): number {
  const seed = hashString(asset.symbol);
  const minutes = timestamp / 60000;
  const swing = noise(minutes / 90, seed) * asset.volatility;
  const micro = noise(minutes / 4, seed ^ 0x9e3779b9) * asset.volatility * 0.12;
  const price = asset.base * (1 + swing + micro);
  // Keep small-cap prices from collapsing into 0.00 with two decimals.
  return Math.max(asset.base * 0.05, price);
}

function startOfUtcDay(timestamp: number): number {
  const date = new Date(timestamp);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

/** Build a full quote (price, change, range, sparkline) for one symbol. */
export function getQuote(symbol: string, now: number = Date.now(), sparkPoints = 28): Quote {
  const asset = resolveAsset(symbol);
  const price = priceAt(asset, now);
  const open = priceAt(asset, startOfUtcDay(now));
  const changeAbs = price - open;

  const samples: number[] = [];
  const windowMs = 4 * 60 * 60 * 1000;
  const step = windowMs / Math.max(1, sparkPoints - 1);
  for (let index = 0; index < sparkPoints; index += 1) {
    samples.push(priceAt(asset, now - (sparkPoints - 1 - index) * step));
  }

  const daySamples: number[] = [];
  for (let index = 0; index <= 48; index += 1) {
    daySamples.push(priceAt(asset, startOfUtcDay(now) + (index * 24 * 60 * 60 * 1000) / 48));
  }

  return {
    symbol: asset.symbol,
    name: asset.name,
    kind: asset.kind,
    currency: asset.currency,
    price,
    changeAbs,
    changePercent: open === 0 ? 0 : (changeAbs / open) * 100,
    // Simulated change is measured from the start of the current UTC day.
    changeWindow: 'session',
    high: Math.max(...daySamples, price),
    low: Math.min(...daySamples, price),
    spark: samples,
    source: 'simulated',
    updatedAt: now,
  };
}

/** Quotes for a list of symbols, skipping blanks and duplicates. */
export function getQuotes(symbols: readonly string[], now: number = Date.now()): Quote[] {
  const seen = new Set<string>();
  const quotes: Quote[] = [];
  for (const symbol of symbols) {
    const key = symbol.trim().toUpperCase();
    if (key === '' || seen.has(key)) continue;
    seen.add(key);
    quotes.push(getQuote(key, now));
  }
  return quotes;
}

/** Parse the comma/space separated symbol list stored in the widget config. */
export function parseSymbolList(value: string): string[] {
  return value
    .split(/[\s,;]+/)
    .map((symbol) => symbol.trim().toUpperCase())
    .filter(Boolean)
    .slice(0, 12);
}
