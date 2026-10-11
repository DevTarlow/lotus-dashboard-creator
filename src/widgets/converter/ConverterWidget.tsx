import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDownIcon, ArrowUpIcon, ConverterIcon } from '@/components/icons';
import {
  Badge,
  IconButton,
  Segmented,
  SelectInput,
  SourceBadge,
  TextInput,
  TONE_TEXT,
  type SegmentedOption,
} from '@/components/ui';
import { useDebouncedCallback } from '@/hooks/useDebouncedCallback';
import { useResource } from '@/hooks/useResource';
import { isCached } from '@/lib/http';
import {
  CURRENCIES_KEY,
  CURRENCY_LIST_TTL_MS,
  CURRENCY_REFRESH_MS,
  SERIES_DAYS,
  convertCurrency,
  currencyFallbackOptions,
  currencyOptions,
  fetchCurrencies,
  fetchLatest,
  fetchSeries,
  formatMoney,
  latestKey,
  normalizeCurrencyPair,
  seriesKey,
  type CurrencyRates,
  type CurrencySeries,
} from '@/lib/currency';
import {
  PRECISION_CHOICES,
  convertUnits,
  defaultUnitPair,
  formatPreview,
  normalizeAmount,
  normalizePrecision,
  normalizeUnitCategory,
  parseAmount,
  unitOptions,
  unitPairMessage,
  unitPairProblem,
  type ConverterMode,
} from '@/lib/converter';
import { UNIT_CATEGORIES, formatUnitValue, type UnitCategoryId } from '@/lib/units';
import { asBoolean, asString, cn } from '@/lib/utils';
import type { SettingField, WidgetProps } from '@/types';
import { defineWidget } from '@/widgets/define';
import { Sparkline } from '@/widgets/shared';

export type ConverterConfig = {
  mode: 'units' | 'currency';
  /** Units mode. */
  category: UnitCategoryId;
  fromUnit: string;
  toUnit: string;
  amount: number;
  /** `null` is automatic. The settings select writes `'auto'` or `'4'` instead. */
  precision: number | null;
  /** Currency mode. */
  base: string;
  quote: string;
  currencyAmount: number;
  /** Show the 30-day rate sparkline. */
  showSeries: boolean;
};

const DEFAULT_CONVERTER_CONFIG: ConverterConfig = {
  mode: 'units',
  category: 'length',
  fromUnit: 'kilometre',
  toUnit: 'mile',
  amount: 1,
  precision: null,
  base: 'USD',
  quote: 'EUR',
  currencyAmount: 1,
  showSeries: true,
};

const MODE_OPTIONS: readonly SegmentedOption<ConverterMode>[] = [
  { value: 'units', label: 'Units' },
  { value: 'currency', label: 'Currency', title: 'Currencies, at the ECB reference rate' },
];

/**
 * The settings schema has no "optional number" field — its number control turns
 * an empty box into its minimum — so automatic precision is an explicit choice
 * here rather than an empty one (see {@link normalizePrecision}).
 */
const PRECISION_OPTIONS = [
  { label: 'Automatic', value: 'auto' },
  ...PRECISION_CHOICES.map((digits) => ({
    label: `${digits} decimal${digits === 1 ? '' : 's'}`,
    value: String(digits),
  })),
];

const SETTINGS: readonly SettingField[] = [
  {
    key: 'mode',
    label: 'What to convert',
    type: 'select',
    options: [
      { label: 'Units', value: 'units' },
      { label: 'Currency', value: 'currency' },
    ],
  },
  {
    key: 'category',
    label: 'Unit category',
    type: 'select',
    help: 'Units mode only. Changing it moves both unit pickers to that category.',
    options: UNIT_CATEGORIES.map((category) => ({ label: category.label, value: category.id })),
  },
  {
    key: 'precision',
    label: 'Result precision',
    type: 'select',
    help: 'Units mode only. Automatic keeps a conversion readable at any magnitude.',
    options: PRECISION_OPTIONS,
  },
  {
    key: 'showSeries',
    label: 'Show the 30-day rate history',
    type: 'switch',
    help: 'Currency mode only.',
  },
];

