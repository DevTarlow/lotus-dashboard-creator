import { describe, expect, it } from 'vitest';
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
  type TaskItem,
} from '@/lib/tasks';
import { addDays, dayKey } from '@/lib/time';

/** Compact task factory: everything except the id has a sensible default. */
function task(id: string, patch: Partial<Omit<TaskItem, 'id'>> = {}): TaskItem {
  return {
    id,
    text: patch.text ?? `Task ${id}`,
    done: patch.done ?? false,
    priority: patch.priority ?? 'normal',
    due: patch.due ?? null,
    createdAt: patch.createdAt ?? 0,
  };
}

const ids = (tasks: readonly TaskItem[]): string[] => tasks.map((entry) => entry.id);

/** Simulate a hand-edited import: values a typed caller could never produce. */
function junkPatch(patch: Record<string, unknown>): Partial<Omit<TaskItem, 'id'>> {
  return patch as unknown as Partial<Omit<TaskItem, 'id'>>;
}

/** A fixed instant, so every day-relative expectation is deterministic. */
const NOW = new Date(2026, 4, 20, 9, 30);

const day = (offset: number): string => dayKey(addDays(NOW, offset));

describe('isTaskPriority', () => {
  it('accepts the three priorities and nothing else', () => {
    expect(isTaskPriority('high')).toBe(true);
    expect(isTaskPriority('normal')).toBe(true);
    expect(isTaskPriority('low')).toBe(true);
    expect(isTaskPriority('urgent')).toBe(false);
    expect(isTaskPriority(1)).toBe(false);
    expect(isTaskPriority(null)).toBe(false);
  });
});

describe('normalizeTasks', () => {
  it('returns nothing for a non-array value', () => {
    expect(normalizeTasks(undefined)).toEqual([]);
    expect(normalizeTasks(null)).toEqual([]);
    expect(normalizeTasks('milk')).toEqual([]);
    expect(normalizeTasks({ text: 'milk' })).toEqual([]);
  });

  it('drops entries that are not tasks', () => {
    const raw = [null, 42, 'milk', [], {}, { text: 7 }, { text: '' }, { text: '   ' }, { text: 'Buy milk' }];
    expect(ids(normalizeTasks(raw))).toHaveLength(1);
    expect(normalizeTasks(raw)[0].text).toBe('Buy milk');
  });

  it('repairs a partial entry with the documented defaults', () => {
    const [entry] = normalizeTasks([{ text: 'Call the plumber' }]);
    expect(entry).toMatchObject({ text: 'Call the plumber', done: false, priority: 'normal', due: null, createdAt: 0 });
    expect(entry.id).not.toBe('');
  });

  it('keeps well-formed foreign values', () => {
    const [entry] = normalizeTasks([
      { id: 'task-1', text: 'Renew passport', done: true, priority: 'high', due: '2026-05-22', createdAt: 1234 },
    ]);
    expect(entry).toEqual({
      id: 'task-1',
      text: 'Renew passport',
      done: true,
      priority: 'high',
      due: '2026-05-22',
      createdAt: 1234,
    });
  });

  it('rejects unusable due dates and unknown priorities', () => {
    const raw = [
      { text: 'a', due: '2026-02-30' },
      { text: 'b', due: 'tomorrow' },
      { text: 'c', due: 20260520 },
      { text: 'd', priority: 'urgent' },
      { text: 'e', done: 'yes' },
      { text: 'f', createdAt: 'yesterday' },
    ];
    expect(normalizeTasks(raw)).toMatchObject([
      { text: 'a', due: null },
      { text: 'b', due: null },
      { text: 'c', due: null },
      { text: 'd', priority: 'normal' },
      { text: 'e', done: false },
      { text: 'f', createdAt: 0 },
    ]);
  });

  it('trims text and clamps it to the maximum length', () => {
    const long = 'x'.repeat(MAX_TASK_TEXT + 80);
    const [entry] = normalizeTasks([{ text: `  ${long}  ` }]);
    expect(entry.text).toHaveLength(MAX_TASK_TEXT);
    expect(entry.text).toBe('x'.repeat(MAX_TASK_TEXT));
  });

  it('mints ids that are missing, blank or duplicated', () => {
    const tasks = normalizeTasks([{ text: 'a' }, { text: 'b', id: '   ' }, { text: 'c', id: 'dupe' }, { text: 'd', id: 'dupe' }]);
    expect(tasks).toHaveLength(4);
    expect(tasks[2].id).toBe('dupe');
    expect(new Set(ids(tasks)).size).toBe(4);
    expect(tasks[0].id.startsWith('task_')).toBe(true);
    expect(tasks[3].id).not.toBe('dupe');
  });

  it('caps the list at MAX_TASKS, keeping the first entries', () => {
    const raw = Array.from({ length: MAX_TASKS + 25 }, (_, index) => ({ id: `id-${index}`, text: `Task ${index}` }));
    const tasks = normalizeTasks(raw);
    expect(tasks).toHaveLength(MAX_TASKS);
    expect(tasks[0].id).toBe('id-0');
    expect(tasks[MAX_TASKS - 1].id).toBe(`id-${MAX_TASKS - 1}`);
  });

  it('leaves the input array and its entries untouched', () => {
    const raw = [{ id: 'a', text: '  Buy milk  ' }, { text: 'Eggs' }];
    const before = structuredClone(raw);
    normalizeTasks(raw);
    expect(raw).toEqual(before);
  });
});

