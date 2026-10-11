import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearHttpCache,
  fetchJson,
  httpCacheSize,
  httpControl,
  HttpError,
  isCached,
  requestJson,
  resetHttp,
} from '@/lib/http';

/** Build a real `Response`, so header handling is exercised rather than imitated. */
function jsonResponse(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
  });
}

/** A request that only ever ends in an abort — the shape of a hung provider. */
function hangingResponse(_url: string, init: RequestInit): Promise<Response> {
  return new Promise((_resolve, reject) => {
    (init.signal as AbortSignal | undefined)?.addEventListener('abort', () =>
      reject(new DOMException('Aborted', 'AbortError')),
    );
  });
}

/** A mock that answers every call with a *fresh* response body. */
function respondWith(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}) {
  return vi.fn().mockImplementation(() => Promise.resolve(jsonResponse(body, init)));
}

/** A mock that behaves like the real thing: an already-aborted signal rejects. */
function respondUnlessAborted(body: unknown) {
  return vi.fn().mockImplementation((_url: string, init: RequestInit) => {
    const signal = init.signal as AbortSignal | undefined;
    if (signal?.aborted) return Promise.reject(new DOMException('Aborted', 'AbortError'));
    return Promise.resolve(jsonResponse(body));
  });
}

/** Let the queue and the microtask chain settle. */
function nextTick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

const originalConcurrency = httpControl.maxConcurrent;
const originalNow = httpControl.now;
const originalRandom = httpControl.random;

beforeEach(() => {
  resetHttp();
  httpControl.maxConcurrent = originalConcurrency;
  httpControl.now = originalNow;
  httpControl.random = () => 0;
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  resetHttp();
  httpControl.maxConcurrent = originalConcurrency;
  httpControl.now = originalNow;
  httpControl.random = originalRandom;
});

describe('fetchJson', () => {
  it('returns the payload together with the rate-limit header', async () => {
    const mock = respondWith({ ok: true }, { headers: { 'x-ratelimit-remaining': '57' } });
    vi.stubGlobal('fetch', mock);

    const response = await fetchJson<{ ok: boolean }>('https://example.test/one');

    expect(response.data).toEqual({ ok: true });
    expect(response.status).toBe(200);
    expect(response.rateLimitRemaining).toBe(57);
    expect(mock).toHaveBeenCalledTimes(1);
    expect(mock.mock.calls[0][1].headers.Accept).toBe('application/json');
  });

  it('reports a missing rate-limit header as null', async () => {
    vi.stubGlobal('fetch', respondWith({ ok: true }));
    await expect(fetchJson('https://example.test/one')).resolves.toMatchObject({ rateLimitRemaining: null });
  });

  it('maps status codes onto error codes', async () => {
    vi.stubGlobal('fetch', respondWith({}, { status: 429 }));
    await expect(fetchJson('https://example.test/limited', { retries: 0 })).rejects.toMatchObject({
      code: 'rate-limit',
      status: 429,
    });

    vi.stubGlobal('fetch', respondWith({}, { status: 404 }));
    await expect(fetchJson('https://example.test/missing', { retries: 0 })).rejects.toMatchObject({
      code: 'http',
      status: 404,
    });
  });

  it('raises a parse error for a body that is not JSON', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(new Response('<html>nope</html>', { status: 200 }))));
    await expect(fetchJson('https://example.test/html', { retries: 0 })).rejects.toBeInstanceOf(HttpError);
    await expect(fetchJson('https://example.test/html', { retries: 0 })).rejects.toMatchObject({ code: 'parse' });
  });

  it('turns a transport failure into a network error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await expect(fetchJson('https://example.test/down', { retries: 0 })).rejects.toMatchObject({ code: 'network' });
  });

  it('times out instead of hanging', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation(hangingResponse));
    await expect(fetchJson('https://example.test/slow', { timeoutMs: 20, retries: 0 })).rejects.toMatchObject({
      code: 'timeout',
    });
  });

  it('does not touch the network while the device is offline', async () => {
    const mock = respondWith({ ok: true });
    vi.stubGlobal('fetch', mock);
    vi.stubGlobal('navigator', { onLine: false });

    await expect(fetchJson('https://example.test/one', { retries: 0 })).rejects.toMatchObject({ code: 'network' });
    expect(mock).not.toHaveBeenCalled();
  });

  it('retries once after a 5xx response and then succeeds', async () => {
    const mock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({}, { status: 503 }))
      .mockImplementationOnce(() => Promise.resolve(jsonResponse({ ok: true })));
    vi.stubGlobal('fetch', mock);

    await expect(fetchJson('https://example.test/flaky')).resolves.toMatchObject({ data: { ok: true } });
    expect(mock).toHaveBeenCalledTimes(2);
  });

  it('does not retry a 404', async () => {
    const mock = respondWith({}, { status: 404 });
    vi.stubGlobal('fetch', mock);

    await expect(fetchJson('https://example.test/missing')).rejects.toMatchObject({ code: 'http' });
    expect(mock).toHaveBeenCalledTimes(1);
  });
});

