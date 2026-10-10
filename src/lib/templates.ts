/**
 * Starter templates.
 *
 * Layouts are authored on the 12 column reference grid; narrower breakpoints are
 * filled automatically by the first-fit packer, so a template stays usable on a
 * phone without any extra authoring.
 */
import { GRID_COLUMNS } from '@/constants/grid';
import { placeWidget } from '@/lib/grid';
import type { BreakpointId, DashboardSnapshot, DashboardTemplate, LayoutsByBreakpoint, StoredWidgetInstance, WidgetConfig } from '@/types';
import { createWidgetInstance } from '@/widgets/factory';
import { getWidgetDefinition } from '@/widgets/registry';

interface TemplateWidget {
  type: string;
  title?: string;
  config?: WidgetConfig;
  /** Position/size on the 12 column reference grid. */
  x: number;
  y: number;
  w: number;
  h: number;
  minW?: number;
  minH?: number;
}

interface TemplateSpec {
  title: string;
  description: string;
  widgets: readonly TemplateWidget[];
}

/** Breakpoints that share the reference column count and can reuse the authoring grid. */
const REFERENCE_BREAKPOINTS: readonly BreakpointId[] = ['xl', 'lg'];

function buildTemplate(spec: TemplateSpec): DashboardSnapshot & { title: string; description: string } {
  const widgets: StoredWidgetInstance[] = [];
  let layouts: LayoutsByBreakpoint = {};

  for (const item of spec.widgets) {
    const instance = createWidgetInstance(item.type, { title: item.title, config: item.config });
    if (!instance) continue;
    widgets.push(instance);

    // Templates may override the footprint; minimums fall back to the widget's
    // own declared minimums so a template can never make a widget unusable.
    const definition = getWidgetDefinition(item.type);
    const size = {
      w: item.w,
      h: item.h,
      minW: item.minW ?? definition?.defaultSize.minW,
      minH: item.minH ?? definition?.defaultSize.minH,
    };
    for (const breakpoint of REFERENCE_BREAKPOINTS) {
      layouts = placeWidget(layouts, { id: instance.id, size }, GRID_COLUMNS, {
        breakpoint,
        x: item.x,
        y: item.y,
        size,
      });
    }
  }

  return { title: spec.title, description: spec.description, widgets, layouts };
}

const PERSONAL: TemplateSpec = {
  title: 'My dashboard',
  description: 'Clock, weather, notes, markets and bookmarks at a glance.',
  widgets: [
    { type: 'clock', x: 0, y: 0, w: 3, h: 6 },
    { type: 'weather', x: 3, y: 0, w: 3, h: 6 },
    { type: 'notes', x: 6, y: 0, w: 6, h: 6 },
    { type: 'market', x: 0, y: 6, w: 6, h: 7 },
    { type: 'news', x: 6, y: 6, w: 6, h: 7 },
    { type: 'links', x: 0, y: 13, w: 12, h: 4, minH: 3 },
  ],
};

const TRADING_DESK: TemplateSpec = {
  title: 'Markets desk',
  description: 'A trading focused workspace with live tickers, headlines and exchange shortcuts.',
  widgets: [
    { type: 'market', x: 0, y: 0, w: 8, h: 9, config: { symbols: 'BTC, ETH, SOL, NVDA, AAPL, TSLA', kind: 'all' } },
    { type: 'clock', x: 8, y: 0, w: 4, h: 4, config: { hour12: false, showSeconds: true, label: 'Market clock' } },
    {
      type: 'news',
      x: 8,
      y: 4,
      w: 4,
      h: 11,
      // No "markets" feed exists without a key, so a desk watching the tape gets
      // the world desk's macro headlines instead of invented market copy.
      config: { topic: 'world', limit: 8 },
    },
    {
      type: 'links',
      x: 0,
      y: 9,
      w: 8,
      h: 6,
      config: {
        links: [
          { id: 'ex-1', label: 'CoinGecko', url: 'https://www.coingecko.com' },
          { id: 'ex-2', label: 'TradingView', url: 'https://www.tradingview.com' },
          { id: 'ex-3', label: 'Yahoo Finance', url: 'https://finance.yahoo.com' },
          { id: 'ex-4', label: 'SEC Filings', url: 'https://www.sec.gov/edgar' },
        ],
      },
    },
  ],
};

const FOCUS_DESK: TemplateSpec = {
  title: 'Focus desk',
  description: 'A calm writing setup: one big scratchpad, a clock and research links.',
  widgets: [
    { type: 'notes', x: 0, y: 0, w: 8, h: 12, config: { mode: 'split' } },
    { type: 'clock', x: 8, y: 0, w: 4, h: 5, config: { showSeconds: false, label: 'Deep work' } },
    {
      type: 'links',
      x: 8,
      y: 5,
      w: 4,
      h: 7,
      config: {
        links: [
          { id: 'focus-1', label: 'MDN Web Docs', url: 'https://developer.mozilla.org' },
          { id: 'focus-2', label: 'React docs', url: 'https://react.dev' },
          { id: 'focus-3', label: 'TypeScript', url: 'https://www.typescriptlang.org/docs' },
        ],
      },
    },
    { type: 'weather', x: 0, y: 12, w: 4, h: 6 },
    { type: 'news', x: 4, y: 12, w: 8, h: 6, config: { topic: 'technology', limit: 5 } },
  ],
};

const MINIMAL: TemplateSpec = {
  title: 'Minimal',
  description: 'Just the essentials — a clock and a scratchpad.',
  widgets: [
    { type: 'clock', x: 0, y: 0, w: 4, h: 6 },
    { type: 'notes', x: 4, y: 0, w: 8, h: 6 },
  ],
};

/** All templates, default first. */
export const DASHBOARD_TEMPLATES: readonly DashboardTemplate[] = [
  { id: 'personal', name: 'Personal workspace', description: PERSONAL.description, build: () => buildTemplate(PERSONAL) },
  { id: 'markets', name: 'Markets desk', description: TRADING_DESK.description, build: () => buildTemplate(TRADING_DESK) },
  { id: 'focus', name: 'Focus desk', description: FOCUS_DESK.description, build: () => buildTemplate(FOCUS_DESK) },
  { id: 'minimal', name: 'Minimal', description: MINIMAL.description, build: () => buildTemplate(MINIMAL) },
];

/** The template used for a first visit and for "Reset dashboard". */
export const DEFAULT_TEMPLATE_ID = 'personal';

export function getTemplate(id: string): DashboardTemplate | undefined {
  return DASHBOARD_TEMPLATES.find((template) => template.id === id);
}

/** Build the default workspace (fresh ids every call, so instances never collide). */
export function buildDefaultWorkspace(): DashboardSnapshot & { title: string; description: string } {
  const template = getTemplate(DEFAULT_TEMPLATE_ID) ?? DASHBOARD_TEMPLATES[0];
  return template.build();
}