describe('sortTasks', () => {
  it('puts open tasks before completed ones', () => {
    const list = [task('done', { done: true, createdAt: 1 }), task('open', { createdAt: 9 })];
    expect(ids(sortTasks(list))).toEqual(['open', 'done']);
  });

  it('orders by due date, soonest first, and undated tasks last', () => {
    const list = [
      task('none'),
      task('next-week', { due: '2026-05-27' }),
      task('today', { due: '2026-05-20' }),
      task('tomorrow', { due: '2026-05-21' }),
    ];
    expect(ids(sortTasks(list))).toEqual(['today', 'tomorrow', 'next-week', 'none']);
  });

  it('breaks a due-date tie by priority, high first', () => {
    const list = [
      task('low', { due: '2026-05-20', priority: 'low' }),
      task('normal', { due: '2026-05-20', priority: 'normal' }),
      task('high', { due: '2026-05-20', priority: 'high' }),
    ];
    expect(ids(sortTasks(list))).toEqual(['high', 'normal', 'low']);
  });

  it('breaks a full tie by the oldest createdAt', () => {
    const list = [task('newer', { createdAt: 20 }), task('older', { createdAt: 10 })];
    expect(ids(sortTasks(list))).toEqual(['older', 'newer']);
  });

  it('applies the rules in order: done sinks even when it is the most urgent', () => {
    const list = [
      task('done-today', { done: true, due: '2026-05-20', priority: 'high', createdAt: 1 }),
      task('open-undated', { createdAt: 50 }),
    ];
    expect(ids(sortTasks(list))).toEqual(['open-undated', 'done-today']);
  });

  it('does not mutate or reorder the input array', () => {
    const list = [task('b', { createdAt: 2 }), task('a', { createdAt: 1 })];
    const before = structuredClone(list);
    const sorted = sortTasks(list);
    expect(ids(sorted)).toEqual(['a', 'b']);
    expect(list).toEqual(before);
    expect(sorted).not.toBe(list);
  });
});

describe('dueState', () => {
  it('is null without a due date or with an unusable one', () => {
    expect(dueState(null, NOW)).toBeNull();
    expect(dueState('not-a-date', NOW)).toBeNull();
    expect(dueState('2026-02-30', NOW)).toBeNull();
  });

  it('classifies past, today, tomorrow and later days', () => {
    expect(dueState(day(-3), NOW)).toBe('overdue');
    expect(dueState(day(-1), NOW)).toBe('overdue');
    expect(dueState(day(0), NOW)).toBe('today');
    expect(dueState(day(1), NOW)).toBe('tomorrow');
    expect(dueState(day(2), NOW)).toBe('later');
    expect(dueState(day(365), NOW)).toBe('later');
  });

  it('reads the day, not the instant', () => {
    // 23:59 on the due day is still "today"; 00:01 the next day is overdue.
    expect(dueState('2026-05-20', new Date(2026, 4, 20, 23, 59))).toBe('today');
    expect(dueState('2026-05-20', new Date(2026, 4, 21, 0, 1))).toBe('overdue');
  });
});

