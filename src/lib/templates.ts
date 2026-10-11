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

/**
 * What a first visit starts from.
 *
 * Six panels rather than sixteen: enough to look alive and to show what a widget
 * is, without a wall of cards to scroll past before you understand the page. The
 * full showcase is one click away in Templates.
 */
const STARTER: TemplateSpec = {
  title: 'My dashboard',
  description: 'Six panels to begin with: the time and the weather, your links, today’s tasks, a calendar and a notebook.',
  widgets: [
    { type: 'clock', x: 0, y: 0, w: 3, h: 6 },
    // No city baked in: the widget asks for one rather than showing Lisbon.
    { type: 'weather', x: 3, y: 0, w: 3, h: 6 },
    { type: 'links', x: 6, y: 0, w: 6, h: 6, minH: 4 },

    { type: 'tasks', x: 0, y: 6, w: 4, h: 7 },
    { type: 'calendar', x: 4, y: 6, w: 8, h: 8 },

    { type: 'notes', x: 0, y: 14, w: 12, h: 7 },
  ],
};

const PERSONAL: TemplateSpec = {
  title: 'Complete workspace',
  description: 'Sixteen panels: the time and the weather, what is on today, markets and headlines, and the notebooks beside them.',
  widgets: [
    // The "now" strip: where you are, when it is, and what the sky is doing.
    { type: 'clock', x: 0, y: 0, w: 3, h: 6 },
    { type: 'weather', x: 3, y: 0, w: 3, h: 6 },
    { type: 'sun', x: 6, y: 0, w: 3, h: 6, config: { city: 'Lisbon' } },
    { type: 'worldclock', x: 9, y: 0, w: 3, h: 6 },

    // The day itself: a list, a month, and a dial for the work you are doing.
    { type: 'tasks', x: 0, y: 6, w: 3, h: 7 },
    { type: 'calendar', x: 3, y: 6, w: 6, h: 7 },
    { type: 'timer', x: 9, y: 6, w: 3, h: 7 },

    { type: 'market', x: 0, y: 13, w: 6, h: 7 },
    { type: 'news', x: 6, y: 13, w: 6, h: 7 },

    // Writing, keeping count, and the dates worth waiting for.
    { type: 'notes', x: 0, y: 20, w: 6, h: 7 },
    { type: 'habits', x: 6, y: 20, w: 3, h: 7 },
    {
      type: 'countdown',
      x: 9,
      y: 20,
      w: 3,
      h: 7,
      // One honest example rather than invented plans: a date everybody has.
      config: {
        events: [
          { id: 'countdown-new-year', label: 'New Year’s Day', date: '2026-01-01', time: null, annual: true, tone: 'violet' },
        ],
      },
    },

    { type: 'onthisday', x: 0, y: 27, w: 6, h: 6 },
    { type: 'air', x: 6, y: 27, w: 3, h: 6, config: { city: 'Lisbon' } },
    { type: 'converter', x: 9, y: 27, w: 3, h: 6, config: { mode: 'currency', base: 'USD', quote: 'EUR' } },

    { type: 'links', x: 0, y: 33, w: 12, h: 4, minH: 3 },
  ],
};

const TRADING_DESK: TemplateSpec = {
  title: 'Markets desk',
  description: 'A trading focused workspace with live tickers, a currency converter, headlines and exchange shortcuts.',
  widgets: [
    { type: 'market', x: 0, y: 0, w: 8, h: 9, config: { symbols: 'BTC, ETH, SOL, NVDA, AAPL, TSLA', kind: 'all' } },
    { type: 'clock', x: 8, y: 0, w: 4, h: 4, config: { hour12: false, showSeconds: true, label: 'Market clock' } },
    {
      type: 'converter',
      x: 8,
      y: 4,
      w: 4,
      h: 6,
      config: { mode: 'currency', base: 'USD', quote: 'EUR', showSeries: true },
    },
    {
      type: 'news',
      x: 8,
      y: 10,
      w: 4,
      h: 9,
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

const WELLNESS: TemplateSpec = {
  title: 'Wellness week',
  description: 'Habits, a focus timer and the outdoor readings: daylight, air quality and the day’s plan.',
  widgets: [
    { type: 'habits', x: 0, y: 0, w: 4, h: 8 },
    { type: 'timer', x: 4, y: 0, w: 4, h: 8 },
    { type: 'sun', x: 8, y: 0, w: 4, h: 6 },
    { type: 'air', x: 8, y: 6, w: 4, h: 6 },
    { type: 'tasks', x: 0, y: 8, w: 4, h: 7 },
    { type: 'notes', x: 4, y: 8, w: 4, h: 7, config: { mode: 'edit' } },
  ],
};

const ENGINEER: TemplateSpec = {
  title: 'Engineer desk',
  description: 'A repository, the machine it runs on, the task list and today’s technology headlines.',
  widgets: [
    { type: 'github', x: 0, y: 0, w: 4, h: 6 },
    { type: 'system', x: 4, y: 0, w: 4, h: 7, config: { showNetwork: false } },
    { type: 'tasks', x: 8, y: 0, w: 4, h: 7 },
    { type: 'timer', x: 0, y: 6, w: 4, h: 7 },
    { type: 'news', x: 4, y: 7, w: 8, h: 6, config: { topic: 'technology', limit: 6 } },
    {
      type: 'links',
      x: 0,
      y: 13,
      w: 12,
      h: 4,
      config: {
        links: [
          { id: 'eng-1', label: 'GitHub', url: 'https://github.com' },
          { id: 'eng-2', label: 'MDN Web Docs', url: 'https://developer.mozilla.org' },
          { id: 'eng-3', label: 'Can I use', url: 'https://caniuse.com' },
          { id: 'eng-4', label: 'Hacker News', url: 'https://news.ycombinator.com' },
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
  { id: 'starter', name: 'Starter', description: STARTER.description, build: () => buildTemplate(STARTER) },
  { id: 'personal', name: 'Complete workspace', description: PERSONAL.description, build: () => buildTemplate(PERSONAL) },
  { id: 'markets', name: 'Markets desk', description: TRADING_DESK.description, build: () => buildTemplate(TRADING_DESK) },
  { id: 'wellness', name: 'Wellness week', description: WELLNESS.description, build: () => buildTemplate(WELLNESS) },
  { id: 'engineer', name: 'Engineer desk', description: ENGINEER.description, build: () => buildTemplate(ENGINEER) },
  { id: 'focus', name: 'Focus desk', description: FOCUS_DESK.description, build: () => buildTemplate(FOCUS_DESK) },
  { id: 'minimal', name: 'Minimal', description: MINIMAL.description, build: () => buildTemplate(MINIMAL) },
];

/** The template a first visit starts from, and that "Restore" brings back. */
export const DEFAULT_TEMPLATE_ID = 'starter';

/** The full sixteen-panel showcase, offered as an example on a first visit. */
export const COMPLETE_TEMPLATE_ID = 'personal';

export function getTemplate(id: string): DashboardTemplate | undefined {
  return DASHBOARD_TEMPLATES.find((template) => template.id === id);
}

/** Build the default workspace (fresh ids every call, so instances never collide). */
export function buildDefaultWorkspace(): DashboardSnapshot & { title: string; description: string } {
  const template = getTemplate(DEFAULT_TEMPLATE_ID) ?? DASHBOARD_TEMPLATES[0];
  return template.build();
}
