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
    warnings.push('One entry did not name a widget type, so it was skipped.');
    return null;
  }
  const defaults = options.defaultConfigFor?.(type);
  const config = { ...(defaults ?? {}), ...asRecord(value.config) };
  const fallbackTitle = options.displayNameFor?.(type) ?? titleFromType(type);
  const title = asString(value.title).trim();
  const id = asString(value.id).trim() || createId(type);
  const createdAt = asNumber(value.createdAt, Date.now());

  if (options.isKnownType && !options.isKnownType(type)) {
    warnings.push(
      `“${type}” is not part of this copy of the app, so that card will show as unavailable. Whatever was saved in it is kept.`,
    );
  }

  return { id, type, title: title === '' ? fallbackTitle : title, config, createdAt };
}

/** Validate (and normalise) a parsed JSON payload. */
export function validateDashboardDocument(input: unknown, options: ValidateOptions = {}): ImportResult {
  const warnings: string[] = [];
  const columns = options.columns ?? GRID_COLUMNS;

  if (!isRecord(input)) {
    return { ok: false, errors: ['That file does not contain a dashboard.'] };
  }

  const format = asString(input.format).trim();
  if (format !== '' && format !== DASHBOARD_FORMAT) {
    return { ok: false, errors: [`That file was written by a different app (it names the format “${format}”).`] };
  }
  if (format === '') {
    warnings.push('That file does not say what wrote it. It was read anyway.');
  }

  const version = asNumber(input.version, 0);
  if (version > SCHEMA_VERSION) {
    return {
      ok: false,
      errors: [
        `That file was made by a newer version of ${APP_NAME} (version ${version}). Update the app, then open it again.`,
      ],
    };
  }
  if (version < SCHEMA_VERSION) {
    warnings.push(`That file is from an older version, and was updated to this one (v${SCHEMA_VERSION}).`);
  }

  if (!Array.isArray(input.widgets)) {
    return { ok: false, errors: ['That file has no widgets in it.'] };
  }

  const widgets: StoredWidgetInstance[] = [];
  const seenIds = new Set<string>();
  for (const raw of input.widgets) {
    const widget = coerceWidget(raw, options, warnings);
    if (!widget) continue;
    if (seenIds.has(widget.id)) {
      widget.id = createId(widget.type);
      warnings.push('Two widgets in that file used the same ID, so one was given a new one.');
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

  if (droppedItems > 0)
    warnings.push(
      `Ignored ${droppedItems} placement ${droppedItems === 1 ? 'entry that did not make sense' : 'entries that did not make sense'}.`,
    );
  if (unknownItems > 0)
    warnings.push(
      `Removed ${unknownItems} placement ${unknownItems === 1 ? 'entry' : 'entries'} that belonged to no widget.`,
    );

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
    return { ok: false, errors: ['That file is empty.'] };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    // A file this app saved with "Save to file" is a whole HTML page, not JSON.
    // Saying so is far more useful than the raw `Unexpected token '<'`.
    const detectedAs = detectMarkupFile(trimmed);
    if (detectedAs === 'saved-dashboard-html') {
      return {
        ok: false,
        detectedAs,
        errors: [
          'That is a dashboard file, not a backup. Open it in your browser to use the dashboard inside it.',
        ],
      };
    }
    if (detectedAs === 'html') {
      return {
        ok: false,
        detectedAs,
        errors: ['That is a web page, not a dashboard backup.'],
      };
    }
    return {
      ok: false,
      // The parser's own text ("Unexpected token '<'") tells the user nothing
      // they can act on, so the message says what the file probably is instead.
      errors: ['That file could not be read as a dashboard backup.'],
    };
  }
  return validateDashboardDocument(parsed, options);
}
