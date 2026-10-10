import { ArrowDownIcon, ArrowUpIcon } from '@/components/icons';
import { cn } from '@/lib/utils';

export interface DeltaPillProps {
  /** Percentage change (already multiplied by 100). */
  percent: number;
  /** Optional absolute value shown next to the percentage. */
  absolute?: string;
  className?: string;
  size?: 'sm' | 'md';
}

/** Colour coded change indicator used by the market widget. */
export function DeltaPill({ percent, absolute, className, size = 'sm' }: DeltaPillProps) {
  const flat = Math.abs(percent) < 0.005;
  const up = percent > 0;
  const Icon = up ? ArrowUpIcon : ArrowDownIcon;

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full font-semibold tabular-nums',
        size === 'sm' ? 'px-1.5 py-0.5 text-[11px]' : 'px-2 py-1 text-xs',
        flat
          ? 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'
          : up
            ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-400'
            : 'bg-rose-50 text-rose-600 dark:bg-rose-500/10 dark:text-rose-400',
        className,
      )}
    >
      {flat ? null : <Icon className="h-3 w-3" />}
      {`${up ? '+' : ''}${percent.toFixed(2)}%`}
      {absolute ? <span className="font-medium opacity-70">{absolute}</span> : null}
    </span>
  );
}
