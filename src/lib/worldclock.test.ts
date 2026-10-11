import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type { ClockZone } from '@/lib/worldclock';
import {
  bestOverlap,
  dayOffsetLabel,
  isBusinessHour,
  isValidTimeZone,
  MAX_ZONES,
  normalizeZones,
  overlapSlots,
  ZONE_PRESETS,
  zoneLabel,
  zoneRows,
} from '@/lib/worldclock';

/**
 * The viewer's own zone is half of every offset this module reports, so the host
 * is pinned to UTC and restored afterwards. Everything that depends on the
 * *stored* zone is asserted through explicit `timeZone` values, never through the
 * machine running the tests.
 */
const originalTimeZone = process.env.TZ;

beforeEach(() => {
  process.env.TZ = 'UTC';
});

afterAll(() => {
  process.env.TZ = originalTimeZone;
});

function zone(timeZone: string, label = timeZone, id = `z-${timeZone}`): ClockZone {
  return { id, label, timeZone };
}

describe('isValidTimeZone', () => {
  it('accepts real IANA zones and UTC', () => {
    for (const id of ['UTC', 'Europe/Berlin', 'America/New_York', 'Asia/Kolkata', 'Pacific/Auckland']) {
      expect(isValidTimeZone(id), id).toBe(true);
    }
  });

  it('rejects empty, unknown and rubbish input', () => {
    for (const id of ['', '   ', 'Mars/Olympus', 'Europe', 'Not/AZone', 'Nowhere/Else', 'Europe/Berlin!']) {
      expect(isValidTimeZone(id), `"${id}"`).toBe(false);
    }
  });

  it('never throws, whatever it is handed', () => {
    // Cast through `unknown`: a stored config can hold any of these, and the
    // widget must survive all of them.
    for (const value of [null, undefined, 42, {}, [], true]) {
      expect(() => isValidTimeZone(value as unknown as string)).not.toThrow();
      expect(isValidTimeZone(value as unknown as string)).toBe(false);
    }
  });
});

describe('normalizeZones', () => {
  it('drops entries Intl cannot resolve and repairs the rest', () => {
    const zones = normalizeZones([
      { id: 'a', label: 'Berlin', timeZone: 'Europe/Berlin' },
      { id: 'b', label: 'Nowhere', timeZone: 'Mars/Olympus' },
      { id: 'c', timeZone: 'Asia/Tokyo' },
      'Europe/London',
      null,
      { label: 'no zone' },
    ]);

    expect(zones).toEqual([
      { id: 'a', label: 'Berlin', timeZone: 'Europe/Berlin' },
      { id: 'c', label: 'Tokyo', timeZone: 'Asia/Tokyo' },
    ]);
  });

  it('de-duplicates by time zone, keeping the first entry', () => {
    const zones = normalizeZones([
      { id: 'a', label: 'London', timeZone: 'Europe/London' },
      { id: 'b', label: 'London again', timeZone: 'Europe/London' },
      { id: 'c', label: 'Tokyo', timeZone: 'Asia/Tokyo' },
    ]);

    expect(zones.map((entry) => entry.id)).toEqual(['a', 'c']);
    expect(zones).toHaveLength(2);
  });

  it('caps the list at MAX_ZONES', () => {
    const many = ZONE_PRESETS.map((preset, index) => ({
      id: `p-${index}`,
      label: preset.label,
      timeZone: preset.timeZone,
    }));

    expect(many.length).toBeGreaterThan(MAX_ZONES);
    const zones = normalizeZones(many);
    expect(zones).toHaveLength(MAX_ZONES);
    expect(zones.map((entry) => entry.timeZone)).toEqual(many.slice(0, MAX_ZONES).map((entry) => entry.timeZone));
  });

  it('survives a non-array and gives every entry a unique id', () => {
    for (const value of [undefined, null, 'Europe/London', 7, { timeZone: 'UTC' }]) {
      expect(normalizeZones(value)).toEqual([]);
    }

    // Entries whose zone field is not even a string are dropped, not coerced.
    expect(
      normalizeZones([
        { id: 'a', label: 'Number', timeZone: 42 },
        { id: 'b', label: 'Null', timeZone: null },
        { id: 'c', label: 'Fine', timeZone: 'UTC' },
      ]),
    ).toEqual([{ id: 'c', label: 'Fine', timeZone: 'UTC' }]);

    // Every preset is a distinct zone, so this keeps them all; duplicate ids in,
    // unique ids out.
    const zones = normalizeZones(ZONE_PRESETS.map((preset) => ({ ...preset, id: 'same' })));
    expect(new Set(zones.map((entry) => entry.id)).size).toBe(zones.length);
  });
});