/** The swap button names what it swaps; every mode has its own wording. */
const SWAP_LABEL: Record<ConverterMode, string> = {
  units: 'Swap the two units',
  currency: 'Swap the two currencies',
};

/** ⇄ — the icon set has no swap glyph, so two arrows make one. */
function SwapGlyph({ className }: { className?: string }) {
  return (
    <span className={cn('inline-flex items-center justify-center', className)} aria-hidden="true">
      <ArrowUpIcon className="h-3 w-3 -rotate-90" />
      <ArrowDownIcon className="-ml-1.5 h-3 w-3 rotate-90" />
    </span>
  );
}

/** One select option; the unit and currency pickers agree on the shape. */
type PickerOption = { label: string; value: string };

/**
 * `from ⇄ to`, stacked in a narrow widget and side by side in a wide one.
 *
 * Both halves use the same row, so the two modes cannot drift apart visually.
 */
function PairRow({
  fromLabel,
  toLabel,
  swapLabel,
  fromValue,
  toValue,
  fromOptions,
  toOptions,
  disabled,
  onFrom,
  onTo,
  onSwap,
}: {
  fromLabel: string;
  toLabel: string;
  swapLabel: string;
  fromValue: string;
  toValue: string;
  fromOptions: readonly PickerOption[];
  toOptions: readonly PickerOption[];
  disabled?: boolean;
  onFrom: (value: string) => void;
  onTo: (value: string) => void;
  onSwap: () => void;
}) {
  return (
    <div className={cn('grid gap-1.5', '@[18rem]:grid-cols-[1fr_auto_1fr] @[18rem]:items-center')}>
      <SelectInput
        aria-label={fromLabel}
        options={fromOptions}
        value={fromValue}
        disabled={disabled}
        onChange={(event) => onFrom(event.target.value)}
      />
      <IconButton
        label={swapLabel}
        size="icon-sm"
        className="justify-self-end"
        icon={<SwapGlyph className="h-3.5 w-3.5" />}
        onClick={onSwap}
      />
      <SelectInput
        aria-label={toLabel}
        options={toOptions}
        value={toValue}
        disabled={disabled}
        onChange={(event) => onTo(event.target.value)}
      />
    </div>
  );
}

/**
 * Unit conversion and ECB currency conversion.
 *
 * The two halves are deliberately different animals: the unit table is built in
 * and works offline, while the currency half needs the network and is honest
 * about how modest that source is — daily reference rates, working days only,
 * never a trading price, and never a substitute figure when there is no rate.
 */
