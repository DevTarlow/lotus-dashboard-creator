import { KeyboardIcon, SparklesIcon } from '@/components/icons';
import { Kbd, Modal } from '@/components/ui';
import { GettingStarted } from '@/components/modals/GettingStarted';
import { APP_NAME, APP_VERSION } from '@/constants/app';
import { useUiStore } from '@/store/uiStore';

/** Project home, so a dashboard someone was sent can be traced back. */
const PROJECT_URL = 'https://github.com/DevTarlow/lotus-dashboard-creator';

interface ShortcutRow {
  keys: readonly string[];
  label: string;
}

const SHORTCUTS: readonly { group: string; rows: readonly ShortcutRow[] }[] = [
  {
    group: 'Dashboard',
    rows: [
      { keys: ['⌘', 'K'], label: 'Add a widget' },
      { keys: ['⌘', 'Z'], label: 'Undo the last change' },
      { keys: ['⌘', '⇧', 'Z'], label: 'Redo (Ctrl + Y also works)' },
      { keys: ['⌘', 'S'], label: 'Save the dashboard into this file' },
      { keys: ['⌘', '⇧', 'S'], label: 'Save a backup (.json)' },
      { keys: ['⌘', '⇧', 'D'], label: 'Switch light / dark' },
      { keys: ['?'], label: 'Show this help' },
      { keys: ['Esc'], label: 'Close dialogs and menus' },
    ],
  },
  {
    group: 'While editing a widget',
    rows: [
      { keys: ['Tab'], label: 'Indent inside the notes editor' },
      { keys: ['Enter'], label: 'Confirm a widget title' },
    ],
  },
];

/**
 * Help: how to get started, plus the keyboard shortcut sheet.
 *
 * Reachable at any time (the `?` key, the status bar and the ⋯ menu), because
 * the first-run welcome is dismissible and there has to be a way back to it.
 */
export function HelpDialog() {
  const open = useUiStore((state) => state.helpOpen);
  const close = useUiStore((state) => state.closeHelp);

  return (
    <Modal
      open={open}
      onClose={close}
      title="Help"
      description="Getting started, and every keyboard shortcut."
      size="md"
    >
      <div className="space-y-6">
        <section>
          <h3 className="mb-3 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
            <SparklesIcon className="h-3.5 w-3.5" />
            Getting started
          </h3>
          <GettingStarted />
        </section>

        {SHORTCUTS.map((section) => (
          <section key={section.group}>
            <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
              <KeyboardIcon className="h-3.5 w-3.5" />
              {section.group}
            </h3>
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {section.rows.map((row) => (
                <li key={row.label} className="flex items-center justify-between gap-4 py-2">
                  <span className="text-sm text-slate-600 dark:text-slate-300">{row.label}</span>
                  <span className="flex shrink-0 items-center gap-1">
                    {row.keys.map((key) => (
                      <Kbd key={key}>{key}</Kbd>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ))}
        <p className="text-[11px] text-slate-400 dark:text-slate-500">
          The modifier key is ⌘ on macOS and Ctrl everywhere else.
        </p>
        <p className="text-[11px] text-slate-400 dark:text-slate-500">
          {APP_NAME} {APP_VERSION} ·{' '}
          <a
            href={PROJECT_URL}
            target="_blank"
            rel="noreferrer noopener"
            className="underline underline-offset-2 hover:text-slate-600 dark:hover:text-slate-300"
          >
            Project home
          </a>
        </p>
      </div>
    </Modal>
  );
}
