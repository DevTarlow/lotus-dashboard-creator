import { useEffect, useState } from 'react';
import { useTimeBucket } from './useNow';
import type { Quote } from '@/lib/mock/market';
import {
  fetchCryptoQuotes,
  fetchStockQuotes,
  isLiveSymbol,
  MARKET_REFRESH_MS,
  MarketError,
  simulatedCryptoQuote,
} from '@/lib/market';

/** Why stock rows cannot show a price, and what the user can do about it. */
export interface StockPrompt {
  reason: 'missing-key' | 'invalid-key' | 'failed';
  message: string;
  /** Stock symbols in the watchlist that have no live quote. */
  symbols: string[];
}

export interface UseQuotesResult {
  quotes: Quote[];
  /** Stock symbols that could not be priced, so the widget can prompt. */
  stockPrompt: StockPrompt | null;
  /** True while a live request is in flight. */
  pending: boolean;
  /** Live crypto symbols present in the watchlist. */
  hasCrypto: boolean;
}

function symbolKey(symbols: readonly string[]): string {
  return symbols.map((symbol) => symbol.trim().toUpperCase()).join(',');
}

/**
 * Quotes for a watchlist: live crypto and/or live stocks, never invented ones.
 *
 * Crypto is fetched keylessly from CoinGecko and stocks from Finnhub using the
 * user's own free key. Stocks are **never** simulated — a made-up number beside
 * a real ticker would be misleading whatever label it carried — so a stock
 * symbol without a quote is reported through `stockPrompt` for the widget to
 * explain and link to signup.
 *
 * A failed crypto request falls back to the deterministic simulated price for
 * that symbol, which is honest because those rows are explicitly labelled.
 */
export function useQuotes(symbols: readonly string[], apiKey: string, now: number): UseQuotesResult {
  // One request per window, shared by every market widget on the canvas. The
  // window is a minute long, so there is nothing to gain from polling faster.
  const bucket = useTimeBucket(MARKET_REFRESH_MS, true, MARKET_REFRESH_MS);
  const [live, setLive] = useState<Quote[]>([]);
  const [stockPrompt, setStockPrompt] = useState<StockPrompt | null>(null);
  const [settledKey, setSettledKey] = useState<string | null>(null);

  // Split once here so the render path and the effect agree on the partition.
  const key = symbolKey(symbols);
  const hasKey = apiKey.trim() !== '';
  const all = key.split(',').filter((symbol) => symbol !== '');
  const crypto = all.filter(isLiveSymbol);
  const stocks = all.filter((symbol) => !isLiveSymbol(symbol));
  const requestKey = `${key}@${bucket}@${hasKey ? 'key' : 'nokey'}`;

  useEffect(() => {
    // Derived from `key` rather than the arrays above, so the effect depends on
    // a single stable string instead of two fresh arrays each render.
    const wanted = key.split(',').filter((symbol) => symbol !== '');
    const wantedCrypto = wanted.filter(isLiveSymbol);
    const wantedStocks = wanted.filter((symbol) => !isLiveSymbol(symbol));
    if (wantedCrypto.length === 0 && wantedStocks.length === 0) return undefined;

    const controller = new AbortController();
    let active = true;
    const options = { signal: controller.signal };

    const cryptoRequest = wantedCrypto.length
      ? fetchCryptoQuotes(wantedCrypto, options)
      : Promise.resolve<Quote[]>([]);

    // Without a key there is nothing to ask, so the prompt is raised directly.
    const stockRequest = wantedStocks.length
      ? hasKey
        ? fetchStockQuotes(wantedStocks, apiKey, options)
        : Promise.reject(new MarketError('No Finnhub key yet.', 'missing-key'))
      : Promise.resolve<Quote[]>([]);

    Promise.allSettled([cryptoRequest, stockRequest]).then(([cryptoResult, stockResult]) => {
      if (!active) return;

      const quotes: Quote[] = [];
      if (cryptoResult.status === 'fulfilled') {
        quotes.push(...cryptoResult.value);
      } else {
        // Keep the ticker populated for crypto; the row is labelled simulated.
        quotes.push(...wantedCrypto.map((symbol) => simulatedCryptoQuote(symbol, now)));
      }

      if (stockResult.status === 'fulfilled') {
        quotes.push(...stockResult.value);
      }

      // Which stock symbols still have no quote, and why.
      const priced = new Set(quotes.map((quote) => quote.symbol));
      const unpriced = wantedStocks.filter((symbol) => !priced.has(symbol));
      if (unpriced.length === 0) {
        setStockPrompt(null);
      } else {
        const cause: unknown = stockResult.status === 'rejected' ? stockResult.reason : undefined;
        const code = cause instanceof MarketError ? cause.code : undefined;
        const reason: StockPrompt['reason'] =
          code === 'missing-key' ? 'missing-key' : code === 'invalid-key' ? 'invalid-key' : 'failed';
        setStockPrompt({
          reason,
          message: cause instanceof MarketError ? cause.message : 'Stock quotes are unavailable.',
          symbols: unpriced,
        });
      }

      setLive(quotes);
      setSettledKey(requestKey);
    });

    return () => {
      active = false;
      controller.abort();
    };
    // `crypto`/`stocks` are derived from `key`, so depending on it keeps the
    // effect stable across renders that rebuild those arrays.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, requestKey, apiKey]);

  const settled = settledKey === requestKey;
  const quotes = settled ? live : [];
  // Simulated crypto prices are pure functions of time, so they are recomputed
  // from the caller's clock and keep drifting between the slower live refreshes.
  const merged = settled
    ? quotes.map((quote) =>
        quote.source === 'simulated' && isLiveSymbol(quote.symbol)
          ? simulatedCryptoQuote(quote.symbol, now)
          : quote,
      )
    : [];

  return {
    quotes: merged,
    stockPrompt: settled ? stockPrompt : null,
    pending: !settled && (crypto.length > 0 || stocks.length > 0),
    hasCrypto: crypto.length > 0,
  };
}
