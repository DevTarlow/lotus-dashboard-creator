import { describe, expect, it } from 'vitest';
import { UNIT_CATEGORIES, convert, findUnit, formatUnitValue, isKnownUnit, unitsForCategory } from '@/lib/units';
import type { UnitCategoryId } from '@/lib/units';

/** Fail loudly on a null conversion instead of threading `null` through picks. */
function mustConvert(value: number, from: string, to: string): number {
  const result = convert(value, from, to);
  if (result === null) throw new Error(`convert(${value}, ${from}, ${to}) returned null`);
  return result;
}

/** Round-trip budget: 1e-9 relative, which covers the widest factor pairs here. */
function expectRoundTrip(value: number, from: string, to: string): void {
  const back = mustConvert(mustConvert(value, from, to), to, from);
  expect(Math.abs(back - value)).toBeLessThan(1e-9 * Math.max(1, Math.abs(value)));
}

describe('unit catalogue', () => {
  it('is internally consistent', () => {
    const seen = new Set<string>();
    for (const category of UNIT_CATEGORIES) {
      expect(category.units.map((unit) => unit.id), category.id).toContain(category.baseUnit);
      for (const unit of category.units) {
        expect(Number.isFinite(unit.factor), unit.id).toBe(true);
        expect(unit.factor, unit.id).toBeGreaterThan(0);
        expect(unit.id).not.toBe('');
        expect(seen.has(unit.id), unit.id).toBe(false);
        seen.add(unit.id);
      }
    }
    expect(seen.size).toBe(73); // every id is unique across the whole catalogue
  });
});

describe('convert — known conversions', () => {
  it('matches the reference values', () => {
    /** `[value, from, to, expected, digits]`, grouped by category. */
    const cases: ReadonlyArray<readonly [number, string, string, number, number]> = [
      // length
      [1, 'mile', 'kilometre', 1.609344, 10],
      [1, 'nautical-mile', 'kilometre', 1.852, 10],
      [1, 'mile', 'foot', 5280, 6],
      [1, 'foot', 'inch', 12, 8],
      // mass
      [1, 'kilogram', 'pound', 2.2046226218, 8],
      [1, 'pound', 'kilogram', 0.45359237, 10],
      [1, 'stone', 'pound', 14, 8],
      [1, 'tonne', 'kilogram', 1000, 8],
      // temperature, in both directions
      [0, 'celsius', 'fahrenheit', 32, 8],
      [100, 'celsius', 'fahrenheit', 212, 8],
      [-40, 'celsius', 'fahrenheit', -40, 8],
      [32, 'fahrenheit', 'celsius', 0, 8],
      [212, 'fahrenheit', 'celsius', 100, 8],
      [-40, 'fahrenheit', 'celsius', -40, 8],
      [0, 'celsius', 'kelvin', 273.15, 8],
      [273.15, 'kelvin', 'celsius', 0, 8],
      [0, 'kelvin', 'fahrenheit', -459.67, 6],
      // area and volume
      [1, 'acre', 'square-metre', 4046.8564224, 8],
      [1, 'hectare', 'square-metre', 10000, 8],
      [1, 'imperial-gallon', 'litre', 4.54609, 10],
      [1, 'us-gallon', 'litre', 3.785411784, 10],
      [1, 'us-gallon', 'us-quart', 4, 8],
      // speed
      [1, 'knot', 'kilometre-per-hour', 1.852, 8],
      [1, 'mile-per-hour', 'kilometre-per-hour', 1.609344, 8],
      [60, 'mile-per-hour', 'foot-per-second', 88, 6],
      // data, decimal and binary prefixes
      [1, 'gibibyte', 'byte', 1073741824, 8],
      [1, 'gigabyte', 'byte', 1000000000, 8],
      [1, 'kibibyte', 'byte', 1024, 8],
      [1, 'terabyte', 'gigabyte', 1000, 8],
      [1, 'tebibyte', 'gibibyte', 1024, 8],
      // time, energy, pressure and angle
      [1, 'day', 'hour', 24, 8],
      [1, 'week', 'day', 7, 8],
      [1, 'hour', 'second', 3600, 8],
      [1, 'kilowatt-hour', 'joule', 3600000, 8],
      [1, 'kilocalorie', 'kilojoule', 4.184, 8],
      [1, 'btu', 'joule', 1055.05585262, 6],
      [1, 'bar', 'pascal', 100000, 8],
      [1, 'atmosphere', 'pascal', 101325, 8],
      [1, 'psi', 'pascal', 6894.757, 2],
      [1, 'hectopascal', 'millibar', 1, 8],
      [1, 'mmhg', 'pascal', 133.322387415, 6],
      [1, 'turn', 'degree', 360, 8],
      [1, 'gradian', 'degree', 0.9, 10],
      [1, 'degree', 'arcminute', 60, 8],
      [Math.PI, 'radian', 'degree', 180, 8],
    ];
    for (const [value, from, to, expected, digits] of cases) {
      expect(mustConvert(value, from, to), `${value} ${from} → ${to}`).toBeCloseTo(expected, digits);
    }
  });
});

