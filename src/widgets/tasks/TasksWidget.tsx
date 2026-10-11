import { useMemo, useRef, useState, type FormEvent } from 'react';
import { ArrowDownIcon, ArrowUpIcon, PlusIcon, TasksIcon, TrashIcon } from '@/components/icons';
import { Button, EmptyState, IconButton, ProgressBar, SelectInput, TextInput, TONE_CHIP } from '@/components/ui';
import { useNow } from '@/hooks/useNow';
import { daysBetween, relativeDayLabel } from '@/lib/time';
import {
  MAX_TASKS,
  MAX_TASK_TEXT,
  addTask,
  clearDone,
  dueState,
  isTaskPriority,
  normalizeTasks,
  removeTask,
  reorderTask,
  sortTasks,
  taskCounts,
  toggleTask,
  updateTask,
  type DueState,
  type TaskItem,
  type TaskPriority,
} from '@/lib/tasks';
import { cn } from '@/lib/utils';
import type { SettingField, WidgetProps } from '@/types';
import { defineWidget } from '@/widgets/define';

export type { DueState, TaskItem, TaskPriority } from '@/lib/tasks';

/**
 * Checklist config. The list itself lives here — no separate store — so the
 * dashboard's own persistence, export and embedded snapshot carry it for free.
 */
export type TasksConfig = {
  tasks: TaskItem[];
  /** Completed tasks are kept but not shown. */
  hideDone: boolean;
  showProgress: boolean;
  showDue: boolean;
};

const DEFAULT_TASKS_CONFIG: TasksConfig = {
  tasks: [],
  hideDone: false,
  showProgress: true,
  showDue: true,
};

const SETTINGS: readonly SettingField[] = [
  { key: 'hideDone', label: 'Hide completed tasks', type: 'switch' },
  { key: 'showProgress', label: 'Show progress', type: 'switch' },
  { key: 'showDue', label: 'Show due dates', type: 'switch' },
];

/** Priority of the next task added; the values come from the lib. */
const PRIORITY_OPTIONS: ReadonlyArray<{ label: string; value: TaskPriority }> = [
  { label: 'Normal', value: 'normal' },
  { label: 'High', value: 'high' },
  { label: 'Low', value: 'low' },
];

const PRIORITY_LABEL: Record<TaskPriority, string> = { high: 'High', normal: 'Normal', low: 'Low' };

/** Only the exceptions are marked — "normal" is the unremarkable default. */
const PRIORITY_CHIP: Record<TaskPriority, string | null> = {
  high: TONE_CHIP.rose,
  normal: null,
  low: TONE_CHIP.slate,
};

const DUE_CHIP: Record<DueState, string> = {
  overdue: TONE_CHIP.rose,
  today: TONE_CHIP.amber,
  tomorrow: TONE_CHIP.slate,
  later: TONE_CHIP.slate,
};

/**
 * Checklist with priorities and due dates.
 *
 * Everything the user can do is a real control (checkbox, date field, buttons) so
 * the whole widget is reachable from the keyboard; the reorder and delete buttons
 * are only *dimmed* on hover, never removed from the tab order.
 */
