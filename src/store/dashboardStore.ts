/**
 * The dashboard store.
 *
 * Owns the workspace document (title, widgets, per-breakpoint layouts), the
 * undo/redo history and every mutation. `localStorage` persistence is handled by
 * zustand's `persist` middleware through the safe storage adapter, so the store
 * keeps working even when storage is unavailable.
 */
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { LAYOUT_HISTORY_COALESCE_MS, MAX_HISTORY, SCHEMA_VERSION } from '@/constants/app';
import { GRID_COLUMNS } from '@/constants/grid';
import { createDashboardDocument } from '@/lib/document';
import {
  cloneLayouts,
  layoutsEqual,
  normalizeLayout,
  placeWidget,
  reconcileLayouts,
  removeWidget as removeWidgetFromLayouts,
  tidyLayouts,
  type WishPlacement,
} from '@/lib/grid';
import { buildDefaultWorkspace, DEFAULT_TEMPLATE_ID, getTemplate } from '@/lib/templates';
import { zustandStorage } from '@/lib/storage';
import { workspaceStorageKey } from '@/lib/storageKeys';
import { asNumber, asString } from '@/lib/utils';
import { validateDashboardDocument } from '@/lib/validation';
import { DASHBOARD_FORMAT } from '@/types';
import type {
  BreakpointId,
  DashboardDocument,
  DashboardSnapshot,
  DashboardTemplate,
  LayoutsByBreakpoint,
  StoredWidgetInstance,
  WidgetConfig,
} from '@/types';
import { createWidgetInstance } from '@/widgets/factory';
import { getWidgetDefinition } from '@/widgets/registry';
import { registryValidationOptions } from '@/widgets/validationOptions';

export interface DashboardState {
  /* ------------------------------------------------------------- document */
  /** Dashboard title, editable from the toolbar. */
  title: string;
  /** Optional subtitle. */
  description: string;
  /** Widget instances in render order. */
  widgets: StoredWidgetInstance[];
  /** Layout for every breakpoint. */
  layouts: LayoutsByBreakpoint;
  /** When locked, widgets cannot be dragged or resized. */
  locked: boolean;
  /** Last mutation timestamp (epoch ms). */
  updatedAt: number;

  /* ------------------------------------------------------------ transient */
  /** Breakpoint currently rendered by the grid (reported by react-grid-layout). */
  activeBreakpoint: BreakpointId;
  /** Undo stack (oldest first). */
  past: DashboardSnapshot[];
  /** Redo stack. */
  future: DashboardSnapshot[];

  /* -------------------------------------------------------------- actions */
  setTitle: (title: string) => void;
  setDescription: (description: string) => void;
  setLocked: (locked: boolean) => void;
  setActiveBreakpoint: (breakpoint: BreakpointId) => void;

  /** Spawn a widget; returns the new instance id (or `null` for unknown types). */
  addWidget: (type: string, placement?: WishPlacement, config?: WidgetConfig) => string | null;
  removeWidget: (id: string) => void;
  duplicateWidget: (id: string) => string | null;
  renameWidget: (id: string, title: string) => void;
  updateWidgetConfig: (id: string, patch: WidgetConfig) => void;
  replaceWidgetConfig: (id: string, config: WidgetConfig) => void;
  resetWidgetConfig: (id: string) => void;

  /** Persist the layout map reported by the grid. */
  applyLayouts: (layouts: LayoutsByBreakpoint) => void;
  /** Remove every hole from the current layouts. */
  tidyLayout: () => void;
  /** Replace the workspace with a starter template. */
  applyTemplate: (template: DashboardTemplate) => void;
  /** Restore the default template. */
  resetDashboard: () => void;
  /** Remove every widget. */
  clearDashboard: () => void;
  /** Restore a validated import. */
  loadDocument: (document: DashboardDocument) => void;
  /** Current state as an exportable document. */
  exportDocument: () => DashboardDocument;

  undo: () => void;
  redo: () => void;
}

/** Persisted slice of the store. */
type PersistedWorkspace = Pick<
  DashboardState,
  'title' | 'description' | 'widgets' | 'layouts' | 'locked' | 'updatedAt'
>;

/** Registry-aware validation hooks — shared by persistence and import. */
const registryOptions = registryValidationOptions;

/**
 * Normalise any workspace shaped payload (persisted state or imported document)
 * into a valid, self-consistent workspace.
 */
function sanitizeWorkspace(input: unknown): Omit<PersistedWorkspace, 'updatedAt'> {
  const record = (input ?? {}) as Record<string, unknown>;
  const result = validateDashboardDocument(
    {
      format: DASHBOARD_FORMAT,
      version: SCHEMA_VERSION,
      widgets: record.widgets,
      layouts: record.layouts,
      dashboard: { title: record.title, description: record.description },
      exportedAt: typeof record.updatedAt === 'number' ? new Date(record.updatedAt).toISOString() : undefined,
    },
    registryOptions,
  );

  if (!result.ok) {
    const fallback = buildDefaultWorkspace();
    return { ...fallback, locked: false };
  }

  return {
    title: result.document.dashboard.title,
    description: result.document.dashboard.description,
    widgets: result.document.widgets,
    layouts: result.document.layouts,
    locked: record.locked === true,
  };
}

