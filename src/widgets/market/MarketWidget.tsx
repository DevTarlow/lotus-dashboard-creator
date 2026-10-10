import { useMemo, useRef, useState } from 'react';
import { CloseIcon, MarketIcon, PlusIcon, RefreshIcon } from '@/components/icons';
import { Badge, EmptyState } from '@/components/ui';
import { useClickOutside } from '@/hooks/useClickOutside';
import { useNow } from '@/hooks/useNow';
import { useQuotes } from '@/hooks/useQuotes';
import { MARKET_SYMBOLS, parseSymbolList, type Quote } from '@/lib/mock/market';
import { usePrefsStore } from '@/store/prefsStore';
import { FINNHUB_SIGNUP_URL, isLiveSymbol } from '@/lib/market';
import { cn, formatCurrency, formatNumber } from '@/lib/utils';
import type { SettingField, WidgetProps } from '@/types';
import { defineWidget } from '@/widgets/define';
import { DeltaPill, Sparkline } from '@/widgets/shared';

export type MarketKindFilter = 'all' | 'crypto' | 'stock';

export type MarketConfig = {
  /** Comma separated symbol list, e.g. `BTC, ETH, NVDA`. */
  symbols: string;
  /** Restrict the list to one asset class. */
  kind: MarketKindFilter;
  showSparkline: boolean;
  showNames: boolean;
};

const DEFAULT_MARKET_CONFIG: MarketConfig = {
  symbols: 'BTC, ETH, SOL, NVDA, AAPL',
  kind: 'all',
  showSparkline: true,
  showNames: true,
};

const SETTINGS: readonly SettingField[] = [
  {
    key: 'symbols',
    label: 'Symbols',
    type: 'text',
    placeholder: 'BTC, ETH, NVDA',
    help: 'Comma separated. Crypto is priced live via CoinGecko. Stocks need the Finnhub key below — they are never simulated.',
  },
  {
    key: 'finnhubKey',
    label: 'Finnhub API key (optional)',
    type: 'password',
    placeholder: 'Paste your free key',
    maxLength: 64,
    help: 'Only needed for stocks. Stored in this browser and sent only to Finnhub; it is never included in a dashboard export.',
    link: { href: FINNHUB_SIGNUP_URL, label: 'Get a free Finnhub key (no card required) →' },
  },
  {
    key: 'kind',
    label: 'Asset class',
    type: 'select',
    options: [
      { label: 'Everything', value: 'all' },
      { label: 'Crypto only', value: 'crypto' },
      { label: 'Stocks only', value: 'stock' },
    ],
  },
  { key: 'showSparkline', label: 'Show 4h sparkline', type: 'switch' },
  { key: 'showNames', label: 'Show asset names', type: 'switch' },
];

function QuoteRow({
  quote,
  showSparkline,
  showNames,
  onRemove,
}: {
  quote: Quote;
  showSparkline: boolean;
  showNames: boolean;
  onRemove: (symbol: string) => void;
}) {
  const live = quote.source === 'live';
  const up = quote.changePercent >= 0;
  return (
    <li className="group/row flex items-center gap-2.5 rounded-lg px-1.5 py-1.5 transition hover:bg-slate-50 dark:hover:bg-slate-800/50">
      <div className="w-14 shrink-0">
        <p className="flex items-center gap-1 truncate text-xs font-bold tracking-wide text-slate-800 dark:text-slate-100">
          {quote.symbol}
          <span
            title={live ? 'Live quote' : 'Simulated locally'}
            className={cn(
              'h-1.5 w-1.5 shrink-0 rounded-full',
              live ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-slate-600',
            )}
          />
        </p>
        {showNames ? (
          <p className="truncate text-[10px] text-slate-400 dark:text-slate-500">{quote.name}</p>
        ) : (
          <p className="text-[10px] uppercase text-slate-400 dark:text-slate-500">{quote.kind}</p>
        )}
      </div>

      {showSparkline && quote.spark.length >= 2 ? (
        <Sparkline values={quote.spark} positive={up} className="h-7 min-w-0 flex-1" />
      ) : (
        // Free stock quotes carry no intraday history, so there is no line to
        // draw — an empty gap is more honest than a flat invented one.
        <div className="flex-1" />
      )}

      <div className="shrink-0 text-right">
        <p className="text-xs font-semibold tabular-nums text-slate-800 dark:text-slate-100">
          {formatCurrency(quote.price, quote.currency)}
        </p>
        {/* The change window differs by source, so it is named rather than
            assumed: live quotes report the session, crypto 24h. */}
        <DeltaPill
          percent={quote.changePercent}
          className="mt-0.5"
          title={quote.changeWindow === '24h' ? 'Change over 24 hours' : 'Change since previous close'}
        />
      </div>

      <button
        type="button"
        onClick={() => onRemove(quote.symbol)}
        aria-label={`Remove ${quote.symbol}`}
        title={`Remove ${quote.symbol}`}
        className={cn(
          'shrink-0 rounded-md p-1 text-slate-300 opacity-0 transition hover:bg-rose-50 hover:text-rose-500',
          'group-hover/row:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-400/60',
          'dark:text-slate-600 dark:hover:bg-rose-500/10',
        )}
      >
        <CloseIcon className="h-3.5 w-3.5" />
      </button>
    </li>
  );
}