describe('requestJson', () => {
  it('shares one request between callers asking for the same key', async () => {
    const mock = respondWith({ value: 42 });
    vi.stubGlobal('fetch', mock);

    const [a, b] = await Promise.all([
      requestJson<{ value: number }>('air:52,13', 'https://example.test/air'),
      requestJson<{ value: number }>('air:52,13', 'https://example.test/air'),
    ]);

    expect(mock).toHaveBeenCalledTimes(1);
    expect(a.data).toEqual({ value: 42 });
    expect(b.data).toEqual({ value: 42 });
    expect(a.fromCache).toBe(false);
  });

  it('serves a second call from the cache until the window expires', async () => {
    const mock = respondWith({ value: 1 });
    vi.stubGlobal('fetch', mock);

    let clock = 1_000;
    httpControl.now = () => clock;

    await requestJson('air:52,13', 'https://example.test/air', { ttlMs: 1000 });
    clock += 500;
    const cached = await requestJson<{ value: number }>('air:52,13', 'https://example.test/air', { ttlMs: 1000 });

    expect(mock).toHaveBeenCalledTimes(1);
    expect(cached.fromCache).toBe(true);
    expect(isCached('air:52,13', 1000)).toBe(true);

    clock += 600;
    await requestJson('air:52,13', 'https://example.test/air', { ttlMs: 1000 });
    expect(mock).toHaveBeenCalledTimes(2);
  });

  it('ignores the cache when forced, but still joins an in-flight request', async () => {
    const mock = respondWith({ value: 1 });
    vi.stubGlobal('fetch', mock);

    await requestJson('air:52,13', 'https://example.test/air');
    await requestJson('air:52,13', 'https://example.test/air', { force: true });
    expect(mock).toHaveBeenCalledTimes(2);

    const pending = requestJson('air:52,13', 'https://example.test/air');
    const joined = requestJson('air:52,13', 'https://example.test/air', { force: true });
    await Promise.all([pending, joined]);
    expect(mock).toHaveBeenCalledTimes(3);
  });

  it('never caches a failure', async () => {
    const mock = respondWith({}, { status: 404 });
    vi.stubGlobal('fetch', mock);

    await expect(requestJson('repo:a/b', 'https://example.test/repo', { retries: 0 })).rejects.toMatchObject({
      code: 'http',
    });
    expect(httpCacheSize()).toBe(0);

    mock.mockImplementation(() => Promise.resolve(jsonResponse({ ok: true })));
    await expect(requestJson('repo:a/b', 'https://example.test/repo', { retries: 0 })).resolves.toMatchObject({
      data: { ok: true },
    });
  });

  it('rejects only the caller that aborted, and lets the other finish', async () => {
    let resolveFetch: (response: Response) => void = () => {};
    const mock = vi.fn().mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        }),
    );
    vi.stubGlobal('fetch', mock);

    const controller = new AbortController();
    const aborted = requestJson('shared:1', 'https://example.test/shared', { signal: controller.signal });
    const survivor = requestJson<{ value: number }>('shared:1', 'https://example.test/shared');

    controller.abort();
    await expect(aborted).rejects.toMatchObject({ code: 'aborted' });
    expect(mock).toHaveBeenCalledTimes(1);

    resolveFetch(jsonResponse({ value: 7 }));
    await expect(survivor).resolves.toMatchObject({ data: { value: 7 } });
  });

  it('cancels the network work once the last caller leaves', async () => {
    const controllers: AbortSignal[] = [];
    const mock = vi.fn().mockImplementation((_url: string, init: RequestInit) => {
      controllers.push(init.signal as AbortSignal);
      return hangingResponse(_url, init);
    });
    vi.stubGlobal('fetch', mock);

    const a = new AbortController();
    const b = new AbortController();
    const first = requestJson('shared:2', 'https://example.test/shared', { signal: a.signal, retries: 0 });
    const second = requestJson('shared:2', 'https://example.test/shared', { signal: b.signal, retries: 0 });

    a.abort();
    await expect(first).rejects.toMatchObject({ code: 'aborted' });
    expect(controllers[0].aborted).toBe(false);

    b.abort();
    await expect(second).rejects.toMatchObject({ code: 'aborted' });
    expect(controllers[0].aborted).toBe(true);
  });

  it('starts a fresh request after the previous one was abandoned', async () => {
    const mock = respondUnlessAborted({ value: 1 });
    vi.stubGlobal('fetch', mock);

    // React's development StrictMode mounts, unmounts and mounts again: the
    // first caller abandons the request and the second must not inherit it.
    const first = new AbortController();
    const abandoned = requestJson('air:1', 'https://example.test/air', { signal: first.signal, retries: 0 });
    first.abort();
    await expect(abandoned).rejects.toMatchObject({ code: 'aborted' });

    const second = await requestJson<{ value: number }>('air:1', 'https://example.test/air', { retries: 0 });
    expect(second.data).toEqual({ value: 1 });
    expect(mock).toHaveBeenCalledTimes(2);
  });

  it('does not let a new caller join an abandoned request', async () => {
    let calls = 0;
    // The first request hangs until it is aborted (a real provider that never
    // answers); the replacement answers normally.
    const mock = vi.fn().mockImplementation((url: string, init: RequestInit) => {
      calls += 1;
      return calls === 1 ? hangingResponse(url, init) : Promise.resolve(jsonResponse({ value: 2 }));
    });
    vi.stubGlobal('fetch', mock);

    const controller = new AbortController();
    const abandoned = requestJson('air:2', 'https://example.test/air', { signal: controller.signal, retries: 0 });
    controller.abort();
    await expect(abandoned).rejects.toMatchObject({ code: 'aborted' });

    // The abandoned request is un-registered the moment it is abandoned, so this
    // caller asks for itself instead of inheriting a failure it never caused.
    const fresh = requestJson<{ value: number }>('air:2', 'https://example.test/air', { retries: 0 });
    await nextTick();
    expect(mock).toHaveBeenCalledTimes(2);
    await expect(fresh).resolves.toMatchObject({ data: { value: 2 } });
  });

  it('rejects immediately when handed an already aborted signal', async () => {
    const mock = respondWith({ ok: true });
    vi.stubGlobal('fetch', mock);
    const controller = new AbortController();
    controller.abort();

    await expect(
      requestJson('air:52,13', 'https://example.test/air', { signal: controller.signal }),
    ).rejects.toMatchObject({ code: 'aborted' });
    expect(mock).not.toHaveBeenCalled();
  });

  it('caps how many requests are open at once', async () => {
    httpControl.maxConcurrent = 2;
    let open = 0;
    let peak = 0;
    const resolvers: Array<() => void> = [];

    const mock = vi.fn().mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          open += 1;
          peak = Math.max(peak, open);
          resolvers.push(() => {
            open -= 1;
            resolve(jsonResponse({ ok: true }));
          });
        }),
    );
    vi.stubGlobal('fetch', mock);

    const calls = ['a', 'b', 'c'].map((id) =>
      requestJson(`key:${id}`, `https://example.test/${id}`, { ttlMs: 0 }),
    );
    await nextTick();
    expect(mock).toHaveBeenCalledTimes(2);

    resolvers.shift()?.();
    await nextTick();
    expect(mock).toHaveBeenCalledTimes(3);

    while (resolvers.length > 0) resolvers.shift()?.();
    await Promise.all(calls);
    expect(peak).toBe(2);
  });

  it('clears cached payloads on demand', async () => {
    const mock = respondWith({ value: 1 });
    vi.stubGlobal('fetch', mock);

    await requestJson('air:52,13', 'https://example.test/air');
    expect(httpCacheSize()).toBe(1);
    clearHttpCache();
    expect(httpCacheSize()).toBe(0);

    await requestJson('air:52,13', 'https://example.test/air');
    expect(mock).toHaveBeenCalledTimes(2);
  });
});
