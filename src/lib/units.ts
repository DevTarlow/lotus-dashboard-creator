/**
 * Unit conversion and number formatting.
 *
 * One catalogue plus one affine rule — `base = (value - offset) * factor`, and
 * back again — so widgets, config validation and tests all read the same table.
 * Everything here is pure: no React, no DOM, no clock, no dependencies. Unit ids
 * are stable, and meant to be persisted in widget config.
 */
import { clamp } from './utils';

export type UnitCategoryId =
  | 'length'
  | 'mass'
  | 'temperature'
  | 'area'
  | 'volume'
  | 'speed'
  | 'data'
  | 'time'
  | 'energy'
  | 'pressure'
  | 'angle';

export interface UnitDef {
  /** Stable id stored in widget config, e.g. `km`, `fahrenheit`, `gibibyte`. */
  id: string;
  /** Display label, e.g. "Kilometre". */
  label: string;
  /** Compact suffix shown next to a number, e.g. `km`, `°F`. */
  symbol: string;
  /** Multiplier into the category's base unit. */
  factor: number;
  /** Additive offset into the base unit, used by temperature scales. */
  offset?: number;
}

export interface UnitCategoryDef {
  id: UnitCategoryId;
  label: string;
  /** `UnitDef.id` of the category's base unit. */
  baseUnit: string;
  units: readonly UnitDef[];
}

/**
 * The catalogue — one line of metadata per category, one line per unit. Every
 * `baseUnit` is one of that category's own units, and ids are unique across the
 * whole table, which is what {@link isKnownUnit} and {@link findUnit} rely on.
 */
