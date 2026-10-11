import { useEffect, useMemo, useRef } from 'react';
import { PauseIcon, PlayIcon, RotateIcon, TimerIcon } from '@/components/icons';
import { Button, IconButton, Ring, TONE_TEXT } from '@/components/ui';
import { useNow } from '@/hooks/useNow';
import {
  LONG_BREAK_EVERY_RANGE,
  LONG_BREAK_MINUTES_RANGE,
  PHASE_LABEL,
  SHORT_BREAK_MINUTES_RANGE,
  WORK_MINUTES_RANGE,
  completePhase,
  formatMinutes,
  normalizeTimerConfig,
  pause,
  reset,
  snapshot,
  start,
  todayFocusMinutes,
  type TimerConfig,
} from '@/lib/timer';
import { formatClock } from '@/lib/time';
import { cn, formatRelativeTime } from '@/lib/utils';
import { useToastStore } from '@/store/toastStore';
import type { SettingField, WidgetProps } from '@/types';
import { defineWidget } from '@/widgets/define';

export type { TimerConfig, TimerMode, TimerPhase, TimerSession } from '@/lib/timer';

/**
 * Focus timer.
 *
 * A pomodoro cycle and a stopwatch on one dial.
 *
 * Both faces share the same persisted runtime state (`phase`, `running`,
 * `startedAt`, `accumulatedMs`), which is what lets a run survive a reload: the
 * widget only ever *derives* the clock from those timestamps, so a throttled tab
 * resumes with the right time instead of a stalled counter.
 */
