import { useEffect, useRef } from 'react';
import { DeleteWidgetDialog } from '@/components/modals/ConfirmDialog';
import { useDashboardActions } from '@/hooks/useDashboardActions';
import { useDashboardStore } from '@/store/dashboardStore';
import { usePrefsStore } from '@/store/prefsStore';
import { useUiStore } from '@/store/uiStore';

/**
 * Owns the "remove widget" flow.
 *
 * When confirmations are disabled in preferences the widget is removed straight
 * away (the toast still offers an undo); otherwise the confirmation dialog is
 * shown. Keeping the decision in one place keeps `WidgetFrame` free of policy.
 */
export function WidgetDeleteFlow() {
  const pendingDeleteId = useUiStore((state) => state.pendingDeleteId);
  const cancelDelete = useUiStore((state) => state.cancelDelete);
  const confirmDelete = usePrefsStore((state) => state.confirmDelete);
  const widget = useDashboardStore((state) => state.widgets.find((entry) => entry.id === pendingDeleteId));
  const { removeWidget } = useDashboardActions();

  /**
   * The request we have already decided about.
   *
   * The decision is taken once, when the request arrives. Without it the
   * dialog's own "ask before removing" switch read as a second request:
   * turning confirmations off while the question was on screen deleted the
   * widget instantly, before the user had pressed anything.
   */
  const decidedRef = useRef<string | null>(null);

  useEffect(() => {
    if (!pendingDeleteId) {
      decidedRef.current = null;
      return;
    }
    if (decidedRef.current === pendingDeleteId) return;
    decidedRef.current = pendingDeleteId;

    // Confirmations on: the dialog below asks. Off: this request goes straight through.
    if (confirmDelete) return;
    if (widget) removeWidget(pendingDeleteId);
    cancelDelete();
  }, [cancelDelete, confirmDelete, pendingDeleteId, removeWidget, widget]);

  if (!confirmDelete || !pendingDeleteId || !widget) return null;

  return (
    <DeleteWidgetDialog
      open
      widgetTitle={widget.title}
      onCancel={cancelDelete}
      onConfirm={() => {
        removeWidget(pendingDeleteId);
        cancelDelete();
      }}
    />
  );
}
