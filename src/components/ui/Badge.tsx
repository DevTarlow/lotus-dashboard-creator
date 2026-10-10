import type { HTMLAttributes, ReactNode } from 'react';
import type { AccentTone } from '@/types';
import { cn } from '@/lib/utils';

const TONES: Record<AccentTone | 'neutral', string> = {
  violet: 'bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300',
  sky: 'bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300',
  amber: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
  emerald: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
  rose: 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300',
  slate: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
  neutral: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
};

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: AccentTone | 'neutral';
  icon?: ReactNode;
}

/** Small status pill. */
export function Badge({ tone = 'neutral', icon, className, children, ...rest }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium leading-5',
        TONES[tone],
        className,
      )}
      {...rest}
    >
      {icon}
      {children}
    </span>
  );
}

/** Keyboard key chip. */
export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd
      className={cn(
        'inline-flex min-w-[1.6rem] items-center justify-center rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.5',
        'font-sans text-[11px] font-semibold text-slate-500 shadow-[0_1px_0_rgba(15,23,42,0.08)]',
        'dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:shadow-none',
        className,
      )}
    >
      {children}
    </kbd>
  );
}

/** Icon chip used in the widget headers and the widget gallery. */
export function IconChip({
  tone = 'violet',
  children,
  className,
}: {
  tone?: AccentTone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex h-8 w-8 items-center justify-center rounded-lg',
        TONES[tone],
        className,
      )}
      aria-hidden="true"
    >
      {children}
    </span>
  );
}
