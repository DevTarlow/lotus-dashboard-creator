import { beforeEach, describe, expect, it } from 'vitest';
import { BREAKPOINT_ORDER } from '@/constants/grid';
import { buildDefaultWorkspace, DASHBOARD_TEMPLATES, DEFAULT_TEMPLATE_ID, getTemplate } from '@/lib/templates';
import { useDashboardStore } from '@/store/dashboardStore';
import { getWidgetDefinition } from '@/widgets/registry';
import { widgetTypes } from '@/widgets/registry';

function resetStore(): void {
  const workspace = buildDefaultWorkspace();
  useDashboardStore.setState({
    title: workspace.title,
    description: workspace.description,
    widgets: workspace.widgets,
    layouts: workspace.layouts,
    locked: false,
    past: [],
    future: [],
    updatedAt: Date.now(),
  });
}

describe('dashboard store', () => {
  beforeEach(resetStore);

  it('starts from the default template', () => {
    const state = useDashboardStore.getState();
    const template = getTemplate(DEFAULT_TEMPLATE_ID);
    expect(state.widgets.length).toBeGreaterThanOrEqual(4);
    expect(state.title).toBe(template?.build().title);
  });

  it('adds a widget and places it on every breakpoint', () => {
    const id = useDashboardStore.getState().addWidget('clock');
    expect(id).toBeTruthy();
    const state = useDashboardStore.getState();
    expect(state.widgets.some((widget) => widget.id === id)).toBe(true);
    for (const breakpoint of BREAKPOINT_ORDER) {
      expect(state.layouts[breakpoint]?.some((item) => item.i === id)).toBe(true);
    }
  });

  it('returns null for an unregistered widget type', () => {
    expect(useDashboardStore.getState().addWidget('nope')).toBeNull();
    expect(useDashboardStore.getState().past).toHaveLength(0);
  });

  it('removes a widget everywhere and can undo it', () => {
    const [first] = useDashboardStore.getState().widgets;
    useDashboardStore.getState().removeWidget(first.id);
    expect(useDashboardStore.getState().widgets.some((widget) => widget.id === first.id)).toBe(false);
    for (const breakpoint of BREAKPOINT_ORDER) {
      expect(useDashboardStore.getState().layouts[breakpoint]?.some((item) => item.i === first.id)).toBe(false);
    }

    useDashboardStore.getState().undo();
    const restored = useDashboardStore.getState();
    expect(restored.widgets.some((widget) => widget.id === first.id)).toBe(true);
    for (const breakpoint of BREAKPOINT_ORDER) {
      expect(restored.layouts[breakpoint]?.some((item) => item.i === first.id)).toBe(true);
    }

    useDashboardStore.getState().redo();
    expect(useDashboardStore.getState().widgets.some((widget) => widget.id === first.id)).toBe(false);
  });

  it('updates and resets widget config', () => {
    const [first] = useDashboardStore.getState().widgets;
    useDashboardStore.getState().updateWidgetConfig(first.id, { custom: 'value' });
    expect(useDashboardStore.getState().widgets[0]?.config.custom).toBe('value');

    useDashboardStore.getState().resetWidgetConfig(first.id);
    const definition = getWidgetDefinition(first.type);
    expect(useDashboardStore.getState().widgets[0]?.config).toEqual(definition?.defaultConfig);
  });

  it('duplicates a widget next to the original', () => {
    const [first] = useDashboardStore.getState().widgets;
    const newId = useDashboardStore.getState().duplicateWidget(first.id);
    expect(newId).toBeTruthy();
    const state = useDashboardStore.getState();
    expect(state.widgets).toHaveLength(resetStoreLength() + 1);
    expect(state.widgets.at(-1)?.title).toContain('copy');
  });

  it('coalesces rapid layout changes into a single history entry', () => {
    const id = useDashboardStore.getState().addWidget('clock');
    const before = useDashboardStore.getState().past.length;

    const state = useDashboardStore.getState();
    const moved = {
      ...state.layouts,
      lg: (state.layouts.lg ?? []).map((item) => (item.i === id ? { ...item, y: item.y + 4 } : item)),
    };
    useDashboardStore.getState().applyLayouts(moved);
    expect(useDashboardStore.getState().past.length).toBe(before + 1);

    const movedAgain = {
      ...moved,
      lg: (moved.lg ?? []).map((item) => (item.i === id ? { ...item, x: 1 } : item)),
    };
    useDashboardStore.getState().applyLayouts(movedAgain);
    // Same coalescing window → still one entry.
    expect(useDashboardStore.getState().past.length).toBe(before + 1);

    useDashboardStore.getState().undo();
    expect(useDashboardStore.getState().layouts.lg?.find((item) => item.i === id)?.y).not.toBe(
      moved.lg?.find((item) => item.i === id)?.y,
    );
  });

  it('ignores layout reports that change nothing', () => {
    const before = useDashboardStore.getState().past.length;
    useDashboardStore.getState().applyLayouts(useDashboardStore.getState().layouts);
    expect(useDashboardStore.getState().past.length).toBe(before);
  });

  it('tidies the layout', () => {
    const state = useDashboardStore.getState();
    const [first] = state.widgets;
    useDashboardStore.getState().applyLayouts({
      ...state.layouts,
      lg: (state.layouts.lg ?? []).map((item) => (item.i === first.id ? { ...item, y: item.y + 6 } : item)),
    });
    useDashboardStore.getState().tidyLayout();
    const tidy = useDashboardStore.getState().layouts.lg ?? [];
    expect(Math.min(...tidy.map((item) => item.y))).toBe(0);
  });

  it('applies templates and restores the default', () => {
    const template = DASHBOARD_TEMPLATES.find((entry) => entry.id !== DEFAULT_TEMPLATE_ID);
    expect(template).toBeDefined();
    if (!template) return;

    useDashboardStore.getState().applyTemplate(template);
    expect(useDashboardStore.getState().title).toBe(template.build().title);
    expect(useDashboardStore.getState().widgets.length).toBeGreaterThan(0);

    useDashboardStore.getState().resetDashboard();
    expect(useDashboardStore.getState().title).toBe(getTemplate(DEFAULT_TEMPLATE_ID)?.build().title);
  });

  it('clears the canvas', () => {
    useDashboardStore.getState().clearDashboard();
    expect(useDashboardStore.getState().widgets).toEqual([]);
    for (const breakpoint of BREAKPOINT_ORDER) {
      expect(useDashboardStore.getState().layouts[breakpoint]).toEqual([]);
    }
  });

  it('exports and re-imports its own document', () => {
    useDashboardStore.getState().addWidget('news');
    const document = useDashboardStore.getState().exportDocument();
    const widgetCount = useDashboardStore.getState().widgets.length;

    useDashboardStore.getState().clearDashboard();
    expect(useDashboardStore.getState().widgets).toHaveLength(0);

    useDashboardStore.getState().loadDocument(document);
    expect(useDashboardStore.getState().widgets).toHaveLength(widgetCount);
    for (const breakpoint of BREAKPOINT_ORDER) {
      expect(useDashboardStore.getState().layouts[breakpoint]).toHaveLength(widgetCount);
    }
  });

  it('never lets the dashboard title become empty', () => {
    useDashboardStore.getState().setTitle('   ');
    expect(useDashboardStore.getState().title).toBe('My dashboard');
    useDashboardStore.getState().setTitle('  Trading  ');
    expect(useDashboardStore.getState().title).toBe('Trading');
  });
});

function resetStoreLength(): number {
  return buildDefaultWorkspace().widgets.length;
}

describe('widget registry', () => {
  it('registers the documented widgets with unique types', () => {
    const types = widgetTypes();
    expect(types).toEqual(expect.arrayContaining(['clock', 'weather', 'notes', 'links', 'market', 'news']));
    expect(new Set(types).size).toBe(types.length);
  });

  it('gives every widget a component, defaults and a size', () => {
    for (const type of widgetTypes()) {
      const definition = getWidgetDefinition(type);
      expect(definition, type).toBeDefined();
      expect(definition?.component, type).toBeTypeOf('function');
      expect(definition?.defaultConfig, type).toBeTypeOf('object');
      expect(definition?.defaultSize.w, type).toBeGreaterThan(0);
      expect(definition?.defaultSize.h, type).toBeGreaterThan(0);
    }
  });
});
