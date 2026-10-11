import { describe, expect, it } from 'vitest';
import {
  DEFAULT_NOTE_ID,
  WELCOME_NOTE_TEXT,
  clampEditorRatio,
  clampSidebarRatio,
  countNoteWords,
  createDefaultNote,
  createNote,
  deriveNoteTitle,
  needsNotesMigration,
  normalizeNotesState,
  notePreview,
  removeNote,
  selectAfterRemoval,
  updateNote,
  type Note,
} from '@/lib/notes';

const note = (id: string, text = '', at = 1): Note => ({ id, text, createdAt: at, updatedAt: at });

describe('deriveNoteTitle', () => {
  it('uses the first non-empty line, stripping heading marks', () => {
    expect(deriveNoteTitle('\n\n## Grocery list\nthen more')).toBe('Grocery list');
    expect(deriveNoteTitle('> quoted intro')).toBe('quoted intro');
    expect(deriveNoteTitle('- [ ] buy milk')).toBe('buy milk');
    expect(deriveNoteTitle('1. first step')).toBe('first step');
  });

  it('strips inline emphasis, code and link syntax', () => {
    expect(deriveNoteTitle('# **Bold** and `code` and [site](https://example.com)')).toBe('Bold and code and site');
  });

  it('truncates long titles', () => {
    const title = deriveNoteTitle(`# ${'x'.repeat(200)}`);
    expect(title).toHaveLength(48);
  });

  it('falls back for empty and whitespace-only text', () => {
    expect(deriveNoteTitle('')).toBe('Untitled note');
    expect(deriveNoteTitle('   \n\n  ')).toBe('Untitled note');
  });
});

describe('notePreview', () => {
  it('skips the title line and returns the next body line', () => {
    expect(notePreview('# Title\n\nBody copy here')).toBe('Body copy here');
  });

  it('is empty when the note is only a title', () => {
    expect(notePreview('# Title')).toBe('');
    expect(notePreview('')).toBe('');
  });
});

describe('countNoteWords', () => {
  it('counts words and tolerates whitespace-only text', () => {
    expect(countNoteWords('one two   three')).toBe(3);
    expect(countNoteWords('')).toBe(0);
    expect(countNoteWords('  \n ')).toBe(0);
  });
});

describe('updateNote', () => {
  it('patches a note and stamps updatedAt', () => {
    const notes = [note('a'), note('b')];
    const next = updateNote(notes, 'b', { text: 'hello' }, 99);
    expect(next[1]).toEqual({ id: 'b', text: 'hello', createdAt: 1, updatedAt: 99 });
    expect(next[0]).toBe(notes[0]);
  });

  it('never overwrites the id and returns the same array for unknown ids', () => {
    const notes = [note('a')];
    expect(updateNote(notes, 'a', { id: 'hacked' })[0].id).toBe('a');
    expect(updateNote(notes, 'missing', { text: 'x' })).toBe(notes);
  });
});

describe('removeNote and selectAfterRemoval', () => {
  it('removes an unknown id as a no-op', () => {
    const notes = [note('a')];
    expect(removeNote(notes, 'missing')).toBe(notes);
    expect(removeNote(notes, 'a')).toEqual([]);
  });

  it('selects the note that took the removed one’s place', () => {
    const notes = [note('a'), note('b'), note('c')];
    expect(selectAfterRemoval(notes, 'b')).toBe('c');
  });

  it('falls back to the previous note when the last one goes', () => {
    expect(selectAfterRemoval([note('a'), note('b')], 'b')).toBe('a');
  });

  it('returns an empty id when the last note is removed', () => {
    expect(selectAfterRemoval([note('a')], 'a')).toBe('');
    expect(selectAfterRemoval([], 'a')).toBe('');
  });
});