describe('taskCounts', () => {
  it('counts an empty list as all zeroes', () => {
    expect(taskCounts([], NOW)).toEqual({ open: 0, done: 0, total: 0, overdue: 0 });
  });

  it('counts open, done and total', () => {
    const list = [task('a'), task('b', { done: true }), task('c', { done: true })];
    expect(taskCounts(list, NOW)).toEqual({ open: 1, done: 2, total: 3, overdue: 0 });
  });

  it('counts only open tasks past their due date as overdue', () => {
    const list = [
      task('late', { due: day(-2) }),
      task('today', { due: day(0) }),
      task('later', { due: day(4) }),
      task('undated'),
      task('finished-late', { due: day(-9), done: true }),
    ];
    expect(taskCounts(list, NOW)).toEqual({ open: 4, done: 1, total: 5, overdue: 1 });
  });
});

describe('addTask', () => {
  it('appends a task with the documented defaults', () => {
    const list = [task('existing')];
    const next = addTask(list, 'Buy milk');
    expect(next).toHaveLength(2);
    expect(next[0]).toBe(list[0]);
    expect(next[1]).toMatchObject({ text: 'Buy milk', done: false, priority: 'normal', due: null });
    expect(next[1].id).not.toBe('');
    expect(next[1].createdAt).toBeGreaterThan(0);
    expect(list).toHaveLength(1);
  });

  it('stores the priority it was given', () => {
    expect(addTask([], 'Ship it', 'high')[0].priority).toBe('high');
    expect(addTask([], 'Someday', 'low')[0].priority).toBe('low');
  });

  it('trims the text and clamps it to the maximum length', () => {
    expect(addTask([], '  Call mum  ')[0].text).toBe('Call mum');
    expect(addTask([], 'y'.repeat(MAX_TASK_TEXT + 10))[0].text).toHaveLength(MAX_TASK_TEXT);
  });

  it('ignores an empty add', () => {
    const list = [task('a')];
    expect(addTask(list, '')).toBe(list);
    expect(addTask(list, '   ')).toBe(list);
  });

  it('refuses to grow past the cap', () => {
    const full = Array.from({ length: MAX_TASKS }, (_, index) => task(`id-${index}`));
    expect(addTask(full, 'One more')).toBe(full);
  });

  it('mints a fresh id every time', () => {
    const list = addTask(addTask([], 'a'), 'b');
    expect(new Set(ids(list)).size).toBe(2);
  });
});

describe('toggleTask', () => {
  it('flips one task and leaves the others alone', () => {
    const list = [task('a'), task('b')];
    const next = toggleTask(list, 'b');
    expect(next[1].done).toBe(true);
    expect(next[0]).toBe(list[0]);
    expect(toggleTask(next, 'b')[1].done).toBe(false);
    expect(list[1].done).toBe(false);
  });

  it('returns the input unchanged for an unknown id', () => {
    const list = [task('a')];
    expect(toggleTask(list, 'missing')).toBe(list);
  });
});

describe('removeTask', () => {
  it('removes one task, leaving the input alone', () => {
    const list = [task('a'), task('b')];
    expect(ids(removeTask(list, 'a'))).toEqual(['b']);
    expect(ids(list)).toEqual(['a', 'b']);
  });

  it('returns the input unchanged for an unknown id', () => {
    const list = [task('a')];
    expect(removeTask(list, 'missing')).toBe(list);
  });
});

