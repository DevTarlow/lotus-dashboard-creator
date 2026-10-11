import { describe, expect, it } from 'vitest';
import { BREAKPOINT_ORDER, GRID_COLUMNS, REFERENCE_COLUMNS } from '@/constants/grid';
import { layoutsEqual } from '@/lib/grid';
import {
  COMPLETE_TEMPLATE_ID,
  DASHBOARD_TEMPLATES,
  DEFAULT_TEMPLATE_ID,
  buildDefaultWorkspace,
  getTemplate,
} from '@/lib/templates';
import { getWidgetDefinition } from '@/widgets/registry';

describe('templates', () => {
  it('keeps the default template, and only the default template, first', () => {
    expect(DASHBOARD_TEMPLATES.length).toBeGreaterThanOrEqual(3);
    expect(getTemplate(DEFAULT_TEMPLATE_ID)).toBe(DASHBOARD_TEMPLATES[0]);
    expect(DASHBOARD_TEMPLATES.filter((template) => template.id === DEFAULT_TEMPLATE_ID)).toHaveLength(1);
    expect(getTemplate('nope')).toBeUndefined();
  });

  it('builds a self consistent workspace for every template', () => {
    for (const template of DASHBOARD_TEMPLATES) {
      const built = template.build();
      expect(built.widgets.length, template.id).toBeGreaterThan(0);
      expect(built.title.length, template.id).toBeGreaterThan(0);

      const ids = built.widgets.map((widget) => widget.id);
      expect(new Set(ids).size, `${template.id} ids must be unique`).toBe(ids.length);

      for (const breakpoint of BREAKPOINT_ORDER) {
        const layout = built.layouts[breakpoint] ?? [];
        expect(layout, `${template.id}/${breakpoint}`).toHaveLength(built.widgets.length);
        for (const item of layout) {
          expect(ids, `${template.id}/${breakpoint} refers to a known widget`).toContain(item.i);
          expect(item.w).toBeLessThanOrEqual(GRID_COLUMNS[breakpoint]);
          expect(item.x + item.w).toBeLessThanOrEqual(GRID_COLUMNS[breakpoint]);
          expect(item.y).toBeGreaterThanOrEqual(0);
        }
      }

      // The reference layouts (xl/lg) are authored, so they must differ from a
      // naive vertical stack.
      expect(layoutsEqual({ lg: built.layouts.lg }, { lg: [] })).toBe(false);
    }
  });

  it('uses registered widget types and honoured config overrides', () => {
    for (const template of DASHBOARD_TEMPLATES) {
      const built = template.build();
      for (const widget of built.widgets) {
        const definition = getWidgetDefinition(widget.type);
        expect(definition, `${template.id} → ${widget.type}`).toBeDefined();
        // Every config key must exist in the widget defaults.
        for (const key of Object.keys(widget.config)) {
          expect(Object.keys(definition?.defaultConfig ?? {}), `${widget.type}.${key}`).toContain(key);
        }
      }
    }
  });

  it('generates fresh ids on every build', () => {
    const first = buildDefaultWorkspace();
    const second = buildDefaultWorkspace();
    expect(first.widgets[0]?.id).not.toBe(second.widgets[0]?.id);
  });

  it('fills narrower breakpoints with scaled widths', () => {
    const built = buildDefaultWorkspace();
    const referenceItem = built.layouts.lg?.[0];
    const mobileItem = built.layouts.xs?.find((item) => item.i === referenceItem?.i);
    expect(referenceItem).toBeDefined();
    expect(mobileItem).toBeDefined();
    expect(referenceItem!.w).toBeLessThanOrEqual(REFERENCE_COLUMNS);
    expect(mobileItem!.w).toBeLessThanOrEqual(GRID_COLUMNS.xs);
  });

  it('starts a first visit on a handful of panels, not the whole showcase', () => {
    const built = buildDefaultWorkspace();
    expect(built.widgets).toHaveLength(6);
    expect(built.title).toBe('My dashboard');

    const types = built.widgets.map((widget) => widget.type);
    expect(types).toEqual(['clock', 'weather', 'links', 'tasks', 'calendar', 'notes']);
  });

  it('does not bake a city into the starter panels', () => {
    // A first visit has no idea where the user is; asking is honest, and Lisbon
    // behind a hover-only settings gear is not.
    for (const widget of buildDefaultWorkspace().widgets) {
      if ('city' in widget.config) expect(widget.config.city, widget.type).toBe('');
    }
  });

  it('keeps the sixteen-panel showcase available', () => {
    const complete = getTemplate(COMPLETE_TEMPLATE_ID);
    expect(complete?.name).toBe('Complete workspace');
    const built = complete!.build();
    expect(built.widgets).toHaveLength(16);

    const types = new Set(built.widgets.map((widget) => widget.type));
    for (const type of [
      'clock',
      'weather',
      'sun',
      'worldclock',
      'tasks',
      'calendar',
      'timer',
      'market',
      'news',
      'notes',
      'habits',
      'countdown',
      'onthisday',
      'air',
      'converter',
      'links',
    ]) {
      expect(types, type).toContain(type);
    }
  });

  it('lays the preloaded workspace out without overlapping cards', () => {
    const built = buildDefaultWorkspace();

    for (const breakpoint of ['xl', 'lg'] as const) {
      const layout = built.layouts[breakpoint] ?? [];
      expect(layout, breakpoint).toHaveLength(built.widgets.length);

      for (let a = 0; a < layout.length; a += 1) {
        for (let b = a + 1; b < layout.length; b += 1) {
          const first = layout[a];
          const second = layout[b];
          const apart =
            first.x + first.w <= second.x ||
            second.x + second.w <= first.x ||
            first.y + first.h <= second.y ||
            second.y + second.h <= first.y;
          expect(apart, `${breakpoint}: ${first.i} overlaps ${second.i}`).toBe(true);
        }
      }
    }
  });

  it('keeps every preloaded card within the phone grid', () => {
    const built = buildDefaultWorkspace();
    const layout = built.layouts.xs ?? [];
    for (const item of layout) {
      expect(item.w, item.i).toBeLessThanOrEqual(GRID_COLUMNS.xs);
      expect(item.minW ?? 1, item.i).toBeLessThanOrEqual(GRID_COLUMNS.xs);
    }
  });
});