describe('zoneLabel', () => {
  it('uses the city, with underscores expanded', () => {
    expect(zoneLabel('Europe/Berlin')).toBe('Berlin');
    expect(zoneLabel('America/New_York')).toBe('New York');
    expect(zoneLabel('UTC')).toBe('UTC');
    expect(zoneLabel('Etc/GMT+5')).toBe('GMT+5');
  });

  it('names an empty zone rather than rendering a blank', () => {
    expect(zoneLabel('')).toBe('Unknown zone');
    expect(zoneLabel('   ')).toBe('Unknown zone');
  });
});

describe('zoneRows', () => {
  // A plain winter instant: no DST transition anywhere, and 2026-03-29T00:30Z is
  // the exact moment Berlin springs forward, used further down.
  const NOW = new Date('2026-03-29T00:30:00Z');
  const OPTIONS = { hour12: false, workStart: 9, workEnd: 17 };

  it('keeps the configured order', () => {
    const rows = zoneRows([zone('Pacific/Auckland'), zone('UTC'), zone('America/New_York')], NOW, OPTIONS);
    expect(rows.map((row) => row.timeZone)).toEqual(['Pacific/Auckland', 'UTC', 'America/New_York']);
    expect(rows.every((row) => row.valid)).toBe(true);
  });

  it('formats the wall clock and the offset from the viewer', () => {
    const rows = zoneRows([zone('UTC'), zone('Asia/Kolkata'), zone('America/New_York')], NOW, OPTIONS);
    expect(rows[0]).toMatchObject({ time: '00:30', offsetMinutes: 0, offsetLabel: 'same time', localHour: 0 });
    // India is five and a half hours ahead — the half hour must survive.
    expect(rows[1]).toMatchObject({ time: '06:00', offsetMinutes: 330, offsetLabel: '+5:30', localHour: 6 });
    expect(rows[2]).toMatchObject({ time: '20:30', offsetMinutes: -240, offsetLabel: '−4h', localHour: 20 });
  });

  it('labels the date line rollover against the viewer’s own day', () => {
    // The host is UTC, so the viewer's day is still Saturday 28 March: Auckland
    // (+13) has already rolled over to the 29th, Honolulu (−10) has not.
    const rows = zoneRows([zone('Pacific/Auckland'), zone('Pacific/Honolulu')], new Date('2026-03-28T13:00:00Z'), OPTIONS);
    expect(rows.map((row) => row.dayLabel)).toEqual(['Tomorrow', 'Today']);

    // Earlier on the viewer's own day both zones are ahead of nothing yet: UTC's
    // 28th has only just started, so neither has left it behind.
    const early = zoneRows([zone('Pacific/Auckland'), zone('Pacific/Honolulu')], new Date('2026-03-28T00:30:00Z'), OPTIONS);
    expect(early.map((row) => row.dayLabel)).toEqual(['Today', 'Yesterday']);
  });

  it('moves the labels as the viewer’s own day advances', () => {
    // Both instants are the same viewer day (the 28th, in UTC). Dubai (+4) has
    // not crossed midnight at 06:00 UTC but has by 22:00 UTC, so its chip
    // changes within a single viewer day; Tokyo (+9) is on the 29th throughout.
    const morning = zoneRows([zone('Asia/Dubai'), zone('Asia/Tokyo')], new Date('2026-03-28T06:00:00Z'), OPTIONS);
    const evening = zoneRows([zone('Asia/Dubai'), zone('Asia/Tokyo')], new Date('2026-03-28T22:00:00Z'), OPTIONS);
    expect(morning.map((row) => row.dayLabel)).toEqual(['Today', 'Today']);
    expect(evening.map((row) => row.dayLabel)).toEqual(['Tomorrow', 'Tomorrow']);
  });

  it('reads the offset across a DST boundary, hour by hour', () => {
    // Berlin springs forward at 01:00 UTC on 2026-03-29.
    const before = zoneRows([zone('Europe/Berlin')], new Date('2026-03-29T00:30:00Z'), OPTIONS);
    const after = zoneRows([zone('Europe/Berlin')], new Date('2026-03-29T01:30:00Z'), OPTIONS);

    expect(before[0]).toMatchObject({ time: '01:30', offsetMinutes: 60, offsetLabel: '+1h' });
    // The clocks jumped 02:30 straight to 03:30 and the offset label moved with
    // them: DST is the difference between the two rows, not a fixed constant.
    expect(after[0]).toMatchObject({ time: '03:30', offsetMinutes: 120, offsetLabel: '+2h' });
  });

  it('formats a 12-hour clock when asked', () => {
    const rows = zoneRows(
      [zone('Asia/Tokyo'), zone('America/New_York')],
      new Date('2026-03-29T15:05:00Z'),
      { ...OPTIONS, hour12: true },
    );
    // The upper-case period is the locale's own (`en-US`): asking Intl for an
    // explicit `dayPeriod` makes current ICU answer "in the morning" instead.
    expect(rows[0].time).toBe('12:05 AM');
    expect(rows[1].time).toBe('11:05 AM');

    const midday = zoneRows([zone('Europe/Berlin')], new Date('2026-03-29T10:00:00Z'), { ...OPTIONS, hour12: true });
    expect(midday[0].time).toBe('12:00 PM');

    const afternoon = zoneRows([zone('Europe/Berlin')], new Date('2026-03-29T12:05:00Z'), { ...OPTIONS, hour12: true });
    expect(afternoon[0].time).toBe('2:05 PM');
  });

  it('flags office hours for each zone', () => {
    const rows = zoneRows([zone('UTC'), zone('Asia/Tokyo')], NOW, OPTIONS);
    expect(rows[0]).toMatchObject({ localHour: 0, businessHours: false });
    expect(rows[1]).toMatchObject({ localHour: 9, businessHours: true });
  });

  it('reports an unresolvable zone instead of inventing a time', () => {
    const rows = zoneRows([zone('Mars/Olympus', 'Mars base')], NOW, OPTIONS);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      label: 'Mars base',
      timeZone: 'Mars/Olympus',
      valid: false,
      time: '',
      offsetLabel: '',
      businessHours: false,
    });
  });

  it('returns nothing for an invalid instant rather than throwing', () => {
    expect(zoneRows([zone('UTC')], new Date('nope'), OPTIONS)).toEqual([]);
  });
});

