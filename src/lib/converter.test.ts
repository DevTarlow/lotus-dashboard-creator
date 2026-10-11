import { describe, expect, it } from 'vitest';
import {
  MAX_PRECISION,
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
} from '@/lib/converter';
import { UNIT_CATEGORIES } from '@/lib/units';

describe('amounts', () => {
  it('parses what the user typed', () => {
    expect(parseAmount('1')).toBe(1);
    expect(parseAmount(' 2.5 ')).toBe(2.5);
    expect(parseAmount('-3')).toBe(-3);
    expect(parseAmount('0')).toBe(0);
    expect(parseAmount('1e3')).toBe(1000);
    expect(parseAmount('.5')).toBe(0.5);
  });

  it('treats an empty or unreadable field as no value at all', () => {
    // Not 0: a cleared field is "nothing to convert", not "convert nothing".
    expect(parseAmount('')).toBeNull();
    expect(parseAmount('   ')).toBeNull();
    expect(parseAmount('abc')).toBeNull();
    expect(parseAmount('1,5')).toBeNull();
    expect(parseAmount('Infinity')).toBeNull();
    expect(parseAmount('NaN')).toBeNull();
  });

  it('reads a stored amount defensively', () => {
    expect(normalizeAmount(2, 1)).toBe(2);
    expect(normalizeAmount('2.5', 1)).toBe(2.5);
    expect(normalizeAmount(null, 1)).toBe(1);
    expect(normalizeAmount('', 1)).toBe(1);
    expect(normalizeAmount('nonsense', 1)).toBe(1);
    expect(normalizeAmount(Number.NaN, 4)).toBe(4);
    expect(normalizeAmount(Number.POSITIVE_INFINITY, 4)).toBe(4);
  });
});

describe('precision', () => {
  it('reads null, numbers and the settings form’s strings', () => {
    expect(normalizePrecision(null)).toBeNull();
    expect(normalizePrecision(undefined)).toBeNull();
    expect(normalizePrecision('')).toBeNull();
    expect(normalizePrecision('auto')).toBeNull();
    expect(normalizePrecision('nonsense')).toBeNull();
    expect(normalizePrecision(0)).toBe(0);
    expect(normalizePrecision('4')).toBe(4);
    expect(normalizePrecision(2.9)).toBe(2);
  });

  it('clamps into the range the catalogue supports', () => {
    expect(normalizePrecision(-3)).toBe(0);
    expect(normalizePrecision(99)).toBe(MAX_PRECISION);
    expect(normalizePrecision(Number.NaN)).toBeNull();
  });

  it('offers a scannable set of choices including automatic', () => {
    expect(PRECISION_CHOICES[0]).toBe(0);
    expect(PRECISION_CHOICES).toContain(MAX_PRECISION);
    expect(new Set(PRECISION_CHOICES).size).toBe(PRECISION_CHOICES.length);
    for (let index = 1; index < PRECISION_CHOICES.length; index += 1) {
      expect(PRECISION_CHOICES[index]).toBeGreaterThan(PRECISION_CHOICES[index - 1]);
    }
  });
});

describe('categories and default pairs', () => {
  it('accepts a catalogue category and rejects anything else', () => {
    expect(normalizeUnitCategory('mass')).toBe('mass');
    expect(normalizeUnitCategory('temperature')).toBe('temperature');
    expect(normalizeUnitCategory('bogus')).toBe('length');
    expect(normalizeUnitCategory(42)).toBe('length');
    expect(normalizeUnitCategory(null)).toBe('length');
    expect(normalizeUnitCategory(undefined)).toBe('length');
  });

  it('picks a convertible pair for every category', () => {
    for (const category of UNIT_CATEGORIES) {
      const pair = defaultUnitPair(category.id);
      expect(pair.fromUnit, category.id).not.toBe('');
      expect(unitPairProblem(pair.fromUnit, pair.toUnit), category.id).toBeNull();
      // The pair is genuinely different, so the widget never opens as 1 → 1.
      expect(pair.fromUnit).not.toBe(pair.toUnit);
    }
    expect(defaultUnitPair('length')).toEqual({ fromUnit: 'metre', toUnit: 'kilometre' });
    expect(defaultUnitPair('temperature')).toEqual({ fromUnit: 'celsius', toUnit: 'fahrenheit' });
  });
});

