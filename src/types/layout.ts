/**
 * Grid / layout type definitions.
 *
 * The dashboard is a *responsive* grid: every breakpoint stores its own set of
 * `LayoutItem`s, exactly the shape `react-grid-layout` v2 expects.
 */
import type { LayoutItem, ResponsiveLayouts } from 'react-grid-layout';

/** Breakpoints supported by the dashboard canvas (largest → smallest). */
export type BreakpointId = 'xl' | 'lg' | 'md' | 'sm' | 'xs';

/** A single item on the grid. `i` is the widget instance id. */
export type GridItem = LayoutItem;

/** A layout for one breakpoint. */
export type GridLayout = readonly GridItem[];

/** Breakpoint → layout map. */
export type LayoutsByBreakpoint = ResponsiveLayouts<BreakpointId>;

/** Breakpoint → minimum container width in pixels. */
export type BreakpointMap = Record<BreakpointId, number>;

/** Breakpoint → column count. */
export type ColumnMap = Record<BreakpointId, number>;

/** Default footprint of a widget, expressed in grid units on a 12 column grid. */
export interface WidgetSize {
  /** Width in grid units. */
  w: number;
  /** Height in grid units. */
  h: number;
  /** Minimum width in grid units. */
  minW?: number;
  /** Minimum height in grid units. */
  minH?: number;
  /** Maximum width in grid units. */
  maxW?: number;
  /** Maximum height in grid units. */
  maxH?: number;
}

/** Options accepted when spawning a widget onto the canvas. */
export interface PlacementOptions {
  /** Preferred position, in grid units, for the active breakpoint. */
  x?: number;
  y?: number;
  /** Preferred footprint; falls back to the widget definition's default. */
  size?: Partial<WidgetSize>;
  /** Breakpoint the placement coordinates refer to. */
  breakpoint?: BreakpointId;
}