describe('normalizeNotesState', () => {
  it('migrates the legacy single-note config, preserving its text exactly', () => {
    const migrated = normalizeNotesState({ text: 'legacy body', mode: 'preview', fontSize: 'lg' });
    expect(migrated.notes).toHaveLength(1);
    expect(migrated.notes[0].text).toBe('legacy body');
    expect(migrated.activeNoteId).toBe(migrated.notes[0].id);
    expect(migrated.mode).toBe('preview');
    expect(migrated.fontSize).toBe('lg');
    expect(migrated.sidebarOpen).toBe(true);
  });

  it('seeds the welcome note when there is nothing stored', () => {
    const seeded = normalizeNotesState({});
    expect(seeded.notes).toHaveLength(1);
    expect(seeded.notes[0].text).toBe(WELCOME_NOTE_TEXT);
  });

  it('respects an explicit empty note list', () => {
    const emptied = normalizeNotesState({ notes: [], activeNoteId: '', mode: 'split', fontSize: 'md', sidebarOpen: true });
    expect(emptied.notes).toEqual([]);
    expect(emptied.activeNoteId).toBe('');
  });

  it('keeps an empty legacy text as an empty note rather than the welcome copy', () => {
    const migrated = normalizeNotesState({ text: '' });
    expect(migrated.notes).toHaveLength(1);
    expect(migrated.notes[0].text).toBe('');
  });

  it('prefers the legacy text when rehydration merged the widget defaults underneath', () => {
    // `validateDashboardDocument` merges `defaultConfig` under the stored config,
    // so a pre-panel scratchpad reaches the widget as `{ text, ...welcomeNote }`.
    const migrated = normalizeNotesState({
      notes: [createDefaultNote(0)],
      activeNoteId: DEFAULT_NOTE_ID,
      mode: 'split',
      fontSize: 'md',
      sidebarOpen: true,
      text: 'my own scratchpad text',
    });
    expect(migrated.notes).toHaveLength(1);
    expect(migrated.notes[0].text).toBe('my own scratchpad text');
    expect(migrated.activeNoteId).toBe(migrated.notes[0].id);
  });

  it('keeps a real note even when a stale legacy key is still around', () => {
    const kept = normalizeNotesState({
      notes: [createDefaultNote(0), note('b', 'second note')],
      activeNoteId: 'b',
      text: 'stale legacy text',
    });
    expect(kept.notes.map((entry) => entry.text)).toEqual([WELCOME_NOTE_TEXT, 'second note']);
    expect(kept.activeNoteId).toBe('b');
  });

  it('repairs junk entries, missing fields and duplicate ids', () => {
    const migrated = normalizeNotesState({
      notes: [null, 42, { text: 'no id' }, { id: 'x', text: 'one' }, { id: 'x', text: 'two' }],
      activeNoteId: 'gone',
      mode: 'nonsense',
      fontSize: 'huge',
      sidebarOpen: 'yes',
    });
    expect(migrated.notes).toHaveLength(3);
    expect(migrated.notes.map((entry) => entry.text)).toEqual(['no id', 'one', 'two']);
    expect(new Set(migrated.notes.map((entry) => entry.id)).size).toBe(3);
    expect(migrated.activeNoteId).toBe(migrated.notes[0].id);
    expect(migrated.mode).toBe('split');
    expect(migrated.fontSize).toBe('md');
    expect(migrated.sidebarOpen).toBe(true);
  });

  it('keeps a valid active note and normalises string timestamps', () => {
    const migrated = normalizeNotesState({
      notes: [{ id: 'a', text: '', createdAt: '1000', updatedAt: '2000' }],
      activeNoteId: 'a',
      mode: 'edit',
      fontSize: 'sm',
      sidebarOpen: false,
    });
    expect(migrated.activeNoteId).toBe('a');
    expect(migrated.notes[0].createdAt).toBe(1000);
    expect(migrated.notes[0].updatedAt).toBe(2000);
    expect(migrated.sidebarOpen).toBe(false);
  });
});

describe('clampEditorRatio', () => {
  it('keeps a stored ratio and rounds fractional ones', () => {
    expect(clampEditorRatio(65)).toBe(65);
    expect(clampEditorRatio(64.6)).toBe(65);
    expect(clampEditorRatio(0)).toBe(15);
    expect(clampEditorRatio(1000)).toBe(85);
  });

  it('falls back to the default for anything that is not a finite number', () => {
    // A missing key is the common case: a config saved before the divider existed.
    expect(clampEditorRatio(undefined)).toBe(50);
    expect(clampEditorRatio(null)).toBe(50);
    expect(clampEditorRatio('wide')).toBe(50);
    expect(clampEditorRatio(Number.NaN)).toBe(50);
  });
});

describe('clampSidebarRatio', () => {
  it('keeps a stored panel width inside its own, narrower range', () => {
    expect(clampSidebarRatio(25)).toBe(25);
    expect(clampSidebarRatio(0)).toBe(15);
    expect(clampSidebarRatio(90)).toBe(60);
  });

  it('falls back to the default for junk', () => {
    expect(clampSidebarRatio(undefined)).toBe(25);
    expect(clampSidebarRatio('wide')).toBe(25);
  });
});

describe('needsNotesMigration', () => {
  const migrated = normalizeNotesState({ text: 'hi' });

  it('flags the legacy shape and incomplete configs', () => {
    expect(needsNotesMigration({ text: 'hi' })).toBe(true);
    expect(needsNotesMigration({})).toBe(true);
    expect(needsNotesMigration({ notes: 'nope' })).toBe(true);
    expect(needsNotesMigration({ notes: [{ id: 'a', text: '' }] })).toBe(true);
    expect(needsNotesMigration({ ...migrated, sidebarOpen: 'yes' })).toBe(true);
    expect(needsNotesMigration({ ...migrated, activeNoteId: 'gone' })).toBe(true);
    const duplicate = createNote('duplicate', 5);
    expect(needsNotesMigration({ ...migrated, notes: [...migrated.notes, duplicate, duplicate] })).toBe(true);
  });

  it('flags a missing or out-of-range split ratio', () => {
    const withoutRatio = { ...migrated, editorRatio: undefined };
    expect(needsNotesMigration(withoutRatio)).toBe(true);
    expect(needsNotesMigration({ ...migrated, editorRatio: 400 })).toBe(true);
    expect(needsNotesMigration({ ...migrated, editorRatio: 'half' })).toBe(true);
    expect(needsNotesMigration({ ...migrated, editorRatio: 15 })).toBe(false);
    expect(needsNotesMigration({ ...migrated, editorRatio: 85 })).toBe(false);
  });

  it('flags a missing or out-of-range notes panel width', () => {
    expect(needsNotesMigration({ ...migrated, sidebarRatio: undefined })).toBe(true);
    expect(needsNotesMigration({ ...migrated, sidebarRatio: 95 })).toBe(true);
    expect(needsNotesMigration({ ...migrated, sidebarRatio: 15 })).toBe(false);
    expect(needsNotesMigration({ ...migrated, sidebarRatio: 60 })).toBe(false);
  });

  it('accepts an already normalised config, including an emptied list', () => {
    expect(needsNotesMigration(migrated)).toBe(false);
    expect(needsNotesMigration({ ...migrated, sidebarOpen: false })).toBe(false);
    expect(normalizeNotesState({ ...migrated, notes: [], activeNoteId: '' }).notes).toEqual([]);
    expect(needsNotesMigration(normalizeNotesState({ ...migrated, notes: [], activeNoteId: '' }))).toBe(false);
  });
});
