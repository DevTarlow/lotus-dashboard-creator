import { useEffect, useMemo, useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react';
import { CheckIcon, NotesIcon, PencilIcon, PanelLeftIcon, SplitIcon, EyeIcon } from '@/components/icons';
import { Button, EmptyState, IconButton, Markdown, Segmented } from '@/components/ui';
import { ConfirmDialog } from '@/components/modals/ConfirmDialog';
import { useDebouncedCallback } from '@/hooks/useDebouncedCallback';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import {
  DEFAULT_EDITOR_RATIO,
  DEFAULT_NOTE_ID,
  DEFAULT_SIDEBAR_RATIO,
  MAX_EDITOR_RATIO,
  MAX_SIDEBAR_RATIO,
  MIN_EDITOR_RATIO,
  MIN_SIDEBAR_RATIO,
  clampEditorRatio,
  clampSidebarRatio,
  countNoteWords,
  createDefaultNote,
  createNote,
  deriveNoteTitle,
  needsNotesMigration,
  normalizeNotesState,
  removeNote,
  selectAfterRemoval,
  updateNote,
  type Note,
  type NotesFontSize,
  type NotesMode,
  type NotesState,
} from '@/lib/notes';
import { cn } from '@/lib/utils';
import type { SettingField, WidgetProps } from '@/types';
import { defineWidget } from '@/widgets/define';
import { NotesResizablePanes } from './NotesResizablePanes';
import { NotesSidebar } from './NotesSidebar';

export type { NotesFontSize, NotesMode } from '@/lib/notes';

/**
 * Widget config. `text` is the pre-file-manager shape and is only ever read, so
 * a workspace or export saved before the notes panel existed still opens with
 * its content (see {@link normalizeNotesState}).
 */
export type NotesConfig = NotesState & {
  text?: string;
};

const DEFAULT_NOTES_CONFIG: NotesConfig = {
  notes: [createDefaultNote(0)],
  activeNoteId: DEFAULT_NOTE_ID,
  mode: 'split',
  fontSize: 'md',
  sidebarOpen: true,
  sidebarRatio: DEFAULT_SIDEBAR_RATIO,
  editorRatio: DEFAULT_EDITOR_RATIO,
};

/** Shared chrome for both panes, so the divider lines up with matching edges. */
const PANE_BASE = 'h-full min-h-0 rounded-xl border p-3';

const SETTINGS: readonly SettingField[] = [
  {
    key: 'mode',
    label: 'Default view',
    type: 'select',
    options: [
      { label: 'Edit', value: 'edit' },
      { label: 'Split', value: 'split' },
      { label: 'Preview', value: 'preview' },
    ],
  },
  {
    key: 'fontSize',
    label: 'Editor text size',
    type: 'select',
    options: [
      { label: 'Small', value: 'sm' },
      { label: 'Medium', value: 'md' },
      { label: 'Large', value: 'lg' },
    ],
  },
  { key: 'sidebarOpen', label: 'Show the notes panel', type: 'switch' },
];

const FONT_SIZES: Record<NotesFontSize, string> = {
  sm: 'text-xs',
  md: 'text-[13px]',
  lg: 'text-sm',
};

const MODE_OPTIONS = [
  { value: 'edit' as NotesMode, label: 'Edit', icon: <PencilIcon className="h-3 w-3" /> },
  { value: 'split' as NotesMode, label: 'Split', icon: <SplitIcon className="h-3 w-3" /> },
  { value: 'preview' as NotesMode, label: 'Preview', icon: <EyeIcon className="h-3 w-3" /> },
];

/** Autosave delay per note, matching the original scratchpad. */
const SAVE_DELAY_MS = 350;

/**
 * Multi-note markdown editor with a file-manager panel.
 *
 * Notes live in the widget config, so the existing dashboard persistence (and the
 * embedded single-file snapshot) carries them with no extra storage layer.
 */
export function NotesWidget({ config, updateConfig, replaceConfig }: WidgetProps<NotesConfig>) {
  // `normalizeNotesState` is pure and cheap, so the non-migrated view mirrors the
  // stored shape instead of writing during render.
  const { notes, activeNoteId, mode, fontSize, sidebarOpen } = useMemo(
    () => normalizeNotesState(config),
    [config],
  );
  const editorRatio = clampEditorRatio(config.editorRatio);
  const sidebarRatio = clampSidebarRatio(config.sidebarRatio);
  /** Mirrors the `sm:` prefix on the editor/preview splitter's layout classes. */
  const stackEditorAndPreview = !useMediaQuery('(min-width: 640px)');
  /** The notes panel sits beside the editor once the widget is at least 768px. */
  const stackSidebar = !useMediaQuery('(min-width: 768px)');

  /**
   * In-progress edit: `noteId` says which note the text belongs to, so a
   * debounced save can never land on the wrong note after a switch or a delete.
   * `null` means "mirror the stored config" (see the links widget for the same
   * pattern).
   */
  const [draft, setDraft] = useState<{ noteId: string; text: string } | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Note | null>(null);
  const editorRef = useRef<HTMLTextAreaElement | null>(null);
  /** Set while creating a note so the editor focuses once it shows the new one. */
  const focusNewNoteRef = useRef(false);

  const activeNote = notes.find((note) => note.id === activeNoteId) ?? null;
  const value = activeNote && draft && draft.noteId === activeNote.id ? draft.text : (activeNote?.text ?? '');
  const dirty = draft !== null && draft.noteId === activeNoteId;

  const commit = useDebouncedCallback((target: string, text: string) => {
    if (target !== activeNoteId) return;
    updateConfig({ notes: updateNote(notes, target, { text }) });
    setSavedAt(Date.now());
    setDraft((current) => (current && current.noteId === target ? null : current));
  }, SAVE_DELAY_MS);

  /**
   * Bring a pre-panel workspace (or an import from an older version) up to the
   * current shape once per mount: an array of notes, a valid active id and the
   * legacy `text` key removed. Re-running is a no-op.
   */
  const migratedRef = useRef(false);
  useEffect(() => {
    if (migratedRef.current || !needsNotesMigration(config)) return;
    migratedRef.current = true;
    replaceConfig(normalizeNotesState(config));
    // Normalisation depends on the whole config; the guard keeps this to one write.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config]);

  useEffect(() => {
    if (!focusNewNoteRef.current) return;
    focusNewNoteRef.current = false;
    editorRef.current?.focus();
  }, [activeNoteId]);

  const selectNote = (id: string) => {
    if (id === activeNoteId) return;
    // Persist the note being left behind now, rather than after the switch.
    if (draft) commit.flush();
    setDraft(null);
    updateConfig({ activeNoteId: id });
  };

  const createNewNote = () => {
    if (draft) commit.flush();
    const note = createNote();
    focusNewNoteRef.current = true;
    setDraft(null);
    updateConfig({ notes: [note, ...notes], activeNoteId: note.id });
  };

  const confirmDelete = () => {
    if (!deleteTarget) return;
    commit.cancel();
    // Drop the note from the pending draft too, so a debounced save cannot bring
    // it back after the deletion.
    setDraft(null);
    updateConfig({
      notes: removeNote(notes, deleteTarget.id),
      activeNoteId: selectAfterRemoval(notes, deleteTarget.id),
    });
    setDeleteTarget(null);
  };

  const onChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    if (!activeNote) return;
    const next = event.target.value;
    setDraft({ noteId: activeNote.id, text: next });
    commit.run(activeNote.id, next);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Tab' || event.shiftKey) return;
    event.preventDefault();
    const target = event.currentTarget;
    const { selectionStart, selectionEnd } = target;
    const next = `${value.slice(0, selectionStart)}  ${value.slice(selectionEnd)}`;
    if (!activeNote) return;
    setDraft({ noteId: activeNote.id, text: next });
    commit.run(activeNote.id, next);
    requestAnimationFrame(() => {
      target.selectionStart = selectionStart + 2;
      target.selectionEnd = selectionStart + 2;
    });
  };

  const stats = { words: countNoteWords(value), characters: value.length };

  const showEditor = mode !== 'preview';
  const showPreview = mode !== 'edit';

  return (
    <div className="flex h-full min-h-0 gap-3">
      <NotesResizablePanes
        ratio={sidebarRatio}
        onRatioChange={(next) => updateConfig({ sidebarRatio: next })}
        min={MIN_SIDEBAR_RATIO}
        max={MAX_SIDEBAR_RATIO}
        label="Resize the notes panel"
        resizable={sidebarOpen}
        stacked={stackSidebar}
        aside={
          sidebarOpen ? (
            <NotesSidebar
              notes={notes}
              activeNoteId={activeNoteId}
              onSelect={selectNote}
              onCreate={createNewNote}
              onRequestDelete={setDeleteTarget}
              onClose={() => updateConfig({ sidebarOpen: false })}
            />
          ) : null
        }
      >
        <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col gap-2">
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-1">
              {sidebarOpen ? null : (
                <IconButton
                  label="Show notes panel"
                  size="icon-sm"
                  icon={<PanelLeftIcon className="h-3.5 w-3.5" />}
                  onClick={() => updateConfig({ sidebarOpen: true })}
                />
              )}
              <Segmented
                label="Notes view mode"
                value={mode}
                onChange={(next) => updateConfig({ mode: next })}
                options={MODE_OPTIONS}
              />
            </div>
            <span className="inline-flex shrink-0 items-center gap-1 text-[11px] font-medium text-slate-400 dark:text-slate-500">
              {dirty ? (
                'Saving…'
              ) : savedAt ? (
                <>
                  <CheckIcon className="h-3 w-3 text-emerald-500" /> Saved
                </>
              ) : (
                'Auto-save on'
              )}
            </span>
          </div>

          {activeNote === null ? (
            <div className="flex min-h-0 flex-1 items-center justify-center rounded-xl border border-dashed border-slate-200 dark:border-slate-800">
              <EmptyState
                size="sm"
                icon={<NotesIcon className="h-4 w-4" />}
                title="No notes yet"
                description="Create a note to start writing."
                action={
                  <Button size="sm" variant="primary" onClick={createNewNote}>
                    New note
                  </Button>
                }
              />
            </div>
          ) : (
            <NotesResizablePanes
              ratio={editorRatio}
              onRatioChange={(next) => updateConfig({ editorRatio: next })}
              min={MIN_EDITOR_RATIO}
              max={MAX_EDITOR_RATIO}
              label="Resize the editor and preview"
              resizable={showEditor && showPreview}
              stacked={stackEditorAndPreview}
              aside={
                showEditor ? (
                  <textarea
                    ref={editorRef}
                    value={value}
                    onChange={onChange}
                    onKeyDown={onKeyDown}
                    spellCheck
                    placeholder="Write markdown here…"
                    aria-label={`Note ${deriveNoteTitle(activeNote.text)}`}
                    className={cn(
                      PANE_BASE,
                      'w-full resize-none bg-slate-50/60 font-mono leading-relaxed text-slate-700',
                      'placeholder:text-slate-400 focus:border-violet-300 focus:bg-white focus:outline-none focus:ring-2 focus:ring-violet-500/20',
                      'dark:border-slate-700 dark:bg-slate-950/40 dark:text-slate-200 dark:placeholder:text-slate-600',
                      'dark:focus:border-violet-500/50 dark:focus:bg-slate-950/70',
                      FONT_SIZES[fontSize],
                    )}
                  />
                ) : null
              }
            >
              {showPreview ? (
                <div
                  className={cn(
                    PANE_BASE,
                    'overflow-y-auto border-slate-100 bg-white/60 dark:border-slate-800 dark:bg-slate-950/20',
                  )}
                >
                  <Markdown source={value} placeholder="Your preview appears here." />
                </div>
              ) : null}
            </NotesResizablePanes>
          )}

          <div className="flex items-center justify-between gap-2 text-[11px] text-slate-400 dark:text-slate-500">
            <span className="truncate">{activeNote ? deriveNoteTitle(activeNote.text) : 'No note selected'}</span>
            <span className="shrink-0 tabular-nums">
              {stats.words} words · {stats.characters} chars
            </span>
          </div>
        </div>
      </NotesResizablePanes>

      <ConfirmDialog
        open={deleteTarget !== null}
        title={`Delete “${deleteTarget ? deriveNoteTitle(deleteTarget.text) : ''}”?`}
        description="The note is removed from this widget. Nothing else is deleted, and you can undo with ⌘/Ctrl + Z."
        confirmLabel="Delete note"
        tone="danger"
        onConfirm={confirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}

export const notesWidget = defineWidget<NotesConfig>({
  type: 'notes',
  name: 'Markdown notes',
  summary: 'A multi-note markdown editor with a file panel, live preview and auto-save.',
  category: 'productivity',
  keywords: ['notes', 'markdown', 'scratchpad', 'todo', 'editor', 'files'],
  icon: NotesIcon,
  accent: 'amber',
  defaultSize: { w: 6, h: 6, minW: 3, minH: 4 },
  defaultConfig: DEFAULT_NOTES_CONFIG,
  settings: SETTINGS,
  summarize: (config) => {
    const state = normalizeNotesState(config);
    const active = state.notes.find((note) => note.id === state.activeNoteId);
    if (!active) return 'No notes';
    return state.notes.length === 1 ? deriveNoteTitle(active.text) : `${state.notes.length} notes`;
  },
  component: NotesWidget,
});
