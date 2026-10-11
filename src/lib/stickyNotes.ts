/**
 * Sticky notes model.
 *
 * The quick-notes widget ("post-it" notes) keeps every note inside its widget
 * config, exactly like the markdown notes panel, so the existing dashboard
 * persistence — `localStorage`, exports and the embedded single-file snapshot —
 * carries them with no extra storage layer.
 *
 * This module holds the pure part: creating, ordering (pinned first), patching
 * and removing notes, turning a list into plain text for the clipboard, and
 * repairing whatever shape was loaded from storage into a usable one.
 */
import { asBoolean, asNumber, asString, createId, isRecord } from './utils';

/** The post-it palette. Ids only — the widget owns the Tailwind classes. */
export const STICKY_COLORS = ['yellow', 'pink', 'blue', 'green', 'purple'] as const;
export type StickyColor = (typeof STICKY_COLORS)[number];

export const STICKY_FONT_SIZES = ['sm', 'md', 'lg'] as const;
export type StickyFontSize = (typeof STICKY_FONT_SIZES)[number];

export const DEFAULT_STICKY_COLOR: StickyColor = 'yellow';
export const DEFAULT_STICKY_FONT_SIZE: StickyFontSize = 'md';

export function isStickyColor(value: unknown): value is StickyColor {
  return STICKY_COLORS.includes(value as StickyColor);
}

export function isStickyFontSize(value: unknown): value is StickyFontSize {
  return STICKY_FONT_SIZES.includes(value as StickyFontSize);
}

/**
 * Longest note body, in characters.
 *
 * A post-it is a thought, not a document: the cap keeps a paste of an entire
 * article from bloating `localStorage` and the undo stack. The textarea carries
 * the same limit, so the cap is only visible on a paste.
 */
export const STICKY_TEXT_MAX = 2000;

/** Most notes one widget will hold. Extra "New note" clicks are refused. */
export const MAX_STICKY_NOTES = 60;

/** One saved sticky note. */
export interface StickyNote {
  id: string;
  /** Raw plain text — no markdown parsing anywhere in this widget. */
  text: string;
  color: StickyColor;
  /** Pinned notes are grouped above the rest. */
  pinned: boolean;
  /** Creation timestamp (epoch ms). */
  createdAt: number;
  /** Last edit timestamp (epoch ms). */
  updatedAt: number;
}

/** Normalised sticky notes widget config. */
export interface StickyNotesState {
  notes: StickyNote[];
  fontSize: StickyFontSize;
  /** Colour a brand-new note starts in. */
  defaultColor: StickyColor;
}

/** Longest derived label, in characters. */
export const STICKY_TITLE_MAX = 48;

/** The note a brand-new widget starts with. */
export const WELCOME_STICKY_TEXT = 'Pin a note to keep it at the top. Copy, edit or delete it from its corner.';

/** Trim a note's text to the storage cap. */
export function clampStickyText(text: string): string {
  return text.length > STICKY_TEXT_MAX ? text.slice(0, STICKY_TEXT_MAX) : text;
}

/**
 * A one-line label for a note: its first non-empty line, whitespace collapsed.
 * Plain text, so nothing is stripped from it — a sticky note *is* what it says.
 */
export function stickyTitle(text: string): string {
  for (const line of text.split('\n')) {
    const trimmed = line.replace(/\s+/g, ' ').trim();
    if (trimmed !== '') return trimmed.slice(0, STICKY_TITLE_MAX);
  }
  return 'Empty note';
}

/** Create a note. Empty text shows as "Empty note" until it is written into. */
export function createStickyNote(text = '', color: StickyColor = DEFAULT_STICKY_COLOR, now = Date.now()): StickyNote {
  return { id: createId('sticky'), text: clampStickyText(text), color, pinned: false, createdAt: now, updatedAt: now };
}

/**
 * The welcome note, with a fixed id so the untouched defaults are recognisable
 * (the tests and the browser checks both rely on it).
 */
export const DEFAULT_STICKY_ID = 'sticky-welcome';

export function createWelcomeStickyNote(now = Date.now()): StickyNote {
  return { id: DEFAULT_STICKY_ID, text: WELCOME_STICKY_TEXT, color: DEFAULT_STICKY_COLOR, pinned: false, createdAt: now, updatedAt: now };
}

/**
 * Pinned notes first, each group keeping the order it was stored in.
 *
 * Ordering is a *view*: `toggleStickyPin` already moves a note between groups in
 * the stored array, so a freshly toggled note is where the user expects. The
 * sort exists for a list that arrived from an import or an older/hand-edited
 * config, where pinned notes could sit anywhere.
 */
export function sortStickyNotes(notes: readonly StickyNote[]): StickyNote[] {
  const pinned: StickyNote[] = [];
  const rest: StickyNote[] = [];
  for (const note of notes) (note.pinned ? pinned : rest).push(note);
  return [...pinned, ...rest];
}

/** Patch one note, stamping `updatedAt`. Unknown ids return the array unchanged. */
export function updateStickyNote(
  notes: readonly StickyNote[],
  id: string,
  patch: Partial<Omit<StickyNote, 'id'>>,
  now = Date.now(),
): StickyNote[] {
  let changed = false;
  const next = notes.map((note) => {
    if (note.id !== id) return note;
    changed = true;
    const text = patch.text === undefined ? note.text : clampStickyText(patch.text);
    return { ...note, ...patch, text, id: note.id, updatedAt: now };
  });
  return changed ? next : (notes as StickyNote[]);
}

