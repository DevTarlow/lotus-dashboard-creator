import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STORAGE_KEYS } from '@/constants/app';

/**
 * Persistence contract.
 *
 * The user-visible promise is "my settings are still there after a refresh".
 * These tests simulate a refresh by resetting the module registry and importing
 * the store again, which is exactly what zustand's `persist` middleware has to
 * cope with in the browser.
 */

/** Fresh store instance, as if the page had just been reloaded. */
async function loadDashboardStore() {
  vi.resetModules();
  const module = await import('@/store/dashboardStore');
  return module.useDashboardStore;
}

async function loadPrefsStore() {
  vi.resetModules();
  const module = await import('@/store/prefsStore');
  return module.usePrefsStore;
}

function persistedWorkspace(): {
  state: { widgets: Array<{ id: string; type: string; config: Record<string, unknown> }> };
} {
  const raw = localStorage.getItem(STORAGE_KEYS.workspace);
  expect(raw, 'workspace should have been written to storage').toBeTruthy();
  return JSON.parse(raw as string);
}

/** Pretend the page carries an embedded snapshot, newest at `savedAt`. */
function embedSnapshot(prefs: unknown, savedAt: number): void {
  const text = JSON.stringify({
    format: 'lotus-embedded/v1',
    version: 1,
    generator: { name: 'Lotus Dashboard Creator', version: '1.0.0' },
    savedAt,
    workspace: { title: '', description: '', widgets: [], layouts: {}, locked: false, updatedAt: savedAt },
    prefs,
  });
  Object.defineProperty(globalThis, 'document', {
    value: {
      getElementById: (id: string) =>
        id === 'lotus-embedded-workspace' ? { textContent: text } : null,
    },
    configurable: true,
    writable: true,
  });
}

function clearEmbeddedSnapshot(): void {
  delete (globalThis as { document?: unknown }).document;
}

describe('persistence', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('writes widget config to the workspace storage key', async () => {
    const store = await loadDashboardStore();
    const clock = store.getState().widgets.find((widget) => widget.type === 'clock');
    expect(clock).toBeDefined();

    store.getState().updateWidgetConfig(clock!.id, { timeZone: 'Europe/London', hour12: true });

    const stored = persistedWorkspace().state.widgets.find((widget) => widget.type === 'clock');
    expect(stored?.config).toMatchObject({ timeZone: 'Europe/London', hour12: true });
  });

  it('restores a widget setting after a refresh instead of reverting to defaults', async () => {
    const first = await loadDashboardStore();
    const clock = first.getState().widgets.find((widget) => widget.type === 'clock');
    expect(clock).toBeDefined();
    first.getState().updateWidgetConfig(clock!.id, { timeZone: 'Asia/Tokyo', showSeconds: false });

    const second = await loadDashboardStore();
    const restored = second.getState().widgets.find((widget) => widget.id === clock!.id);

    expect(restored?.config).toMatchObject({ timeZone: 'Asia/Tokyo', showSeconds: false });
    // The default must not have won.
    expect(restored?.config.timeZone).not.toBe('local');
  });

  it('restores the dashboard title and lock flag after a refresh', async () => {
    const first = await loadDashboardStore();
    first.getState().setTitle('Ops wall');
    first.getState().setLocked(true);

    const second = await loadDashboardStore();
    expect(second.getState().title).toBe('Ops wall');
    expect(second.getState().locked).toBe(true);
  });

  it('persists preferences separately from the workspace', async () => {
    const prefs = await loadPrefsStore();
    prefs.getState().setTheme('dark');
    prefs.getState().setFinnhubKey('demo-key');

    const reloaded = await loadPrefsStore();
    expect(reloaded.getState().theme).toBe('dark');
    expect(reloaded.getState().finnhubKey).toBe('demo-key');
  });

  it('never persists undo history or transient UI state', async () => {
    const store = await loadDashboardStore();
    store.getState().setTitle('Something');

    const persisted = persistedWorkspace() as unknown as { state: Record<string, unknown> };
    expect(persisted.state).not.toHaveProperty('past');
    expect(persisted.state).not.toHaveProperty('future');
    expect(persisted.state).not.toHaveProperty('activeBreakpoint');
  });

  it('falls back to the default workspace when the stored payload is corrupt', async () => {
    localStorage.setItem(STORAGE_KEYS.workspace, '{ this is not json');
    const store = await loadDashboardStore();
    expect(store.getState().widgets.length).toBeGreaterThan(0);
  });

  it('falls back to the default workspace when the stored payload is a valid but foreign document', async () => {
    localStorage.setItem(STORAGE_KEYS.workspace, JSON.stringify({ state: { nonsense: true }, version: 1 }));
    const store = await loadDashboardStore();
    expect(store.getState().widgets.length).toBeGreaterThan(0);
  });
});

