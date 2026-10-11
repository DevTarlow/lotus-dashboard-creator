/**
 * Embedded dashboard state — Option B of the persistence design.
 *
 * A single-file build carries a JSON snapshot of the dashboard inside the HTML
 * itself, in:
 *
 *   <script type="application/json" id="lotus-embedded-workspace">…</script>
 *
 * Opening that file restores the dashboard it was saved with, on any machine and
 * in any browser, because the state travels with the file rather than living in
 * one browser's `localStorage`.
 *
 * Precedence: the embedded snapshot is a *seed*, not a cage. `localStorage` is
 * the live buffer while the user works, so on load we take whichever of the two
 * is newer by timestamp. That handles both directions:
 *
 *   - user edits, does not save, refreshes  → their browser copy is newer, wins
 *   - user receives a freshly saved file     → the file is newer, wins
 *
 * The Finnhub API key is deliberately *not* embedded. `prefsStore` promises it
 * stays in `localStorage` and is never written anywhere else; baking it into a
 * file the user might email would break that promise.
 */
import { APP_NAME, APP_VERSION, SCHEMA_VERSION } from '@/constants/app';
import { normalizeThemeInput, sanitizeThemeTokens } from '@/lib/theme';
import type { DetectedFileKind, ThemeId, ThemeMode, ThemeTokens } from '@/types';

/** Format discriminator written into the embedded block. */
export const EMBEDDED_FORMAT = 'lotus-embedded/v1' as const;

/** `id` of the script element holding the snapshot. */
export const EMBEDDED_ELEMENT_ID = 'lotus-embedded-workspace';

/** Preferences worth carrying with the file (never the API key). */
export interface EmbeddedPrefs {
  theme: ThemeMode;
  /** Palette preset the dashboard was saved with. */
  themeId: ThemeId;
  /** Accent override, `#rrggbb`, or `''` for the preset's own accent. */
  customAccentHex: string;
  /** Neutral warmth override in degrees, or `null` for the preset's hue. */
  customNeutralHue: number | null;
  /**
   * The palette as resolved when the file was written.
   *
   * Redundant with `themeId` (the app re-resolves on load) but kept so a saved
   * file is self-describing about how it looked, and so an older cache still
   * renders correctly if the preset data ever changes.
   */
  themeTokens: ThemeTokens;
  showGridHints: boolean;
  confirmDelete: boolean;
}

/** Workspace slice, shaped so `sanitizeWorkspace` can validate it directly. */
export interface EmbeddedWorkspace {
  title: string;
  description: string;
  widgets: unknown;
  layouts: unknown;
  locked: boolean;
  updatedAt: number;
}

export interface EmbeddedState {
  format: typeof EMBEDDED_FORMAT;
  version: number;
  generator: { name: string; version: string };
  /** Epoch ms — compared against the browser copy to decide which is newer. */
  savedAt: number;
  workspace: EmbeddedWorkspace;
  prefs: EmbeddedPrefs | null;
}

/** Minimal `document` surface, so this module is unit testable in plain Node. */
export interface DocumentLike {
  getElementById: (id: string) => { textContent: string | null } | null;
}

/** `true` for one of the three colour-scheme values the UI understands. */
function isThemeMode(value: unknown): value is ThemeMode {
  return value === 'light' || value === 'dark' || value === 'system';
}

function currentDocument(): DocumentLike | undefined {
  return (globalThis as { document?: DocumentLike }).document;
}

/**
 * Encode a payload as JSON that is safe to inline in an HTML `<script>` element.
 *
 * `JSON.stringify` happily emits a literal `</script>` when a widget contains
 * one (a markdown note is the obvious way), which would end the element early and
 * corrupt the file. Escaping every `</` as `<\/` is valid JSON and immune to it.
 */