describe('updateTask', () => {
  it('patches the due date and can clear it again', () => {
    const list = [task('a'), task('b')];
    const withDue = updateTask(list, 'a', { due: '2026-05-22' });
    expect(withDue[0].due).toBe('2026-05-22');
    expect(withDue[1]).toBe(list[1]);
    expect(updateTask(withDue, 'a', { due: null })[0].due).toBeNull();
    // The date input reports an empty string when the user clears the field.
    expect(updateTask(withDue, 'a', { due: '' })[0].due).toBeNull();
    expect(list[0].due).toBeNull();
  });

  it('never lets a patch change the id', () => {
    const list = [task('a')];
    const next = updateTask(list, 'a', junkPatch({ id: 'hacked', done: true }));
    expect(next[0].id).toBe('a');
    expect(next[0].done).toBe(true);
  });

  it('repairs junk in a patch instead of trusting it', () => {
    const list = [task('a', { due: '2026-05-22', priority: 'high' })];
    const next = updateTask(list, 'a', junkPatch({ text: '   ', due: 'whenever', priority: 'urgent' }));
    expect(next[0].text).toBe(list[0].text);
    expect(next[0].due).toBeNull();
    expect(next[0].priority).toBe('high');
  });

  it('returns the input unchanged for an unknown id', () => {
    const list = [task('a')];
    expect(updateTask(list, 'missing', { done: true })).toBe(list);
  });
});

describe('clearDone', () => {
  it('drops completed tasks and keeps the rest in order', () => {
    const list = [task('a', { done: true }), task('b'), task('c', { done: true })];
    expect(ids(clearDone(list))).toEqual(['b']);
    expect(ids(list)).toEqual(['a', 'b', 'c']);
  });

  it('returns the input unchanged when nothing is done', () => {
    const list = [task('a'), task('b')];
    expect(clearDone(list)).toBe(list);
  });
});

describe('reorderTask', () => {
  it('swaps a task with the neighbour above it', () => {
    const list = [task('a', { createdAt: 1 }), task('b', { createdAt: 2 }), task('c', { createdAt: 3 })];
    const next = reorderTask(list, 'b', -1);
    expect(ids(next)).toEqual(['b', 'a', 'c']);
    expect(ids(list)).toEqual(['a', 'b', 'c']);
  });

  it('swaps a task with the neighbour below it', () => {
    const list = [task('a', { createdAt: 1 }), task('b', { createdAt: 2 }), task('c', { createdAt: 3 })];
    expect(ids(reorderTask(list, 'b', 1))).toEqual(['a', 'c', 'b']);
  });

  it('finds the neighbour in the order the user sees, not in the stored array', () => {
    // Stored newest-first: the visible order is still oldest-first, so "b" is
    // second on screen and moving it up puts it first.
    const list = [task('b', { createdAt: 2 }), task('a', { createdAt: 1 }), task('c', { createdAt: 3 })];
    const next = reorderTask(list, 'b', -1);
    expect(ids(next)).toEqual(['b', 'a', 'c']);
    expect(ids(list)).toEqual(['b', 'a', 'c']);
    expect(next).not.toBe(list);
  });

  it('lets a manual move override the ranking until the order is re-derived', () => {
    const list = [task('high', { priority: 'high', createdAt: 1 }), task('low', { priority: 'low', createdAt: 2 })];
    const next = reorderTask(list, 'low', -1);
    expect(ids(next)).toEqual(['low', 'high']);
    // The sort keys are untouched, so the next re-derivation puts "high" back on top.
    expect(ids(sortTasks(next))).toEqual(['high', 'low']);
    expect(ids(list)).toEqual(['high', 'low']);
  });

  it('cannot move the first task up or the last task down', () => {
    const list = [task('a', { createdAt: 1 }), task('b', { createdAt: 2 })];
    expect(reorderTask(list, 'a', -1)).toBe(list);
    expect(reorderTask(list, 'b', 1)).toBe(list);
  });

  it('ignores an unknown id', () => {
    const list = [task('a'), task('b')];
    expect(reorderTask(list, 'missing', 1)).toBe(list);
    expect(reorderTask([], 'missing', -1)).toEqual([]);
  });
});
