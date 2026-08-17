import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import {
  shallowEqual,
  type GanttEngine,
  type GanttId,
  type GanttTask,
  type GanttTheme,
  type Point,
  type Rect,
  type ViewportState,
} from '@gantt-chart/core';
import { useEngineState } from './useEngineState';

export interface GanttTooltipContext<T, G> {
  task: GanttTask<T>;
  engine: GanttEngine<T, G>;
  locale?: string;
}

export interface GanttTooltipProps<T, G> {
  engine: GanttEngine<T, G>;
  theme: GanttTheme;
  locale?: string;
  /** Return `null` to suppress the tooltip for a task. */
  render?: (context: GanttTooltipContext<T, G>) => ReactNode | null;
  /** Gap between the box and what it is anchored to — the pointer, or the bar
   * for a hover that arrived without one. Px. */
  offset?: number;
  /**
   * Let the pointer into the tooltip, so its content can be hovered, selected
   * and clicked — links and buttons in a custom body only work with this on.
   * The tooltip then keeps itself open while the pointer is inside it, and for
   * {@link closeDelay} ms either side of the gap between the bar and the box.
   *
   * On by default. Pass `false` for a tooltip that is only a label: it goes
   * back to `pointer-events: none` and closes the instant the bar is left.
   */
  interactive?: boolean;
  /**
   * How long the pointer has to rest on a bar before its tooltip opens, ms.
   * Defaults to 1000; `0` opens on contact.
   *
   * The dwell is per bar and starts over on each one, so sweeping the pointer
   * across a row raises nothing. Moving to a second bar takes the first one's
   * tooltip down at once rather than leaving it up during the new wait.
   */
  openDelay?: number;
  /** Grace period before an unhovered tooltip closes, ms. */
  closeDelay?: number;
}

/** The hover the tooltip is currently showing, which outlives the hover itself. */
interface HeldHover {
  taskId: GanttId;
  rowIndex: number | null;
  /**
   * Where the pointer was when this tooltip opened, plot px, or null for a hover
   * that arrived without one (a gutter row, a key press).
   *
   * Snapshotted rather than followed: a box that chased the pointer around the
   * bar would be a moving target to read, and an interactive one would shove
   * itself out from under the cursor trying to reach it.
   */
  point: Point | null;
}

/**
 * Hover tooltip, opened beside the pointer that asked for it, positioned from
 * the engine's own geometry and confined to the plot.
 *
 * Nothing is rendered while nothing is hovered, so the common case costs one
 * subscription and no DOM.
 */
