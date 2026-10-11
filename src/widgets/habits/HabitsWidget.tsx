import { Fragment, useMemo, useState, type KeyboardEvent } from 'react';
import { CheckIcon, FlameIcon, HabitsIcon, PencilIcon, PlusIcon, TrashIcon } from '@/components/icons';
import { Button, EmptyState, IconButton, ProgressBar, SelectInput, TextInput } from '@/components/ui';
import { useNow } from '@/hooks/useNow';
import {
  DEFAULT_WEEKS,
  HABIT_EMOJI_MAX,
  HABIT_NAME_MAX,
  MAX_HABITS,
  MAX_WEEKS,
  MIN_WEEKS,
  addHabit,
  completionRate,
  currentStreak,
  formatStreak,
  habitGrid,
  isDoneOn,
  isHabitSchedule,
  isScheduledOn,
  normalizeHabitsConfig,
  removeHabit,
  summarizeHabits,
  todayTotals,
  toggleDay,
  updateHabit,
  type Habit,
  type HabitGridColumn,
  type HabitSchedule,
  type HabitsConfig,
} from '@/lib/habits';
import { dayKey, parseDayKey } from '@/lib/time';
import { cn } from '@/lib/utils';
import type { SettingField, WidgetProps } from '@/types';
import { defineWidget } from '@/widgets/define';
import { Heatmap, type HeatmapCell } from '@/widgets/shared';

export type { Habit, HabitSchedule, HabitsConfig } from '@/lib/habits';

const DEFAULT_HABITS_CONFIG: HabitsConfig = { habits: [], weeks: DEFAULT_WEEKS, showHeatmap: true };

const SETTINGS: readonly SettingField[] = [
  { key: 'weeks', label: 'Weeks shown in the grid', type: 'number', min: MIN_WEEKS, max: MAX_WEEKS, step: 1 },
  { key: 'showHeatmap', label: 'Show the history grid', type: 'switch' },
];

const SCHEDULE_OPTIONS: ReadonlyArray<{ label: string; value: string }> = [
  { label: 'Every day', value: 'daily' },
  { label: 'Weekdays', value: 'weekdays' },
  { label: 'Chosen days', value: 'custom' },
];

/** `Date#getDay()` order, Sunday first: the initials shown in the day picker. */
const DAY_INITIALS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'] as const;
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;

interface HabitTickProps {
  label: string;
  title: string;
  checked: boolean;
  disabled: boolean;
  onToggle: () => void;
}

/** The habit's day is ticked off, or not yet — the checkbox of the checklist. */
function HabitTick({ label, title, checked, disabled, onToggle }: HabitTickProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      title={title}
      disabled={disabled}
      onClick={onToggle}
      className={cn(
        'flex h-6 w-6 shrink-0 items-center justify-center rounded-md border transition',
        checked
          ? 'border-emerald-500 bg-emerald-500 text-white hover:bg-emerald-400'
          : 'border-slate-300 text-transparent hover:border-emerald-400 dark:border-slate-600',
        disabled && 'cursor-not-allowed border-slate-200 opacity-40 dark:border-slate-700',
      )}
    >
      <CheckIcon className="h-3.5 w-3.5" />
    </button>
  );
}