/**
 * How often the widget re-renders so simulated rows keep moving. Live rows are
 * fetched on their own, much slower window (see `@/lib/market`).
 */
const TICK_MS = 5000;

/** Live crypto ticker (CoinGecko) alongside live stock quotes (Finnhub). */
export function MarketWidget({ config, updateConfig }: WidgetProps<MarketConfig>) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);
  const finnhubKey = usePrefsStore((state) => state.finnhubKey);

  useClickOutside(pickerRef, () => setPickerOpen(false), pickerOpen);

  const symbols = useMemo(() => parseSymbolList(config.symbols), [config.symbols]);
  // The ticker keeps simulated crypto drifting between the slower live windows.
  const now = useNow(TICK_MS);
  const { quotes, stockPrompt, pending } = useQuotes(symbols, finnhubKey, now.getTime());
  const visible = useMemo(
    () => (config.kind === 'all' ? quotes : quotes.filter((quote) => quote.kind === config.kind)),
    [quotes, config.kind],
  );

  const available = MARKET_SYMBOLS.filter((symbol) => !symbols.includes(symbol));
  const averageMove = visible.length === 0 ? 0 : visible.reduce((sum, quote) => sum + quote.changePercent, 0) / visible.length;

  // The status line reports what is actually priced, rather than implying the
  // whole watchlist is live: unpriced stocks are called out for the user to fix.
  const unpriced = stockPrompt?.symbols ?? [];
  const avgSuffix = visible.length > 0 ? ` · ${formatNumber(averageMove, 2)}% avg` : '';
  const status =
    unpriced.length > 0
      ? {
          tone: stockPrompt?.reason === 'failed' ? ('amber' as const) : ('sky' as const),
          label: stockPrompt?.reason === 'failed' ? 'Stocks unavailable' : 'Stocks need a key',
          title: stockPrompt?.message ?? 'Stock quotes need a Finnhub API key.',
        }
      : {
          tone: 'emerald' as const,
          label: 'Live',
          title: 'Crypto from CoinGecko, stocks from Finnhub',
        };

  const writeSymbols = (next: string[]) => updateConfig({ symbols: next.join(', ') });
  const addSymbol = (symbol: string) => {
    writeSymbols([...symbols, symbol]);
    setPickerOpen(false);
  };

  if (symbols.length === 0) {
    return (
      <EmptyState
        size="sm"
        icon={<MarketIcon className="h-4 w-4" />}
        title="No symbols tracked"
        description="Add a ticker such as BTC, ETH or NVDA. Crypto prices are live; stocks need a free Finnhub key."
        action={
          <div className="flex flex-wrap justify-center gap-1.5">
            {['BTC', 'ETH', 'NVDA', 'AAPL'].map((symbol) => (
              <button
                key={symbol}
                type="button"
                onClick={() => addSymbol(symbol)}
                className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-600 transition hover:bg-violet-100 hover:text-violet-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-violet-500/15 dark:hover:text-violet-300"
              >
                + {symbol}
              </button>
            ))}
          </div>
        }
      />
    );
  }

  return (
    <div className="flex h-full flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <Badge
          tone={status.tone}
          icon={<RefreshIcon className={cn('h-3 w-3', pending && 'animate-spin')} />}
          title={status.title}
        >
          {status.label}
          {avgSuffix}
        </Badge>
        <div className="relative" ref={pickerRef}>
          <button
            type="button"
            onClick={() => setPickerOpen((open) => !open)}
            aria-expanded={pickerOpen}
            aria-haspopup="listbox"
            className={cn(
              'inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-semibold transition',
              'text-slate-500 hover:bg-slate-100 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/60',
            )}
          >
            <PlusIcon className="h-3.5 w-3.5" /> Add
          </button>
          {pickerOpen && available.length > 0 ? (
            <div
              role="listbox"
              aria-label="Add symbol"
              className="absolute right-0 z-30 mt-1 max-h-52 w-40 animate-pop-in overflow-y-auto rounded-xl border border-slate-200 bg-white p-1 shadow-xl dark:border-slate-700 dark:bg-slate-900"
            >
              {available.map((symbol) => (
                <button
                  key={symbol}
                  type="button"
                  role="option"
                  aria-selected={false}
                  onClick={() => addSymbol(symbol)}
                  className="flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-left text-xs font-medium text-slate-600 transition hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white"
                >
                  {/* Same marker as the rows, so it is clear before adding
                      whether a symbol will show a live price. */}
                  <span
                    title={isLiveSymbol(symbol) ? 'Live from CoinGecko' : 'Simulated'}
                    className={cn(
                      'h-1.5 w-1.5 shrink-0 rounded-full',
                      isLiveSymbol(symbol) ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-slate-600',
                    )}
                  />
                  {symbol}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </div>

      <ul className="-mx-1 min-h-0 flex-1 space-y-0.5 overflow-y-auto">
        {visible.map((quote) => (
          <QuoteRow
            key={quote.symbol}
            quote={quote}
            showSparkline={config.showSparkline}
            showNames={config.showNames}
            onRemove={(symbol) => writeSymbols(symbols.filter((entry) => entry !== symbol))}
          />
        ))}

        {/* Stock symbols are listed but never priced with invented numbers, so
            they appear here with a route to making them work. */}
        {unpriced.map((symbol) => (
          <li
            key={symbol}
            className="flex items-center gap-2.5 rounded-lg border border-dashed border-slate-200 px-1.5 py-1.5 dark:border-slate-700"
          >
            <div className="w-14 shrink-0">
              <p className="truncate text-xs font-bold tracking-wide text-slate-500 dark:text-slate-400">
                {symbol}
              </p>
              <p className="text-[10px] uppercase text-slate-400 dark:text-slate-500">stock</p>
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[11px] text-slate-500 dark:text-slate-400">
                {stockPrompt?.reason === 'invalid-key'
                  ? 'API key rejected'
                  : stockPrompt?.reason === 'failed'
                    ? 'Could not reach the quote service'
                    : 'No live price yet'}
              </p>
              <p className="truncate text-[10px] text-slate-400 dark:text-slate-500">
                Free key: {FINNHUB_SIGNUP_URL.replace('https://', '')}
              </p>
            </div>
            <a
              href={FINNHUB_SIGNUP_URL}
              target="_blank"
              rel="noreferrer noopener"
              className="shrink-0 rounded-lg bg-violet-600 px-2 py-1 text-[10px] font-semibold text-white transition hover:bg-violet-700"
            >
              Sign up
            </a>
            <button
              type="button"
              onClick={() => writeSymbols(symbols.filter((entry) => entry !== symbol))}
              aria-label={`Remove ${symbol}`}
              title={`Remove ${symbol}`}
              className="shrink-0 rounded-md p-1 text-slate-300 transition hover:bg-rose-50 hover:text-rose-500 dark:text-slate-600 dark:hover:bg-rose-500/10"
            >
              <CloseIcon className="h-3.5 w-3.5" />
            </button>
          </li>
        ))}
      </ul>

      <p className="text-[10px] text-slate-400 dark:text-slate-500">
        {visible.length === 0 && unpriced.length > 0
          ? 'Stock quotes need a free Finnhub key — no stock prices are simulated.'
          : 'Crypto from CoinGecko; stocks from Finnhub with your own free key. Not investment data.'}
      </p>
    </div>
  );
}

export const marketWidget = defineWidget<MarketConfig>({
  type: 'market',
  name: 'Market ticker',
  summary: 'Live crypto quotes (CoinGecko) and live stocks (Finnhub, your own free key) with sparklines and per-symbol add/remove.',
  category: 'markets',
  keywords: ['crypto', 'stocks', 'ticker', 'prices', 'bitcoin', 'finance'],
  icon: MarketIcon,
  accent: 'emerald',
  badge: 'Live',
  defaultSize: { w: 6, h: 7, minW: 3, minH: 5 },
  defaultConfig: DEFAULT_MARKET_CONFIG,
  settings: SETTINGS,
  summarize: (config) => `${parseSymbolList(config.symbols).length} symbols`,
  component: MarketWidget,
});