function snapshotOf(state: DashboardState): DashboardSnapshot {
  return {
    widgets: state.widgets.map((widget) => ({ ...widget, config: { ...widget.config } })),
    layouts: cloneLayouts(state.layouts),
  };
}

/**
 * History bookkeeping. Bursts of changes sharing a `coalesceKey` (a drag, a
 * settings slider, typing in a widget) collapse into a single undo step.
 */
let lastCommit: { key: string; at: number } | null = null;

function historyFor(
  state: DashboardState,
  coalesceKey?: string,
): Pick<DashboardState, 'past' | 'future'> {
  const now = Date.now();
  const shouldCoalesce =
    coalesceKey !== undefined &&
    lastCommit !== null &&
    lastCommit.key === coalesceKey &&
    now - lastCommit.at < LAYOUT_HISTORY_COALESCE_MS;

  lastCommit = coalesceKey === undefined ? null : { key: coalesceKey, at: now };

  if (shouldCoalesce) {
    return { past: state.past, future: [] };
  }
  return {
    past: [...state.past, snapshotOf(state)].slice(-MAX_HISTORY),
    future: [],
  };
}

/** Reset the coalescing window, e.g. after an undo. */
function resetHistoryWindow(): void {
  lastCommit = null;
}

const initialWorkspace = buildDefaultWorkspace();

