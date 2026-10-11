/**
 * Application wide constants.
 */

export const APP_NAME = 'Lotus Dashboard Creator';
export const APP_SHORT_NAME = 'Lotus';
export const APP_TAGLINE = 'Arrange your workspace, your way';
export const APP_VERSION = '1.0.0';

/** Version of the exported/persisted dashboard schema. */
export const SCHEMA_VERSION = 1;

/** `localStorage` keys. The prefs key is also read by the inline theme script. */
export const STORAGE_KEYS = {
  workspace: 'lotus-dashboard-creator:workspace/v1',
  prefs: 'lotus-dashboard-creator:prefs/v1',
} as const;

/** Maximum number of undo steps kept in memory. */
export const MAX_HISTORY = 40;

/** Prefix used for exported files, e.g. `lotus-dashboard-2026-01-31.json`. */
export const EXPORT_FILE_PREFIX = 'lotus-dashboard';

/** Custom MIME type used when dragging a widget from the drawer to the canvas. */
export const WIDGET_DRAG_MIME = 'application/x-lotus-widget';

/**
 * Mimetype accepted by the import file picker.
 *
 * `.html`/`.htm` are included so a "Save to file" dashboard stays *selectable*:
 * the import dialog then explains that it is a standalone dashboard to open, not
 * a layout to import. Filtering it out of the picker only hid that explanation
 * behind a greyed-out file.
 */
export const IMPORT_ACCEPT = 'application/json,.json,.html,.htm';

/** Layout changes closer together than this are merged into one undo step. */
export const LAYOUT_HISTORY_COALESCE_MS = 900;
