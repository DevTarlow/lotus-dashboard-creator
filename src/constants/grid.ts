/**
 * Grid geometry constants.
 *
 * Widget sizes are authored against a 12 column reference grid
 * ({@link REFERENCE_COLUMNS}) and scaled down for smaller breakpoints.
 */
import type { BreakpointId, BreakpointMap, ColumnMap, WidgetSize } from '@/types';

/** Minimum container width (px) for each breakpoint. */
export const BREAKPOINTS: BreakpointMap = {
  xl: 1536,
  lg: 1180,
  md: 880,
  sm: 620,
  xs: 0,
};

/** Column count for each breakpoint. */
export const GRID_COLUMNS: ColumnMap = {
  xl: 12,
  lg: 12,
  md: 8,
  sm: 6,
  xs: 4,
};

/** Largest breakpoint first — used for iteration. */
export const BREAKPOINT_ORDER: readonly BreakpointId[] = ['xl', 'lg', 'md', 'sm', 'xs'];

/** The grid the widget default sizes are authored against. */
export const REFERENCE_COLUMNS = GRID_COLUMNS.lg;

/** Height of a single grid row in pixels. */
export const ROW_HEIGHT = 40;

/** Gap between grid items `[x, y]`. */
export const GRID_MARGIN: readonly [number, number] = [16, 16];

/** Padding inside the grid container `[x, y]`. */
export const CONTAINER_PADDING: readonly [number, number] = [0, 0];

/** Resize handles exposed on every widget. */
export const RESIZE_HANDLES = ['se', 'e', 's'] as const;

/** CSS selector that marks a drag handle inside a widget. */
export const DRAG_HANDLE_SELECTOR = '.widget-drag-handle';

/** CSS selector for interactive elements that must never start a drag. */
export const DRAG_CANCEL_SELECTOR =
  'button, a, input, select, textarea, label, [role="button"], .widget-no-drag';

/** Class applied to the placeholder rendered while dropping a new widget. */
export const DROP_PLACEHOLDER_ID = '__lotus_dropping_widget__';

/** Fallback footprint for widgets that do not declare a size. */
export const FALLBACK_WIDGET_SIZE: WidgetSize = { w: 3, h: 6, minW: 2, minH: 4 };
