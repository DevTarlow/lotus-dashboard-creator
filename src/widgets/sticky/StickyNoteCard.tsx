import type { ChangeEvent, FocusEvent, KeyboardEvent } from 'react';
import { CheckIcon, CopyIcon, PencilIcon, PinIcon, TrashIcon } from '@/components/icons';
import { IconButton } from '@/components/ui';
import { STICKY_TEXT_MAX, stickyTitle, type StickyColor, type StickyNote } from '@/lib/stickyNotes';
import { cn } from '@/lib/utils';

/**
 * Post-it palettes. The model keeps colour *ids*; tailwind-merge and the JIT
 * scanner both need the classes written out here in full.
 */
const COLORS: Record<StickyColor, { card: string; dot: string; dotActive: string }> = {
  yellow: {
    card: 'border-amber-200/90 bg-amber-50/90 dark:border-amber-400/25 dark:bg-amber-400/10',
    dot: 'bg-amber-200 hover:bg-amber-300 dark:bg-amber-400/40 dark:hover:bg-amber-400/60',
    dotActive: 'bg-amber-300 ring-2 ring-amber-500/60 dark:bg-amber-400/80',
  },
  pink: {
    card: 'border-rose-200/90 bg-rose-50/90 dark:border-rose-400/25 dark:bg-rose-400/10',
    dot: 'bg-rose-200 hover:bg-rose-300 dark:bg-rose-400/40 dark:hover:bg-rose-400/60',
    dotActive: 'bg-rose-300 ring-2 ring-rose-500/60 dark:bg-rose-400/80',
  },
  blue: {
    card: 'border-sky-200/90 bg-sky-50/90 dark:border-sky-400/25 dark:bg-sky-400/10',
    dot: 'bg-sky-200 hover:bg-sky-300 dark:bg-sky-400/40 dark:hover:bg-sky-400/60',
    dotActive: 'bg-sky-300 ring-2 ring-sky-500/60 dark:bg-sky-400/80',
  },
  green: {
    card: 'border-emerald-200/90 bg-emerald-50/90 dark:border-emerald-400/25 dark:bg-emerald-400/10',
    dot: 'bg-emerald-200 hover:bg-emerald-300 dark:bg-emerald-400/40 dark:hover:bg-emerald-400/60',
    dotActive: 'bg-emerald-300 ring-2 ring-emerald-500/60 dark:bg-emerald-400/80',
  },
  purple: {
    card: 'border-violet-200/90 bg-violet-50/90 dark:border-violet-400/25 dark:bg-violet-400/10',
    dot: 'bg-violet-200 hover:bg-violet-300 dark:bg-violet-400/40 dark:hover:bg-violet-400/60',
    dotActive: 'bg-violet-300 ring-2 ring-violet-500/60 dark:bg-violet-400/80',
  },
};

const COLOR_ORDER: readonly StickyColor[] = ['yellow', 'pink', 'blue', 'green', 'purple'];

export interface StickyNoteCardProps {
  note: StickyNote;
  /** The card's textarea is showing. */
  editing: boolean;
  /** Draft text while editing, otherwise the stored text. */
  value: string;
  /** The copy button is in its "Copied" state. */
  copied: boolean;
  /** Text size class from the widget's font-size setting. */
  fontClass: string;
  onChange: (text: string) => void;
  onStartEdit: () => void;
  onFinishEdit: () => void;
  onTogglePin: () => void;
  onCopy: () => void;
  onRemove: () => void;
  onRecolor: (color: StickyColor) => void;
}

/**
 * One post-it.
 *
 * Presentational by design: the text draft, the clipboard state and the
 * persisted config all live in the widget, so this component only has to say
 * what happened.
 */
