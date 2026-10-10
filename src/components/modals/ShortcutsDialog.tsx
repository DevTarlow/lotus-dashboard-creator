import { KeyboardIcon } from '@/components/icons';
import { Kbd, Modal } from '@/components/ui';
import { useUiStore } from '@/store/uiStore';

interface ShortcutRow {
  keys: readonly string[];
  label: string;
}

const SHORTCUTS: readonly { group: string; rows: readonly ShortcutRow[] }[] = [
  {
    group: 'Dashboard',
    rows: [
      { keys: ['⌘', 'K'], label: 'Open the widget gallery' },
      { keys: ['⌘', 'Z'], label: 'Undo the last change' },
      { keys: ['⌘', '⇧', 'Z'], label: 'Redo' },
      { keys: ['⌘', 'S'], label: 'Export the layout as JSON' },
      { keys: ['⌘', '⇧', 'D'], label: 'Toggle light / dark mode' },
      { keys: ['?'], label: 'Show this shortcut sheet' },
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

/** Keyboard shortcut cheat sheet. */
export function ShortcutsDialog() {
  const open = useUiStore((state) => state.shortcutsOpen);
  const close = useUiStore((state) => state.closeShortcuts);

  return (
    <Modal
      open={open}
      onClose={close}
      title="Keyboard shortcuts"
      description="Modifier key is ⌘ on macOS and Ctrl everywhere else."
      size="sm"
    >
      <div className="space-y-5">
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
      </div>
    </Modal>
  );
}
