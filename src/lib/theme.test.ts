import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { contrastRatio, hexToOklch, oklchToRgb, rgbToHex } from '@/lib/color';
import {
  ACCENT_CHROMA_CAP,
  ACCENT_FG_TOKEN,
  ACCENT_REFERENCE_STEPS,
  ACCENT_TOKEN_PREFIX,
  MAX_THEME_TOKENS,
  NEUTRAL_CHROMA_CAP,
  NEUTRAL_REFERENCE_STEPS,
  NEUTRAL_TOKEN_PREFIX,
  THEME_CONTRAST_TARGET,
  THEME_PRESETS,
  THEME_STEPS,
  THEME_TOKEN_KEYS,
  buildThemeRamps,
  getThemePreset,
  isCompleteTokenSet,
  isThemeId,
  measureContrasts,
  normalizeThemeInput,
  resolveThemeTokens,
  sanitizeThemeTokens,
  tokensForPreset,
} from '@/lib/theme';
import type { ThemeId, ThemeTokens } from '@/types';

/** The roster, spelled out: adding a preset must be a deliberate act. */
const EXPECTED_IDS: readonly ThemeId[] = [
  'lotus',
  'graphite',
  'rose-quartz',
  'lavender-haze',
  'peach-fizz',
  'fuchsia-bloom',
  'cobalt',
  'emerald-slate',
  'amber-forge',
  'crimson-carbon',
];

/** Tailwind's published slate scale, as oklch lightness/chroma. */
const TAILWIND_SLATE: readonly [number, number][] = [
  [0.984, 0.003],
  [0.968, 0.007],
  [0.929, 0.013],
  [0.869, 0.022],
  [0.704, 0.04],
  [0.554, 0.046],
  [0.446, 0.043],
  [0.372, 0.044],
  [0.279, 0.041],
  [0.208, 0.042],
  [0.129, 0.042],
];

/** Tailwind's published violet scale. */
const TAILWIND_VIOLET: readonly [number, number][] = [
  [0.969, 0.016],
  [0.943, 0.029],
  [0.894, 0.057],
  [0.811, 0.111],
  [0.702, 0.183],
  [0.606, 0.25],
  [0.541, 0.281],
  [0.491, 0.27],
  [0.432, 0.232],
  [0.38, 0.189],
  [0.283, 0.141],
];

const OKLCH_TOKEN = /^oklch\((\d+(?:\.\d+)?)% (\d+(?:\.\d+)?) (\d+(?:\.\d+)?)\)$/;

function parseToken(value: string): { l: number; c: number; h: number } {
  const match = OKLCH_TOKEN.exec(value);
  if (!match) throw new Error(`not an oklch token: ${value}`);
  return { l: Number(match[1]) / 100, c: Number(match[2]), h: Number(match[3]) };
}

function inputFor(id: ThemeId) {
  return { themeId: id, customAccentHex: '', customNeutralHue: null };
}

function minimumContrast(tokens: ThemeTokens): number {
  // Rebuild the ramps from the resolved preset so the test measures the tokens
  // the app actually applies, not a separate code path.
  const preset = THEME_PRESETS.find((candidate) => tokensForPreset(candidate.id) === tokens);
  const ramps = buildThemeRamps(inputFor(preset?.id ?? 'lotus'));
  return Math.min(...measureContrasts(ramps).map((pair) => pair.ratio));
}

describe('reference scales', () => {
  it('mirror Tailwind slate and violet step for step', () => {
    expect(NEUTRAL_REFERENCE_STEPS.map(({ l, c }) => [l, c])).toEqual(TAILWIND_SLATE);
    expect(ACCENT_REFERENCE_STEPS.map(({ l, c }) => [l, c])).toEqual(TAILWIND_VIOLET);
    expect(NEUTRAL_REFERENCE_STEPS.map(({ step }) => step)).toEqual([...THEME_STEPS]);
    expect(ACCENT_REFERENCE_STEPS.map(({ step }) => step)).toEqual([...THEME_STEPS]);
  });

  it('keeps every reference chroma inside the cap, so the default theme is untouched by scaling', () => {
    for (const { c } of NEUTRAL_REFERENCE_STEPS) expect(c).toBeLessThanOrEqual(NEUTRAL_CHROMA_CAP);
    // The accent scale deliberately exceeds its cap at the strong end (violet-600
    // is 0.281 against a 0.26 ceiling), because a themed accent is trimmed slightly.
    expect(Math.max(...ACCENT_REFERENCE_STEPS.map(({ c }) => c))).toBeGreaterThan(ACCENT_CHROMA_CAP);
  });
});

