import { useEffect, useMemo, useRef, useState } from 'react';
import { CopyIcon, PlusIcon, StickyNoteIcon } from '@/components/icons';
import { Badge, Button, EmptyState } from '@/components/ui';
import { useDebouncedCallback } from '@/hooks/useDebouncedCallback';
import {
  MAX_STICKY_NOTES,
  canAddStickyNote,
  createStickyNote,
  createWelcomeStickyNote,
  insertStickyNote,
  needsStickyMigration,
  normalizeStickyNotesState,
  removeStickyNote,
  sortStickyNotes,
  stickyNotesToPlainText,
  stickyTitle,
  toggleStickyPin,
  updateStickyNote,
  type StickyColor,
  type StickyFontSize,
  type StickyNote,
  type StickyNotesState,
} from '@/lib/stickyNotes';
import { copyToClipboard } from '@/lib/utils';
import { useToastStore } from '@/store/toastStore';
import type { SettingField, WidgetProps } from '@/types';
import { defineWidget } from '@/widgets/define';
import { StickyNoteCard } from './StickyNoteCard';

export type { StickyColor, StickyFontSize, StickyNote, StickyNotesState } from '@/lib/stickyNotes';

export type StickyNotesConfig = StickyNotesState;

/**
 * `updatedAt` is stamped `0` on the welcome note so a brand-new widget's config
 * is deterministic (the registry and persistence tests both render it).
 */
const DEFAULT_STICKY_CONFIG: StickyNotesConfig = {
  notes: [createWelcomeStickyNote(0)],
  fontSize: 'md',
  defaultColor: 'yellow',
};

const SETTINGS: readonly SettingField[] = [
  {
    key: 'fontSize',
    label: 'Note text size',
    type: 'select',
    options: [
      { label: 'Small', value: 'sm' },
      { label: 'Medium', value: 'md' },
      { label: 'Large', value: 'lg' },
    ],
  },
  {
    key: 'defaultColor',
    label: 'Colour of new notes',
    type: 'select',
    options: [
      { label: 'Yellow', value: 'yellow' },
      { label: 'Pink', value: 'pink' },
      { label: 'Blue', value: 'blue' },
      { label: 'Green', value: 'green' },
      { label: 'Purple', value: 'purple' },
    ],
  },
];

const FONT_SIZES: Record<StickyFontSize, string> = {
  sm: 'text-[11px] leading-snug',
  md: 'text-xs leading-snug',
  lg: 'text-sm leading-snug',
};

const GRID = 'grid grid-cols-[repeat(auto-fill,minmax(8rem,1fr))] gap-2';

const SECTION_LABEL =
  'mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500';

/** Autosave delay per note — short, because a post-it is a quick thought. */
const SAVE_DELAY_MS = 300;

/** How long the copy button stays in its "Copied" state. */
const COPIED_MS = 1400;

/**
 * Quick sticky notes.
 *
 * Notes live in the widget config, so the existing dashboard persistence (and the
 * embedded single-file snapshot) carries them with no extra storage layer. Every
 * note can be pinned to the top, copied to the clipboard, edited in place and
 * removed — with the toast offering an undo — and the whole set copies as plain
 * text in one click.
 */
