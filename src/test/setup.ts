/**
 * Vitest setup.
 *
 * The store layer persists through `localStorage`; the test environment is plain
 * Node, so a tiny in-memory `Storage` implementation is installed before any
 * module reads it.
 */

class MemoryStorage implements Storage {
  private store = new Map<string, string>();

  get length(): number {
    return this.store.size;
  }

  clear(): void {
    this.store.clear();
  }

  getItem(key: string): string | null {
    return this.store.has(key) ? (this.store.get(key) as string) : null;
  }

  key(index: number): string | null {
    return Array.from(this.store.keys())[index] ?? null;
  }

  removeItem(key: string): void {
    this.store.delete(key);
  }

  setItem(key: string, value: string): void {
    this.store.set(key, String(value));
  }
}

function storageWorks(candidate: Storage | undefined): boolean {
  if (!candidate) return false;
  try {
    const probe = '__lotus_test_probe__';
    candidate.setItem(probe, '1');
    candidate.removeItem(probe);
    return true;
  } catch {
    return false;
  }
}

const existing = (globalThis as { localStorage?: Storage }).localStorage;

if (!storageWorks(existing)) {
  Object.defineProperty(globalThis, 'localStorage', {
    value: new MemoryStorage(),
    configurable: true,
    writable: true,
  });
}
