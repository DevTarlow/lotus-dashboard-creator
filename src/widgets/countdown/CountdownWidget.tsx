import { useMemo, useState } from 'react';
import { CheckIcon, CountdownIcon, PencilIcon, PlusIcon, TrashIcon } from '@/components/icons';
import { Button, EmptyState, IconButton, Ring, SelectInput, TextInput, TONE_FILL, TONE_TEXT } from '@/components/ui';
import { useNow } from '@/hooks/useNow';
import {
  COUNTDOWN_TONES,
  DEFAULT_COUNTDOWN_TONE,
  EVENT_LABEL_MAX,
  MAX_EVENTS,
  addEvent,
  countdownRows,
  daysUntilEvent,
  formatCountdownParts,
  isCountdownTone,
  normalizeEvents,
  removeEvent,
  updateEvent,
  type CountdownConfig,
  type CountdownEvent,
  type CountdownRow,
} from '@/lib/countdown';
import { dayKey, isValidDayKey, relativeDayLabel } from '@/lib/time';
import { asBoolean, cn } from '@/lib/utils';
import type { SettingField, WidgetProps } from '@/types';
import { defineWidget } from '@/widgets/define';

export type { CountdownConfig, CountdownEvent, CountdownTone } from '@/lib/countdown';

const DEFAULT_COUNTDOWN_CONFIG: CountdownConfig = {
  events: [],
  showSeconds: true,
  showPast: false,
};

const SETTINGS: readonly SettingField[] = [
  { key: 'showSeconds', label: 'Show seconds', type: 'switch', help: 'Tick every second instead of every 30.' },
  { key: 'showPast', label: 'Keep events that have passed', type: 'switch' },
];

const TONE_OPTIONS = COUNTDOWN_TONES.map((tone) => ({
  label: tone.charAt(0).toUpperCase() + tone.slice(1),
  value: tone,
}));

const EVENT_DATE_FORMAT = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'long' });
const EVENT_DATE_YEAR_FORMAT = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'long', year: 'numeric' });

/**
 * "25 December" for an annual event — which year it recurs in is the point, so
 * the year is noise — and "25 December 2027" for a one-off, where it is not.
 */
function formatEventDate(event: CountdownEvent, target: Date): string {
  const formatted = (event.annual ? EVENT_DATE_FORMAT : EVENT_DATE_YEAR_FORMAT).format(target);
  return event.time ? `${formatted} · ${event.time}` : formatted;
}

/* -------------------------------------------------------------- inline editor */

/** An event as the form edits it: everything but the id it already has. */
type EventDraft = Omit<CountdownEvent, 'id'>;

function draftFrom(event: CountdownEvent): EventDraft {
  return { label: event.label, date: event.date, time: event.time, annual: event.annual, tone: event.tone };
}

/** A new event starts on today's date, the one the date picker should open on. */
function emptyDraft(): EventDraft {
  return { label: '', date: dayKey(new Date()), time: null, annual: false, tone: DEFAULT_COUNTDOWN_TONE };
}

interface EventFormProps {
  initial: EventDraft;
  submitLabel: string;
  onSubmit: (draft: EventDraft) => void;
  onCancel: () => void;
  /** Omitted while adding: there is nothing to remove yet. */
  onRemove?: () => void;
}

/**
 * The inline editor shared by "add" and "edit".
 *
 * There is no list field type in the settings schema, so the events are edited
 * here, in the widget body. The fields are stacked two-up and the labels are
 * `aria-label`s to keep the whole form inside a three-column card.
 */
