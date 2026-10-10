/**
 * Grid maths.
 *
 * Pure functions that manipulate `react-grid-layout` layout arrays. Keeping them
 * free of React lets the store, the import pipeline and the canvas share exactly
 * the same logic — and makes them trivially unit testable.
 */
import { BREAKPOINT_ORDER, FALLBACK_WIDGET_SIZE, GRID_COLUMNS, REFERENCE_COLUMNS } from '@/constants/grid';
import type { BreakpointId, ColumnMap, GridItem, GridLayout, LayoutsByBreakpoint, WidgetSize } from '@/types';
import { clamp, toInt } from './utils';

/** Find an item by id. */
export function itemById(layout: GridLayout, id: string): GridItem | undefined {
  return layout.find((item) => item.i === id);
}

/** Does the layout contain an item with this id? */
export function hasItem(layout: GridLayout, id: string): boolean {
  return layout.some((item) => item.i === id);
}

/** Layout for a breakpoint, defaulting to an empty array. */
export function layoutsOf(layouts: LayoutsByBreakpoint, breakpoint: BreakpointId): GridLayout {
  return layouts[breakpoint] ?? [];
}

/** Two grid items collide when they overlap in both axes. */
export function collides(a: GridItem, b: GridItem): boolean {
  if (a.i === b.i) return false;
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

/** First free slot (scanning row by row, left to right) for a given footprint. */
export function findFreeSlot(layout: GridLayout, size: { w: number; h: number }, cols: number): { x: number; y: number } {
  const w = clamp(toInt(size.w, 1), 1, cols);
  const h = Math.max(1, toInt(size.h, 1));
  const maxY = layout.reduce((acc, item) => Math.max(acc, item.y + item.h), 0);
  const probe: GridItem = { i: '__probe__', x: 0, y: 0, w, h };

  for (let y = 0; y <= maxY; y += 1) {
    for (let x = 0; x + w <= cols; x += 1) {
      const candidate: GridItem = { ...probe, x, y };
      if (!layout.some((item) => collides(candidate, item))) {
        return { x, y };
      }
    }
  }
  return { x: 0, y: maxY };
}

/** Number of rows occupied by the layout. */
export function layoutRows(layout: GridLayout): number {
  return layout.reduce((acc, item) => Math.max(acc, item.y + item.h), 0);
}

/**
 * Scale a reference size (authored on a 12 column grid) down to `cols` columns.
 * Height is kept as-is; minimums are clamped so an item can always fit.
 */
export function scaleSize(size: WidgetSize, cols: number, reference = REFERENCE_COLUMNS): WidgetSize {
  const ratio = cols / reference;
  const minW = clamp(toInt(size.minW ?? 1, 1), 1, cols);
  const w = clamp(Math.round(size.w * ratio), minW, cols);
  const maxW = size.maxW === undefined ? undefined : clamp(toInt(size.maxW, cols), w, cols);
  return {
    w,
    h: Math.max(1, toInt(size.h, 6)),
    minW,
    minH: Math.max(1, toInt(size.minH ?? 2, 2)),
    ...(maxW === undefined ? {} : { maxW }),
  };
}

/**
 * Normalise a layout item: integer coordinates, clamped to the grid, without
 * `react-grid-layout`'s internal bookkeeping fields (`moved`, …).
 */
export function normalizeItem(item: GridItem, cols: number): GridItem {
  const minW = clamp(toInt(item.minW ?? 1, 1), 1, cols);
  const minH = Math.max(1, toInt(item.minH ?? 1, 1));
  const w = clamp(toInt(item.w, minW), minW, cols);
  const h = Math.max(minH, toInt(item.h, minH));
  const x = clamp(toInt(item.x, 0), 0, Math.max(0, cols - w));
  const y = Math.max(0, toInt(item.y, 0));
  const maxW = item.maxW === undefined ? undefined : clamp(toInt(item.maxW, cols), w, cols);
  const maxH = item.maxH === undefined ? undefined : Math.max(h, toInt(item.maxH, h));
  return {
    i: item.i,
    x,
    y,
    w,
    h,
    minW,
    minH,
    ...(maxW === undefined ? {} : { maxW }),
    ...(maxH === undefined ? {} : { maxH }),
  };
}

/** Normalise a whole layout and drop duplicate ids. */
export function normalizeLayout(layout: GridLayout, cols: number): GridItem[] {
  const seen = new Set<string>();
  const result: GridItem[] = [];
  for (const item of layout) {
    if (!item || typeof item.i !== 'string' || item.i.length === 0 || seen.has(item.i)) continue;
    seen.add(item.i);
    result.push(normalizeItem(item, cols));
  }
  return result;
}

/** Remove an item from a layout. */
export function removeItem(layout: GridLayout, id: string): GridItem[] {
  return layout.filter((item) => item.i !== id);
}

/** Insert or replace an item in a layout. */
export function withItem(layout: GridLayout, item: GridItem, cols: number): GridItem[] {
  const next = removeItem(layout, item.i);
  next.push(normalizeItem(item, cols));
  return next;
}

/**
 * First-fit packer: keeps the reading order of the items but removes every hole,
 * producing the "tidy up" result.
 */
export function packLayout(layout: GridLayout, cols: number): GridItem[] {
  const ordered = layout
    .map((item) => normalizeItem(item, cols))
    .sort((a, b) => a.y - b.y || a.x - b.x || a.i.localeCompare(b.i));
  const packed: GridItem[] = [];
  for (const item of ordered) {
    const slot = findFreeSlot(packed, { w: item.w, h: item.h }, cols);
    packed.push({ ...item, x: slot.x, y: slot.y });
  }
  return packed;
}

/** Deep clone of a breakpoint → layout map (items are plain objects). */
export function cloneLayouts(layouts: LayoutsByBreakpoint): LayoutsByBreakpoint {
  const next: LayoutsByBreakpoint = {};
  for (const breakpoint of BREAKPOINT_ORDER) {
    const layout = layouts[breakpoint];
    if (layout) next[breakpoint] = layout.map((item) => ({ ...item }));
  }
  return next;
}

/** Tidy every breakpoint. */
export function tidyLayouts(layouts: LayoutsByBreakpoint, columns: ColumnMap = GRID_COLUMNS): LayoutsByBreakpoint {
  const next: LayoutsByBreakpoint = {};
  for (const breakpoint of BREAKPOINT_ORDER) {
    const layout = layouts[breakpoint];
    next[breakpoint] = packLayout(layout ?? [], columns[breakpoint]);
  }
  return next;
}

/** Structural comparison used to skip redundant store writes. */
export function layoutsEqual(a: LayoutsByBreakpoint, b: LayoutsByBreakpoint): boolean {
  for (const breakpoint of BREAKPOINT_ORDER) {
    const left = a[breakpoint] ?? [];
    const right = b[breakpoint] ?? [];
    if (left.length !== right.length) return false;
    for (let index = 0; index < left.length; index += 1) {
      const x = left[index];
      const y = right[index];
      if (!y) return false;
      if (x.i !== y.i || x.x !== y.x || x.y !== y.y || x.w !== y.w || x.h !== y.h) return false;
    }
  }
  return true;
}

/** Description of a widget that needs to be placed on the grid. */
export interface PlacementSpec {
  id: string;
  size: WidgetSize;
}

/** Optional explicit placement, usually coming from a drag & drop interaction. */
export interface WishPlacement {
  breakpoint?: BreakpointId;
  x?: number;
  y?: number;
  size?: Partial<WidgetSize>;
}

function resolveSize(spec: WidgetSize, override: Partial<WidgetSize> | undefined, cols: number): WidgetSize {
  const merged: WidgetSize = {
    ...FALLBACK_WIDGET_SIZE,
    ...spec,
    ...(override ?? {}),
    minW: override?.minW ?? spec.minW ?? FALLBACK_WIDGET_SIZE.minW,
    minH: override?.minH ?? spec.minH ?? FALLBACK_WIDGET_SIZE.minH,
  };
  return scaleSize(merged, cols);
}

/**
 * Add a widget to **every** breakpoint layout, so no breakpoint can render an
 * unplaced (default 1×1) item. Positions are chosen by the first-fit packer, or
 * taken from `placement` when the user dropped the widget at a known spot.
 *
 * Widgets that already have a slot keep it — this makes the function safe to call
 * as "ensure these widgets are placed".
 */
export function placeWidget(
  layouts: LayoutsByBreakpoint,
  spec: PlacementSpec,
  columns: ColumnMap = GRID_COLUMNS,
  placement: WishPlacement = {},
): LayoutsByBreakpoint {
  const next = cloneLayouts(layouts);
  for (const breakpoint of BREAKPOINT_ORDER) {
    const cols = columns[breakpoint];
    const layout = next[breakpoint] ?? [];
    const existing = itemById(layout, spec.id);
    const explicit = placement.breakpoint === breakpoint && (placement.x !== undefined || placement.y !== undefined);
    const size = resolveSize(spec.size, placement.size, cols);

    if (existing && !explicit) {
      // Already placed: only refresh the constraints.
      next[breakpoint] = withItem(
        layout,
        { ...existing, w: existing.w, h: existing.h, minW: size.minW, minH: size.minH },
        cols,
      );
      continue;
    }

    const slot = explicit
      ? { x: clamp(toInt(placement.x, 0), 0, Math.max(0, cols - size.w)), y: Math.max(0, toInt(placement.y, 0)) }
      : findFreeSlot(layout, size, cols);

    next[breakpoint] = withItem(
      layout,
      { i: spec.id, ...slot, w: size.w, h: size.h, minW: size.minW, minH: size.minH },
      cols,
    );
  }
  return next;
}

/** Remove a widget from every breakpoint layout. */
export function removeWidget(
  layouts: LayoutsByBreakpoint,
  id: string,
  columns: ColumnMap = GRID_COLUMNS,
): LayoutsByBreakpoint {
  const next: LayoutsByBreakpoint = {};
  for (const breakpoint of BREAKPOINT_ORDER) {
    next[breakpoint] = normalizeLayout(removeItem(layouts[breakpoint] ?? [], id), columns[breakpoint]);
  }
  return next;
}

/**
 * Make sure the layout map and the widget list agree:
 * unknown items are dropped, unplaced widgets get a slot.
 */
export function reconcileLayouts(
  layouts: LayoutsByBreakpoint,
  widgets: readonly PlacementSpec[],
  columns: ColumnMap = GRID_COLUMNS,
): LayoutsByBreakpoint {
  const ids = new Set(widgets.map((widget) => widget.id));
  const cleaned: LayoutsByBreakpoint = {};
  for (const breakpoint of BREAKPOINT_ORDER) {
    const cols = columns[breakpoint];
    cleaned[breakpoint] = normalizeLayout(
      (layouts[breakpoint] ?? []).filter((item) => ids.has(item.i)),
      cols,
    );
  }
  let result = cleaned;
  for (const widget of widgets) {
    const missing = BREAKPOINT_ORDER.some((breakpoint) => !hasItem(result[breakpoint] ?? [], widget.id));
    if (missing) {
      result = placeWidget(result, widget, columns);
    }
  }
  return result;
}