describe('convert — edge cases', () => {
  it('returns null for unknown ids and for a category mismatch', () => {
    expect(convert(1, 'parsec', 'metre')).toBeNull();
    expect(convert(1, 'metre', 'parsec')).toBeNull();
    expect(convert(1, 'kilometre', 'kilogram')).toBeNull();
    expect(convert(1, '', 'metre')).toBeNull();
    expect(convert(1, 'Metre', 'metre')).toBeNull();
  });

  it('handles zero, negatives and exact identity conversions', () => {
    expect(mustConvert(0, 'metre', 'kilometre')).toBe(0);
    expect(mustConvert(0, 'celsius', 'fahrenheit')).toBeCloseTo(32, 8);
    expect(mustConvert(-1, 'kilometre', 'metre')).toBe(-1000);
    expect(mustConvert(-273.15, 'celsius', 'kelvin')).toBeCloseTo(0, 8);
    expect(mustConvert(-5.5, 'pound', 'kilogram')).toBeCloseTo(-2.494758035, 8);
    expect(convert(123.456, 'celsius', 'celsius')).toBe(123.456);
    expect(convert(1 / 3, 'metre', 'metre')).toBe(1 / 3);
    // Fahrenheit is the interesting one: the general formula is lossy here.
    expect(convert(-17.2, 'fahrenheit', 'fahrenheit')).toBe(-17.2);
    expect(convert(0, 'us-gallon', 'us-gallon')).toBe(0);
  });

  it('mirrors when the pair is swapped', () => {
    expect(mustConvert(mustConvert(7, 'litre', 'us-gallon'), 'us-gallon', 'litre')).toBeCloseTo(7, 9);
    expect(mustConvert(mustConvert(7, 'us-gallon', 'litre'), 'litre', 'us-gallon')).toBeCloseTo(7, 9);
    // Reciprocal factors: 7 L in gallons × 7 gal in litres = 49.
    expect(mustConvert(7, 'litre', 'us-gallon') * mustConvert(7, 'us-gallon', 'litre')).toBeCloseTo(49, 6);
  });

  it('round-trips values across every category', () => {
    const pairs: ReadonlyArray<readonly [string, string]> = [
      ['metre', 'mile'],
      ['kilogram', 'stone'],
      ['celsius', 'fahrenheit'],
      ['celsius', 'kelvin'],
      ['square-metre', 'acre'],
      ['litre', 'imperial-gallon'],
      ['us-gallon', 'millilitre'],
      ['metre-per-second', 'knot'],
      ['byte', 'gibibyte'],
      ['second', 'week'],
      ['joule', 'kilowatt-hour'],
      ['pascal', 'psi'],
      ['degree', 'radian'],
    ];
    for (const [from, to] of pairs) {
      for (const value of [0, 1, -1, 12.5, 0.001, 1000000]) expectRoundTrip(value, from, to);
    }
  });
});

describe('lookup helpers', () => {
  it('recognises every catalogued id and nothing else', () => {
    for (const category of UNIT_CATEGORIES) {
      for (const unit of category.units) expect(isKnownUnit(unit.id), unit.id).toBe(true);
    }
    expect(isKnownUnit('parsec')).toBe(false);
    expect(isKnownUnit('')).toBe(false);
    expect(isKnownUnit('Metre')).toBe(false);
  });

  it("returns one category's units, or an empty array", () => {
    expect(unitsForCategory('temperature').map((unit) => unit.id)).toEqual(['celsius', 'fahrenheit', 'kelvin']);
    expect(unitsForCategory('length')).toHaveLength(9);
    expect(unitsForCategory('nope' as UnitCategoryId)).toEqual([]);
  });

  it('resolves a unit together with its category', () => {
    expect(findUnit('kelvin')).toMatchObject({
      unit: { label: 'Kelvin', symbol: 'K' },
      category: { id: 'temperature', baseUnit: 'celsius' },
    });
    expect(findUnit('gibibyte')?.unit.factor).toBe(1073741824);
    expect(findUnit('parsec')).toBeNull();
  });
});

describe('formatUnitValue', () => {
  it('adds thousands separators and keeps values short', () => {
    expect(formatUnitValue(1234.5678912)).toBe('1,234.57');
    expect(formatUnitValue(-1234.5678912)).toBe('-1,234.57');
    expect(formatUnitValue(1073741824)).toBe('1,073,741,824');
    expect(formatUnitValue(0)).toBe('0');
    expect(formatUnitValue(-0)).toBe('0');
  });

  it('keeps small values readable instead of using exponent notation', () => {
    expect(formatUnitValue(0.000000123)).toBe('0.000000123');
    expect(formatUnitValue(1 / 3)).toBe('0.3333333333');
    expect(formatUnitValue(1e-21)).toBe('0.000000000000000000001');
    for (const value of [1e-7, 1e-12, 1234.5678912, 1e21]) {
      expect(formatUnitValue(value)).not.toMatch(/[a-zA-Z]/);
    }
  });

  it('uses an explicit precision verbatim', () => {
    expect(formatUnitValue(1234.5678, 2)).toBe('1,234.57');
    expect(formatUnitValue(3, 4)).toBe('3.0000');
    expect(formatUnitValue(-1234.5, 1)).toBe('-1,234.5');
    expect(formatUnitValue(1.23456789, 3)).toBe('1.235');
    expect(formatUnitValue(1, -5)).toBe('1');
  });

  it('never renders NaN or Infinity', () => {
    expect(formatUnitValue(Number.NaN)).toBe('0');
    expect(formatUnitValue(Number.POSITIVE_INFINITY)).toBe('0');
    expect(formatUnitValue(Number.NEGATIVE_INFINITY)).toBe('0');
    expect(formatUnitValue(Number.NaN, 2)).toBe('0');
    for (const value of [Number.NaN, Number.POSITIVE_INFINITY, 1e-300, 1e300]) {
      expect(formatUnitValue(value)).not.toMatch(/[a-zA-Z]/);
    }
  });

  it('formats a converted value end to end', () => {
    expect(formatUnitValue(mustConvert(1, 'gibibyte', 'byte'))).toBe('1,073,741,824');
    expect(formatUnitValue(mustConvert(1500, 'metre', 'kilometre'), 2)).toBe('1.50');
    expect(formatUnitValue(mustConvert(0, 'celsius', 'fahrenheit'))).toBe('32');
  });
});