/**
 * "First visit" has to be a real state rather than an inference from a failed
 * validation: it decides whether the welcome panel is shown, and a dashboard
 * that could not be read must not be mistaken for a new one.
 */
describe('where the workspace came from', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    clearEmbeddedSnapshot();
  });

  it('reports a genuinely new visitor', async () => {
    const store = await loadDashboardStore();
    expect(store.getState().seedOrigin).toBe('fresh');
  });

  it('reports ordinary browser storage after a refresh', async () => {
    const first = await loadDashboardStore();
    first.getState().setTitle('Ops wall');

    const second = await loadDashboardStore();
    expect(second.getState().seedOrigin).toBe('browser');
    expect(second.getState().title).toBe('Ops wall');
  });

  it('reports an unparseable stored workspace instead of pretending it is a new one', async () => {
    localStorage.setItem(STORAGE_KEYS.workspace, '{ this is not json');

    const store = await loadDashboardStore();
    expect(store.getState().seedOrigin).toBe('recovered');
    // Dropped, so the next load can start cleanly rather than failing again.
    expect(localStorage.getItem(STORAGE_KEYS.workspace)).toBeNull();
  });

  it('reports a stored document whose contents are unusable', async () => {
    localStorage.setItem(STORAGE_KEYS.workspace, JSON.stringify({ state: { widgets: 'nope' }, version: 1 }));

    const store = await loadDashboardStore();
    expect(store.getState().seedOrigin).toBe('recovered');
  });

  it('reports a saved file when its snapshot is newer than this browser', async () => {
    embedSnapshot(null, Date.now() + 10_000);

    const store = await loadDashboardStore();
    expect(store.getState().seedOrigin).toBe('file');
  });

  it('lets a saved file win over an unreadable browser copy', async () => {
    // The corrupt value is dropped, so hydration continues far enough to read
    // the snapshot the user was actually sent.
    localStorage.setItem(STORAGE_KEYS.workspace, '{ this is not json');
    embedSnapshot(
      {
        theme: 'dark',
        themeId: 'lotus',
        customAccentHex: '',
        customNeutralHue: null,
        themeTokens: {},
        showGridHints: true,
        confirmDelete: true,
      },
      Date.now() + 10_000,
    );

    const store = await loadDashboardStore();
    expect(store.getState().seedOrigin).toBe('file');
  });

  it('never persists the seed origin', async () => {
    const store = await loadDashboardStore();
    store.getState().setTitle('Something');

    const persisted = persistedWorkspace() as unknown as { state: Record<string, unknown> };
    expect(persisted.state).not.toHaveProperty('seedOrigin');
  });
});

