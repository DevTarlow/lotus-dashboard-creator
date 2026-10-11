/**
 * Colour maths for theming.
 *
 * The theme engine works in OKLCH because it re-hues Tailwind's scales: it keeps
 * the *lightness* of every step (which is what makes the app readable in the
 * first place) and only replaces hue and chroma. Doing that needs a perceptual
 * colour space with a lightness axis, and sRGB contrast maths to prove the
 * result still passes WCAG.
 *
 * Everything here is pure and dependency-free so it can be unit tested in plain
 * Node. Conventions:
 *
 *   - `Rgb` channels are gamma-encoded sRGB in `0..1` (what `rgb()` displays),
 *     clamped to the gamut unless stated otherwise.
 *   - `Oklch.l` is `0..1` (not a percentage), `c` is absolute chroma and `h` is
 *     degrees.
 *   - Out-of-gamut OKLCH is expected: a user may pick a hue whose chroma cannot
 *     be displayed at every step. Browsers gamut-map CSS colours; here we clamp,
 *     which is what WCAG contrast should be measured against anyway.
 */

/** Gamma-encoded sRGB, channels in `0..1`. */
export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** OKLCH: perceptual lightness `0..1`, chroma and hue (degrees). */
export interface Oklch {
  l: number;
  c: number;
  h: number;
}

const HEX_PATTERN = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/** Decode one gamma-encoded sRGB channel to linear light. */
export function srgbToLinear(channel: number): number {
  const value = clamp(channel, 0, 1);
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

/** Encode one linear-light channel to gamma-encoded sRGB. */
export function linearToSrgb(channel: number): number {
  const value = clamp(channel, 0, 1);
  return value <= 0.0031308 ? 12.92 * value : 1.055 * value ** (1 / 2.4) - 0.055;
}

/** Parse `#rgb` / `#rrggbb` (with or without the hash) into sRGB, or `null`. */
export function parseHex(value: unknown): Rgb | null {
  if (typeof value !== 'string') return null;
  const match = HEX_PATTERN.exec(value.trim());
  if (!match) return null;
  const digits = match[1];
  const full =
    digits.length === 3
      ? digits
          .split('')
          .map((digit) => digit + digit)
          .join('')
      : digits;
  return {
    r: parseInt(full.slice(0, 2), 16) / 255,
    g: parseInt(full.slice(2, 4), 16) / 255,
    b: parseInt(full.slice(4, 6), 16) / 255,
  };
}

/** Format sRGB as `#rrggbb`. Channels are clamped, so this always yields a colour. */
export function rgbToHex(rgb: Rgb): string {
  const channel = (value: number) =>
    Math.round(clamp(value, 0, 1) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${channel(rgb.r)}${channel(rgb.g)}${channel(rgb.b)}`;
}

/** OKLCH → linear-light sRGB (not clamped: the result may leave the gamut). */
export function oklchToLinearRgb(color: Oklch): Rgb {
  const radians = (color.h * Math.PI) / 180;
  const a = color.c * Math.cos(radians);
  const b = color.c * Math.sin(radians);

  // OKLab → LMS, then cube to reach the cone response.
  const lRoot = color.l + 0.3963377774 * a + 0.2158037573 * b;
  const mRoot = color.l - 0.1055613458 * a - 0.0638541728 * b;
  const sRoot = color.l - 0.0894841775 * a - 1.291485548 * b;
  const l = lRoot ** 3;
  const m = mRoot ** 3;
  const s = sRoot ** 3;

  return {
    r: 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    g: -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    b: -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  };
}

/** OKLCH → gamma-encoded, gamut-clamped sRGB. */
export function oklchToRgb(color: Oklch): Rgb {
  const linear = oklchToLinearRgb(color);
  return {
    r: linearToSrgb(linear.r),
    g: linearToSrgb(linear.g),
    b: linearToSrgb(linear.b),
  };
}

/** Gamma-encoded sRGB → OKLCH. */
export function rgbToOklch(rgb: Rgb): Oklch {
  const r = srgbToLinear(rgb.r);
  const g = srgbToLinear(rgb.g);
  const b = srgbToLinear(rgb.b);

  // Linear sRGB → LMS.
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);

  const lightness = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const bb = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;

  const chroma = Math.sqrt(a * a + bb * bb);
  // A neutral has no meaningful hue; report 0 rather than noise from rounding.
  const hue = chroma < 1e-6 ? 0 : ((Math.atan2(bb, a) * 180) / Math.PI + 360) % 360;
  return { l: lightness, c: chroma, h: hue };
}

/** Parse a hex colour straight to OKLCH, or `null` when it is not a hex colour. */
export function hexToOklch(value: unknown): Oklch | null {
  const rgb = parseHex(value);
  return rgb ? rgbToOklch(rgb) : null;
}

/**
 * Render OKLCH as a CSS colour, rounding to the precision Tailwind itself uses
 * (`oklch(98.4% 0.003 247.858)`) so generated tokens stay short and diffable.
 */
export function formatOklch(color: Oklch): string {
  const percent = (color.l * 100).toFixed(1);
  const chroma = color.c.toFixed(3);
  const hue = color.h.toFixed(3);
  return `oklch(${percent}% ${chroma} ${hue})`;
}

/** WCAG relative luminance of a gamma-encoded sRGB colour. */
export function relativeLuminance(rgb: Rgb): number {
  return (
    0.2126 * srgbToLinear(rgb.r) +
    0.7152 * srgbToLinear(rgb.g) +
    0.0722 * srgbToLinear(rgb.b)
  );
}

/** WCAG contrast ratio, `1..21`, order independent. */
export function contrastRatio(a: Rgb, b: Rgb): number {
  const first = relativeLuminance(a);
  const second = relativeLuminance(b);
  const lighter = Math.max(first, second);
  const darker = Math.min(first, second);
  return (lighter + 0.05) / (darker + 0.05);
}

/** Alpha-composite `fg` over `bg`, as a browser would paint a `/15` utility. */
export function compositeOver(fg: Rgb, alpha: number, bg: Rgb): Rgb {
  const amount = clamp(alpha, 0, 1);
  return {
    r: fg.r * amount + bg.r * (1 - amount),
    g: fg.g * amount + bg.g * (1 - amount),
    b: fg.b * amount + bg.b * (1 - amount),
  };
}
