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
  it('declares a base unit that belongs to its own category', () => {
    for (const category of UNIT_CATEGORIES) {
      expect(category.units.map((unit) => unit.id)).toContain(category.baseUnit);
    }
  });

  it('uses finite positive factors, non-empty ids and globally unique ids', () => {
    const seen = new Set<string>();
    let count = 0;
    for (const category of UNIT_CATEGORIES) {
      for (const unit of category.units) {
        expect(Number.isFinite(unit.factor)).toBe(true);
        expect(unit.factor).toBeGreaterThan(0);
        expect(unit.id).not.toBe('');
        expect(seen.has(unit.id)).toBe(false);
        seen.add(unit.id);
        count += 1;
      }
    }
    expect(seen.size).toBe(count);
    expect(count).toBe(73);
  });

  it('only gives temperature units an offset', () => {
    for (const category of UNIT_CATEGORIES) {
      for (const unit of category.units) {
        if (category.id === 'temperature') continue;
        expect(unit.offset).toBeUndefined();
      }
    }
  });
});

describe('convert — known conversions', () => {
  it('converts length', () => {
    expect(mustConvert(1, 'mile', 'kilometre')).toBeCloseTo(1.609344, 10);
    expect(mustConvert(1, 'nautical-mile', 'kilometre')).toBeCloseTo(1.852, 10);
    expect(mustConvert(1, 'foot', 'inch')).toBeCloseTo(12, 8);
    expect(mustConvert(1, 'mile', 'foot')).toBeCloseTo(5280, 6);
    expect(mustConvert(1, 'metre', 'centimetre')).toBeCloseTo(100, 8);
  });

  it('converts mass', () => {
    expect(mustConvert(1, 'kilogram', 'pound')).toBeCloseTo(2.2046226218, 8);
    expect(mustConvert(1, 'pound', 'kilogram')).toBeCloseTo(0.45359237, 10);
    expect(mustConvert(1, 'stone', 'pound')).toBeCloseTo(14, 8);
    expect(mustConvert(1, 'ounce', 'gram')).toBeCloseTo(28.349523125, 8);
    expect(mustConvert(1, 'tonne', 'kilogram')).toBe(1000);
  });

  it('converts temperature in both directions', () => {
    expect(mustConvert(0, 'celsius', 'fahrenheit')).toBeCloseTo(32, 8);
    expect(mustConvert(100, 'celsius', 'fahrenheit')).toBeCloseTo(212, 8);
    expect(mustConvert(-40, 'celsius', 'fahrenheit')).toBeCloseTo(-40, 8);
    expect(mustConvert(32, 'fahrenheit', 'celsius')).toBeCloseTo(0, 8);
    expect(mustConvert(212, 'fahrenheit', 'celsius')).toBeCloseTo(100, 8);
    expect(mustConvert(-40, 'fahrenheit', 'celsius')).toBeCloseTo(-40, 8);
    expect(mustConvert(0, 'celsius', 'kelvin')).toBeCloseTo(273.15, 8);
    expect(mustConvert(273.15, 'kelvin', 'celsius')).toBeCloseTo(0, 8);
    expect(mustConvert(0, 'kelvin', 'fahrenheit')).toBeCloseTo(-459.67, 6);
  });

  it('converts area and volume', () => {
    expect(mustConvert(1, 'acre', 'square-metre')).toBeCloseTo(4046.8564224, 8);
    expect(mustConvert(1, 'square-mile', 'acre')).toBeCloseTo(640, 6);
    expect(mustConvert(1, 'hectare', 'square-metre')).toBe(10000);
    expect(mustConvert(1, 'square-kilometre', 'hectare')).toBe(100);
    expect(mustConvert(1, 'imperial-gallon', 'litre')).toBeCloseTo(4.54609, 10);
    expect(mustConvert(1, 'us-gallon', 'litre')).toBeCloseTo(3.785411784, 10);
    expect(mustConvert(1, 'us-gallon', 'us-quart')).toBeCloseTo(4, 8);
    expect(mustConvert(1, 'cubic-metre', 'litre')).toBe(1000);
  });

  it('converts speed', () => {
    expect(mustConvert(1, 'knot', 'kilometre-per-hour')).toBeCloseTo(1.852, 8);
    expect(mustConvert(1, 'mile-per-hour', 'kilometre-per-hour')).toBeCloseTo(1.609344, 8);
    expect(mustConvert(60, 'mile-per-hour', 'foot-per-second')).toBeCloseTo(88, 6);
    expect(mustConvert(1, 'metre-per-second', 'kilometre-per-hour')).toBeCloseTo(3.6, 8);
  });

  it('respects decimal and binary data prefixes', () => {
    expect(mustConvert(1, 'gibibyte', 'byte')).toBe(1073741824);
    expect(mustConvert(1, 'gigabyte', 'byte')).toBe(1000000000);
    expect(mustConvert(1, 'kibibyte', 'byte')).toBe(1024);
    expect(mustConvert(1, 'terabyte', 'gigabyte')).toBe(1000);
    expect(mustConvert(1, 'tebibyte', 'gibibyte')).toBe(1024);
    expect(mustConvert(1, 'mebibyte', 'megabyte')).toBeCloseTo(1.048576, 8);
  });

  it('converts time, energy, pressure and angle', () => {
    expect(mustConvert(1, 'day', 'hour')).toBe(24);
    expect(mustConvert(1, 'week', 'day')).toBe(7);
    expect(mustConvert(1, 'hour', 'second')).toBe(3600);
    expect(mustConvert(1, 'kilowatt-hour', 'joule')).toBe(3600000);
    expect(mustConvert(1, 'kilocalorie', 'kilojoule')).toBeCloseTo(4.184, 8);
    expect(mustConvert(1, 'btu', 'joule')).toBeCloseTo(1055.05585262, 6);
    expect(mustConvert(1, 'bar', 'pascal')).toBe(100000);
    expect(mustConvert(1, 'atmosphere', 'pascal')).toBe(101325);
    expect(mustConvert(1, 'psi', 'pascal')).toBeCloseTo(6894.757, 2);
    expect(mustConvert(1, 'hectopascal', 'millibar')).toBe(1);
    expect(mustConvert(1, 'mmhg', 'pascal')).toBeCloseTo(133.322387415, 6);
    expect(mustConvert(1, 'turn', 'degree')).toBe(360);
    expect(mustConvert(1, 'gradian', 'degree')).toBeCloseTo(0.9, 10);
    expect(mustConvert(1, 'degree', 'arcminute')).toBeCloseTo(60, 8);
    expect(mustConvert(Math.PI, 'radian', 'degree')).toBeCloseTo(180, 8);
  });
});

