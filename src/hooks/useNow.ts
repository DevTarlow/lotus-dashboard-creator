import { useEffect, useState } from 'react';
import { useInterval } from './useInterval';

/**
 * Ticking clock hook. The interval is aligned to the next `interval` boundary so
 * countdowns and clocks update without drift.
 *
 * @param interval tick length in milliseconds.
 * @param enabled pause the ticker (e.g. when a widget is hidden).
 */
export function useNow(interval = 1000, enabled = true): Date {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    if (!enabled) return undefined;
    let timeout: ReturnType<typeof setTimeout>;
    let cancelled = false;

    const schedule = () => {
      const delay = interval - (Date.now() % interval);
      timeout = setTimeout(() => {
        if (cancelled) return;
        setNow(new Date());
        schedule();
      }, delay);
    };

    schedule();
    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
  }, [interval, enabled]);

  return now;
}

/**
 * Monotonically increasing bucket counter — data providers use it as a cheap
 * "refresh key" so they only recompute when their window rolls over, and live
 * providers use it to trigger exactly one request per window.
 *
 * `bucketMs` is expected to be a constant for the lifetime of the component.
 * `tickMs` caps how often the counter is polled; the default of 5s suits short
 * windows, while a longer window should pass its own length so a minute-long
 * window does not tick every 5 seconds for nothing.
 */
export function useTimeBucket(bucketMs: number, enabled = true, tickMs = 5000): number {
  const [bucket, setBucket] = useState(() => Math.floor(Date.now() / bucketMs));

  useInterval(
    () => setBucket(Math.floor(Date.now() / bucketMs)),
    enabled && bucketMs > 0 ? Math.max(1000, Math.min(bucketMs, tickMs)) : null,
  );

  return bucket;
}
