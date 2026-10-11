/**
 * The shared HTTP layer for every live widget.
 *
 * A dashboard can hold a dozen panels that all want a quote, a forecast or a
 * feed, and several of them may want the *same* one. This module makes that
 * cheap and polite:
 *
 * - **De-duplication** — identical requests in flight at the same time share a
 *   single `fetch`, so two "Air quality" cards for Lisbon ask Open-Meteo once.
 *   A shared request is cancelled only when the last interested caller goes away.
 * - **TTL cache** — a successful payload is reused for its window, so a refresh
 *   that lands too early does not touch the network at all.
 * - **A concurrency cap** — at most {@link httpControl.maxConcurrent} requests
 *   are open at any moment; the rest queue. A cold sixteen-widget dashboard
 *   therefore starts as a queue instead of a stampede.
 * - **One error vocabulary** — every failure is an {@link HttpError} with a code
 *   the widgets can explain ("offline", "timed out", "rate limited"), never a
 *   raw `TypeError` from the platform.
 *
 * Nothing here is React-aware: `useResource` is the hook that drives it.
 */

export type HttpErrorCode = 'network' | 'timeout' | 'http' | 'rate-limit' | 'parse' | 'aborted';

/** Every failure raised by this module. */
export class HttpError extends Error {
  readonly code: HttpErrorCode;
  /** HTTP status when there was a response, else `null`. */
  readonly status: number | null;

  constructor(message: string, code: HttpErrorCode, status: number | null = null) {
    super(message);
    this.name = 'HttpError';
    this.code = code;
    this.status = status;
  }
}

/** Default per-request timeout. */
export const DEFAULT_TIMEOUT_MS = 10_000;

/** Default cache window for a provider response. */
export const DEFAULT_TTL_MS = 15 * 60 * 1000;

/**
 * Tunable knobs. Exposed as an object rather than module-level constants so the
 * unit tests can drive the clock and shrink the queue without fake timers.
 */
export const httpControl = {
  /** Requests allowed to be open at once. */
  maxConcurrent: 4,
  /** Clock used for cache expiry. */
  now: (): number => Date.now(),
  /** Random source for the retry backoff, so tests can make it deterministic. */
  random: (): number => Math.random(),
};

/* --------------------------------------------------------------- the queue */

let activeRequests = 0;
const waiters: Array<() => void> = [];

/** Take a queue slot; the returned function releases it exactly once. */
function acquireSlot(): Promise<() => void> {
  return new Promise((resolve) => {
    const grant = () => {
      let released = false;
      resolve(() => {
        if (released) return;
        released = true;
        activeRequests -= 1;
        const next = waiters.shift();
        if (next) next();
      });
    };

    if (activeRequests < httpControl.maxConcurrent) {
      activeRequests += 1;
      grant();
      return;
    }
    // The slot is handed over, so it is accounted for before the wake-up.
    waiters.push(() => {
      activeRequests += 1;
      grant();
    });
  });
}

/* -------------------------------------------------------------- primitives */

function linkSignals(
  parent: AbortSignal | undefined,
  timeoutMs: number,
): { signal: AbortSignal; timedOut: () => boolean; cleanup: () => void } {
  const controller = new AbortController();
  let timedOut = false;

  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  const onAbort = () => controller.abort();
  if (parent) {
    if (parent.aborted) controller.abort();
    else parent.addEventListener('abort', onAbort, { once: true });
  }

  return {
    signal: controller.signal,
    timedOut: () => timedOut,
    cleanup: () => {
      clearTimeout(timer);
      parent?.removeEventListener('abort', onAbort);
    },
  };
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new HttpError('Request aborted.', 'aborted'));
    };
    if (signal) {
      if (signal.aborted) onAbort();
      else signal.addEventListener('abort', onAbort, { once: true });
    }
  });
}

function isOffline(): boolean {
  const online = (globalThis as { navigator?: { onLine?: boolean } }).navigator?.onLine;
  return online === false;
}

function messageFor(error: unknown): string {
  return error instanceof Error ? error.message : 'The request failed.';
}

