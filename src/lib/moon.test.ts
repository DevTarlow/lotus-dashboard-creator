import { describe, expect, it } from 'vitest';
import { moonInfo, type MoonPhaseName } from '@/lib/moon';

/**
 * The mean synodic month and epoch the module documents, plus the canonical
 * order of the eight phase names. Anything derived from them here is therefore
 * an assertion about the public contract, not a copy of the implementation.
 */
const SYNODIC_MONTH_DAYS = 29.530588853;
const MS_PER_DAY = 86_400_000;
const NEW_MOON_EPOCH = Date.UTC(2000, 0, 6, 18, 14, 0);

const PHASE_ORDER: readonly MoonPhaseName[] = [
  'new',
  'waxing-crescent',
  'first-quarter',
  'waxing-gibbous',
  'full',
  'waning-gibbous',
  'last-quarter',
  'waning-crescent',
];

/** Instant of the mean new moon `cycles` synodic months after the epoch. */
function meanNewMoon(cycles: number): Date {
  return new Date(NEW_MOON_EPOCH + cycles * SYNODIC_MONTH_DAYS * MS_PER_DAY);
}

/** Instant `fraction` of the way through the synodic month `cycles`. */
function atFraction(cycles: number, fraction: number): Date {
  return new Date(NEW_MOON_EPOCH + (cycles + fraction) * SYNODIC_MONTH_DAYS * MS_PER_DAY);
}

describe('moonInfo', () => {
  it('is dark at the mean new moon and fully lit at the mean full moon, for a year of lunations', () => {
    for (let cycle = 0; cycle < 13; cycle += 1) {
      expect(moonInfo(meanNewMoon(cycle)).illumination).toBeLessThan(0.02);
      expect(moonInfo(meanNewMoon(cycle + 0.5)).illumination).toBeGreaterThan(0.98);
    }
  });

  it('holds that promise on every daily sample through 2026', () => {
    let newMoons = 0;
    let fullMoons = 0;

    for (let day = 0; day < 365; day += 1) {
      const info = moonInfo(new Date(Date.UTC(2026, 0, 1) + day * MS_PER_DAY));
      if (info.phase === 'new') {
        newMoons += 1;
        expect(info.illumination).toBeLessThan(0.02);
      }
      if (info.phase === 'full') {
        fullMoons += 1;
        expect(info.illumination).toBeGreaterThan(0.98);
      }
    }

    // A year holds ~12 of each, so a stray band would not go unnoticed.
    expect(newMoons).toBeGreaterThan(10);
    expect(fullMoons).toBeGreaterThan(10);
  });

  it('agrees with the two published USNO phase instants it was checked against', () => {
    // USNO Astronomical Applications API: new moon 2026-03-19 01:23 UTC and
    // full moon 2026-12-24 01:28 UTC (both whole minutes, UTC).
    const newMoon = moonInfo(new Date(Date.UTC(2026, 2, 19, 1, 23)));
    expect(newMoon.phase).toBe('new');
    expect(newMoon.illumination).toBeLessThan(0.02);

    const fullMoon = moonInfo(new Date(Date.UTC(2026, 11, 24, 1, 28)));
    expect(fullMoon.phase).toBe('full');
    expect(fullMoon.illumination).toBeGreaterThan(0.98);
  });

  it('walks the eight names in order through one synodic month', () => {
    const seen: MoonPhaseName[] = [];
    for (let day = 0; day <= Math.ceil(SYNODIC_MONTH_DAYS); day += 1) {
      const { phase } = moonInfo(new Date(meanNewMoon(0).getTime() + day * MS_PER_DAY));
      if (seen[seen.length - 1] !== phase) seen.push(phase);
    }

    // Each band is at least 1.8 days wide, so daily samples cannot skip one.
    expect(seen).toEqual([...PHASE_ORDER, 'new']);
  });

  it('visits all eight names in eight consecutive weeks', () => {
    // 2026-03-19 01:23 UTC is the published new moon; eight weekly samples
    // cover 56 days, just under two synodic months.
    const start = Date.UTC(2026, 2, 19, 1, 23);
    const seen = new Set<MoonPhaseName>();
    for (let week = 0; week < 8; week += 1) {
      seen.add(moonInfo(new Date(start + week * 7 * MS_PER_DAY)).phase);
    }

    expect([...seen].sort()).toEqual([...PHASE_ORDER].sort());
  });

  it('keeps fraction, age and phase aligned with the mean synodic month', () => {
    for (let day = 0; day < 400; day += 1) {
      // 1.37 days per step so samples drift through every band over the run.
      const date = new Date(Date.UTC(2025, 0, 1) + day * 1.37 * MS_PER_DAY);
      const info = moonInfo(date);
      const later = moonInfo(new Date(date.getTime() + SYNODIC_MONTH_DAYS * MS_PER_DAY));

      expect(Math.abs(later.fraction - info.fraction)).toBeLessThan(1e-6);
      expect(info.fraction).toBeGreaterThanOrEqual(0);
      expect(info.fraction).toBeLessThan(1);
      expect(info.ageDays).toBeGreaterThanOrEqual(0);
      expect(info.ageDays).toBeLessThanOrEqual(SYNODIC_MONTH_DAYS);
      expect(info.ageDays).toBeCloseTo(info.fraction * SYNODIC_MONTH_DAYS, 9);
    }
  });

  it('calls the moon waxing through the first half of the cycle', () => {
    // The turn happens exactly at the new and full moons, so sample the open
    // halves the contract talks about.
    for (let step = 1; step < 100; step += 1) {
      if (step === 50) continue;
      const fraction = step / 100;
      expect(moonInfo(atFraction(0, fraction)).waxing).toBe(fraction < 0.5);
    }
  });

  it('normalises the cycle for dates before the epoch', () => {
    for (const iso of ['1969-07-20T20:17:00Z', '1999-12-31T23:59:00Z', '2000-01-06T18:14:00Z']) {
      const info = moonInfo(new Date(iso));
      expect(info.fraction).toBeGreaterThanOrEqual(0);
      expect(info.fraction).toBeLessThan(1);
      expect(info.ageDays).toBeGreaterThanOrEqual(0);
      expect(info.ageDays).toBeLessThanOrEqual(SYNODIC_MONTH_DAYS);
      expect(PHASE_ORDER).toContain(info.phase);
    }
  });

  it('gives every phase its own label and glyph', () => {
    const labels = new Set<string>();
    const glyphs = new Set<string>();

    PHASE_ORDER.forEach((phase, index) => {
      const info = moonInfo(atFraction(0, index / 8));
      expect(info.phase).toBe(phase);
      expect(info.label.length).toBeGreaterThan(0);
      expect(info.emoji.length).toBeGreaterThan(0);
      labels.add(info.label);
      glyphs.add(info.emoji);
    });

    expect(labels.size).toBe(PHASE_ORDER.length);
    expect(glyphs.size).toBe(PHASE_ORDER.length);
    expect(moonInfo(atFraction(0, 3 / 8)).label).toBe('Waxing gibbous');
  });

  it('returns a sane default for an invalid date', () => {
    const info = moonInfo(new Date(Number.NaN));

    expect(info.phase).toBe('new');
    expect(info.label).toBe('New moon');
    expect(info.fraction).toBe(0);
    expect(info.illumination).toBe(0);
    expect(info.ageDays).toBe(0);
    expect(info.waxing).toBe(true);
  });
});
