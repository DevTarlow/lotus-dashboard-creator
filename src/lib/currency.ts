/**
 * Currency conversion on the ECB reference rates, served by Frankfurter.
 *
 * `api.frankfurter.dev` is a keyless, CORS-enabled read of the European Central
 * Bank's daily reference rates: about thirty currencies, published once per
 * **working day** at roughly 16:00 CET. It is deliberately not a trading feed —
 * there is no bid/ask, no weekend or holiday quote and no intraday movement — so
 * the widget says "reference rate" and names the publication date instead of
 * implying a market price. It is also not a licence to invent a number: when the
 * provider has no rate, the widget says so.
 *
 * Everything here is pure apart from the three `fetch*` functions, which go
 * through the shared cache in `@/lib/http` (so several widgets watching the same
 * pair cost one request). Responses are validated on the way in: a payload that
 * does not carry the requested rate raises `HttpError(…, 'parse')` rather than
 * reaching the screen as a plausible-looking figure.
 */
import { HttpError, requestJson } from '@/lib/http';
import { addDays, dayKey, isValidDayKey } from '@/lib/time';
import { formatUnitValue } from '@/lib/units';
import { clamp, isRecord } from '@/lib/utils';

/** Frankfurter v1 root — the documented, keyless, CORS-enabled endpoint. */
export const FRANKFURTER_BASE = 'https://api.frankfurter.dev/v1';

/** How long a rate is reused before the provider is asked again. */
export const CURRENCY_REFRESH_MS = 15 * 60 * 1000;

/**
 * Cache window for the currency list and for a daily history.
 *
 * Both change at most once per working day, so re-asking them every fifteen
 * minutes would be noise, not freshness.
 */
export const CURRENCY_LIST_TTL_MS = 24 * 60 * 60 * 1000;

/** Calendar days of history the 30-day sparkline asks for. */
export const SERIES_DAYS = 30;

/** Cache key of the currency list. Exported so a widget can report a cache hit. */
export const CURRENCIES_KEY = 'frankfurter:currencies';

/** Published rates for one base, keyed by quote code. */
export interface CurrencyRates {
  base: string;
  /** ISO date the rates were published for. */
  date: string;
  rates: Record<string, number>;
}

/** One point per working day, oldest first. */
export interface CurrencySeries {
  base: string;
  quote: string;
  points: { date: string; rate: number }[];
}

/** A picker entry: the ISO code and how to show it. */
export interface CurrencyOption {
  value: string;
  label: string;
}

/* ------------------------------------------------------------------ helpers */

/** ISO codes are upper case throughout the app, whatever the config holds. */
function canonical(code: string): string {
  return code.trim().toUpperCase();
}

/** Trimmed, upper-cased, de-duplicated codes in the order given. */
function uniqueCodes(codes: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const code of codes) {
    const next = canonical(code);
    if (next === '' || seen.has(next)) continue;
    seen.add(next);
    result.push(next);
  }
  return result;
}

function parseError(message: string): HttpError {
  return new HttpError(message, 'parse');
}

/** `symbols=EUR,GBP`, with each code escaped but the separators left readable. */
function symbolQuery(codes: readonly string[]): string {
  return codes.map((code) => encodeURIComponent(code)).join(',');
}

/** A non-empty string field, or a parse error naming what was missing. */
function readText(payload: Record<string, unknown>, key: string, what: string): string {
  const value = payload[key];
  if (typeof value !== 'string' || value.trim() === '') throw parseError(`The provider sent no ${what}.`);
  return value.trim();
}

/* -------------------------------------------------------------- cache keys */

/**
 * Cache key for a latest-rate lookup.
 *
 * The symbol set is part of the key on purpose: two widgets on the same base but
 * different quotes must not share a payload, or the second one would be handed a
 * response that does not contain its rate. Sorted, so `[EUR, GBP]` and
 * `[GBP, EUR]` are one request.
 */
export function latestKey(base: string, quotes: readonly string[]): string {
  const unit = canonical(base);
  const symbols = uniqueCodes(quotes).filter((code) => code !== unit).sort();
  return `frankfurter:latest:${unit}:${symbols.join(',')}`;
}