/* ---------------------------------------------------------------- fetchJson */

export interface FetchJsonOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  /** Extra headers merged over the default `Accept: application/json`. */
  headers?: Record<string, string>;
  /** Extra attempts after a 429 or a 5xx response. Default `1`. */
  retries?: number;
}

export interface JsonResponse<T> {
  data: T;
  status: number;
  /** `x-ratelimit-remaining` when the provider sends one, else `null`. */
  rateLimitRemaining: number | null;
}

function readRateLimit(headers: Headers): number | null {
  const raw = headers.get('x-ratelimit-remaining');
  if (raw === null) return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

async function attemptFetch<T>(url: string, options: FetchJsonOptions): Promise<JsonResponse<T>> {
  if (isOffline()) throw new HttpError('This device is offline.', 'network');

  const release = await acquireSlot();
  const linked = linkSignals(options.signal, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);

  try {
    let response: Response;
    try {
      response = await fetch(url, {
        method: 'GET',
        headers: { Accept: 'application/json', ...(options.headers ?? {}) },
        signal: linked.signal,
      });
    } catch (error) {
      if (linked.timedOut()) throw new HttpError('The request timed out.', 'timeout');
      if (options.signal?.aborted) throw new HttpError('Request aborted.', 'aborted');
      throw new HttpError(messageFor(error), 'network');
    }

    if (!response.ok) {
      const status = response.status;
      if (status === 429) throw new HttpError('The provider rate limited this request.', 'rate-limit', status);
      throw new HttpError(`The provider answered ${status}.`, 'http', status);
    }

    try {
      const data = (await response.json()) as T;
      return { data, status: response.status, rateLimitRemaining: readRateLimit(response.headers) };
    } catch {
      throw new HttpError('The provider sent a payload that could not be read.', 'parse');
    }
  } finally {
    linked.cleanup();
    release();
  }
}

/**
 * Fetch JSON once, with a timeout, a typed error and one retry on a 429/5xx.
 * Use {@link requestJson} when the response may be shared between widgets.
 */
export async function fetchJson<T>(url: string, options: FetchJsonOptions = {}): Promise<JsonResponse<T>> {
  const retries = options.retries ?? 1;

  for (let attempt = 0; ; attempt += 1) {
    try {
      return await attemptFetch<T>(url, options);
    } catch (error) {
      const retryable =
        error instanceof HttpError &&
        (error.code === 'rate-limit' || (error.code === 'http' && (error.status ?? 0) >= 500));
      if (!retryable || attempt >= retries || options.signal?.aborted) throw error;
      await delay(200 + httpControl.random() * 300, options.signal);
    }
  }
}

/* -------------------------------------------------------------- requestJson */

export interface RequestJsonOptions extends FetchJsonOptions {
  /** Cache lifetime in ms; `0` disables caching for this request. */
  ttlMs?: number;
  /** Ignore a fresh cache entry (a manual refresh still joins an in-flight one). */
  force?: boolean;
}

export interface CachedJson<T> {
  data: T;
  /** `true` when the payload came from the cache instead of the network. */
  fromCache: boolean;
  rateLimitRemaining: number | null;
}

interface CacheEntry {
  at: number;
  value: unknown;
  rateLimitRemaining: number | null;
}

interface SharedRequest {
  /** The cache key this request was started for. */
  key: string;
  controller: AbortController;
  /** Live joiners; the request is cancelled when the last one leaves. */
  refs: number;
  settled: boolean;
  promise: Promise<CachedJson<unknown>>;
}

const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, SharedRequest>();

async function runRequest(
  key: string,
  url: string,
  options: RequestJsonOptions,
  controller: AbortController,
  ttlMs: number,
): Promise<CachedJson<unknown>> {
  try {
    const response = await fetchJson<unknown>(url, {
      signal: controller.signal,
      timeoutMs: options.timeoutMs,
      headers: options.headers,
    });
    if (ttlMs > 0) {
      cache.set(key, {
        at: httpControl.now(),
        value: response.data,
        rateLimitRemaining: response.rateLimitRemaining,
      });
    }
    return { data: response.data, fromCache: false, rateLimitRemaining: response.rateLimitRemaining };
  } finally {
    inflight.delete(key);
  }
}

/**
 * Resolve with the shared request, or reject as soon as *this* caller aborts.
 *
 * When the last joiner leaves, the request is abandoned **and un-registered
 * immediately**. Waiting for the fetch to reject would leave a doomed entry in
 * `inflight`, and the next caller — in React's development StrictMode, that is
 * the same component remounting a moment later — would join a request that is
 * already aborted and inherit its failure instead of asking again.
 */
function joinRequest<T>(shared: SharedRequest, signal?: AbortSignal): Promise<CachedJson<T>> {
  return new Promise<CachedJson<T>>((resolve, reject) => {
    let done = false;

    const settle = (fn: () => void) => {
      if (done) return;
      done = true;
      signal?.removeEventListener('abort', onAbort);
      shared.refs -= 1;
      fn();
    };

    function onAbort() {
      if (done) return;
      done = true;
      shared.refs -= 1;
      // Nobody is waiting any more: stop the network work as well.
      if (shared.refs <= 0 && !shared.settled) {
        shared.controller.abort();
        if (inflight.get(shared.key) === shared) inflight.delete(shared.key);
      }
      reject(new HttpError('Request aborted.', 'aborted'));
    }

    if (signal) {
      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener('abort', onAbort, { once: true });
    }

    shared.promise.then(
      (value) => settle(() => resolve(value as CachedJson<T>)),
      (error: unknown) => settle(() => reject(error)),
    );
  });
}

/**
 * Fetch JSON through the shared cache.
 *
 * `key` identifies the resource, not the widget: pass the provider and its
 * parameters (`open-meteo-air:52.52,13.41`) so two widgets watching the same
 * thing share one request. When the caller aborts, the cache is untouched and
 * other joiners keep their request.
 */
export function requestJson<T>(key: string, url: string, options: RequestJsonOptions = {}): Promise<CachedJson<T>> {
  if (options.signal?.aborted) return Promise.reject(new HttpError('Request aborted.', 'aborted'));

  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  const now = httpControl.now();
  const cached = cache.get(key);
  if (!options.force && ttlMs > 0 && cached && now - cached.at < ttlMs) {
    return Promise.resolve({
      data: cached.value as T,
      fromCache: true,
      rateLimitRemaining: cached.rateLimitRemaining,
    });
  }

  let shared = inflight.get(key);
  // A request whose controller is already aborted can never succeed, so it is
  // not joined — the caller starts a fresh one instead.
  if (shared && shared.controller.signal.aborted) {
    inflight.delete(key);
    shared = undefined;
  }
  if (!shared) {
    const controller = new AbortController();
    const created: SharedRequest = {
      key,
      controller,
      refs: 0,
      settled: false,
      promise: runRequest(key, url, options, controller, ttlMs),
    };
    // Marked settled outside `joinRequest` so a late rejection is still handled.
    void created.promise.then(
      () => {
        created.settled = true;
      },
      () => {
        created.settled = true;
      },
    );
    inflight.set(key, created);
    shared = created;
  }

  shared.refs += 1;
  return joinRequest<T>(shared, options.signal);
}

/** `true` when a payload for `key` is still fresh. */
export function isCached(key: string, ttlMs: number = DEFAULT_TTL_MS): boolean {
  const entry = cache.get(key);
  return entry !== undefined && ttlMs > 0 && httpControl.now() - entry.at < ttlMs;
}

/** Number of cached payloads (used by tests). */
export function httpCacheSize(): number {
  return cache.size;
}

/** Drop every cached payload. Requests in flight are left alone. */
export function clearHttpCache(): void {
  cache.clear();
}

/** Full reset for tests: cache, queue bookkeeping and the clock. */
export function resetHttp(): void {
  cache.clear();
  inflight.clear();
  waiters.length = 0;
  activeRequests = 0;
}
