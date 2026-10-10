import { useMemo, useState, type ChangeEvent, type KeyboardEvent } from 'react';
import { CheckIcon, NotesIcon, PencilIcon, SplitIcon, EyeIcon } from '@/components/icons';
import { Markdown, Segmented } from '@/components/ui';
import { useDebouncedCallback } from '@/hooks/useDebouncedCallback';
import { cn } from '@/lib/utils';
import type { SettingField, WidgetProps } from '@/types';
import { defineWidget } from '@/widgets/define';

export type NotesMode = 'edit' | 'split' | 'preview';
export type NotesFontSize = 'sm' | 'md' | 'lg';

export type NotesConfig = {
  /** Raw markdown source. */
  text: string;
  mode: NotesMode;
  fontSize: NotesFontSize;
};

const DEFAULT_NOTES_TEXT = `# Welcome to Lotus 👋

This scratchpad saves as you type — switch to **Preview** or **Split** to see the markdown.

## Try this
- [x] Drag a widget by its header
- [ ] Resize it from the bottom-right corner
- [ ] Drag a widget from the *Add widget* drawer straight onto the grid

> Everything is stored locally in your browser, and you can export the whole layout as JSON.

\`Ctrl/⌘ + Z\` undoes a layout change.`;

const DEFAULT_NOTES_CONFIG: NotesConfig = {
  text: DEFAULT_NOTES_TEXT,
  mode: 'split',
  fontSize: 'md',
};

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

/** Markdown scratchpad with debounced auto-save and a live preview. */
export function NotesWidget({ config, updateConfig }: WidgetProps<NotesConfig>) {
  /**
   * `draft` is `null` while the editor mirrors the stored config and holds the
   * in-progress value between keystrokes and the debounced save. This keeps the
   * component free of "sync prop into state" effects: an external change (import,
   * template, reset) is picked up instantly whenever the user is not typing, and
   * never clobbers what they are typing.
   */
  const [draft, setDraft] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const value = draft ?? config.text;
  const dirty = draft !== null;

  const save = useDebouncedCallback((next: string) => {
    updateConfig({ text: next });
    setSavedAt(Date.now());
    setDraft(null);
  }, 350);

  const onChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    const next = event.target.value;
    setDraft(next);
    save.run(next);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Tab' || event.shiftKey) return;
    event.preventDefault();
    const target = event.currentTarget;
    const { selectionStart, selectionEnd } = target;
    const next = `${value.slice(0, selectionStart)}  ${value.slice(selectionEnd)}`;
    setDraft(next);
    save.run(next);
    requestAnimationFrame(() => {
      target.selectionStart = selectionStart + 2;
      target.selectionEnd = selectionStart + 2;
    });
  };

  const stats = useMemo(() => {
    const words = value.trim() === '' ? 0 : value.trim().split(/\s+/).length;
    return { words, characters: value.length };
  }, [value]);

  const showEditor = config.mode !== 'preview';
  const showPreview = config.mode !== 'edit';

  return (
    <div className="flex h-full flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <Segmented
          label="Notes view mode"
          value={config.mode}
          onChange={(mode) => updateConfig({ mode })}
          options={MODE_OPTIONS}
        />
        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-400 dark:text-slate-500">
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

      <div className={cn('grid min-h-0 flex-1 gap-3', showEditor && showPreview && 'grid-cols-2')}>
        {showEditor ? (
          <textarea
            value={value}
            onChange={onChange}
            onKeyDown={onKeyDown}
            spellCheck
            placeholder="Write markdown here…"
            aria-label="Notes"
            className={cn(
              'h-full w-full resize-none rounded-xl border border-slate-200 bg-slate-50/60 p-3 font-mono leading-relaxed text-slate-700',
              'placeholder:text-slate-400 focus:border-violet-300 focus:bg-white focus:outline-none focus:ring-2 focus:ring-violet-500/20',
              'dark:border-slate-700 dark:bg-slate-950/40 dark:text-slate-200 dark:placeholder:text-slate-600',
              'dark:focus:border-violet-500/50 dark:focus:bg-slate-950/70',
              FONT_SIZES[config.fontSize],
            )}
          />
        ) : null}

        {showPreview ? (
          <div
            className={cn(
              'h-full min-w-0 overflow-y-auto rounded-xl border border-slate-100 bg-white/60 p-3',
              'dark:border-slate-800 dark:bg-slate-950/20',
            )}
          >
            <Markdown source={value} placeholder="Your preview appears here." />
          </div>
        ) : null}
      </div>

      <div className="flex items-center justify-between text-[11px] text-slate-400 dark:text-slate-500">
        <span>Markdown supported</span>
        <span className="tabular-nums">
          {stats.words} words · {stats.characters} chars
        </span>
      </div>
    </div>
  );
}

export const notesWidget = defineWidget<NotesConfig>({
  type: 'notes',
  name: 'Markdown notes',
  summary: 'A scratchpad with live markdown preview and auto-save.',
  category: 'productivity',
  keywords: ['notes', 'markdown', 'scratchpad', 'todo', 'editor'],
  icon: NotesIcon,
  accent: 'amber',
  defaultSize: { w: 6, h: 6, minW: 3, minH: 4 },
  defaultConfig: DEFAULT_NOTES_CONFIG,
  settings: SETTINGS,
  summarize: (config) => {
    const firstLine = config.text.split('\n').find((line) => line.trim() !== '');
    return firstLine ? firstLine.replace(/^#+\s*/, '').slice(0, 48) : 'Empty note';
  },
  component: NotesWidget,
});
