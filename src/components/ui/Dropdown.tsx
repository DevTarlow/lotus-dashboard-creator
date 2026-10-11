import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react';
import { useClickOutside } from '@/hooks/useClickOutside';
import { cn } from '@/lib/utils';

export interface DropdownItem {
  id: string;
  label: string;
  icon?: ReactNode;
  /** Right aligned hint, e.g. a shortcut. */
  shortcut?: string;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
}

/** A non-interactive group label inside the menu. */
export interface DropdownHeading {
  id: string;
  heading: string;
}

export type DropdownEntry = DropdownItem | { id: string; separator: true } | DropdownHeading;

export interface DropdownProps {
  /** Accessible label for the trigger button. */
  label: string;
  trigger: ReactNode;
  items: readonly DropdownEntry[];
  align?: 'start' | 'end';
  /** Extra classes for the trigger button. */
  triggerClassName?: string;
}

function isSeparator(item: DropdownEntry): item is { id: string; separator: true } {
  return 'separator' in item;
}

function isHeading(item: DropdownEntry): item is DropdownHeading {
  return 'heading' in item;
}

/** Accessible menu with roving focus, used for toolbars and widget actions. */
export function Dropdown({ label, trigger, items, align = 'end', triggerClassName }: DropdownProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const close = useCallback(() => setOpen(false), []);

  useClickOutside(containerRef, close, open);

  useEffect(() => {
    if (!open) return;
    const first = menuRef.current?.querySelector<HTMLButtonElement>('button:not([disabled])');
    first?.focus({ preventScroll: true });
  }, [open]);

  const onMenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    event.preventDefault();
    const buttons = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('button:not([disabled])') ?? []);
    if (buttons.length === 0) return;
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === 'ArrowDown' ? (index + 1) % buttons.length : (index - 1 + buttons.length) % buttons.length;
    buttons[next].focus();
  };

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        aria-label={label}
        title={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className={cn(
          'inline-flex h-9 items-center gap-2 rounded-xl px-3 text-sm font-medium text-slate-600 transition',
          'hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/70',
          'dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-white',
          open && 'bg-slate-100 text-slate-900 dark:bg-slate-800 dark:text-white',
          triggerClassName,
        )}
      >
        {trigger}
      </button>

      {open ? (
        <div
          ref={menuRef}
          role="menu"
          aria-label={label}
          onKeyDown={onMenuKeyDown}
          className={cn(
            'absolute z-40 mt-1.5 min-w-[13rem] animate-pop-in overflow-hidden rounded-xl border border-slate-200 bg-white p-1 shadow-xl',
            'dark:border-slate-700 dark:bg-slate-900',
            align === 'end' ? 'right-0' : 'left-0',
          )}
        >
          {items.map((item) =>
            isSeparator(item) ? (
              <div key={item.id} className="my-1 h-px bg-slate-100 dark:bg-slate-800" role="separator" />
            ) : isHeading(item) ? (
              // Not a menuitem: it is a label, so the roving focus skips it.
              <div
                key={item.id}
                className="px-2.5 pb-0.5 pt-2 text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500"
              >
                {item.heading}
              </div>
            ) : (
              <button
                key={item.id}
                type="button"
                role="menuitem"
                disabled={item.disabled}
                onClick={() => {
                  close();
                  item.onSelect();
                }}
                className={cn(
                  'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/60',
                  'disabled:pointer-events-none disabled:opacity-40',
                  item.danger
                    ? 'text-rose-600 hover:bg-rose-50 focus-visible:bg-rose-50 dark:text-rose-400 dark:hover:bg-rose-500/10'
                    : 'text-slate-700 hover:bg-slate-100 focus-visible:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800 dark:focus-visible:bg-slate-800',
                )}
              >
                {item.icon}
                <span className="flex-1 truncate">{item.label}</span>
                {item.shortcut ? (
                  <span className="text-[11px] font-medium text-slate-400 dark:text-slate-500">{item.shortcut}</span>
                ) : null}
              </button>
            ),
          )}
        </div>
      ) : null}
    </div>
  );
}
