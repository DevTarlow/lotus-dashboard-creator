/**
 * Focus-timer model.
 *
 * One state machine behind both faces of the timer widget: a pomodoro cycle
 * (focus → break → focus …) and a stopwatch that simply counts up. The entire
 * state lives in the widget config, so the dashboard's existing persistence —
 * including the embedded single-file snapshot — resumes a run after a reload with
 * no extra storage layer.
 *
 * The design rule everything else follows: time is *derived from timestamps*,
 * never counted from ticks. A background tab throttles (or suspends) timers, so a
 * tick counter would drift or stall; elapsed time is always `accumulatedMs` plus,
 * while running, `now - startedAt`.
 */
import { dayKey } from './time';
import { asBoolean, asNumber, clamp, createId, isRecord } from './utils';

/** Which face of the timer is showing. */
export type TimerMode = 'pomodoro' | 'stopwatch';

/** The phase a pomodoro is in. `idle` means "no phase in progress". */
export type TimerPhase = 'focus' | 'short-break' | 'long-break' | 'idle';

/** What a logged session was. */
export type TimerSessionKind = 'focus' | 'short-break' | 'long-break';

/** One finished phase, kept in the config's capped log. */
export type TimerSession = {
  /** Stable unique id, used as the list key. */
  id: string;
  /** When the phase ended (epoch ms). */
  endedAt: number;
  /** Whole minutes the phase lasted. */
  minutes: number;
  kind: TimerSessionKind;
};

/**
 * Timer widget config.
 *
 * The runtime half (`phase` … `sessions`) is persisted next to the settings on
 * purpose: that is what makes a run survive a reload, a crash or the single-file
 * snapshot being reopened tomorrow.
 */
export type TimerConfig = {
  mode: TimerMode;
  workMinutes: number;
  shortBreakMinutes: number;
  longBreakMinutes: number;
  /** Focus sessions in a block before a long break. */
  longBreakEvery: number;
  notify: boolean;
  /** Persisted runtime state — enough to resume after a reload. */
  phase: TimerPhase;
  running: boolean;
  /** Epoch ms of the current run, `null` when paused or idle. */
  startedAt: number | null;
  /** Time already banked in this phase before the current run. */
  accumulatedMs: number;
  /** Focus sessions finished since the last long break. */
  completedFocus: number;
  /** Capped log, most recent first. */
  sessions: TimerSession[];
};

/** Longest session log kept in the config; older sessions fall off the end. */
export const MAX_SESSIONS = 50;

/** Inclusive bounds, shared by the settings form and the normaliser so the two cannot drift. */
export interface TimerRange {
  min: number;
  max: number;
}

export const WORK_MINUTES_RANGE: TimerRange = { min: 5, max: 120 };
export const SHORT_BREAK_MINUTES_RANGE: TimerRange = { min: 1, max: 60 };
export const LONG_BREAK_MINUTES_RANGE: TimerRange = { min: 5, max: 120 };
export const LONG_BREAK_EVERY_RANGE: TimerRange = { min: 2, max: 8 };

export const TIMER_MODES: readonly TimerMode[] = ['pomodoro', 'stopwatch'];
export const TIMER_PHASES: readonly TimerPhase[] = ['focus', 'short-break', 'long-break', 'idle'];
export const TIMER_SESSION_KINDS: readonly TimerSessionKind[] = ['focus', 'short-break', 'long-break'];

/** Phase names for the widget chrome and the completion message. */
export const PHASE_LABEL: Record<TimerPhase, string> = {
  idle: 'Ready',
  focus: 'Focus',
  'short-break': 'Short break',
  'long-break': 'Long break',
};

/** The stopwatch ring sweeps once an hour, so the dial is never dead. */
const STOPWATCH_SWEEP_MS = 3_600_000;

/** No phase can honestly be longer than a day; anything larger is corrupt input. */
const MAX_SESSION_MINUTES = 24 * 60;

export function isTimerMode(value: unknown): value is TimerMode {
  return TIMER_MODES.includes(value as TimerMode);
}

export function isTimerPhase(value: unknown): value is TimerPhase {
  return TIMER_PHASES.includes(value as TimerPhase);
}

export function isTimerSessionKind(value: unknown): value is TimerSessionKind {
  return TIMER_SESSION_KINDS.includes(value as TimerSessionKind);
}

/** How long a phase lasts, in milliseconds. A stopwatch has no length — it counts up. */
export function phaseDurationMs(config: TimerConfig, phase: TimerPhase): number {
  if (config.mode === 'stopwatch') return 0;
  switch (phase) {
    case 'focus':
      return config.workMinutes * 60_000;
    case 'short-break':
      return config.shortBreakMinutes * 60_000;
    case 'long-break':
      return config.longBreakMinutes * 60_000;
    case 'idle':
      // Idle means "the next thing is a focus session", so the dial shows the
      // work length it is waiting to run rather than a zeroed ring.
      return config.workMinutes * 60_000;
  }
}