export function StickyNotesWidget({ config, updateConfig, replaceConfig }: WidgetProps<StickyNotesConfig>) {
  // Normalising is pure and cheap, so the view mirrors the stored shape instead
  // of writing during render.
  const { notes, fontSize, defaultColor } = useMemo(() => normalizeStickyNotesState(config), [config]);

  /**
   * Id of the note whose textarea is open, and the in-progress text with the note
   * it belongs to — so a debounced save can never land on the wrong note after a
   * delete or a switch (the markdown notes panel uses the same pattern).
   */
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ noteId: string; text: string } | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const notify = useToastStore((state) => state.notify);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /**
   * Latest notes, for handlers that run *after* the render that created them —
   * the debounced save and the toast's undo action both outlive their closure.
   */
  const notesRef = useRef(notes);
  useEffect(() => {
    notesRef.current = notes;
  });

  const commit = useDebouncedCallback((noteId: string, text: string) => {
    updateConfig({ notes: updateStickyNote(notesRef.current, noteId, { text }) });
  }, SAVE_DELAY_MS);

  /**
   * Repair a hand-edited or half-written config once per mount, so junk keys and
   * unstable ids never reach an export.
   */
  const migratedRef = useRef(false);
  useEffect(() => {
    if (migratedRef.current || !needsStickyMigration(config)) return;
    migratedRef.current = true;
    replaceConfig(normalizeStickyNotesState(config));
    // Normalisation depends on the whole config; the guard keeps this to one write.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config]);

  useEffect(
    () => () => {
      if (copyTimer.current) clearTimeout(copyTimer.current);
    },
    [],
  );

  const sorted = sortStickyNotes(notes);
  const pinned = sorted.filter((note) => note.pinned);
  const rest = sorted.filter((note) => !note.pinned);

  const valueFor = (note: StickyNote) => (draft && draft.noteId === note.id ? draft.text : note.text);

  /** The notes as the user currently sees them, pending edit included. */
  const liveNotes = () =>
    draft ? updateStickyNote(notesRef.current, draft.noteId, { text: draft.text }) : notesRef.current;

  const onChange = (noteId: string, text: string) => {
    setDraft({ noteId, text });
    commit.run(noteId, text);
  };

  const startEdit = (id: string) => {
    // Save the note being left behind now, rather than after the switch.
    if (draft) commit.flush();
    setEditingId(id);
  };

  const finishEdit = () => {
    commit.flush();
    setDraft(null);
    setEditingId(null);
  };

  const addNote = () => {
    if (!canAddStickyNote(notes)) return;
    if (draft) commit.flush();
    const note = createStickyNote('', defaultColor);
    setDraft({ noteId: note.id, text: '' });
    setEditingId(note.id);
    updateConfig({ notes: [note, ...notes] });
  };

  const togglePin = (id: string) => updateConfig({ notes: toggleStickyPin(notes, id) });

  const recolor = (id: string, color: StickyColor) =>
    updateConfig({ notes: updateStickyNote(notes, id, { color }) });

  const flashCopied = (id: string) => {
    setCopiedId(id);
    if (copyTimer.current) clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => setCopiedId((current) => (current === id ? null : current)), COPIED_MS);
  };

  const copyNote = async (note: StickyNote) => {
    const text = valueFor(note);
    if (text === '') return;
    const ok = await copyToClipboard(text);
    if (!ok) {
      notify({
        tone: 'error',
        title: 'Could not access the clipboard',
        description: 'Your browser blocked clipboard access.',
      });
      return;
    }
    flashCopied(note.id);
  };

  const copyAll = async () => {
    if (draft) commit.flush();
    const text = stickyNotesToPlainText(liveNotes());
    if (text === '') return;
    const ok = await copyToClipboard(text);
    if (!ok) {
      notify({
        tone: 'error',
        title: 'Could not access the clipboard',
        description: 'Your browser blocked clipboard access.',
      });
      return;
    }
    flashCopied('all');
    notify({ tone: 'success', title: 'Notes copied', description: 'The whole list is on your clipboard.' });
  };

  const removeNote = (note: StickyNote) => {
    const index = notes.findIndex((entry) => entry.id === note.id);
    if (index === -1) return;
    if (editingId === note.id) {
      // Drop the pending draft too, so a debounced save cannot bring it back.
      commit.cancel();
      setEditingId(null);
      setDraft(null);
    }
    updateConfig({ notes: removeStickyNote(notes, note.id) });
    notify({
      tone: 'info',
      title: 'Note deleted',
      description: stickyTitle(note.text),
      action: {
        label: 'Undo',
        onClick: () => updateConfig({ notes: insertStickyNote(notesRef.current, note, index) }),
      },
    });
  };

  const renderCard = (note: StickyNote) => (
    <StickyNoteCard
      key={note.id}
      note={note}
      editing={editingId === note.id}
      value={valueFor(note)}
      copied={copiedId === note.id}
      fontClass={FONT_SIZES[fontSize]}
      onChange={(text) => onChange(note.id, text)}
      onStartEdit={() => startEdit(note.id)}
      onFinishEdit={finishEdit}
      onTogglePin={() => togglePin(note.id)}
      onCopy={() => void copyNote(note)}
      onRemove={() => removeNote(note)}
      onRecolor={(color) => recolor(note.id, color)}
    />
  );

  const pinnedCount = pinned.length;
  const countLabel = `${notes.length} note${notes.length === 1 ? '' : 's'}`;
  const atLimit = !canAddStickyNote(notes);

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <div className="flex shrink-0 items-center justify-between gap-2">
        <Badge tone="amber">
          {pinnedCount > 0 ? `${countLabel} · ${pinnedCount} pinned` : countLabel}
        </Badge>
        <div className="flex items-center gap-1">
          {notes.length > 1 ? (
            <Button
              size="sm"
              variant="ghost"
              icon={copiedId === 'all' ? <CopyIcon className="h-3.5 w-3.5 text-emerald-500" /> : <CopyIcon className="h-3.5 w-3.5" />}
              onClick={() => void copyAll()}
            >
              {copiedId === 'all' ? 'Copied' : 'Copy all'}
            </Button>
          ) : null}
          <Button
            size="sm"
            variant="primary"
            icon={<PlusIcon className="h-3.5 w-3.5" />}
            disabled={atLimit}
            onClick={addNote}
          >
            New note
          </Button>
        </div>
      </div>

      {notes.length === 0 ? (
        <EmptyState
          size="sm"
          icon={<StickyNoteIcon className="h-4 w-4" />}
          title="No notes yet"
          description="Jot a quick note and pin the ones you want to keep on top."
          action={
            <Button size="sm" variant="primary" icon={<PlusIcon className="h-3.5 w-3.5" />} onClick={addNote}>
              New note
            </Button>
          }
        />
      ) : (
        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-0.5">
          {pinnedCount > 0 ? (
            <section aria-label="Pinned notes">
              <h4 className={SECTION_LABEL}>Pinned</h4>
              <div className={GRID}>{pinned.map(renderCard)}</div>
            </section>
          ) : null}
          {rest.length > 0 ? (
            <section aria-label="Other notes">
              {pinnedCount > 0 ? <h4 className={SECTION_LABEL}>Notes</h4> : null}
              <div className={GRID}>{rest.map(renderCard)}</div>
            </section>
          ) : null}
        </div>
      )}

      <p className="shrink-0 text-[10px] text-slate-400 dark:text-slate-500">
        {atLimit
          ? `That is the limit of ${MAX_STICKY_NOTES} notes. Delete one to add another.`
          : 'Notes are stored with the dashboard, so they travel in a copy of the file.'}
      </p>
    </div>
  );
}

export const stickyNotesWidget = defineWidget<StickyNotesConfig>({
  type: 'sticky',
  name: 'Sticky notes',
  summary: 'Quick post-it notes you can pin to the top, copy, edit and remove.',
  category: 'productivity',
  keywords: ['sticky', 'note', 'notes', 'post-it', 'quick', 'memo', 'scratch', 'clipboard'],
  icon: StickyNoteIcon,
  accent: 'amber',
  defaultSize: { w: 4, h: 6, minW: 2, minH: 4 },
  defaultConfig: DEFAULT_STICKY_CONFIG,
  settings: SETTINGS,
  summarize: (config) => {
    const state = normalizeStickyNotesState(config);
    if (state.notes.length === 0) return 'No notes';
    const pinned = state.notes.filter((note) => note.pinned).length;
    const base = `${state.notes.length} note${state.notes.length === 1 ? '' : 's'}`;
    return pinned > 0 ? `${base} · ${pinned} pinned` : base;
  },
  component: StickyNotesWidget,
});
