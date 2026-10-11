import { describe, expect, it } from 'vitest';
import {
  compositeOver,
  contrastRatio,
  formatOklch,
  hexToOklch,
  linearToSrgb,
  oklchToRgb,
  parseHex,
  relativeLuminance,
  rgbToHex,
  rgbToOklch,
  srgbToLinear,
  type Rgb,
} from '@/lib/color';

const WHITE: Rgb = { r: 1, g: 1, b: 1 };
const BLACK: Rgb = { r: 0, g: 0, b: 0 };

/** Compare two colours within one 8-bit step, the precision a hex string has. */
function expectSameRgb(actual: Rgb, expected: Rgb): void {
  expect(actual.r).toBeCloseTo(expected.r, 2);
  expect(actual.g).toBeCloseTo(expected.g, 2);
  expect(actual.b).toBeCloseTo(expected.b, 2);
}

describe('parseHex', () => {
  it('accepts three and six digit hex, with or without the hash', () => {
    expectSameRgb(parseHex('#abc') as Rgb, { r: 0xaa / 255, g: 0xbb / 255, b: 0xcc / 255 });
    expectSameRgb(parseHex('8b5cf6') as Rgb, { r: 0x8b / 255, g: 0x5c / 255, b: 0xf6 / 255 });
    expectSameRgb(parseHex('  #FFFFFF  ') as Rgb, WHITE);
  });

  it('rejects anything that is not a hex colour', () => {
    for (const value of [null, undefined, 42, {}, '', '#12', '#12345', 'rebeccapurple', '#gggggg']) {
      expect(parseHex(value)).toBeNull();
    }
  });
});

describe('rgbToHex', () => {
  it('round-trips through parseHex', () => {
    for (const hex of ['#000000', '#ffffff', '#8b5cf6', '#0f172a', '#f8fafc', '#ff0090']) {
      expect(rgbToHex(parseHex(hex) as Rgb)).toBe(hex);
    }
  });

  it('clamps out-of-range channels instead of emitting nonsense', () => {
    expect(rgbToHex({ r: 2, g: -1, b: 0.5 })).toBe('#ff0080');
  });
});

describe('OKLCH conversion', () => {
  it('maps the sRGB primaries to the values the CSS spec documents', () => {
    const red = rgbToOklch({ r: 1, g: 0, b: 0 });
    expect(red.l).toBeCloseTo(0.628, 3);
    expect(red.c).toBeCloseTo(0.2577, 3);
    expect(red.h).toBeCloseTo(29.23, 1);

    const white = rgbToOklch(WHITE);
    expect(white.l).toBeCloseTo(1, 4);
    expect(white.c).toBeLessThan(1e-4);

    const black = rgbToOklch(BLACK);
    expect(black.l).toBeCloseTo(0, 4);
  });

  it('reports no hue for a neutral instead of rounding noise', () => {
    expect(rgbToOklch(WHITE).h).toBe(0);
    expect(rgbToOklch({ r: 0.5, g: 0.5, b: 0.5 }).h).toBe(0);
  });

  it('round-trips hex → OKLCH → hex within one 8-bit step', () => {
    for (const hex of ['#000000', '#ffffff', '#8b5cf6', '#0f172a', '#f8fafc', '#059669', '#f59e0b']) {
      const oklch = hexToOklch(hex);
      expect(oklch, hex).not.toBeNull();
      expect(rgbToHex(oklchToRgb(oklch!))).toBe(hex);
    }
  });

  it('returns null for a malformed hex', () => {
    expect(hexToOklch('not-a-colour')).toBeNull();
    expect(hexToOklch(null)).toBeNull();
  });

  it('clamps an out-of-gamut chroma to a displayable colour', () => {
    const rgb = oklchToRgb({ l: 0.6, c: 0.6, h: 140 });
    for (const channel of [rgb.r, rgb.g, rgb.b]) {
      expect(channel).toBeGreaterThanOrEqual(0);
      expect(channel).toBeLessThanOrEqual(1);
    }
  });
});

describe('transfer functions', () => {
  it('are inverses of each other', () => {
    for (const value of [0, 0.02, 0.2, 0.5, 0.9, 1]) {
      expect(linearToSrgb(srgbToLinear(value))).toBeCloseTo(value, 6);
    }
  });

  it('clamp their input', () => {
    expect(srgbToLinear(-1)).toBe(0);
    expect(srgbToLinear(2)).toBe(1);
    expect(linearToSrgb(2)).toBeCloseTo(1, 10);
  });
});

describe('formatOklch', () => {
  it('renders the same precision Tailwind writes', () => {
    expect(formatOklch({ l: 0.984, c: 0.003, h: 247.858 })).toBe('oklch(98.4% 0.003 247.858)');
    expect(formatOklch({ l: 0.208, c: 0.042, h: 265.755 })).toBe('oklch(20.8% 0.042 265.755)');
  });
});

describe('relativeLuminance and contrastRatio', () => {
  it('match the WCAG reference values', () => {
    expect(relativeLuminance(WHITE)).toBeCloseTo(1, 6);
    expect(relativeLuminance(BLACK)).toBeCloseTo(0, 6);
    expect(contrastRatio(WHITE, BLACK)).toBeCloseTo(21, 6);
    // The classic boundary: #767676 on white is the lightest AA-passing grey.
    expect(contrastRatio(parseHex('#767676') as Rgb, WHITE)).toBeCloseTo(4.54, 2);
    expect(contrastRatio(parseHex('#777777') as Rgb, WHITE)).toBeCloseTo(4.48, 2);
  });

  it('is symmetric and never below 1', () => {
    const a = parseHex('#8b5cf6') as Rgb;
    expect(contrastRatio(a, WHITE)).toBeCloseTo(contrastRatio(WHITE, a), 10);
    expect(contrastRatio(a, a)).toBeCloseTo(1, 10);
  });
});

describe('compositeOver', () => {
  it('blends in gamma-encoded sRGB, as the browser paints a translucent utility', () => {
    expectSameRgb(compositeOver(WHITE, 0.5, BLACK), { r: 0.5, g: 0.5, b: 0.5 });
    expectSameRgb(compositeOver(WHITE, 0.15, BLACK), { r: 0.15, g: 0.15, b: 0.15 });
  });

  it('is the identity for a fully opaque or fully transparent foreground', () => {
    const fg = parseHex('#ff0090') as Rgb;
    const bg = parseHex('#0f172a') as Rgb;
    expectSameRgb(compositeOver(fg, 1, bg), fg);
    expectSameRgb(compositeOver(fg, 0, bg), bg);
  });

  it('clamps an out-of-range alpha', () => {
    const fg = parseHex('#ffffff') as Rgb;
    const bg = parseHex('#000000') as Rgb;
    expectSameRgb(compositeOver(fg, 5, bg), fg);
    expectSameRgb(compositeOver(fg, -5, bg), bg);
  });
});
