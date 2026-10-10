/**
 * The widget registry.
 *
 * Adding a widget to Lotus means three lines here: import its definition and add
 * it to {@link WIDGET_DEFINITIONS}. Everything else — the gallery, the settings
 * modal, validation, persistence — picks it up automatically.
 */
import type { WidgetCategory, WidgetDefinition } from '@/types';
import { clockWidget } from './clock';
import { linksWidget } from './links';
import { marketWidget } from './market';
import { newsWidget } from './news';
import { notesWidget } from './notes';
import { weatherWidget } from './weather';

/** Every registered widget, in gallery order. */
export const WIDGET_DEFINITIONS: readonly WidgetDefinition[] = [
  clockWidget,
  weatherWidget,
  notesWidget,
  linksWidget,
  marketWidget,
  newsWidget,
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
