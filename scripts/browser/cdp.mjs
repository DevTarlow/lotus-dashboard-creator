/**
 * A tiny Chrome DevTools Protocol client — no `puppeteer`, no `playwright`.
 *
 * The unit suite runs in plain Node with no DOM, so anything that touches real
 * DOM APIs (`capturePageHtml` above all) cannot be covered by it. These helpers
 * drive a real browser instead, and they are deliberately dependency-free so the
 * repository keeps its "no runtime or test dependencies we do not need" posture.
 *
 * Chrome is launched with `--remote-debugging-port=0`, so the OS picks a free
 * port and we read it from Chrome's own stderr. That avoids both hard-coded ports
 * and collisions with a dev server the user already has running.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline';

const BINARY_CANDIDATES = [
  'google-chrome',
  'google-chrome-stable',
  'chromium',
  'chromium-browser',
  'chrome',
  'msedge',
  '/opt/google/chrome/chrome',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
];

/** Look up an executable on `PATH` without shelling out. */
function which(name, env) {
  for (const dir of (env.PATH ?? '').split(path.delimiter).filter(Boolean)) {
    const candidate = path.join(dir, name);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/** Path to a Chromium-based browser, or `null`. `CHROME_PATH` wins. */
export function findChrome(env = process.env) {
  if (env.CHROME_PATH) return existsSync(env.CHROME_PATH) ? env.CHROME_PATH : null;
  for (const candidate of BINARY_CANDIDATES) {
    if (candidate.startsWith('/')) {
      if (existsSync(candidate)) return candidate;
      continue;
    }
    const found = which(candidate, env);
    if (found) return found;
  }
  return null;
}

export const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Start a headless browser and return its DevTools port plus a `close()`.
 *
 * The profile lives in a fresh temp directory, so every run starts from an empty
 * `localStorage` and cannot pick up state from the developer's own browsing.
 */
export async function launchChrome({ env = process.env, extraArgs = [] } = {}) {
  const binary = findChrome(env);
  if (!binary) {
    throw new Error(
      'No Chrome or Chromium found. Install one, or point CHROME_PATH at the executable.',
    );
  }

  const profile = await mkdtemp(path.join(os.tmpdir(), 'lotus-browser-check-'));
  const child = spawn(
    binary,
    [
      '--headless=new',
      '--no-sandbox',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      '--disable-extensions',
      '--no-first-run',
      '--no-default-browser-check',
      '--remote-debugging-port=0',
      `--user-data-dir=${profile}`,
      ...extraArgs,
      'about:blank',
    ],
    { stdio: ['ignore', 'ignore', 'pipe'] },
  );

  const port = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error('Chrome did not report a DevTools port within 20s'));
    }, 20_000);
    createInterface({ input: child.stderr }).on('line', (line) => {
      const match = /DevTools listening on ws:\/\/[^:]+:(\d+)\//.exec(line);
      if (!match) return;
      clearTimeout(timer);
      resolve(Number(match[1]));
    });
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`Chrome exited before becoming ready (code ${code})`));
    });
  });

  return {
    binary,
    port,
    async close() {
      child.kill('SIGTERM');
      await wait(300);
      if (child.exitCode === null) child.kill('SIGKILL');
      await rm(profile, { recursive: true, force: true }).catch(() => {});
    },
  };
}

/**
 * One CDP connection to a single page target.
 *
 * `waitFor` resolves a one-shot promise for an event; `on` registers a listener
 * that stays for the life of the session.
 */
export class Session {
  constructor(ws) {
    this.ws = ws;
    this.seq = 0;
    this.pending = new Map();
    this.waiters = new Map();
    this.listeners = new Map();
    ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      if (message.id && this.pending.has(message.id)) {
        const { resolve, reject } = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) reject(new Error(JSON.stringify(message.error)));
        else resolve(message.result);
      } else if (message.method) {
        for (const listener of this.listeners.get(message.method) ?? []) listener(message.params);
        if (this.waiters.has(message.method)) {
          const pending = this.waiters.get(message.method);
          this.waiters.delete(message.method);
          for (const resolve of pending) resolve(message.params);
        }
      }
    };
  }

  send(method, params = {}) {
    const id = ++this.seq;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  /** Resolve with the params of the next `method` event. */
  waitFor(method) {
    return new Promise((resolve) => {
      const pending = this.waiters.get(method) ?? [];
      pending.push(resolve);
      this.waiters.set(method, pending);
    });
  }

  /** Subscribe to an event for the lifetime of the session. */
  on(method, listener) {
    const listeners = this.listeners.get(method) ?? [];
    listeners.push(listener);
    this.listeners.set(method, listeners);
  }

  async evaluate(expression) {
    const result = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description ?? 'evaluate failed');
    }
    return result.result.value;
  }

  async navigate(url) {
    const loaded = this.waitFor('Page.loadEventFired');
    await this.send('Page.navigate', { url });
    await loaded;
    await wait(1000);
  }

  close() {
    this.ws.close();
  }
}

/** Open a new page target and attach a session to it. */
export async function openPage(port, url = 'about:blank') {
  const response = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`, {
    method: 'PUT',
  });
  const target = await response.json();
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = () => reject(new Error('could not attach to the page target'));
  });
  const session = new Session(ws);
  await session.send('Page.enable');
  await session.send('Runtime.enable');
  await session.send('Log.enable');
  await session.send('Network.enable');
  return {
    session,
    async close() {
      session.close();
      await fetch(`http://127.0.0.1:${port}/json/close/${target.id}`).catch(() => {});
    },
  };
}

/**
 * Watch a page for the failure modes that matter: console errors, uncaught
 * exceptions, and requests that never completed.
 *
 * Aborted requests are filtered out: the live widgets cancel in-flight fetches
 * when a page navigates, which is correct behaviour and not a defect.
 */
export function watchForProblems(session) {
  const consoleErrors = [];
  const exceptions = [];
  const failedRequests = [];
  const requestUrls = new Map();

  session.on('Network.requestWillBeSent', (params) => {
    requestUrls.set(params.requestId, params.request.url);
  });
  session.on('Log.entryAdded', (entry) => {
    if (entry?.level === 'error') consoleErrors.push(`${entry.source}: ${entry.text}`);
  });
  session.on('Runtime.exceptionThrown', (params) => {
    exceptions.push(params?.exceptionDetails?.exception?.description ?? params?.exceptionDetails?.text ?? 'exception');
  });
  session.on('Network.loadingFailed', (params) => {
    if (params?.canceled || params?.errorText === 'net::ERR_ABORTED') return;
    failedRequests.push(`${params?.errorText ?? 'failed'} ${requestUrls.get(params?.requestId) ?? '(unknown)'}`);
  });

  return { consoleErrors, exceptions, failedRequests };
}

/** `true` when `url` answers, used to decide whether to run server-side checks. */
export async function isReachable(url, timeoutMs = 2500) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    return response.ok;
  } catch {
    return false;
  }
}