const DEFAULT_TIMER_CONFIG: TimerConfig = {
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

const SETTINGS: readonly SettingField[] = [
  {
    key: 'mode',
    label: 'Mode',
    type: 'select',
    options: [
      { label: 'Pomodoro', value: 'pomodoro' },
      { label: 'Stopwatch', value: 'stopwatch' },
    ],
  },
  {
    key: 'workMinutes',
    label: 'Focus length',
    type: 'number',
    min: WORK_MINUTES_RANGE.min,
    max: WORK_MINUTES_RANGE.max,
    step: 1,
    unit: 'min',
  },
  {
    key: 'shortBreakMinutes',
    label: 'Short break',
    type: 'number',
    min: SHORT_BREAK_MINUTES_RANGE.min,
    max: SHORT_BREAK_MINUTES_RANGE.max,
    step: 1,
    unit: 'min',
  },
  {
    key: 'longBreakMinutes',
    label: 'Long break',
    type: 'number',
    min: LONG_BREAK_MINUTES_RANGE.min,
    max: LONG_BREAK_MINUTES_RANGE.max,
    step: 1,
    unit: 'min',
  },
  {
    key: 'longBreakEvery',
    label: 'Long break after',
    type: 'number',
    min: LONG_BREAK_EVERY_RANGE.min,
    max: LONG_BREAK_EVERY_RANGE.max,
    step: 1,
    unit: 'focus sessions',
  },
  { key: 'notify', label: 'Notify me when a phase ends', type: 'switch' },
];

/** Ring geometry: big enough to read from across a desk, small enough for two columns. */
const RING_SIZE = 116;
const RING_THICKNESS = 6;

/** Recent sessions listed in the footer before it runs out of room. */
const RECENT_SESSIONS = 3;

/**
 * Ask for notification permission, tolerating every way a browser can say no.
 *
 * The switch lives in the shared settings form, so this runs just after the click
 * that flipped it rather than inside the gesture itself. A refusal is not an
 * error: completion already falls back to an in-app toast.
 */
async function requestNotificationPermission(): Promise<void> {
  try {
    await Notification.requestPermission();
  } catch {
    // Denied, dismissed or unsupported — the toast covers it.
  }
}

export function TimerWidget({ config, updateConfig }: WidgetProps<TimerConfig>) {
  // Config is untrusted input (an import or a hand-edited workspace can hold
  // anything), so every read below goes through the normaliser.
  const timer = useMemo(() => normalizeTimerConfig(config, DEFAULT_TIMER_CONFIG), [config]);
  /** Ticks only while a phase runs — a stopped timer has nothing to re-render. */
  const now = useNow(1000, timer.running);
  const nowMs = now.getTime();
  const current = snapshot(timer, nowMs);
  const pushToast = useToastStore((state) => state.notify);

  /** The settings half of the config, as one comparable string. */
  const settingsKey = [
    timer.mode,
    timer.workMinutes,
    timer.shortBreakMinutes,
    timer.longBreakMinutes,
    timer.longBreakEvery,
  ].join(':');
  const settingsRef = useRef(settingsKey);

  /**
   * A duration or mode that changes underneath a run would make the dial lie —
   * the banked time may already be longer than the new phase — so the run is
   * dropped instead. This is the widget's settings handler: the setters live in
   * the shared form, and a config change is the only signal it gets.
   */
  useEffect(() => {
    if (settingsRef.current === settingsKey) return;
    settingsRef.current = settingsKey;
    if (timer.phase !== 'idle' || timer.running) updateConfig(reset(timer));
  }, [settingsKey, timer, updateConfig]);

  /**
   * Which run has already been turned into a session. Keyed on the phase and the
   * run's start stamp, so a repeat tick (or a re-render) cannot log the same
   * session twice — the session must be written exactly once.
   */
  const completedRef = useRef<string | null>(null);

  useEffect(() => {
    if (!current.expired) return;
    const runKey = `${current.phase}:${timer.startedAt ?? 0}`;
    if (completedRef.current === runKey) return;
    completedRef.current = runKey;

    const patch = completePhase(timer, nowMs);
    // Nothing to close (a stopwatch, or an idle phase from a hand-edited config):
    // don't pay for an empty config write.
    if (Object.keys(patch).length === 0) return;
    updateConfig(patch);

    if (!timer.notify) return;
    const finished = PHASE_LABEL[current.phase];
    const next = PHASE_LABEL[patch.phase ?? 'idle'];
    const title = `${finished} finished`;
    const body = `${next} is ready when you are.`;
    // A system notification is the better nudge while the tab is in the
    // background; anything else (refused, unsupported, blocked) is a toast.
    if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      try {
        new Notification(title, { body });
        return;
      } catch {
        // Some browsers refuse to construct one outside a service worker.
      }
    }
    pushToast({ tone: 'info', title, description: body });
  }, [current.expired, current.phase, timer, nowMs, updateConfig, pushToast]);

  useEffect(() => {
    if (!timer.notify) return;
    if (typeof Notification === 'undefined' || Notification.permission !== 'default') return;
    void requestNotificationPermission();
  }, [timer.notify]);

  const stopwatch = timer.mode === 'stopwatch';
  const phaseLabel = stopwatch ? 'Stopwatch' : PHASE_LABEL[current.phase];
  const clock = formatClock(stopwatch ? current.elapsedMs : current.remainingMs);
  const clockCaption = stopwatch ? 'elapsed' : current.phase === 'idle' ? 'ready' : 'left';
  const statusLabel = stopwatch
    ? timer.running
      ? 'Running'
      : 'Stopped'
    : `Session ${timer.completedFocus + 1} of ${timer.longBreakEvery}`;

  const todayMinutes = todayFocusMinutes(timer.sessions, now);
  const recent = timer.sessions.slice(0, RECENT_SESSIONS);

  const toggle = () => {
    const at = Date.now();
    updateConfig(timer.running ? pause(timer, at) : start(timer, at));
  };

  return (
    <div className="@container flex h-full min-h-0 flex-col gap-3">
      <div className="flex items-center justify-between gap-2 text-[11px] font-semibold uppercase tracking-wider">
        <span className={cn('truncate', TONE_TEXT.rose)}>{phaseLabel}</span>
        <span className="shrink-0 tabular-nums text-slate-400 dark:text-slate-500">{statusLabel}</span>
      </div>

      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3">
        <Ring
          value={current.progress}
          size={RING_SIZE}
          thickness={RING_THICKNESS}
          tone="rose"
          label={`${phaseLabel} progress`}
        >
          <span className="text-2xl font-semibold leading-none tabular-nums text-slate-900 dark:text-white">
            {clock}
          </span>
          <span className="mt-1 text-[10px] font-medium uppercase tracking-wider text-slate-400 dark:text-slate-500">
            {clockCaption}
          </span>
        </Ring>

        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="primary"
            aria-label={timer.running ? 'Pause timer' : 'Start timer'}
            icon={timer.running ? <PauseIcon className="h-3.5 w-3.5" /> : <PlayIcon className="h-3.5 w-3.5" />}
            onClick={toggle}
          >
            {timer.running ? 'Pause' : 'Start'}
          </Button>
          <IconButton
            label="Reset timer"
            size="icon-sm"
            icon={<RotateIcon className="h-3.5 w-3.5" />}
            onClick={() => updateConfig(reset(timer))}
          />
        </div>
      </div>

      <div className="shrink-0 border-t border-slate-100 pt-2 dark:border-slate-800">
        <p className="truncate text-[11px] text-slate-500 dark:text-slate-400">
          <span className="font-semibold tabular-nums text-slate-700 dark:text-slate-200">
            {formatMinutes(todayMinutes)}
          </span>{' '}
          focused today
        </p>

        {recent.length === 0 ? (
          <p className="mt-1.5 text-[11px] text-slate-400 dark:text-slate-500">
            Completed sessions are listed here.
          </p>
        ) : (
          // A two-column widget has room for the total but not for the log.
          <ul className="mt-1.5 hidden space-y-1 @[12rem]:block">
            {recent.map((session) => (
              <li
                key={session.id}
                className="flex items-baseline justify-between gap-2 text-[11px] text-slate-400 dark:text-slate-500"
              >
                <span className="truncate">
                  {PHASE_LABEL[session.kind]} · <span className="tabular-nums">{formatMinutes(session.minutes)}</span>
                </span>
                <span className="shrink-0 tabular-nums">{formatRelativeTime(session.endedAt, nowMs)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export const timerWidget = defineWidget<TimerConfig>({
  type: 'timer',
  name: 'Focus timer',
  summary: 'Pomodoro sessions and a stopwatch, in one card.',
  category: 'productivity',
  keywords: ['timer', 'pomodoro', 'focus', 'stopwatch', 'sessions', 'productivity'],
  icon: TimerIcon,
  accent: 'rose',
  defaultSize: { w: 3, h: 7, minW: 2, minH: 4 },
  defaultConfig: DEFAULT_TIMER_CONFIG,
  settings: SETTINGS,
  summarize: (config) => {
    const timer = normalizeTimerConfig(config, DEFAULT_TIMER_CONFIG);
    // Configuration only, never a ticking value: the subtitle is rendered by the
    // frame, and a clock that changes every second would re-render it.
    return timer.mode === 'stopwatch' ? 'Stopwatch' : `Pomodoro ${timer.workMinutes}/${timer.shortBreakMinutes}`;
  },
  component: TimerWidget,
});