export function ConverterWidget({ config, updateConfig }: WidgetProps<ConverterConfig>) {
  const mode: ConverterMode = config.mode === 'currency' ? 'currency' : 'units';
  const category = useMemo(() => normalizeUnitCategory(config.category), [config.category]);
  const precision = useMemo(() => normalizePrecision(config.precision), [config.precision]);
  const showSeries = asBoolean(config.showSeries, DEFAULT_CONVERTER_CONFIG.showSeries);

  const fromUnit = asString(config.fromUnit, DEFAULT_CONVERTER_CONFIG.fromUnit);
  const toUnit = asString(config.toUnit, DEFAULT_CONVERTER_CONFIG.toUnit);
  const storedBase = asString(config.base, DEFAULT_CONVERTER_CONFIG.base);
  const storedQuote = asString(config.quote, DEFAULT_CONVERTER_CONFIG.quote);
  const storedUnitsAmount = normalizeAmount(config.amount, 1);
  const storedCurrencyAmount = normalizeAmount(config.currencyAmount, 1);
  const storedAmount = mode === 'units' ? storedUnitsAmount : storedCurrencyAmount;

  /**
   * The amount field is edited locally and committed after a pause: writing the
   * config on every keystroke would flood `localStorage` and the undo stack, and
   * a number input has states ("", "1.") that are not numbers yet.
   *
   * The local copy lives only while the field has focus, so the box always ends
   * up showing the number the widget actually converted — including after an
   * undo, an import or a reset, which arrive as plain config changes.
   */
  const [draft, setDraft] = useState<{ mode: ConverterMode; text: string } | null>(null);
  const amountText = draft?.mode === mode ? draft.text : String(storedAmount);
  const typedAmount = parseAmount(amountText);

  const commitAmount = useDebouncedCallback((target: ConverterMode, text: string) => {
    const value = parseAmount(text);
    // An empty field means "no value yet", not zero: the last stored amount
    // stays until the user types a real number.
    if (value === null) return;
    updateConfig(target === 'units' ? { amount: value } : { currencyAmount: value });
  }, 400);

  /**
   * Follow a category change from the settings form with a convertible pair. The
   * guard makes this a one-off repair on a real change — never a mount-time
   * rewrite of a config the user may have imported on purpose.
   */
  const categoryRef = useRef(category);
  useEffect(() => {
    if (categoryRef.current === category) return;
    categoryRef.current = category;
    updateConfig({ category, ...defaultUnitPair(category) });
  }, [category, updateConfig]);

  /* ------------------------------------------------------------- units half */

  const fromOptions = useMemo(() => unitOptions(category, [fromUnit]), [category, fromUnit]);
  const toOptions = useMemo(() => unitOptions(category, [toUnit]), [category, toUnit]);
  const problem = unitPairProblem(fromUnit, toUnit);
  const conversion = typedAmount === null ? null : convertUnits(typedAmount, fromUnit, toUnit, precision);

  const unitHint =
    typedAmount === null
      ? 'Enter an amount to convert.'
      : problem !== null
        ? unitPairMessage(problem)
        : null;

  /* ---------------------------------------------------------- currency half */

  /**
   * Every loader reports which cache it was served from. `isCached` has to be
   * read *before* the request, because the request is what fills the cache.
   */
  const currencies = useResource<Record<string, string>>({
    key: CURRENCIES_KEY,
    load: async (signal) => {
      const fromCache = isCached(CURRENCIES_KEY, CURRENCY_LIST_TTL_MS);
      return { data: await fetchCurrencies(signal), fromCache };
    },
    refreshMs: CURRENCY_LIST_TTL_MS,
    enabled: mode === 'currency',
  });

  const names = currencies.data;
  const codes = useMemo(() => (names ? Object.keys(names) : []), [names]);
  const storedPair = useMemo(
    () => normalizeCurrencyPair(storedBase, storedQuote, []),
    [storedBase, storedQuote],
  );
  const pair = useMemo(
    () => normalizeCurrencyPair(storedBase, storedQuote, codes),
    [storedBase, storedQuote, codes],
  );
  const identity = pair.base === pair.quote;

  /**
   * Once the list is known, replace a stored code the ECB does not publish with
   * the pair the widget is actually showing. The subtitle and an export both
   * read the config, so a code left behind that can never be converted would make
   * them name a different pair from the one on screen.
   */
  useEffect(() => {
    if (codes.length === 0) return;
    if (pair.base === storedPair.base && pair.quote === storedPair.quote) return;
    updateConfig({ base: pair.base, quote: pair.quote });
  }, [codes.length, pair.base, pair.quote, storedPair.base, storedPair.quote, updateConfig]);

  const currencyChoices = useMemo(
    () =>
      names && codes.length > 0 ? currencyOptions(names) : currencyFallbackOptions([pair.base, pair.quote]),
    [names, codes, pair.base, pair.quote],
  );
  const pickersDisabled = currencies.pending && codes.length === 0;

  const rateKey = latestKey(pair.base, [pair.quote]);
  const rate = useResource<CurrencyRates>({
    key: rateKey,
    load: async (signal) => {
      const fromCache = isCached(rateKey, CURRENCY_REFRESH_MS);
      return { data: await fetchLatest(pair.base, [pair.quote], signal), fromCache };
    },
    refreshMs: CURRENCY_REFRESH_MS,
    // Same currency: exactly 1 by definition, so nothing is requested at all.
    enabled: mode === 'currency' && !identity,
  });

  // A daily history changes at most once a working day, so it shares the currency
  // list's day-long window rather than the rate's quarter hour.
  const historyKey = seriesKey(pair.base, pair.quote, SERIES_DAYS);
  const history = useResource<CurrencySeries>({
    key: historyKey,
    load: async (signal) => {
      const fromCache = isCached(historyKey, CURRENCY_LIST_TTL_MS);
      return { data: await fetchSeries(pair.base, pair.quote, SERIES_DAYS, signal), fromCache };
    },
    refreshMs: CURRENCY_LIST_TTL_MS,
    enabled: mode === 'currency' && showSeries && !identity,
  });

  const seriesPoints = useMemo(() => history.data?.points ?? [], [history.data]);
  const seriesValues = useMemo(() => seriesPoints.map((point) => point.rate), [seriesPoints]);
  const seriesRising =
    seriesValues.length < 2 || seriesValues[seriesValues.length - 1] >= seriesValues[0];

  const publishedRate = useMemo(() => {
    const value = identity ? 1 : rate.data?.rates[pair.quote];
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  }, [identity, rate.data, pair.quote]);

  const money =
    typedAmount === null || publishedRate === null ? null : convertCurrency(typedAmount, publishedRate);

  const currencyHint =
    typedAmount === null
      ? 'Enter an amount to convert.'
      : identity
        ? `Both sides are ${pair.base} — the rate is exactly 1, so no rate is fetched.`
        : publishedRate === null
          ? (rate.error ?? 'Waiting for the ECB reference rate…')
          : null;

  const sourceLine = rate.data
    ? `ECB reference rate · ${rate.data.date} · working days only — not a trading rate`
    : 'ECB reference rate · working days only — not a trading rate';
  const staleNote = rate.error && rate.data ? ' · showing the last published rate' : '';

  const swap = () => {
    if (mode === 'units') updateConfig({ fromUnit: toUnit, toUnit: fromUnit });
    else updateConfig({ base: pair.quote, quote: pair.base });
  };

  const resultText =
    mode === 'units' ? (conversion?.text ?? '—') : money === null ? '—' : formatMoney(money, pair.quote);
  const resultSuffix = mode === 'units' ? (conversion?.toSymbol ?? '') : '';
  const hint = mode === 'units' ? unitHint : currencyHint;

  return (
    <div className="@container flex h-full flex-col gap-2">
      <Segmented
        label="Conversion mode"
        value={mode}
        onChange={(next) => updateConfig({ mode: next })}
        options={MODE_OPTIONS}
      />

      <TextInput
        label={mode === 'units' ? 'Amount' : 'Amount to convert'}
        type="number"
        inputMode="decimal"
        // Decimals are the point of the field, so the browser must not flag every
        // one of them as an invalid step.
        step="any"
        value={amountText}
        className="tabular-nums"
        onChange={(event) => {
          setDraft({ mode, text: event.target.value });
          commitAmount.run(mode, event.target.value);
        }}
        onBlur={() => {
          // Persist what is on screen, then hand the field back to the stored
          // value so the two can never disagree.
          commitAmount.flush();
          setDraft(null);
        }}
      />

      {mode === 'units' ? (
        <PairRow
          fromLabel="Convert from"
          toLabel="Convert to"
          swapLabel={SWAP_LABEL.units}
          fromValue={fromUnit}
          toValue={toUnit}
          fromOptions={fromOptions}
          toOptions={toOptions}
          onFrom={(value) => updateConfig({ fromUnit: value })}
          onTo={(value) => updateConfig({ toUnit: value })}
          onSwap={swap}
        />
      ) : (
        <PairRow
          fromLabel="Base currency"
          toLabel="Quote currency"
          swapLabel={SWAP_LABEL.currency}
          fromValue={pair.base}
          toValue={pair.quote}
          fromOptions={currencyChoices}
          toOptions={currencyChoices}
          disabled={pickersDisabled}
          onFrom={(value) => updateConfig({ base: value })}
          onTo={(value) => updateConfig({ quote: value })}
          onSwap={swap}
        />
      )}

      {/* The currency list can fail on its own: the pickers then keep the stored
          codes, and the failure is named rather than papered over. */}
      {mode === 'currency' && currencies.error ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <SourceBadge
            input={{
              error: currencies.error,
              errorCode: currencies.errorCode,
              status: currencies.errorStatus,
            }}
          />
          <span className="text-[10px] leading-tight text-slate-500 dark:text-slate-400">
            Currency list unavailable — the pickers keep the codes stored in this widget.
          </span>
        </div>
      ) : null}

      <div className="rounded-xl bg-slate-50 px-2.5 py-2 dark:bg-slate-800/60">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
          Result
        </p>
        <p className="flex items-baseline gap-1.5">
          <span className={cn('truncate text-2xl font-semibold leading-tight tabular-nums', TONE_TEXT.violet)}>
            {resultText}
          </span>
          {resultSuffix ? (
            <span className="shrink-0 text-xs font-medium text-slate-400 dark:text-slate-500">
              {resultSuffix}
            </span>
          ) : null}
        </p>
        {hint ? <p className="mt-0.5 text-[10px] leading-tight text-slate-500 dark:text-slate-400">{hint}</p> : null}
      </div>

      {mode === 'currency' && showSeries && !identity ? (
        <div className="min-w-0">
          {seriesValues.length >= 2 ? (
            <>
              <Sparkline values={seriesValues} positive={seriesRising} className="h-8" />
              <div className="flex justify-between text-[10px] text-slate-400 dark:text-slate-500">
                <span>{seriesPoints[0]?.date}</span>
                <span>{seriesPoints[seriesPoints.length - 1]?.date}</span>
              </div>
            </>
          ) : history.error ? (
            <p className="text-[10px] leading-tight text-amber-600 dark:text-amber-400">
              30-day history unavailable — {history.error}
            </p>
          ) : (
            <p className="text-[10px] leading-tight text-slate-400 dark:text-slate-500">
              Loading the 30-day history…
            </p>
          )}
        </div>
      ) : null}

      <div className="mt-auto flex flex-col gap-1">
        {mode === 'units' ? (
          <p className="text-[10px] leading-tight text-slate-400 dark:text-slate-500">
            Built-in unit table — this half makes no network request.
          </p>
        ) : (
          <>
            {identity ? (
              <Badge
                tone="slate"
                className="self-start"
                title="Both sides are the same currency, so there is nothing to fetch."
              >
                Same currency
              </Badge>
            ) : (
              <SourceBadge
                className="self-start"
                input={{
                  pending: rate.pending,
                  error: rate.error,
                  errorCode: rate.errorCode,
                  status: rate.errorStatus,
                  fromCache: rate.fromCache,
                }}
              />
            )}
            <p
              className="text-[10px] leading-tight text-slate-400 dark:text-slate-500"
              title={`${sourceLine}${staleNote}`}
            >
              {sourceLine}
              {staleNote}
            </p>
          </>
        )}
      </div>
    </div>
  );
}

