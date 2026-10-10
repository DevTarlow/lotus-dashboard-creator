import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { CloseIcon } from '@/components/icons';
import { IconButton } from '@/components/ui/Button';
import { useFocusTrap, useScrollLock } from '@/hooks/useFocusTrap';
import { cn } from '@/lib/utils';

export interface DrawerProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  /** Sticky content under the header (search, filters, …). */
  toolbar?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  /** Tailwind width classes for the panel. */
  widthClassName?: string;
}

/** Right hand slide-over panel. */
export function Drawer({
  open,
  onClose,
  title,
  description,
  toolbar,
  children,
  footer,
  widthClassName = 'sm:max-w-md',
}: DrawerProps) {
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
    <div className="fixed inset-0 z-50 flex justify-end">
      <div
        className="absolute inset-0 animate-overlay-in bg-slate-950/45 backdrop-blur-[2px]"
        onClick={onClose}
        aria-hidden="true"
      />
      <aside
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === 'string' ? title : undefined}
        tabIndex={-1}
        className={cn(
          'relative flex h-full w-full flex-col border-l border-slate-200 bg-white shadow-2xl outline-none',
          'animate-drawer-in dark:border-slate-800 dark:bg-slate-900',
          widthClassName,
        )}
      >
        <header className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4 dark:border-slate-800">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-slate-900 dark:text-white">{title}</h2>
            {description ? (
              <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">{description}</p>
            ) : null}
          </div>
          <IconButton label="Close panel" icon={<CloseIcon className="h-4.5 w-4.5" />} onClick={onClose} />
        </header>

        {toolbar ? (
          <div className="border-b border-slate-100 px-5 py-3 dark:border-slate-800">{toolbar}</div>
        ) : null}

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>

        {footer ? (
          <footer className="border-t border-slate-100 bg-slate-50/70 px-5 py-3 dark:border-slate-800 dark:bg-slate-950/40">
            {footer}
          </footer>
        ) : null}
      </aside>
    </div>,
    document.body,
  );
}