describe('dayOffsetLabel', () => {
  it('names the days either side of today', () => {
    expect(dayOffsetLabel(0)).toBe('Today');
    expect(dayOffsetLabel(1)).toBe('Tomorrow');
    expect(dayOffsetLabel(-1)).toBe('Yesterday');
  });

  it('spells out a distance no zone can actually reach', () => {
    // The IANA range is UTC−12…UTC+14, so ±2 is impossible in practice; it still
    // has to read like English rather than "2".
    expect(dayOffsetLabel(2)).toBe('in 2 days');
    expect(dayOffsetLabel(-2)).toBe('2 days ago');
  });
});

describe('isBusinessHour', () => {
  it('is inclusive at the start and exclusive at the end', () => {
    expect(isBusinessHour(9, 9, 17)).toBe(true);
    expect(isBusinessHour(16, 9, 17)).toBe(true);
    expect(isBusinessHour(17, 9, 17)).toBe(false);
    expect(isBusinessHour(8, 9, 17)).toBe(false);
    expect(isBusinessHour(0, 9, 17)).toBe(false);
    expect(isBusinessHour(23, 9, 17)).toBe(false);
  });

  it('handles a window that wraps past midnight', () => {
    expect(isBusinessHour(22, 22, 6)).toBe(true);
    expect(isBusinessHour(23, 22, 6)).toBe(true);
    expect(isBusinessHour(0, 22, 6)).toBe(true);
    expect(isBusinessHour(5, 22, 6)).toBe(true);
    expect(isBusinessHour(6, 22, 6)).toBe(false);
    expect(isBusinessHour(12, 22, 6)).toBe(false);
  });

  it('treats an empty window as closed and rounds fractional hours', () => {
    expect(isBusinessHour(9, 9, 9)).toBe(false);
    expect(isBusinessHour(9, 9.6, 17.4)).toBe(true);
    expect(isBusinessHour(0, Number.NaN, Number.NaN)).toBe(false);
  });
});

