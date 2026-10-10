import { describe, expect, it } from 'vitest';
import { GRID_COLUMNS } from '@/constants/grid';
import {
  collides,
  findFreeSlot,
  layoutsEqual,
  packLayout,
  placeWidget,
  reconcileLayouts,
  removeWidget,
  scaleSize,
  tidyLayouts,
} from '@/lib/grid';
import type { GridItem, LayoutsByBreakpoint } from '@/types';

const layout = (...items: GridItem[]): GridItem[] => items;

describe('grid maths', () => {
  it('detects collisions but ignores the item itself', () => {
    const a: GridItem = { i: 'a', x: 0, y: 0, w: 2, h: 2 };
    const b: GridItem = { i: 'b', x: 1, y: 1, w: 2, h: 2 };
    const c: GridItem = { i: 'c', x: 2, y: 0, w: 2, h: 2 };
    expect(collides(a, b)).toBe(true);
    expect(collides(a, c)).toBe(false);
    expect(collides(a, { ...a })).toBe(false);
  });

  it('finds the first free slot scanning row by row', () => {
    const existing = layout({ i: 'a', x: 0, y: 0, w: 6, h: 2 });
    expect(findFreeSlot(existing, { w: 6, h: 2 }, 12)).toEqual({ x: 6, y: 0 });
    expect(findFreeSlot(existing, { w: 12, h: 2 }, 12)).toEqual({ x: 0, y: 2 });
  });

  it('scales reference sizes down to narrower breakpoints', () => {
    expect(scaleSize({ w: 6, h: 6, minW: 3, minH: 4 }, 12)).toMatchObject({ w: 6, minW: 3 });
    expect(scaleSize({ w: 6, h: 6, minW: 3, minH: 4 }, 6)).toMatchObject({ w: 3, minW: 3 });
    expect(scaleSize({ w: 6, h: 6, minW: 4, minH: 4 }, 4)).toMatchObject({ w: 4, minW: 4 });
    // Never wider than the grid.
    expect(scaleSize({ w: 12, h: 6, minW: 6 }, 4).w).toBe(4);
  });

  it('packs a layout without leaving holes', () => {
    const messy = layout(
      { i: 'a', x: 6, y: 4, w: 6, h: 3 },
      { i: 'b', x: 0, y: 0, w: 6, h: 2 },
      { i: 'c', x: 0, y: 8, w: 4, h: 2 },
    );
    const packed = packLayout(messy, 12);

    // Reading order is preserved and every item ends up as high as it can go.
    expect(packed.map((item) => item.i)).toEqual(['b', 'a', 'c']);
    expect(packed.map((item) => item.y)).toEqual([0, 0, 2]);
    expect(Math.min(...packed.map((item) => item.y))).toBe(0);
    expect(packed.every((item, index) => packed.slice(index + 1).every((other) => !collides(item, other)))).toBe(true);
  });

  it('places a widget on every breakpoint, clamped to the columns', () => {
    const layouts = placeWidget({}, { id: 'w1', size: { w: 6, h: 6, minW: 4, minH: 4 } }, GRID_COLUMNS, {
      breakpoint: 'lg',
      x: 6,
      y: 0,
    });

    expect(layouts.lg?.[0]).toMatchObject({ i: 'w1', x: 6, y: 0, w: 6, h: 6 });
    for (const breakpoint of ['xl', 'lg', 'md', 'sm', 'xs'] as const) {
      const item = layouts[breakpoint]?.[0];
      expect(item, `${breakpoint} should contain the widget`).toBeDefined();
      expect(item!.w).toBeLessThanOrEqual(GRID_COLUMNS[breakpoint]);
      expect(item!.minW).toBeLessThanOrEqual(GRID_COLUMNS[breakpoint]);
      expect(item!.x).toBeGreaterThanOrEqual(0);
      expect(item!.x + item!.w).toBeLessThanOrEqual(GRID_COLUMNS[breakpoint]);
    }
  });

  it('places two widgets without overlapping them', () => {
    let layouts: LayoutsByBreakpoint = {};
    layouts = placeWidget(layouts, { id: 'a', size: { w: 6, h: 6 } }, GRID_COLUMNS);
    layouts = placeWidget(layouts, { id: 'b', size: { w: 6, h: 6 } }, GRID_COLUMNS);
    for (const breakpoint of ['xl', 'lg', 'md', 'sm', 'xs'] as const) {
      const items = layouts[breakpoint] ?? [];
      expect(items).toHaveLength(2);
      expect(collides(items[0], items[1])).toBe(false);
    }
  });

  it('removes a widget from every breakpoint', () => {
    let layouts: LayoutsByBreakpoint = {};
    layouts = placeWidget(layouts, { id: 'a', size: { w: 6, h: 6 } }, GRID_COLUMNS);
    layouts = placeWidget(layouts, { id: 'b', size: { w: 6, h: 6 } }, GRID_COLUMNS);
    const next = removeWidget(layouts, 'a', GRID_COLUMNS);
    for (const breakpoint of ['xl', 'lg', 'md', 'sm', 'xs'] as const) {
      expect(next[breakpoint]?.map((item) => item.i)).toEqual(['b']);
    }
  });

  it('reconciles layouts with the widget list', () => {
    const layouts: LayoutsByBreakpoint = {
      lg: [
        { i: 'kept', x: 0, y: 0, w: 4, h: 4 },
        { i: 'ghost', x: 4, y: 0, w: 4, h: 4 },
      ],
    };
    const reconciled = reconcileLayouts(
      layouts,
      [
        { id: 'kept', size: { w: 4, h: 4 } },
        { id: 'missing', size: { w: 4, h: 4 } },
      ],
      GRID_COLUMNS,
    );
    expect(reconciled.lg?.map((item) => item.i).sort()).toEqual(['kept', 'missing']);
    expect(reconciled.xs?.map((item) => item.i)).toEqual(['kept', 'missing']);
  });

  it('tidies every breakpoint and compares layouts structurally', () => {
    const messy: LayoutsByBreakpoint = {
      lg: [
        { i: 'a', x: 0, y: 5, w: 6, h: 2 },
        { i: 'b', x: 6, y: 9, w: 6, h: 2 },
      ],
      md: [{ i: 'a', x: 0, y: 3, w: 8, h: 2 }],
    };
    const tidy = tidyLayouts(messy, GRID_COLUMNS);
    expect(tidy.lg?.map((item) => item.y)).toEqual([0, 0]);
    expect(tidy.md?.map((item) => item.y)).toEqual([0]);
    expect(layoutsEqual(tidy, tidy)).toBe(true);
    expect(layoutsEqual(tidy, messy)).toBe(false);
    expect(layoutsEqual({ ...tidy, lg: [...(tidy.lg ?? []), { i: 'c', x: 0, y: 4, w: 2, h: 2 }] }, tidy)).toBe(false);
  });

  it('keeps existing placements when a widget is re-placed', () => {
    const placed = placeWidget({}, { id: 'a', size: { w: 4, h: 4 } }, GRID_COLUMNS, { breakpoint: 'lg', x: 4, y: 3 });
    const again = placeWidget(placed, { id: 'a', size: { w: 4, h: 4 } }, GRID_COLUMNS);
    expect(again.lg?.[0]).toMatchObject({ x: 4, y: 3, w: 4, h: 4 });
    expect(again.lg).toHaveLength(1);
  });
});
