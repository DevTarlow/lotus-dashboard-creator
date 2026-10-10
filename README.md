# Lotus Dashboard Creator

A modular, drag-and-drop dashboard builder for the browser. Arrange, resize and
persist your own workspace of widgets — live clock, weather, markdown scratchpad,
quick links, market ticker and a news feed — with a plugin architecture that
makes adding a seventh widget a single file.

Built with **Vite 8 · React 19 · TypeScript (strict) · Tailwind CSS 4 · Zustand 5
· react-grid-layout 2**.

![Lotus Dashboard Creator, dark theme](docs/dashboard-dark.png)

<p align="center">
  <img src="docs/dashboard-light.png" alt="Light theme" width="49%" />
  <img src="docs/widget-gallery.png" alt="Widget gallery drawer" width="49%" />
</p>

---

## Table of contents

- [Features](#features)
- [Quick start](#quick-start)
- [Project structure](#project-structure)
- [Architecture](#architecture)
- [Writing your own widget](#writing-your-own-widget)
- [Keyboard shortcuts](#keyboard-shortcuts)
- [The layout JSON format](#the-layout-json-format)
- [Testing & verification](#testing--verification)
- [Performance notes](#performance-notes)
- [Accessibility](#accessibility)
- [Notes & limitations](#notes--limitations)
- [License](#license)

## Features

**Canvas & layout engine**

- Responsive 12-column grid (5 breakpoints: `xl lg md sm xs`) with drag, resize
  and collision-aware compaction.
- Layout for **every** breakpoint is stored, so a phone layout and a desktop
  layout never fight each other.
- Live snap placeholder while dragging, resize handles on the south, east and
  south-east edges, and a **drag a card straight out of the gallery onto the
  grid** drop flow (mouse _and_ touch).
- Lock the layout to stop accidental drags, or hit **Tidy up** to close every
  gap.
- Add, duplicate, rename, reconfigure and remove individual widgets.

**Persistence & portability**

- Automatic `localStorage` persistence (debounced by zustand's `persist`
  middleware) — the dashboard is exactly as you left it after a reload, including
  the theme.
- **Export** the whole workspace as a self-describing JSON file, import it back
  from the file picker *or* by dropping the file onto the canvas, with a preview
  of what will change before anything is replaced.
- Undo/redo (`⌘/Ctrl + Z`) for every structural change: adding, removing,
  duplicating, dragging, resizing, tidying, applying templates, importing and
  resetting. Rapid edits are coalesced into a single history step.
- Four starter templates, plus a one-click reset to the default workspace.

**Widgets**

| Widget | Highlights |
| --- | --- |
| **Clock** | Live time in any IANA time zone, 12/24h, optional seconds, day-progress bar. |
| **Weather** | Simulated forecast (no API key, works offline) with hourly outlook and details. |
| **Markdown notes** | Auto-saving scratchpad with edit / split / preview modes and a dependency-free markdown renderer. |
| **Quick links** | Bookmark launcher with favicons (graceful initial-chip fallback), inline add/edit/remove. |
| **Market ticker** | Deterministic simulated quotes for crypto and stocks with sparklines and per-symbol add/remove. |
| **News feed** | Rotating simulated RSS-style headlines with topic filters and expandable summaries. |

**Polish**

- Dark / light / system theme with no flash of the wrong colour scheme on load.
- Toast notifications with undo actions, per-widget error boundaries, an empty
  state that explains what to do next, and a keyboard shortcut cheat sheet.
- Zero console errors or warnings — verified in a real browser (see
  [Testing & verification](#testing--verification)).

## Quick start

Requirements: **Node.js `^20.19` or `>=22.12`** and npm (or pnpm/yarn — the
lockfile is npm's).

```bash
# 1. install
npm install

# 2. start the dev server (http://localhost:5173)
npm run dev
```

Other scripts:

| Script | What it does |
| --- | --- |
| `npm run dev` | Vite dev server with HMR. |
| `npm run build` | Type-checks (`tsc --noEmit`) and builds to `dist/`. |
| `npm run preview` | Serves the production build on http://localhost:4173. |
| `npm run typecheck` | TypeScript only. |
| `npm run lint` | ESLint (flat config, TypeScript + React hooks rules). |
| `npm test` | Vitest unit suite (62 tests). |
| `npm run test:watch` | Vitest in watch mode. |
| `npm run verify` | typecheck → lint → test → build. |

The app is entirely client-side: no backend, no API keys, no network calls. The
weather, market and news widgets generate their data locally and label it as
simulated; the only optional network request is the favicon lookup for quick
links, which falls back to an initials chip when it is unavailable.

## Project structure

```
src/
├── App.tsx                     # shell: toolbar + canvas + status bar + overlays
├── main.tsx                    # React root, global CSS imports
├── components/
│   ├── feedback/               # ErrorBoundary, ToastViewport
│   ├── forms/SettingsForm.tsx  # schema-driven settings renderer
│   ├── icons.tsx               # ~35 inline SVG icons
│   ├── layout/                 # HeaderBar, StatusBar, DashboardCanvas,
│   │                           # WidgetFrame, ImportDropZone
│   ├── modals/                 # AddWidgetDrawer, WidgetSettingsModal,
│   │                           # TemplatesDialog, ImportDialog, ShortcutsDialog…
│   └── ui/                     # Button, Modal, Drawer, Dropdown, Field, Markdown…
├── constants/                  # app + grid constants (breakpoints, row height…)
├── hooks/                      # useInterval, useNow, useHotkeys, useTheme,
│                               # useDebouncedCallback, useFocusTrap, useClickOutside…
├── lib/
│   ├── grid.ts                 # pure layout maths (placement, packing, diffing)
│   ├── markdown.ts             # tokenising markdown parser
│   ├── validation.ts           # import/export validation & normalisation
│   ├── document.ts             # dashboard document building/serialising
│   ├── templates.ts            # starter templates
│   ├── storage.ts              # safe localStorage adapter (memory fallback)
│   ├── mock/                   # deterministic weather / market / news providers
│   └── utils.ts                # cn(), formatting, ids, download helpers…
├── store/
│   ├── dashboardStore.ts       # workspace, layouts, history, persistence
│   ├── prefsStore.ts           # theme + preferences
│   ├── toastStore.ts           # notifications
│   └── uiStore.ts              # which overlay is open, drag payload
├── styles/index.css            # Tailwind v4 theme, animations, grid theming
├── types/                      # layout.ts, widget.ts, dashboard.ts
├── widgets/
│   ├── define.ts               # plugin authoring helper (typed boundary)
│   ├── factory.ts              # instance factory
│   ├── registry.ts             # the widget registry (single source of truth)
│   ├── shared/                 # Sparkline, DeltaPill, WeatherGlyph
│   ├── clock/ weather/ notes/ links/ market/ news/
└── test/setup.ts               # in-memory localStorage for the unit suite
```

## Architecture

### State: four small stores, one direction of data

| Store | Responsibility | Persisted |
| --- | --- | --- |
| `dashboardStore` | Dashboard title, widget instances, per-breakpoint layouts, lock flag, undo/redo | ✅ `localStorage` |
| `prefsStore` | Theme mode, grid hints, delete confirmation | ✅ `localStorage` |
| `uiStore` | Open overlay, settings target, pending import, drag payload | ❌ |
| `toastStore` | Transient notifications | ❌ |

The canvas is a *controlled* grid: the store owns the layout, `react-grid-layout`
reports changes through `onLayoutChange`, and the store normalises and persists
them. Widgets never import the dashboard store — they receive `config` and an
`updateConfig` callback through `WidgetProps`, which keeps them pure, testable and
hot-reload friendly.

### Widgets are plugins

A widget is a `WidgetDefinition`: metadata, a default footprint on the 12-column
reference grid, a default config, an optional settings schema, and a React
component. `src/widgets/registry.ts` is the only place that knows the full list,
and everything else — the gallery, the settings modal, import validation,
persistence rehydration, templates — is driven by that registry. A widget type
that is not installed is kept in the document (with a warning) and rendered as an
“unavailable plugin” card instead of being silently dropped.

### Layout maths is pure and unit tested

`src/lib/grid.ts` contains the whole layout engine as pure functions:

- `placeWidget` — add a widget to **every** breakpoint, first-fit packed, or at an
  explicit drop position; already-placed widgets keep their slot.
- `packLayout` / `tidyLayouts` — first-fit packing that closes every hole.
- `reconcileLayouts` — make a layout map and a widget list agree (used on import
  and rehydration).
- `normalizeLayout` — clamp coordinates, drop malformed and duplicate entries.
- `layoutsEqual` — structural diff so redundant writes never touch storage.

Because it is pure, the import pipeline, the store and the tests all share exactly
the same behaviour.

### Persistence, migration and recovery

`localStorage` is accessed through `src/lib/storage.ts`, which probes availability
and silently degrades to an in-memory map when storage is blocked, full or absent.
Every rehydration runs through the same validator as an import
(`sanitizeWorkspace` → `validateDashboardDocument`), so a stale or hand-edited
payload can never produce a broken canvas: unknown widget types are kept,
out-of-range coordinates are clamped, missing layouts are generated, and unknown
layout entries are dropped.

Documents carry `format: "lotus-dashboard/v1"` and a `version`. Newer versions are
rejected with a readable message; older ones are migrated with a warning.

### Undo/redo

History stores snapshots of `{ widgets, layouts }`. Continuous gestures (a drag, a
settings slider, typing in a widget) share a *coalescing key* so they collapse
into one undo step instead of flooding the stack; the stack is capped at 40
entries.

### Theming

`theme` is `light | dark | system`. An inline script in `index.html` applies the
persisted choice before the first paint, so there is no flash of the wrong theme.
Tailwind v4 is configured with a class-based `dark` variant, and all widgets use
`dark:` utilities rather than runtime colour logic.

> **A react-grid-layout v2 gotcha, documented for posterity:** the grid clones
> your child element and injects the drag handlers (`onMouseDown`, …) *and* the
> resize handles as `children`. A wrapper component that does not forward those
> props renders perfectly but silently refuses to drag or resize. `WidgetFrame`
> forwards them explicitly — see the comments in
> `src/components/layout/WidgetFrame.tsx`.

## Writing your own widget

Two steps. First, create `src/widgets/hello/HelloWidget.tsx`:

```tsx
import { SparklesIcon } from '@/components/icons';
import type { SettingField, WidgetProps } from '@/types';
import { defineWidget } from '@/widgets/define';

// Use a `type` (not an `interface`) so the config is assignable to the generic
// WidgetConfig at the plugin boundary.
export type HelloConfig = {
  greeting: string;
  excited: boolean;
};

const SETTINGS: readonly SettingField[] = [
  { key: 'greeting', label: 'Greeting', type: 'text', placeholder: 'Hello' },
  { key: 'excited', label: 'Add an exclamation mark', type: 'switch' },
];

export function HelloWidget({ config, updateConfig }: WidgetProps<HelloConfig>) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2">
      <p className="text-lg font-semibold">
        {config.greeting}
        {config.excited ? '!' : ''}
      </p>
      <button
        type="button"
        className="rounded-lg bg-violet-600 px-3 py-1 text-xs text-white"
        onClick={() => updateConfig({ excited: !config.excited })}
      >
        Toggle
      </button>
    </div>
  );
}

export const helloWidget = defineWidget<HelloConfig>({
  type: 'hello',
  name: 'Hello',
  summary: 'A minimal example widget.',
  category: 'utilities',
  keywords: ['example', 'demo'],
  icon: SparklesIcon,
  accent: 'violet',
  defaultSize: { w: 3, h: 4, minW: 2, minH: 3 },
  defaultConfig: { greeting: 'Hello', excited: true },
  settings: SETTINGS,
  summarize: (config) => config.greeting,
  component: HelloWidget,
});
```

Then register it in `src/widgets/registry.ts`:

```ts
import { helloWidget } from './hello';

export const WIDGET_DEFINITIONS: readonly WidgetDefinition[] = [
  // …existing widgets
  helloWidget,
];
```

That is the entire integration: the gallery card, the settings form, validation,
persistence, templates (if you add it to one) and JSON round-tripping all pick it
up automatically.

## Keyboard shortcuts

| Shortcut | Action |
| --- | --- |
| `⌘/Ctrl + K` | Open the widget gallery |
| `⌘/Ctrl + Z` | Undo |
| `⌘/Ctrl + ⇧ + Z` / `⌘/Ctrl + Y` | Redo |
| `⌘/Ctrl + S` | Export the layout as JSON |
| `⌘/Ctrl + ⇧ + D` | Toggle light / dark |
| `?` | Shortcut cheat sheet |
| `Esc` | Close dialogs, drawers and menus |

Shortcuts never fire while you are typing in an input, so text editing keeps its
native behaviour (including `⌘/Ctrl + Z` inside a field).

## The layout JSON format

Exports are pretty-printed, self-describing and diff-friendly:

```jsonc
{
  "format": "lotus-dashboard/v1",
  "version": 1,
  "generator": { "name": "Lotus Dashboard Creator", "version": "1.0.0" },
  "exportedAt": "2026-02-01T09:30:00.000Z",
  "dashboard": { "title": "My dashboard", "description": "…" },
  "grid": {
    "breakpoints": { "xl": 1536, "lg": 1180, "md": 880, "sm": 620, "xs": 0 },
    "columns": { "xl": 12, "lg": 12, "md": 8, "sm": 6, "xs": 4 }
  },
  "widgets": [
    { "id": "clock_1a2b3c4d", "type": "clock", "title": "Clock", "config": { }, "createdAt": 1769938200000 }
  ],
  "layouts": {
    "lg": [{ "i": "clock_1a2b3c4d", "x": 0, "y": 0, "w": 3, "h": 6, "minW": 2, "minH": 4 }]
  }
}
```

On import the file is validated and normalised before it touches your workspace:

- a missing `format` marker is accepted with a warning (compatibility mode);
- a newer `version` is rejected with an explanation;
- coordinates are clamped to the grid, malformed entries are dropped;
- widgets whose plugin is missing are **kept** and shown as unavailable;
- widgets with no layout entry are placed automatically;
- duplicated ids are made unique instead of losing data.

## Testing & verification

```bash
npm test          # 62 unit tests
npm run verify    # typecheck + lint + unit tests + production build
```

The unit suite (Vitest, no DOM required) covers the parts where bugs are expensive:

| File | What it locks down |
| --- | --- |
| `lib/grid.test.ts` | Collisions, first-fit placement, scaling across breakpoints, packing/tidying, structural diffing, reconciliation. |
| `lib/validation.test.ts` | Round-tripping an export, broken/empty/foreign files, newer schema versions, clamping, unknown widget types, default merging, duplicate ids. |
| `lib/markdown.test.ts` | Headings, inline emphasis, task/ordered lists, code fences, quotes, and refusal of `javascript:`/`data:` links. |
| `lib/widgets.test.ts` | Link normalisation, favicon/initials fallbacks, deterministic mock market/weather/news data, the widget factory. |
| `lib/templates.test.ts` | Every template builds a self-consistent workspace on all five breakpoints with unique ids and registered widget types. |
| `store/dashboardStore.test.ts` | Add/remove/duplicate/undo/redo, history coalescing, tidy, template application, import/export round trip, registry invariants. |

**Browser verification.** The app was driven through a real Chrome (DevTools
protocol) in both dev and production builds: 39 assertions covering initial
render, gallery add, drag (including the snap placeholder and the persisted
result), resize, undo, theme switching, reload persistence, JSON export (a real
file download) and JSON import (a real file upload, preview and apply) — with
**zero console errors, warnings or uncaught exceptions**, and the grid verified to
be overlap-free at five viewport widths (1680 → 420 px).

## Performance notes

- Widget children of the grid are memoised by identity, so dragging or resizing
  one widget does not re-render the others — `react-grid-layout` v2 memoises grid
  items on geometry, and `WidgetFrame` is `memo`-ised on the widget instance.
- Live widgets tick locally (`useInterval` + `useNow`) instead of pushing
  high-frequency updates into the global store.
- Store writes are structural: a layout report that changes nothing is dropped by
  a cheap structural comparison before it can reach `localStorage`.
- Markdown is parsed in a `useMemo` and only re-parsed when the text changes.
- `cn()` uses `tailwind-merge`, so component classes can be overridden safely
  without specificity tricks.
- Production bundle: **~132 kB gzipped JS / ~12 kB gzipped CSS** (React 19 +
  zustand + react-grid-layout + the whole widget set, no icon or markdown
  dependency).

## Accessibility

- Dialogs and the drawer are portal-rendered with `role="dialog"`, `aria-modal`,
  a focus trap, focus restoration, `Esc` to close and body scroll locking.
- All icon-only controls have `aria-label`s; menus expose `role="menu"` with
  arrow-key navigation; toggles use `role="switch"`/`aria-pressed`.
- Widget headers are real headings, live regions announce toasts, and the resize
  handles remain reachable by keyboard after focusing a widget.
- `prefers-reduced-motion` disables all animations, and the canvas works at 200%
  zoom thanks to the responsive breakpoints.

## Notes & limitations

- Weather, market and news data is **simulated locally** and labelled as such in
  the UI. The generators are deterministic functions of `(seed, timestamp)`, which
  keeps them testable and avoids rate limits — swap `src/lib/mock/*` for real
  providers behind the same interfaces if you need live data.
- The notes widget stores its text in the workspace document (and therefore in
  `localStorage` and any export). It is a scratchpad, not an encrypted store.
- Drag & drop inside the grid is disabled while the layout is locked, but the
  template/import/reset flows still work — the lock only guards accidental moves.
- The exported JSON contains everything, so treat a shared file as you would a
  shared document.

## License

[MIT](LICENSE) © Lotus Dashboard Creator contributors