/** Cache key for a daily history. */
export function seriesKey(base: string, quote: string, days: number): string {
  return `frankfurter:series:${canonical(base)}:${canonical(quote)}:${Math.trunc(days)}`;
}

/* ----------------------------------------------------------------- parsers */

/**
 * `{ "EUR": "Euro", … }` → the same map, with codes upper-cased.
 *
 * @throws {HttpError} `parse` when the payload is not a non-empty map of names.
 */
export function parseCurrencies(payload: unknown): Record<string, string> {
  if (!isRecord(payload)) throw parseError('The provider sent an unreadable currency list.');
  const names: Record<string, string> = {};
  for (const [code, name] of Object.entries(payload)) {
    const id = canonical(code);
    if (id === '' || typeof name !== 'string' || name.trim() === '') {
      throw parseError('The provider sent a currency list entry that could not be read.');
    }
    names[id] = name.trim();
  }
  if (Object.keys(names).length === 0) throw parseError('The provider sent an empty currency list.');
  return names;
}

/**
 * `{ base, date, rates: { EUR: 0.89 } }` → the published date and rates.
 *
 * Entries that are not finite numbers are dropped; a payload with no usable rate
 * at all is malformed, and says so.
 *
 * @throws {HttpError} `parse` for a payload without a base, a real ISO date or a
 *   single usable rate.
 */
export function parseLatestRates(payload: unknown): { base: string; date: string; rates: Record<string, number> } {
  if (!isRecord(payload)) throw parseError('The provider sent an unreadable rate.');

  const base = canonical(readText(payload, 'base', 'base currency'));
  const date = readText(payload, 'date', 'publication date');
  if (!isValidDayKey(date)) throw parseError('The provider sent a rate without a usable publication date.');

  const table = payload.rates;
  if (!isRecord(table)) throw parseError('The provider sent no rates.');

  const rates: Record<string, number> = {};
  for (const [code, rate] of Object.entries(table)) {
    const id = canonical(code);
    if (id === '' || typeof rate !== 'number' || !Number.isFinite(rate)) continue;
    rates[id] = rate;
  }
  if (Object.keys(rates).length === 0) throw parseError('The provider sent no usable rates.');

  return { base, date, rates };
}

/**
 * A range payload (`rates: { "2026-01-02": { EUR: 0.85 } }`) → an ascending
 * series for one quote.
 *
 * Days the ECB did not publish (weekends, holidays) are simply absent from the
 * payload and stay absent from the series — the sparkline draws a gap rather
 * than a made-up point. A malformed entry is dropped for the same reason; a
 * payload with nothing usable in it is an error.
 *
 * @throws {HttpError} `parse` when the payload carries no usable point for
 *   `quote`.
 */
export function parseSeries(payload: unknown, quote: string): CurrencySeries {
  if (!isRecord(payload)) throw parseError('The provider sent an unreadable rate history.');

  const base = canonical(readText(payload, 'base', 'base currency'));
  const wanted = canonical(quote);
  const table = payload.rates;
  if (!isRecord(table)) throw parseError('The provider sent no rate history.');

  const points: { date: string; rate: number }[] = [];
  for (const [date, day] of Object.entries(table)) {
    if (!isRecord(day) || !isValidDayKey(date)) continue;
    const rate = day[wanted];
    if (typeof rate !== 'number' || !Number.isFinite(rate)) continue;
    points.push({ date, rate });
  }
  if (points.length === 0) throw parseError(`The provider sent no rate history for ${wanted || 'that currency'}.`);

  // ISO dates sort lexicographically, which is also chronologically.
  points.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return { base, quote: wanted, points };
}

/* ----------------------------------------------------------------- fetchers */

/**
 * Every currency the ECB publishes, as `code → name`.
 *
 * The list changes rarely, so it is cached for a day.
 *
 * @throws {HttpError} on a transport failure or a payload that is not a map.
 */
export async function fetchCurrencies(signal: AbortSignal): Promise<Record<string, string>> {
  const response = await requestJson<unknown>(CURRENCIES_KEY, `${FRANKFURTER_BASE}/currencies`, {
    ttlMs: CURRENCY_LIST_TTL_MS,
    signal,
  });
  return parseCurrencies(response.data);
}