function EventForm({ initial, submitLabel, onSubmit, onCancel, onRemove }: EventFormProps) {
  const [draft, setDraft] = useState<EventDraft>(initial);
  const patch = (next: Partial<EventDraft>) => setDraft((current) => ({ ...current, ...next }));
  const ready = draft.label.trim() !== '' && isValidDayKey(draft.date);

  return (
    <form
      className="space-y-1.5 rounded-xl border border-slate-200 bg-white/70 p-2 dark:border-slate-700/70 dark:bg-slate-900/50"
      onSubmit={(event) => {
        event.preventDefault();
        if (!ready) return;
        onSubmit({ ...draft, label: draft.label.trim() });
      }}
    >
      <TextInput
        value={draft.label}
        maxLength={EVENT_LABEL_MAX}
        placeholder="Birthday"
        aria-label="Event label"
        autoFocus
        onChange={(event) => patch({ label: event.target.value })}
        className="h-8 px-2 py-1 text-xs"
      />

      <div className="grid grid-cols-2 gap-1.5">
        <TextInput
          type="date"
          value={draft.date}
          aria-label="Event date"
          onChange={(event) => patch({ date: event.target.value })}
          className="h-8 px-2 py-1 text-xs"
        />
        <TextInput
          type="time"
          value={draft.time ?? ''}
          aria-label="Event time (optional)"
          // Some browsers hand back `HH:mm:ss`; the model only stores `HH:mm`.
          onChange={(event) => patch({ time: event.target.value === '' ? null : event.target.value.slice(0, 5) })}
          className="h-8 px-2 py-1 text-xs"
        />
      </div>

      <div className="flex items-center justify-between gap-2">
        <label className="flex items-center gap-1.5 text-[11px] font-medium text-slate-600 dark:text-slate-300">
          <input
            type="checkbox"
            checked={draft.annual}
            onChange={(event) => patch({ annual: event.target.checked })}
            className="h-3.5 w-3.5 accent-violet-600"
          />
          Every year
        </label>
        <SelectInput
          value={draft.tone}
          options={TONE_OPTIONS}
          aria-label="Event colour"
          onChange={(event) =>
            patch({ tone: isCountdownTone(event.target.value) ? event.target.value : DEFAULT_COUNTDOWN_TONE })
          }
          className="h-8 w-24 px-2 py-1 text-xs"
        />
      </div>

      {ready ? null : (
        <p className="text-[10px] font-medium text-amber-600 dark:text-amber-400">A label and a real date are both required.</p>
      )}

      <div className="flex items-center gap-1.5">
        {onRemove ? (
          <IconButton
            label="Remove event"
            size="icon-sm"
            variant="danger"
            icon={<TrashIcon className="h-3.5 w-3.5" />}
            onClick={onRemove}
          />
        ) : null}
        <span className="flex-1" />
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button size="sm" variant="primary" type="submit" icon={<CheckIcon className="h-3.5 w-3.5" />} disabled={!ready}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}

/* ------------------------------------------------------------------- display */

/** The event being counted down to: ring, then its label and date underneath. */
function NextEventCard({ row, showSeconds, onEdit }: { row: CountdownRow; showSeconds: boolean; onEdit: () => void }) {
  const today = row.isToday && row.remainingMs === 0;
  const parts = today ? { primary: 'Today', secondary: '' } : formatCountdownParts(row.remainingMs, showSeconds);

  return (
    <div className="relative flex flex-col items-center gap-2 rounded-xl border border-slate-200/80 bg-white/60 px-3 py-3 text-center dark:border-slate-700/60 dark:bg-slate-900/40">
      <IconButton
        label={`Edit ${row.event.label}`}
        size="icon-sm"
        icon={<PencilIcon className="h-3.5 w-3.5" />}
        onClick={onEdit}
        className="absolute right-1 top-1 text-slate-400 dark:text-slate-500"
      />
      <Ring value={row.progress} tone={row.event.tone} size={78} thickness={7} label={`${row.event.label}: ${row.label}`}>
        <span className="text-lg font-semibold leading-none tabular-nums">{parts.primary}</span>
        {parts.secondary ? (
          <span className="mt-1 text-[10px] font-medium leading-none tabular-nums opacity-75">{parts.secondary}</span>
        ) : null}
      </Ring>
      <div className="min-w-0 max-w-full">
        <p className="truncate text-sm font-semibold text-slate-800 dark:text-slate-100">{row.event.label}</p>
        <p className="truncate text-[11px] text-slate-500 dark:text-slate-400">{formatEventDate(row.event, row.target)}</p>
      </div>
    </div>
  );
}

/** One of the remaining events: tone dot, label, date and the countdown value. */
function EventListItem({ row, onEdit }: { row: CountdownRow; onEdit: () => void }) {
  return (
    <li className={cn('flex items-center gap-2 rounded-lg px-1 py-1', row.passed && 'opacity-60')}>
      <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', TONE_FILL[row.event.tone])} aria-hidden="true" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-medium text-slate-700 dark:text-slate-200">{row.event.label}</span>
        <span className="block truncate text-[10px] text-slate-400 dark:text-slate-500">
          {formatEventDate(row.event, row.target)}
        </span>
      </span>
      <span
        className={cn(
          'shrink-0 text-[11px] tabular-nums',
          row.isToday ? cn('font-semibold', TONE_TEXT[row.event.tone]) : 'text-slate-500 dark:text-slate-400',
        )}
      >
        {row.label}
      </span>
      <IconButton
        label={`Edit ${row.event.label}`}
        size="icon-sm"
        icon={<PencilIcon className="h-3.5 w-3.5" />}
        onClick={onEdit}
        className="shrink-0 text-slate-400 dark:text-slate-500"
      />
    </li>
  );
}

/** Countdown to the events that matter, edited in place. */
export function CountdownWidget({ config, updateConfig }: WidgetProps<CountdownConfig>) {
  const showSeconds = asBoolean(config.showSeconds, true);
  const showPast = asBoolean(config.showPast, false);
  // Ticking is local state only: an interval that wrote to config every second
  // would flood localStorage and the undo stack.
  const now = useNow(showSeconds ? 1000 : 30_000);

  // Config is untrusted input, so everything renders through the normaliser.
  const events = useMemo(() => normalizeEvents(config.events), [config.events]);
  const rows = useMemo(
    () => countdownRows(events, now, { showPast, showSeconds }),
    [events, now, showPast, showSeconds],
  );

  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [next, ...rest] = rows;
  const full = events.length >= MAX_EVENTS;

  const write = (nextEvents: CountdownEvent[]) => updateConfig({ events: nextEvents });
  const startAdding = () => {
    setEditingId(null);
    setAdding(true);
  };
  const startEditing = (id: string) => {
    setAdding(false);
    setEditingId(id);
  };
  const commitEdit = (id: string, draft: EventDraft) => {
    write(updateEvent(events, id, draft));
    setEditingId(null);
  };
  const remove = (id: string) => {
    write(removeEvent(events, id));
    setEditingId(null);
  };
  const formFor = (event: CountdownEvent) => (
    <EventForm
      initial={draftFrom(event)}
      submitLabel="Save"
      onSubmit={(draft) => commitEdit(event.id, draft)}
      onCancel={() => setEditingId(null)}
      onRemove={() => remove(event.id)}
    />
  );

  return (
    <div className="@container flex h-full flex-col gap-2">
      <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto pr-0.5">
        {events.length === 0 ? (
          <EmptyState
            size="sm"
            icon={<CountdownIcon className="h-4 w-4" />}
            title="No events yet"
            description="Count down to a birthday, a launch or a holiday."
          />
        ) : rows.length === 0 ? (
          <p className="px-2 py-3 text-center text-[11px] text-slate-400 dark:text-slate-500">
            Nothing upcoming. Turn on “Keep events that have passed” in the widget settings to see them.
          </p>
        ) : (
          <>
            {next ? (
              editingId === next.event.id ? (
                formFor(next.event)
              ) : (
                <NextEventCard row={next} showSeconds={showSeconds} onEdit={() => startEditing(next.event.id)} />
              )
            ) : null}

            {rest.length > 0 ? (
              <ul className="space-y-0.5">
                {rest.map((row) =>
                  editingId === row.event.id ? (
                    <li key={row.event.id}>{formFor(row.event)}</li>
                  ) : (
                    <EventListItem key={row.event.id} row={row} onEdit={() => startEditing(row.event.id)} />
                  ),
                )}
              </ul>
            ) : null}
          </>
        )}
      </div>

      {adding ? (
        <EventForm
          initial={emptyDraft()}
          submitLabel="Add"
          onSubmit={(draft) => {
            write(addEvent(events, draft));
            setAdding(false);
          }}
          onCancel={() => setAdding(false)}
        />
      ) : (
        <Button
          fullWidth
          size="sm"
          variant="ghost"
          icon={<PlusIcon className="h-3.5 w-3.5" />}
          disabled={full}
          title={full ? `A countdown holds up to ${MAX_EVENTS} events` : undefined}
          onClick={startAdding}
        >
          {full ? `Up to ${MAX_EVENTS} events` : 'Add event'}
        </Button>
      )}
    </div>
  );
}

export const countdownWidget = defineWidget<CountdownConfig>({
  type: 'countdown',
  name: 'Countdown',
  summary: 'Time left until the dates that matter.',
  category: 'productivity',
  keywords: ['countdown', 'days', 'until', 'birthday', 'anniversary', 'deadline', 'holiday'],
  icon: CountdownIcon,
  accent: 'amber',
  defaultSize: { w: 3, h: 7, minW: 2, minH: 4 },
  defaultConfig: DEFAULT_COUNTDOWN_CONFIG,
  settings: SETTINGS,
  summarize: (config) => {
    const events = normalizeEvents(config.events);
    if (events.length === 0) return 'No events yet';

    const now = new Date();
    const [nextRow] = countdownRows(events, now, { showPast: false });
    // Every event may already be behind us; "No events yet" would be a lie.
    if (!nextRow) return 'All events have passed';
    return `${nextRow.event.label} · ${relativeDayLabel(daysUntilEvent(nextRow.event, now))}`;
  },
  component: CountdownWidget,
});
