/**
 * Import pipeline.
 *
 * Imported files are untrusted input: every field is validated, clamped and
 * normalised before it reaches the store. Unknown widget types are *kept* (so a
 * layout exported with a plugin that is not installed locally can be restored
 * later) but reported as warnings.
 */
import { APP_NAME, APP_VERSION, SCHEMA_VERSION } from '@/constants/app';
import { BREAKPOINT_ORDER, GRID_COLUMNS } from '@/constants/grid';
import { DASHBOARD_FORMAT } from '@/types';
import type {
  ColumnMap,
  DashboardDocument,
  GridItem,
  ImportResult,
  LayoutsByBreakpoint,
  StoredWidgetInstance,
  WidgetConfig,
} from '@/types';
import { normalizeLayout, reconcileLayouts } from './grid';
import { detectMarkupFile } from './embedded';
import { asNumber, asRecord, asString, createId, isRecord } from './utils';

/** Registry hooks, injected to keep this module free of widget imports. */
export interface ValidateOptions {
  /** Returns `true` when a widget type is registered locally. */
  isKnownType?: (type: string) => boolean;
  /** Default config for a widget type, merged underneath the imported config. */
  defaultConfigFor?: (type: string) => WidgetConfig | undefined;
  /** Display name for a widget type. */
  displayNameFor?: (type: string) => string | undefined;
  /** Column counts per breakpoint. */
  columns?: ColumnMap;
}