export const converterWidget = defineWidget<ConverterConfig>({
  type: 'converter',
  name: 'Converter',
  summary: 'Convert units, or currencies at the ECB reference rate.',
  category: 'utilities',
  keywords: ['convert', 'unit', 'currency', 'exchange', 'rate', 'metric', 'imperial', 'temperature'],
  icon: ConverterIcon,
  accent: 'violet',
  badge: 'Live',
  defaultSize: { w: 3, h: 6, minW: 2, minH: 5 },
  defaultConfig: DEFAULT_CONVERTER_CONFIG,
  settings: SETTINGS,
  summarize: (config) => {
    if (config.mode === 'currency') {
      // No currency list is available to a subtitle, and an empty supported list
      // means "leave the stored codes alone" — which is exactly right here.
      const pair = normalizeCurrencyPair(asString(config.base), asString(config.quote), []);
      return `${pair.base} → ${pair.quote} (ECB)`;
    }
    const amount = normalizeAmount(config.amount, 1);
    const precision = normalizePrecision(config.precision);
    const conversion = convertUnits(
      amount,
      asString(config.fromUnit, DEFAULT_CONVERTER_CONFIG.fromUnit),
      asString(config.toUnit, DEFAULT_CONVERTER_CONFIG.toUnit),
      precision,
    );
    if (!conversion) return 'Convert between units';
    // Static, and a short preview of what the body shows: a ticking subtitle
    // would re-render the whole frame to say the same thing.
    return `${formatUnitValue(amount)} ${conversion.fromSymbol} → ${formatPreview(conversion.value, precision)} ${conversion.toSymbol}`;
  },
  component: ConverterWidget,
});
