import type { AccentTone } from '@/types';
import { cn } from '@/lib/utils';

/** One day in the grid. */
export interface HeatmapCell {
  /** Stable key, usually a `YYYY-MM-DD` day key. */
  key: string;
  /** Intensity 0…4; 0 is an empty day. Values outside the range are clamped. */
  level: number;
  /** Tooltip / accessible description, e.g. "3 of 5 · 12 Feb". */
  title: string;
  /** Marks the cell as not applicable (before a habit existed, or a rest day). */
  muted?: boolean;
}

export interface HeatmapProps {
  /** Columns of cells, oldest first; each column is ordered top to bottom. */
  columns: readonly (readonly HeatmapCell[])[];
  tone?: AccentTone;
  /** Accessible description of the whole grid. */
  label: string;
  /** When given, cells become buttons that report the day they stand for. */
  onSelect?: (cell: HeatmapCell) => void;
  selectedKey?: string;
  className?: string;
}

/** Tone → channel triple, so intensity can be an inline alpha rather than 30 classes. */
const TONE_RGB: Record<AccentTone, string> = {
  violet: '139 92 246',
  sky: '14 165 233',
  amber: '245 158 11',
  emerald: '16 185 129',
  rose: '244 63 94',
  slate: '100 116 139',
};

const LEVEL_ALPHA = [0, 0.28, 0.5, 0.75, 1] as const;

/**
 * GitHub-style contribution grid, used by the habits widget for its history.
 *
 * Dependency-free: cells are plain boxes whose colour is an inline `rgb(… / a)`
 * value, which keeps one component working for every accent tone and both themes.
 */
export function Heatmap({ columns, tone = 'emerald', label, onSelect, selectedKey, className }: HeatmapProps) {
  const rgb = TONE_RGB[tone];

  return (
    <div
      className={cn('flex gap-[3px]', className)}
      role="group"
      aria-label={label}
    >
      {columns.map((column, columnIndex) => (
        <div key={column[0]?.key ?? columnIndex} className="flex flex-col gap-[3px]">
          {column.map((cell) => {
            const level = Math.max(0, Math.min(4, Math.round(cell.level)));
            const shared = {
              className: cn(
                'h-2.5 w-2.5 rounded-[3px] transition',
                level === 0 && 'bg-slate-100 dark:bg-slate-800',
                cell.muted && 'opacity-40',
                cell.key === selectedKey && 'ring-2 ring-offset-1 ring-slate-400 ring-offset-white dark:ring-offset-slate-900',
              ),
              style: level === 0 ? undefined : { backgroundColor: `rgb(${rgb} / ${LEVEL_ALPHA[level]})` },
              title: cell.title,
            };

            if (!onSelect) {
              return <span key={cell.key} aria-hidden="true" {...shared} />;
            }

            return (
              <button
                key={cell.key}
                type="button"
                aria-label={cell.title}
                {...shared}
                className={cn(shared.className, 'widget-no-drag focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500')}
                onClick={() => onSelect(cell)}
              />
            );
          })}
        </div>
      ))}
    </div>
  );
}
