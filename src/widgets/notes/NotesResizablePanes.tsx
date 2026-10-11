import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from 'react';
import { EDITOR_RATIO_STEP } from '@/lib/notes';
import { cn } from '@/lib/utils';

export interface NotesResizablePanesProps {
  /**
   * Width share of the first pane, in percent. The committed value lives in the
   * widget config; this component reports a new one on release and on every
   * arrow key.
   */
  ratio: number;
  onRatioChange: (ratio: number) => void;
  /** Lower/upper travel limits, in percent. */
  min: number;
  max: number;
  /** Accessible name for the divider. */
  label: string;
  /** Rendered in the left (or top, when stacked) pane. */
  aside: ReactNode;
  /** Rendered in the right (or bottom) pane. */
  children: ReactNode;
  /**
   * Whether a second pane exists at all.
   *
   * `false` elsewhere: the one pane then takes the whole area, instead of leaving
   * a divider and an empty track beside it.
   */
  split?: boolean;
  /**
   * Layout classes for the container. Whatever is passed has to stack the panes
   * *below* the `stackedAt` width and lay them out in a row above it, because
   * that breakpoint is mirrored in {@link NotesResizablePanes}.
   */
  className?: string;
  /**
   * `true` when the panes are stacked vertically instead of side by side.
   *
   * Derived from the same width this component uses for its `sm:` row layout, so
   * the sizing rule and the CSS can never disagree about which axis is in play.
   */
  stacked?: boolean;
}

/**
 * Two panes with a draggable divider between them.
 *
 * The ratio is a percentage of the container, so it survives resizing the widget
 * (and re-opening the file) instead of drifting with pixel widths.
 *
 * The divider doubles as its own layout switch: when the panes stack, the drag
 * axis has to follow, and the *geometry* decides it — a wide container splits
 * into columns, a tall one into rows. Reading it off the container means no
 * second breakpoint constant can fall out of sync with the CSS, and the axis is
 * re-checked on every move in case the window resizes mid-gesture.
 *
 * The caller reports whether the panes are currently stacked ({@link
 * NotesResizablePanesProps.stacked}) because the two layouts size the first pane
 * along different axes: `flex-basis` is its width in a row and its height in a
 * column, and a stacked pane wants the full width instead.
 *
 * With one pane there is nothing to size against, so the caller sets {@link
 * NotesResizablePanesProps.split} to `false` and leaves the aside empty: the
 * survivor takes the whole area, with no divider and no empty track.
 *
 * Listeners live on `window`, not the divider: once the two panes resize under
 * the pointer, the divider element moves out from under it, and a gesture bound
 * to the element would stop following the cursor.
 */