export function GanttTooltip<T, G>({
  engine,
  theme,
  locale,
  render,
  offset = 12,
  interactive = true,
  openDelay = 1000,
  closeDelay = 160,
}: GanttTooltipProps<T, G>): JSX.Element | null {
  const { hoveredTaskId, hoveredRowIndex, dragging } = useEngineState(
    engine,
    (state) => ({
      hoveredTaskId: state.hoveredTaskId,
      hoveredRowIndex: state.hoveredRowIndex,
      // A tooltip following a dragged bar is noise.
      dragging: state.drag !== null && state.drag.active,
      viewport: state.viewport,
    }),
    shallowEqual,
  );

  /**
   * What is on screen, which is not the same thing as what is hovered: an
   * interactive tooltip has to survive the pointer crossing the gap between the
   * bar and the box, and then stay up for as long as the pointer is inside it.
   */
  const [held, setHeld] = useState<HeldHover | null>(null);
  const inside = useRef(false);
  const closeTimer = useRef<number | null>(null);
  const openTimer = useRef<number | null>(null);
  // Read from the pointer handlers below, which outlive the render that made them.
  const heldRef = useRef<HeldHover | null>(null);
  heldRef.current = held;

  const cancelClose = useCallback(() => {
    if (closeTimer.current === null) return;
    clearTimeout(closeTimer.current);
    closeTimer.current = null;
  }, []);

  const cancelOpen = useCallback(() => {
    if (openTimer.current === null) return;
    clearTimeout(openTimer.current);
    openTimer.current = null;
  }, []);

  const closeSoon = useCallback(() => {
    if (closeTimer.current !== null) return;
    closeTimer.current = window.setTimeout(() => {
      closeTimer.current = null;
      inside.current = false;
      setHeld(null);
    }, closeDelay);
  }, [closeDelay]);

  useEffect(() => {
    if (dragging) {
      cancelOpen();
      cancelClose();
      inside.current = false;
      setHeld(null);
      return;
    }

    if (hoveredTaskId !== null) {
      cancelClose();

      // Already the one on screen, so there is nothing to wait for. This is also
      // the pointer stepping into an interactive tooltip, which re-asserts its
      // own bar's hover on the way in — that must not restart the dwell.
      if (heldRef.current !== null && heldRef.current.taskId === hoveredTaskId) {
        cancelOpen();
        if (heldRef.current.rowIndex !== hoveredRowIndex) {
          // Same box, so it keeps the point it opened at: the row it is filed
          // under changed, not where the reader asked for it.
          setHeld({ taskId: hoveredTaskId, rowIndex: hoveredRowIndex, point: heldRef.current.point });
        }
        return;
      }

      if (openDelay <= 0) {
        cancelOpen();
        setHeld({ taskId: hoveredTaskId, rowIndex: hoveredRowIndex, point: engine.hoverPoint });
        return;
      }

      // A different bar: whatever is up goes now rather than lingering over the
      // wrong task, and this one has to be dwelled on before it appears. The
      // effect only re-runs when the hover actually changes, so a pointer moving
      // *within* a bar lets the dwell run down instead of restarting it.
      if (heldRef.current !== null) setHeld(null);
      cancelOpen();
      openTimer.current = window.setTimeout(() => {
        openTimer.current = null;
        // Read at the end of the dwell, not the start: the pointer is allowed to
        // wander across the bar while it runs down, and the box belongs where it
        // came to rest.
        setHeld({ taskId: hoveredTaskId, rowIndex: hoveredRowIndex, point: engine.hoverPoint });
      }, openDelay);
      return;
    }

    // The hover is gone, so nothing is going to open.
    cancelOpen();
    // Without pointer events there is nowhere for it to have gone *to*, so the
    // tooltip goes with it.
    if (!interactive) {
      cancelClose();
      setHeld(null);
      return;
    }
    if (!inside.current) closeSoon();
  }, [
    engine,
    hoveredTaskId,
    hoveredRowIndex,
    dragging,
    interactive,
    openDelay,
    cancelOpen,
    cancelClose,
    closeSoon,
  ]);

  // Cancel pending timers on unmount, not on every dependency change.
  useEffect(() => cancelClose, [cancelClose]);
  useEffect(() => cancelOpen, [cancelOpen]);

  /**
   * Own size, measured rather than guessed — the content is the caller's, so
   * there is no other way to know what has to fit. Measuring in a layout effect
   * puts the corrected position on screen in the same frame as the first one.
   */
  const box = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const node = box.current;
    const width = node ? node.offsetWidth : 0;
    const height = node ? node.offsetHeight : 0;
    if (width !== size.width || height !== size.height) setSize({ width, height });
  });

  /**
   * The pointer's own handlers, attached to the node rather than declared as
   * props. `wheel` has to be a native non-passive listener — React registers its
   * own passively at the root, where `preventDefault` is ignored and the page
   * scrolls instead — and enter/leave keep it company because React synthesizes
   * those two from `pointerover`/`pointerout`, which is a layer of indirection
   * this does not need.
   *
   * Not `useNativeWheel`: that attaches once, and this box comes and goes.
   */
  useEffect(() => {
    const node = box.current;
    if (!node || !interactive) return;

    /*
     * Entering re-asserts the hover the pointer left behind on the way in, so
     * the bar stays emphasized and the row stays lit while the tooltip is being
     * read. Leaving hands both back: the engine forgets the hover, and the
     * countdown takes the tooltip with it unless another bar catches it first.
     */
    const enter = (): void => {
      inside.current = true;
      cancelClose();
      if (heldRef.current) engine.setHovered(heldRef.current.taskId, heldRef.current.rowIndex);
    };
    const leave = (): void => {
      inside.current = false;
      engine.setHovered(null, null);
      closeSoon();
    };

    /*
     * An enterable tooltip sits between the pointer and the plot, so the wheel
     * would stop scrolling and zooming the moment one opened under the cursor.
     * Hand the event on to whatever is behind the box — the plot, in practice —
     * so the chart behaves as though the tooltip were not in the way.
     */
    const forward = (event: WheelEvent): void => {
      if (typeof document.elementsFromPoint !== 'function') return;
      const behind = document
        .elementsFromPoint(event.clientX, event.clientY)
        .find((element) => !node.contains(element));
      if (!behind) return;
      event.preventDefault();
      behind.dispatchEvent(
        new WheelEvent('wheel', {
          deltaX: event.deltaX,
          deltaY: event.deltaY,
          deltaZ: event.deltaZ,
          deltaMode: event.deltaMode,
          clientX: event.clientX,
          clientY: event.clientY,
          ctrlKey: event.ctrlKey,
          metaKey: event.metaKey,
          shiftKey: event.shiftKey,
          altKey: event.altKey,
          bubbles: true,
          cancelable: true,
        }),
      );
    };

    node.addEventListener('pointerenter', enter);
    node.addEventListener('pointerleave', leave);
    node.addEventListener('wheel', forward, { passive: false });
    return () => {
      node.removeEventListener('pointerenter', enter);
      node.removeEventListener('pointerleave', leave);
      node.removeEventListener('wheel', forward);
    };
    // Re-attached whenever the box comes or goes; `held` is read through its ref.
  }, [engine, interactive, held !== null, cancelClose, closeSoon]);

  if (held === null || dragging) return null;

  const task = engine.getTask(held.taskId);
  if (!task) return null;
  const rect = engine.getTaskRect(held.taskId);
  if (!rect) return null;

  const content = render ? render({ task, engine, locale }) : defaultContent(task, locale);
  if (content === null || content === undefined) return null;

  const position = place(rect, size, engine.viewport.state, offset, held.point);

  return (
    <div
      ref={box}
      className={`gantt-tooltip${interactive ? '' : ' is-static'}`}
      role="tooltip"
      style={{
        left: position.x,
        top: position.y,
        background: theme.dark ? theme.colors.rowOdd : theme.colors.background,
        color: theme.colors.text,
        borderColor: theme.colors.border,
        font: `${theme.font.size}px ${theme.font.family}`,
      }}
    >
      {content}
    </div>
  );
}