export const UNIT_CATEGORIES: readonly UnitCategoryDef[] = [
  { id: 'length', label: 'Length', baseUnit: 'metre', units: [
    { id: 'metre', label: 'Metre', symbol: 'm', factor: 1 },
    { id: 'kilometre', label: 'Kilometre', symbol: 'km', factor: 1000 },
    { id: 'centimetre', label: 'Centimetre', symbol: 'cm', factor: 0.01 },
    { id: 'millimetre', label: 'Millimetre', symbol: 'mm', factor: 0.001 },
    { id: 'mile', label: 'Mile', symbol: 'mi', factor: 1609.344 },
    { id: 'yard', label: 'Yard', symbol: 'yd', factor: 0.9144 },
    { id: 'foot', label: 'Foot', symbol: 'ft', factor: 0.3048 },
    { id: 'inch', label: 'Inch', symbol: 'in', factor: 0.0254 },
    { id: 'nautical-mile', label: 'Nautical mile', symbol: 'nmi', factor: 1852 },
  ] },
  { id: 'mass', label: 'Mass', baseUnit: 'kilogram', units: [
    { id: 'kilogram', label: 'Kilogram', symbol: 'kg', factor: 1 },
    { id: 'gram', label: 'Gram', symbol: 'g', factor: 0.001 },
    { id: 'milligram', label: 'Milligram', symbol: 'mg', factor: 0.000001 },
    { id: 'tonne', label: 'Tonne', symbol: 't', factor: 1000 },
    { id: 'pound', label: 'Pound', symbol: 'lb', factor: 0.45359237 },
    { id: 'ounce', label: 'Ounce', symbol: 'oz', factor: 0.028349523125 },
    { id: 'stone', label: 'Stone', symbol: 'st', factor: 6.35029318 },
  ] },
  { id: 'temperature', label: 'Temperature', baseUnit: 'celsius', units: [
    { id: 'celsius', label: 'Celsius', symbol: '°C', factor: 1, offset: 0 },
    { id: 'fahrenheit', label: 'Fahrenheit', symbol: '°F', factor: 5 / 9, offset: 32 },
    { id: 'kelvin', label: 'Kelvin', symbol: 'K', factor: 1, offset: 273.15 },
  ] },
  { id: 'area', label: 'Area', baseUnit: 'square-metre', units: [
    { id: 'square-metre', label: 'Square metre', symbol: 'm²', factor: 1 },
    { id: 'square-kilometre', label: 'Square kilometre', symbol: 'km²', factor: 1000000 },
    { id: 'square-foot', label: 'Square foot', symbol: 'ft²', factor: 0.09290304 },
    { id: 'square-mile', label: 'Square mile', symbol: 'mi²', factor: 2589988.110336 },
    { id: 'hectare', label: 'Hectare', symbol: 'ha', factor: 10000 },
    { id: 'acre', label: 'Acre', symbol: 'ac', factor: 4046.8564224 },
  ] },
  { id: 'volume', label: 'Volume', baseUnit: 'litre', units: [
    { id: 'litre', label: 'Litre', symbol: 'L', factor: 1 },
    { id: 'millilitre', label: 'Millilitre', symbol: 'mL', factor: 0.001 },
    { id: 'cubic-metre', label: 'Cubic metre', symbol: 'm³', factor: 1000 },
    { id: 'us-gallon', label: 'US gallon', symbol: 'gal (US)', factor: 3.785411784 },
    { id: 'us-quart', label: 'US quart', symbol: 'qt', factor: 0.946352946 },
    { id: 'us-pint', label: 'US pint', symbol: 'pt', factor: 0.473176473 },
    { id: 'us-cup', label: 'US cup', symbol: 'cup', factor: 0.2365882365 },
    { id: 'us-fluid-ounce', label: 'US fluid ounce', symbol: 'fl oz', factor: 0.0295735295625 },
    { id: 'imperial-gallon', label: 'Imperial gallon', symbol: 'gal (imp)', factor: 4.54609 },
  ] },
  { id: 'speed', label: 'Speed', baseUnit: 'metre-per-second', units: [
    { id: 'metre-per-second', label: 'Metre per second', symbol: 'm/s', factor: 1 },
    { id: 'kilometre-per-hour', label: 'Kilometre per hour', symbol: 'km/h', factor: 1 / 3.6 },
    { id: 'mile-per-hour', label: 'Mile per hour', symbol: 'mph', factor: 0.44704 },
    { id: 'knot', label: 'Knot', symbol: 'kn', factor: 1852 / 3600 },
    { id: 'foot-per-second', label: 'Foot per second', symbol: 'ft/s', factor: 0.3048 },
  ] },
  { id: 'data', label: 'Data', baseUnit: 'byte', units: [
    { id: 'byte', label: 'Byte', symbol: 'B', factor: 1 },
    { id: 'kilobyte', label: 'Kilobyte', symbol: 'kB', factor: 1000 },
    { id: 'kibibyte', label: 'Kibibyte', symbol: 'KiB', factor: 1024 },
    { id: 'megabyte', label: 'Megabyte', symbol: 'MB', factor: 1000000 },
    { id: 'mebibyte', label: 'Mebibyte', symbol: 'MiB', factor: 1048576 },
    { id: 'gigabyte', label: 'Gigabyte', symbol: 'GB', factor: 1000000000 },
    { id: 'gibibyte', label: 'Gibibyte', symbol: 'GiB', factor: 1073741824 },
    { id: 'terabyte', label: 'Terabyte', symbol: 'TB', factor: 1000000000000 },
    { id: 'tebibyte', label: 'Tebibyte', symbol: 'TiB', factor: 1099511627776 },
  ] },
  { id: 'time', label: 'Time', baseUnit: 'second', units: [
    { id: 'second', label: 'Second', symbol: 's', factor: 1 },
    { id: 'minute', label: 'Minute', symbol: 'min', factor: 60 },
    { id: 'hour', label: 'Hour', symbol: 'h', factor: 3600 },
    { id: 'day', label: 'Day', symbol: 'd', factor: 86400 },
    { id: 'week', label: 'Week', symbol: 'wk', factor: 604800 },
  ] },
  { id: 'energy', label: 'Energy', baseUnit: 'joule', units: [
    { id: 'joule', label: 'Joule', symbol: 'J', factor: 1 },
    { id: 'kilojoule', label: 'Kilojoule', symbol: 'kJ', factor: 1000 },
    { id: 'calorie', label: 'Calorie', symbol: 'cal', factor: 4.184 },
    { id: 'kilocalorie', label: 'Kilocalorie', symbol: 'kcal', factor: 4184 },
    { id: 'watt-hour', label: 'Watt hour', symbol: 'Wh', factor: 3600 },
    { id: 'kilowatt-hour', label: 'Kilowatt hour', symbol: 'kWh', factor: 3600000 },
    { id: 'btu', label: 'British thermal unit', symbol: 'BTU', factor: 1055.05585262 },
  ] },
  { id: 'pressure', label: 'Pressure', baseUnit: 'pascal', units: [
    { id: 'pascal', label: 'Pascal', symbol: 'Pa', factor: 1 },
    { id: 'hectopascal', label: 'Hectopascal', symbol: 'hPa', factor: 100 },
    { id: 'kilopascal', label: 'Kilopascal', symbol: 'kPa', factor: 1000 },
    { id: 'bar', label: 'Bar', symbol: 'bar', factor: 100000 },
    { id: 'millibar', label: 'Millibar', symbol: 'mbar', factor: 100 },
    { id: 'atmosphere', label: 'Atmosphere', symbol: 'atm', factor: 101325 },
    { id: 'psi', label: 'Pound per square inch', symbol: 'psi', factor: 6894.757293168361 },
    { id: 'mmhg', label: 'Millimetre of mercury', symbol: 'mmHg', factor: 133.322387415 },
  ] },
  { id: 'angle', label: 'Angle', baseUnit: 'degree', units: [
    { id: 'degree', label: 'Degree', symbol: '°', factor: 1 },
    { id: 'radian', label: 'Radian', symbol: 'rad', factor: 180 / Math.PI },
    { id: 'gradian', label: 'Gradian', symbol: 'grad', factor: 0.9 },
    { id: 'turn', label: 'Turn', symbol: 'turn', factor: 360 },
    { id: 'arcminute', label: 'Arcminute', symbol: '′', factor: 1 / 60 },
  ] },
];

