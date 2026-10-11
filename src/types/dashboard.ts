/**
 * Dashboard document, persistence and UI state types.
 */
import type { BreakpointId, BreakpointMap, ColumnMap, LayoutsByBreakpoint } from './layout';
import type { StoredWidgetInstance } from './widget';

/** Colour scheme preference. `system` follows the OS setting. */
export type ThemeMode = 'light' | 'dark' | 'system';

/** Resolved colour scheme actually applied to the document. */
export type ResolvedTheme = 'light' | 'dark';

/**
 * The complete, serialisable dashboard payload — used for `localStorage`
 * persistence, JSON export and JSON import.
 */
export interface DashboardDocument {
  /** Format discriminator, checked on import. */
  format: typeof DASHBOARD_FORMAT;
  /** Schema version, drives the migration pipeline. */
  version: number;
  /** Tool that produced the file. */
  generator: {
    name: string;
    version: string;
  };
  /** ISO timestamp of the export. */
  exportedAt: string;
  /** Dashboard metadata. */
  dashboard: {
    title: string;
    description: string;
  };
  /** Grid definition, embedded so an exported file is self-describing. */
  grid: {
    breakpoints: BreakpointMap;
    columns: ColumnMap;
  };
  /** Widget instances, in creation order. */
  widgets: StoredWidgetInstance[];
  /** Layouts for every breakpoint. */
  layouts: LayoutsByBreakpoint;
}

/** Format discriminator value. Declared as a const so it can be `typeof`-ed. */
export const DASHBOARD_FORMAT = 'lotus-dashboard/v1' as const;

/** Successful import result. */
export interface ImportSuccess {
  ok: true;
  document: DashboardDocument;
  /** Non fatal issues, e.g. unknown widget types or clamped coordinates. */
  warnings: string[];
}

/**
 * A file the importer recognised as *not* a layout document.
 *
 * `saved-dashboard-html` is a file this app wrote with "Save to file": HTML with
 * the workspace embedded inside it. Plain `html` is any other page.
 */
export type DetectedFileKind = 'saved-dashboard-html' | 'html';

/** Failed import result. */
export interface ImportFailure {
  ok: false;
  errors: string[];
  /** Set when the input is a recognised non-layout file, so the UI can explain it. */
  detectedAs?: DetectedFileKind;
}

export type ImportResult = ImportSuccess | ImportFailure;

/** Toast notification kinds. */
export type ToastTone = 'success' | 'error' | 'info' | 'warning';

/** A toast notification. */
export interface Toast {
  id: string;
  tone: ToastTone;
  title: string;
  description?: string;
  /** Auto dismiss delay in ms. `0` keeps the toast until dismissed. */
  duration: number;
  /** Optional call to action. */
  action?: {
    label: string;
    onClick: () => void;
  };
}

/** Snapshot used by the undo/redo history. */
export interface DashboardSnapshot {
  widgets: StoredWidgetInstance[];
  layouts: LayoutsByBreakpoint;
}

/** A starter template that can be applied to the canvas. */
export interface DashboardTemplate {
  id: string;
  name: string;
  description: string;
  /** Templates are built lazily so ids/timestamps are always fresh. */
  build: () => DashboardSnapshot & { title: string; description: string };
}

/** Breakpoint reported by the grid, exposed in the toolbar. */
export interface BreakpointInfo {
  id: BreakpointId;
  columns: number;
  /** Container width in pixels. */
  width: number;
}
