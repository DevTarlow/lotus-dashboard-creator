import { useCallback, useSyncExternalStore } from 'react';

const NOOP_UNSUBSCRIBE = () => {};

/**
 * Subscribe to a CSS media query.
 *
 * Uses `useSyncExternalStore`, which is exactly what this is: an external store
 * that React should read from without any state mirroring effects.
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      if (typeof window === 'undefined' || !window.matchMedia) return NOOP_UNSUBSCRIBE;
      const list = window.matchMedia(query);
      list.addEventListener('change', onStoreChange);
      return () => list.removeEventListener('change', onStoreChange);
    },
    [query],
  );

  const getSnapshot = useCallback(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false;
    return window.matchMedia(query).matches;
  }, [query]);

  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}

/** `true` when the operating system asks for a dark colour scheme. */
export function usePrefersDark(): boolean {
  return useMediaQuery('(prefers-color-scheme: dark)');
}
