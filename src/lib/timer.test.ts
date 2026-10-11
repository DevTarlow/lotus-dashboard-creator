import { describe, expect, it } from 'vitest';
import {
  MAX_SESSIONS,
  PHASE_LABEL,
  completePhase,
  formatMinutes,
  nextPhase,
  normalizeTimerConfig,
  pause,
  phaseDurationMs,
  reset,
  snapshot,
  start,
  todayFocusMinutes,
  type TimerConfig,
  type TimerSession,
} from '@/lib/timer';

const WORK_MS = 25 * 60_000;
const SHORT_BREAK_MS = 5 * 60_000;

const DEFAULTS: TimerConfig = {
  mode: 'pomodoro',
  workMinutes: 25,
  shortBreakMinutes: 5,
  longBreakMinutes: 15,
  longBreakEvery: 4,
  notify: false,
  phase: 'idle',
  running: false,
  startedAt: null,
  accumulatedMs: 0,
  completedFocus: 0,
  sessions: [],
};

/** A config with a partial override — every test starts from the shipped defaults. */
function config(patch: Partial<TimerConfig> = {}): TimerConfig {
  return { ...DEFAULTS, ...patch };
}

function session(id: string, endedAt: number, minutes = 25, kind: TimerSession['kind'] = 'focus'): TimerSession {
  return { id, endedAt, minutes, kind };
}

describe('phaseDurationMs', () => {
  it('reads the configured length of each pomodoro phase', () => {
    expect(phaseDurationMs(config(), 'focus')).toBe(WORK_MS);
    expect(phaseDurationMs(config(), 'short-break')).toBe(SHORT_BREAK_MS);
    expect(phaseDurationMs(config(), 'long-break')).toBe(15 * 60_000);
  });

  it('shows the work length while idle, i.e. the session waiting to start', () => {
    expect(phaseDurationMs(config(), 'idle')).toBe(WORK_MS);
  });

  it('has no length in stopwatch mode — it counts up', () => {
    const stopwatch = config({ mode: 'stopwatch' });
    expect(phaseDurationMs(stopwatch, 'focus')).toBe(0);
    expect(phaseDurationMs(stopwatch, 'idle')).toBe(0);
  });
});

describe('snapshot', () => {
  it('is zeroed and not expired while idle', () => {
    expect(snapshot(config(), 5_000)).toEqual({
      phase: 'idle',
      running: false,
      elapsedMs: 0,
      remainingMs: WORK_MS,
      progress: 0,
      expired: false,
    });
  });

  it('counts up from the start stamp while running', () => {
    const running = config({ phase: 'focus', running: true, startedAt: 1_000 });
    const state = snapshot(running, 91_000);
    expect(state.elapsedMs).toBe(90_000);
    expect(state.remainingMs).toBe(WORK_MS - 90_000);
    expect(state.progress).toBeCloseTo(90_000 / WORK_MS);
    expect(state.expired).toBe(false);
  });

  it('freezes the elapsed time while paused', () => {
    const paused = config({ phase: 'focus', running: false, startedAt: null, accumulatedMs: 60_000 });
    expect(snapshot(paused, 999_999).elapsedMs).toBe(60_000);
  });

  it('adds the banked time to the run in progress', () => {
    const resumed = config({ phase: 'focus', running: true, startedAt: 10_000, accumulatedMs: 60_000 });
    expect(snapshot(resumed, 40_000).elapsedMs).toBe(90_000);
  });

  it('derives the elapsed time from the clock across a throttled gap', () => {
    // The tab was hidden for the whole phase: no tick ever fired, but the run
    // still finished 25 minutes after it started.
    const running = config({ phase: 'focus', running: true, startedAt: 0 });
    const state = snapshot(running, 45 * 60_000);
    expect(state.elapsedMs).toBe(45 * 60_000);
    expect(state.remainingMs).toBe(0);
    expect(state.progress).toBe(1);
    expect(state.expired).toBe(true);
  });

  it('clamps a clock that runs backwards instead of going negative', () => {
    const running = config({ phase: 'focus', running: true, startedAt: 10_000, accumulatedMs: 5_000 });
    expect(snapshot(running, 9_000).elapsedMs).toBe(5_000);
  });

  it('sweeps the stopwatch ring once an hour and never expires', () => {
    const running = config({ mode: 'stopwatch', running: true, startedAt: 0 });
    const state = snapshot(running, 90 * 60_000);
    expect(state.progress).toBeCloseTo(0.5);
    expect(state.remainingMs).toBe(0);
    expect(state.expired).toBe(false);
    expect(snapshot(running, 2 * 3_600_000).progress).toBe(0);
  });
});

