/**
 * Storage adapter.
 *
 * `localStorage` can throw (private browsing, quota exceeded, disabled storage)
 * and is missing entirely in non-browser contexts (unit tests, SSR). Every read
 * and write therefore goes through this module, which degrades to an in-memory
 * map instead of crashing the app.
 */
import type { StateStorage } from 'zustand/middleware';

export interface StorageLike {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
}

/** Minimal in-memory fallback. */
export function createMemoryStorage(): StorageLike {
  const map = new Map<string, string>();
  return {
    getItem: (key) => (map.has(key) ? (map.get(key) as string) : null),
    setItem: (key, value) => {
      map.set(key, value);
    },
    removeItem: (key) => {
      map.delete(key);
    },
  };
}

function detectStorage(): StorageLike {
  try {
    const probe = '__lotus_probe__';
    const storage = globalThis.localStorage;
    if (!storage) return createMemoryStorage();
    storage.setItem(probe, '1');
    storage.removeItem(probe);
    return storage;
  } catch {
    return createMemoryStorage();
  }
}

/** The storage implementation used by every persisted store. */
export const appStorage: StorageLike = detectStorage();

/** `true` when writes are actually persisted to `localStorage`. */
export function isPersistentStorage(): boolean {
  return typeof globalThis.localStorage !== 'undefined' && appStorage === globalThis.localStorage;
}

/**
 * Zustand-compatible storage built on top of {@link appStorage}. Writes are
 * wrapped in a try/catch so a quota error can never break an interaction.
 */
export const zustandStorage: StateStorage = {
  getItem: (name) => {
    try {
      return appStorage.getItem(name);
    } catch {
      return null;
    }
  },
  setItem: (name, value) => {
    try {
      appStorage.setItem(name, value);
    } catch {
      // Quota exceeded or storage disabled — the in-memory state still works.
    }
  },
  removeItem: (name) => {
    try {
      appStorage.removeItem(name);
    } catch {
      // Ignore.
    }
  },
};
