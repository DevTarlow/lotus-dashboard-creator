import { useDashboardActions } from './useDashboardActions';
import { useHotkeys, type HotkeyDefinition } from './useHotkeys';
import { useSaveDashboardFile } from './useSaveDashboardFile';
import { useTheme } from './useTheme';
import { useUiStore } from '@/store/uiStore';

/**
 * Global keyboard shortcuts. Registered once, in `App`.
 *
 * Shortcuts are ignored while typing in inputs (see `useHotkeys`), so the
 * browser's own text editing shortcuts keep working.
 */
export function useGlobalShortcuts(): void {
  const actions = useDashboardActions();
  const { save } = useSaveDashboardFile();
  const { toggleTheme } = useTheme();
  const openAddWidget = useUiStore((state) => state.openAddWidget);
  const openHelp = useUiStore((state) => state.openHelp);

  const hotkeys: HotkeyDefinition[] = [
    {
      combo: 'mod+k',
      handler: (event) => {
        event.preventDefault();
        openAddWidget();
      },
    },
    {
      combo: 'mod+z',
      handler: (event) => {
        event.preventDefault();
        actions.undo();
      },
    },
    {
      combo: 'mod+shift+z',
      handler: (event) => {
        event.preventDefault();
        actions.redo();
      },
    },
    {
      combo: 'mod+y',
      handler: (event) => {
        event.preventDefault();
        actions.redo();
      },
    },
    {
      combo: 'mod+s',
      handler: (event) => {
        event.preventDefault();
        // Saving the dashboard file is what users expect from ⌘S; the JSON
        // export keeps a shortcut of its own on ⌘⇧S.
        void save();
      },
    },
    {
      combo: 'mod+shift+s',
      handler: (event) => {
        event.preventDefault();
        actions.exportJson();
      },
    },
    {
      combo: 'mod+shift+d',
      handler: (event) => {
        event.preventDefault();
        toggleTheme();
      },
    },
    {
      combo: '?',
      handler: () => openHelp(),
    },
  ];

  useHotkeys(hotkeys);
}
