import { describe, expect, it } from 'vitest';
import { BREAKPOINT_ORDER, GRID_COLUMNS, REFERENCE_COLUMNS } from '@/constants/grid';
import { layoutsEqual } from '@/lib/grid';
import { DASHBOARD_TEMPLATES, buildDefaultWorkspace, getTemplate } from '@/lib/templates';
import { getWidgetDefinition } from '@/widgets/registry';

describe('templates', () => {
  it('exposes the default template first', () => {
    expect(DASHBOARD_TEMPLATES.length).toBeGreaterThanOrEqual(3);
    expect(getTemplate('personal')).toBe(DASHBOARD_TEMPLATES[0]);
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
});
