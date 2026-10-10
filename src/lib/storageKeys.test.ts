import { describe, expect, it } from 'vitest';
import { STORAGE_KEYS } from '@/constants/app';
import { prefsStorageKey, scopedStorageKey, storageScope, workspaceStorageKey } from '@/lib/storageKeys';

const WEB = { protocol: 'https:', pathname: '/' };
const LOCALHOST = { protocol: 'http:', pathname: '/dashboard/' };
const DISK = { protocol: 'file:', pathname: '/home/me/dashboards/ops.html' };

describe('storageScope', () => {
  it('adds no suffix on the web, where the origin already separates apps', () => {
    expect(storageScope(WEB)).toBe('');
    expect(storageScope(LOCALHOST)).toBe('');
  });

  it('scopes by path when the page was opened from disk', () => {
    // Every file:// document shares one origin, so the path is the only thing
    // that separates two different dashboard files.
    expect(storageScope(DISK)).toBe(':/home/me/dashboards/ops.html');
  });

  it('gives different files different scopes but the same file a stable one', () => {
    const other = { protocol: 'file:', pathname: '/home/me/dashboards/personal.html' };
    expect(storageScope(DISK)).not.toBe(storageScope(other));
    expect(storageScope(DISK)).toBe(storageScope({ ...DISK }));
  });

  it('returns no scope when there is no location at all (tests, SSR)', () => {
    expect(storageScope(undefined)).toBe('');
  });
});

describe('scopedStorageKey', () => {
  it('leaves the base keys untouched on the web', () => {
    expect(scopedStorageKey(STORAGE_KEYS.workspace, WEB)).toBe(STORAGE_KEYS.workspace);
    expect(workspaceStorageKey(WEB)).toBe('lotus-dashboard-creator:workspace/v1');
    expect(prefsStorageKey(WEB)).toBe('lotus-dashboard-creator:prefs/v1');
  });

  it('suffixes both keys with the document path on disk', () => {
    expect(workspaceStorageKey(DISK)).toBe('lotus-dashboard-creator:workspace/v1:/home/me/dashboards/ops.html');
    expect(prefsStorageKey(DISK)).toBe('lotus-dashboard-creator:prefs/v1:/home/me/dashboards/ops.html');
  });

  it('matches the expression the inline theme script in index.html uses', () => {
    // The script builds `'lotus-dashboard-creator:prefs/v1' + ':' + location.pathname`.
    // If these ever diverge the theme flashes on a file:// load.
    expect(prefsStorageKey(DISK)).toBe(`${STORAGE_KEYS.prefs}:${DISK.pathname}`);
  });
});
