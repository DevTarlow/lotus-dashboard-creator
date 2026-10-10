import { useCallback, useMemo } from 'react';
import {
  Responsive,
  useContainerWidth,
  verticalCompactor,
  type Layout,
  type LayoutItem,
  type ResponsiveGridLayoutProps,
} from 'react-grid-layout';
import { GridIcon, PlusIcon } from '@/components/icons';
import { Button, EmptyState } from '@/components/ui';
import {
  BREAKPOINTS,
  CONTAINER_PADDING,
  DRAG_CANCEL_SELECTOR,
  DRAG_HANDLE_SELECTOR,
  DROP_PLACEHOLDER_ID,
  GRID_COLUMNS,
  GRID_MARGIN,
  RESIZE_HANDLES,
  ROW_HEIGHT,
} from '@/constants/grid';
import { BREAKPOINT_ORDER } from '@/constants/grid';
import { WIDGET_DRAG_MIME } from '@/constants/app';
import { useDashboardStore } from '@/store/dashboardStore';
import { usePrefsStore } from '@/store/prefsStore';
import { useToastStore } from '@/store/toastStore';
import { useUiStore } from '@/store/uiStore';
import type { BreakpointId, LayoutsByBreakpoint } from '@/types';
import { cn } from '@/lib/utils';
import { getWidgetDefinition } from '@/widgets/registry';
import { WidgetFrame } from './WidgetFrame';

/** Drop configuration type, derived from the grid's own props. */
type GridDropConfig = NonNullable<ResponsiveGridLayoutProps['dropConfig']>;

/** Reduce the grids' layout map to the breakpoints we know about. */
function toLayoutsByBreakpoint(layouts: Partial<Record<string, Layout>>): LayoutsByBreakpoint {
  const next: LayoutsByBreakpoint = {};
  for (const breakpoint of BREAKPOINT_ORDER) {
    const layout = layouts[breakpoint];
    if (layout) next[breakpoint] = layout;
  }
  return next;
}

function CanvasSkeleton() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-hidden="true">
      {[0, 1, 2, 3].map((index) => (
        <div
          key={index}
          className="h-56 animate-pulse rounded-xl border border-slate-200 bg-white/60 dark:border-slate-800 dark:bg-slate-900/40"
        />
      ))}
    </div>
  );
}

/**
 * The canvas: a responsive, draggable and resizable grid.
 *
 * The store owns the layout, the grid reports changes back through
 * `onLayoutChange`, and the widget children are memoised so dragging never
 * re-renders a widget body.
 */
