/**
 * Theme presets and the token engine.
 *
 * ## Why this exists
 *
 * The app is written with ~1,300 hardcoded `slate-*` and `violet-*` Tailwind
 * utilities. Rather than rewrite every call site, a theme re-points the two
 * *scales* those utilities read: Tailwind v4 compiles `bg-slate-900` to
 * `background-color: var(--color-slate-900)`, so overriding that custom property
 * re-hues the whole application at once. A preset therefore only needs to
 * produce a neutral ramp, an accent ramp and an accent foreground.
 *
 * ## How a ramp is built
 *
 * Every step keeps the **lightness** of Tailwind's own scale (`slate` for the
 * neutrals, `violet` for the accent) and only changes hue and chroma. That is
 * what keeps the existing contrast decisions valid: the app's readability comes
 * from those lightness steps, and one ramp stays correct in both light and dark
 * mode because light mode uses the low steps for surfaces and the high steps for
 * text, while dark mode does the reverse — exactly as the components author it.
 *
 * ## The accent foreground
 *
 * Putting white text on a mid-lightness accent cannot be assumed to pass WCAG
 * for every hue (the shipped violet already measured 4.40:1 on `violet-500`).
 * So the engine solves for a foreground and a small uniform lightness shift that
 * keeps every accent pair the UI actually renders at or above
 * {@link THEME_CONTRAST_TARGET}. See {@link measureContrasts} for the pairs.
 *
 * Pure by construction: no DOM, no storage, no React. The store applies the
 * tokens, `index.html` re-applies the cached ones before first paint.
 */
import {
  compositeOver,
  contrastRatio,
  formatOklch,
  hexToOklch,
  oklchToRgb,
  rgbToHex,
  type Oklch,
  type Rgb,
} from '@/lib/color';
import type { ThemeId, ThemeTokens } from '@/types';

/** Steps of both ramps, in Tailwind's own order. */
export const THEME_STEPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950] as const;

/** Custom-property names the theme writes, and the only keys it will accept. */
export const NEUTRAL_TOKEN_PREFIX = '--color-slate-';
export const ACCENT_TOKEN_PREFIX = '--color-violet-';
export const ACCENT_FG_TOKEN = '--color-accent-fg';

/** Prefixes the pre-paint script in `index.html` recognises. Keep in step. */
export const THEME_TOKEN_PREFIXES = [NEUTRAL_TOKEN_PREFIX, ACCENT_TOKEN_PREFIX] as const;

/** Chroma ceilings: enough tint to read as a theme, not enough to wreck contrast. */
export const NEUTRAL_CHROMA_CAP = 0.06;
export const ACCENT_CHROMA_CAP = 0.26;

/** How a user-picked accent's saturation is allowed to scale the reference ramp. */
const CUSTOM_ACCENT_MIN_FACTOR = 0.3;
const CUSTOM_ACCENT_MAX_FACTOR = 1.3;

/** WCAG AA for normal text. Every accent pair below is held to this. */
export const THEME_CONTRAST_TARGET = 4.5;

/** Upper bound on the accent lightness shift the solver may apply. */
const LIGHTNESS_SHIFT_LIMIT = 0.16;
const LIGHTNESS_SHIFT_STEP = 0.005;
const LIGHTNESS_FLOOR = 0.05;
const LIGHTNESS_CEILING = 0.995;

/** How many cached tokens a `sanitizeThemeTokens` result may carry. */
export const MAX_THEME_TOKENS = 32;

/**
 * A preset is data, not code: two hues and two chroma factors.
 *
 * `chromaFactor` scales Tailwind's own chroma profile for that ramp, so `1` is
 * "as saturated as slate/violet" and `0.4` is "nearly grey".
 */
export interface ThemePreset {
  id: ThemeId;
  name: string;
  /** One line shown under the preset name in the picker. */
  description: string;
  /** Display grouping in the picker. Temperature, deliberately not gender. */
  group: 'neutral' | 'warm' | 'cool' | 'bold';
  accent: { hue: number; chromaFactor: number };
  neutral: { hue: number; chromaFactor: number };
}

/**
 * Reference lightness and chroma per step, copied from Tailwind's theme
 * (`node_modules/tailwindcss/theme.css`): `slate-*` here, `violet-*` below.
 *
 * Exported so `theme.test.ts` can pin them against Tailwind's published scale: a
 * Tailwind upgrade that retunes one of these must fail a test rather than
 * silently restyle every theme.
 */