describe('expired boundaries', () => {
  const running = config({ phase: 'focus', running: true, startedAt: 0 });

  it('is false one millisecond before the phase is over', () => {
    expect(snapshot(running, WORK_MS - 1).expired).toBe(false);
  });

  it('is true exactly at the duration', () => {
    expect(snapshot(running, WORK_MS).expired).toBe(true);
    expect(snapshot(running, WORK_MS).remainingMs).toBe(0);
  });

  it('stays true one millisecond past it', () => {
    expect(snapshot(running, WORK_MS + 1).expired).toBe(true);
  });
});

describe('start', () => {
  it('opens a focus session from idle', () => {
    expect(start(config(), 5_000)).toEqual({ phase: 'focus', running: true, startedAt: 5_000, accumulatedMs: 0 });
  });

  it('resumes a paused phase without clearing the bank', () => {
    const paused = config({ phase: 'short-break', running: false, accumulatedMs: 30_000 });
    expect(start(paused, 9_000)).toEqual({
      phase: 'short-break',
      running: true,
      startedAt: 9_000,
      accumulatedMs: 30_000,
    });
  });

  it('is a no-op when the timer is already running', () => {
    expect(start(config({ phase: 'focus', running: true, startedAt: 1 }), 500)).toEqual({});
  });

  it('starts the stopwatch without inventing a phase', () => {
    expect(start(config({ mode: 'stopwatch' }), 7)).toEqual({ running: true, startedAt: 7 });
  });
});

describe('pause', () => {
  it('banks the elapsed time', () => {
    const running = config({ phase: 'focus', running: true, startedAt: 1_000, accumulatedMs: 500 });
    expect(pause(running, 3_000)).toEqual({ running: false, startedAt: null, accumulatedMs: 2_500 });
  });

  it('is harmless when the timer is already stopped', () => {
    expect(pause(config({ accumulatedMs: 42 }), 9_999)).toEqual({ running: false, startedAt: null });
  });

  it('round-trips with start, so pausing loses no time', () => {
    const running = config({ phase: 'focus', running: true, startedAt: 0 });
    const paused = { ...running, ...pause(running, 60_000) };
    expect(snapshot(paused, 120_000).elapsedMs).toBe(60_000);
    const resumed = { ...paused, ...start(paused, 120_000) };
    expect(snapshot(resumed, 150_000).elapsedMs).toBe(90_000);
  });
});

describe('reset', () => {
  it('zeroes the run but keeps the configuration, the log and the block counter', () => {
    const running = config({
      phase: 'focus',
      running: true,
      startedAt: 1_000,
      accumulatedMs: 5_000,
      completedFocus: 2,
      sessions: [session('s1', 1_000)],
    });
    const patch = reset(running);
    expect(patch).toMatchObject({ phase: 'idle', running: false, startedAt: null, accumulatedMs: 0 });
    expect(patch.completedFocus).toBe(2);
    expect(patch.sessions).toEqual(running.sessions);

    const after = { ...running, ...patch };
    expect(after.workMinutes).toBe(25);
    expect(snapshot(after, 99_999).elapsedMs).toBe(0);
  });
});

describe('nextPhase', () => {
  it('sends a finished focus session to a short break', () => {
    expect(nextPhase(config({ completedFocus: 1 }), 'focus')).toBe('short-break');
    expect(nextPhase(config({ completedFocus: 3 }), 'focus')).toBe('short-break');
  });

  it('sends the fourth focus session of a block to the long break', () => {
    expect(nextPhase(config({ completedFocus: 4 }), 'focus')).toBe('long-break');
    expect(nextPhase(config({ completedFocus: 8, longBreakEvery: 4 }), 'focus')).toBe('long-break');
  });

  it('honours a custom block length', () => {
    expect(nextPhase(config({ completedFocus: 2, longBreakEvery: 2 }), 'focus')).toBe('long-break');
    expect(nextPhase(config({ completedFocus: 2, longBreakEvery: 8 }), 'focus')).toBe('short-break');
  });

  it('never calls an empty block a long break', () => {
    expect(nextPhase(config({ completedFocus: 0 }), 'focus')).toBe('short-break');
    expect(nextPhase(config({ completedFocus: 0, longBreakEvery: 2 }), 'focus')).toBe('short-break');
  });

  it('always hands a break (or an idle timer) back to focus', () => {
    expect(nextPhase(config(), 'short-break')).toBe('focus');
    expect(nextPhase(config(), 'long-break')).toBe('focus');
    expect(nextPhase(config(), 'idle')).toBe('focus');
  });
});

