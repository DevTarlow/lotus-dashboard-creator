import { describe, expect, it } from 'vitest';
import {
  DEFAULT_STICKY_COLOR,
  DEFAULT_STICKY_ID,
  MAX_STICKY_NOTES,
  STICKY_TEXT_MAX,
  WELCOME_STICKY_TEXT,
  canAddStickyNote,
  clampStickyText,
  createStickyNote,
  createWelcomeStickyNote,
  insertStickyNote,
  isStickyColor,
  isStickyFontSize,
  normalizeStickyNotesState,
  needsStickyMigration,
  removeStickyNote,
  sortStickyNotes,
  stickyNotesToPlainText,
  stickyTitle,
  toggleStickyPin,
  updateStickyNote,
  type StickyNote,
} from '@/lib/stickyNotes';

/** Compact note factory: everything except the id has a sensible default. */
function note(id: string, patch: Partial<Omit<StickyNote, 'id'>> = {}): StickyNote {
  return {
    id,
    text: patch.text ?? `Note ${id}`,
    color: patch.color ?? 'yellow',
    pinned: patch.pinned ?? false,
    createdAt: patch.createdAt ?? 0,
    updatedAt: patch.updatedAt ?? 0,
  };
}

const ids = (notes: readonly StickyNote[]): string[] => notes.map((entry) => entry.id);

describe('sticky note values', () => {
  it('recognises its own colour and font ids, and nothing else', () => {
    expect(isStickyColor('yellow')).toBe(true);
    expect(isStickyColor('purple')).toBe(true);
    expect(isStickyColor('chartreuse')).toBe(false);
    expect(isStickyColor(undefined)).toBe(false);
    expect(isStickyFontSize('md')).toBe(true);
    expect(isStickyFontSize('xl')).toBe(false);
  });

  it('clamps text to the storage cap and leaves shorter text alone', () => {
    expect(clampStickyText('short')).toBe('short');
    const long = 'x'.repeat(STICKY_TEXT_MAX + 50);
    expect(clampStickyText(long)).toHaveLength(STICKY_TEXT_MAX);
    expect(clampStickyText(long)).toBe(long.slice(0, STICKY_TEXT_MAX));
  });

  it('derives a one-line label from the first non-empty line', () => {
    expect(stickyTitle('  Buy oat milk  \nsecond line')).toBe('Buy oat milk');
    expect(stickyTitle('\n\n   \nSecond block')).toBe('Second block');
    expect(stickyTitle(''.padEnd(4, '\n'))).toBe('Empty note');
    expect(stickyTitle('a'.repeat(80))).toHaveLength(48);
    // The label is plain text: markdown is part of what the note says.
    expect(stickyTitle('## Headings stay verbatim')).toBe('## Headings stay verbatim');
  });

  it('creates a note with an id, a colour and matching timestamps', () => {
    const created = createStickyNote('hello', 'blue', 1234);
    expect(created.id).toMatch(/^sticky_/);
    expect(created.text).toBe('hello');
    expect(created.color).toBe('blue');
    expect(created.pinned).toBe(false);
    expect(created.createdAt).toBe(1234);
    expect(created.updatedAt).toBe(1234);
    expect(createStickyNote('x').color).toBe(DEFAULT_STICKY_COLOR);
  });

  it('clamps a created note to the text cap', () => {
    expect(createStickyNote('y'.repeat(STICKY_TEXT_MAX + 10)).text).toHaveLength(STICKY_TEXT_MAX);
  });

  it('refuses another note once the cap is reached', () => {
    const many = Array.from({ length: MAX_STICKY_NOTES }, (_, index) => note(`n${index}`));
    expect(canAddStickyNote(many.slice(0, MAX_STICKY_NOTES - 1))).toBe(true);
    expect(canAddStickyNote(many)).toBe(false);
  });
});

describe('sortStickyNotes', () => {
  it('puts pinned notes first and keeps each group in stored order', () => {
    const notes = [note('a'), note('b', { pinned: true }), note('c'), note('d', { pinned: true })];
    expect(ids(sortStickyNotes(notes))).toEqual(['b', 'd', 'a', 'c']);
  });

  it('never mutates the input', () => {
    const notes = [note('a'), note('b', { pinned: true })];
    sortStickyNotes(notes);
    expect(ids(notes)).toEqual(['a', 'b']);
  });

  it('is stable for an already-grouped list', () => {
    const notes = [note('a', { pinned: true }), note('b'), note('c')];
    expect(ids(sortStickyNotes(notes))).toEqual(['a', 'b', 'c']);
  });
});