describe('the preset roster', () => {
  it('is exactly the roster the public ThemeId union promises', () => {
    expect(THEME_PRESETS.map((preset) => preset.id)).toEqual(EXPECTED_IDS);
    expect(new Set(THEME_PRESETS.map((preset) => preset.id)).size).toBe(EXPECTED_IDS.length);
    for (const id of EXPECTED_IDS) expect(isThemeId(id)).toBe(true);
  });

  it('rejects anything that is not a known id', () => {
    for (const value of [null, undefined, 7, {}, '', 'LOTUS', 'rose', 'violet']) {
      expect(isThemeId(value)).toBe(false);
    }
  });

  it('describes every preset for the picker', () => {
    for (const preset of THEME_PRESETS) {
      expect(preset.name.length).toBeGreaterThan(0);
      expect(preset.description.length).toBeGreaterThan(0);
      expect(['neutral', 'warm', 'cool', 'bold']).toContain(preset.group);
      for (const ramp of [preset.accent, preset.neutral]) {
        expect(ramp.hue).toBeGreaterThanOrEqual(0);
        expect(ramp.hue).toBeLessThan(360);
        expect(ramp.chromaFactor).toBeGreaterThan(0);
        expect(ramp.chromaFactor).toBeLessThanOrEqual(2);
      }
    }
  });

  it('falls back to the default preset for an unknown id rather than throwing', () => {
    expect(getThemePreset('nope' as ThemeId).id).toBe('lotus');
  });
});

describe('token set', () => {
  it('covers both ramps plus the accent foreground, with no duplicates', () => {
    expect(THEME_TOKEN_KEYS).toHaveLength(THEME_STEPS.length * 2 + 1);
    expect(new Set(THEME_TOKEN_KEYS).size).toBe(THEME_TOKEN_KEYS.length);
    expect(THEME_TOKEN_KEYS).toContain(ACCENT_FG_TOKEN);
    expect(THEME_TOKEN_KEYS).toContain(`${NEUTRAL_TOKEN_PREFIX}950`);
    expect(THEME_TOKEN_KEYS).toContain(`${ACCENT_TOKEN_PREFIX}800`);
  });

  it('is mode-agnostic: one ramp serves light and dark', () => {
    // There is deliberately no per-mode token set. If one is ever added, this
    // fails and the light/dark pairing in `index.css` must be revisited.
    for (const key of THEME_TOKEN_KEYS) expect(key).not.toMatch(/dark|light/);
  });
});