export function DashboardCanvas() {
  const { width, containerRef, mounted } = useContainerWidth({ initialWidth: 1280 });

  const widgets = useDashboardStore((state) => state.widgets);
  const layouts = useDashboardStore((state) => state.layouts);
  const locked = useDashboardStore((state) => state.locked);
  const applyLayouts = useDashboardStore((state) => state.applyLayouts);
  const setActiveBreakpoint = useDashboardStore((state) => state.setActiveBreakpoint);
  const addWidget = useDashboardStore((state) => state.addWidget);
  const openAddWidget = useUiStore((state) => state.openAddWidget);
  const draggingType = useUiStore((state) => state.draggingType);
  const setDraggingType = useUiStore((state) => state.setDraggingType);
  const showGridHints = usePrefsStore((state) => state.showGridHints);
  const notify = useToastStore((state) => state.success);

  // Memoised children: the array identity only changes when the widgets do, which
  // lets react-grid-layout skip re-rendering every item while dragging.
  const children = useMemo(() => widgets.map((widget) => <WidgetFrame key={widget.id} instance={widget} />), [widgets]);

  const handleLayoutChange = useCallback(
    (_layout: Layout, allLayouts: Partial<Record<string, Layout>>) => {
      applyLayouts(toLayoutsByBreakpoint(allLayouts));
    },
    [applyLayouts],
  );

  const handleBreakpointChange = useCallback(
    (breakpoint: string) => {
      setActiveBreakpoint(breakpoint as BreakpointId);
    },
    [setActiveBreakpoint],
  );

  const dropConfig = useMemo<GridDropConfig>(
    () => ({
      enabled: true,
      defaultItem: { w: 4, h: 6 },
      touchEnabled: true,
      touchDragSource: '[data-widget-drag-source]',
      onDragOver: (event) => {
        // Reject anything that is not a widget from the gallery (e.g. a JSON file).
        const types = Array.from(event.dataTransfer?.types ?? []);
        if (!types.includes(WIDGET_DRAG_MIME)) return false;
        const definition = draggingType ? getWidgetDefinition(draggingType) : undefined;
        return definition ? { w: definition.defaultSize.w, h: definition.defaultSize.h } : { w: 4, h: 6 };
      },
    }),
    [draggingType],
  );

  const handleDrop = useCallback(
    (_layout: Layout, item: LayoutItem | undefined, event: Event) => {
      const dataTransfer = (event as DragEvent).dataTransfer;
      const type = dataTransfer?.getData(WIDGET_DRAG_MIME) || draggingType;
      setDraggingType(null);
      if (!type) return;
      const definition = getWidgetDefinition(type);
      const id = addWidget(type, {
        breakpoint: useDashboardStore.getState().activeBreakpoint,
        x: item?.x,
        y: item?.y,
        size: item ? { w: item.w, h: item.h } : definition?.defaultSize,
      });
      if (id) notify(`${definition?.name ?? 'Widget'} added`, { description: 'Drag the header to move it around.' });
    },
    [addWidget, draggingType, notify, setDraggingType],
  );

  const isEmpty = widgets.length === 0;

  return (
    <div
      ref={containerRef}
      className={cn(
        'relative min-h-[60vh] rounded-2xl transition',
        showGridHints &&
          'bg-[radial-gradient(circle_at_1px_1px,rgb(148_163_184/0.28)_1px,transparent_0)] [background-size:22px_22px] dark:bg-[radial-gradient(circle_at_1px_1px,rgb(71_85_105/0.35)_1px,transparent_0)]',
        draggingType && 'ring-2 ring-violet-400/60 ring-offset-4 ring-offset-slate-50 dark:ring-offset-slate-950',
      )}
    >
      {isEmpty ? (
        <div className="flex min-h-[60vh] items-center justify-center rounded-2xl border border-dashed border-slate-300 bg-white/50 dark:border-slate-700 dark:bg-slate-900/30">
          <EmptyState
            icon={<GridIcon className="h-5 w-5" />}
            title="Your canvas is empty"
            description="Add widgets from the gallery, or drag one straight onto the grid. Everything is saved in your browser automatically."
            action={
              <Button variant="primary" icon={<PlusIcon className="h-4 w-4" />} onClick={openAddWidget}>
                Add your first widget
              </Button>
            }
          />
        </div>
      ) : !mounted ? (
        <CanvasSkeleton />
      ) : (
        <Responsive
          width={width}
          layouts={layouts}
          breakpoints={BREAKPOINTS}
          cols={GRID_COLUMNS}
          rowHeight={ROW_HEIGHT}
          margin={GRID_MARGIN}
          containerPadding={CONTAINER_PADDING}
          compactor={verticalCompactor}
          dragConfig={{
            enabled: !locked,
            handle: DRAG_HANDLE_SELECTOR,
            cancel: DRAG_CANCEL_SELECTOR,
            threshold: 3,
            allowMobileScroll: true,
          }}
          resizeConfig={{ enabled: !locked, handles: [...RESIZE_HANDLES] }}
          dropConfig={dropConfig}
          droppingItem={{ i: DROP_PLACEHOLDER_ID, x: 0, y: 0, w: 4, h: 6 }}
          onLayoutChange={handleLayoutChange}
          onBreakpointChange={handleBreakpointChange}
          onDrop={handleDrop}
        >
          {children}
        </Responsive>
      )}

      {draggingType ? (
        <div
          className="pointer-events-none absolute inset-x-0 -top-3 flex justify-center"
          aria-hidden="true"
        >
          <span className="rounded-full bg-violet-600 px-3 py-1 text-[11px] font-semibold text-white shadow-lg">
            Drop to add {getWidgetDefinition(draggingType)?.name ?? 'widget'}
          </span>
        </div>
      ) : null}
    </div>
  );
}