describe('toggleStickyPin', () => {
  it('lifts a pinned note to the top of the pinned group', () => {
    const notes = [note('a', { pinned: true }), note('b'), note('c')];
    const next = toggleStickyPin(notes, 'c', 99);
    expect(ids(next)).toEqual(['c', 'a', 'b']);
    expect(next[0].pinned).toBe(true);
    expect(next[0].updatedAt).toBe(99);
  });

  it('drops an unpinned note to the first unpinned slot', () => {
    const notes = [note('a', { pinned: true }), note('b', { pinned: true }), note('c'), note('d')];
    const next = toggleStickyPin(notes, 'a');
    expect(ids(next)).toEqual(['b', 'a', 'c', 'd']);
    expect(next.find((entry) => entry.id === 'a')?.pinned).toBe(false);
  });

  it('keeps the pinned block contiguous when the list is out of order', () => {
    // A hand-edited import: a pinned note sitting in the middle.
    const notes = [note('a'), note('b', { pinned: true }), note('c')];
    const next = toggleStickyPin(notes, 'c');
    expect(ids(sortStickyNotes(next))).toEqual(['c', 'b', 'a']);
  });

  it('returns the array unchanged for an unknown id', () => {
    const notes = [note('a')];
    expect(toggleStickyPin(notes, 'nope')).toBe(notes);
  });
});

describe('updateStickyNote / removeStickyNote / insertStickyNote', () => {
  it('patches a note, stamps updatedAt and clamps the new text', () => {
    const notes = [note('a'), note('b')];
    const next = updateStickyNote(notes, 'b', { text: 'z'.repeat(STICKY_TEXT_MAX + 5), color: 'pink' }, 42);
    expect(next[0]).toBe(notes[0]);
    expect(next[1].text).toHaveLength(STICKY_TEXT_MAX);
    expect(next[1].color).toBe('pink');
    expect(next[1].updatedAt).toBe(42);
    expect(next[1].createdAt).toBe(0);
  });

  it('never lets a patch change a note id', () => {
    const next = updateStickyNote([note('a')], 'a', { id: 'b' } as never);
    expect(next[0].id).toBe('a');
  });

  it('returns the same array when the id is unknown', () => {
    const notes = [note('a')];
    expect(updateStickyNote(notes, 'nope', { text: 'x' })).toBe(notes);
    expect(removeStickyNote(notes, 'nope')).toBe(notes);
  });

  it('removes exactly one note', () => {
    expect(ids(removeStickyNote([note('a'), note('b'), note('c')], 'b'))).toEqual(['a', 'c']);
  });

  it('inserts a note at a clamped index, for the undo action', () => {
    const notes = [note('a'), note('b')];
    expect(ids(insertStickyNote(notes, note('x'), 1))).toEqual(['a', 'x', 'b']);
    expect(ids(insertStickyNote(notes, note('x'), 99))).toEqual(['a', 'b', 'x']);
    expect(ids(insertStickyNote(notes, note('x'), -5))).toEqual(['x', 'a', 'b']);
  });

  it('refuses to insert a note that is already there', () => {
    const notes = [note('a')];
    expect(insertStickyNote(notes, note('a'), 0)).toBe(notes);
  });
});

describe('stickyNotesToPlainText', () => {
  it('joins notes in display order with a blank line, skipping empty ones', () => {
    const notes = [note('a', { text: 'first' }), note('b', { text: 'pinned', pinned: true }), note('c', { text: '  ' })];
    expect(stickyNotesToPlainText(notes)).toBe('pinned\n\nfirst');
  });

  it('is empty when every note is empty', () => {
    expect(stickyNotesToPlainText([note('a', { text: '' })])).toBe('');
    expect(stickyNotesToPlainText([])).toBe('');
  });
});