export const NEUTRAL_REFERENCE_STEPS: readonly { step: number; l: number; c: number }[] = [
  { step: 50, l: 0.984, c: 0.003 },
  { step: 100, l: 0.968, c: 0.007 },
  { step: 200, l: 0.929, c: 0.013 },
  { step: 300, l: 0.869, c: 0.022 },
  { step: 400, l: 0.704, c: 0.04 },
  { step: 500, l: 0.554, c: 0.046 },
  { step: 600, l: 0.446, c: 0.043 },
  { step: 700, l: 0.372, c: 0.044 },
  { step: 800, l: 0.279, c: 0.041 },
  { step: 900, l: 0.208, c: 0.042 },
  { step: 950, l: 0.129, c: 0.042 },
];

export const ACCENT_REFERENCE_STEPS: readonly { step: number; l: number; c: number }[] = [
  { step: 50, l: 0.969, c: 0.016 },
  { step: 100, l: 0.943, c: 0.029 },
  { step: 200, l: 0.894, c: 0.057 },
  { step: 300, l: 0.811, c: 0.111 },
  { step: 400, l: 0.702, c: 0.183 },
  { step: 500, l: 0.606, c: 0.25 },
  { step: 600, l: 0.541, c: 0.281 },
  { step: 700, l: 0.491, c: 0.27 },
  { step: 800, l: 0.432, c: 0.232 },
  { step: 900, l: 0.38, c: 0.189 },
  { step: 950, l: 0.283, c: 0.141 },
];

/** Chroma of the reference accent 500; custom accents scale relative to it. */
const REFERENCE_ACCENT_CHROMA = ACCENT_REFERENCE_STEPS[5].c;

/**
 * Candidate accent foregrounds. White first, so a passing white is preferred,
 * which keeps the primary button looking like the design it replaced.
 * `#0f172a` is slate-900: a deep ink that reads better than pure black on light
 * accents (amber, lime, cyan).
 */
const FOREGROUND_CANDIDATES: readonly { hex: string; rgb: Rgb }[] = [
  { hex: '#ffffff', rgb: { r: 1, g: 1, b: 1 } },
  { hex: '#0f172a', rgb: { r: 15 / 255, g: 23 / 255, b: 42 / 255 } },
];

const WHITE: Rgb = { r: 1, g: 1, b: 1 };

/** Token keys the engine emits, in a stable order. */
export const THEME_TOKEN_KEYS: readonly string[] = [
  ...NEUTRAL_REFERENCE_STEPS.map(({ step }) => `${NEUTRAL_TOKEN_PREFIX}${step}`),
  ...ACCENT_REFERENCE_STEPS.map(({ step }) => `${ACCENT_TOKEN_PREFIX}${step}`),
  ACCENT_FG_TOKEN,
];

/**
 * The roster.
 *
 * Grouped by temperature in the picker rather than by "for him / for her": the
 * palette does the talking, and a user looking for a softer or bolder look finds
 * it by feel instead of by label.
 */
const PRESETS = [
  {
    id: 'lotus',
    name: 'Lotus',
    description: 'The original purple, on cool grey.',
    group: 'neutral',
    accent: { hue: 292.717, chromaFactor: 1 },
    neutral: { hue: 257.417, chromaFactor: 1 },
  },
  {
    id: 'graphite',
    name: 'Graphite',
    description: 'Almost no colour at all — just grey.',
    group: 'neutral',
    accent: { hue: 265, chromaFactor: 0.5 },
    neutral: { hue: 265, chromaFactor: 0.4 },
  },
  {
    id: 'rose-quartz',
    name: 'Rose Quartz',
    description: 'Soft pink, on warm greys.',
    group: 'warm',
    accent: { hue: 354, chromaFactor: 0.76 },
    neutral: { hue: 20, chromaFactor: 1.4 },
  },
  {
    id: 'lavender-haze',
    name: 'Lavender Haze',
    description: 'Lilac, with lilac-tinted cards.',
    group: 'warm',
    accent: { hue: 300, chromaFactor: 0.68 },
    neutral: { hue: 300, chromaFactor: 1.3 },
  },
  {
    id: 'peach-fizz',
    name: 'Peach Fizz',
    description: 'Coral, on warm cream.',
    group: 'warm',
    accent: { hue: 35, chromaFactor: 0.64 },
    neutral: { hue: 60, chromaFactor: 1.3 },
  },
  {
    id: 'fuchsia-bloom',
    name: 'Fuchsia Bloom',
    description: 'Bright magenta over deep plum.',
    group: 'bold',
    accent: { hue: 330, chromaFactor: 1.08 },
    neutral: { hue: 320, chromaFactor: 1.2 },
  },
  {
    id: 'cobalt',
    name: 'Cobalt',
    description: 'Deep blue, on cool grey.',
    group: 'cool',
    accent: { hue: 262, chromaFactor: 0.88 },
    neutral: { hue: 265, chromaFactor: 1.2 },
  },
  {
    id: 'emerald-slate',
    name: 'Emerald Slate',
    description: 'Green, with cool grey everywhere else.',
    group: 'cool',
    accent: { hue: 155, chromaFactor: 0.64 },
    neutral: { hue: 160, chromaFactor: 1 },
  },
  {
    id: 'amber-forge',
    name: 'Amber Forge',
    description: 'Amber over warm charcoal.',
    group: 'bold',
    accent: { hue: 70, chromaFactor: 0.68 },
    neutral: { hue: 45, chromaFactor: 1.5 },
  },
  {
    id: 'crimson-carbon',
    name: 'Crimson Carbon',
    description: 'Red, with near-grey cards.',
    group: 'bold',
    accent: { hue: 25, chromaFactor: 0.88 },
    neutral: { hue: 20, chromaFactor: 0.8 },
  },
] as const satisfies readonly ThemePreset[];

