/**
 * The single data-loading hook for live widgets.
 *
 * Every network-backed panel wants the same six things, and getting them subtly
 * different in each widget is how dashboards end up hammering a provider or
 * showing a dead panel: refresh on a window, cancel on unmount, ignore a reply
 * that arrived after the user changed the settings, keep the last good value when
 * a refresh fails, pause while the tab is hidden, and offer a manual refresh.
 *
 * `useResource` is that, once:
 *
 * - the loader is called with an `AbortSignal` tied to the component's lifetime;
 * - the refresh window comes from `useTimeBucket`, so two widgets asking for the
 *   same thing refresh together and {@link requestJson} can de-duplicate them;
 * - a hidden tab stops refreshing and catches up when it is shown again;
 * - `data` survives a failed refresh — the panel says what went wrong and keeps
 *   the last real numbers on screen rather than blanking.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { HttpError } from '@/lib/http';
import { isPending } from '@/lib/resourceStatus';
import { useTimeBucket } from './useNow';

/** What the loader hands back: the payload plus where it came from. */
export interface ResourcePayload<T> {
  data: T;
  /** `true` when the payload was served from a TTL cache instead of the network. */
  fromCache: boolean;
}

export interface UseResourceOptions<T> {
  /** Identifies the request. Changing it starts over and hides the old payload. */
  key: string;
  /** Loader. Receives a signal and whether the user asked for a forced refresh. */
  load: (signal: AbortSignal, options: { force: boolean }) => Promise<ResourcePayload<T>>;
  /** Refresh window in ms. Defaults to 15 minutes. */
  refreshMs?: number;
  /** Set `false` to hold the resource still (e.g. a settings field is empty). */
  enabled?: boolean;
}

export interface UseResourceResult<T> {
  /** Last good payload for the current key, or `null` before the first success. */
  data: T | null;
  /** Human readable failure of the most recent attempt, if any. */
  error: string | null;
  /** Machine readable failure code, for choosing an icon or a hint. */
  errorCode: HttpError['code'] | null;
  /** HTTP status of the failure when there was a response (401/403 mean "key required"). */
  errorStatus: number | null;
  /** `true` while there is nothing usable to show yet. */
  pending: boolean;
  /** `true` when the visible payload came from the TTL cache. */
  fromCache: boolean;
  /** Epoch ms of the last successful load for the current key. */
  lastUpdatedAt: number | null;
  /** Force a network refresh now, bypassing the cache. */
  refresh: () => void;
}

const DEFAULT_REFRESH_MS = 15 * 60 * 1000;

/** Document visibility as state, so a hidden tab can pause its refreshes. */
function useVisible(): boolean {
  const [visible, setVisible] = useState(
    () => typeof document === 'undefined' || document.visibilityState !== 'hidden',
  );

  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    const onChange = () => setVisible(document.visibilityState !== 'hidden');
    document.addEventListener('visibilitychange', onChange);
    return () => document.removeEventListener('visibilitychange', onChange);
  }, []);

  return visible;
}

function messageOf(error: unknown): string {
  if (error instanceof HttpError) return error.message;
  if (error instanceof Error && error.message !== '') return error.message;
  return 'The request failed.';
}

interface Snapshot<T> {
  key: string;
  data: T | null;
  error: string | null;
  errorCode: HttpError['code'] | null;
  errorStatus: number | null;
  fromCache: boolean;
  at: number | null;
}

const EMPTY: Snapshot<never> = {
  key: '',
  data: null,
  error: null,
  errorCode: null,
  errorStatus: null,
  fromCache: false,
  at: null,
};

export function useResource<T>(options: UseResourceOptions<T>): UseResourceResult<T> {
  const { key, load, refreshMs = DEFAULT_REFRESH_MS, enabled = true } = options;

  const [snapshot, setSnapshot] = useState<Snapshot<T>>(EMPTY as Snapshot<T>);
  const [attempt, setAttempt] = useState(0);
  const visible = useVisible();

  // Read the newest state inside the effect without making it a dependency.
  const snapshotRef = useRef(snapshot);
  useEffect(() => {
    snapshotRef.current = snapshot;
  }, [snapshot]);

  const loadRef = useRef(load);
  useEffect(() => {
    loadRef.current = load;
  }, [load]);

  /** Set by `refresh()`; consumed by the next effect run. */
  const forceRef = useRef(false);
  /** Guards against a slow reply overwriting a newer request's result. */
  const requestRef = useRef(0);

  const refresh = useCallback(() => {
    forceRef.current = true;
    setAttempt((value) => value + 1);
  }, []);

  const bucket = useTimeBucket(refreshMs, enabled, Math.min(refreshMs, 60_000));

  useEffect(() => {
    if (!enabled) return undefined;

    const current = snapshotRef.current;
    const at = current.key === key ? current.at : null;
    // A cache hit means there is nothing to do: leave the payload on screen.
    const fresh = at !== null && Date.now() - at < refreshMs;
    const forced = forceRef.current;
    if (!forced && fresh) return undefined;

    // A hidden tab does not poll. Showing it again re-runs this effect.
    if (!visible) return undefined;

    forceRef.current = false;
    const requestId = requestRef.current + 1;
    requestRef.current = requestId;
    const controller = new AbortController();

    loadRef.current(controller.signal, { force: forced })
      .then((result) => {
        if (controller.signal.aborted || requestRef.current !== requestId) return;
        setSnapshot({
          key,
          data: result.data,
          error: null,
          errorCode: null,
          errorStatus: null,
          fromCache: result.fromCache,
          at: Date.now(),
        });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted || requestRef.current !== requestId) return;
        const previous = snapshotRef.current;
        const sameKey = previous.key === key;
        setSnapshot({
          key,
          // Keep the last good payload: a failed refresh is not a reason to
          // throw away numbers the provider really did send.
          data: sameKey ? previous.data : null,
          error: messageOf(error),
          errorCode: error instanceof HttpError ? error.code : null,
          errorStatus: error instanceof HttpError ? error.status : null,
          fromCache: sameKey ? previous.fromCache : false,
          at: sameKey ? previous.at : null,
        });
      });

    return () => controller.abort();
  }, [key, bucket, attempt, enabled, visible, refreshMs]);

  const current = snapshot.key === key ? snapshot : null;

  return {
    data: current?.data ?? null,
    error: current?.error ?? null,
    errorCode: current?.errorCode ?? null,
    errorStatus: current?.errorStatus ?? null,
    pending: isPending(current, enabled),
    fromCache: current?.fromCache ?? false,
    lastUpdatedAt: current?.at ?? null,
    refresh,
  };
}