describe('overlapSlots', () => {
  const NOW = new Date('2026-03-29T00:30:00Z');
  const ZONES = [zone('UTC'), zone('Europe/Berlin'), zone('Asia/Tokyo')];

  it('returns one slot per hour of the viewer’s day', () => {
    const slots = overlapSlots(ZONES, NOW, 9, 17);
    expect(slots).toHaveLength(24);
    expect(slots.map((slot) => slot.hour)).toEqual(Array.from({ length: 24 }, (_, hour) => hour));
    expect(slots.every((slot) => slot.ratio >= 0 && slot.ratio <= 1)).toBe(true);
  });

  it('counts the zones whose own office hours cover each hour', () => {
    // Berlin is UTC+1 until its DST switch at 01:00 UTC on this date, then UTC+2;
    // London stays UTC+0 all day; Tokyo is UTC+9 throughout.
    const slots = overlapSlots(ZONES, NOW, 9, 17);
    expect(slots[0]).toMatchObject({ available: 1, ratio: 1 / 3 }); // Tokyo's 10:00 only
    expect(slots[6]).toMatchObject({ available: 1, ratio: 1 / 3 }); // Tokyo's 16:00
    expect(slots[7]).toMatchObject({ available: 2, ratio: 2 / 3 }); // Berlin opens, Tokyo closes
    expect(slots[9]).toMatchObject({ available: 2, ratio: 2 / 3 }); // UTC joins at 09:00
    expect(slots[16]).toMatchObject({ available: 1, ratio: 1 / 3 }); // only New York's 12:00
    expect(slots[17]).toMatchObject({ available: 0, ratio: 0 }); // Berlin's 19:00, Tokyo's 02:00
    expect(slots.map((slot) => slot.available).join('')).toBe('111111121222222110000000');

    // The counts agree with the per-zone predicate the rows use. The viewer's
    // local hour is turned back into UTC before asking for the zone's clock, so
    // this check is independent of the host's own zone.
    for (const slot of slots) {
      const atSlot = new Date(Date.UTC(2026, 2, 29, slot.hour) - new Date(NOW).getTimezoneOffset() * 60_000);
      const open = ZONES.filter(
        (entry) => zoneRows([entry], atSlot, { hour12: false, workStart: 9, workEnd: 17 })[0].businessHours,
      ).length;
      expect(slot.available, `hour ${slot.hour}`).toBe(open);
    }
  });

  it('reads each hour at its own offset, not the offset at `now`', () => {
    // London springs forward at 01:00 UTC on this date. Sampling the offset once,
    // at the stored `now`, would keep London "open" until 17:00 UTC and put an
    // extra zone in the evening slots; the strip has to move with the clocks.
    const slots = overlapSlots([zone('Europe/London'), zone('America/New_York')], NOW, 9, 17);
    expect(slots[15]).toMatchObject({ available: 2 }); // London's 16:00, New York's 11:00
    expect(slots[16]).toMatchObject({ available: 1 }); // London's 17:00 — closed
  });

  it('keeps half-hour zones on their own clock', () => {
    // Kolkata is UTC+05:30, so the viewer's 11:00 is 16:30 there (still open)
    // and 12:00 is 17:30 (closed). Truncating the half hour would get both wrong.
    const slots = overlapSlots([zone('Asia/Kolkata')], NOW, 9, 17);
    expect(slots[11].available).toBe(1);
    expect(slots[12].available).toBe(0);
  });

  it('marks the viewer’s own office hours', () => {
    expect(overlapSlots(ZONES, NOW, 9, 17).map((slot) => slot.inBusiness)).toEqual(
      Array.from({ length: 24 }, (_, hour) => hour >= 9 && hour < 17),
    );
    // A night window wraps, so the flag has to wrap with it.
    const night = overlapSlots(ZONES, NOW, 22, 6);
    expect(night[23].inBusiness).toBe(true);
    expect(night[5].inBusiness).toBe(true);
    expect(night[12].inBusiness).toBe(false);
  });

  it('produces no availability without a usable zone', () => {
    const slots = overlapSlots([zone('Mars/Olympus')], NOW, 9, 17);
    expect(slots).toHaveLength(24);
    expect(slots.every((slot) => slot.available === 0 && slot.ratio === 0)).toBe(true);
    expect(overlapSlots([], NOW, 9, 17)).toHaveLength(24);
  });
});