export const THEME_PRESETS: readonly ThemePreset[] = PRESETS;

const PRESETS_BY_ID = new Map<string, ThemePreset>(PRESETS.map((preset) => [preset.id, preset]));

/** `true` for a preset id this build knows about. */
export function isThemeId(value: unknown): value is ThemeId {
  return typeof value === 'string' && PRESETS_BY_ID.has(value);
}

/** Look a preset up, falling back to the default so callers never handle null. */
export function getThemePreset(id: ThemeId): ThemePreset {
  return PRESETS_BY_ID.get(id) ?? (PRESETS[0] as ThemePreset);
}

/** Inputs a theme is resolved from: a base preset plus the user's overrides. */
export interface ResolvedThemeInput {
  themeId: ThemeId;
  /** `#rrggbb`, or `''` to use the preset's accent. */
  customAccentHex: string;
  /** `0..360`, or `null` to use the preset's neutral hue. */
  customNeutralHue: number | null;
}

/** A resolved theme, before it is formatted into CSS custom properties. */
export interface ThemeRamps {
  preset: ThemePreset;
  neutral: readonly Oklch[];
  accent: readonly Oklch[];
  accentFg: Rgb;
  /** Uniform lightness shift the contrast solver applied to the accent ramp. */
  accentShift: number;
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/** Normalise a hue into `0..360`. */
function wrapHue(hue: number): number {
  return ((hue % 360) + 360) % 360;
}

/** One ramp: reference lightness, re-hued, with chroma scaled and capped. */
function buildRamp(
  reference: readonly { step: number; l: number; c: number }[],
  hue: number,
  chromaFactor: number,
  chromaCap: number,
  lightnessShift = 0,
): readonly Oklch[] {
  return reference.map(({ l, c }) => ({
    l: clamp(l + lightnessShift, LIGHTNESS_FLOOR, LIGHTNESS_CEILING),
    c: Math.min(chromaCap, c * chromaFactor),
    h: wrapHue(hue),
  }));
}

function at(ramp: readonly Oklch[], step: (typeof THEME_STEPS)[number]): Rgb {
  return oklchToRgb(ramp[THEME_STEPS.indexOf(step)]);
}

/**
 * Every accent contrast pair the interface actually renders, in one place.
 *
 * Kept as data so the solver and the tests cannot disagree about what "readable"
 * means: if a component starts using a new accent pair, it belongs here.
 */
const CONTRAST_PAIRS: readonly {
  label: string;
  ratio: (accent: readonly Oklch[], neutral: readonly Oklch[], fg: Rgb) => number;
}[] = [
  { label: 'accent foreground on accent-600', ratio: (a, _n, fg) => contrastRatio(fg, at(a, 600)) },
  { label: 'accent foreground on accent-500', ratio: (a, _n, fg) => contrastRatio(fg, at(a, 500)) },
  { label: 'accent-600 text on a white card', ratio: (a) => contrastRatio(at(a, 600), WHITE) },
  { label: 'accent-600 text on the canvas', ratio: (a, n) => contrastRatio(at(a, 600), at(n, 50)) },
  { label: 'accent-700 chip text on accent-100', ratio: (a) => contrastRatio(at(a, 700), at(a, 100)) },
  { label: 'accent-300 text on the dark page', ratio: (a, n) => contrastRatio(at(a, 300), at(n, 950)) },
  { label: 'accent-300 text on a dark panel', ratio: (a, n) => contrastRatio(at(a, 300), at(n, 900)) },
  { label: 'accent-300 text on a raised dark surface', ratio: (a, n) => contrastRatio(at(a, 300), at(n, 800)) },
  {
    label: 'accent-300 chip text on accent-500/15',
    ratio: (a, n) => contrastRatio(at(a, 300), compositeOver(at(a, 500), 0.15, at(n, 900))),
  },
];

/** Contrast of every pair above, for a resolved theme. */
export function measureContrasts(
  ramps: Pick<ThemeRamps, 'accent' | 'neutral' | 'accentFg'>,
): readonly { label: string; ratio: number }[] {
  return CONTRAST_PAIRS.map(({ label, ratio }) => ({
    label,
    ratio: ratio(ramps.accent, ramps.neutral, ramps.accentFg),
  }));
}

function worstContrast(accent: readonly Oklch[], neutral: readonly Oklch[], fg: Rgb): number {
  return Math.min(...measureContrasts({ accent, neutral, accentFg: fg }).map((pair) => pair.ratio));
}

/**
 * Choose the accent foreground and the smallest lightness shift that keeps every
 * pair readable.
 *
 * Shifts are tried in order of magnitude, so a theme that already passes is left
 * exactly as authored and only a problematic hue is nudged. If no combination
 * reaches the target (possible for an extreme custom hue), the best available
 * result is used rather than failing — the app must still render.
 */
function solveAccent(
  hue: number,
  chromaFactor: number,
  neutral: readonly Oklch[],
): { ramp: readonly Oklch[]; accentFg: Rgb; shift: number } {
  for (let magnitude = 0; magnitude <= LIGHTNESS_SHIFT_LIMIT + 1e-9; magnitude += LIGHTNESS_SHIFT_STEP) {
    const shifts = magnitude === 0 ? [0] : [-magnitude, magnitude];
    for (const shift of shifts) {
      const ramp = buildRamp(ACCENT_REFERENCE_STEPS, hue, chromaFactor, ACCENT_CHROMA_CAP, shift);
      for (const candidate of FOREGROUND_CANDIDATES) {
        if (worstContrast(ramp, neutral, candidate.rgb) >= THEME_CONTRAST_TARGET) {
          return { ramp, accentFg: candidate.rgb, shift };
        }
      }
    }
  }

  let best: { ramp: readonly Oklch[]; accentFg: Rgb; shift: number } | null = null;
  let bestMinimum = -1;
  for (let shift = -LIGHTNESS_SHIFT_LIMIT; shift <= LIGHTNESS_SHIFT_LIMIT + 1e-9; shift += LIGHTNESS_SHIFT_STEP) {
    const ramp = buildRamp(ACCENT_REFERENCE_STEPS, hue, chromaFactor, ACCENT_CHROMA_CAP, shift);
    for (const candidate of FOREGROUND_CANDIDATES) {
      const minimum = worstContrast(ramp, neutral, candidate.rgb);
      if (minimum > bestMinimum) {
        bestMinimum = minimum;
        best = { ramp, accentFg: candidate.rgb, shift };
      }
    }
  }
  // Always assigned: the loop above runs at least once.
  return best as { ramp: readonly Oklch[]; accentFg: Rgb; shift: number };
}

/** Resolve a preset id plus the user's overrides into ramps. */
export function buildThemeRamps(input: ResolvedThemeInput): ThemeRamps {
  const preset = getThemePreset(isThemeId(input.themeId) ? input.themeId : 'lotus');

  // A custom accent contributes its hue and relative saturation only: the
  // lightness stays the theme's, which is what keeps text on it readable.
  const custom = hexToOklch(input.customAccentHex);
  const accentHue = custom ? custom.h : preset.accent.hue;
  const accentChromaFactor = custom
    ? clamp(custom.c / REFERENCE_ACCENT_CHROMA, CUSTOM_ACCENT_MIN_FACTOR, CUSTOM_ACCENT_MAX_FACTOR)
    : preset.accent.chromaFactor;

  const neutralHue =
    typeof input.customNeutralHue === 'number' && Number.isFinite(input.customNeutralHue)
      ? input.customNeutralHue
      : preset.neutral.hue;

  const neutral = buildRamp(NEUTRAL_REFERENCE_STEPS, neutralHue, preset.neutral.chromaFactor, NEUTRAL_CHROMA_CAP);
  const { ramp, accentFg, shift } = solveAccent(accentHue, accentChromaFactor, neutral);
  return { preset, neutral, accent: ramp, accentFg, accentShift: shift };
}

/** Resolve ramps into the CSS custom properties the app applies to `<html>`. */
export function formatThemeTokens(ramps: ThemeRamps): ThemeTokens {
  const tokens: Record<string, string> = {};
  ramps.neutral.forEach((color, index) => {
    tokens[`${NEUTRAL_TOKEN_PREFIX}${THEME_STEPS[index]}`] = formatOklch(color);
  });
  ramps.accent.forEach((color, index) => {
    tokens[`${ACCENT_TOKEN_PREFIX}${THEME_STEPS[index]}`] = formatOklch(color);
  });
  tokens[ACCENT_FG_TOKEN] = rgbToHex(ramps.accentFg);
  return tokens;
}

/** The tokens for a preset with no overrides. */
export function resolveThemeTokens(input: ResolvedThemeInput): ThemeTokens {
  return formatThemeTokens(buildThemeRamps(input));
}

/**
 * Preset tokens, memoised by id.
 *
 * The picker renders a swatch strip for every preset on each open, and resolving
 * one runs the contrast solver; caching keeps that off the render path.
 */
const presetTokenCache = new Map<ThemeId, ThemeTokens>();

export function tokensForPreset(id: ThemeId): ThemeTokens {
  const cached = presetTokenCache.get(id);
  if (cached) return cached;
  const tokens = resolveThemeTokens({ themeId: id, customAccentHex: '', customNeutralHue: null });
  presetTokenCache.set(id, tokens);
  return tokens;
}

/**
 * Coerce persisted or embedded theme inputs into something safe to use.
 *
 * A preference can come from `localStorage` or from a dashboard file somebody
 * emailed, so nothing here trusts its input: an unknown preset falls back to the
 * default, a malformed accent is dropped, a neutral hue is clamped.
 */
export function normalizeThemeInput(input: {
  themeId?: unknown;
  customAccentHex?: unknown;
  customNeutralHue?: unknown;
}): ResolvedThemeInput {
  const themeId = isThemeId(input.themeId) ? input.themeId : 'lotus';
  const accent = hexToOklch(input.customAccentHex);
  const customAccentHex = accent ? rgbToHex(oklchToRgb(accent)) : '';
  const hue = typeof input.customNeutralHue === 'number' && Number.isFinite(input.customNeutralHue)
    ? clamp(Math.round(input.customNeutralHue), 0, 360)
    : null;
  return { themeId, customAccentHex, customNeutralHue: hue };
}

/**
 * Acceptable CSS values for a theme token.
 *
 * Deliberately narrow. Tokens are applied with `style.setProperty`, so a value
 * only ever needs to be an OKLCH colour (the ramps) or a hex colour (the accent
 * foreground). Anything else is dropped rather than handed to the CSS engine.
 */
const TOKEN_VALUE_PATTERN =
  /^(?:oklch\(\s*\d{1,3}(?:\.\d+)?%\s+\d{1,2}(?:\.\d+)?\s+\d{1,3}(?:\.\d+)?\s*\)|#[0-9a-f]{6})$/i;

/** Keep only well-formed tokens with keys this build recognises. */
export function sanitizeThemeTokens(raw: unknown): ThemeTokens {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const allowed = new Set(THEME_TOKEN_KEYS);
  const tokens: Record<string, string> = {};
  let kept = 0;

  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (kept >= MAX_THEME_TOKENS) break;
    // The allow-list is also what keeps `__proto__` and friends out.
    if (!allowed.has(key)) continue;
    if (typeof value !== 'string') continue;
    const trimmed = value.trim();
    if (trimmed.length > 40 || !TOKEN_VALUE_PATTERN.test(trimmed)) continue;
    tokens[key] = trimmed;
    kept += 1;
  }

  return tokens;
}

/** The token set for a preset is complete; a cached one might not be. */
export function isCompleteTokenSet(tokens: ThemeTokens): boolean {
  return THEME_TOKEN_KEYS.every((key) => typeof tokens[key] === 'string');
}

/**
 * Equality for two token sets.
 *
 * Used to decide whether a regenerated palette is worth writing to storage: the
 * store refreshes its cached tokens on mount, and doing that on every boot would
 * churn `localStorage` (and the pre-paint cache) for no reason.
 */
export function sameThemeTokens(a: ThemeTokens, b: ThemeTokens): boolean {
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every((key) => a[key] === b[key]);
}
