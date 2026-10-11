import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { PREF_SECRET_KEYS } from '@/store/prefsStore';
import { getWidgetDefinition, WIDGET_DEFINITIONS, widgetTypes } from '@/widgets/registry';
import { createWidgetInstance } from '@/widgets/factory';

/**
 * Registry invariants.
 *
 * A widget is only real if the gallery can describe it, the settings form can
 * drive it and its component can render — with nothing but its own defaults. The
 * render pass is a plain server render (no DOM, no effects), which is enough to
 * catch a widget that throws on an empty config, reads a missing field or
 * reaches for a browser API during render.
 */
describe('widget registry', () => {
  it('registers every widget exactly once, with usable metadata', () => {
    const types = widgetTypes();
    expect(types.length).toBeGreaterThanOrEqual(19);
    expect(new Set(types).size).toBe(types.length);

    for (const definition of WIDGET_DEFINITIONS) {
      expect(definition.name, definition.type).not.toBe('');
      expect(definition.summary, definition.type).not.toBe('');
      expect(definition.defaultSize.w, definition.type).toBeGreaterThan(0);
      expect(definition.defaultSize.h, definition.type).toBeGreaterThan(0);
      // Every widget has to fit a phone: the xs breakpoint is four columns, so a
      // wider minimum would make the card unplaceable there.
      expect(definition.defaultSize.minW ?? 1, `${definition.type}.minW`).toBeLessThanOrEqual(4);
      expect(definition.defaultSize.minW ?? 1, `${definition.type}.minW`).toBeLessThanOrEqual(
        definition.defaultSize.w,
      );
      expect(definition.defaultSize.minH ?? 1, `${definition.type}.minH`).toBeLessThanOrEqual(
        definition.defaultSize.h,
      );
    }
  });

  it('points every settings field at something it can write to', () => {
    const secrets = new Set<string>(PREF_SECRET_KEYS);
    for (const definition of WIDGET_DEFINITIONS) {
      for (const field of definition.settings ?? []) {
        const writable =
          Object.prototype.hasOwnProperty.call(definition.defaultConfig, field.key) || secrets.has(field.key);
        expect(writable, `${definition.type}.${field.key} is neither in defaultConfig nor a preference`).toBe(true);
      }
    }
  });

  it('renders every registered widget from its default config', () => {
    for (const definition of WIDGET_DEFINITIONS) {
      const instance = createWidgetInstance(definition.type);
      expect(instance, definition.type).not.toBeNull();
      const Component = definition.component;
      const html = renderToStaticMarkup(
        <Component
          instance={instance!}
          config={instance!.config}
          updateConfig={() => {}}
          replaceConfig={() => {}}
          setTitle={() => {}}
        />,
      );
      expect(html.length, definition.type).toBeGreaterThan(40);
      // A config read that went wrong shows up as `undefined` in the markup.
      expect(html, definition.type).not.toContain('>undefined<');
    }
  });

  it('describes a widget with its own summarize, without throwing', () => {
    for (const definition of WIDGET_DEFINITIONS) {
      const instance = createWidgetInstance(definition.type);
      const summary = definition.summarize?.(instance!.config);
      if (summary !== undefined) {
        expect(summary.length, definition.type).toBeGreaterThan(0);
      }
    }
  });

  it('resolves a definition by type and rejects an unknown one', () => {
    expect(getWidgetDefinition('clock')?.type).toBe('clock');
    expect(getWidgetDefinition('nope')).toBeUndefined();
  });
});