describe('normalizeStickyNotesState', () => {
  it('seeds the welcome note when there is no list at all', () => {
    const state = normalizeStickyNotesState({});
    expect(state.notes).toHaveLength(1);
    expect(state.notes[0].id).toBe(DEFAULT_STICKY_ID);
    expect(state.notes[0].text).toBe(WELCOME_STICKY_TEXT);
    expect(state.fontSize).toBe('md');
    expect(state.defaultColor).toBe(DEFAULT_STICKY_COLOR);
  });

  it('keeps an empty list empty instead of re-seeding it', () => {
    expect(normalizeStickyNotesState({ notes: [] }).notes).toEqual([]);
  });

  it('repairs malformed notes instead of dropping them', () => {
    const state = normalizeStickyNotesState({
      notes: [
        { id: 'a', text: 'kept', color: 'chartreuse', pinned: 'yes', createdAt: 'nope', updatedAt: null },
        'not an object',
        { text: 42 },
      ],
    });
    expect(state.notes).toHaveLength(2);
    expect(state.notes[0]).toMatchObject({ id: 'a', text: 'kept', color: DEFAULT_STICKY_COLOR, pinned: false });
    expect(state.notes[0].createdAt).toBeGreaterThan(0);
    expect(state.notes[0].updatedAt).toBe(state.notes[0].createdAt);
    expect(state.notes[1].id).toMatch(/^sticky_/);
    expect(state.notes[1].text).toBe('');
  });

  it('makes duplicate and blank ids unique', () => {
    const state = normalizeStickyNotesState({
      notes: [
        { id: 'dup', text: 'one' },
        { id: 'dup', text: 'two' },
        { id: '  ', text: 'three' },
      ],
    });
    const collected = state.notes.map((entry) => entry.id);
    expect(new Set(collected).size).toBe(3);
    expect(collected[0]).toBe('dup');
  });

  it('inherits the configured default colour for notes without one', () => {
    const state = normalizeStickyNotesState({ defaultColor: 'green', notes: [{ id: 'a', text: 'x' }] });
    expect(state.defaultColor).toBe('green');
    expect(state.notes[0].color).toBe('green');
  });

  it('falls back to the defaults for a junk font size or colour', () => {
    const state = normalizeStickyNotesState({ notes: [], fontSize: 'huge', defaultColor: 'neon' });
    expect(state.fontSize).toBe('md');
    expect(state.defaultColor).toBe('yellow');
  });

  it('accepts a non-object config', () => {
    expect(normalizeStickyNotesState(null).notes).toHaveLength(1);
    expect(normalizeStickyNotesState('nonsense').notes).toHaveLength(1);
  });

  it('clamps over-long text and tolerates a non-string text field', () => {
    const state = normalizeStickyNotesState({ notes: [{ id: 'a', text: 'z'.repeat(STICKY_TEXT_MAX + 1) }] });
    expect(state.notes[0].text).toHaveLength(STICKY_TEXT_MAX);
  });

  it('keeps every note of a large import (the cap only guards the UI)', () => {
    const notes = Array.from({ length: MAX_STICKY_NOTES + 10 }, (_, index) => ({ id: `n${index}`, text: `t${index}` }));
    expect(normalizeStickyNotesState({ notes }).notes).toHaveLength(MAX_STICKY_NOTES + 10);
  });

  it('round-trips a normalised state', () => {
    const first = normalizeStickyNotesState({ notes: [createStickyNote('keep me', 'pink')], fontSize: 'lg' });
    const second = normalizeStickyNotesState(first);
    expect(second).toEqual(first);
  });

  it('creates the welcome note with the default id and colour', () => {
    const welcome = createWelcomeStickyNote(7);
    expect(welcome).toMatchObject({ id: DEFAULT_STICKY_ID, color: DEFAULT_STICKY_COLOR, pinned: false, createdAt: 7 });
  });
});

describe('needsStickyMigration', () => {
  const complete = { notes: [createStickyNote('hi', 'pink')], fontSize: 'lg', defaultColor: 'blue' };

  it('accepts a normalised config', () => {
    expect(needsStickyMigration(complete)).toBe(false);
    expect(needsStickyMigration({ notes: [], fontSize: 'md', defaultColor: 'yellow' })).toBe(false);
  });

  it('flags a config with no list, a broken note or a junk setting', () => {
    expect(needsStickyMigration({})).toBe(true);
    expect(needsStickyMigration({ notes: 'nope' })).toBe(true);
    expect(needsStickyMigration({ ...complete, notes: [{ id: 'a', text: 'x' }] })).toBe(true);
    expect(needsStickyMigration({ ...complete, notes: [{ ...complete.notes[0], color: 'chartreuse' }] })).toBe(true);
    expect(needsStickyMigration({ ...complete, notes: [{ ...complete.notes[0], text: 'z'.repeat(STICKY_TEXT_MAX + 1) }] })).toBe(true);
    expect(needsStickyMigration({ ...complete, fontSize: 'huge' })).toBe(true);
    expect(needsStickyMigration({ ...complete, defaultColor: 'neon' })).toBe(true);
  });

  it('flags duplicate ids, which normalisation has to make unique', () => {
    const note = complete.notes[0];
    expect(needsStickyMigration({ ...complete, notes: [note, { ...note }] })).toBe(true);
  });
});