/** Everything the widget renders, derived from the config and one clock reading. */
export interface TimerSnapshot {
  phase: TimerPhase;
  running: boolean;
  /** Total time in the current phase. */
  elapsedMs: number;
  /** Time left in a pomodoro phase; 0 in stopwatch mode. */
  remainingMs: number;
  /** 0…1 progress through a pomodoro phase; the ring's hourly sweep in stopwatch mode. */
  progress: number;
  /** True once a pomodoro phase has run its course and is waiting to be completed. */
  expired: boolean;
}

/** Time banked in the current phase, including the run in progress. */
function elapsedMs(config: TimerConfig, now: number): number {
  const banked = Math.max(0, asNumber(config.accumulatedMs, 0));
  if (!config.running || config.startedAt === null) return banked;
  // `now` can lag `startedAt` by a millisecond across a system clock adjustment;
  // a negative phase is never meaningful, so it clamps to the banked time.
  return banked + Math.max(0, now - config.startedAt);
}

export function snapshot(config: TimerConfig, now: number): TimerSnapshot {
  const elapsed = elapsedMs(config, now);
  const stopwatch = config.mode === 'stopwatch';
  const duration = phaseDurationMs(config, config.phase);
  const progress = stopwatch
    ? (elapsed % STOPWATCH_SWEEP_MS) / STOPWATCH_SWEEP_MS
    : duration > 0
      ? Math.min(1, elapsed / duration)
      : 0;

  return {
    phase: config.phase,
    running: config.running,
    elapsedMs: elapsed,
    remainingMs: stopwatch ? 0 : Math.max(0, duration - elapsed),
    progress,
    // Only a pomodoro has an end to reach; the stopwatch runs until it is stopped.
    expired: !stopwatch && duration > 0 && elapsed >= duration,
  };
}

/** Start (or resume) the current phase. Returns the config patch to persist. */
export function start(config: TimerConfig, now: number): Partial<TimerConfig> {
  if (config.running) return {};
  if (config.mode === 'stopwatch') {
    // The stopwatch has no phases: it continues from whatever it had banked.
    return { running: true, startedAt: now };
  }

  const fresh = config.phase === 'idle';
  return {
    // Starting from idle opens the focus session; otherwise the paused phase
    // picks up exactly where it left off.
    phase: fresh ? 'focus' : config.phase,
    running: true,
    startedAt: now,
    accumulatedMs: fresh ? 0 : config.accumulatedMs,
  };
}

/** Bank the run so far and stop. A paused timer keeps its elapsed time. */
export function pause(config: TimerConfig, now: number): Partial<TimerConfig> {
  if (!config.running) return { running: false, startedAt: null };
  return { running: false, startedAt: null, accumulatedMs: elapsedMs(config, now) };
}

/**
 * Discard the run in progress: back to `idle`, zero elapsed, stopped.
 *
 * A reset means "forget this phase", not "forget my day", so the configuration,
 * the session log and the block counter are kept. They are listed explicitly to
 * keep that promise visible if the runtime shape ever grows.
 */
export function reset(config: TimerConfig): Partial<TimerConfig> {
  return {
    phase: 'idle',
    running: false,
    startedAt: null,
    accumulatedMs: 0,
    completedFocus: config.completedFocus,
    sessions: config.sessions,
  };
}

/**
 * The phase that follows `from`.
 *
 * `config.completedFocus` is read as the number of focus sessions finished
 * *including* the one that just ended, so callers increment before asking — that
 * is what makes the fourth of four hand over to the long break.
 */
export function nextPhase(config: TimerConfig, from: TimerPhase): TimerPhase {
  if (from !== 'focus') return 'focus';
  const every = Math.max(1, Math.round(config.longBreakEvery));
  // `completedFocus === 0` is an empty block, not a finished one: only a multiple
  // of the block length earns the long break.
  return config.completedFocus > 0 && config.completedFocus % every === 0 ? 'long-break' : 'short-break';
}

/**
 * Close the phase that just ran: log it, choose what comes next, and stop.
 *
 * The log records the phase's length, not however long the tab was throttled past
 * its end: a 25-minute focus session that finishes while the laptop sleeps is 25
 * minutes of focus, and `ceil` alone would call a 25:00.4 run "26m".
 *
 * The next phase waits for the user to press Start — nothing starts itself.
 * Stopwatch mode has no phases, so there it is a no-op.
 */
export function completePhase(config: TimerConfig, now: number): Partial<TimerConfig> {
  if (config.mode === 'stopwatch' || config.phase === 'idle') return {};

  const finished = config.phase;
  const duration = phaseDurationMs(config, finished);
  const minutes = Math.max(1, Math.ceil(Math.min(elapsedMs(config, now), duration) / 60_000));
  const session: TimerSession = { id: createId('session'), endedAt: now, minutes, kind: finished };

  const completedFocus = finished === 'focus' ? config.completedFocus + 1 : config.completedFocus;
  const phase = nextPhase({ ...config, completedFocus }, finished);

  return {
    phase,
    running: false,
    startedAt: null,
    accumulatedMs: 0,
    // Once the long break is queued the block is over, so the counter restarts
    // with it and "Session n of m" always names the next focus session.
    completedFocus: phase === 'long-break' ? 0 : completedFocus,
    sessions: [session, ...config.sessions].slice(0, MAX_SESSIONS),
  };
}