describe('completePhase', () => {
  it('logs the finished focus session and queues a short break', () => {
    const running = config({ phase: 'focus', running: true, startedAt: 0, completedFocus: 1 });
    const patch = completePhase(running, WORK_MS);

    expect(patch.sessions).toHaveLength(1);
    expect(patch.sessions?.[0]).toMatchObject({ endedAt: WORK_MS, minutes: 25, kind: 'focus' });
    expect(patch.phase).toBe('short-break');
    expect(patch.running).toBe(false);
    expect(patch.startedAt).toBeNull();
    expect(patch.accumulatedMs).toBe(0);
    expect(patch.completedFocus).toBe(2);
  });

  it('logs a finished break too, without counting it as focus', () => {
    const running = config({ phase: 'short-break', running: true, startedAt: 0, completedFocus: 2 });
    const patch = completePhase(running, SHORT_BREAK_MS);
    expect(patch.sessions?.[0]).toMatchObject({ minutes: 5, kind: 'short-break' });
    expect(patch.phase).toBe('focus');
    expect(patch.completedFocus).toBe(2);
  });

  it('rounds a partial phase up to at least one minute', () => {
    const running = config({ phase: 'short-break', running: true, startedAt: 0 });
    expect(completePhase(running, 30_000).sessions?.[0].minutes).toBe(1);
    expect(completePhase(running, 1).sessions?.[0].minutes).toBe(1);
  });

  it('never logs longer than the phase was, however late the tick arrives', () => {
    // The laptop slept for hours; the focus session was still 25 minutes long.
    const running = config({ phase: 'focus', running: true, startedAt: 0 });
    expect(completePhase(running, 4 * 3_600_000).sessions?.[0].minutes).toBe(25);
    // A tick a few hundred ms late must not round 25 minutes up to 26.
    expect(completePhase(running, WORK_MS + 400).sessions?.[0].minutes).toBe(25);
  });

  it('switches to the long break after the configured block and restarts the counter', () => {
    const running = config({ phase: 'focus', running: true, startedAt: 0, completedFocus: 3 });
    const patch = completePhase(running, WORK_MS);
    expect(patch.phase).toBe('long-break');
    // The queued break belongs to the next block, so "Session 5 of 4" can never show.
    expect(patch.completedFocus).toBe(0);
  });

  it('keeps the counter running through a short break', () => {
    const running = config({ phase: 'focus', running: true, startedAt: 0, completedFocus: 1 });
    const patch = completePhase(running, WORK_MS);
    expect(patch.phase).toBe('short-break');
    expect(patch.completedFocus).toBe(2);
  });

  it('caps the log at MAX_SESSIONS and keeps the newest', () => {
    // A real log is most recent first, so the oldest entry is the one to drop.
    const sessions = Array.from({ length: MAX_SESSIONS }, (_, index) =>
      session(`old-${index}`, 10_000 - index),
    );
    const running = config({ phase: 'focus', running: true, startedAt: 0, sessions });
    const patch = completePhase(running, WORK_MS);

    expect(patch.sessions).toHaveLength(MAX_SESSIONS);
    expect(patch.sessions?.[0].endedAt).toBe(WORK_MS);
    expect(patch.sessions?.some((entry) => entry.id === `old-${MAX_SESSIONS - 1}`)).toBe(false);
    expect(patch.sessions?.some((entry) => entry.id === 'old-0')).toBe(true);
  });

  it('is a no-op in stopwatch mode and while idle', () => {
    expect(completePhase(config({ mode: 'stopwatch', running: true, startedAt: 0 }), 10_000)).toEqual({});
    expect(completePhase(config(), 10_000)).toEqual({});
  });
});