/**
 * Where the box goes: beside the pointer when the hover came from one, and
 * beside the bar when it did not. Right of the anchor when it fits there, left
 * of it when that is where the room is, and against the nearer edge when neither
 * side has any. Both axes are then clamped to the plot, so a tooltip on the last
 * row or the far right stays inside the chart instead of hanging over the zoom
 * bars.
 *
 * The pointer is the better anchor because a bar is as wide as its task is long:
 * on a multi-month one — or any bar running off the edge of the window — the
 * edges are nowhere near the cursor that asked for the tooltip, and can be off
 * screen entirely. Vertically the bar still wins: the pointer is inside it, so
 * its top is already at the cursor, and aligning to it keeps a column of
 * tooltips level as the pointer sweeps a row.
 *
 * `size` is zero for the first render of a given tooltip, before the layout
 * effect has measured it: that pass lands on the preferred side unclamped, and
 * the measured one replaces it before the browser paints.
 */
function place(
  rect: Rect,
  size: { width: number; height: number },
  viewport: ViewportState,
  offset: number,
  pointer: Point | null,
): { x: number; y: number } {
  const anchorStart = pointer ? pointer.x : rect.x;
  const anchorEnd = pointer ? pointer.x : rect.x + rect.width;
  const right = anchorEnd + offset;
  const left = anchorStart - offset - size.width;
  const preferred = right + size.width <= viewport.width ? right : left >= 0 ? left : right;

  return {
    x: clamp(preferred, 0, Math.max(0, viewport.width - size.width)),
    y: clamp(rect.y - 4, 0, Math.max(0, viewport.height - size.height)),
  };
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

function defaultContent(task: GanttTask<unknown>, locale?: string): ReactNode {
  const meta = (task.data ?? {}) as { label?: string; name?: string; progress?: number };
  const label = meta.label ?? meta.name ?? String(task.id);
  const milestone = task.start === task.end;

  return (
    <>
      <div className="gantt-tooltip__title">{label}</div>
      <div className="gantt-tooltip__row">
        {milestone
          ? formatInstant(task.start, locale)
          : `${formatInstant(task.start, locale)} → ${formatInstant(task.end, locale)}`}
      </div>
      {!milestone ? <div className="gantt-tooltip__row">{formatDuration(task.end - task.start)}</div> : null}
      {typeof meta.progress === 'number' ? (
        <div className="gantt-tooltip__row">{Math.round(meta.progress * 100)}% complete</div>
      ) : null}
    </>
  );
}

function formatInstant(time: number, locale?: string): string {
  const date = new Date(time);
  const options: Intl.DateTimeFormatOptions =
    date.getHours() === 0 && date.getMinutes() === 0
      ? { dateStyle: 'medium' }
      : { dateStyle: 'medium', timeStyle: 'short' };
  return new Intl.DateTimeFormat(locale, options).format(date);
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function formatDuration(ms: number): string {
  if (ms >= DAY) {
    const days = ms / DAY;
    return `${trim(days)} day${days === 1 ? '' : 's'}`;
  }
  if (ms >= HOUR) {
    const hours = ms / HOUR;
    return `${trim(hours)} hour${hours === 1 ? '' : 's'}`;
  }
  const minutes = Math.max(1, Math.round(ms / MINUTE));
  return `${minutes} min`;
}

function trim(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}