export const useDashboardStore = create<DashboardState>()(
  persist(
    (set, get) => {
      /** Apply a mutating patch together with the appropriate history entry. */
      const commit = (patch: Partial<DashboardState>, coalesceKey?: string): void => {
        set((state) => ({
          ...patch,
          ...historyFor(state, coalesceKey),
          updatedAt: Date.now(),
        }));
      };

      const patchWidget = (id: string, updater: (widget: StoredWidgetInstance) => StoredWidgetInstance): void => {
        const widgets = get().widgets.map((widget) => (widget.id === id ? updater(widget) : widget));
        commit({ widgets }, `config:${id}`);
      };

      return {
        title: initialWorkspace.title,
        description: initialWorkspace.description,
        widgets: initialWorkspace.widgets,
        layouts: initialWorkspace.layouts,
        locked: false,
        updatedAt: Date.now(),
        activeBreakpoint: 'lg',
        past: [],
        future: [],

        setTitle: (title) => commit({ title: title.trim() === '' ? 'My dashboard' : title.trim() }, 'meta:title'),
        setDescription: (description) => commit({ description }, 'meta:description'),
        setLocked: (locked) => set({ locked }),
        setActiveBreakpoint: (activeBreakpoint) => {
          if (get().activeBreakpoint !== activeBreakpoint) set({ activeBreakpoint });
        },

        addWidget: (type, placement, config) => {
          const definition = getWidgetDefinition(type);
          const instance = createWidgetInstance(type, { config });
          if (!definition || !instance) return null;
          commit({
            widgets: [...get().widgets, instance],
            layouts: placeWidget(
              get().layouts,
              { id: instance.id, size: definition.defaultSize },
              GRID_COLUMNS,
              placement ?? {},
            ),
          });
          return instance.id;
        },

        removeWidget: (id) => {
          if (!get().widgets.some((widget) => widget.id === id)) return;
          commit({
            widgets: get().widgets.filter((widget) => widget.id !== id),
            layouts: removeWidgetFromLayouts(get().layouts, id, GRID_COLUMNS),
          });
        },

        duplicateWidget: (id) => {
          const source = get().widgets.find((widget) => widget.id === id);
          if (!source) return null;
          const definition = getWidgetDefinition(source.type);
          const instance = createWidgetInstance(source.type, {
            title: `${source.title} copy`,
            config: source.config,
          });
          if (!instance) return null;

          const breakpoint = get().activeBreakpoint;
          const current = normalizeLayout(get().layouts[breakpoint] ?? [], GRID_COLUMNS[breakpoint]);
          const original = current.find((item) => item.i === id);
          const size = definition?.defaultSize ?? { w: 3, h: 6 };

          commit({
            widgets: [...get().widgets, instance],
            layouts: placeWidget(get().layouts, { id: instance.id, size }, GRID_COLUMNS, {
              breakpoint,
              x: original ? original.x + original.w : undefined,
              y: original ? original.y : undefined,
              size: original ? { w: original.w, h: original.h } : size,
            }),
          });
          return instance.id;
        },

        renameWidget: (id, title) => {
          const fallback = getWidgetDefinition(get().widgets.find((widget) => widget.id === id)?.type ?? '')?.name;
          patchWidget(id, (widget) => ({ ...widget, title: title.trim() || fallback || widget.title }));
        },

        updateWidgetConfig: (id, patch) => {
          patchWidget(id, (widget) => ({ ...widget, config: { ...widget.config, ...patch } }));
        },

        replaceWidgetConfig: (id, config) => {
          patchWidget(id, (widget) => ({ ...widget, config: { ...config } }));
        },

        resetWidgetConfig: (id) => {
          const widget = get().widgets.find((entry) => entry.id === id);
          const definition = widget ? getWidgetDefinition(widget.type) : undefined;
          if (!definition || !widget) return;
          patchWidget(id, (entry) => ({ ...entry, config: { ...definition.defaultConfig } }));
        },

        applyLayouts: (layouts) => {
          const current = get().layouts;
          if (layoutsEqual(current, layouts)) return;
          const normalized: LayoutsByBreakpoint = {};
          for (const breakpoint of Object.keys(GRID_COLUMNS) as BreakpointId[]) {
            if (layouts[breakpoint]) {
              normalized[breakpoint] = normalizeLayout(layouts[breakpoint] ?? [], GRID_COLUMNS[breakpoint]);
            } else if (current[breakpoint]) {
              normalized[breakpoint] = current[breakpoint];
            }
          }
          commit({ layouts: normalized }, 'layout');
        },

        tidyLayout: () => {
          commit({ layouts: tidyLayouts(get().layouts, GRID_COLUMNS) }, 'layout');
        },

        applyTemplate: (template) => {
          const built = template.build();
          commit({
            title: built.title,
            description: built.description,
            widgets: built.widgets,
            layouts: built.layouts,
          });
        },

        resetDashboard: () => {
          get().applyTemplate(getTemplate(DEFAULT_TEMPLATE_ID) ?? { id: 'default', name: 'Default', description: '', build: buildDefaultWorkspace });
        },

        clearDashboard: () => {
          commit({ widgets: [], layouts: reconcileLayouts({}, [], GRID_COLUMNS) });
        },

        loadDocument: (document) => {
          commit({
            title: document.dashboard.title,
            description: document.dashboard.description,
            widgets: document.widgets,
            layouts: reconcileLayouts(
              document.layouts,
              document.widgets.map((widget) => {
                const definition = getWidgetDefinition(widget.type);
                const size = definition?.defaultSize ?? { w: 3, h: 6 };
                const existing = (document.layouts.lg ?? []).find((item) => item.i === widget.id);
                // Keep the size the file used, falling back to the definition default.
                return { id: widget.id, size: existing ? { ...size, w: existing.w, h: existing.h } : size };
              }),
              GRID_COLUMNS,
            ),
          });
        },

        exportDocument: () =>
          createDashboardDocument({
            title: get().title,
            description: get().description,
            widgets: get().widgets,
            layouts: get().layouts,
          }),

        undo: () => {
          resetHistoryWindow();
          set((state) => {
            const previous = state.past[state.past.length - 1];
            if (!previous) return {};
            return {
              past: state.past.slice(0, -1),
              future: [...state.future, snapshotOf(state)].slice(-MAX_HISTORY),
              widgets: previous.widgets,
              layouts: cloneLayouts(previous.layouts),
              updatedAt: Date.now(),
            };
          });
        },

        redo: () => {
          resetHistoryWindow();
          set((state) => {
            const next = state.future[state.future.length - 1];
            if (!next) return {};
            return {
              future: state.future.slice(0, -1),
              past: [...state.past, snapshotOf(state)].slice(-MAX_HISTORY),
              widgets: next.widgets,
              layouts: cloneLayouts(next.layouts),
              updatedAt: Date.now(),
            };
          });
        },
      };
    },
    {
      name: workspaceStorageKey(),
      version: SCHEMA_VERSION,
      storage: createJSONStorage(() => zustandStorage),
      partialize: (state): PersistedWorkspace => ({
        title: state.title,
        description: state.description,
        widgets: state.widgets,
        layouts: state.layouts,
        locked: state.locked,
        updatedAt: state.updatedAt,
      }),
      /**
       * Runs on every rehydration: layouts and widgets are reconciled against the
       * widgets that are actually installed, so a stale localStorage payload can
       * never produce a broken canvas.
       */
      merge: (persisted, current) => {
        const workspace = sanitizeWorkspace(persisted);
        return {
          ...current,
          ...workspace,
          updatedAt: asNumber((persisted as { updatedAt?: unknown } | undefined)?.updatedAt, Date.now()),
          title: asString(workspace.title, current.title),
        };
      },
    },
  ),
);

/* --------------------------------------------------------------- selectors */

/** Widget count — used by the toolbar badge. */
export const selectWidgetCount = (state: DashboardState): number => state.widgets.length;

/** `true` when there is something to undo. */
export const selectCanUndo = (state: DashboardState): boolean => state.past.length > 0;

/** `true` when there is something to redo. */
export const selectCanRedo = (state: DashboardState): boolean => state.future.length > 0;

/** Layout of the breakpoint currently rendered. */
export const selectActiveLayout = (state: DashboardState) =>
  state.layouts[state.activeBreakpoint] ?? [];