export function NotesResizablePanes({
  ratio,
  onRatioChange,
  min,
  max,
  label,
  aside,
  children,
  split = true,
  className,
  stacked = false,
}: NotesResizablePanesProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [dragging, setDragging] = useState(false);
  /** Ratio shown while dragging, before it is committed on release. */
  const [draftRatio, setDraftRatio] = useState<number | null>(null);
  /**
   * The ratio the gesture started from, so a no-op drag (or a click) writes
   * nothing to the workspace.
   */
  const startRef = useRef<{ x: number; y: number; ratio: number } | null>(null);
  /**
   * Latest ratio the pointer produced. The release has to read the value from a
   * ref, not from the state closure the `pointerup` listener was created with:
   * that closure is only as fresh as the last render, and it can therefore miss
   * the final move of a fast drag.
   */
  const latestRef = useRef<number | null>(null);

  const displayed = draftRatio ?? ratio;
  const clamp = useCallback(
    (value: number) => Math.min(max, Math.max(min, Math.round(value))),
    [min, max],
  );

  const endDrag = useCallback(() => {
    const start = startRef.current;
    const latest = latestRef.current;
    startRef.current = null;
    latestRef.current = null;
    setDragging(false);
    setDraftRatio(null);
    if (start && latest !== null && latest !== start.ratio) onRatioChange(latest);
  }, [onRatioChange]);

  useEffect(() => {
    if (!dragging) return undefined;

    const onMove = (event: globalThis.PointerEvent) => {
      const start = startRef.current;
      const container = containerRef.current;
      if (!start || !container) return;
      const rect = container.getBoundingClientRect();
      // Which axis the panes are laid out on, straight from the CSS: a container
      // can be tall *and* in columns, so measuring the box would get it wrong.
      const columns = globalThis.getComputedStyle(container).flexDirection.startsWith('row');
      let ratio: number;
      if (columns) {
        if (rect.width <= 0) return;
        ratio = clamp(start.ratio + ((event.clientX - start.x) / rect.width) * 100);
      } else {
        if (rect.height <= 0) return;
        ratio = clamp(start.ratio + ((event.clientY - start.y) / rect.height) * 100);
      }
      latestRef.current = ratio;
      setDraftRatio(ratio);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', endDrag);
    window.addEventListener('pointercancel', endDrag);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', endDrag);
      window.removeEventListener('pointercancel', endDrag);
    };
  }, [dragging, endDrag, clamp]);

  const beginDrag = (event: PointerEvent<HTMLDivElement>) => {
    // Keep the widget from starting its own drag, and the gesture from selecting
    // text or scrolling the widget body.
    event.preventDefault();
    event.stopPropagation();
    latestRef.current = null;
    startRef.current = { x: event.clientX, y: event.clientY, ratio: displayed };
    setDraftRatio(displayed);
    setDragging(true);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const keys: Record<string, number> = {
      ArrowLeft: -EDITOR_RATIO_STEP,
      ArrowRight: EDITOR_RATIO_STEP,
      ArrowUp: -EDITOR_RATIO_STEP,
      ArrowDown: EDITOR_RATIO_STEP,
    };
    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      onRatioChange(event.key === 'Home' ? min : max);
      return;
    }
    const delta = keys[event.key];
    if (!delta) return;
    event.preventDefault();
    onRatioChange(clamp(displayed + delta));
  };

  return (
    <div
      ref={containerRef}
      // No `gap`: the divider is the gutter, and it is sized flush against both
      // panes so its handle sits on the boundary instead of floating in the
      // middle of an empty strip.
      className={cn(
        'relative flex min-h-0 min-w-0 flex-1',
        stacked ? 'flex-col' : 'flex-col sm:flex-row',
        className,
      )}
    >
      {split ? (
        <div
          className={cn('min-h-0 min-w-0', stacked ? 'w-full' : 'flex-none shrink-0')}
          // `flex-basis` is the *main axis*: the width in a row, the height in a
          // column. Stacked panes take the full width and share the height instead.
          style={stacked ? undefined : { flexBasis: `${displayed}%` }}
        >
          {aside}
        </div>
      ) : null}

      {split ? (
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label={label}
          aria-valuenow={displayed}
          aria-valuemin={min}
          aria-valuemax={max}
          tabIndex={0}
          onPointerDown={beginDrag}
          onKeyDown={onKeyDown}
          title="Drag — or focus and use the arrow keys — to resize"
          className={cn(
            'widget-no-drag group/resize relative z-10 flex shrink-0 touch-none select-none items-center justify-center',
            stacked ? 'h-2 w-full cursor-row-resize' : 'h-2 w-full cursor-row-resize sm:h-auto sm:w-2 sm:cursor-col-resize',
            // The gutter is only 8px, so the grab target reaches a little way over
            // both panes. It is invisible, and the panes have nothing interactive
            // on their outer edges.
            'after:absolute after:-inset-x-1.5 after:inset-y-0 after:content-[""]',
            'sm:after:-inset-x-0 sm:after:-inset-y-1.5',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500/60',
          )}
        >
          {/* The grab target is the whole 8px gutter; this is just its affordance. */}
          <span
            aria-hidden="true"
            className={cn(
              'pointer-events-none rounded-full bg-slate-200 transition-colors dark:bg-slate-700',
              stacked ? 'h-px w-10' : 'h-px w-10 sm:h-10 sm:w-px',
              'group-hover/resize:bg-violet-400 dark:group-hover/resize:bg-violet-500',
              'group-focus-visible/resize:bg-violet-500 dark:group-focus-visible/resize:bg-violet-400',
              dragging && 'bg-violet-500 dark:bg-violet-400',
            )}
          />
        </div>
      ) : null}

      <div className="min-h-0 min-w-0 flex-1">{children}</div>
    </div>
  );
}
