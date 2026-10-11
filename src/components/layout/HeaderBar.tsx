import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import {
  DownloadIcon,
  GridIcon,
  KeyboardIcon,
  LockIcon,
  MoonIcon,
  MoreIcon,
  PlusIcon,
  RedoIcon,
  RefreshIcon,
  SaveIcon,
  SunIcon,
  MonitorIcon,
  UndoIcon,
  UnlinkIcon,
  UnlockIcon,
  UploadIcon,
  WandIcon,
  CopyIcon,
  PaletteIcon,
  SparklesIcon,
} from '@/components/icons';
import { Badge, Button, Dropdown, IconButton } from '@/components/ui';
import { GRID_COLUMNS } from '@/constants/grid';
import { APP_NAME, IMPORT_ACCEPT } from '@/constants/app';
import { useDashboardActions } from '@/hooks/useDashboardActions';
import { useSaveDashboardFile } from '@/hooks/useSaveDashboardFile';
import { useTheme } from '@/hooks/useTheme';
import { useDashboardStore, selectCanRedo, selectCanUndo } from '@/store/dashboardStore';
import { useUiStore } from '@/store/uiStore';
import { isPersistentStorage } from '@/lib/storage';
import { cn } from '@/lib/utils';
// Imported (not a `public/` string) so the bundler inlines it: a single-file
// dashboard has no sibling asset files to load.
import logo96 from '@/assets/logo-96.png';

/** The app mark, exported at 96px so it stays crisp on high-density screens. */
const LOGO_SRC = logo96;

/** Inline editable dashboard title. */
function DashboardTitle() {
  const title = useDashboardStore((state) => state.title);
  const { renameDashboard } = useDashboardActions();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(title);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  const startEditing = () => {
    // Seed the draft on entry, so external renames are always reflected.
    setDraft(title);
    setEditing(true);
  };

  const commit = () => {
    setEditing(false);
    if (draft.trim() !== title) renameDashboard(draft);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      commit();
    }
    if (event.key === 'Escape') {
      setDraft(title);
      setEditing(false);
    }
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={onKeyDown}
        maxLength={64}
        aria-label="Dashboard title"
        className="w-full max-w-[16rem] rounded-lg border border-violet-300 bg-white px-2 py-0.5 text-base font-semibold text-slate-900 outline-none focus:ring-2 focus:ring-violet-500/30 dark:border-violet-500/50 dark:bg-slate-900 dark:text-white"
      />
    );
  }

  return (
    <button
      type="button"
      onClick={startEditing}
      title="Rename dashboard"
      className="group/title max-w-[16rem] truncate rounded-lg px-2 py-0.5 text-left text-base font-semibold text-slate-900 transition hover:bg-slate-100 dark:text-white dark:hover:bg-slate-800"
    >
      {title}
    </button>
  );
}

