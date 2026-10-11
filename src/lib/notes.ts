/**
 * Notes model.
 *
 * The notes widget keeps every note inside its widget config, so the whole
 * "file system" is just a serialisable record: persisted to `localStorage`,
 * carried by an export and frozen into the embedded single-file snapshot by the
 * existing dashboard persistence. This module holds the pure part — creating,
 * titling, patching and removing notes, plus normalising whatever shape was
 * loaded from storage into a usable one.
 */
import { asBoolean, asNumber, asString, createId, isRecord } from './utils';

/** One saved note. */
export interface Note {
  id: string;
  /** Raw markdown source. */
  text: string;
  /** Creation timestamp (epoch ms). */
  createdAt: number;
  /** Last edit timestamp (epoch ms). */
  updatedAt: number;
}

export type NotesMode = 'edit' | 'split' | 'preview';
export type NotesFontSize = 'sm' | 'md' | 'lg';

/** Normalised notes widget config. */
export interface NotesState {
  notes: Note[];
  /** Id of the note shown in the editor pane. */
  activeNoteId: string;
  mode: NotesMode;
  fontSize: NotesFontSize;
  /** Whether the file-manager panel is expanded. */
  sidebarOpen: boolean;
  /** Notes panel width share, in percent (see `clampSidebarRatio`). */
  sidebarRatio: number;
  /** Editor pane width share in split view, in percent (see `clampEditorRatio`). */
  editorRatio: number;
}

export const NOTES_MODES: readonly NotesMode[] = ['edit', 'split', 'preview'];
export const NOTES_FONT_SIZES: readonly NotesFontSize[] = ['sm', 'md', 'lg'];

export function isNotesMode(value: unknown): value is NotesMode {
  return NOTES_MODES.includes(value as NotesMode);
}

export function isNotesFontSize(value: unknown): value is NotesFontSize {
  return NOTES_FONT_SIZES.includes(value as NotesFontSize);
}

/** Longest derived title, in characters. */
export const NOTE_TITLE_MAX = 48;

/* --------------------------------------------------------------- split view */

/** Width share of the editor pane in split view, as a percentage. */
export const DEFAULT_EDITOR_RATIO = 50;

/**
 * How far the editor/preview divider can travel, in percent.
 *
 * Kept well inside the edges: a pane dragged to nothing is impossible to grab
 * back, and two panes at 15% still show a usable column at the widget's smallest
 * allowed width.
 */
export const MIN_EDITOR_RATIO = 15;
export const MAX_EDITOR_RATIO = 85;

/** Width share of the notes panel, as a percentage, and its travel limits. */
export const DEFAULT_SIDEBAR_RATIO = 25;
export const MIN_SIDEBAR_RATIO = 15;
export const MAX_SIDEBAR_RATIO = 60;

/** Keyboard step, in percent, for a divider's arrow keys. */
export const EDITOR_RATIO_STEP = 2;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)));
}

/** Clamp a split ratio into the allowed range, tolerating junk input. */
export function clampEditorRatio(value: unknown): number {
  const ratio = typeof value === 'number' && Number.isFinite(value) ? value : DEFAULT_EDITOR_RATIO;
  return clamp(ratio, MIN_EDITOR_RATIO, MAX_EDITOR_RATIO);
}

/** Clamp the notes panel's width share. */
export function clampSidebarRatio(value: unknown): number {
  const ratio = typeof value === 'number' && Number.isFinite(value) ? value : DEFAULT_SIDEBAR_RATIO;
  return clamp(ratio, MIN_SIDEBAR_RATIO, MAX_SIDEBAR_RATIO);
}

/**
 * Copy for the first note of a brand-new widget. Also the text every scratchpad
 * created before multi-note support migrates into.
 */
export const WELCOME_NOTE_TEXT = `# Notes

This panel saves as you type. Switch to **Preview** or **Split** to see the text as it will look.

Notes live in the column on the left. Make as many as you like, and drag the divider
between the two sides to give the list more room.

A little markdown to start from:
- \`#\` for a heading, \`-\` for a bullet
- \`**bold**\` and \`*italic*\`
- \`[a link](https://example.com)\`

These notes are part of the dashboard, so they are saved with it and travel in a copy of the file.`;

