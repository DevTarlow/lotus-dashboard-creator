import { useEffect, useRef } from 'react';

/**
 * `setInterval` that always calls the latest callback (no stale closures) and
 * restarts when `delay` changes. Pass `null` to pause the timer.
 */
export function useInterval(callback: () => void, delay: number | null): void {
  const callbackRef = useRef(callback);

  // Kept in sync after commit (never during render, which keeps render pure).
  useEffect(() => {
    callbackRef.current = callback;
  });

  useEffect(() => {
    if (delay === null) return undefined;
    const id = setInterval(() => callbackRef.current(), delay);
    return () => clearInterval(id);
  }, [delay]);
}