/** Remove a note. Unknown ids return the array unchanged. */
export function removeStickyNote(notes: readonly StickyNote[], id: string): StickyNote[] {
  const next = notes.filter((note) => note.id !== id);
  return next.length === notes.length ? (notes as StickyNote[]) : next;
}

/**
 * Put a note back where it was, for the toast's undo action. An id already in
 * the list wins over the newcomer, so an undo can never duplicate a note.
 */
export function insertStickyNote(notes: readonly StickyNote[], note: StickyNote, index = 0): StickyNote[] {
  if (notes.some((existing) => existing.id === note.id)) return notes as StickyNote[];
  const target = Math.min(Math.max(Math.round(index), 0), notes.length);
  const next = [...notes];
  next.splice(target, 0, note);
  return next;
}

/**
 * Pin a note, or unpin it.
 *
 * Pinning lifts the note to the top of the pinned group, which is the feedback
 * the gesture needs; unpinning drops it to the first unpinned slot so the pinned
 * block stays contiguous. Unknown ids return the array unchanged.
 */
export function toggleStickyPin(notes: readonly StickyNote[], id: string, now = Date.now()): StickyNote[] {
  const note = notes.find((candidate) => candidate.id === id);
  if (!note) return notes as StickyNote[];
  const pinned = !note.pinned;
  const updated: StickyNote = { ...note, pinned, updatedAt: now };
  const without = notes.filter((candidate) => candidate.id !== id);
  const index = pinned ? 0 : without.filter((candidate) => candidate.pinned).length;
  const next = [...without];
  next.splice(index, 0, updated);
  return next;
}

/** `true` when a stored note is already in the shape this module writes. */
function isCompleteStickyNote(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === 'string' &&
    value.id.trim() !== '' &&
    typeof value.text === 'string' &&
    value.text.length <= STICKY_TEXT_MAX &&
    isStickyColor(value.color) &&
    typeof value.pinned === 'boolean' &&
    typeof value.createdAt === 'number' &&
    typeof value.updatedAt === 'number'
  );
}

/**
 * `true` when a loaded config is not already in the normalised shape, so the
 * widget knows to write the repaired state back once on mount.
 *
 * Without the write-back a hand-edited import would be repaired into a *new*
 * shape on every render — freshly generated ids included — which is unstable for
 * React keys and would leave junk keys in the next export.
 */
export function needsStickyMigration(config: unknown): boolean {
  const record = isRecord(config) ? config : {};
  if (!Array.isArray(record.notes)) return true;
  const notes: readonly unknown[] = record.notes;
  if (!notes.every(isCompleteStickyNote)) return true;
  const ids = new Set(notes.map((note) => (note as { id: string }).id));
  if (ids.size !== notes.length) return true;
  return !isStickyFontSize(record.fontSize) || !isStickyColor(record.defaultColor);
}

/** `true` while another note may be added. */
export function canAddStickyNote(notes: readonly StickyNote[]): boolean {
  return notes.length < MAX_STICKY_NOTES;
}

/**
 * Every note as one plain-text blob, in display order (pinned first), separated
 * by a blank line. Empty notes contribute nothing.
 */
export function stickyNotesToPlainText(notes: readonly StickyNote[]): string {
  return sortStickyNotes(notes)
    .map((note) => note.text.trim())
    .filter((text) => text !== '')
    .join('\n\n');
}

/** The persisted shape of a single note, before repair. */
interface StoredNote {
  id?: unknown;
  text?: unknown;
  color?: unknown;
  pinned?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
}

function coerceStickyNote(value: unknown, seen: Set<string>, defaultColor: StickyColor): StickyNote | null {
  if (!isRecord(value)) return null;
  const source = value as StoredNote;
  const rawId = asString(source.id).trim();
  const id = rawId === '' || seen.has(rawId) ? createId('sticky') : rawId;
  seen.add(id);
  const createdAt = asNumber(source.createdAt, Date.now());
  return {
    id,
    text: clampStickyText(asString(source.text)),
    color: isStickyColor(source.color) ? source.color : defaultColor,
    pinned: asBoolean(source.pinned, false),
    createdAt,
    updatedAt: asNumber(source.updatedAt, createdAt),
  };
}

/**
 * Normalise any loaded config into {@link StickyNotesState}.
 *
 * A stored `notes` array always wins — including an empty one, which is the user
 * having deleted every note and must stay empty rather than be re-seeded. Only a
 * config with no list at all (a hand-written import) falls back to the welcome
 * note. Malformed entries are repaired rather than dropped.
 */
export function normalizeStickyNotesState(config: unknown, now = Date.now()): StickyNotesState {
  const record = isRecord(config) ? config : {};
  const defaultColor = isStickyColor(record.defaultColor) ? record.defaultColor : DEFAULT_STICKY_COLOR;
  const seen = new Set<string>();
  const notes: StickyNote[] = [];

  if (Array.isArray(record.notes)) {
    for (const raw of record.notes) {
      const note = coerceStickyNote(raw, seen, defaultColor);
      if (note) notes.push(note);
    }
  } else {
    notes.push(createWelcomeStickyNote(now));
  }

  return {
    notes,
    fontSize: isStickyFontSize(record.fontSize) ? record.fontSize : DEFAULT_STICKY_FONT_SIZE,
    defaultColor,
  };
}
