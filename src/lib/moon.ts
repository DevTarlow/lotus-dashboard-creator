/**
 * Moon phase for an instant — the mean synodic cycle, in pure TypeScript.
 *
 * A phase is just the position within the synodic month, so this counts days
 * from a known new moon (2000-01-06 18:14 UTC, the conventional mean-lunation
 * epoch) and divides by the mean synodic month of 29.530588853 days. The
 * illuminated fraction then follows from the phase angle as
 * `(1 - cos(2π · fraction)) / 2`.
 *
 * This is deliberately the *mean* cycle rather than a full ephemeris: it stays
 * a handful of lines with no tables, and it lands within a few hours of the
 * published new and full moon instants the tests check against the US Naval
 * Observatory. The Moon's elliptical orbit swings real phases by up to ~7 hours
 * either side of the mean, so treat this as a dashboard glyph and label, not as
 * an observing almanac.
 */

const SYNODIC_MONTH_DAYS = 29.530588853;
const MS_PER_DAY = 86_400_000;

/** The new moon of 2000-01-06 18:14 UTC, from which everything is counted. */
const NEW_MOON_EPOCH_MS = Date.UTC(2000, 0, 6, 18, 14, 0);

/** Half-width of a principal phase band: 1/32 of a cycle, i.e. ±0.03125. */
const PRINCIPAL_BAND = 1 / 32;

export type MoonPhaseName =
  | 'new'
  | 'waxing-crescent'
  | 'first-quarter'
  | 'waxing-gibbous'
  | 'full'
  | 'waning-gibbous'
  | 'last-quarter'
  | 'waning-crescent';

export interface MoonInfo {
  phase: MoonPhaseName;
  /** Human label, e.g. "Waxing gibbous". */
  label: string;
  /** Synodic fraction 0..1: 0 = new, 0.25 = first quarter, 0.5 = full, 0.75 = last quarter. */
  fraction: number;
  /** Illuminated fraction of the disc, 0..1. */
  illumination: number;
  /** Days since the last new moon, 0..29.53. */
  ageDays: number;
  waxing: boolean;
  emoji: string;
}

/**
 * The eight phase bands, as upper bounds in cycle order.
 *
 * Each of the eight names owns an equal 1/8 of the cycle; the four principal
 * phases keep only the middle half of their band (±1/32), which leaves the
 * crescents and gibbous phases to fill the rest. The 'new' band wraps through
 * 1, so it is both the first entry here and the fallback below.
 */
const PHASE_BANDS: readonly { readonly upTo: number; readonly phase: MoonPhaseName }[] = [
  { upTo: PRINCIPAL_BAND, phase: 'new' },
  { upTo: 0.25 - PRINCIPAL_BAND, phase: 'waxing-crescent' },
  { upTo: 0.25 + PRINCIPAL_BAND, phase: 'first-quarter' },
  { upTo: 0.5 - PRINCIPAL_BAND, phase: 'waxing-gibbous' },
  { upTo: 0.5 + PRINCIPAL_BAND, phase: 'full' },
  { upTo: 0.75 - PRINCIPAL_BAND, phase: 'waning-gibbous' },
  { upTo: 0.75 + PRINCIPAL_BAND, phase: 'last-quarter' },
  { upTo: 1 - PRINCIPAL_BAND, phase: 'waning-crescent' },
];

const PHASE_LABELS: Record<MoonPhaseName, string> = {
  new: 'New moon',
  'waxing-crescent': 'Waxing crescent',
  'first-quarter': 'First quarter',
  'waxing-gibbous': 'Waxing gibbous',
  full: 'Full moon',
  'waning-gibbous': 'Waning gibbous',
  'last-quarter': 'Last quarter',
  'waning-crescent': 'Waning crescent',
};

const PHASE_EMOJI: Record<MoonPhaseName, string> = {
  new: '🌑',
  'waxing-crescent': '🌒',
  'first-quarter': '🌓',
  'waxing-gibbous': '🌔',
  full: '🌕',
  'waning-gibbous': '🌖',
  'last-quarter': '🌗',
  'waning-crescent': '🌘',
};

/** The band `fraction` falls in; past the last bound the cycle has wrapped to 'new'. */
function phaseFromFraction(fraction: number): MoonPhaseName {
  return PHASE_BANDS.find((band) => fraction < band.upTo)?.phase ?? 'new';
}

/** Phase, label, illumination and age for the instant `date`. */
export function moonInfo(date: Date): MoonInfo {
  const time = date.getTime();
  // An invalid date has no phase of its own; the epoch's new moon is the
  // documented fallback, so callers never have to guard a NaN timestamp.
  const days = Number.isFinite(time) ? (time - NEW_MOON_EPOCH_MS) / MS_PER_DAY : 0;
  const fraction = (((days / SYNODIC_MONTH_DAYS) % 1) + 1) % 1;
  const phase = phaseFromFraction(fraction);

  return {
    phase,
    label: PHASE_LABELS[phase],
    fraction,
    illumination: (1 - Math.cos(2 * Math.PI * fraction)) / 2,
    ageDays: fraction * SYNODIC_MONTH_DAYS,
    // The exact new moon opens the waxing half, the exact full moon the waning half.
    waxing: fraction < 0.5,
    emoji: PHASE_EMOJI[phase],
  };
}