export function StickyNoteCard({
  note,
  editing,
  value,
  copied,
  fontClass,
  onChange,
  onStartEdit,
  onFinishEdit,
  onTogglePin,
  onCopy,
  onRemove,
  onRecolor,
}: StickyNoteCardProps) {
  const palette = COLORS[note.color];
  const title = stickyTitle(value);

  /**
   * Leaving the textarea for another control *inside* the card (a colour dot,
   * the pin) must not end the edit — those clicks would otherwise dismiss the
   * editor the user just opened.
   */
  const onBlur = (event: FocusEvent<HTMLTextAreaElement>) => {
    const next = event.relatedTarget as Node | null;
    if (next && event.currentTarget.closest('article')?.contains(next)) return;
    onFinishEdit();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Escape') return;
    event.preventDefault();
    onFinishEdit();
  };

  return (
    <article
      data-sticky-id={note.id}
      data-pinned={note.pinned ? 'true' : 'false'}
      className={cn(
        'flex min-h-[7rem] flex-col rounded-xl border p-1.5 shadow-sm transition-shadow',
        palette.card,
        note.pinned && 'shadow-md ring-1 ring-slate-900/5 dark:ring-white/10',
      )}
    >
      <header className="flex shrink-0 items-center gap-0.5">
        <IconButton
          label={note.pinned ? 'Unpin note' : 'Pin note'}
          size="icon-sm"
          active={note.pinned}
          icon={<PinIcon className={cn('h-3.5 w-3.5', note.pinned && '-rotate-12')} />}
          onClick={onTogglePin}
          className={cn(
            note.pinned &&
              'bg-amber-100 text-amber-700 hover:bg-amber-200 dark:bg-amber-400/20 dark:text-amber-300 dark:hover:bg-amber-400/30',
          )}
        />
        <span className="min-w-0 flex-1" />
        {editing ? (
          <IconButton
            label="Save note"
            size="icon-sm"
            icon={<CheckIcon className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />}
            onClick={onFinishEdit}
          />
        ) : (
          <IconButton
            label="Edit note"
            size="icon-sm"
            icon={<PencilIcon className="h-3.5 w-3.5" />}
            onClick={onStartEdit}
          />
        )}
        <IconButton
          label={copied ? 'Copied' : 'Copy note'}
          size="icon-sm"
          active={copied}
          icon={copied ? <CheckIcon className="h-3.5 w-3.5" /> : <CopyIcon className="h-3.5 w-3.5" />}
          onClick={onCopy}
        />
        <IconButton
          label="Delete note"
          size="icon-sm"
          variant="danger"
          icon={<TrashIcon className="h-3.5 w-3.5" />}
          onClick={onRemove}
        />
      </header>

      {editing ? (
        <>
          {/*
            The editor surface is opaque and *never* changes its background or
            text colour on focus. A `focus:bg-white` here would be a trap: it
            carries the specificity of a class plus a pseudo-class, so it beats
            the `:where(.dark, …)`-wrapped `dark:bg-*` whatever the source order,
            which paints white behind the near-white dark-theme text while the
            user is typing. Only the ring and border react to focus.
          */}
          <textarea
            autoFocus
            value={value}
            maxLength={STICKY_TEXT_MAX}
            onChange={(event: ChangeEvent<HTMLTextAreaElement>) => onChange(event.target.value)}
            onBlur={onBlur}
            onKeyDown={onKeyDown}
            spellCheck
            placeholder="Write a note…"
            aria-label={`Note text: ${title}`}
            className={cn(
              'mt-1 min-h-[4.5rem] w-full flex-1 resize-none rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-slate-800 caret-violet-600',
              'placeholder:text-slate-400 focus:border-violet-400 focus:outline-none focus:ring-2 focus:ring-violet-500/25',
              'dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:caret-violet-400 dark:placeholder:text-slate-500',
              fontClass,
            )}
          />
          <div className="mt-1 flex shrink-0 items-center gap-1 px-0.5" role="group" aria-label="Note colour">
            {COLOR_ORDER.map((color) => (
              <button
                key={color}
                type="button"
                aria-label={`Colour ${color}`}
                aria-pressed={note.color === color}
                onClick={() => onRecolor(color)}
                className={cn(
                  'h-3.5 w-3.5 rounded-full transition',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/60',
                  note.color === color ? palette.dotActive : COLORS[color].dot,
                )}
              />
            ))}
          </div>
        </>
      ) : (
        <button
          type="button"
          onClick={onStartEdit}
          aria-label={`Edit note: ${title}`}
          className={cn(
            'mt-1 min-h-0 w-full flex-1 cursor-text overflow-hidden rounded-lg px-1.5 py-1 text-left text-slate-700',
            // Both hover veils are deliberately faint: whichever one wins the
            // cascade, the note's text stays readable on top of it.
            'hover:bg-slate-900/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/40',
            'dark:text-slate-200 dark:hover:bg-white/10',
            fontClass,
          )}
        >
          {value.trim() === '' ? (
            <span className="italic text-slate-400 dark:text-slate-500">Empty note</span>
          ) : (
            <span className="line-clamp-6 whitespace-pre-wrap break-words">{value}</span>
          )}
        </button>
      )}
    </article>
  );
}