/** Sticky application toolbar. */
export function HeaderBar() {
  const actions = useDashboardActions();
  const { save, saveAs, forgetLink, linkedFileName } = useSaveDashboardFile();
  const { theme, resolved, setTheme } = useTheme();
  const widgetCount = useDashboardStore((state) => state.widgets.length);
  const locked = useDashboardStore((state) => state.locked);
  const activeBreakpoint = useDashboardStore((state) => state.activeBreakpoint);
  const canUndo = useDashboardStore(selectCanUndo);
  const canRedo = useDashboardStore(selectCanRedo);
  const openAppearance = useUiStore((state) => state.openAppearance);
  const openTemplates = useUiStore((state) => state.openTemplates);
  const openHelp = useUiStore((state) => state.openHelp);
  const inputRef = useRef<HTMLInputElement>(null);

  const onPickFile = useCallback(
    (file: File | undefined) => {
      if (!file) return;
      void actions.importFile(file);
    },
    [actions],
  );

  const themeIcon = theme === 'system' ? <MonitorIcon className="h-4 w-4" /> : resolved === 'dark' ? <MoonIcon className="h-4 w-4" /> : <SunIcon className="h-4 w-4" />;

  return (
    <header className="sticky top-0 z-30 border-b border-slate-200/80 bg-white/80 backdrop-blur-xl dark:border-slate-800/80 dark:bg-slate-950/80">
      <div className="mx-auto flex max-w-[1800px] flex-wrap items-center gap-2 px-4 py-2.5 sm:px-6 lg:px-8">
        <div className="flex min-w-0 items-center gap-2.5">
          {/* No background chip: the mark is a transparent PNG carrying its own
              gradient, so it sits directly on either header theme. */}
          <img src={LOGO_SRC} alt="" aria-hidden="true" className="h-9 w-9 shrink-0 select-none" />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <DashboardTitle />
              <Badge tone="violet" className="hidden sm:inline-flex">
                {widgetCount} {widgetCount === 1 ? 'widget' : 'widgets'}
              </Badge>
            </div>
            <p className="hidden px-2 text-[11px] text-slate-400 sm:block dark:text-slate-500">
              {APP_NAME} · {activeBreakpoint} · {GRID_COLUMNS[activeBreakpoint]} cols
            </p>
          </div>
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-1">
          <div className="mr-1 hidden items-center gap-0.5 rounded-xl border border-slate-200 bg-white/70 p-0.5 sm:flex dark:border-slate-700/70 dark:bg-slate-900/60">
            <IconButton
              label="Undo (⌘/Ctrl + Z)"
              size="icon-sm"
              icon={<UndoIcon className="h-4 w-4" />}
              onClick={actions.undo}
              disabled={!canUndo}
            />
            <IconButton
              label="Redo (⌘/Ctrl + Shift + Z)"
              size="icon-sm"
              icon={<RedoIcon className="h-4 w-4" />}
              onClick={actions.redo}
              disabled={!canRedo}
            />
            <IconButton
              label="Tidy layout"
              size="icon-sm"
              icon={<WandIcon className="h-4 w-4" />}
              onClick={actions.tidy}
            />
            <IconButton
              label={locked ? 'Unlock layout' : 'Lock layout'}
              size="icon-sm"
              active={locked}
              icon={locked ? <LockIcon className="h-4 w-4" /> : <UnlockIcon className="h-4 w-4" />}
              onClick={actions.toggleLock}
            />
          </div>

          <Dropdown
            label="Colour theme"
            trigger={
              <span className="inline-flex items-center gap-1.5">
                {themeIcon}
                {/* A dot of the live accent, so the current palette is visible
                    without opening the picker. */}
                <span
                  className="h-2.5 w-2.5 rounded-full border border-slate-900/10 bg-violet-500 dark:border-white/20"
                  aria-hidden="true"
                />
                <span className="hidden capitalize md:inline">{theme}</span>
              </span>
            }
            items={[
              {
                id: 'appearance',
                label: 'Themes & colours…',
                icon: <PaletteIcon className="h-4 w-4" />,
                onSelect: openAppearance,
              },
              { id: 'sep-theme', separator: true },
              { id: 'light', label: 'Light', icon: <SunIcon className="h-4 w-4" />, onSelect: () => setTheme('light') },
              { id: 'dark', label: 'Dark', icon: <MoonIcon className="h-4 w-4" />, onSelect: () => setTheme('dark') },
              {
                id: 'system',
                label: 'Match system',
                icon: <MonitorIcon className="h-4 w-4" />,
                onSelect: () => setTheme('system'),
              },
            ]}
          />

          <Dropdown
            label="Dashboard actions"
            trigger={<MoreIcon className="h-4 w-4" />}
            triggerClassName="w-9 justify-center px-0"
            items={[
              {
                id: 'templates',
                label: 'Templates & reset',
                icon: <SparklesIcon className="h-4 w-4" />,
                onSelect: openTemplates,
              },
              {
                id: 'tidy',
                label: 'Tidy up layout',
                icon: <WandIcon className="h-4 w-4" />,
                onSelect: actions.tidy,
              },
              { id: 'sep-1', separator: true },
              {
                id: 'save-file',
                label: 'Save to file',
                icon: <SaveIcon className="h-4 w-4" />,
                shortcut: '⌘S',
                onSelect: () => {
                  void save();
                },
              },
              {
                id: 'save-copy',
                label: 'Save a copy…',
                icon: <CopyIcon className="h-4 w-4" />,
                onSelect: () => {
                  void saveAs();
                },
              },
              {
                id: 'forget-file',
                label: 'Forget this file',
                icon: <UnlinkIcon className="h-4 w-4" />,
                disabled: !linkedFileName,
                onSelect: () => {
                  void forgetLink();
                },
              },
              {
                id: 'export',
                label: 'Export layout as JSON',
                icon: <DownloadIcon className="h-4 w-4" />,
                shortcut: '⌘⇧S',
                onSelect: actions.exportJson,
              },
              {
                id: 'copy',
                label: 'Copy layout JSON',
                icon: <CopyIcon className="h-4 w-4" />,
                onSelect: actions.copyJson,
              },
              {
                id: 'import',
                label: 'Import layout from JSON',
                icon: <UploadIcon className="h-4 w-4" />,
                onSelect: () => inputRef.current?.click(),
              },
              { id: 'sep-2', separator: true },
              {
                id: 'reset',
                label: 'Reset to default template',
                icon: <RefreshIcon className="h-4 w-4" />,
                danger: true,
                onSelect: actions.resetDashboard,
              },
              {
                id: 'help',
                label: 'Help & shortcuts',
                icon: <KeyboardIcon className="h-4 w-4" />,
                shortcut: '?',
                onSelect: openHelp,
              },
            ]}
          />

          <Button
            variant="primary"
            icon={<PlusIcon className="h-4 w-4" />}
            onClick={actions.openAddWidget}
            title="Add widget (⌘/Ctrl + K)"
          >
            <span className="hidden sm:inline">Add widget</span>
          </Button>
        </div>
      </div>

      {/* Hidden picker used by the "Import layout" action. */}
      <input
        ref={inputRef}
        type="file"
        accept={IMPORT_ACCEPT}
        className={cn('hidden')}
        onChange={(event) => {
          onPickFile(event.target.files?.[0]);
          event.target.value = '';
        }}
      />
    </header>
  );
}

