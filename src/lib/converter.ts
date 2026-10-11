/**
 * The pure half of the Converter widget.
 *
 * `@/lib/units` owns the catalogue and the affine conversion rule, and
 * `@/lib/currency` owns the ECB provider; what is left is the small amount of
 * thinking that belongs to neither: reading a number the user typed, reading a
 * number a hand-edited config holds, deciding whether a stored pair is
 * convertible at all and explaining it when it is not.
 *
 * Everything here is pure — no React, no DOM, no clock — so the widget stays a
 * thin renderer and the awkward cases (an empty amount field, a config whose
 * units come from two different categories) are unit tested.
 */
import {
  UNIT_CATEGORIES,
  convert,
  findUnit,
  formatUnitValue,
  unitsForCategory,
  type UnitCategoryId,
} from '@/lib/units';
import { asNumber, clamp } from '@/lib/utils';

/** The widget's two halves. */
export type ConverterMode = 'units' | 'currency';

/** Category used when a stored one is missing or names something unknown. */
export const DEFAULT_UNIT_CATEGORY: UnitCategoryId = 'length';

/** Widest precision a conversion can be shown with. */
export const MAX_PRECISION = 8;

/** Significant digits a one-line preview keeps (the widget subtitle). */
const PREVIEW_DIGITS = 3;
/** Below this the preview would round to zero, so the full format is used. */
const PREVIEW_MAX_FRACTIONS = 6;

/**
 * The precision choices the settings form offers.
 *
 * The schema has no "optional number" field — its `number` control coerces an
 * empty box to its minimum — so precision is a select and "automatic" is an
 * explicit choice rather than an empty one. The gaps at 5 and 7 are deliberate:
 * nobody converts to seven decimals, and a shorter list is easier to scan.
 */
export const PRECISION_CHOICES: readonly number[] = [0, 1, 2, 3, 4, 6, 8];

/** Why a pair of stored unit ids cannot be converted. */
export type UnitPairProblem = 'unknown-from' | 'unknown-to' | 'mismatch';

/** A picker entry for one unit. */
export interface UnitOption {
  value: string;
  label: string;
}

/** A conversion the widget can render. */
export interface UnitConversion {
  /** Converted magnitude. */
  value: number;
  /** Formatted with the configured precision, or the automatic one. */
  text: string;
  /** Compact symbol of the source unit, e.g. `km`. */
  fromSymbol: string;
  /** Compact symbol of the target unit, e.g. `mi`. */
  toSymbol: string;
}

/**
 * Read the amount the user typed.
 *
 * An empty or unparsable field is `null` — "no value yet" — rather than 0, so the
 * widget can show a dash and a hint instead of converting nothing into nothing.
 */
export function parseAmount(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed === '') return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Read a stored amount, tolerating the strings an imported config may hold. */
export function normalizeAmount(value: unknown, fallback = 1): number {
  return asNumber(value, fallback);
}

/**
 * Read a stored precision: `null` means automatic.
 *
 * The settings form's select writes strings (`'auto'`, `'4'`), a hand-edited
 * config may hold a number, and an import may hold anything at all, so all three
 * shapes land on the documented `0…8 | null` contract.
 */
export function normalizePrecision(value: unknown): number | null {
  if (value === null || value === undefined || value === '' || value === 'auto') return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return null;
  return clamp(Math.trunc(parsed), 0, MAX_PRECISION);
}

/** Read a stored category, falling back to {@link DEFAULT_UNIT_CATEGORY}. */
export function normalizeUnitCategory(value: unknown): UnitCategoryId {
  const wanted = typeof value === 'string' ? value : '';
  for (const category of UNIT_CATEGORIES) {
    if (category.id === wanted) return category.id;
  }
  return DEFAULT_UNIT_CATEGORY;
}

/**
 * A sensible pair for a category: its base unit against the next one.
 *
 * Used when the category changes, so the two pickers follow it instead of being
 * left pointing at units from the previous category.
 */
