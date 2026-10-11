/**
 * Tasks model.
 *
 * The tasks widget keeps its checklist inside the widget config, so the list is
 * carried by the dashboard persistence (and by the embedded single-file snapshot)
 * with no extra storage layer. This module holds the pure part: repairing
 * whatever shape was loaded from an import or hand-edited storage, ordering,
 * counting, and the immutable operations a click performs.
 *
 * A due date is a calendar day to the user, not an instant, so it is stored as a
 * local `YYYY-MM-DD` key exactly as in `src/lib/time.ts`.
 */
import { asBoolean, asNumber, asString, createId, isRecord } from './utils';
import { daysBetween, toDayKey } from './time';

/** Hard cap on the checklist length; entries past this are dropped on load. */
export const MAX_TASKS = 200;

/** Longest single task text, in characters. */
export const MAX_TASK_TEXT = 240;

export type TaskPriority = 'low' | 'normal' | 'high';

/** One task in a checklist. */
export interface TaskItem {
  id: string;
  text: string;
  done: boolean;
  priority: TaskPriority;
  /** Local `YYYY-MM-DD`, or `null` when the task has no due date. */
  due: string | null;
  /** Creation timestamp (epoch ms); the last tie-break when ordering. */
  createdAt: number;
}

export const TASK_PRIORITIES: readonly TaskPriority[] = ['low', 'normal', 'high'];

export function isTaskPriority(value: unknown): value is TaskPriority {
  return TASK_PRIORITIES.includes(value as TaskPriority);
}

/** High sorts above normal, normal above low. */
const PRIORITY_RANK: Record<TaskPriority, number> = { high: 0, normal: 1, low: 2 };

function priorityRank(priority: TaskPriority): number {
  return PRIORITY_RANK[priority] ?? PRIORITY_RANK.normal;
}

/** Timestamps only decide the order, so a non-finite one reads as "oldest". */
function createdOrder(task: TaskItem): number {
  return Number.isFinite(task.createdAt) ? task.createdAt : 0;
}

/* -------------------------------------------------------------- normalising */

/**
 * Repair one stored entry, or `null` when it is not a task at all.
 *
 * A task is anything that is a record with a string `text`; every other field is
 * repaired rather than trusted, because a config is an untrusted import.
 */
function coerceTask(value: unknown, seen: Set<string>): TaskItem | null {
  if (!isRecord(value) || typeof value.text !== 'string') return null;
  const text = value.text.trim().slice(0, MAX_TASK_TEXT);
  if (text === '') return null;

  // A missing or duplicated id would break React keys and every lookup, so a
  // fresh one is minted instead of trusting the file.
  const rawId = asString(value.id).trim();
  const id = rawId === '' || seen.has(rawId) ? createId('task') : rawId;
  seen.add(id);

  return {
    id,
    text,
    done: asBoolean(value.done, false),
    priority: isTaskPriority(value.priority) ? value.priority : 'normal',
    due: toDayKey(asString(value.due).trim()),
    // Deliberately not `Date.now()`: normalising has to be deterministic, and an
    // entry without a timestamp is simply the oldest of its group.
    createdAt: asNumber(value.createdAt, 0),
  };
}

/** Normalise any loaded checklist: drop rubbish, clamp lengths, cap the count. */
export function normalizeTasks(value: unknown): TaskItem[] {
  if (!Array.isArray(value)) return [];
  const tasks: TaskItem[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (tasks.length >= MAX_TASKS) break;
    const task = coerceTask(entry, seen);
    if (task) tasks.push(task);
  }
  return tasks;
}

/* ---------------------------------------------------------------- ordering */

/** Soonest due date first; tasks without one sort after every dated task. */
function compareDue(a: TaskItem, b: TaskItem): number {
  if (a.due === b.due) return 0;
  if (a.due === null) return 1;
  if (b.due === null) return -1;
  // Local `YYYY-MM-DD` keys compare correctly as plain strings.
  return a.due < b.due ? -1 : 1;
}

/**
 * The order the checklist is shown in: open before done, then soonest due date,
 * then priority (high → low), then oldest first.
 *
 * Pure — the input array is left alone.
 */
export function sortTasks(tasks: readonly TaskItem[]): TaskItem[] {
  return [...tasks].sort((a, b) => {
    if (a.done !== b.done) return a.done ? 1 : -1;
    const due = compareDue(a, b);
    if (due !== 0) return due;
    const priority = priorityRank(a.priority) - priorityRank(b.priority);
    if (priority !== 0) return priority;
    return createdOrder(a) - createdOrder(b);
  });
}

/** How urgent a due date is, or `null` when there is no usable one. */
export type DueState = 'overdue' | 'today' | 'tomorrow' | 'later';

