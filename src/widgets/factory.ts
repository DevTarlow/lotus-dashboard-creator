/**
 * Widget instance factory — the single place where new instances are born.
 */
import type { StoredWidgetInstance, WidgetConfig } from '@/types';
import { createId } from '@/lib/utils';
import { getWidgetDefinition } from './registry';

export interface CreateWidgetOptions {
  /** Preferred title; defaults to the widget definition name. */
  title?: string;
  /** Config overrides merged on top of the widget defaults. */
  config?: WidgetConfig;
  /** Explicit id (used by tests and migrations). */
  id?: string;
  /** Explicit creation timestamp. */
  createdAt?: number;
}

/** Deep clone a config object so instances never share references. */
export function cloneConfig<C extends object>(config: C): C {
  if (typeof structuredClone === 'function') {
    try {
      return structuredClone(config);
    } catch {
      // Fall through to the JSON strategy for non-cloneable values.
    }
  }
  return JSON.parse(JSON.stringify(config)) as C;
}

/**
 * Create a widget instance for a registry type.
 * Returns `null` when the type is not registered.
 */
export function createWidgetInstance(type: string, options: CreateWidgetOptions = {}): StoredWidgetInstance | null {
  const definition = getWidgetDefinition(type);
  if (!definition) return null;
  const config: WidgetConfig = {
    ...cloneConfig(definition.defaultConfig),
    ...(options.config ?? {}),
  };
  return {
    id: options.id ?? createId(type),
    type: definition.type,
    title: options.title?.trim() || definition.name,
    config,
    createdAt: options.createdAt ?? Date.now(),
  };
}
