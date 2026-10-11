import {
  Badge,
  Button,
  EmptyState,
  IconButton,
} from '@/components/ui';
import { NotesIcon, PanelLeftIcon, PlusIcon, TrashIcon } from '@/components/icons';
import { deriveNoteTitle, notePreview, type Note } from '@/lib/notes';
import { cn } from '@/lib/utils';

export interface NotesSidebarProps {
  notes: readonly Note[];
  activeNoteId: string;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onRequestDelete: (note: Note) => void;
  onClose: () => void;
}

/**
 * The notes file manager.
 *
 * A pure list: every action is reported upwards, and the widget owns the config,
 * the autosave and the delete confirmation. A row's label is the note's first
 * line (markdown stripped), the same rule as the widget header subtitle, so
 * naming a note means writing its heading.
 */
export function NotesSidebar({
  notes,
  activeNoteId,
  onSelect,
  onCreate,
  onRequestDelete,
  onClose,
}: NotesSidebarProps) {
  return (
    <div className="flex h-full min-h-0 w-36 shrink-0 flex-col rounded-xl border border-slate-200 bg-slate-50/60 p-2 dark:border-slate-800 dark:bg-slate-950/30">
      <div className="flex shrink-0 items-center gap-1 pb-2">
        <span className="min-w-0 flex-1 truncate text-[11px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          Notes
        </span>
        <Badge tone="amber" className="shrink-0 tabular-nums">
          {notes.length}
        </Badge>
        <IconButton
          label="Hide notes panel"
          size="icon-sm"
          variant="ghost"
          icon={<PanelLeftIcon className="h-3.5 w-3.5" />}
          onClick={onClose}
        />
      </div>

      {notes.length === 0 ? (
        <EmptyState
          size="sm"
          className="min-h-0 flex-1"
          icon={<NotesIcon className="h-4 w-4" />}
          title="No notes yet"
          description="Create your first note."
        />
      ) : (
        <ul className="min-h-0 flex-1 space-y-1 overflow-y-auto pr-0.5" aria-label="Your notes">
          {notes.map((note) => {
            const active = note.id === activeNoteId;
            const title = deriveNoteTitle(note.text);
            return (
              <li key={note.id}>
                <div
                  className={cn(
                    'group/note relative rounded-lg border transition-colors',
                    active
                      ? 'border-violet-300 bg-white shadow-sm dark:border-violet-500/50 dark:bg-slate-900'
                      : 'border-transparent hover:border-slate-200 hover:bg-white/70 dark:hover:border-slate-700 dark:hover:bg-slate-900/60',
                  )}
                >
                  <button
                    type="button"
                    aria-current={active ? 'true' : undefined}
                    onClick={() => onSelect(note.id)}
                    className="w-full rounded-lg py-1.5 pl-2.5 pr-6 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/50"
                  >
                    <span
                      className={cn(
                        'block truncate text-xs font-semibold',
                        active ? 'text-slate-800 dark:text-slate-100' : 'text-slate-600 dark:text-slate-300',
                      )}
                    >
                      {title}
                    </span>
                    <span className="block truncate text-[10px] text-slate-400 dark:text-slate-500">
                      {notePreview(note.text) || 'Empty note'}
                    </span>
                  </button>
                  <IconButton
                    label={`Delete ${title}`}
                    size="icon-sm"
                    variant="ghost"
                    icon={<TrashIcon className="h-3 w-3" />}
                    className="absolute right-0.5 top-0.5 h-6 w-6 text-slate-400 opacity-0 transition-opacity hover:text-rose-600 focus-visible:opacity-100 group-hover/note:opacity-100 dark:text-slate-500 dark:hover:text-rose-400"
                    onClick={() => onRequestDelete(note)}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <div className="shrink-0 border-t border-slate-200/80 pt-2 dark:border-slate-800">
        <Button size="sm" variant="ghost" fullWidth icon={<PlusIcon className="h-3.5 w-3.5" />} onClick={onCreate}>
          New note
        </Button>
      </div>
    </div>
  );
}
