import {
  forwardRef,
  memo,
  useCallback,
  type CSSProperties,
  type HTMLAttributes,
  type ReactNode,
} from 'react';
import { AlertIcon, GearIcon, MoreIcon, PlugIcon, RefreshIcon, TrashIcon, CopyIcon } from '@/components/icons';
import { Badge, Button, Dropdown, EmptyState, IconButton, IconChip } from '@/components/ui';
import { ErrorBoundary } from '@/components/feedback/ErrorBoundary';
import { useDashboardStore } from '@/store/dashboardStore';
import { useToastStore } from '@/store/toastStore';
import { useUiStore } from '@/store/uiStore';
import type { StoredWidgetInstance } from '@/types';
import { cn } from '@/lib/utils';
import { getWidgetDefinition } from '@/widgets/registry';

/**
 * When the lock notice was last shown.
 *
 * "Nothing happens when I drag" is the worst kind of dead end, but a card that
 * shouts on every pointer-down is worse. Once every few seconds is enough to
 * explain it.
 */
const LOCKED_NOTICE_INTERVAL_MS = 8000;
let lockedNoticeAt = 0;

export interface WidgetFrameProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  instance: StoredWidgetInstance;
  /**
   * Injected by `react-resizable`: the resize handles are appended to the child
   * element's children, so they must be rendered inside the grid item.
   */
  children?: ReactNode;
  /** Injected by react-grid-layout (`cloneElement`) — see the note below. */
  className?: string;
  style?: CSSProperties;
}

/**
 * The chrome around every widget: drag handle, title, actions, error boundary and
 * the scrolling body.
 *
 * `react-grid-layout` and `react-resizable` clone this element and inject `ref`,
 * `className`, `style`, the **drag handlers** (`onMouseDown`, `onTouchStart`, …)
 * that `react-draggable` needs, and the resize handles as `children`. All of them
 * must reach the root node — without that, dragging and resizing silently do
 * nothing.
 *
 * Memoised on `instance`: while dragging, only the grid geometry changes, so the
 * widget bodies never re-render.
 */
