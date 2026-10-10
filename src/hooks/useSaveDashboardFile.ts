import { useCallback, useRef } from 'react';
import { createEmbeddedState } from '@/lib/embedded';
import {
  ensureWritePermission,
  forgetHandle,
  loadStoredHandle,
  pickDashboardFile,
  storeHandle,
  supportsFileSystemAccess,
  writeToHandle,
  type FileHandleLike,
} from '@/lib/fileHandle';
import { serializeDashboardFile, suggestedDashboardFileName } from '@/lib/singleFile';
import { downloadTextFile } from '@/lib/utils';
import { useDashboardStore } from '@/store/dashboardStore';
import { usePrefsStore } from '@/store/prefsStore';
import { useToastStore } from '@/store/toastStore';

export type SaveOutcome = 'file' | 'download' | 'cancelled' | 'failed';

export interface SaveDashboardFile {
  /** Write the dashboard to its file, picking one on first use. */
  save: () => Promise<SaveOutcome>;
  /** `true` when the browser can overwrite the file in place. */
  canWriteInPlace: boolean;
}

/**
 * "Save to file": freeze the current dashboard into a single HTML file.
 *
 * The file contains the whole app plus an embedded snapshot of the workspace, so
 * opening it later — on any machine, in any browser — restores this dashboard.
 * Where the File System Access API exists the same file is overwritten in place
 * (no downloads folder litter); everywhere else the file is downloaded.
 *
 * State is read through `getState()` at call time so the callback never closes
 * over a stale workspace.
 */
export function useSaveDashboardFile(): SaveDashboardFile {
  const success = useToastStore((state) => state.success);
  const warning = useToastStore((state) => state.warning);
  const error = useToastStore((state) => state.error);
  /** Remembered across calls; rehydrated from IndexedDB on first save. */
  const handleRef = useRef<FileHandleLike | null>(null);
  const canWriteInPlace = supportsFileSystemAccess();

  /**
   * Saving from the dev server writes a file full of `/src/...` URLs and the HMR
   * client, which cannot run standalone. Say so instead of letting the user
   * discover it by double-clicking a broken file.
   */
  const announce = useCallback(
    (title: string, description: string) => {
      if (import.meta.env.DEV) {
        warning(title, {
          description: `${description} This build came from the dev server — run \`npm run build:single\` for a file that opens on its own.`,
        });
      } else {
        success(title, { description });
      }
    },
    [success, warning],
  );

  const save = useCallback(async (): Promise<SaveOutcome> => {
    const dashboard = useDashboardStore.getState();
    const prefs = usePrefsStore.getState();

    const snapshot = createEmbeddedState({
      workspace: {
        title: dashboard.title,
        description: dashboard.description,
        widgets: dashboard.widgets,
        layouts: dashboard.layouts,
        locked: dashboard.locked,
      },
      // The Finnhub key is intentionally absent — see `lib/embedded`.
      prefs: {
        theme: prefs.theme,
        showGridHints: prefs.showGridHints,
        confirmDelete: prefs.confirmDelete,
      },
    });

    let html: string;
    try {
      html = serializeDashboardFile(document, snapshot);
    } catch (cause) {
      error('Could not build the dashboard file', {
        description: cause instanceof Error ? cause.message : 'Unknown error.',
      });
      return 'failed';
    }

    const fileName = suggestedDashboardFileName(dashboard.title);

    if (!canWriteInPlace) {
      downloadTextFile(fileName, html, 'text/html');
      announce('Dashboard downloaded', `${fileName} — open it any time to restore this dashboard.`);
      return 'download';
    }

    try {
      if (!handleRef.current) handleRef.current = await loadStoredHandle();
      if (!handleRef.current) handleRef.current = await pickDashboardFile(fileName);
      // The user dismissed the picker.
      if (!handleRef.current) return 'cancelled';

      if (!(await ensureWritePermission(handleRef.current))) {
        // Permission revoked or withheld: forget the handle and hand the user a
        // download rather than failing outright.
        await forgetHandle();
        handleRef.current = null;
        downloadTextFile(fileName, html, 'text/html');
        announce('Dashboard downloaded', 'Reopen it and save again to link the file.');
        return 'download';
      }

      await writeToHandle(handleRef.current, html);
      await storeHandle(handleRef.current);
      announce('Dashboard saved', `${handleRef.current.name} is up to date.`);
      return 'file';
    } catch (cause) {
      error('Could not save the dashboard file', {
        description: cause instanceof Error ? cause.message : 'Unknown error.',
      });
      return 'failed';
    }
  }, [announce, canWriteInPlace, error]);

  return { save, canWriteInPlace };
}
