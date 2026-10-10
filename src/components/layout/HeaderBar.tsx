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
  SunIcon,
  MonitorIcon,
  UndoIcon,
  UnlockIcon,
  UploadIcon,
  WandIcon,
  CopyIcon,
  SparklesIcon,
} from '@/components/icons';
import { Badge, Button, Dropdown, IconButton } from '@/components/ui';
import { GRID_COLUMNS } from '@/constants/grid';
import { APP_NAME, IMPORT_ACCEPT } from '@/constants/app';
import { useDashboardActions } from '@/hooks/useDashboardActions';
import { useTheme } from '@/hooks/useTheme';
import { useDashboardStore, selectCanRedo, selectCanUndo } from '@/store/dashboardStore';
import { useUiStore } from '@/store/uiStore';
import { cn } from '@/lib/utils';

/** The app mark, exported at 96px so it stays crisp on high-density screens. */
const LOGO_SRC = '/logo-96.png';

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
  const { theme, resolved, setTheme } = useTheme();
  const widgetCount = useDashboardStore((state) => state.widgets.length);
  const locked = useDashboardStore((state) => state.locked);
  const activeBreakpoint = useDashboardStore((state) => state.activeBreakpoint);
  const canUndo = useDashboardStore(selectCanUndo);
  const canRedo = useDashboardStore(selectCanRedo);
  const openTemplates = useUiStore((state) => state.openTemplates);
  const openShortcuts = useUiStore((state) => state.openShortcuts);
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
                <span className="hidden capitalize md:inline">{theme}</span>
              </span>
            }
            items={[
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
                id: 'export',
                label: 'Export layout as JSON',
                icon: <DownloadIcon className="h-4 w-4" />,
                shortcut: '⌘S',
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
                id: 'shortcuts',
                label: 'Keyboard shortcuts',
                icon: <KeyboardIcon className="h-4 w-4" />,
                shortcut: '?',
                onSelect: openShortcuts,
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
  const activeBreakpoint = useDashboardStore((state) => state.activeBreakpoint);
  const locked = useDashboardStore((state) => state.locked);
  const openShortcuts = useUiStore((state) => state.openShortcuts);

  return (
    <footer className="border-t border-slate-200/80 bg-white/70 backdrop-blur dark:border-slate-800/80 dark:bg-slate-950/70">
      <div className="mx-auto flex max-w-[1800px] flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2 text-[11px] text-slate-400 sm:px-6 lg:px-8 dark:text-slate-500">
        <span className="inline-flex items-center gap-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden="true" />
          Saved in this browser
        </span>
        <span className="inline-flex items-center gap-1">
          <GridIcon className="h-3 w-3" />
          {widgetCount} {widgetCount === 1 ? 'widget' : 'widgets'} · {activeBreakpoint} ·{' '}
          {GRID_COLUMNS[activeBreakpoint]} cols
        </span>
        {locked ? <span>Layout locked</span> : null}
        <button
          type="button"
          onClick={openShortcuts}
          className="ml-auto inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 transition hover:bg-slate-100 hover:text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/60 dark:hover:bg-slate-800 dark:hover:text-slate-300"
        >
          <KeyboardIcon className="h-3 w-3" />
          Shortcuts
          <span className="ml-1 rounded border border-slate-200 px-1 dark:border-slate-700">?</span>
        </button>
      </div>
    </footer>
  );
}
