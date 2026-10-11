import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { CloseIcon } from '@/components/icons';
import { IconButton } from '@/components/ui/Button';
import { useFocusTrap, useScrollLock } from '@/hooks/useFocusTrap';
import { cn } from '@/lib/utils';

export type ModalSize = 'sm' | 'md' | 'lg';

const SIZES: Record<ModalSize, string> = {
  sm: 'max-w-sm',
  md: 'max-w-lg',
  lg: 'max-w-3xl',
};

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  /** Rendered below the title, e.g. tabs or search. */
  toolbar?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  size?: ModalSize;
}

/** Accessible, portal-rendered dialog with a focus trap. */
export function Modal({
  open,
  onClose,
  title,
  description,
  toolbar,
  children,
  footer,
  size = 'md',
}: ModalProps) {
  const panelRef = useFocusTrap<HTMLDivElement>(open);
  useScrollLock(open);

  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-6">
      <div
        className="absolute inset-0 animate-overlay-in bg-slate-950/45 backdrop-blur-[2px]"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === 'string' ? title : undefined}
        tabIndex={-1}
        className={cn(
          'relative flex max-h-[92vh] w-full flex-col overflow-hidden rounded-t-2xl border border-slate-200 bg-white shadow-2xl',
          'animate-modal-in outline-none dark:border-slate-700/70 dark:bg-slate-900',
          'sm:rounded-2xl',
          SIZES[size],
        )}
      >
        <header className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4 dark:border-slate-800">
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold text-slate-900 dark:text-white">{title}</h2>
            {description ? (
              <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">{description}</p>
            ) : null}
          </div>
          <IconButton label="Close" icon={<CloseIcon className="h-4.5 w-4.5" />} onClick={onClose} />
        </header>

        {toolbar ? (
          <div className="border-b border-slate-100 px-5 py-3 dark:border-slate-800">{toolbar}</div>
        ) : null}

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>

        {footer ? (
          <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-100 bg-slate-50/70 px-5 py-3 dark:border-slate-800 dark:bg-slate-950/40">
            {footer}
          </footer>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}
