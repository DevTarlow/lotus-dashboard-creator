import { Fragment, useMemo, useState, type FormEvent } from 'react';
import { CalendarIcon, ChevronRightIcon, CloseIcon, PlusIcon } from '@/components/icons';
import { Button, IconButton, SourceBadge, TextInput } from '@/components/ui';
import { useNow } from '@/hooks/useNow';
import { useResource } from '@/hooks/useResource';
import {
  MAX_EVENTS,
  MAX_EVENT_TEXT,
  addEvent,
  buildMonth,
  eventsByDate,
  monthTitle,
  normalizeEvents,
  removeEvent,
  resolveWeekStart,
  shiftMonth,
  weekdayLabels,
  type CalendarCell,
  type CalendarEvent,
  type CalendarWeekStart,
} from '@/lib/calendar';
import {
  HOLIDAY_COUNTRIES,
  HOLIDAY_REFRESH_MS,
  fetchHolidays,
  holidayCacheKey,
  holidayCountryName,
  holidaysByDate,
  nextHoliday,
  normalizeCountryCode,
  type Holiday,
} from '@/lib/holidays';
import { isCached } from '@/lib/http';
import { dayKey, daysUntil, parseDayKey, relativeDayLabel, startOfMonth } from '@/lib/time';
import { asBoolean, cn } from '@/lib/utils';
import type { SettingField, WidgetProps } from '@/types';
import { defineWidget } from '@/widgets/define';

export type { CalendarEvent, CalendarWeekStart };

export type CalendarConfig = {
  /** Which day a week starts on; `auto` follows the browser's locale. */
  weekStart: CalendarWeekStart;
  showWeekNumbers: boolean;
  /** ISO-2 code for public holidays, or `null` when they are off. */
  country: string | null;
  events: CalendarEvent[];
  /** The day the editor under the grid is editing; `null` follows today. */
  selectedDate: string | null;
};

const DEFAULT_CALENDAR_CONFIG: CalendarConfig = {
  weekStart: 'auto',
  showWeekNumbers: false,
  country: null,
  events: [],
  selectedDate: null,
};

const WEEK_START_OPTIONS: ReadonlyArray<{ label: string; value: string }> = [
  { label: 'Automatic', value: 'auto' },
  { label: 'Monday', value: 'monday' },
  { label: 'Sunday', value: 'sunday' },
];

const SETTINGS: readonly SettingField[] = [
  {
    key: 'weekStart',
    label: 'Week starts on',
    type: 'select',
    options: WEEK_START_OPTIONS,
    help: 'Automatic follows this browser’s locale.',
  },
  { key: 'showWeekNumbers', label: 'Show week numbers', type: 'switch' },
  {
    key: 'country',
    label: 'Public holidays',
    type: 'select',
    // Built from the provider's curated list, so the widget stays declarative.
    options: [
      { label: 'None', value: '' },
      ...HOLIDAY_COUNTRIES.map((country) => ({ label: country.name, value: country.code })),
    ],
    help: 'Holiday dates come from date.nager.at — no key or signup needed.',
  },
];

/**
 * Locale for the one rule `Intl` cannot answer alone: which day a week starts
 * on. Everything else is formatted with `Intl`'s own default, so the header, the
 * weekday names and the cell labels always agree.
 */
const LOCALE = new Intl.DateTimeFormat().resolvedOptions().locale;

const LONG_DATE = new Intl.DateTimeFormat(undefined, {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});

/** Stable empty list, so the holiday map is not rebuilt on every render. */
const NO_HOLIDAYS: readonly Holiday[] = [];

/** Two chips plus a "+N" is as much as a day cell can honestly show. */
const MAX_CHIPS = 2;