describe('a full pomodoro block', () => {
  it('alternates focus and breaks, and switches to the long break on the fourth focus', () => {
    let timer = config();
    let at = 0;
    const kinds: TimerSession['kind'][] = [];
    const minutes: number[] = [];

    /** One start → run out → complete, i.e. one pass of the widget's own loop. */
    const runPhase = () => {
      timer = { ...timer, ...start(timer, at) };
      at += phaseDurationMs(timer, timer.phase);
      // The widget completes a phase on the tick that sees it expire.
      expect(snapshot(timer, at).expired).toBe(true);
      timer = { ...timer, ...completePhase(timer, at) };
      const logged = timer.sessions[0];
      kinds.push(logged.kind);
      minutes.push(logged.minutes);
    };

    for (let phase = 0; phase < 8; phase += 1) runPhase();

    expect(kinds).toEqual([
      'focus',
      'short-break',
      'focus',
      'short-break',
      'focus',
      'short-break',
      'focus',
      'long-break',
    ]);
    expect(minutes).toEqual([25, 5, 25, 5, 25, 5, 25, 15]);
    // The long break is over: a fresh block of four focus sessions awaits.
    expect(timer.phase).toBe('focus');
    expect(timer.completedFocus).toBe(0);
    expect(timer.running).toBe(false);
  });
});

describe('todayFocusMinutes', () => {
  const now = new Date('2024-05-06T18:30:00');
  const at = (iso: string) => new Date(iso).getTime();

  it("sums today's focus sessions only", () => {
    const sessions = [
      session('a', at('2024-05-06T09:00:00'), 25),
      session('b', at('2024-05-06T11:30:00'), 5, 'short-break'),
      session('c', at('2024-05-06T15:00:00'), 45),
      session('d', at('2024-05-05T23:00:00'), 50), // yesterday evening
      session('e', at('2024-05-07T00:30:00'), 30), // tomorrow (clock skew)
      session('f', at('2024-05-06T00:05:00'), 15, 'long-break'),
    ];
    expect(todayFocusMinutes(sessions, now)).toBe(70);
  });

  it('counts a session from just after midnight and one from just before', () => {
    expect(todayFocusMinutes([session('a', at('2024-05-06T00:00:01'), 10)], now)).toBe(10);
    expect(todayFocusMinutes([session('b', at('2024-05-05T23:59:59'), 10)], now)).toBe(0);
  });

  it('is zero for an empty or entirely foreign log', () => {
    expect(todayFocusMinutes([], now)).toBe(0);
    expect(todayFocusMinutes([{ ...session('a', at('2024-05-06T09:00:00')), minutes: Number.NaN }], now)).toBe(0);
  });
});

