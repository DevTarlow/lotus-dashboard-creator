import { useCallback, useEffect, useSyncExternalStore } from 'react';
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
import { preferredSaveName, serializeDashboardFile } from '@/lib/singleFile';
import { downloadTextFile } from '@/lib/utils';
import { useDashboardStore } from '@/store/dashboardStore';
import { shareablePrefs } from '@/lib/prefs';
import { usePrefsStore } from '@/store/prefsStore';
import { useToastStore } from '@/store/toastStore';

export type SaveOutcome = 'file' | 'download' | 'cancelled' | 'failed';

export interface SaveDashboardFile {
  /** Write the dashboard to its file, picking one on first use. */
  save: () => Promise<SaveOutcome>;
  /** Always ask where to put a copy, even when a file is already linked. */
  saveAs: () => Promise<SaveOutcome>;
  /** Stop saving to the linked file; the next save asks for a location. */
  forgetLink: () => Promise<void>;
  /** `true` when the browser can overwrite the file in place. */
  canWriteInPlace: boolean;
  /** Name of the file this document is linked to, when there is one. */
  linkedFileName: string | null;
}

/* ------------------------------------------------------------- linked file */

/**
 * The file the dashboard is linked to, shared by every component that asks.
 *
 * The toolbar, the shortcuts hook and the status bar each need this, and they
 * must never disagree about which file is up to date, so it lives outside React
 * and is read through `useSyncExternalStore`.
 */
let linkedHandle: FileHandleLike | null = null;
let loadedFromStorage = false;
const listeners = new Set<() => void>();

function publish(handle: FileHandleLike | null): void {
  linkedHandle = handle;
  for (const listener of listeners) listener();
}

function subscribeToLinkedFile(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function readLinkedFileName(): string | null {
  return linkedHandle?.name ?? null;
}

function readLinkedFileNameOnServer(): string | null {
  return null;
}

/** Read the remembered handle once, on the first component that mounts. */
function ensureHandleLoaded(): void {
  if (linkedHandle || loadedFromStorage) return;
  loadedFromStorage = true;
  void loadStoredHandle().then((handle) => {
    if (handle) publish(handle);
  });
}

/* ------------------------------------------------------------------- hook */

/**
 * "Save to file": freeze the current dashboard into a single HTML file.
 *
 * The file contains the whole app plus an embedded snapshot of the workspace, so
 * opening it later — on any machine, in any browser — restores this dashboard.
 * Where the File System Access API exists the same file is overwritten in place
 * (no downloads folder litter); everywhere else the file is downloaded.
 *
 * Which file that is, is remembered per document (see `lib/fileHandle`), so a
 * second dashboard opened in the same browser can never save into the first
 * one's file. The name is proposed from the document the app was opened from, so
 * saving a dashboard someone sent you updates *that* file rather than dropping a
 * renamed copy into the downloads folder.
 *
 * State is read through `getState()` at call time so the callback never closes
 * over a stale workspace.
 */
export function useSaveDashboardFile(): SaveDashboardFile {
  const success = useToastStore((state) => state.success);
  const warning = useToastStore((state) => state.warning);
  const error = useToastStore((state) => state.error);
  const canWriteInPlace = supportsFileSystemAccess();
  const linkedFileName = useSyncExternalStore(
    subscribeToLinkedFile,
    readLinkedFileName,
    readLinkedFileNameOnServer,
  );

  useEffect(() => {
    if (canWriteInPlace) ensureHandleLoaded();
  }, [canWriteInPlace]);

  /**
   * Saving from the dev server writes a file full of `/src/...` URLs and the HMR
   * client, which cannot run standalone. Say so instead of letting the user
   * discover it by double-clicking a broken file.
   */
  const announce = useCallback(
    (title: string, description: string) => {
      if (import.meta.env.DEV) {
        warning(title, {
          description: `${description} This build came from the dev server, so it will not open on its own. Run \`npm run build:single\` for a file that does.`,
        });
      } else {
        success(title, { description });
      }
    },
    [success, warning],
  );

  const persist = useCallback(
    async (forcePick: boolean): Promise<SaveOutcome> => {
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
        // API keys are excluded by construction — see `lib/prefs`.
        prefs: shareablePrefs(prefs),
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

      const fileName = preferredSaveName(dashboard.title);

      if (!canWriteInPlace) {
        downloadTextFile(fileName, html, 'text/html');
        announce('Dashboard downloaded', `${fileName}. Open it any time to get this dashboard back.`);
        return 'download';
      }

      let target = linkedHandle;
      try {
        if (forcePick && target) {
          await forgetHandle();
          publish(null);
          target = null;
        }

        if (!target) {
          target = await loadStoredHandle();
          if (target) publish(target);
        }
        if (!target) {
          target = await pickDashboardFile(fileName);
          // The user dismissed the picker.
          if (!target) return 'cancelled';
        }

        if (!(await ensureWritePermission(target))) {
          // Permission revoked or withheld: forget the handle and hand the user a
          // download rather than failing outright.
          await forgetHandle();
          publish(null);
          downloadTextFile(fileName, html, 'text/html');
          announce('Dashboard downloaded', 'Reopen it and save again to link the file.');
          return 'download';
        }

        await writeToHandle(target, html);
        await storeHandle(target);
        publish(target);
        announce('Dashboard saved', `${target.name} is up to date.`);
        return 'file';
      } catch (cause) {
        // The linked file may have been moved, renamed or deleted. Forget it so
        // the next press of Save asks where to keep the dashboard rather than
        // failing the same way forever.
        const attempted = target?.name;
        await forgetHandle();
        publish(null);
        error('Could not write to that file', {
          description: `${
            cause instanceof Error ? cause.message : 'Unknown error.'
          }${attempted ? ` (${attempted})` : ''} Save again to choose where to keep your dashboard.`,
        });
        return 'failed';
      }
    },
    [announce, canWriteInPlace, error],
  );

  const save = useCallback(() => persist(false), [persist]);
  const saveAs = useCallback(() => persist(true), [persist]);

  const forgetLink = useCallback(async () => {
    await forgetHandle();
    publish(null);
  }, []);

  return { save, saveAs, forgetLink, canWriteInPlace, linkedFileName };
}