function titleFromType(type: string): string {
  const base = type.includes('.') ? type.slice(type.lastIndexOf('.') + 1) : type;
  const spaced = base.replace(/[_-]+/g, ' ').trim();
  if (spaced === '') return 'Widget';
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function coerceItem(value: unknown, columns: number): GridItem | null {
  if (!isRecord(value)) return null;
  const i = asString(value.i).trim();
  if (i === '') return null;
  const item: GridItem = {
    i,
    x: asNumber(value.x, 0),
    y: asNumber(value.y, 0),
    w: asNumber(value.w, 1),
    h: asNumber(value.h, 1),
  };
  if (value.minW !== undefined) item.minW = asNumber(value.minW, 1);
  if (value.minH !== undefined) item.minH = asNumber(value.minH, 1);
  if (value.maxW !== undefined) item.maxW = asNumber(value.maxW, columns);
  if (value.maxH !== undefined) item.maxH = asNumber(value.maxH, 1);
  return item;
}

function coerceWidget(value: unknown, options: ValidateOptions, warnings: string[]): StoredWidgetInstance | null {
  if (!isRecord(value)) return null;
  const type = asString(value.type).trim();
  if (type === '') {
    warnings.push('Skipped a widget without a "type" field.');
    return null;
  }
  const defaults = options.defaultConfigFor?.(type);
  const config = { ...(defaults ?? {}), ...asRecord(value.config) };
  const fallbackTitle = options.displayNameFor?.(type) ?? titleFromType(type);
  const title = asString(value.title).trim();
  const id = asString(value.id).trim() || createId(type);
  const createdAt = asNumber(value.createdAt, Date.now());

  if (options.isKnownType && !options.isKnownType(type)) {
    warnings.push(`Widget type "${type}" is not installed — it will be shown as unavailable until you add the plugin.`);
  }

  return { id, type, title: title === '' ? fallbackTitle : title, config, createdAt };
}

/** Validate (and normalise) a parsed JSON payload. */
export function validateDashboardDocument(input: unknown, options: ValidateOptions = {}): ImportResult {
  const warnings: string[] = [];
  const columns = options.columns ?? GRID_COLUMNS;

  if (!isRecord(input)) {
    return { ok: false, errors: ['The file does not contain a dashboard object.'] };
  }

  const format = asString(input.format).trim();
  if (format !== '' && format !== DASHBOARD_FORMAT) {
    return { ok: false, errors: [`Unsupported format "${format}". Expected "${DASHBOARD_FORMAT}".`] };
  }
  if (format === '') {
    warnings.push('The file has no format marker — imported in compatibility mode.');
  }

  const version = asNumber(input.version, 0);
  if (version > SCHEMA_VERSION) {
    return {
      ok: false,
      errors: [`This file was created by a newer version of ${APP_NAME} (schema v${version}). Please update the app.`],
    };
  }
  if (version < SCHEMA_VERSION) {
    warnings.push(`Migrated the file from schema v${version || 'unknown'} to v${SCHEMA_VERSION}.`);
  }

  if (!Array.isArray(input.widgets)) {
    return { ok: false, errors: ['The file is missing the "widgets" array.'] };
  }

  const widgets: StoredWidgetInstance[] = [];
  const seenIds = new Set<string>();
  for (const raw of input.widgets) {
    const widget = coerceWidget(raw, options, warnings);
    if (!widget) continue;
    if (seenIds.has(widget.id)) {
      widget.id = createId(widget.type);
      warnings.push('A duplicated widget id was replaced with a new one.');
    }
    seenIds.add(widget.id);
    widgets.push(widget);
  }

  const rawLayouts = isRecord(input.layouts) ? input.layouts : {};
  const layouts: LayoutsByBreakpoint = {};
  let droppedItems = 0;

  for (const breakpoint of BREAKPOINT_ORDER) {
    const rawLayout = rawLayouts[breakpoint];
    const items: GridItem[] = [];
    if (Array.isArray(rawLayout)) {
      for (const entry of rawLayout) {
        const item = coerceItem(entry, columns[breakpoint]);
        if (item) items.push(item);
        else droppedItems += 1;
      }
    }
    const normalised = normalizeLayout(items, columns[breakpoint]);
    droppedItems += items.length - normalised.length;
    layouts[breakpoint] = normalised;
  }

  const knownIds = new Set(widgets.map((widget) => widget.id));
  let unknownItems = 0;
  for (const breakpoint of BREAKPOINT_ORDER) {
    const kept = (layouts[breakpoint] ?? []).filter((item) => {
      if (knownIds.has(item.i)) return true;
      unknownItems += 1;
      return false;
    });
    layouts[breakpoint] = kept;
  }

  const reconciled = reconcileLayouts(
    layouts,
    widgets.map((widget) => {
      const size = findImportedSize(layouts, widget.id);
      return { id: widget.id, size };
    }),
    columns,
  );

  if (droppedItems > 0) warnings.push(`Ignored ${droppedItems} malformed layout ${droppedItems === 1 ? 'entry' : 'entries'}.`);
  if (unknownItems > 0) warnings.push(`Removed ${unknownItems} layout ${unknownItems === 1 ? 'entry' : 'entries'} for unknown widgets.`);

  const dashboard = asRecord(input.dashboard);
  const title = asString(dashboard.title).trim();
  const description = asString(dashboard.description).trim();

  const document: DashboardDocument = {
    format: DASHBOARD_FORMAT,
    version: SCHEMA_VERSION,
    generator: { name: APP_NAME, version: APP_VERSION },
    exportedAt: asString(input.exportedAt).trim() || new Date().toISOString(),
    dashboard: {
      title: title === '' ? 'My dashboard' : title,
      description,
    },
    grid: {
      breakpoints: isRecord(input.grid) && isRecord(input.grid.breakpoints)
        ? (input.grid.breakpoints as DashboardDocument['grid']['breakpoints'])
        : ({} as DashboardDocument['grid']['breakpoints']),
      columns,
    },
    widgets,
    layouts: reconciled,
  };

  return { ok: true, document, warnings };
}

/** Best effort extraction of the footprint a widget used in the imported file. */
function findImportedSize(layouts: LayoutsByBreakpoint, id: string) {
  for (const breakpoint of BREAKPOINT_ORDER) {
    const item = (layouts[breakpoint] ?? []).find((entry) => entry.i === id);
    if (item) {
      return { w: item.w, h: item.h, minW: item.minW, minH: item.minH };
    }
  }
  return { w: 3, h: 6, minW: 2, minH: 4 };
}

/** Parse a JSON string and validate it. */
export function parseDashboardJson(text: string, options: ValidateOptions = {}): ImportResult {
  const trimmed = text.trim();
  if (trimmed === '') {
    return { ok: false, errors: ['The file is empty.'] };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch (error) {
    // A file this app saved with "Save to file" is a whole HTML page, not JSON.
    // Saying so is far more useful than the raw `Unexpected token '<'`.
    const detectedAs = detectMarkupFile(trimmed);
    if (detectedAs === 'saved-dashboard-html') {
      return {
        ok: false,
        detectedAs,
        errors: [
          'This is a saved dashboard file, not a layout JSON. Open it in your browser to use the dashboard inside it.',
        ],
      };
    }
    if (detectedAs === 'html') {
      return {
        ok: false,
        detectedAs,
        errors: ['This is a web page, not a layout JSON file.'],
      };
    }
    return {
      ok: false,
      errors: [`The file is not valid JSON: ${error instanceof Error ? error.message : 'unknown error'}.`],
    };
  }
  return validateDashboardDocument(parsed, options);
}