describe('normalizeTimerConfig', () => {
  it('falls back to the defaults for a foreign value', () => {
    expect(normalizeTimerConfig(null, DEFAULTS)).toEqual(DEFAULTS);
    expect(normalizeTimerConfig('nonsense', DEFAULTS)).toEqual(DEFAULTS);
    expect(normalizeTimerConfig([], DEFAULTS)).toEqual(DEFAULTS);
  });

  it('clamps every duration into its allowed range', () => {
    const result = normalizeTimerConfig(
      { workMinutes: -30, shortBreakMinutes: 999, longBreakMinutes: 0, longBreakEvery: 1e9 },
      DEFAULTS,
    );
    expect(result.workMinutes).toBe(5);
    expect(result.shortBreakMinutes).toBe(60);
    expect(result.longBreakMinutes).toBe(5);
    expect(result.longBreakEvery).toBe(8);
  });

  it('repairs NaN and non-numeric durations with the defaults', () => {
    const result = normalizeTimerConfig(
      { workMinutes: Number.NaN, shortBreakMinutes: 'abc', longBreakMinutes: true, longBreakEvery: {} },
      DEFAULTS,
    );
    expect(result.workMinutes).toBe(25);
    expect(result.shortBreakMinutes).toBe(5);
    expect(result.longBreakMinutes).toBe(15);
    expect(result.longBreakEvery).toBe(4);
  });

  it('ignores unknown modes, phases and flags', () => {
    const result = normalizeTimerConfig({ mode: 'egg-timer', phase: 'siesta', notify: 'yes' }, DEFAULTS);
    expect(result.mode).toBe('pomodoro');
    expect(result.phase).toBe('idle');
    expect(result.notify).toBe(false);
  });

  it('preserves a valid runtime state, so a reload resumes the run', () => {
    const stored = config({
      phase: 'short-break',
      running: true,
      startedAt: 1_700_000_000_000,
      accumulatedMs: 12_000,
      completedFocus: 2,
      sessions: [session('s1', 1_700_000_000_000, 25)],
    });
    expect(normalizeTimerConfig(stored, DEFAULTS)).toEqual(stored);
  });

  it('stops a pomodoro that claims to be running with nothing to measure from', () => {
    const result = normalizeTimerConfig(
      { phase: 'focus', running: true, startedAt: null, accumulatedMs: 1_000 },
      DEFAULTS,
    );
    expect(result.running).toBe(false);
    expect(result.startedAt).toBeNull();
    // Banked time survives: the user was mid-session, just paused.
    expect(result.accumulatedMs).toBe(1_000);
  });

  it('keeps a running stopwatch, which legitimately has no phase', () => {
    const result = normalizeTimerConfig(
      { mode: 'stopwatch', phase: 'idle', running: true, startedAt: 5, accumulatedMs: -1 },
      DEFAULTS,
    );
    expect(result.running).toBe(true);
    expect(result.startedAt).toBe(5);
    expect(result.accumulatedMs).toBe(0);
  });

  it('drops session shapes it cannot use', () => {
    const result = normalizeTimerConfig(
      {
        sessions: [
          null,
          7,
          'nope',
          {},
          { id: 'no-end', minutes: 5, kind: 'focus' },
          { id: 'no-minutes', endedAt: 1, kind: 'focus' },
          { id: 'negative', endedAt: 2, minutes: -5, kind: 'focus' },
          { id: 'nan', endedAt: 3, minutes: Number.NaN, kind: 'focus' },
          { id: 'unknown-kind', endedAt: 4, minutes: 5, kind: 'nap' },
          { id: '   ', endedAt: 5, minutes: 5, kind: 'focus' },
          session('good', 6, 5),
        ],
      },
      DEFAULTS,
    );
    expect(result.sessions).toEqual([session('good', 6, 5)]);
  });

  it('keeps one entry per id, sorts newest first and caps the log', () => {
    const many = Array.from({ length: MAX_SESSIONS + 10 }, (_, index) => session(`s${index}`, index + 1));
    const result = normalizeTimerConfig({ sessions: [session('dup', 999), ...many, session('dup', 5)] }, DEFAULTS);

    expect(result.sessions).toHaveLength(MAX_SESSIONS);
    // The first entry for an id wins: the stored order is documented newest-first.
    expect(result.sessions.filter((entry) => entry.id === 'dup')).toHaveLength(1);
    expect(result.sessions[0]).toMatchObject({ id: 'dup', endedAt: 999 });
    for (let index = 1; index < result.sessions.length; index += 1) {
      expect(result.sessions[index - 1].endedAt).toBeGreaterThanOrEqual(result.sessions[index].endedAt);
    }
  });

  it('repairs a block counter that cannot belong to the current block', () => {
    expect(normalizeTimerConfig({ completedFocus: 9, longBreakEvery: 4 }, DEFAULTS).completedFocus).toBe(3);
    expect(normalizeTimerConfig({ completedFocus: -2 }, DEFAULTS).completedFocus).toBe(0);
    expect(normalizeTimerConfig({ completedFocus: 2.6, longBreakEvery: 4 }, DEFAULTS).completedFocus).toBe(3);
  });
});

describe('formatMinutes', () => {
  it('formats minutes under an hour', () => {
    expect(formatMinutes(45)).toBe('45m');
    expect(formatMinutes(5)).toBe('5m');
  });

  it('formats hours and minutes', () => {
    expect(formatMinutes(90)).toBe('1h 30m');
    expect(formatMinutes(155)).toBe('2h 35m');
  });

  it('drops the empty minutes on a whole hour', () => {
    expect(formatMinutes(120)).toBe('2h');
    expect(formatMinutes(59.6)).toBe('1h');
  });

  it('rounds and never goes negative', () => {
    expect(formatMinutes(0)).toBe('0m');
    expect(formatMinutes(-5)).toBe('0m');
    expect(formatMinutes(Number.NaN)).toBe('0m');
    expect(formatMinutes(44.5)).toBe('45m');
  });
});

describe('purity', () => {
  it('never mutates the config it is given', () => {
    const input = config({
      phase: 'focus',
      running: true,
      startedAt: 1_000,
      accumulatedMs: 500,
      completedFocus: 3,
      sessions: [session('a', 10), session('b', 20, 5, 'short-break')],
    });
    const before = structuredClone(input);

    start(input, 2_000);
    pause(input, 3_000);
    reset(input);
    nextPhase(input, 'focus');
    completePhase(input, WORK_MS);
    snapshot(input, 4_000);
    todayFocusMinutes(input.sessions, new Date());
    normalizeTimerConfig(input, DEFAULTS);

    expect(input).toEqual(before);
  });

  it('labels every phase, so the widget never renders an empty header', () => {
    expect(Object.values(PHASE_LABEL).every((label) => label.length > 0)).toBe(true);
  });
});
