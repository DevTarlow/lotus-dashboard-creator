import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ensureWritePermission,
  forgetHandle,
  handleStorageKey,
  loadStoredHandle,
  storeHandle,
  supportsFileSystemAccess,
  writeToHandle,
  type FileHandleLike,
} from '@/lib/fileHandle';

const WEB = { protocol: 'https:', pathname: '/' };
const DISK = { protocol: 'file:', pathname: '/home/me/dashboards/ops.html' };
const OTHER_FILE = { protocol: 'file:', pathname: '/home/me/dashboards/personal.html' };

describe('handleStorageKey', () => {
  it('leaves the key global on the web, where the origin already separates apps', () => {
    expect(handleStorageKey(WEB)).toBe('dashboard-file');
  });

  it('scopes the remembered save target to the document that was opened', () => {
    // The bug this guards: every file:// document shares one IndexedDB, so an
    // unscoped key made the second dashboard opened in a browser save into the
    // first one's file.
    expect(handleStorageKey(DISK)).toBe('dashboard-file:/home/me/dashboards/ops.html');
    expect(handleStorageKey(OTHER_FILE)).not.toBe(handleStorageKey(DISK));
  });

  it('is stable for the same path and unsuffixed without a location', () => {
    expect(handleStorageKey(DISK)).toBe(handleStorageKey({ ...DISK }));
    expect(handleStorageKey(undefined)).toBe('dashboard-file');
  });
});

describe('supportsFileSystemAccess', () => {
  const original = (globalThis as { showSaveFilePicker?: unknown }).showSaveFilePicker;

  afterEach(() => {
    if (original === undefined) {
      delete (globalThis as { showSaveFilePicker?: unknown }).showSaveFilePicker;
    } else {
      (globalThis as { showSaveFilePicker?: unknown }).showSaveFilePicker = original;
    }
  });

  it('is true only when the picker exists', () => {
    delete (globalThis as { showSaveFilePicker?: unknown }).showSaveFilePicker;
    expect(supportsFileSystemAccess()).toBe(false);
    (globalThis as { showSaveFilePicker?: unknown }).showSaveFilePicker = () => {};
    expect(supportsFileSystemAccess()).toBe(true);
  });
});

describe('handle storage without IndexedDB', () => {
  // The unit environment has no IndexedDB, which is also the case in a private
  // window: the feature has to degrade to "ask again" rather than throw.
  it('reports no remembered handle', async () => {
    await expect(loadStoredHandle(DISK)).resolves.toBeNull();
  });

  it('does not throw when a handle cannot be written or forgotten', async () => {
    const fake = { name: 'ops.html' } as unknown as FileHandleLike;
    await expect(storeHandle(fake, DISK)).resolves.toBeUndefined();
    await expect(forgetHandle(DISK)).resolves.toBeUndefined();
  });
});

describe('writeToHandle', () => {
  it('writes the whole document and closes the writable', async () => {
    const write = vi.fn(async () => {});
    const close = vi.fn(async () => {});
    const handle = {
      name: 'ops.html',
      createWritable: async () => ({ write, close }),
    } as unknown as FileHandleLike;

    await writeToHandle(handle, '<!doctype html>');

    expect(write).toHaveBeenCalledWith('<!doctype html>');
    expect(close).toHaveBeenCalled();
  });
});

describe('ensureWritePermission', () => {
  it('treats a handle without permission methods as writable', async () => {
    const handle = { name: 'ops.html', createWritable: async () => ({ write: async () => {}, close: async () => {} }) };
    await expect(ensureWritePermission(handle as unknown as FileHandleLike)).resolves.toBe(true);
  });

  it('does not ask again when permission is already granted', async () => {
    const requestPermission = vi.fn(async () => 'granted' as PermissionState);
    const handle = {
      name: 'ops.html',
      createWritable: async () => ({ write: async () => {}, close: async () => {} }),
      queryPermission: async () => 'granted' as PermissionState,
      requestPermission,
    };

    await expect(ensureWritePermission(handle as unknown as FileHandleLike)).resolves.toBe(true);
    expect(requestPermission).not.toHaveBeenCalled();
  });

  it('reports false when permission is refused', async () => {
    const handle = {
      name: 'ops.html',
      createWritable: async () => ({ write: async () => {}, close: async () => {} }),
      queryPermission: async () => 'prompt' as PermissionState,
      requestPermission: async () => 'denied' as PermissionState,
    };

    await expect(ensureWritePermission(handle as unknown as FileHandleLike)).resolves.toBe(false);
  });
});
