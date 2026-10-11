import { useState, type ReactNode } from 'react';
import { AlertIcon } from '@/components/icons';
import { Button, Modal, Switch } from '@/components/ui';
import { usePrefsStore } from '@/store/prefsStore';

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'danger' | 'primary';
  onConfirm: () => void;
  onCancel: () => void;
  children?: ReactNode;
}

/** Generic confirmation dialog. */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  tone = 'primary',
  onConfirm,
  onCancel,
  children,
}: ConfirmDialogProps) {
  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={title}
      description={description}
      size="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button variant={tone === 'danger' ? 'danger' : 'primary'} onClick={onConfirm} autoFocus>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {children ?? (
        <p className="flex items-start gap-2 text-sm text-slate-600 dark:text-slate-300">
          <AlertIcon className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
          This action can be undone with ⌘/Ctrl + Z.
        </p>
      )}
    </Modal>
  );
}

export interface DeleteWidgetDialogProps {
  open: boolean;
  widgetTitle: string;
  /** `askNextTime` is the state of the "ask before removing" switch. */
  onConfirm: (askNextTime: boolean) => void;
  onCancel: () => void;
}

/** Delete confirmation, including the "don't ask again" preference. */
export function DeleteWidgetDialog({ open, widgetTitle, onConfirm, onCancel }: DeleteWidgetDialogProps) {
  const confirmDelete = usePrefsStore((state) => state.confirmDelete);
  /**
   * Held locally until the user answers.
   *
   * Applying the switch immediately made the dialog vanish mid-question (the
   * flow stopped asking) and left the widget on the canvas, which read as the
   * app ignoring both choices. The answer now travels with the confirmation.
   */
  const [askNextTime, setAskNextTime] = useState(confirmDelete);

  return (
    <ConfirmDialog
      open={open}
      title={`Remove “${widgetTitle}”?`}
      description="The widget and its saved settings are removed from the canvas."
      confirmLabel="Remove widget"
      tone="danger"
      onConfirm={() => onConfirm(askNextTime)}
      onCancel={onCancel}
    >
      <div className="space-y-4">
        <p className="flex items-start gap-2 text-sm text-slate-600 dark:text-slate-300">
          <AlertIcon className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
          You can undo this right away from the toast or with ⌘/Ctrl + Z.
        </p>
        <Switch
          checked={askNextTime}
          onChange={setAskNextTime}
          label="Ask before removing a widget"
          help="Turn this off and future removals happen straight away. You still get an undo option."
        />
      </div>
    </ConfirmDialog>
  );
}
