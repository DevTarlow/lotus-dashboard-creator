import { useId } from 'react';
import { cn } from '@/lib/utils';

export interface SparklineProps {
  values: readonly number[];
  /** Colour the line green (true) or red (false). */
  positive?: boolean;
  className?: string;
  /** Draw the soft gradient underneath the line. */
  area?: boolean;
  strokeWidth?: number;
}

/**
 * Dependency-free SVG sparkline. Points are normalised into a 100×32 viewBox and
 * stretched with `preserveAspectRatio="none"`, so the chart fills whatever space
 * the widget gives it.
 */
export function Sparkline({
  values,
  positive = true,
  className,
  area = true,
  strokeWidth = 1.6,
}: SparklineProps) {
  const gradientId = useId();

  if (values.length < 2) {
    return <div className={cn('h-8 w-full rounded bg-slate-100 dark:bg-slate-800', className)} aria-hidden="true" />;
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const stepX = 100 / (values.length - 1);
  const points = values.map((value, index) => {
    const x = index * stepX;
    const y = 30 - ((value - min) / span) * 28;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  });

  const line = `M ${points.join(' L ')}`;
  const areaPath = `${line} L 100,32 L 0,32 Z`;
  const stroke = positive ? 'stroke-emerald-500 dark:stroke-emerald-400' : 'stroke-rose-500 dark:stroke-rose-400';

  return (
    <svg
      viewBox="0 0 100 32"
      preserveAspectRatio="none"
      className={cn('h-8 w-full overflow-visible', className)}
      aria-hidden="true"
      role="presentation"
    >
      {area ? (
        <>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={positive ? 'rgb(16 185 129)' : 'rgb(244 63 94)'} stopOpacity="0.28" />
              <stop offset="100%" stopColor={positive ? 'rgb(16 185 129)' : 'rgb(244 63 94)'} stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={areaPath} fill={`url(#${gradientId})`} />
        </>
      ) : null}
      <path
        d={line}
        fill="none"
        className={stroke}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}
