import { beforeEach, describe, expect, it, vi } from 'vitest';
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