/**
 * The latest published rates for `base` against `quotes`.
 *
 * `base === quote` needs no request at all: converting a currency into itself is
 * exactly 1, so that rate is returned with today's date and the network is left
 * alone. When the base appears among several quotes it is answered the same way
 * and only the remaining symbols are requested.
 *
 * @throws {HttpError} when the provider refuses a symbol (Frankfurter answers
 *   non-OK for one it does not know) or omits a requested rate — the caller must
 *   never be handed a substitute figure.
 */
export async function fetchLatest(
  base: string,
  quotes: readonly string[],
  signal: AbortSignal,
): Promise<CurrencyRates> {
  const unit = canonical(base);
  const requested = uniqueCodes(quotes);
  const identity = requested.includes(unit);
  const remote = requested.filter((code) => code !== unit).sort();

  // Nothing to ask for: the identity rate is true by definition.
  if (remote.length === 0) {
    return {
      base: unit,
      date: dayKey(new Date()),
      rates: identity ? { [unit]: 1 } : {},
    };
  }

  const url = `${FRANKFURTER_BASE}/latest?base=${encodeURIComponent(unit)}&symbols=${symbolQuery(remote)}`;
  const response = await requestJson<unknown>(latestKey(unit, remote), url, {
    ttlMs: CURRENCY_REFRESH_MS,
    signal,
  });
  const parsed = parseLatestRates(response.data);
  if (parsed.base !== unit) {
    throw parseError(`The provider answered for ${parsed.base} instead of ${unit}.`);
  }

  const rates: Record<string, number> = identity ? { [unit]: 1 } : {};
  for (const code of remote) {
    const rate = parsed.rates[code];
    if (rate === undefined) throw parseError(`The provider sent no rate for ${code}.`);
    rates[code] = rate;
  }
  return { base: unit, date: parsed.date, rates };
}

/**
 * The last `days` calendar days of published rates for one pair, oldest first.
 *
 * `base === quote` is a flat line at 1, so no history is fetched and an empty
 * series is returned — the widget draws nothing rather than a line that says
 * nothing.
 *
 * @throws {HttpError} on a transport failure or a payload with no usable point.
 */
export async function fetchSeries(
  base: string,
  quote: string,
  days: number,
  signal: AbortSignal,
): Promise<CurrencySeries> {
  const unit = canonical(base);
  const other = canonical(quote);
  if (unit === other) return { base: unit, quote: other, points: [] };

  const span = clamp(Math.trunc(Number.isFinite(days) ? days : SERIES_DAYS), 1, 366);
  const start = dayKey(addDays(new Date(), -span));
  const url = `${FRANKFURTER_BASE}/${start}..?base=${encodeURIComponent(unit)}&symbols=${encodeURIComponent(other)}`;
  const response = await requestJson<unknown>(seriesKey(unit, other, span), url, {
    ttlMs: CURRENCY_LIST_TTL_MS,
    signal,
  });
  return parseSeries(response.data, other);
}

/* ------------------------------------------------------------ pure helpers */

/**
 * Convert with a published rate. Non-finite input stays non-finite, so a caller
 * can tell "no rate" from "zero" instead of rendering a confident `0`.
 */
export function convertCurrency(amount: number, rate: number): number {
  if (!Number.isFinite(amount) || !Number.isFinite(rate)) return Number.NaN;
  return amount * rate;
}

/** Formatting is pinned to one locale so the output is deterministic. */
const LOCALE = 'en-US';

/** `Intl.NumberFormat` construction is expensive, so the formatters are cached. */
const formatters = new Map<string, Intl.NumberFormat>();

/**
 * ICU separates a currency code from its amount with a no-break space — plain
 * `U+00A0` on most versions, narrow `U+202F` on others. Both become an ordinary
 * space so the output is byte-identical everywhere, the same way `@/lib/units`
 * pins its locale.
 */
function tidySpaces(text: string): string {
  return text.replace(/[\u00a0\u202f]/g, ' ');
}