describe('bestOverlap', () => {
  const NOW = new Date('2026-03-29T00:30:00Z');

  it('returns null for an empty strip', () => {
    expect(bestOverlap([])).toBeNull();
    expect(bestOverlap(overlapSlots([], NOW, 9, 17))).toBeNull();
    // A zone list `Intl` cannot resolve has no window to offer either.
    expect(bestOverlap(overlapSlots([zone('Mars/Olympus')], NOW, 9, 17))).toBeNull();
  });

  it('returns the single zone’s own working window', () => {
    const slots = overlapSlots([zone('UTC')], NOW, 9, 17);
    expect(bestOverlap(slots)).toEqual({ startHour: 9, endHour: 17, available: 1 });
  });

  it('returns the longest run at the highest availability', () => {
    // 2026-03-29 is the day London and Berlin spring forward, which is exactly
    // the sort of date a hardcoded offset gets wrong.
    const slots = overlapSlots([zone('Europe/London'), zone('Europe/Berlin'), zone('America/New_York')], NOW, 9, 17);
    const best = bestOverlap(slots);

    // New York (UTC−4) opens at 13:00 UTC; an hour later London and Berlin are
    // on summer time and close at 16:00 and 17:00 UTC, so only 13:00 and 14:00
    // have all three offices open.
    expect(slots.map((slot) => slot.available).join('')).toBe('000000012222233211111000');
    expect(best).toEqual({ startHour: 13, endHour: 15, available: 3 });
    expect(Math.max(...slots.map((slot) => slot.available))).toBe(best?.available);
  });

  it('falls back to the widest single-zone window when nobody overlaps', () => {
    // London is UTC+1 on this date, so its office hours are 08:00–16:00 UTC;
    // Tokyo's are 00:00–08:00 UTC. They meet at no hour at all, so the peak
    // availability is one zone for the whole 16-hour stretch.
    const slots = overlapSlots([zone('Europe/London'), zone('Asia/Tokyo')], NOW, 9, 17);
    expect(Math.max(...slots.map((slot) => slot.available))).toBe(1);

    // Documented behaviour: with a peak of one there is no shared window, and
    // the "longest run" is just the union of the two working days. The widget
    // refuses to print it as an overlap (see the zone-count check in
    // `WorldClockWidget`); `bestOverlap` cannot tell "nobody overlaps" from
    // "this really is the window for one zone", so it reports what it found.
    expect(bestOverlap(slots)).toEqual({ startHour: 0, endHour: 16, available: 1 });
  });

  it('picks the earliest longest run, not the last one seen', () => {
    // Hand-built slots, so the tie-break is pinned rather than incidental: the
    // peak of 2 covers hours 2–4 and 7–8, and the longer (later) run must win
    // over an earlier, shorter one.
    const pattern = [0, 0, 2, 2, 2, 0, 0, 2, 2, 0];
    const slots = pattern.map((available, hour) => ({
      hour,
      available,
      ratio: available / 2,
      inBusiness: false,
    }));
    expect(bestOverlap(slots)).toEqual({ startHour: 2, endHour: 5, available: 2 });

    // Two runs of exactly the same length keep the earlier.
    const tied = [0, 2, 2, 0, 2, 2, 0].map((available, hour) => ({
      hour,
      available,
      ratio: available / 2,
      inBusiness: false,
    }));
    expect(bestOverlap(tied)).toEqual({ startHour: 1, endHour: 3, available: 2 });
  });
});