describe('convert — guards', () => {
  it('returns null for unknown ids and for a category mismatch', () => {
    expect(convert(1, 'parsec', 'metre')).toBeNull();
    expect(convert(1, 'metre', 'parsec')).toBeNull();
    expect(convert(1, 'kilometre', 'kilogram')).toBeNull();
    expect(convert(1, '', 'metre')).toBeNull();
    expect(convert(1, 'Metre', 'metre')).toBeNull();
  });

  it('handles zero and negative values', () => {
    expect(mustConvert(0, 'metre', 'kilometre')).toBe(0);
    expect(mustConvert(0, 'celsius', 'fahrenheit')).toBeCloseTo(32, 8);
    expect(mustConvert(-1, 'kilometre', 'metre')).toBe(-1000);
    expect(mustConvert(-273.15, 'celsius', 'kelvin')).toBeCloseTo(0, 8);
    expect(mustConvert(-5.5, 'pound', 'kilogram')).toBeCloseTo(-2.494758035, 8);
  });

  it('keeps identity conversions exact', () => {
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
    const litresToGallons = mustConvert(7, 'litre', 'us-gallon');
    expect(litresToGallons * mustConvert(7, 'us-gallon', 'litre')).toBeCloseTo(49, 6);
  });
});

describe('convert — round trips', () => {
  const PAIRS: ReadonlyArray<readonly [string, string]> = [
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

  it('returns the original value for every pair, magnitude and sign', () => {
    for (const [from, to] of PAIRS) {
      for (const value of [0, 1, -1, 12.5, 0.001, 1000000]) expectRoundTrip(value, from, to);
    }
  });
});

describe('lookup helpers', () => {
  it('recognises every catalogued id and nothing else', () => {
    for (const category of UNIT_CATEGORIES) {
      for (const unit of category.units) expect(isKnownUnit(unit.id)).toBe(true);
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