/**
 * Id of the note a brand-new widget starts with. Fixed so a config that only
 * contains the widget defaults is recognisable during migration, below.
 */
export const DEFAULT_NOTE_ID = 'note-welcome';

/** The note every new notes widget starts with. */
export function createDefaultNote(now = Date.now()): Note {
  return { id: DEFAULT_NOTE_ID, text: WELCOME_NOTE_TEXT, createdAt: now, updatedAt: now };
}

/** `true` for the untouched defaults, i.e. no note the user ever created. */
function isDefaultNote(note: Note): boolean {
  return note.id === DEFAULT_NOTE_ID && note.text === WELCOME_NOTE_TEXT;
}

/** Strip the markdown noise a one-line list label should not show. */
function stripMarkdown(line: string): string {
  return line
    .replace(/^\s*(?:#{1,6}\s+|>\s?|[-*+]\s+|\d{1,9}[.)]\s+)/, '')
    .replace(/^\s*\[[ xX]\]\s*/, '')
    .replace(/!?\[([^\]]*)\]\([^)\s]*\)/g, '$1')
    .replace(/(\*\*|__|~~|`|\*|_)/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** First non-empty line of a note, cleaned up for display in the sidebar. */
export function deriveNoteTitle(text: string): string {
  for (const line of text.split('\n')) {
    const stripped = stripMarkdown(line);
    if (stripped !== '') return stripped.slice(0, NOTE_TITLE_MAX);
  }
  return 'Untitled note';
}

/** First line of body text after the title line, for the sidebar row. */
export function notePreview(text: string): string {
  const lines = text.split('\n');
  let skippedTitle = false;
  for (const line of lines) {
    const stripped = stripMarkdown(line);
    if (stripped === '') continue;
    if (!skippedTitle) {
      skippedTitle = true;
      continue;
    }
    return stripped.slice(0, NOTE_TITLE_MAX);
  }
  return '';
}

/** Word count used by both the sidebar and the footer stats. */
export function countNoteWords(text: string): number {
  const trimmed = text.trim();
  return trimmed === '' ? 0 : trimmed.split(/\s+/).length;
}

/** Create a note. Empty text produces an "Untitled note". */
export function createNote(text = '', now = Date.now()): Note {
  return { id: createId('note'), text, createdAt: now, updatedAt: now };
}

/** Patch one note, stamping `updatedAt`. Unknown ids return the array unchanged. */
export function updateNote(notes: readonly Note[], id: string, patch: Partial<Note>, now = Date.now()): Note[] {
  let changed = false;
  const next = notes.map((note) => {
    if (note.id !== id) return note;
    changed = true;
    return { ...note, ...patch, id: note.id, updatedAt: now };
  });
  return changed ? next : (notes as Note[]);
}

/** Remove a note. Unknown ids return the array unchanged. */
export function removeNote(notes: readonly Note[], id: string): Note[] {
  const next = notes.filter((note) => note.id !== id);
  return next.length === notes.length ? (notes as Note[]) : next;
}

/**
 * Which note to show after `removedId` disappears: the one that took its place,
 * else the previous one, else the first, else nothing (list is now empty).
 */
export function selectAfterRemoval(notes: readonly Note[], removedId: string): string {
  const index = notes.findIndex((note) => note.id === removedId);
  const remaining = notes.filter((note) => note.id !== removedId);
  if (remaining.length === 0) return '';
  if (index === -1) return remaining[0].id;
  return remaining[Math.min(index, remaining.length - 1)].id;
}

/** The persisted shape of a single note, before repair. */
interface StoredNote {
  id?: string;
  text?: string;
  createdAt?: number;
  updatedAt?: number;
}

/** `true` when a value is already a complete, usable note. */
function isCompleteNote(value: unknown): value is StoredNote & Required<StoredNote> {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === 'string' &&
    value.id.trim() !== '' &&
    typeof value.text === 'string' &&
    typeof value.createdAt === 'number' &&
    typeof value.updatedAt === 'number'
  );
}

function coerceNote(value: unknown, seen: Set<string>): Note | null {
  if (!isRecord(value)) return null;
  const source = value as StoredNote;
  const text = asString(source.text);
  const rawId = asString(source.id).trim();
  const createdAt = asNumber(source.createdAt, Date.now());
  const updatedAt = asNumber(source.updatedAt, createdAt);
  const id = rawId === '' || seen.has(rawId) ? createId('note') : rawId;
  seen.add(id);
  return { id, text, createdAt, updatedAt };
}

/**
 * Normalise any loaded config into {@link NotesState}.
 *
 * Accepts the single-note shape used before the file-manager panel existed
 * (`{ text: string }`) and turns it into one note, so old workspaces, old
 * exports and old templates keep their content. Anything malformed is repaired
 * rather than dropped silently.
 *
 * One subtlety: rehydration and import merge the widget defaults *underneath* the
 * stored config (`validateDashboardDocument`). A pre-panel scratchpad therefore
 * arrives as `{ text, ...newDefaults }` — including the default welcome note — so
 * a lone, untouched default note is treated as "no note the user made" and the
 * legacy text replaces it. Without that, every existing user would open the new
 * panel and find the welcome copy instead of their own notes.
 */
export function normalizeNotesState(config: unknown, now = Date.now()): NotesState {
  const record = isRecord(config) ? config : {};
  const seen = new Set<string>();
  let notes: Note[] = [];

  if (Array.isArray(record.notes)) {
    for (const raw of record.notes) {
      const note = coerceNote(raw, seen);
      if (note) notes.push(note);
    }
  }

  const hasLegacyText = Object.prototype.hasOwnProperty.call(record, 'text') && typeof record.text === 'string';
  if (notes.length === 1 && isDefaultNote(notes[0]) && hasLegacyText) {
    notes = [];
  }

  if (notes.length === 0) {
    // An explicit empty `notes` array is the user having deleted every note —
    // that stays empty. Only a missing list falls back to the legacy text (an
    // empty legacy `text` is still a note the user emptied, hence `hasOwn`), and
    // only a config with neither seeds the welcome note.
    const hasStoredNotes = Array.isArray(record.notes) && !hasLegacyText;
    if (!hasStoredNotes) {
      notes.push(createNote(hasLegacyText ? (record.text as string) : WELCOME_NOTE_TEXT, now));
    }
  }

  const requestedId = asString(record.activeNoteId, '');
  const activeNoteId = notes.some((note) => note.id === requestedId) ? requestedId : (notes[0]?.id ?? '');

  return {
    notes,
    activeNoteId,
    mode: isNotesMode(record.mode) ? record.mode : 'split',
    fontSize: isNotesFontSize(record.fontSize) ? record.fontSize : 'md',
    sidebarOpen: asBoolean(record.sidebarOpen, true),
    sidebarRatio: clampSidebarRatio(record.sidebarRatio),
    editorRatio: clampEditorRatio(record.editorRatio),
  };
}

/** `true` when a value is a ratio this config can keep as-is. */
function isStoredRatio(value: unknown, clampRatio: (input: unknown) => number): boolean {
  return typeof value === 'number' && Number.isFinite(value) && clampRatio(value) === value;
}

/**
 * `true` when a loaded config predates the file-manager panel or is incomplete,
 * so the widget knows to write the normalised shape back once on mount.
 */
export function needsNotesMigration(config: unknown): boolean {
  const record = isRecord(config) ? config : {};
  // The legacy single-note key is only present on pre-panel configs; dropping it
  // immediately keeps exports free of a field nothing reads any more.
  if (typeof record.text === 'string') return true;
  if (!Array.isArray(record.notes)) return true;

  const notes: readonly unknown[] = record.notes;
  // An empty list is a valid state (the user deleted every note), not something
  // to repair — re-seeding has to stay explicit, via "New note".
  if (!notes.every(isCompleteNote)) return true;
  const ids = new Set(notes.map((note) => note.id));
  if (ids.size !== notes.length) return true;
  if (!isStoredRatio(record.editorRatio, clampEditorRatio)) return true;
  if (!isStoredRatio(record.sidebarRatio, clampSidebarRatio)) return true;
  if (notes.length === 0) {
    return !isNotesFontSize(record.fontSize) || typeof record.sidebarOpen !== 'boolean';
  }
  if (!ids.has(asString(record.activeNoteId, ''))) return true;

  return (
    !isNotesMode(record.mode) || !isNotesFontSize(record.fontSize) || typeof record.sidebarOpen !== 'boolean'
  );
}
