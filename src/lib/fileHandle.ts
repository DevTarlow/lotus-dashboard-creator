/**
 * "Save to file" plumbing.
 *
 * The File System Access API lets the app write straight back to the user's
 * dashboard file, so saving is one click rather than a download plus a manual
 * overwrite. The chosen handle is structured-cloneable, so it is kept in
 * IndexedDB and later sessions can save without asking again.
 *
 * Every part of this is optional: when the API is missing (Firefox, Safari) or
 * the handle is gone, callers fall back to a plain download.
 */

const DB_NAME = 'lotus-dashboard-creator';
const DB_VERSION = 1;
const STORE_NAME = 'handles';
const HANDLE_KEY = 'dashboard-file';

/** Structural subset of `FileSystemFileHandle` that this module relies on. */
export interface WritableLike {
  write: (data: string) => Promise<void>;
  close: () => Promise<void>;
}

export interface FileHandleLike {
  readonly name: string;
  createWritable: (options?: { keepExistingData?: boolean }) => Promise<WritableLike>;
  queryPermission?: (descriptor?: { mode?: string }) => Promise<PermissionState>;
  requestPermission?: (descriptor?: { mode?: string }) => Promise<PermissionState>;
}

interface FilePickerHost {
  showSaveFilePicker?: (options?: {
    suggestedName?: string;
    types?: Array<{ description?: string; accept: Record<string, string[]> }>;
  }) => Promise<FileHandleLike>;
}

function pickerHost(): FilePickerHost {
  return globalThis as unknown as FilePickerHost;
}

/** `true` when the browser can write directly to a user-chosen file. */
export function supportsFileSystemAccess(): boolean {
  return typeof pickerHost().showSaveFilePicker === 'function';
}

/** Ask the user where to keep the dashboard. Returns `null` if they cancel. */
export async function pickDashboardFile(suggestedName: string): Promise<FileHandleLike | null> {
  const picker = pickerHost().showSaveFilePicker;
  if (!picker) return null;
  try {
    return await picker.call(globalThis, {
      suggestedName,
      types: [{ description: 'Lotus dashboard', accept: { 'text/html': ['.html', '.htm'] } }],
    });
  } catch (error) {
    // `AbortError` is the user dismissing the dialog — not a failure.
    if (error instanceof DOMException && error.name === 'AbortError') return null;
    if (error instanceof Error && error.name === 'AbortError') return null;
    throw error;
  }
}

/**
 * Make sure we may write to a handle, asking the user if needed.
 *
 * After a reload a stored handle comes back without permission, and the request
 * must happen inside a user gesture — which is why this is called from the click
 * handler rather than at startup.
 */
export async function ensureWritePermission(handle: FileHandleLike): Promise<boolean> {
  if (!handle.queryPermission) return true;
  try {
    if ((await handle.queryPermission({ mode: 'readwrite' })) === 'granted') return true;
    if (!handle.requestPermission) return false;
    return (await handle.requestPermission({ mode: 'readwrite' })) === 'granted';
  } catch {
    return false;
  }
}

/** Write `contents` to the handle, replacing whatever was there. */
export async function writeToHandle(handle: FileHandleLike, contents: string): Promise<void> {
  const writable = await handle.createWritable();
  await writable.write(contents);
  await writable.close();
}

/* ------------------------------------------------------------- handle store */

function openDatabase(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    const factory = (globalThis as { indexedDB?: IDBFactory }).indexedDB;
    if (!factory) {
      resolve(null);
      return;
    }
    let request: IDBOpenDBRequest;
    try {
      request = factory.open(DB_NAME, DB_VERSION);
    } catch {
      resolve(null);
      return;
    }
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    // Private windows and locked-down profiles can refuse IndexedDB entirely.
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });
}

/** Run one transaction against the handle store, swallowing storage failures. */
async function withStore<T>(
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T | null> {
  const db = await openDatabase();
  if (!db) return null;
  try {
    return await new Promise<T | null>((resolve) => {
      const transaction = db.transaction(STORE_NAME, mode);
      const request = action(transaction.objectStore(STORE_NAME));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      transaction.oncomplete = () => db.close();
      transaction.onabort = () => {
        db.close();
        resolve(null);
      };
    });
  } catch {
    return null;
  }
}

/** The dashboard file this browser last saved to, if it is still remembered. */
export async function loadStoredHandle(): Promise<FileHandleLike | null> {
  const handle = await withStore<FileHandleLike | undefined>('readonly', (store) => store.get(HANDLE_KEY));
  if (!handle || typeof handle.createWritable !== 'function') return null;
  return handle;
}

/** Remember the file so the next session can save without asking. */
export async function storeHandle(handle: FileHandleLike): Promise<void> {
  await withStore('readwrite', (store) => store.put(handle, HANDLE_KEY));
}

/** Stop auto-saving to the remembered file. */
export async function forgetHandle(): Promise<void> {
  await withStore('readwrite', (store) => store.delete(HANDLE_KEY));
}
