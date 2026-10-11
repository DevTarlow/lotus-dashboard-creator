import type { ReactNode } from 'react';
import type { AccentTone } from '@/types';
import { cn } from '@/lib/utils';
import { progressValue } from '@/lib/resourceStatus';
import { TONE_FILL } from './tone';

export interface ProgressBarProps {
  /** Progress, 0…1. Values outside the range are clamped. */
  value: number;
  tone?: AccentTone;
  /** Accessible name; the bar is exposed as a `progressbar` when given. */
  label?: string;
  /** Optional caption rendered above the track. */
  caption?: ReactNode;
  /** Optional trailing text, e.g. "3 of 8". */
  valueLabel?: ReactNode;
  className?: string;
}

/** Thin labelled progress bar used by tasks, habits and countdowns. */
export function ProgressBar({ value, tone = 'violet', label, caption, valueLabel, className }: ProgressBarProps) {
  const progress = progressValue(value);
  const percent = Math.round(progress * 100);

  return (
    <div className={cn('space-y-1.5', className)}>
      {caption || valueLabel ? (
        <div className="flex items-center justify-between gap-2 text-[11px] font-medium text-slate-400 dark:text-slate-500">
          <span className="truncate">{caption}</span>
          <span className="shrink-0 tabular-nums">{valueLabel ?? `${percent}%`}</span>
        </div>
      ) : null}
      <div
        className="h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800"
        role={label ? 'progressbar' : 'presentation'}
        aria-label={label}
        aria-valuenow={label ? percent : undefined}
        aria-valuemin={label ? 0 : undefined}
        aria-valuemax={label ? 100 : undefined}
      >
        <div
          className={cn('h-full rounded-full transition-[width] duration-500 ease-out', TONE_FILL[tone])}
          style={{ width: `${Math.max(progress === 0 ? 0 : 2, percent)}%` }}
        />
      </div>
    </div>
  );
}