export function TasksWidget({ config, updateConfig }: WidgetProps<TasksConfig>) {
  const [draft, setDraft] = useState('');
  const [priority, setPriority] = useState<TaskPriority>('normal');
  const inputRef = useRef<HTMLInputElement | null>(null);
  /**
   * The due chips read "Today"/"Tomorrow", so the list has to re-render when the
   * day rolls over. The tick stays in local state — a timer must never write to
   * the config.
   */
  const now = useNow(60_000);

  const tasks = useMemo(() => normalizeTasks(config.tasks), [config.tasks]);
  const visible = useMemo(
    () => (config.hideDone ? tasks.filter((task) => !task.done) : tasks),
    [tasks, config.hideDone],
  );
  const counts = useMemo(() => taskCounts(tasks, now), [tasks, now]);
  const full = tasks.length >= MAX_TASKS;

  /**
   * Persist a field edit.
   *
   * The stored order is the visible order, and `sortTasks` keeps it that way: it
   * is re-applied whenever an edit changes a sort key, which is how a row sinks
   * when it is ticked or climbs when it gains a due date. The reorder buttons
   * (see {@link move}) are the one deliberate exception — they store the swapped
   * order instead, until the next field edit re-derives it.
   */
  const edit = (next: readonly TaskItem[]) => updateConfig({ tasks: sortTasks(next) });

  const addCurrent = (event?: FormEvent<HTMLFormElement>) => {
    event?.preventDefault();
    const text = draft.trim();
    if (text === '' || full) return;
    edit(addTask(tasks, text, priority));
    setDraft('');
    // Keep the caret in the field, so a run of tasks can be typed without
    // reaching for the mouse between each one.
    inputRef.current?.focus();
  };

  const toggle = (id: string) => edit(toggleTask(tasks, id));
  const setDue = (id: string, due: string | null) => edit(updateTask(tasks, id, { due }));
  const remove = (id: string) => updateConfig({ tasks: removeTask(tasks, id) });
  /** The swapped order is the visible one, so it is stored without re-sorting. */
  const move = (id: string, direction: -1 | 1) => updateConfig({ tasks: reorderTask(tasks, id, direction) });

  return (
    <div className="@container flex h-full flex-col gap-2">
      <form onSubmit={addCurrent} className="flex shrink-0 flex-wrap items-center gap-1.5">
        <TextInput
          ref={inputRef}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder="Add a task…"
          aria-label="New task"
          maxLength={MAX_TASK_TEXT}
          className="h-8 min-w-[7rem] flex-1 px-2.5 py-1 text-xs"
        />
        <SelectInput
          value={priority}
          onChange={(event) => setPriority(isTaskPriority(event.target.value) ? event.target.value : 'normal')}
          options={PRIORITY_OPTIONS}
          aria-label="Priority for new tasks"
          title="Priority for new tasks"
          className="h-8 w-auto shrink-0 px-2 py-1 text-xs"
        />
        <Button
          type="submit"
          size="sm"
          variant="primary"
          icon={<PlusIcon className="h-3.5 w-3.5" />}
          disabled={draft.trim() === '' || full}
          title={full ? `The list is full (${MAX_TASKS} tasks)` : 'Add the task'}
        >
          Add
        </Button>
      </form>

      {config.showProgress && counts.total > 0 ? (
        <ProgressBar
          className="shrink-0"
          tone="sky"
          label="Task progress"
          caption={`${counts.done} of ${counts.total} done`}
          value={counts.done / counts.total}
        />
      ) : null}

      {tasks.length === 0 ? (
        <div className="flex min-h-0 flex-1 items-center justify-center rounded-xl border border-dashed border-slate-200 dark:border-slate-800">
          <EmptyState
            size="sm"
            icon={<TasksIcon className="h-4 w-4" />}
            title="Nothing on the list yet. Add your first task above."
          />
        </div>
      ) : visible.length === 0 ? (
        <p className="flex-1 px-2 py-6 text-center text-xs text-slate-400 dark:text-slate-500">
          Every task is done — they are hidden by “Hide completed tasks”.
        </p>
      ) : (
        // No scroll container of its own: the widget body already scrolls.
        <ul className="flex-1 space-y-0.5">
          {visible.map((task, index) => {
            const days = task.due === null ? null : daysBetween(now, task.due);
            const state = task.due === null ? null : dueState(task.due, now);
            return (
              <li
                key={task.id}
                className="group/row flex items-center gap-1.5 rounded-lg px-1 py-1 transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/60"
              >
                <input
                  type="checkbox"
                  checked={task.done}
                  onChange={() => toggle(task.id)}
                  aria-label={task.done ? `Mark “${task.text}” as not done` : `Mark “${task.text}” as done`}
                  className="h-3.5 w-3.5 shrink-0 cursor-pointer accent-sky-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-500/50"
                />

                {PRIORITY_CHIP[task.priority] ? (
                  <span
                    className={cn(
                      'hidden shrink-0 rounded px-1 py-0.5 text-[10px] font-semibold @[14rem]:inline-flex',
                      PRIORITY_CHIP[task.priority],
                    )}
                    title={`${PRIORITY_LABEL[task.priority]} priority`}
                  >
                    {PRIORITY_LABEL[task.priority]}
                  </span>
                ) : null}

                <span
                  className={cn(
                    'min-w-0 flex-1 truncate text-xs text-slate-700 dark:text-slate-200',
                    task.done && 'text-slate-400 line-through dark:text-slate-500',
                  )}
                  title={task.text}
                >
                  {task.text}
                </span>

                {config.showDue && task.due !== null && state !== null && days !== null ? (
                  <span
                    className={cn('shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium tabular-nums', DUE_CHIP[state])}
                    title={`Due ${task.due}`}
                  >
                    {relativeDayLabel(days)}
                  </span>
                ) : null}

                {config.showDue ? (
                  <input
                    type="date"
                    value={task.due ?? ''}
                    onChange={(event) => setDue(task.id, event.target.value === '' ? null : event.target.value)}
                    aria-label={`Due date for ${task.text}`}
                    title="Due date"
                    className={cn(
                      'h-6 w-[6.6rem] shrink-0 rounded-md border border-slate-200 bg-white/70 px-1 text-[10px] text-slate-500',
                      'focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-500/20',
                      'dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-400 dark:[color-scheme:dark]',
                    )}
                  />
                ) : null}

                {/* Revealed on hover or focus for pointers, always visible on touch. */}
                <span className="flex shrink-0 items-center gap-0.5 opacity-100 transition-opacity sm:opacity-0 sm:group-focus-within/row:opacity-100 sm:group-hover/row:opacity-100">
                  <IconButton
                    label={`Move “${task.text}” up`}
                    size="icon-sm"
                    icon={<ArrowUpIcon className="h-3 w-3" />}
                    disabled={index === 0}
                    onClick={() => move(task.id, -1)}
                  />
                  <IconButton
                    label={`Move “${task.text}” down`}
                    size="icon-sm"
                    icon={<ArrowDownIcon className="h-3 w-3" />}
                    disabled={index === visible.length - 1}
                    onClick={() => move(task.id, 1)}
                  />
                  <IconButton
                    label={`Delete “${task.text}”`}
                    size="icon-sm"
                    variant="danger"
                    icon={<TrashIcon className="h-3 w-3" />}
                    onClick={() => remove(task.id)}
                  />
                </span>
              </li>
            );
          })}
        </ul>
      )}

      {counts.done > 0 ? (
        <div className="flex shrink-0 items-center justify-between gap-2 border-t border-slate-100 pt-2 text-[11px] text-slate-400 dark:border-slate-800 dark:text-slate-500">
          <span className="truncate tabular-nums">
            {counts.overdue > 0 ? `${counts.overdue} overdue` : `${counts.open} open`}
          </span>
          <Button size="sm" variant="ghost" onClick={() => updateConfig({ tasks: clearDone(tasks) })}>
            Clear completed
          </Button>
        </div>
      ) : null}
    </div>
  );
}

export const tasksWidget = defineWidget<TasksConfig>({
  type: 'tasks',
  name: 'Tasks',
  summary: 'A checklist with priorities and due dates.',
  category: 'productivity',
  keywords: ['tasks', 'todo', 'checklist', 'due', 'priority', 'reminders'],
  icon: TasksIcon,
  accent: 'sky',
  defaultSize: { w: 3, h: 7, minW: 2, minH: 4 },
  defaultConfig: DEFAULT_TASKS_CONFIG,
  settings: SETTINGS,
  summarize: (config) => {
    const tasks = normalizeTasks(config.tasks);
    if (tasks.length === 0) return 'Nothing on the list';
    const { open, done } = taskCounts(tasks);
    return `${open} open · ${done} done`;
  },
  component: TasksWidget,
});
