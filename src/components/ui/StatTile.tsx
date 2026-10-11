import type { ReactNode } from 'react';
import type { AccentTone } from '@/types';
import { cn } from '@/lib/utils';
import { TONE_TEXT } from './tone';

export interface StatTileProps {
  /** Small uppercase caption. */
  label: string;
  /** The value itself; a string so callers keep control of formatting. */
  value: ReactNode;
  /** Optional unit or qualifier rendered next to the value. */
  unit?: string;
  /** Optional second line, e.g. "feels like 18°". */
  hint?: ReactNode;
  tone?: AccentTone;
  /** Optional leading glyph. */
  icon?: ReactNode;
  className?: string;
}

/** Label + value + hint, the atom most of the new widgets are built from. */
export function StatTile({ label, value, unit, hint, tone = 'slate', icon, className }: StatTileProps) {
  return (
    <div className={cn('min-w-0 rounded-lg bg-slate-50 px-2.5 py-2 dark:bg-slate-800/60', className)}>
      <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
        {icon}
        <span className="truncate">{label}</span>
      </div>
      <div className="mt-0.5 flex items-baseline gap-1">
        <span className={cn('truncate text-lg font-semibold tabular-nums', TONE_TEXT[tone])}>{value}</span>
        {unit ? <span className="shrink-0 text-[11px] font-medium text-slate-400 dark:text-slate-500">{unit}</span> : null}
      </div>
      {hint ? <p className="mt-0.5 truncate text-[11px] text-slate-400 dark:text-slate-500">{hint}</p> : null}
    </div>
  );
}