/** Minutes of focus logged on the same local day as `now`. Breaks never count. */
export function todayFocusMinutes(sessions: readonly TimerSession[], now: Date): number {
  const today = dayKey(now);
  let total = 0;
  for (const session of sessions) {
    if (session.kind !== 'focus') continue;
    if (!Number.isFinite(session.endedAt) || dayKey(new Date(session.endedAt)) !== today) continue;
    total += Number.isFinite(session.minutes) ? Math.max(0, session.minutes) : 0;
  }
  return total;
}

function clampInt(value: unknown, fallback: number, range: TimerRange): number {
  return Math.round(clamp(asNumber(value, fallback), range.min, range.max));
}

function coerceSessions(value: unknown): TimerSession[] {
  if (!Array.isArray(value)) return [];
  const list: readonly unknown[] = value;
  const seen = new Set<string>();
  const sessions: TimerSession[] = [];

  for (const raw of list) {
    if (!isRecord(raw)) continue;
    const endedAt = asNumber(raw.endedAt, Number.NaN);
    const minutes = asNumber(raw.minutes, Number.NaN);
    const sessionId = typeof raw.id === 'string' ? raw.id.trim() : '';
    // A session needs an identity (it is a list key), a real end time, a positive
    // length and a kind we understand. Anything else is dropped rather than
    // guessed at — inventing a "focus" session here would inflate the day's total.
    if (
      sessionId === '' ||
      seen.has(sessionId) ||
      !Number.isFinite(endedAt) ||
      !Number.isFinite(minutes) ||
      minutes <= 0 ||
      !isTimerSessionKind(raw.kind)
    ) {
      continue;
    }
    seen.add(sessionId);
    sessions.push({
      id: sessionId,
      endedAt,
      minutes: Math.round(clamp(minutes, 1, MAX_SESSION_MINUTES)),
      kind: raw.kind,
    });
  }

  // The log is documented as most recent first, so repair the order rather than
  // trusting whatever the import contained.
  sessions.sort((a, b) => b.endedAt - a.endedAt);
  return sessions.slice(0, MAX_SESSIONS);
}

/**
 * Normalise any loaded config into a {@link TimerConfig}.
 *
 * Config is untrusted input — an import or a hand-edited workspace can hold
 * anything — so every number is clamped into its documented range, unknown modes
 * and phases fall back to the defaults, and sessions that are not sessions are
 * dropped. A *valid* runtime state is preserved untouched, which is what lets a
 * reload resume a run exactly where it was.
 */
export function normalizeTimerConfig(value: unknown, defaults: TimerConfig): TimerConfig {
  const record = isRecord(value) ? value : {};

  const mode = isTimerMode(record.mode) ? record.mode : defaults.mode;
  const phase = isTimerPhase(record.phase) ? record.phase : defaults.phase;
  const startedAt = asNumber(record.startedAt, Number.NaN);
  // A run only exists if it has a start stamp to measure from, and a pomodoro's
  // idle phase is by definition not running (starting one promotes it to focus).
  // The stopwatch spends its whole life in `idle`, so it is exempt.
  const running =
    asBoolean(record.running, defaults.running) &&
    Number.isFinite(startedAt) &&
    (mode === 'stopwatch' || phase !== 'idle');

  const longBreakEvery = clampInt(record.longBreakEvery, defaults.longBreakEvery, LONG_BREAK_EVERY_RANGE);

  return {
    mode,
    workMinutes: clampInt(record.workMinutes, defaults.workMinutes, WORK_MINUTES_RANGE),
    shortBreakMinutes: clampInt(record.shortBreakMinutes, defaults.shortBreakMinutes, SHORT_BREAK_MINUTES_RANGE),
    longBreakMinutes: clampInt(record.longBreakMinutes, defaults.longBreakMinutes, LONG_BREAK_MINUTES_RANGE),
    longBreakEvery,
    notify: asBoolean(record.notify, defaults.notify),
    phase,
    running,
    startedAt: running ? startedAt : null,
    accumulatedMs: Math.max(0, asNumber(record.accumulatedMs, 0)),
    // The counter only ever holds 0…longBreakEvery-1 (a queued long break resets
    // it), so a larger value is repaired instead of rendered as "Session 9 of 4".
    completedFocus: clampInt(record.completedFocus, defaults.completedFocus, { min: 0, max: longBreakEvery - 1 }),
    sessions: coerceSessions(record.sessions),
  };
}

/** Whole minutes as a compact label: `45m`, `1h 30m`, `2h`. */
export function formatMinutes(minutes: number): string {
  const total = Math.max(0, Math.round(Number.isFinite(minutes) ? minutes : 0));
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  if (hours === 0) return `${rest}m`;
  if (rest === 0) return `${hours}h`;
  return `${hours}h ${rest}m`;
}
