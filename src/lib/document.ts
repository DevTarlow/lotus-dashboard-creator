/**
 * Dashboard document helpers: building the export payload and naming the file.
 */
import { APP_NAME, APP_VERSION, EXPORT_FILE_PREFIX, SCHEMA_VERSION } from '@/constants/app';
import { BREAKPOINTS, GRID_COLUMNS } from '@/constants/grid';
import { DASHBOARD_FORMAT } from '@/types';
import type { DashboardDocument, LayoutsByBreakpoint, StoredWidgetInstance } from '@/types';
import { cloneLayouts } from './grid';

export interface DocumentInput {
  title: string;
  description?: string;
  widgets: readonly StoredWidgetInstance[];
  layouts: LayoutsByBreakpoint;
  /** Overrides the export timestamp — handy for deterministic tests. */
  exportedAt?: string;
}

/** Build the serialisable dashboard payload. */
export function createDashboardDocument(input: DocumentInput): DashboardDocument {
  return {
    format: DASHBOARD_FORMAT,
    version: SCHEMA_VERSION,
    generator: { name: APP_NAME, version: APP_VERSION },
    exportedAt: input.exportedAt ?? new Date().toISOString(),
    dashboard: {
      title: input.title,
      description: input.description ?? '',
    },
    grid: {
      breakpoints: { ...BREAKPOINTS },
      columns: { ...GRID_COLUMNS },
    },
    widgets: input.widgets.map((widget) => ({ ...widget, config: { ...widget.config } })),
    layouts: cloneLayouts(input.layouts),
  };
}

/** Pretty printed JSON — the format users download and re-import. */
export function serializeDashboardDocument(document: DashboardDocument): string {
  return `${JSON.stringify(document, null, 2)}\n`;
}

/** Lower-cased, hyphenated slug for a dashboard title (may be empty). */
export function suggestedSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

/** Turn a dashboard title into a safe, stable file name. */
export function suggestedFileName(title: string, date: Date = new Date()): string {
  const slug = suggestedSlug(title);
  const stamp = date.toISOString().slice(0, 10);
  return `${EXPORT_FILE_PREFIX}${slug ? `-${slug}` : ''}-${stamp}.json`;
}
