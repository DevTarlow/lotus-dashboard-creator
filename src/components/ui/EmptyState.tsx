import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export interface EmptyStateProps {
  icon?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
  /** Use the compact variant inside widgets. */
  size?: 'sm' | 'md';
}

/** Shared empty state for the canvas and for individual widgets. */
export function EmptyState({ icon, title, description, action, className, size = 'md' }: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex h-full flex-col items-center justify-center gap-2 text-center',
        size === 'md' ? 'px-6 py-10' : 'px-3 py-4',
        className,
      )}
    >
      {icon ? (
        <span
          className={cn(
            'flex items-center justify-center rounded-xl bg-slate-100 text-slate-400 dark:bg-slate-800 dark:text-slate-500',
            size === 'md' ? 'h-11 w-11' : 'h-8 w-8',
          )}
          aria-hidden="true"
        >
          {icon}
        </span>
      ) : null}
      <p
        className={cn(
          'font-medium text-slate-700 dark:text-slate-200',
          size === 'md' ? 'text-sm' : 'text-xs',
        )}
      >
        {title}
      </p>
      {description ? (
        <p className={cn('max-w-xs text-slate-500 dark:text-slate-400', size === 'md' ? 'text-sm' : 'text-[11px]')}>
          {description}
        </p>
      ) : null}
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  );
}
