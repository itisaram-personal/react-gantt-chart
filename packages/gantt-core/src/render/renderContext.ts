import type { GanttGroup, GanttRow, GanttTask, Rect, VisibleItem, VisibleWindow, ViewportState } from '../types';
import { categorical, type GanttTheme } from '../theme';

/** Pixel geometry of one bar, already resolved by the engine. */
export interface GanttItemGeometry {
  /** Left edge in plot pixels. Negative when the bar starts off-screen left. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** `x`/`width` clipped to the plot area — the right box to place a label in. */
  clipped: Rect;
  clippedLeft: boolean;
  clippedRight: boolean;
  /** Row box in plot pixels. */
  rowY: number;
  rowHeight: number;
  laneHeight: number;
  /** True when start and end coincide (a milestone). */
  isMilestone: boolean;
}

export interface GanttItemState {
  selected: boolean;
  hovered: boolean;
  dragging: boolean;
  /** True for the bar the current gesture started on. */
  primary: boolean;
}

export interface GanttRenderHelpers {
  timeToPx(time: number): number;
  pxToTime(px: number): number;
  /** Content pixels → plot pixels. */
  contentToPx(y: number): number;
  /** Clip a rect to the plot area. Returns a zero-width rect when fully outside. */
  clip(rect: Rect): Rect;
  /** Stable colour for a key, drawn from the theme palette. */
  color(key: string | number): string;
}

/**
 * Everything a custom item renderer is given.
 *
 * The engine has already decided *where* the bar goes; the callback decides
 * *what* it looks like. Contexts are plain data — treat the callback as a pure
 * function of this object.
 */
export interface GanttRenderContext<T = unknown, G = unknown> {
  task: GanttTask<T>;
  /** Index into the original `tasks` array. */
  index: number;
  /** Effective time span, including any in-flight drag offset. */
  start: number;
  end: number;
  geometry: GanttItemGeometry;
  row: GanttRow<G>;
  group: GanttGroup<G>;
  lane: number;
  state: GanttItemState;
  viewport: ViewportState;
  theme: GanttTheme;
  helpers: GanttRenderHelpers;
}

export interface RenderContextInput<G = unknown> {
  window: VisibleWindow<unknown, G>;
  viewport: ViewportState;
  theme: GanttTheme;
  minItemWidth: number;
  laneHeight: number;
  /** Task id the active gesture started on, if any. */
  primaryTaskId?: GanttTask['id'] | null;
}

/**
 * Builds render contexts for a frame.
 *
 * Per-frame values (scale, clip bounds, helper closures) are computed once and
 * shared across every item, so producing a context is a small object literal
 * rather than a fresh set of closures per bar.
 */
export class RenderContextBuilder<T = unknown, G = unknown> {
  private readonly viewport: ViewportState;
  private readonly theme: GanttTheme;
  private readonly minItemWidth: number;
  private readonly laneHeight: number;
  private readonly primaryTaskId: GanttTask['id'] | null;
  private readonly scale: number;
  readonly helpers: GanttRenderHelpers;

  constructor(input: RenderContextInput<G>) {
    const { viewport, theme } = input;
    this.viewport = viewport;
    this.theme = theme;
    this.minItemWidth = input.minItemWidth;
    this.laneHeight = input.laneHeight;
    this.primaryTaskId = input.primaryTaskId ?? null;

    const span = viewport.timeEnd - viewport.timeStart;
    this.scale = span > 0 ? viewport.width / span : 0;

    const timeToPx = (time: number): number => (time - viewport.timeStart) * this.scale;
    const pxToTime = (px: number): number => (this.scale > 0 ? viewport.timeStart + px / this.scale : viewport.timeStart);
    const contentToPx = (y: number): number => y - viewport.scrollTop;

    this.helpers = {
      timeToPx,
      pxToTime,
      contentToPx,
      clip: (rect) => {
        const left = Math.max(0, rect.x);
        const right = Math.min(viewport.width, rect.x + rect.width);
        const top = Math.max(0, rect.y);
        const bottom = Math.min(viewport.height, rect.y + rect.height);
        return {
          x: left,
          y: top,
          width: Math.max(0, right - left),
          height: Math.max(0, bottom - top),
        };
      },
      color: (key) => categorical(theme, key),
    };
  }

  build(item: VisibleItem<T>, row: GanttRow<G>, group: GanttGroup<G>): GanttRenderContext<T, G> {
    const x = (item.start - this.viewport.timeStart) * this.scale;
    const rawWidth = (item.end - item.start) * this.scale;
    const width = Math.max(this.minItemWidth, rawWidth);
    const y = item.y - this.viewport.scrollTop;

    const geometry: GanttItemGeometry = {
      x,
      y,
      width,
      height: item.height,
      clipped: this.helpers.clip({ x, y, width, height: item.height }),
      clippedLeft: x < 0,
      clippedRight: x + width > this.viewport.width,
      rowY: row.y - this.viewport.scrollTop,
      rowHeight: row.height,
      // The bar's own lane, which is what a uniform row compresses per cluster.
      laneHeight: item.laneHeight > 0 ? item.laneHeight : this.laneHeight,
      isMilestone: item.end === item.start,
    };

    return {
      task: item.task,
      index: item.taskIndex,
      start: item.start,
      end: item.end,
      geometry,
      row,
      group,
      lane: item.lane,
      state: {
        selected: item.selected,
        hovered: item.hovered,
        dragging: item.dragging,
        primary: this.primaryTaskId !== null && item.task.id === this.primaryTaskId,
      },
      viewport: this.viewport,
      theme: this.theme,
      helpers: this.helpers,
    };
  }
}
