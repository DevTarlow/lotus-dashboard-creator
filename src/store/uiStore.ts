/**
 * Ephemeral UI state: which overlay is open, what is being dragged, what the
 * settings modal is pointing at. Never persisted — a reload always starts clean.
 */
import { create } from 'zustand';

/** Payload staged by the import flow, awaiting confirmation in the dialog. */
export interface PendingImport {
  fileName: string;
  text: string;
}

export interface UiState {
  /** "Add widget" drawer. */
  addWidgetOpen: boolean;
  /** Starter template gallery. */
  templatesOpen: boolean;
  /** Palette and colour picker. */
  appearanceOpen: boolean;
  /** Keyboard shortcut cheat sheet. */
  shortcutsOpen: boolean;
  /** Widget id whose settings modal is open. */
  settingsWidgetId: string | null;
  /** Widget id pending a delete confirmation. */
  pendingDeleteId: string | null;
  /** Import staged for confirmation. */
  pendingImport: PendingImport | null;
  /** Widget type currently dragged from the drawer onto the canvas. */
  draggingType: string | null;

  openAddWidget: () => void;
  closeAddWidget: () => void;
  openTemplates: () => void;
  closeTemplates: () => void;
  openAppearance: () => void;
  closeAppearance: () => void;
  openShortcuts: () => void;
  closeShortcuts: () => void;
  openSettings: (id: string) => void;
  closeSettings: () => void;
  requestDelete: (id: string) => void;
  cancelDelete: () => void;
  stageImport: (payload: PendingImport) => void;
  clearImport: () => void;
  setDraggingType: (type: string | null) => void;
  /** Close every overlay (Escape key). */
  closeAll: () => void;
}

export const useUiStore = create<UiState>()((set, get) => ({
  addWidgetOpen: false,
  templatesOpen: false,
  appearanceOpen: false,
  shortcutsOpen: false,
  settingsWidgetId: null,
  pendingDeleteId: null,
  pendingImport: null,
  draggingType: null,

  openAddWidget: () => set({ addWidgetOpen: true }),
  closeAddWidget: () => set({ addWidgetOpen: false }),
  openTemplates: () => set({ templatesOpen: true }),
  closeTemplates: () => set({ templatesOpen: false }),
  openAppearance: () => set({ appearanceOpen: true }),
  closeAppearance: () => set({ appearanceOpen: false }),
  openShortcuts: () => set({ shortcutsOpen: true }),
  closeShortcuts: () => set({ shortcutsOpen: false }),
  openSettings: (settingsWidgetId) => set({ settingsWidgetId }),
  closeSettings: () => set({ settingsWidgetId: null }),
  requestDelete: (pendingDeleteId) => set({ pendingDeleteId }),
  cancelDelete: () => set({ pendingDeleteId: null }),
  stageImport: (pendingImport) => set({ pendingImport }),
  clearImport: () => set({ pendingImport: null }),
  setDraggingType: (draggingType) => {
    if (get().draggingType !== draggingType) set({ draggingType });
  },
  closeAll: () =>
    set({
      addWidgetOpen: false,
      templatesOpen: false,
      appearanceOpen: false,
      shortcutsOpen: false,
      settingsWidgetId: null,
      pendingDeleteId: null,
      pendingImport: null,
    }),
}));

/** `true` when any blocking overlay is open. */
export const selectHasOpenOverlay = (state: UiState): boolean =>
  state.addWidgetOpen ||
  state.templatesOpen ||
  state.appearanceOpen ||
  state.shortcutsOpen ||
  state.settingsWidgetId !== null ||
  state.pendingDeleteId !== null ||
  state.pendingImport !== null;