/** Compact footer with persistence status and grid information. */
export function StatusBar() {
  const widgetCount = useDashboardStore((state) => state.widgets.length);
  const locked = useDashboardStore((state) => state.locked);
  const openHelp = useUiStore((state) => state.openHelp);
  const { linkedFileName, canWriteInPlace } = useSaveDashboardFile();
  // Constant for the lifetime of the page.
  const persistent = isPersistentStorage();

  /**
   * One honest line about where the work is being kept. "Saved in this browser"
   * on its own read as "saved", while the file the user was sent was only ever
   * updated by Save to file.
   */
  const saveState = !persistent
    ? { tone: 'bg-amber-500', label: "Can't save in this browser — use Save to file" }
    : linkedFileName
      ? { tone: 'bg-emerald-500', label: `Saved to ${linkedFileName}` }
      : canWriteInPlace
        ? { tone: 'bg-emerald-500', label: 'Saved in this browser — use Save to file to keep the file up to date' }
        : { tone: 'bg-emerald-500', label: 'Saved in this browser — Save to file downloads a copy' };

  return (
    <footer className="border-t border-slate-200/80 bg-white/70 backdrop-blur dark:border-slate-800/80 dark:bg-slate-950/70">
      <div className="mx-auto flex max-w-[1800px] flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2 text-[11px] text-slate-400 sm:px-6 lg:px-8 dark:text-slate-500">
        <span className="inline-flex items-center gap-1.5">
          <span className={cn('h-1.5 w-1.5 rounded-full', saveState.tone)} aria-hidden="true" />
          {saveState.label}
        </span>
        <span className="inline-flex items-center gap-1">
          <GridIcon className="h-3 w-3" />
          {widgetCount} {widgetCount === 1 ? 'widget' : 'widgets'}
        </span>
        {locked ? <span>Layout locked</span> : null}
        <button
          type="button"
          onClick={openHelp}
          className="ml-auto inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 transition hover:bg-slate-100 hover:text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/60 dark:hover:bg-slate-800 dark:hover:text-slate-300"
        >
          <KeyboardIcon className="h-3 w-3" />
          Help
          <span className="ml-1 rounded border border-slate-200 px-1 dark:border-slate-700">?</span>
        </button>
      </div>
    </footer>
  );
}