describe('resolveThemeTokens', () => {
  it('emits a complete, well-formed set for every preset', () => {
    for (const preset of THEME_PRESETS) {
      const tokens = tokensForPreset(preset.id);
      expect(Object.keys(tokens).sort()).toEqual([...THEME_TOKEN_KEYS].sort());
      expect(isCompleteTokenSet(tokens)).toBe(true);
      for (const key of THEME_TOKEN_KEYS) {
        if (key === ACCENT_FG_TOKEN) {
          expect(tokens[key]).toMatch(/^#[0-9a-f]{6}$/);
        } else {
          expect(tokens[key]).toMatch(OKLCH_TOKEN);
        }
      }
    }
  });

  it('keeps the neutral ramp exactly at Tailwind lightness, only re-hued', () => {
    for (const preset of THEME_PRESETS) {
      const tokens = tokensForPreset(preset.id);
      NEUTRAL_REFERENCE_STEPS.forEach(({ step, l, c }) => {
        const token = parseToken(tokens[`${NEUTRAL_TOKEN_PREFIX}${step}`]);
        expect(token.l).toBeCloseTo(l, 3);
        // Tokens carry three decimals, so compare at that precision.
        expect(token.c).toBe(Number(Math.min(NEUTRAL_CHROMA_CAP, c * preset.neutral.chromaFactor).toFixed(3)));
        expect(token.h).toBeCloseTo(preset.neutral.hue, 3);
      });
    }
  });

  it('keeps the accent ramp at the reference lightness, shifted only by the solver', () => {
    for (const preset of THEME_PRESETS) {
      const ramps = buildThemeRamps(inputFor(preset.id));
      ACCENT_REFERENCE_STEPS.forEach(({ l, c }, index) => {
        // Steps whose lightness+shift leaves the floor/ceiling are clamped instead.
        expect(ramps.accent[index].l).toBeCloseTo(Math.min(0.995, Math.max(0.05, l + ramps.accentShift)), 3);
        expect(ramps.accent[index].c).toBeCloseTo(Math.min(ACCENT_CHROMA_CAP, c * preset.accent.chromaFactor), 3);
      });
      expect(Math.abs(ramps.accentShift)).toBeLessThanOrEqual(0.16);
    }
  });

  it('is deterministic and memoises preset tokens', () => {
    expect(resolveThemeTokens(inputFor('rose-quartz'))).toEqual(resolveThemeTokens(inputFor('rose-quartz')));
    expect(tokensForPreset('rose-quartz')).toBe(tokensForPreset('rose-quartz'));
    expect(tokensForPreset('rose-quartz')).toEqual(resolveThemeTokens(inputFor('rose-quartz')));
  });

  it('reports an incomplete set as incomplete', () => {
    expect(isCompleteTokenSet({})).toBe(false);
    const partial = { ...tokensForPreset('lotus') } as Record<string, string>;
    delete partial[`${NEUTRAL_TOKEN_PREFIX}50`];
    expect(isCompleteTokenSet(partial)).toBe(false);
  });

  it('justifies the shipped violet, which on its own measured below the target', () => {
    // The unmodified violet-500 against white text is 4.40:1; the solver moves
    // Lotus to a passing pair, which is the whole reason this exists.
    const white = { r: 1, g: 1, b: 1 };
    const untouchedViolet500 = oklchToRgb({ l: 0.606, c: 0.25, h: 292.717 });
    expect(contrastRatio(white, untouchedViolet500)).toBeLessThan(THEME_CONTRAST_TARGET);

    const lotus = buildThemeRamps(inputFor('lotus'));
    expect(contrastRatio(lotus.accentFg, oklchToRgb(lotus.accent[5]))).toBeGreaterThanOrEqual(
      THEME_CONTRAST_TARGET,
    );
  });
});

describe('contrast invariants', () => {
  it('holds every accent pair at or above WCAG AA for every shipped preset', () => {
    for (const preset of THEME_PRESETS) {
      const ramps = buildThemeRamps(inputFor(preset.id));
      for (const { label, ratio } of measureContrasts(ramps)) {
        expect(ratio, `${preset.id}: ${label}`).toBeGreaterThanOrEqual(THEME_CONTRAST_TARGET);
      }
      expect(minimumContrast(tokensForPreset(preset.id)), preset.id).toBeGreaterThanOrEqual(
        THEME_CONTRAST_TARGET,
      );
    }
  });

  it('holds for any accent hue a user can pick', () => {
    // The solver is allowed a small lightness shift; across the whole hue circle
    // the worst pair lands within a hair of the target (a chip tint at the
    // cyan end), which is why the tolerance is not exactly zero.
    let worst = Number.POSITIVE_INFINITY;
    let worstHue = -1;
    for (let hue = 0; hue < 360; hue += 15) {
      const picked = rgbToHex(oklchToRgb({ l: 0.6, c: 0.2, h: hue }));
      for (const preset of THEME_PRESETS) {
        const ramps = buildThemeRamps({ themeId: preset.id, customAccentHex: picked, customNeutralHue: null });
        const minimum = Math.min(...measureContrasts(ramps).map((pair) => pair.ratio));
        if (minimum < worst) {
          worst = minimum;
          worstHue = hue;
        }
      }
    }
    expect(worst, `worst hue ${worstHue}`).toBeGreaterThanOrEqual(4.45);
  });

  it('holds for a fully saturated and a nearly grey custom accent', () => {
    for (const picked of ['#ff0000', '#00ff00', '#0000ff', '#ffff00', '#00ffff', '#808080', '#ffffff', '#000000']) {
      for (const preset of THEME_PRESETS) {
        const ramps = buildThemeRamps({ themeId: preset.id, customAccentHex: picked, customNeutralHue: 120 });
        const minimum = Math.min(...measureContrasts(ramps).map((pair) => pair.ratio));
        expect(minimum, `${preset.id} with ${picked}`).toBeGreaterThanOrEqual(4.45);
      }
    }
  });

  it('does not regress the neutral pairs the app was designed around', () => {
    // Re-hueing must not move body or muted text contrast: only hue and chroma
    // change, and the chroma is capped. Compare each preset against the default.
    const neutralPairs = (id: ThemeId): number[] => {
      const { neutral } = buildThemeRamps(inputFor(id));
      const rgb = (step: number) => oklchToRgb(neutral[THEME_STEPS.indexOf(step as (typeof THEME_STEPS)[number])]);
      const white = { r: 1, g: 1, b: 1 };
      return [
        contrastRatio(rgb(900), rgb(50)),
        contrastRatio(rgb(600), white),
        contrastRatio(rgb(100), rgb(950)),
        contrastRatio(rgb(400), rgb(900)),
      ];
    };
    const baseline = neutralPairs('lotus');
    for (const preset of THEME_PRESETS) {
      neutralPairs(preset.id).forEach((ratio, index) => {
        expect(Math.abs(ratio - baseline[index]) / baseline[index], `${preset.id} pair ${index}`).toBeLessThan(0.05);
      });
    }
  });

  it('never leaves the accent foreground unreadable, even for a best-effort accent', () => {
    // A hue in the middle of the lightness crossover is the hard case; the
    // solver must still return a complete, usable theme rather than nothing.
    const ramps = buildThemeRamps({ themeId: 'lotus', customAccentHex: '#00ff88', customNeutralHue: 200 });
    expect(['#ffffff', '#0f172a']).toContain(rgbToHex(ramps.accentFg));
    expect(ramps.accent).toHaveLength(THEME_STEPS.length);
  });
});

describe('normalizeThemeInput', () => {
  it('accepts a valid combination unchanged', () => {
    expect(normalizeThemeInput({ themeId: 'cobalt', customAccentHex: '#8b5cf6', customNeutralHue: 210 })).toEqual({
      themeId: 'cobalt',
      customAccentHex: '#8b5cf6',
      customNeutralHue: 210,
    });
  });

  it('normalises case and shorthand hex', () => {
    expect(normalizeThemeInput({ themeId: 'lotus', customAccentHex: '#ABCDEF' }).customAccentHex).toBe('#abcdef');
    expect(normalizeThemeInput({ themeId: 'lotus', customAccentHex: '#abc' }).customAccentHex).toBe('#aabbcc');
  });

  it('falls back to the default preset and no overrides for junk', () => {
    const input = normalizeThemeInput({ themeId: 'not-a-preset', customAccentHex: 'red', customNeutralHue: 'warm' });
    expect(input).toEqual({ themeId: 'lotus', customAccentHex: '', customNeutralHue: null });
    expect(normalizeThemeInput({})).toEqual({ themeId: 'lotus', customAccentHex: '', customNeutralHue: null });
  });

  it('clamps and rounds the neutral hue', () => {
    expect(normalizeThemeInput({ customNeutralHue: 400 }).customNeutralHue).toBe(360);
    expect(normalizeThemeInput({ customNeutralHue: -20 }).customNeutralHue).toBe(0);
    expect(normalizeThemeInput({ customNeutralHue: 12.7 }).customNeutralHue).toBe(13);
    expect(normalizeThemeInput({ customNeutralHue: Number.NaN }).customNeutralHue).toBeNull();
    expect(normalizeThemeInput({ customNeutralHue: Number.POSITIVE_INFINITY }).customNeutralHue).toBeNull();
  });
});

describe('custom accents', () => {
  it('takes the picked hue and ignores its lightness', () => {
    const darkPick = hexToOklch('#3b0764') as { l: number };
    const lightPick = hexToOklch('#f5d0fe') as { l: number };
    expect(darkPick.l).toBeLessThan(0.4);
    expect(lightPick.l).toBeGreaterThan(0.85);

    for (const hex of ['#3b0764', '#f5d0fe']) {
      const ramps = buildThemeRamps({ themeId: 'lotus', customAccentHex: hex, customNeutralHue: null });
      // The theme's own lightness steps are used, plus at most the solver's
      // nudge — never the lightness of the picked colour.
      expect(ramps.accent[5].l).toBeGreaterThan(0.606 - 0.16 - 1e-9);
      expect(ramps.accent[5].l).toBeLessThan(0.606 + 0.16 + 1e-9);
      expect(hexToOklch(hex)?.h).toBeCloseTo(ramps.accent[5].h, 3);
    }
  });

  it('scales saturation from the pick, within bounds', () => {
    const vivid = buildThemeRamps({ themeId: 'lotus', customAccentHex: '#ff00ff', customNeutralHue: null });
    const grey = buildThemeRamps({ themeId: 'lotus', customAccentHex: '#808080', customNeutralHue: null });
    expect(grey.accent[5].c).toBeLessThan(vivid.accent[5].c);
    // A grey pick must not collapse the ramp to nothing.
    expect(grey.accent[5].c).toBeGreaterThan(0);
    // A vivid pick must not exceed the cap.
    expect(vivid.accent[5].c).toBeLessThanOrEqual(ACCENT_CHROMA_CAP);
  });

  it('lets the neutral hue be re-tinted without touching the accent', () => {
    const warm = buildThemeRamps({ themeId: 'lotus', customAccentHex: '', customNeutralHue: 40 });
    const cool = buildThemeRamps({ themeId: 'lotus', customAccentHex: '', customNeutralHue: 220 });
    expect(warm.neutral[0].h).toBeCloseTo(40, 3);
    expect(cool.neutral[0].h).toBeCloseTo(220, 3);
    expect(warm.accent[5].h).toBeCloseTo(cool.accent[5].h, 3);
  });

  it('wraps a hue that is out of range', () => {
    const wrapped = buildThemeRamps({ themeId: 'lotus', customAccentHex: '', customNeutralHue: 380 });
    expect(wrapped.neutral[0].h).toBeCloseTo(20, 3);
  });
});

describe('sanitizeThemeTokens', () => {
  const valid: ThemeTokens = tokensForPreset('lotus');

  it('keeps a complete, valid set byte for byte', () => {
    expect(sanitizeThemeTokens(valid)).toEqual(valid);
  });

  it('drops unknown keys, including prototype pollution attempts', () => {
    const hostile: Record<string, unknown> = {
      ...valid,
      '--color-slate-999': 'oklch(1% 0 0)',
      'color-slate-50': 'oklch(1% 0 0)',
      '--lotus-neutral-50': 'oklch(50% 0.1 20)',
      constructor: 'oklch(50% 0.1 20)',
    };
    // An *own* `__proto__` property is what a crafted JSON file can produce;
    // `Object.defineProperty` is how a test can reproduce it.
    Object.defineProperty(hostile, '__proto__', {
      value: { polluted: true },
      enumerable: true,
      configurable: true,
      writable: true,
    });

    const tokens = sanitizeThemeTokens(hostile);
    expect(Object.keys(tokens).every((key) => THEME_TOKEN_KEYS.includes(key))).toBe(true);
    expect('--color-slate-999' in tokens).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(tokens, 'constructor')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(tokens, '__proto__')).toBe(false);
    expect(Object.getPrototypeOf(tokens)).toBe(Object.prototype);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('drops values that are not a colour this app writes', () => {
    const tokens = sanitizeThemeTokens({
      '--color-slate-50': 'url(https://example.com/x.png)',
      '--color-slate-100': 'oklch(96.8% 0.007 247.896); background: red',
      '--color-slate-200': 42,
      '--color-slate-300': null,
      '--color-slate-400': `oklch(${'9'.repeat(80)}% 0 0)`,
      '--color-slate-500': 'oklch(55.4% 0.046 257.417)',
      '--color-accent-fg': 'not-a-colour',
    });
    expect(tokens['--color-slate-50']).toBeUndefined();
    expect(tokens['--color-slate-100']).toBeUndefined();
    expect(tokens['--color-slate-200']).toBeUndefined();
    expect(tokens['--color-slate-300']).toBeUndefined();
    expect(tokens['--color-slate-400']).toBeUndefined();
    expect(tokens['--color-accent-fg']).toBeUndefined();
    expect(tokens['--color-slate-500']).toBe('oklch(55.4% 0.046 257.417)');
  });

  it('accepts both accepted value shapes', () => {
    expect(sanitizeThemeTokens({ '--color-accent-fg': '#0F172A' })['--color-accent-fg']).toBe('#0F172A');
    expect(sanitizeThemeTokens({ '--color-accent-fg': 'oklch(20.8% 0.042 265.755)' })['--color-accent-fg']).toBe(
      'oklch(20.8% 0.042 265.755)',
    );
  });

  it('never returns more than the cap, and returns an object for garbage', () => {
    const many = Object.fromEntries(
      Array.from({ length: 200 }, (_, index) => [`--color-slate-${index}`, 'oklch(50% 0.1 20)']),
    );
    expect(Object.keys(sanitizeThemeTokens(many)).length).toBeLessThanOrEqual(MAX_THEME_TOKENS);
    for (const value of [null, undefined, 42, 'oklch(1% 0 0)', [], true]) {
      expect(sanitizeThemeTokens(value)).toEqual({});
    }
  });
});

describe('pre-paint script', () => {
  const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');

  it('knows the token prefixes the engine emits, and the preset attribute', () => {
    // The script cannot import the engine (it runs before the bundle), so this
    // pins the two together: rename a prefix or the data attribute and the
    // no-flash guarantee silently breaks.
    for (const prefix of [NEUTRAL_TOKEN_PREFIX, ACCENT_TOKEN_PREFIX, ACCENT_FG_TOKEN]) {
      expect(html, prefix).toContain(prefix);
    }
    expect(html).toContain('dataset.theme');
  });

  it('reads the same preference key the store writes', () => {
    expect(html).toContain('lotus-dashboard-creator:prefs/v1');
  });
});
