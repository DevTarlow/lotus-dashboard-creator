import { useCallback, useEffect, useRef } from 'react';

export interface DebouncedCallback<A extends unknown[]> {
  /** Schedule the call, replacing any pending invocation. */
  run: (...args: A) => void;
  /** Invoke the pending call immediately (if any). */
  flush: () => void;
  /** Drop the pending call. */
  cancel: () => void;
}

/**
 * Debounced callback that always sees the latest closure, flushes on unmount and
 * can be flushed manually (used by the notes widget to save before closing).
 */
export function useDebouncedCallback<A extends unknown[]>(
  callback: (...args: A) => void,
  delay = 300,
): DebouncedCallback<A> {
  const callbackRef = useRef(callback);

  // Updated after commit so render stays pure and scheduled calls always use the
  // latest closure.
  useEffect(() => {
    callbackRef.current = callback;
  });

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRef = useRef<A | null>(null);

  const clear = () => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const flush = useCallback(() => {
    clear();
    const args = pendingRef.current;
    pendingRef.current = null;
    if (args) callbackRef.current(...args);
  }, []);

  const cancel = useCallback(() => {
    clear();
    pendingRef.current = null;
  }, []);

  const run = useCallback(
    (...args: A) => {
      pendingRef.current = args;
      clear();
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        const pending = pendingRef.current;
        pendingRef.current = null;
        if (pending) callbackRef.current(...pending);
      }, delay);
    },
    [delay],
  );

  // Never lose the user's last keystrokes when the widget unmounts.
  useEffect(() => flush, [flush]);

  return { run, flush, cancel };
}