describe('converting a pair', () => {
  it('converts and formats, symbols included', () => {
    const conversion = convertUnits(1, 'kilometre', 'mile', null);
    expect(conversion).not.toBeNull();
    expect(conversion?.value).toBeCloseTo(0.621371, 6);
    expect(conversion?.text).toBe('0.6213711922');
    expect(conversion?.fromSymbol).toBe('km');
    expect(conversion?.toSymbol).toBe('mi');
  });

  it('pins the fraction digits when a precision is configured', () => {
    expect(convertUnits(1, 'kilometre', 'mile', 2)?.text).toBe('0.62');
    expect(convertUnits(1, 'kilometre', 'mile', 4)?.text).toBe('0.6214');
    expect(convertUnits(1, 'kilometre', 'mile', 0)?.text).toBe('1');
    expect(convertUnits(1, 'mile', 'kilometre', 2)?.text).toBe('1.61');
  });

  it('handles the affine scales', () => {
    expect(convertUnits(0, 'celsius', 'fahrenheit', 0)?.text).toBe('32');
    expect(convertUnits(100, 'celsius', 'kelvin', 0)?.text).toBe('373');
  });

  it('keeps an identity conversion exact', () => {
    const conversion = convertUnits(3.5, 'kilogram', 'kilogram', null);
    expect(conversion?.value).toBe(3.5);
    expect(conversion?.text).toBe('3.5');
  });

  it('returns null rather than a wrong number for a pair it cannot convert', () => {
    expect(convertUnits(1, 'kilometre', 'kilogram', null)).toBeNull();
    expect(convertUnits(1, 'furlong', 'mile', null)).toBeNull();
    expect(convertUnits(1, 'kilometre', 'furlong', null)).toBeNull();
    expect(convertUnits(1, '', '', null)).toBeNull();
  });

  it('names what is wrong with a stored pair', () => {
    expect(unitPairProblem('kilometre', 'mile')).toBeNull();
    expect(unitPairProblem('furlong', 'mile')).toBe('unknown-from');
    expect(unitPairProblem('kilometre', 'furlong')).toBe('unknown-to');
    expect(unitPairProblem('kilometre', 'kilogram')).toBe('mismatch');

    const messages = [
      unitPairMessage('unknown-from'),
      unitPairMessage('unknown-to'),
      unitPairMessage('mismatch'),
    ];
    for (const message of messages) expect(message.length).toBeGreaterThan(10);
    expect(new Set(messages).size).toBe(3);
  });
});

describe('preview formatting', () => {
  it('keeps the subtitle short', () => {
    expect(formatPreview(0.6213711922)).toBe('0.621');
    expect(formatPreview(1.609344)).toBe('1.61');
    expect(formatPreview(2.54)).toBe('2.54');
    expect(formatPreview(32)).toBe('32');
    expect(formatPreview(373.15)).toBe('373');
    expect(formatPreview(1234.5678)).toBe('1,235');
    expect(formatPreview(0)).toBe('0');
  });

  it('never rounds a real value away', () => {
    // Three significant digits of 1 byte in gibibytes would print `0`, so the
    // widget's full format is used instead of a lie.
    expect(formatPreview(9.313225746154785e-10)).toBe('0.0000000009313225746');
    expect(formatPreview(-0.6213711922)).toBe('-0.621');
  });

  it('obeys a configured precision, so subtitle and body agree', () => {
    expect(formatPreview(0.6213711922, 2)).toBe('0.62');
    expect(formatPreview(0.6213711922, 0)).toBe('1');
    expect(formatPreview(1234.5678, 4)).toBe('1,234.5678');
  });
});

describe('unit picker options', () => {
  it('lists the category’s units in catalogue order', () => {
    const options = unitOptions('length');
    expect(options[0]).toEqual({ value: 'metre', label: 'Metre (m)' });
    expect(options.map((option) => option.value)).toContain('nautical-mile');
    // Only that category: a mass unit never appears under length.
    expect(options.map((option) => option.value)).not.toContain('kilogram');
  });

  it('keeps a stored id that the category does not contain, and says so', () => {
    const mismatched = unitOptions('length', ['kilogram']);
    expect(mismatched).toHaveLength(unitOptions('length').length + 1);
    expect(mismatched[mismatched.length - 1]).toEqual({
      value: 'kilogram',
      label: 'Kilogram (not in Length)',
    });

    const unknown = unitOptions('length', ['furlong']);
    expect(unknown[unknown.length - 1]).toEqual({ value: 'furlong', label: 'furlong (unknown unit)' });
  });

  it('never duplicates an option, and ignores blank ids', () => {
    const values = unitOptions('mass', ['kilogram', '', 'kilogram']).map((option) => option.value);
    expect(values).toHaveLength(unitOptions('mass').length);
    expect(new Set(values).size).toBe(values.length);
  });
});
