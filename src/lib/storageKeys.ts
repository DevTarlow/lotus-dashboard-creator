/**
 * Storage key resolution.
 *
 * `localStorage` is partitioned per *origin*. On the web that origin is the
 * site, but every `file://` document shares the single origin `file://` — so two
 * different dashboard files opened from disk would otherwise read and overwrite
 * each other's saved state.
 *
 * When the app is opened from disk we therefore suffix the keys with the
 * document path. That is safe to do because a single-file dashboard carries its
 * own state inside the HTML (see `embedded.ts`); the browser copy is only a
 * cache, so renaming the file loses nothing permanent.
 *
 * The inline theme script in `index.html` computes the same suffix before the
 * bundle loads, to avoid a flash of the wrong colour scheme. Keep the two in
 * step — `storageKeys.test.ts` pins this behaviour.
 */
import { STORAGE_KEYS } from '@/constants/app';

/** The tiny slice of `Location` this module needs, so tests can supply one. */
export interface LocationLike {
  protocol: string;
  pathname: string;
}

function currentLocation(): LocationLike | undefined {
  return (globalThis as { location?: LocationLike }).location;
}

/**
 * `':/path/to/dashboard.html'` when the page was opened from disk, `''` on the
 * web (and in non-browser contexts such as the unit tests).
 */
export function storageScope(location: LocationLike | undefined = currentLocation()): string {
  if (!location || location.protocol !== 'file:') return '';
  return `:${location.pathname}`;
}

/** Suffix a base key with the current document scope. */
export function scopedStorageKey(base: string, location: LocationLike | undefined = currentLocation()): string {
  return `${base}${storageScope(location)}`;
}

/** Key the dashboard workspace is persisted under. */
export function workspaceStorageKey(location?: LocationLike): string {
  return scopedStorageKey(STORAGE_KEYS.workspace, location);
}

/** Key UI preferences are persisted under. */
export function prefsStorageKey(location?: LocationLike): string {
  return scopedStorageKey(STORAGE_KEYS.prefs, location);
}
