/**
 * The widget registry.
 *
 * Adding a widget to Lotus means three lines here: import its definition and add
 * it to {@link WIDGET_DEFINITIONS}. Everything else — the gallery, the settings
 * modal, validation, persistence — picks it up automatically.
 */
import type { WidgetCategory, WidgetDefinition } from '@/types';
import { airWidget } from './air';
import { calendarWidget } from './calendar';
import { clockWidget } from './clock';
import { converterWidget } from './converter';
import { countdownWidget } from './countdown';
import { earthquakeWidget } from './earthquake';
import { githubWidget } from './github';
import { habitsWidget } from './habits';
import { linksWidget } from './links';
import { marketWidget } from './market';
import { newsWidget } from './news';
import { notesWidget } from './notes';
import { onThisDayWidget } from './onthisday';
import { stickyNotesWidget } from './sticky';
import { sunWidget } from './sun';
import { systemWidget } from './system';
import { tasksWidget } from './tasks';
import { timerWidget } from './timer';
import { weatherWidget } from './weather';
import { worldClockWidget } from './worldclock';

/**
 * Every registered widget, in gallery order.
 *
 * The order groups the catalogue by what a person is looking at rather than by
 * when it was written, so the drawer reads as a tour of the dashboard.
 */
export const WIDGET_DEFINITIONS: readonly WidgetDefinition[] = [
  // Essentials: what it is like outside, and what time it is.
  clockWidget,
  weatherWidget,
  sunWidget,
  worldClockWidget,

  // Productivity: the day's work.
  tasksWidget,
  timerWidget,
  habitsWidget,
  calendarWidget,
  countdownWidget,
  notesWidget,
  stickyNotesWidget,
  linksWidget,

  // Markets and news.
  marketWidget,
  newsWidget,
  onThisDayWidget,

  // Environment.
  airWidget,
  earthquakeWidget,

  // Utilities.
  converterWidget,
  systemWidget,
  githubWidget,
];

/** Fast lookup by widget type. */
export const WIDGET_REGISTRY: ReadonlyMap<string, WidgetDefinition> = new Map(
  WIDGET_DEFINITIONS.map((definition) => [definition.type, definition]),
);

export const WIDGET_CATEGORIES: readonly { id: WidgetCategory; label: string }[] = [
  { id: 'essentials', label: 'Essentials' },
  { id: 'productivity', label: 'Productivity' },
  { id: 'markets', label: 'Markets' },
  { id: 'news', label: 'News' },
  { id: 'environment', label: 'Environment' },
  { id: 'utilities', label: 'Utilities' },
];

/** Look up a widget definition. */
export function getWidgetDefinition(type: string): WidgetDefinition | undefined {
  return WIDGET_REGISTRY.get(type);
}

/** `true` when a widget type is registered. */
export function isKnownWidgetType(type: string): boolean {
  return WIDGET_REGISTRY.has(type);
}

/** All registered widget types. */
export function widgetTypes(): string[] {
  return WIDGET_DEFINITIONS.map((definition) => definition.type);
}

/** Every widget installed locally, as a set (used by validation). */
export function knownWidgetTypes(): Set<string> {
  return new Set(WIDGET_REGISTRY.keys());
}

/**
 * Filter the gallery by free text and category. Matching is done against the
 * name, summary, category and keywords.
 */
export function searchWidgetDefinitions(
  query: string,
  category: WidgetCategory | 'all' = 'all',
): readonly WidgetDefinition[] {
  const needle = query.trim().toLowerCase();
  return WIDGET_DEFINITIONS.filter((definition) => {
    if (category !== 'all' && definition.category !== category) return false;
    if (needle === '') return true;
    const haystack = [definition.name, definition.summary, definition.category, ...(definition.keywords ?? [])]
      .join(' ')
      .toLowerCase();
    return haystack.includes(needle);
  });
}

/** Categories that actually have widgets, in canonical order. */
export function availableCategories(): readonly { id: WidgetCategory; label: string }[] {
  const used = new Set(WIDGET_DEFINITIONS.map((definition) => definition.category));
  return WIDGET_CATEGORIES.filter((category) => used.has(category.id));
}