/**
 * Money, labelled with its ISO code: `USD 1,234.50`.
 *
 * The code is used rather than a symbol because symbols collide (`$` is USD, CAD
 * and AUD alike) and this widget is about naming a rate honestly. Values below 1
 * keep four decimals, as elsewhere in the app. An unknown-but-well-formed code
 * is shown as-is by `Intl`; a code `Intl` rejects (a malformed one, or an empty
 * string from a hand-edited config) falls back to a plain number rather than
 * throwing inside a render.
 */
export function formatMoney(value: number, currency: string): string {
  const safe = Number.isFinite(value) ? value : 0;
  const code = canonical(currency);
  const digits = safe !== 0 && Math.abs(safe) < 1 ? 4 : 2;
  const key = `${code}:${digits}`;
  const cached = formatters.get(key);
  if (cached) return tidySpaces(cached.format(safe));

  try {
    const created = new Intl.NumberFormat(LOCALE, {
      style: 'currency',
      currency: code,
      currencyDisplay: 'code',
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    });
    formatters.set(key, created);
    return tidySpaces(created.format(safe));
  } catch {
    // Unusable code: a plain number beats a crash, and the caller is already
    // showing the code it asked for.
    return formatUnitValue(safe);
  }
}
/** The supported list is the authority on spelling, compared case-insensitively. */
function matchSupported(code: string, supported: readonly string[]): string | null {
  const wanted = canonical(code);
  if (wanted === '') return null;
  for (const entry of supported) {
    const candidate = canonical(entry);
    if (candidate === wanted) return candidate;
  }
  return null;
}

/** `true` when the code is one the provider publishes (case-insensitive). */
export function isSupportedCurrency(code: string, supported: readonly string[]): boolean {
  return matchSupported(code, supported) !== null;
}

/** Fallbacks used only when a stored code is not in the supported list. */
const DEFAULT_BASE = 'USD';
const DEFAULT_QUOTE = 'EUR';

/**
 * A pair that can actually be requested.
 *
 * A stored code that the provider does not publish falls back to USD/EUR (or, if
 * even those are missing, to the first supported code). An **empty** supported
 * list means the list itself has not loaded or has failed: then the stored codes
 * are kept exactly as typed, because there is no authority to correct them
 * against and silently rewriting the user's pair would be worse than showing it.
 * `base === quote` is left alone — that pair is valid, and exactly 1.
 */
export function normalizeCurrencyPair(
  base: string,
  quote: string,
  supported: readonly string[],
): { base: string; quote: string } {
  const storedBase = canonical(base) || DEFAULT_BASE;
  const storedQuote = canonical(quote) || DEFAULT_QUOTE;
  const usable = uniqueCodes(supported);
  if (usable.length === 0) return { base: storedBase, quote: storedQuote };

  return {
    base: matchSupported(storedBase, usable) ?? matchSupported(DEFAULT_BASE, usable) ?? usable[0],
    quote: matchSupported(storedQuote, usable) ?? matchSupported(DEFAULT_QUOTE, usable) ?? usable[0],
  };
}

/** Picker entries for a loaded currency list, sorted by currency name. */
export function currencyOptions(names: Record<string, string>): CurrencyOption[] {
  return Object.entries(names)
    .map(([code, name]) => ({ code: canonical(code), name: name.trim() }))
    .sort((a, b) => a.name.localeCompare(b.name, LOCALE) || a.code.localeCompare(b.code, LOCALE))
    .map(({ code, name }) => ({ value: code, label: name === '' ? code : `${code} · ${name}` }));
}

/**
 * Picker entries for codes with no names to show — the state a widget is in when
 * the currency list has not loaded or has failed. The stored pair stays visible
 * (and selectable) rather than being replaced by an invented list.
 */
export function currencyFallbackOptions(codes: readonly string[]): CurrencyOption[] {
  const seen = new Set<string>();
  const options: CurrencyOption[] = [];
  for (const code of codes) {
    const id = canonical(code);
    if (id === '' || seen.has(id)) continue;
    seen.add(id);
    options.push({ value: id, label: id });
  }
  return options;
}