export const WidgetFrame = memo(
  forwardRef<HTMLDivElement, WidgetFrameProps>(function WidgetFrame(
    { instance, className, style, children, ...gridProps },
    ref,
  ) {
    const definition = getWidgetDefinition(instance.type);
    const locked = useDashboardStore((state) => state.locked);
    const renameWidget = useDashboardStore((state) => state.renameWidget);
    const updateWidgetConfig = useDashboardStore((state) => state.updateWidgetConfig);
    const replaceWidgetConfig = useDashboardStore((state) => state.replaceWidgetConfig);
    const resetWidgetConfig = useDashboardStore((state) => state.resetWidgetConfig);
    const duplicateWidget = useDashboardStore((state) => state.duplicateWidget);
    const openSettings = useUiStore((state) => state.openSettings);
    const requestDelete = useUiStore((state) => state.requestDelete);
    const notifySuccess = useToastStore((state) => state.success);
    const notify = useToastStore((state) => state.notify);

    const updateConfig = useCallback(
      (patch: Record<string, unknown>) => updateWidgetConfig(instance.id, patch),
      [instance.id, updateWidgetConfig],
    );
    const replaceConfig = useCallback(
      (next: Record<string, unknown>) => replaceWidgetConfig(instance.id, next),
      [instance.id, replaceWidgetConfig],
    );
    const setTitle = useCallback(
      (title: string) => renameWidget(instance.id, title),
      [instance.id, renameWidget],
    );

    if (!definition) {
      return (
        <div
          ref={ref}
          style={style}
          {...gridProps}
          className={cn(
            'flex h-full w-full flex-col overflow-hidden rounded-xl border border-dashed border-amber-300 bg-amber-50/60 dark:border-amber-500/40 dark:bg-amber-500/5',
            className,
          )}
        >
          <EmptyState
            size="sm"
            icon={<PlugIcon className="h-4 w-4" />}
            title="Widget unavailable"
            description={`No plugin is registered for “${instance.type}”. The layout entry was kept, so installing the widget brings it back.`}
            action={
              <Button
                size="sm"
                variant="danger"
                icon={<TrashIcon className="h-3.5 w-3.5" />}
                onClick={() => requestDelete(instance.id)}
              >
                Remove
              </Button>
            }
          />
        </div>
      );
    }

    const Component = definition.component;
    const subtitle = definition.summarize?.(instance.config);

    return (
      <div
        ref={ref}
        style={style}
        {...gridProps}
        // Lets the browser checks identify a card without scraping its title.
        data-widget-type={instance.type}
        className={cn(
          'group/widget flex h-full w-full flex-col overflow-hidden rounded-xl border border-slate-200/80 bg-white/95 shadow-sm backdrop-blur-sm transition-shadow',
          'hover:shadow-md dark:border-slate-700/70 dark:bg-slate-900/90 dark:shadow-none dark:hover:border-slate-600',
          className,
        )}
      >
        <header
          className={cn(
            'widget-drag-handle flex shrink-0 items-center gap-2.5 border-b border-slate-100 px-3 py-2 dark:border-slate-800',
            locked ? 'cursor-default' : 'cursor-grab active:cursor-grabbing',
          )}
          title={locked ? 'The layout is locked — unlock it in the status bar' : undefined}
          onPointerDown={
            locked
              ? () => {
                  const now = Date.now();
                  if (now - lockedNoticeAt < LOCKED_NOTICE_INTERVAL_MS) return;
                  lockedNoticeAt = now;
                  notify({
                    tone: 'info',
                    title: 'The layout is locked',
                    description: 'Unlock it in the status bar to move or resize widgets again.',
                  });
                }
              : undefined
          }
        >
          <IconChip tone={definition.accent} className="h-7 w-7">
            <definition.icon className="h-4 w-4" />
          </IconChip>

          <div className="min-w-0 flex-1">
            <h3 className="truncate text-[13px] font-semibold leading-tight text-slate-800 dark:text-slate-100">
              {instance.title}
            </h3>
            {subtitle ? (
              <p className="truncate text-[10px] leading-tight text-slate-400 dark:text-slate-500">{subtitle}</p>
            ) : null}
          </div>

          {definition.badge ? (
            <Badge tone={definition.accent} className="hidden shrink-0 sm:inline-flex">
              {definition.badge}
            </Badge>
          ) : null}

          {/* The settings gear is always on screen: the options behind it (which
              city a weather card is showing, for instance) are the first thing a
              new user looks for, and hover-only made it look absent. The ⋮ menu
              stays out of the way until the card is hovered or focused. */}
          <div className="widget-no-drag flex shrink-0 items-center gap-0.5">
            <IconButton
              label={`Settings for ${instance.title}`}
              size="icon-sm"
              icon={<GearIcon className="h-3.5 w-3.5" />}
              onClick={() => openSettings(instance.id)}
            />
            <div className="transition-opacity sm:opacity-0 sm:group-hover/widget:opacity-100 sm:focus-within:opacity-100">
              <Dropdown
                label={`Actions for ${instance.title}`}
                trigger={<MoreIcon className="h-2 w-2" />}
                triggerClassName="h-7 w-7 px-0 justify-center"
                items={[
                  {
                    id: 'duplicate',
                    label: 'Duplicate widget',
                    icon: <CopyIcon className="h-4 w-4" />,
                    onSelect: () => {
                      const id = duplicateWidget(instance.id);
                      if (id) notifySuccess('Widget duplicated');
                    },
                  },
                  {
                    id: 'reset',
                    label: 'Reset this widget',
                    icon: <RefreshIcon className="h-4 w-4" />,
                    onSelect: () => {
                      resetWidgetConfig(instance.id);
                      notifySuccess('Widget reset', { description: `${instance.title} is back to its default settings.` });
                    },
                  },
                  { id: 'sep', separator: true },
                  {
                    id: 'remove',
                    label: 'Remove widget',
                    icon: <TrashIcon className="h-4 w-4" />,
                    danger: true,
                    onSelect: () => requestDelete(instance.id),
                  },
                ]}
              />
            </div>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-auto p-3">
          <ErrorBoundary
            fallback={(error, reset) => (
              <EmptyState
                size="sm"
                icon={<AlertIcon className="h-4 w-4 text-rose-500" />}
                title="This widget hit an error"
                description={error.message}
                action={
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="secondary"
                      icon={<RefreshIcon className="h-3.5 w-3.5" />}
                      onClick={() => {
                        resetWidgetConfig(instance.id);
                        reset();
                      }}
                    >
                      Reset widget
                    </Button>
                    <Button size="sm" variant="ghost" onClick={reset}>
                      Retry
                    </Button>
                  </div>
                }
              />
            )}
          >
            <Component
              instance={instance}
              config={instance.config}
              updateConfig={updateConfig}
              replaceConfig={replaceConfig}
              setTitle={setTitle}
            />
          </ErrorBoundary>
        </div>

        {/* Resize handles injected by react-resizable (absolutely positioned). */}
        {children}
      </div>
    );
  }),
);