export function defaultUnitPair(category: UnitCategoryId): { fromUnit: string; toUnit: string } {
  const units = unitsForCategory(category);
  const fromUnit = units[0]?.id ?? '';
  return { fromUnit, toUnit: units[1]?.id ?? fromUnit };
}

/**
 * Convert and format in one step, or `null` when the pair cannot be converted.
 *
 * Returning `null` rather than a number is the point: an unknown unit id or a
 * cross-category pair (both reachable through a hand-edited config) must reach
 * the screen as a dash with an explanation, never as a wrong figure.
 */
export function convertUnits(
  amount: number,
  fromUnit: string,
  toUnit: string,
  precision: number | null,
): UnitConversion | null {
  const from = findUnit(fromUnit);
  const to = findUnit(toUnit);
  if (!from || !to) return null;
  const value = convert(amount, fromUnit, toUnit);
  if (value === null) return null;
  return {
    value,
    text: formatUnitValue(value, precision ?? undefined),
    fromSymbol: from.unit.symbol,
    toSymbol: to.unit.symbol,
  };
}

/**
 * A short, honest preview of a converted value — the widget's subtitle.
 *
 * `formatUnitValue` without a precision is exact enough for the body but long
 * for one line ("0.6213711922"), and a fixed two decimals would print `0.00` for
 * a genuinely tiny result. So the preview keeps about three significant digits
 * when that can be done briefly, and otherwise falls back to the full format
 * rather than rounding a real value away. A configured precision wins outright:
 * the subtitle then says exactly what the body says.
 */
export function formatPreview(value: number, precision: number | null = null): string {
  if (precision !== null) return formatUnitValue(value, precision);
  if (!Number.isFinite(value) || value === 0) return formatUnitValue(value);
  const exponent = Math.floor(Math.log10(Math.abs(value)));
  const wanted = PREVIEW_DIGITS - 1 - exponent;
  if (wanted > PREVIEW_MAX_FRACTIONS) return formatUnitValue(value);
  // `formatUnitValue` pins the digits it is given, so drop the ones that carry
  // no information: `32` should not read as `32.0`.
  let digits = clamp(wanted, 0, PREVIEW_MAX_FRACTIONS);
  while (digits > 0 && Number(value.toFixed(digits)) === Number(value.toFixed(digits - 1))) digits -= 1;
  return formatUnitValue(value, digits);
}

/** What is wrong with a stored pair, or `null` when it is convertible. */
export function unitPairProblem(fromUnit: string, toUnit: string): UnitPairProblem | null {
  const from = findUnit(fromUnit);
  const to = findUnit(toUnit);
  if (!from) return 'unknown-from';
  if (!to) return 'unknown-to';
  if (from.category.id !== to.category.id) return 'mismatch';
  return null;
}

/** The problem in the widget's own words. */
export function unitPairMessage(problem: UnitPairProblem): string {
  switch (problem) {
    case 'unknown-from':
      return 'The “from” unit is not one this widget knows.';
    case 'unknown-to':
      return 'The “to” unit is not one this widget knows.';
    case 'mismatch':
      return 'These two units measure different things. Pick both from the same category.';
  }
}

/**
 * Picker options for one category, plus any stored id that is not in it.
 *
 * A stored unit that the category does not contain is appended rather than
 * dropped: a `<select>` whose value matches no option renders blank, which would
 * hide the real reason the result is a dash. The label says which case it is.
 */
export function unitOptions(category: UnitCategoryId, stored: readonly string[] = []): UnitOption[] {
  const options: UnitOption[] = unitsForCategory(category).map((unit) => ({
    value: unit.id,
    label: `${unit.label} (${unit.symbol})`,
  }));
  const known = new Set(options.map((option) => option.value));
  const categoryLabel = UNIT_CATEGORIES.find((entry) => entry.id === category)?.label ?? category;

  for (const id of stored) {
    if (id === '' || known.has(id)) continue;
    known.add(id);
    const found = findUnit(id);
    options.push({
      value: id,
      label: found ? `${found.unit.label} (not in ${categoryLabel})` : `${id} (unknown unit)`,
    });
  }
  return options;
}