/** The days a `custom` habit counts, as a compact weekly toggle row. */
function DayPicker({ days, onChange }: { days: number[]; onChange: (days: number[]) => void }) {
  return (
    <div className="flex items-center gap-1" role="group" aria-label="Days this habit counts">
      {DAY_INITIALS.map((initial, day) => {
        const active = days.includes(day);
        return (
          <button
            key={DAY_NAMES[day]}
            type="button"
            role="switch"
            aria-checked={active}
            aria-label={DAY_NAMES[day]}
            title={DAY_NAMES[day]}
            onClick={() =>
              onChange(active ? days.filter((entry) => entry !== day) : [...days, day].sort((a, b) => a - b))
            }
            className={cn(
              'h-6 w-6 rounded-md text-[10px] font-semibold transition',
              active
                ? 'bg-emerald-500 text-white hover:bg-emerald-400'
                : 'bg-slate-100 text-slate-500 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-slate-700',
            )}
          >
            {initial}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Inline editor for one habit, opened from its name in the checklist.
 *
 * Text commits on blur (or Enter, which blurs) rather than on every keystroke: a
 * write per character would flood `localStorage` and make ⌘/Ctrl + Z undo a
 * single letter. Schedule and day changes are discrete, so they save at once.
 */
function HabitEditor({ habit, onPatch }: { habit: Habit; onPatch: (patch: Partial<Omit<Habit, 'id'>>) => void }) {
  const [name, setName] = useState(habit.name);
  const [emoji, setEmoji] = useState(habit.emoji);

  const commitName = () => {
    const next = name.trim();
    // An empty field is a half-finished rename, not a reason to lose the habit.
    if (next === '') setName(habit.name);
    else if (next !== habit.name) onPatch({ name: next });
  };

  const commitOnEnter = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') event.currentTarget.blur();
  };

  const changeSchedule = (next: HabitSchedule) => {
    // A custom habit with no days chosen is never scheduled, so it starts on
    // weekdays instead of arriving dead.
    onPatch(next === 'custom' && habit.days.length === 0 ? { schedule: next, days: [1, 2, 3, 4, 5] } : { schedule: next });
  };

  return (
    <div className="my-1 space-y-2 rounded-lg bg-slate-50 p-2 dark:bg-slate-800/50">
      <div className="flex items-center gap-2">
        <TextInput
          aria-label="Habit name"
          placeholder="Habit name"
          value={name}
          maxLength={HABIT_NAME_MAX}
          onChange={(event) => setName(event.target.value)}
          onBlur={commitName}
          onKeyDown={commitOnEnter}
          className="h-8 min-w-0 flex-1 px-2 py-1 text-xs"
        />
        <TextInput
          aria-label="Emoji"
          placeholder="🏃"
          value={emoji}
          // Code units, so allow the four a two-code-point glyph can need.
          maxLength={HABIT_EMOJI_MAX * 2}
          onChange={(event) => setEmoji(event.target.value)}
          onBlur={() => {
            if (emoji !== habit.emoji) onPatch({ emoji });
          }}
          onKeyDown={commitOnEnter}
          className="h-8 w-14 shrink-0 px-2 py-1 text-center text-xs"
        />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <SelectInput
          aria-label="Schedule"
          value={habit.schedule}
          options={SCHEDULE_OPTIONS}
          onChange={(event) => {
            if (isHabitSchedule(event.target.value)) changeSchedule(event.target.value);
          }}
          className="h-8 w-32 px-2 py-1 text-xs"
        />
        {habit.schedule === 'custom' ? <DayPicker days={habit.days} onChange={(days) => onPatch({ days })} /> : null}
      </div>
      <p className="text-[10px] leading-snug text-slate-400 dark:text-slate-500">
        {habit.schedule === 'custom' && habit.days.length === 0
          ? 'No days chosen yet, so this habit never counts.'
          : 'Saved when you leave the field. ⌘/Ctrl + Z undoes.'}
      </p>
    </div>
  );
}

/** Grid cells → Heatmap cells: a kept day is full intensity, a rest day is faded. */
function toHeatmapCells(columns: readonly HabitGridColumn[]): HeatmapCell[][] {
  return columns.map((column) =>
    column.cells.map((cell) => ({
      key: cell.key,
      level: cell.done ? 4 : 0,
      title: cell.label,
      muted: !cell.scheduled,
    })),
  );
}

/**
 * Daily habit checklist with current streaks and a contribution-style history.
 *
 * Habits live in the widget config, so the existing dashboard persistence carries
 * them with no extra storage layer. The ticker only decides which day "today" is:
 * the widget re-renders once a minute so the checklist rolls over at midnight, and
 * everything derived is memoised on the local day key, so a tick costs nothing.
 */
export function HabitsWidget({ config, updateConfig }: WidgetProps<HabitsConfig>) {
  const now = useNow(60_000);
  const todayKey = dayKey(now);
  // Stable for a whole day, which is what every memo below actually depends on.
  const today = useMemo(() => parseDayKey(todayKey) ?? new Date(), [todayKey]);

  const { habits, weeks, showHeatmap } = useMemo(() => normalizeHabitsConfig(config), [config]);

  /** Name being typed into the add field; committed on Add or Enter only. */
  const [draftName, setDraftName] = useState('');
  /** Habit whose editor is open, if any. One at a time keeps narrow widgets calm. */
  const [editingId, setEditingId] = useState<string | null>(null);

  const totals = useMemo(() => todayTotals(habits, today), [habits, today]);
  const rows = useMemo(
    () =>
      habits.map((habit) => ({
        habit,
        scheduled: isScheduledOn(habit, today),
        done: isDoneOn(habit, todayKey),
        streak: currentStreak(habit, today),
        rate: completionRate(habit, weeks * 7, today),
        columns: habitGrid([habit], weeks, today).columns,
      })),
    [habits, today, todayKey, weeks],
  );
  const full = habits.length >= MAX_HABITS;

  const addFromDraft = () => {
    const next = addHabit(habits, draftName);
    // A blank name, or the cap is already reached: nothing to save.
    if (next === habits) return;
    updateConfig({ habits: next });
    setDraftName('');
  };

  const toggleToday = (habit: Habit) => {
    const next = toggleDay(habit, todayKey);
    // An unscheduled day has nothing to save (its tick is disabled anyway).
    if (next === habit) return;
    updateConfig({ habits: updateHabit(habits, habit.id, { log: next.log }) });
  };

  const patchHabit = (habit: Habit, patch: Partial<Omit<Habit, 'id'>>) => {
    const next = updateHabit(habits, habit.id, patch);
    if (next === habits) return;
    updateConfig({ habits: next });
  };

  const removeFromList = (habit: Habit) => {
    const next = removeHabit(habits, habit.id);
    if (next === habits) return;
    setEditingId((current) => (current === habit.id ? null : current));
    updateConfig({ habits: next });
  };

  return (
    <div className="@container flex h-full min-h-0 flex-col gap-2 text-slate-700 dark:text-slate-200">
      {habits.length === 0 ? (
        <EmptyState
          size="sm"
          className="min-h-0 flex-1"
          icon={<HabitsIcon className="h-4 w-4" />}
          title="No habits yet"
          description="A habit is one checkbox a day: running, reading, practising an instrument. Add one below and tick it each day."
        />
      ) : (
        <>
          <ProgressBar
            className="shrink-0"
            value={totals.scheduled === 0 ? 0 : totals.done / totals.scheduled}
            tone="emerald"
            label="Habits kept today"
            caption="Today"
            valueLabel={totals.scheduled === 0 ? 'nothing scheduled' : `${totals.done} of ${totals.scheduled}`}
          />

          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto pr-0.5">
            <ul className="space-y-0.5">
              {rows.map(({ habit, scheduled, done, streak }) => (
                <li key={habit.id} className="group/habit">
                  <div className="flex items-center gap-2 rounded-lg px-1 py-1 transition hover:bg-slate-50 dark:hover:bg-slate-800/40">
                    <HabitTick
                      label={`${habit.name} done today`}
                      title={scheduled ? `${habit.name} · done today` : `${habit.name} · not scheduled today`}
                      checked={done}
                      disabled={!scheduled}
                      onToggle={() => toggleToday(habit)}
                    />
                    <button
                      type="button"
                      onClick={() => setEditingId((current) => (current === habit.id ? null : habit.id))}
                      aria-expanded={editingId === habit.id}
                      title={`Edit ${habit.name}`}
                      className="flex min-w-0 flex-1 items-center gap-1.5 rounded text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/50"
                    >
                      {habit.emoji ? (
                        <span aria-hidden="true" className="shrink-0 text-sm leading-none">
                          {habit.emoji}
                        </span>
                      ) : null}
                      <span
                        className={cn(
                          'truncate text-xs font-medium',
                          scheduled ? 'text-slate-700 dark:text-slate-200' : 'text-slate-400 dark:text-slate-500',
                        )}
                      >
                        {habit.name}
                      </span>
                      <PencilIcon className="h-3 w-3 shrink-0 text-slate-300 opacity-0 transition group-hover/habit:opacity-100 dark:text-slate-600" />
                    </button>
                    {/* Current streak: a flame and a day count, or a dash when
                        there is none yet. */}
                    <span
                      className={cn(
                        'inline-flex shrink-0 items-center gap-0.5 text-[11px] font-medium tabular-nums',
                        streak === 0 ? 'text-slate-300 dark:text-slate-600' : 'text-emerald-600 dark:text-emerald-400',
                      )}
                      title={streak === 0 ? 'No streak yet' : `${streak}-day streak`}
                    >
                      {streak > 0 ? <FlameIcon className="h-3.5 w-3.5 shrink-0" /> : null}
                      {formatStreak(streak)}
                    </span>
                    <IconButton
                      label={`Remove ${habit.name}`}
                      title={`Remove ${habit.name}. Undo with ⌘/Ctrl + Z`}
                      size="icon-sm"
                      variant="danger"
                      icon={<TrashIcon className="h-3.5 w-3.5" />}
                      onClick={() => removeFromList(habit)}
                      className="shrink-0 opacity-0 transition group-hover/habit:opacity-100 focus-visible:opacity-100"
                    />
                  </div>
                  {editingId === habit.id ? (
                    <HabitEditor key={habit.id} habit={habit} onPatch={(patch) => patchHabit(habit, patch)} />
                  ) : null}
                </li>
              ))}
            </ul>

            {showHeatmap ? (
              <div className="space-y-2 border-t border-slate-100 pt-2 dark:border-slate-800">
                {rows.map(({ habit, rate, columns }) => (
                  <Fragment key={habit.id}>
                    <div className="flex min-w-0 items-baseline justify-between gap-2 text-[10px] text-slate-400 dark:text-slate-500">
                      <span className="truncate font-medium text-slate-500 dark:text-slate-400">
                        {habit.emoji ? `${habit.emoji} ` : ''}
                        {habit.name}
                      </span>
                      <span className="shrink-0 tabular-nums">
                        last {weeks} weeks · {Math.round(rate * 100)}%
                      </span>
                    </div>
                    {/* The grid scrolls inside itself, so a narrow widget never
                        pushes its card sideways. */}
                    <div className="min-w-0 overflow-x-auto pb-0.5">
                      <Heatmap
                        columns={toHeatmapCells(columns)}
                        tone="emerald"
                        label={`${habit.name}: the last ${weeks} weeks`}
                      />
                    </div>
                  </Fragment>
                ))}
              </div>
            ) : null}
          </div>
        </>
      )}

      <div className="shrink-0 border-t border-slate-100 pt-2 dark:border-slate-800">
        <div className="flex items-center gap-2">
          <TextInput
            value={draftName}
            onChange={(event) => setDraftName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') addFromDraft();
            }}
            placeholder="Add a habit…"
            aria-label="New habit name"
            maxLength={HABIT_NAME_MAX}
            disabled={full}
            className="h-8 min-w-0 flex-1 px-2 py-1 text-xs"
          />
          <Button
            size="sm"
            variant="primary"
            icon={<PlusIcon className="h-3.5 w-3.5" />}
            onClick={addFromDraft}
            disabled={full || draftName.trim() === ''}
          >
            Add
          </Button>
        </div>
        {full ? (
          <p className="mt-1 text-[10px] text-slate-400 dark:text-slate-500">
            {MAX_HABITS} habits is the limit — remove one to add another.
          </p>
        ) : null}
      </div>
    </div>
  );
}

export const habitsWidget = defineWidget<HabitsConfig>({
  type: 'habits',
  name: 'Habit streaks',
  summary: 'Daily habits, current streaks and a four-week grid.',
  category: 'productivity',
  keywords: ['habits', 'streak', 'routine', 'daily', 'tracker', 'consistency'],
  icon: HabitsIcon,
  accent: 'emerald',
  defaultSize: { w: 3, h: 7, minW: 3, minH: 5 },
  defaultConfig: DEFAULT_HABITS_CONFIG,
  settings: SETTINGS,
  summarize: (config) => summarizeHabits(config),
  component: HabitsWidget,
});