/** Lookup tables, built once so that resolution stays O(1) per call. */
const categoriesById = new Map<UnitCategoryId, UnitCategoryDef>();
const unitsById = new Map<string, { unit: UnitDef; category: UnitCategoryDef }>();

for (const category of UNIT_CATEGORIES) {
  categoriesById.set(category.id, category);
  for (const unit of category.units) {
    unitsById.set(unit.id, { unit, category });
  }
}

/** Every unit id, for validation of imported or hand-edited config. */
export function isKnownUnit(id: string): boolean {
  return unitsById.has(id);
}

/** The units of one category (empty array for an unknown category). */
export function unitsForCategory(category: UnitCategoryId): readonly UnitDef[] {
  return categoriesById.get(category)?.units ?? [];
}

/** Resolve a unit id to its definition and category, or null. */
export function findUnit(id: string): { unit: UnitDef; category: UnitCategoryDef } | null {
  return unitsById.get(id) ?? null;
}

/**
 * Convert between two units of the same category. Returns null for unknown ids
 * or a category mismatch. An identity conversion returns `value` untouched, so
 * "convert to the unit it is already in" stays exact.
 */
export function convert(value: number, fromId: string, toId: string): number | null {
  const from = unitsById.get(fromId);
  const to = unitsById.get(toId);
  if (!from || !to) return null;
  if (from.category.id !== to.category.id) return null;
  if (fromId === toId) return value;
  const base = (value - (from.unit.offset ?? 0)) * from.unit.factor;
  return base / to.unit.factor + (to.unit.offset ?? 0);
}

/** Grouping is pinned to one locale so formatted output is deterministic. */
const LOCALE = 'en-US';

/** `Intl.NumberFormat` construction is expensive, so the formatters are cached. */
const formatters = new Map<string, Intl.NumberFormat>();

function numberFormatter(fractionDigits: number, fixed: boolean): Intl.NumberFormat {
  const key = `${fixed ? 'fixed' : 'auto'}:${fractionDigits}`;
  const cached = formatters.get(key);
  if (cached) return cached;
  const created = new Intl.NumberFormat(LOCALE, {
    minimumFractionDigits: fixed ? fractionDigits : 0,
    maximumFractionDigits: fractionDigits,
    useGrouping: true,
  });
  formatters.set(key, created);
  return created;
}

/** Significant digits kept for values ≥ 1, and the wider budget below 1. */
const READABLE_DIGITS = 6;
const SMALL_VALUE_DIGITS = 10;
/** `Intl.NumberFormat` rejects more than 100 fraction digits. */
const MAX_FRACTION_DIGITS = 100;

/** Fraction digits that keep `magnitude` readable without exponent notation. */
function readableFractionDigits(magnitude: number): number {
  if (magnitude === 0) return 0;
  const exponent = Math.floor(Math.log10(magnitude));
  const significant = exponent < 0 ? SMALL_VALUE_DIGITS : READABLE_DIGITS;
  return clamp(significant - 1 - exponent, 0, MAX_FRACTION_DIGITS);
}

/**
 * Format a converted value: thousands separators, never exponent notation, and
 * `precision` fraction digits when it is given (the rounding `toFixed` does).
 * Without `precision` the digit count follows the magnitude — about six
 * significant digits, or up to ten below 1 — so `1234.5678912` reads as
 * `1,234.57` and `0.000000123` stays plain instead of becoming `1.23e-7`.
 *
 * Non-finite input formats as `0` (a widget should never render `NaN`), as do
 * negative zero and magnitudes below 1e-100, which no fixed notation reaches.
 */
export function formatUnitValue(value: number, precision?: number): string {
  if (!Number.isFinite(value)) return '0';
  const safe = value === 0 ? 0 : value; // normalise -0
  if (precision !== undefined) {
    const digits = clamp(Math.trunc(precision), 0, MAX_FRACTION_DIGITS);
    // `toFixed` pins the digits; re-reading them as a number keeps them while
    // Intl adds grouping — and expands 1e21, which `toFixed` renders as `1e+21`.
    return numberFormatter(digits, true).format(Number(safe.toFixed(digits)));
  }
  return numberFormatter(readableFractionDigits(Math.abs(safe)), false).format(safe);
}