/** `1 event` / `2 events`, for everything that counts things. */
function countLabel(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

/** Tooltip for a holiday marker: its own name, the local one, and its reach. */
function holidayTitle(holiday: Holiday): string {
  const parts = [holiday.name];
  if (holiday.localName !== holiday.name) parts.push(holiday.localName);
  // The provider marks a county or state holiday with `global: false`.
  if (!holiday.global) parts.push('regional holiday');
  return parts.join(' · ');
}

function DayCell({
  cell,
  selected,
  onSelect,
}: {
  cell: CalendarCell;
  selected: boolean;
  onSelect: (key: string) => void;
}) {
  const chips = cell.events.slice(0, MAX_CHIPS);
  const hidden = cell.events.length - chips.length;

  return (
    <button
      type="button"
      onClick={() => onSelect(cell.key)}
      aria-label={cell.label}
      aria-pressed={selected}
      aria-current={cell.isToday ? 'date' : undefined}
      title={cell.label}
      className={cn(
        'flex h-full min-h-0 w-full flex-col overflow-hidden rounded-lg border p-0.5 text-left transition',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/60',
        selected
          ? 'border-violet-400 bg-violet-50 dark:border-violet-500/60 dark:bg-violet-500/10'
          : 'border-transparent hover:border-slate-200 hover:bg-slate-50 dark:hover:border-slate-700 dark:hover:bg-slate-800/60',
        cell.isWeekend && !selected && 'bg-slate-50/70 dark:bg-slate-800/40',
        // Adjacent-month days fade back, but a selected one keeps its highlight.
        !cell.inMonth && !selected && 'opacity-60',
      )}
    >
      <span
        className={cn(
          'flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full px-0.5 text-[10px] font-semibold tabular-nums',
          !cell.inMonth
            ? 'text-slate-400 dark:text-slate-500'
            : cell.isToday
              ? 'bg-violet-600 text-white dark:bg-violet-500'
              : 'text-slate-600 dark:text-slate-300',
        )}
      >
        {cell.day}
      </span>

      {/* Narrow cards drop the neighbouring months' chips rather than overflowing. */}
      <span
        className={cn(
          'mt-px flex min-h-0 w-full flex-col gap-px overflow-hidden',
          cell.inMonth ? 'flex' : 'hidden @[26rem]:flex',
        )}
      >
        {cell.holidays.map((holiday) => (
          <span key={`${holiday.date}:${holiday.name}`} className="flex min-w-0 items-center gap-1" title={holidayTitle(holiday)}>
            <span
              className={cn(
                'h-1 w-1 shrink-0 rounded-full',
                holiday.global ? 'bg-violet-500 dark:bg-violet-400' : 'border border-violet-500 dark:border-violet-400',
              )}
              aria-hidden="true"
            />
            <span className="truncate text-[9px] font-medium leading-3 text-violet-700 dark:text-violet-300">{holiday.name}</span>
          </span>
        ))}
        {chips.map((event) => (
          <span key={event.id} className="flex min-w-0 items-center rounded bg-slate-100 px-1 dark:bg-slate-800" title={event.text}>
            <span className="truncate text-[9px] leading-3 text-slate-600 dark:text-slate-300">{event.text}</span>
          </span>
        ))}
        {hidden > 0 ? <span className="px-1 text-[9px] leading-3 text-slate-400 dark:text-slate-500">+{hidden}</span> : null}
      </span>
    </button>
  );
}

/** A month at a glance, with the user's own dates and optional public holidays. */
export function CalendarWidget({ config, updateConfig }: WidgetProps<CalendarConfig>) {
  // Only the "today" marker and the countdown need the clock; config is never
  // written from a tick.
  const now = useNow(60_000);
  const today = dayKey(now);

  // The visible month is view state, not config: browsing must not flood the
  // undo stack with an entry per arrow press. It opens on the day the editor is
  // about to edit, so the grid and the editor agree on the first paint.
  const [cursor, setCursor] = useState(() => {
    const requested = typeof config.selectedDate === 'string' ? config.selectedDate : '';
    const anchor = parseDayKey(requested) ?? startOfMonth(new Date());
    return { year: anchor.getFullYear(), month: anchor.getMonth() + 1 };
  });
  const [draft, setDraft] = useState('');

  const events = useMemo(() => normalizeEvents(config.events), [config.events]);
  const weekStart = useMemo(() => resolveWeekStart(config.weekStart, LOCALE), [config.weekStart]);
  const showWeekNumbers = asBoolean(config.showWeekNumbers, false);
  const country = normalizeCountryCode(config.country);
  const countryName = holidayCountryName(country);

  const { year, month } = cursor;
  const { data: holidays, error, errorCode, errorStatus, fromCache } = useResource<Holiday[]>({
    key: country === null ? 'nager:holidays:off' : holidayCacheKey(country, year),
    refreshMs: HOLIDAY_REFRESH_MS,
    enabled: country !== null, // holidays off means no request at all
    load: async (signal) => {
      if (country === null) return { data: [], fromCache: false };
      // Read the cache before asking: the payload about to arrive comes from it
      // when the key is still fresh.
      const cached = isCached(holidayCacheKey(country, year), HOLIDAY_REFRESH_MS);
      return { data: await fetchHolidays(country, year, signal), fromCache: cached };
    },
  });

  const holidayList = holidays ?? NO_HOLIDAYS;
  const eventsOn = useMemo(() => eventsByDate(events), [events]);
  const holidaysOn = useMemo(() => holidaysByDate(holidayList), [holidayList]);
  const grid = useMemo(
    () => buildMonth(year, month, { weekStart, today, events: eventsOn, holidays: holidaysOn }),
    [year, month, weekStart, today, eventsOn, holidaysOn],
  );

  // A config that never picked a day follows today, so the editor is usable at
  // first sight; junk in `selectedDate` falls back the same way.
  const requested = typeof config.selectedDate === 'string' ? config.selectedDate : '';
  const selected = parseDayKey(requested) === null ? today : requested;
  const selectedEvents = eventsOn.get(selected) ?? [];
  const selectedHolidays = holidaysOn.get(selected) ?? [];
  const selectedAnchor = parseDayKey(selected);
  const selectedLabel = selectedAnchor === null ? selected : LONG_DATE.format(selectedAnchor);

  const upcoming = nextHoliday(holidayList, today);
  const daysToUpcoming = upcoming === null ? null : daysUntil(upcoming.date, today);
  const atCapacity = events.length >= MAX_EVENTS;
  const canAdd = draft.trim() !== '' && !atCapacity;
  const failed = country !== null && error !== null && holidays === null;
  /**
   * Derived here rather than taken from `useResource.pending`: that compares
   * `undefined === null` before the first snapshot exists, so a panel would call
   * itself live before the provider ever answered.
   */
  const waiting = country !== null && holidays === null && error === null;
  const footerNote =
    country === null
      ? events.length === 0
        ? 'No events yet'
        : countLabel(events.length, 'event')
      : failed
        ? `No holiday data for ${country}`
        : waiting
          ? 'Reading public holidays…'
          : upcoming !== null && daysToUpcoming !== null
            ? `Next holiday: ${upcoming.name} · ${relativeDayLabel(daysToUpcoming)}`
            : `No public holidays left in ${year}`;

  const selectDay = (key: string) => updateConfig({ selectedDate: key });
  const goToMonth = (delta: number) => setCursor(shiftMonth(year, month, delta));
  const goToToday = () => {
    const first = startOfMonth(new Date());
    setCursor({ year: first.getFullYear(), month: first.getMonth() + 1 });
    updateConfig({ selectedDate: today });
  };
  const submitEvent = (event: FormEvent) => {
    event.preventDefault();
    const next = addEvent(events, selected, draft);
    // `addEvent` hands back the same array when there was nothing to add.
    if (next === events) return;
    updateConfig({ events: next });
    setDraft('');
  };

  return (
    <div className="@container flex h-full flex-col gap-1.5">
      <div className="flex shrink-0 items-center gap-1">
        <IconButton
          label="Previous month"
          size="icon-sm"
          icon={<ChevronRightIcon className="h-3.5 w-3.5 rotate-180" />}
          onClick={() => goToMonth(-1)}
        />
        <Button size="sm" variant="ghost" className="h-7 px-2 text-[11px]" title="Jump to this month" onClick={goToToday}>
          Today
        </Button>
        <IconButton label="Next month" size="icon-sm" icon={<ChevronRightIcon className="h-3.5 w-3.5" />} onClick={() => goToMonth(1)} />
        <p className="min-w-0 flex-1 truncate text-xs font-semibold text-slate-700 dark:text-slate-200">
          {monthTitle(year, month)}
        </p>
        {countryName !== '' ? (
          <span
            className="hidden max-w-[40%] shrink-0 truncate text-[10px] text-slate-400 @[18rem]:inline dark:text-slate-500"
            title={`Public holidays: ${countryName}`}
          >
            {countryName}
          </span>
        ) : null}
      </div>

      <div
        className="grid min-h-0 flex-1 gap-0.5"
        style={{
          // `max-content` rather than `auto`: an auto track would stretch and
          // steal width from the days, and it still collapses when the week
          // numbers are hidden at narrow widths.
          gridTemplateColumns: showWeekNumbers ? 'max-content repeat(7, minmax(0, 1fr))' : 'repeat(7, minmax(0, 1fr))',
          gridTemplateRows: 'auto repeat(6, minmax(0, 1fr))',
        }}
      >
        {showWeekNumbers ? <span className="hidden @[22rem]:block" aria-hidden="true" /> : null}
        {weekdayLabels(weekStart).map((label, index) => (
          <span
            key={`${index}:${label}`}
            className="truncate text-center text-[9px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500"
            title={label}
          >
            {label}
          </span>
        ))}
        {grid.weeks.map((week, index) => (
          <Fragment key={week[0].key}>
            {showWeekNumbers ? (
              <span className="hidden items-start justify-center pt-0.5 text-[9px] text-slate-400 @[22rem]:flex dark:text-slate-500">
                {grid.weekNumbers[index]}
              </span>
            ) : null}
            {week.map((cell) => (
              <DayCell key={cell.key} cell={cell} selected={cell.key === selected} onSelect={selectDay} />
            ))}
          </Fragment>
        ))}
      </div>

      <div className="shrink-0 border-t border-slate-100 pt-1.5 dark:border-slate-800">
        <div className="flex items-baseline justify-between gap-2">
          <p className="min-w-0 truncate text-[11px] font-semibold text-slate-700 dark:text-slate-200">{selectedLabel}</p>
          {selectedEvents.length > 0 ? (
            <span className="shrink-0 text-[10px] text-slate-400 dark:text-slate-500">{countLabel(selectedEvents.length, 'event')}</span>
          ) : null}
        </div>

        {selectedHolidays.length > 0 ? (
          <p
            className="truncate text-[10px] font-medium text-violet-700 dark:text-violet-300"
            title={selectedHolidays.map((holiday) => holiday.name).join(', ')}
          >
            {selectedHolidays.length === 1 ? 'Public holiday' : 'Public holidays'}:{' '}
            {selectedHolidays.map((holiday) => holiday.name).join(', ')}
          </p>
        ) : null}

        {selectedEvents.length > 0 ? (
          <ul className="mt-0.5 max-h-16 space-y-px overflow-y-auto pr-0.5">
            {selectedEvents.map((event) => (
              <li key={event.id} className="flex items-center gap-1">
                <span className="min-w-0 flex-1 truncate text-[11px] text-slate-600 dark:text-slate-300" title={event.text}>
                  {event.text}
                </span>
                <IconButton
                  label={`Remove “${event.text}”`}
                  size="icon-sm"
                  variant="danger"
                  icon={<CloseIcon className="h-3 w-3" />}
                  onClick={() => updateConfig({ events: removeEvent(events, event.id) })}
                />
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[10px] text-slate-400 dark:text-slate-500">No events on this day yet.</p>
        )}

        <form className="mt-0.5 flex items-center gap-1" onSubmit={submitEvent}>
          <TextInput
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Add an event…"
            aria-label={`New event on ${selectedLabel}`}
            maxLength={MAX_EVENT_TEXT}
            disabled={atCapacity}
            className="h-7 px-2 py-0 text-xs"
          />
          <IconButton
            label="Add event"
            type="submit"
            size="icon-sm"
            variant="primary"
            icon={<PlusIcon className="h-3 w-3" />}
            disabled={!canAdd}
          />
        </form>
        {atCapacity ? (
          <p className="text-[10px] text-amber-600 dark:text-amber-400">
            {MAX_EVENTS} events is the limit — remove one to add another.
          </p>
        ) : null}
      </div>

      <div className="flex shrink-0 items-center justify-between gap-2">
        <span
          className={cn(
            'min-w-0 truncate text-[10px]',
            failed ? 'text-amber-600 dark:text-amber-400' : 'text-slate-400 dark:text-slate-500',
          )}
          title={failed ? (error ?? undefined) : undefined}
        >
          {footerNote}
        </span>
        {country !== null ? (
          <SourceBadge input={{ pending: waiting, error, errorCode, status: errorStatus, fromCache }} />
        ) : null}
      </div>
    </div>
  );
}

export const calendarWidget = defineWidget<CalendarConfig>({
  type: 'calendar',
  name: 'Calendar',
  summary: 'A month at a glance, with your dates and public holidays.',
  category: 'productivity',
  keywords: ['calendar', 'month', 'events', 'holidays', 'dates', 'planner', 'diary'],
  icon: CalendarIcon,
  accent: 'violet',
  badge: 'Live',
  defaultSize: { w: 6, h: 8, minW: 4, minH: 6 },
  defaultConfig: DEFAULT_CALENDAR_CONFIG,
  settings: SETTINGS,
  summarize: (config) => {
    const count = normalizeEvents(config.events).length;
    const label = count === 0 ? 'No events' : countLabel(count, 'event');
    const name = holidayCountryName(normalizeCountryCode(config.country));
    return name === '' ? label : `${label} · ${name}`;
  },
  component: CalendarWidget,
});