/** Classify a due date relative to `now` (defaults to the current instant). */
export function dueState(due: string | null, now: Date = new Date()): DueState | null {
  if (due === null) return null;
  const days = daysBetween(now, due);
  if (days === null) return null;
  if (days < 0) return 'overdue';
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  return 'later';
}

/* ------------------------------------------------------------------ counts */

export interface TaskCounts {
  open: number;
  done: number;
  total: number;
  /** Open tasks whose due date has already passed. */
  overdue: number;
}

/** Count a checklist. `now` is injectable so the overdue count is testable. */
export function taskCounts(tasks: readonly TaskItem[], now: Date = new Date()): TaskCounts {
  let open = 0;
  let done = 0;
  let overdue = 0;
  for (const task of tasks) {
    if (task.done) {
      done += 1;
      continue;
    }
    open += 1;
    if (dueState(task.due, now) === 'overdue') overdue += 1;
  }
  return { open, done, total: tasks.length, overdue };
}

/* --------------------------------------------------------------- mutations */

/**
 * Append a task.
 *
 * An empty text, or a list already at {@link MAX_TASKS}, is a no-op that returns
 * the input unchanged — the widget never silently drops a task the user typed.
 */
export function addTask(tasks: readonly TaskItem[], text: string, priority: TaskPriority = 'normal'): TaskItem[] {
  const trimmed = text.trim().slice(0, MAX_TASK_TEXT);
  if (trimmed === '' || tasks.length >= MAX_TASKS) return tasks as TaskItem[];
  return [
    ...tasks,
    {
      id: createId('task'),
      text: trimmed,
      done: false,
      priority: isTaskPriority(priority) ? priority : 'normal',
      due: null,
      createdAt: Date.now(),
    },
  ];
}

/** Flip one task's checkbox. Unknown ids return the input unchanged. */
export function toggleTask(tasks: readonly TaskItem[], id: string): TaskItem[] {
  let changed = false;
  const next = tasks.map((task) => {
    if (task.id !== id) return task;
    changed = true;
    return { ...task, done: !task.done };
  });
  return changed ? next : (tasks as TaskItem[]);
}

/** Remove one task. Unknown ids return the input unchanged. */
export function removeTask(tasks: readonly TaskItem[], id: string): TaskItem[] {
  const next = tasks.filter((task) => task.id !== id);
  return next.length === tasks.length ? (tasks as TaskItem[]) : next;
}

/**
 * Patch one task.
 *
 * The id is never patchable, and each touched field is repaired the way a loaded
 * config is — an empty text keeps the old one instead of producing a task with
 * nothing to show.
 */
export function updateTask(
  tasks: readonly TaskItem[],
  id: string,
  patch: Partial<Omit<TaskItem, 'id'>>,
): TaskItem[] {
  let changed = false;
  const next = tasks.map((task) => {
    if (task.id !== id) return task;
    changed = true;

    const text = typeof patch.text === 'string' ? patch.text.trim().slice(0, MAX_TASK_TEXT) : task.text;
    const createdAt =
      typeof patch.createdAt === 'number' && Number.isFinite(patch.createdAt) ? patch.createdAt : task.createdAt;
    return {
      id: task.id,
      text: text === '' ? task.text : text,
      done: typeof patch.done === 'boolean' ? patch.done : task.done,
      priority: isTaskPriority(patch.priority) ? patch.priority : task.priority,
      due: 'due' in patch ? toDayKey(asString(patch.due).trim()) : task.due,
      createdAt,
    };
  });
  return changed ? next : (tasks as TaskItem[]);
}

/** Drop every completed task. A list with none returns the input unchanged. */
export function clearDone(tasks: readonly TaskItem[]): TaskItem[] {
  const next = tasks.filter((task) => !task.done);
  return next.length === tasks.length ? (tasks as TaskItem[]) : next;
}

/**
 * Swap a task with its neighbour one place up (`-1`) or down (`1`).
 *
 * The neighbour is found by index in {@link sortTasks} output — the order the
 * user is looking at, which is not necessarily the order the tasks happen to sit
 * in — and the result is that order with the two entries swapped. The widget
 * stores it as its visible order, so the row really moves one place; moves past
 * either end, and unknown ids, are no-ops that return the input unchanged.
 *
 * Because the running order is derived from the sort keys, a manual move is an
 * exception to the ranking rules rather than a new ranking: the next edit that
 * changes a key (a tick, a new due date) re-derives the order.
 */
export function reorderTask(tasks: readonly TaskItem[], id: string, direction: -1 | 1): TaskItem[] {
  const order = sortTasks(tasks);
  const index = order.findIndex((task) => task.id === id);
  const target = index + direction;
  if (index === -1 || target < 0 || target >= order.length) return tasks as TaskItem[];

  // `order` is already a copy, so the swap cannot reach the caller's array.
  [order[index], order[target]] = [order[target], order[index]];
  return order;
}