export function encodeEmbeddedState(state: EmbeddedState): string {
  return JSON.stringify(state).replace(/<\//g, '<\\/');
}

/** Build the snapshot for the current application state. */
export function createEmbeddedState(input: {
  workspace: Omit<EmbeddedWorkspace, 'updatedAt'>;
  prefs: EmbeddedPrefs | null;
  savedAt?: number;
}): EmbeddedState {
  const savedAt = input.savedAt ?? Date.now();
  return {
    format: EMBEDDED_FORMAT,
    version: SCHEMA_VERSION,
    generator: { name: APP_NAME, version: APP_VERSION },
    savedAt,
    workspace: { ...input.workspace, updatedAt: savedAt },
    prefs: input.prefs,
  };
}

/**
 * Sanitise the preference block of an untrusted file.
 *
 * A saved dashboard is something a user may receive from someone else, so it is
 * treated as input rather than as state: colours are validated, an unknown
 * preset id falls back to the default, and only known token keys survive.
 * Booleans keep the store's own defaults when the file does not carry them.
 */
export function sanitizeEmbeddedPrefs(raw: unknown): EmbeddedPrefs | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;
  const themeInput = normalizeThemeInput({
    themeId: value.themeId,
    customAccentHex: value.customAccentHex,
    customNeutralHue: value.customNeutralHue,
  });

  return {
    theme: isThemeMode(value.theme) ? value.theme : 'system',
    ...themeInput,
    themeTokens: sanitizeThemeTokens(value.themeTokens),
    showGridHints: typeof value.showGridHints === 'boolean' ? value.showGridHints : true,
    // Match the store's default: a file written before this preference existed
    // must not arrive with confirmations switched off.
    confirmDelete: typeof value.confirmDelete === 'boolean' ? value.confirmDelete : true,
  };
}

/**
 * Parse the snapshot embedded in the page, or `null` when there is none (dev
 * server, web deployment) or it is not ours.
 *
 * Deliberately forgiving: a malformed or foreign block must never stop the app
 * from booting, so every failure returns `null` and the caller falls back to the
 * default workspace.
 */
export function readEmbeddedState(doc: DocumentLike | undefined = currentDocument()): EmbeddedState | null {
  if (!doc) return null;
  let text: string | null;
  try {
    text = doc.getElementById(EMBEDDED_ELEMENT_ID)?.textContent ?? null;
  } catch {
    return null;
  }
  if (!text || text.trim() === '') return null;
  try {
    const parsed = JSON.parse(text) as Partial<EmbeddedState> | null;
    if (!parsed || typeof parsed !== 'object') return null;
    if (parsed.format !== EMBEDDED_FORMAT) return null;
    if (!parsed.workspace || typeof parsed.workspace !== 'object') return null;
    const savedAt = typeof parsed.savedAt === 'number' && Number.isFinite(parsed.savedAt) ? parsed.savedAt : 0;
    return {
      format: EMBEDDED_FORMAT,
      version: typeof parsed.version === 'number' ? parsed.version : SCHEMA_VERSION,
      generator: parsed.generator ?? { name: APP_NAME, version: APP_VERSION },
      savedAt,
      workspace: parsed.workspace as EmbeddedWorkspace,
      prefs: sanitizeEmbeddedPrefs(parsed.prefs),
    };
  } catch {
    return null;
  }
}

/**
 * Decide whether a text that failed to parse as JSON is really markup.
 *
 * Feeding a saved dashboard file to "Import layout from JSON" used to produce
 * only `Unexpected token '<'`, which tells the user nothing. Recognising markup
 * lets the import dialog explain what the file is and what to do with it instead.
 *
 * Pure and deliberately forgiving: it only needs to be right about files this app
 * wrote, and about obviously-markup text. `null` means "not markup, run the
 * normal JSON error path".
 */
export function detectMarkupFile(text: string): DetectedFileKind | null {
  // A saved page starts with a doctype or a tag, possibly after a BOM/blank line.
  if (!text.slice(0, 1024).trimStart().startsWith('<')) return null;
  return hasEmbeddedSnapshot(text) ? 'saved-dashboard-html' : 'html';
}

/**
 * `true` when the markup contains one of our embedded snapshot blocks.
 *
 * Matched on the element id rather than the whole serialised tag, so attribute
 * order or extra attributes cannot make a file saved by this app unrecognisable.
 */
export function hasEmbeddedSnapshot(text: string): boolean {
  const idThenClosing = new RegExp(`<script[^>]*\\bid\\s*=\\s*["']?${EMBEDDED_ELEMENT_ID}["'\\s>]`, 'i');
  return idThenClosing.test(text);
}

/**
 * `true` when the file's snapshot should win over the browser copy.
 *
 * Strictly newer wins, so an untouched dashboard keeps using the file, and any
 * local edit (which stamps a later `updatedAt`) takes over until the next save.
 */
export function shouldPreferEmbedded(embedded: EmbeddedState | null, persistedUpdatedAt: number): boolean {
  if (!embedded) return false;
  const persisted = Number.isFinite(persistedUpdatedAt) ? persistedUpdatedAt : 0;
  return embedded.savedAt > persisted;
}
