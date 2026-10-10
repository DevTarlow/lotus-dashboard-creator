/**
 * Dashboard level commands.
 *
 * UI components call these instead of talking to the store, the file system and
 * the toaster separately — export, import, reset and friends also need user
 * feedback, which is easy to forget when it is spread across components.
 */
import { useCallback, useMemo } from 'react';
import { useDashboardStore } from '@/store/dashboardStore';
import { useToastStore } from '@/store/toastStore';
import { useUiStore } from '@/store/uiStore';
import { createDashboardDocument, serializeDashboardDocument, suggestedFileName } from '@/lib/document';
import { buildDefaultWorkspace, DEFAULT_TEMPLATE_ID, getTemplate } from '@/lib/templates';
import { copyToClipboard, downloadTextFile, readFileAsText } from '@/lib/utils';
import type { DashboardTemplate } from '@/types';
import { getWidgetDefinition } from '@/widgets/registry';

export interface DashboardActions {
  addWidget: (type: string) => void;
  removeWidget: (id: string) => void;
  renameDashboard: (title: string) => void;
  tidy: () => void;
  undo: () => void;
  redo: () => void;
  toggleLock: () => void;
  exportJson: () => void;
  copyJson: () => void;
  importFile: (file: File) => Promise<void>;
  applyTemplate: (template: DashboardTemplate) => void;
  resetDashboard: () => void;
  openAddWidget: () => void;
}

export function useDashboardActions(): DashboardActions {
  const addWidgetToStore = useDashboardStore((state) => state.addWidget);
  const removeWidgetFromStore = useDashboardStore((state) => state.removeWidget);
  const setTitle = useDashboardStore((state) => state.setTitle);
  const tidyLayout = useDashboardStore((state) => state.tidyLayout);
  const undoLayout = useDashboardStore((state) => state.undo);
  const redoLayout = useDashboardStore((state) => state.redo);
  const setLocked = useDashboardStore((state) => state.setLocked);
  const applyTemplateToStore = useDashboardStore((state) => state.applyTemplate);

  const openAddWidget = useUiStore((state) => state.openAddWidget);
  const stageImport = useUiStore((state) => state.stageImport);

  const notify = useToastStore((state) => state.notify);
  const success = useToastStore((state) => state.success);
  const error = useToastStore((state) => state.error);

  const exportJson = useCallback(() => {
    const state = useDashboardStore.getState();
    const document = createDashboardDocument({
      title: state.title,
      description: state.description,
      widgets: state.widgets,
      layouts: state.layouts,
    });
    const fileName = suggestedFileName(document.dashboard.title);
    downloadTextFile(fileName, serializeDashboardDocument(document));
    success('Layout exported', { description: fileName });
  }, [success]);

  const copyJson = useCallback(() => {
    const state = useDashboardStore.getState();
    const document = createDashboardDocument({
      title: state.title,
      description: state.description,
      widgets: state.widgets,
      layouts: state.layouts,
    });
    void copyToClipboard(serializeDashboardDocument(document)).then((ok) => {
      if (ok) success('Layout JSON copied to the clipboard');
      else error('Could not access the clipboard', { description: 'Your browser blocked clipboard access.' });
    });
  }, [error, success]);

  const importFile = useCallback(
    async (file: File) => {
      try {
        const text = await readFileAsText(file);
        stageImport({ fileName: file.name, text });
      } catch {
        error('Could not read that file', { description: file.name });
      }
    },
    [error, stageImport],
  );

  const addWidget = useCallback(
    (type: string) => {
      const definition = getWidgetDefinition(type);
      const id = addWidgetToStore(type);
      if (!id) {
        error('Unknown widget', { description: `No plugin is registered for “${type}”.` });
        return;
      }
      notify({
        tone: 'success',
        title: `${definition?.name ?? 'Widget'} added`,
        description: 'Drag its header to move it, or resize from the corner.',
      });
    },
    [addWidgetToStore, error, notify],
  );

  const removeWidget = useCallback(
    (id: string) => {
      const state = useDashboardStore.getState();
      const widget = state.widgets.find((entry) => entry.id === id);
      if (!widget) return;
      removeWidgetFromStore(id);
      notify({
        tone: 'info',
        title: `${widget.title} removed`,
        duration: 7000,
        action: { label: 'Undo', onClick: () => useDashboardStore.getState().undo() },
      });
    },
    [notify, removeWidgetFromStore],
  );

  const renameDashboard = useCallback(
    (title: string) => {
      // The store normalises empty titles to the default one.
      setTitle(title);
    },
    [setTitle],
  );

  const tidy = useCallback(() => {
    tidyLayout();
    success('Layout tidied', { description: 'Gaps were closed on every breakpoint.' });
  }, [success, tidyLayout]);

  const undo = useCallback(() => {
    const canUndo = useDashboardStore.getState().past.length > 0;
    undoLayout();
    if (!canUndo) notify({ tone: 'info', title: 'Nothing left to undo' });
  }, [notify, undoLayout]);

  const redo = useCallback(() => {
    const canRedo = useDashboardStore.getState().future.length > 0;
    redoLayout();
    if (!canRedo) notify({ tone: 'info', title: 'Nothing left to redo' });
  }, [notify, redoLayout]);

  const toggleLock = useCallback(() => {
    const next = !useDashboardStore.getState().locked;
    setLocked(next);
    notify({
      tone: 'info',
      title: next ? 'Layout locked' : 'Layout unlocked',
      description: next ? 'Widgets can no longer be moved or resized.' : 'Drag and resize are enabled again.',
    });
  }, [notify, setLocked]);

  const applyTemplate = useCallback(
    (template: DashboardTemplate) => {
      applyTemplateToStore(template);
      success(`Applied “${template.name}”`, {
        description: 'Press ⌘/Ctrl + Z to restore your previous dashboard.',
        duration: 7000,
        action: { label: 'Undo', onClick: () => useDashboardStore.getState().undo() },
      });
    },
    [applyTemplateToStore, success],
  );

  const resetDashboard = useCallback(() => {
    const fallback = getTemplate(DEFAULT_TEMPLATE_ID);
    applyTemplateToStore(fallback ?? { id: 'default', name: 'Default', description: '', build: buildDefaultWorkspace });
    success('Dashboard reset', {
      description: 'The default template is back.',
      duration: 7000,
      action: { label: 'Undo', onClick: () => useDashboardStore.getState().undo() },
    });
  }, [applyTemplateToStore, success]);

  return useMemo(
    () => ({
      addWidget,
      removeWidget,
      renameDashboard,
      tidy,
      undo,
      redo,
      toggleLock,
      exportJson,
      copyJson,
      importFile,
      applyTemplate,
      resetDashboard,
      openAddWidget,
    }),
    [
      addWidget,
      applyTemplate,
      copyJson,
      exportJson,
      importFile,
      openAddWidget,
      redo,
      removeWidget,
      renameDashboard,
      resetDashboard,
      tidy,
      toggleLock,
      undo,
    ],
  );
}
