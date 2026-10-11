/**
 * Accent tone → Tailwind classes.
 *
 * Kept in one place so a ring, a progress bar and a stat tile in the same widget
 * cannot drift apart, and so widgets never hand-write colour logic (the theme is
 * class-based, and `dark:` variants belong here, not in a component).
 */
import type { AccentTone } from '@/types';

/** Soft chip / tile background with readable text. */
export const TONE_CHIP: Record<AccentTone, string> = {
  violet: 'bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300',
  sky: 'bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300',
  amber: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
  emerald: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300',
  rose: 'bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300',
  slate: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
};

/** SVG stroke colour. */
export const TONE_STROKE: Record<AccentTone, string> = {
  violet: 'stroke-violet-500 dark:stroke-violet-400',
  sky: 'stroke-sky-500 dark:stroke-sky-400',
  amber: 'stroke-amber-500 dark:stroke-amber-400',
  emerald: 'stroke-emerald-500 dark:stroke-emerald-400',
  rose: 'stroke-rose-500 dark:stroke-rose-400',
  slate: 'stroke-slate-400 dark:stroke-slate-500',
};

/** Solid bar / dot fill. */
export const TONE_FILL: Record<AccentTone, string> = {
  violet: 'bg-violet-500 dark:bg-violet-400',
  sky: 'bg-sky-500 dark:bg-sky-400',
  amber: 'bg-amber-500 dark:bg-amber-400',
  emerald: 'bg-emerald-500 dark:bg-emerald-400',
  rose: 'bg-rose-500 dark:bg-rose-400',
  slate: 'bg-slate-400 dark:bg-slate-500',
};

/** Foreground text colour. */
export const TONE_TEXT: Record<AccentTone, string> = {
  violet: 'text-violet-600 dark:text-violet-400',
  sky: 'text-sky-600 dark:text-sky-400',
  amber: 'text-amber-600 dark:text-amber-400',
  emerald: 'text-emerald-600 dark:text-emerald-400',
  rose: 'text-rose-600 dark:text-rose-400',
  slate: 'text-slate-500 dark:text-slate-400',
};
