import type { ReactNode } from 'react';
import type { AccentTone } from '@/types';
import { cn } from '@/lib/utils';
import { progressValue } from '@/lib/resourceStatus';
import { TONE_STROKE, TONE_TEXT } from './tone';

export interface RingProps {
  /** Progress, 0…1. Values outside the range are clamped. */
  value: number;
  /** Outer diameter in pixels. */
  size?: number;
  /** Stroke width in pixels. */
  thickness?: number;
  tone?: AccentTone;
  /** Centre content. Defaults to the rounded percentage. */
  children?: ReactNode;
  /** Accessible name; the ring is exposed as a `progressbar` when given. */
  label?: string;
  className?: string;
}

/**
 * Dependency-free SVG progress ring.
 *
 * The circle is drawn in a 100×100 viewBox and scaled by CSS, so one component
 * serves a 48 px pomodoro timer and a 96 px daylight dial without new maths.
 */
export function Ring({
  value,
  size = 64,
  thickness = 7,
  tone = 'violet',
  children,
  label,
  className,
}: RingProps) {
  const progress = progressValue(value);
  const radius = 50 - thickness / 2;
  const circumference = 2 * Math.PI * radius;
  const percent = Math.round(progress * 100);

  return (
    <div className={cn('relative inline-flex shrink-0 items-center justify-center', className)} style={{ width: size, height: size }}>
      <svg
        viewBox="0 0 100 100"
        className="h-full w-full -rotate-90"
        role={label ? 'progressbar' : 'presentation'}
        aria-label={label}
        aria-valuenow={label ? percent : undefined}
        aria-valuemin={label ? 0 : undefined}
        aria-valuemax={label ? 100 : undefined}
      >
        <circle
          cx="50"
          cy="50"
          r={radius}
          fill="none"
          strokeWidth={thickness}
          className="stroke-slate-100 dark:stroke-slate-800"
        />
        <circle
          cx="50"
          cy="50"
          r={radius}
          fill="none"
          strokeWidth={thickness}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - progress)}
          className={cn('transition-[stroke-dashoffset] duration-500 ease-out', TONE_STROKE[tone])}
        />
      </svg>
      <div className={cn('absolute inset-0 flex flex-col items-center justify-center', TONE_TEXT[tone])}>
        {children ?? <span className="text-sm font-semibold tabular-nums">{percent}%</span>}
      </div>
    </div>
  );
}
