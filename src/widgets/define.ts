/**
 * Plugin authoring helper.
 *
 * Widget definitions are authored with their *own* config type
 * (`defineWidget<ClockConfig>({ ... })`), which gives full type checking inside
 * the definition. The registry stores the type-erased `WidgetDefinition`, so
 * generic code (the renderer, the settings form, the import pipeline) can work
 * with every widget without knowing its config shape.
 *
 * This single cast is the plugin boundary — everything on either side of it
 * stays fully typed.
 */
import type { WidgetConfig, WidgetDefinition } from '@/types';

export function defineWidget<C extends object>(definition: WidgetDefinition<C>): WidgetDefinition<WidgetConfig> {
  return definition as unknown as WidgetDefinition<WidgetConfig>;
}