describe('theme persistence', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    delete (globalThis as { document?: unknown }).document;
  });

  /** Write a preference payload straight to storage, as an older build would. */
  function seedPrefs(state: Record<string, unknown>): void {
    localStorage.setItem(STORAGE_KEYS.prefs, JSON.stringify({ state, version: 1 }));
  }

  it('restores the preset and the colour overrides after a refresh', async () => {
    const prefs = await loadPrefsStore();
    prefs.getState().setThemePreset('rose-quartz');
    prefs.getState().setCustomAccentHex('#00ffcc');
    prefs.getState().setCustomNeutralHue(200);
    const tokens = prefs.getState().themeTokens;
    expect(tokens['--color-violet-500']).toMatch(/^oklch\(/);

    const reloaded = await loadPrefsStore();
    expect(reloaded.getState().themeId).toBe('rose-quartz');
    expect(reloaded.getState().customAccentHex).toBe('#00ffcc');
    expect(reloaded.getState().customNeutralHue).toBe(200);
    // Regenerated from the same inputs, so the palette is identical.
    expect(reloaded.getState().themeTokens).toEqual(tokens);
  });

  it('recomputes the cached palette instead of trusting what storage holds', async () => {
    // A hand-edited (or older-build) cache must never reach the DOM.
    seedPrefs({
      themeId: 'cobalt',
      customAccentHex: '#ff00ff',
      customNeutralHue: null,
      themeTokens: { '--color-slate-50': 'url(https://example.com/track.png)', '--evil': 'oklch(1% 0 0)' },
    });

    const reloaded = await loadPrefsStore();
    const tokens = reloaded.getState().themeTokens;
    expect(tokens['--evil']).toBeUndefined();
    expect(tokens['--color-slate-50']).toMatch(/^oklch\(/);
    expect(reloaded.getState().customAccentHex).toBe('#ff00ff');
  });

  it('ignores an unknown preset id and an invalid accent', async () => {
    seedPrefs({ themeId: 'ultraviolet', customAccentHex: 'rebeccapurple', customNeutralHue: 'warm' });

    const reloaded = await loadPrefsStore();
    expect(reloaded.getState().themeId).toBe('lotus');
    expect(reloaded.getState().customAccentHex).toBe('');
    expect(reloaded.getState().customNeutralHue).toBeNull();
  });

  it('repairs a stale cache on mount without pretending the user changed anything', async () => {
    const prefs = await loadPrefsStore();
    prefs.getState().setThemePreset('cobalt');
    const { tokensForPreset } = await import('@/lib/theme');

    // Simulate a cache written by an older build.
    prefs.setState({ themeTokens: {} });
    const stampedAt = prefs.getState().updatedAt;

    prefs.getState().refreshThemeTokens();

    expect(prefs.getState().themeTokens).toEqual(tokensForPreset('cobalt'));
    // Regenerating a cache is not a user edit: the timestamp must not move, or
    // this browser would start outranking a file the user was just sent.
    expect(prefs.getState().updatedAt).toBe(stampedAt);
  });

  it('takes the palette from a newer dashboard file', async () => {
    const prefs = await loadPrefsStore();
    prefs.getState().setThemePreset('lotus');

    embedSnapshot(
      {
        theme: 'dark',
        themeId: 'amber-forge',
        customAccentHex: '',
        customNeutralHue: null,
        themeTokens: {},
        showGridHints: true,
        confirmDelete: false,
      },
      Date.now() + 10_000,
    );

    const reloaded = await loadPrefsStore();
    expect(reloaded.getState().themeId).toBe('amber-forge');
    expect(reloaded.getState().theme).toBe('dark');
    expect(reloaded.getState().themeTokens).toEqual(
      (await import('@/lib/theme')).tokensForPreset('amber-forge'),
    );
  });

  it('keeps the local palette when the file is older than this browser', async () => {
    const prefs = await loadPrefsStore();
    prefs.getState().setThemePreset('crimson-carbon');

    embedSnapshot(
      {
        theme: 'light',
        themeId: 'graphite',
        customAccentHex: '',
        customNeutralHue: null,
        themeTokens: {},
        showGridHints: true,
        confirmDelete: false,
      },
      1,
    );

    const reloaded = await loadPrefsStore();
    expect(reloaded.getState().themeId).toBe('crimson-carbon');
  });
});
