import type {
  GanttEngine,
  GanttId,
  GanttTheme,
  Point,
  PointerModifiers,
  Rect,
  Unsubscribe,
} from '@gantt-chart/core';
import type { GanttItemRenderer } from './itemRenderer';
import { buildGanttOption, type GanttOption } from './option';
import { computeTimeTicks, type TimeTickScale } from './timeScale';

/**
 * The slice of an ECharts instance the adapter uses.
 *
 * `echarts` is a peer dependency and its types are not imported: this keeps the
 * package importable (and unit-testable) without the library present, and means
 * any instance satisfying this shape — including an SSR instance — can be driven.
 */
export interface EChartsLike {
  setOption(option: unknown, opts?: unknown): void;
  getDom?(): HTMLElement | null | undefined;
  getWidth(): number;
  getHeight(): number;
  resize(opts?: unknown): void;
  isDisposed?(): boolean;
  dispose?(): void;
}

export interface GanttAdapterOptions<T = unknown, G = unknown> {
  theme: GanttTheme;
  itemRenderer?: GanttItemRenderer<T, G>;
  locale?: string;
  weekStartsOn?: 0 | 1;
  tickTargetPx?: number;
  /** Source for the "now" marker. Return `null` to hide it. */
  now?: () => number | null;
  showRowBands?: boolean;
  showGrid?: boolean;
  progressiveThreshold?: number;
  /** Datasets smaller than this skip progressive chunking. Defaults to 50 000. */
  progressiveMinTasks?: number;
  /** Attach pointer handlers (selection, drag, marquee, hover, menus). */
  pointer?: boolean;
  wheel?: boolean;
  /** Attach key handlers. The element must be focusable for these to fire. */
  keyboard?: boolean;
  /** Last chance to adjust the option before it reaches the chart. */
  transformOption?: (option: GanttOption) => GanttOption;
}

/** Below this, a marquee is treated as a click on the background. */
const MARQUEE_MIN_AREA = 12;

type Gesture =
  | { kind: 'none' }
  | {
      kind: 'task';
      pointerId: number;
      taskId: GanttId;
      wasSelected: boolean;
      modifiers: PointerModifiers;
    }
  | { kind: 'marquee'; pointerId: number; origin: Point; mode: 'replace' | 'add' | 'remove' }
  | { kind: 'pan'; pointerId: number; last: Point };

const schedule: (callback: () => void) => number =
  typeof requestAnimationFrame === 'function'
    ? (callback) => requestAnimationFrame(callback)
    : (callback) => setTimeout(callback, 16) as unknown as number;

const unschedule: (handle: number) => void =
  typeof cancelAnimationFrame === 'function'
    ? (handle) => cancelAnimationFrame(handle)
    : (handle) => clearTimeout(handle);

/**
 * Drives an ECharts instance from a {@link GanttEngine}, and feeds the engine
 * back from DOM input.
 *
 * Input is handled on the container element rather than through ECharts' event
 * system: the engine can already answer "what is under this pixel" in
 * microseconds, and owning the raw pointer stream is what makes drag, resize and
 * marquee behave like a desktop app instead of like chart tooltips.
 */
export class GanttEChartsAdapter<T = unknown, G = unknown> {
  private chart: EChartsLike | null = null;
  private dom: HTMLElement | null = null;
  private options: GanttAdapterOptions<T, G>;
  private gesture: Gesture = { kind: 'none' };
  private frame: number | null = null;
  private readonly teardowns: Unsubscribe[] = [];
  private ticks: TimeTickScale = { unit: 'day', step: 1, ticks: [] };
  private disposed = false;

  constructor(
    readonly engine: GanttEngine<T, G>,
    options: GanttAdapterOptions<T, G>,
  ) {
    this.options = options;
  }

  /* ---------------------------------------------------------------- *
   * Lifecycle
   * ---------------------------------------------------------------- */

  attach(chart: EChartsLike, element?: HTMLElement | null): void {
    this.detach();
    this.chart = chart;
    this.dom = element ?? chart.getDom?.() ?? null;

    // The canvas *is* the plot area, so its size is the viewport size.
    this.engine.viewport.setSize(chart.getWidth(), chart.getHeight());

    this.teardowns.push(this.engine.store.subscribe(() => this.requestRender()));
    this.teardowns.push(this.engine.on('options:change', () => this.requestRender()));

    if (this.dom) this.bindDom(this.dom);
    this.render();
  }

  detach(): void {
    for (const teardown of this.teardowns.splice(0)) teardown();
    if (this.frame !== null) {
      unschedule(this.frame);
      this.frame = null;
    }
    this.gesture = { kind: 'none' };
    this.chart = null;
    this.dom = null;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.detach();
  }

  /* ---------------------------------------------------------------- *
   * Configuration
   * ---------------------------------------------------------------- */

  setOptions(patch: Partial<GanttAdapterOptions<T, G>>): void {
    this.options = { ...this.options, ...patch };
    this.requestRender();
  }

  setTheme(theme: GanttTheme): void {
    this.setOptions({ theme });
  }

  get theme(): GanttTheme {
    return this.options.theme;
  }

  /* ---------------------------------------------------------------- *
   * Rendering
   * ---------------------------------------------------------------- */

  /** Coalesce a render into the next frame. */
  requestRender(): void {
    if (this.disposed || this.frame !== null || !this.chart) return;
    this.frame = schedule(() => {
      this.frame = null;
      this.render();
    });
  }

  /** Render now. Called directly on resize, where a frame of lag is visible. */
  render(): void {
    const chart = this.chart;
    if (!chart || this.disposed || chart.isDisposed?.()) return;

    const viewport = this.engine.viewport.state;
    this.ticks = computeTimeTicks({
      timeStart: viewport.timeStart,
      timeEnd: viewport.timeEnd,
      width: viewport.width,
      targetPx: this.options.tickTargetPx,
      locale: this.options.locale,
      weekStartsOn: this.options.weekStartsOn,
    });

    let option = buildGanttOption<T, G>({
      engine: this.engine,
      theme: this.options.theme,
      itemRenderer: this.options.itemRenderer,
      ticks: this.ticks,
      locale: this.options.locale,
      weekStartsOn: this.options.weekStartsOn,
      now: this.options.now ? this.options.now() : Date.now(),
      showRowBands: this.options.showRowBands,
      showGrid: this.options.showGrid,
      progressiveThreshold: this.options.progressiveThreshold,
      progressiveMinTasks: this.options.progressiveMinTasks,
    });
    if (this.options.transformOption) option = this.options.transformOption(option);

    // `replaceMerge` keeps element diffing across frames while still dropping the
    // overlay/interaction series on the frames where they produce nothing.
    chart.setOption(option, { replaceMerge: ['series'], lazyUpdate: false, silent: true });
  }

  /** The tick scale of the last rendered frame. */
  getTicks(): TimeTickScale {
    return this.ticks;
  }

  /** Resize the plot area. Renders synchronously to avoid a torn frame. */
  resize(width: number, height: number): void {
    if (!this.chart || this.disposed) return;
    this.chart.resize({ width, height });
    this.engine.viewport.setSize(width, height);
    if (this.frame !== null) {
      unschedule(this.frame);
      this.frame = null;
    }
    this.render();
  }

  /* ---------------------------------------------------------------- *
   * Input
   * ---------------------------------------------------------------- */

  private bindDom(dom: HTMLElement): void {
    const listen = <K extends keyof HTMLElementEventMap>(
      type: K,
      handler: (event: HTMLElementEventMap[K]) => void,
      passive?: boolean,
    ): void => {
      const wrapped = handler as EventListener;
      dom.addEventListener(type, wrapped, passive === undefined ? undefined : { passive });
      this.teardowns.push(() => dom.removeEventListener(type, wrapped));
    };

    if (this.options.pointer !== false) {
      listen('pointerdown', (event) => this.onPointerDown(event));
      listen('pointermove', (event) => this.onPointerMove(event));
      listen('pointerup', (event) => this.onPointerUp(event));
      listen('pointercancel', () => this.cancelGesture());
      listen('pointerleave', (event) => this.onPointerLeave(event));
      listen('dblclick', (event) => this.onDoubleClick(event));
      listen('contextmenu', (event) => this.onContextMenu(event));
    }
    if (this.options.wheel !== false) {
      // Not passive: scroll and zoom both need preventDefault.
      listen('wheel', (event) => this.onWheel(event), false);
    }
    if (this.options.keyboard !== false) {
      listen('keydown', (event) => this.onKeyDown(event));
    }
  }

  /** Event coordinates in plot pixels. */
  pointFromEvent(event: { clientX: number; clientY: number }): Point {
    const dom = this.dom;
    if (!dom) return { x: event.clientX, y: event.clientY };
    const rect = dom.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  private onPointerDown(event: PointerEvent): void {
    const dom = this.dom;
    if (!dom) return;
    const point = this.pointFromEvent(event);
    const interaction = this.engine.getOptions().interaction;

    // Middle button pans, matching every map and timeline tool.
    if (event.button === 1) {
      event.preventDefault();
      this.gesture = { kind: 'pan', pointerId: event.pointerId, last: point };
      capturePointer(dom, event.pointerId);
      return;
    }
    if (event.button !== 0) return;

    dom.focus?.({ preventScroll: true });
    const modifiers = modifiersOf(event);
    const hit = this.engine.hitTest(point);

    if (hit.task) {
      const taskId = hit.task.id;
      const wasSelected = this.engine.selection.isSelected(taskId);
      // Selecting on press (not release) is what lets the same gesture drag the
      // task it just selected.
      if (!wasSelected && interaction.selection) this.engine.selection.handleClick(taskId, modifiers);

      const mode = this.resizeModeAt(taskId, point);
      this.engine.drag.begin(taskId, point, { mode, selectOnBegin: false });
      this.gesture = { kind: 'task', pointerId: event.pointerId, taskId, wasSelected, modifiers };
      capturePointer(dom, event.pointerId);
      return;
    }

    if (interaction.marquee && interaction.selection) {
      const mode = modifiers.alt ? 'remove' : modifiers.ctrl || modifiers.meta ? 'add' : 'replace';
      this.gesture = { kind: 'marquee', pointerId: event.pointerId, origin: point, mode };
      this.engine.store.setState({ marquee: { x: point.x, y: point.y, width: 0, height: 0 } });
    } else {
      this.gesture = { kind: 'pan', pointerId: event.pointerId, last: point };
    }
    capturePointer(dom, event.pointerId);
  }

  private onPointerMove(event: PointerEvent): void {
    const point = this.pointFromEvent(event);

    switch (this.gesture.kind) {
      case 'task':
        this.engine.drag.move(point);
        return;
      case 'marquee': {
        this.engine.store.setState({ marquee: normalizeRect(this.gesture.origin, point) });
        return;
      }
      case 'pan': {
        this.engine.viewport.panByPx(this.gesture.last.x - point.x);
        this.engine.viewport.scrollBy(this.gesture.last.y - point.y);
        this.gesture = { ...this.gesture, last: point };
        return;
      }
      default: {
        const hit = this.engine.hitTest(point);
        this.engine.setHovered(hit.task?.id ?? null, hit.rowIndex >= 0 ? hit.rowIndex : null);
        this.updateCursor(hit.task?.id ?? null, point);
      }
    }
  }

  private onPointerUp(event: PointerEvent): void {
    const point = this.pointFromEvent(event);
    const gesture = this.gesture;
    this.gesture = { kind: 'none' };
    releasePointer(this.dom, event.pointerId);

    switch (gesture.kind) {
      case 'task': {
        const wasDragging = this.engine.drag.isDragging;
        this.engine.drag.commit();
        if (wasDragging) return;

        // A press that never became a drag is a click. Re-running click
        // semantics here is what makes ctrl-clicking an already-selected task
        // deselect it.
        const task = this.engine.getTask(gesture.taskId);
        if (!task) return;
        if (gesture.wasSelected && this.engine.getOptions().interaction.selection) {
          this.engine.selection.handleClick(gesture.taskId, gesture.modifiers);
        }
        this.engine.events.emit('task:click', { task, modifiers: gesture.modifiers, position: point });
        return;
      }
      case 'marquee': {
        const rect = normalizeRect(gesture.origin, point);
        this.engine.store.setState({ marquee: null });

        if (rect.width * rect.height < MARQUEE_MIN_AREA) {
          // A plain click on empty space clears the selection.
          if (gesture.mode === 'replace') this.engine.selection.clear();
          const row = this.engine.nearestRow(point.y);
          if (row) {
            this.engine.events.emit('row:click', { row, modifiers: modifiersOf(event), position: point });
          }
          return;
        }
        this.engine.selection.selectRect(this.toContentRect(rect), gesture.mode);
        return;
      }
      default:
        return;
    }
  }

  private onPointerLeave(event: PointerEvent): void {
    if (this.gesture.kind === 'none') {
      this.engine.setHovered(null, null);
      if (this.dom) this.dom.style.cursor = '';
      return;
    }
    // Capture keeps the gesture alive outside the element; nothing to do.
    void event;
  }

  private onDoubleClick(event: MouseEvent): void {
    const point = this.pointFromEvent(event);
    const hit = this.engine.hitTest(point);
    if (hit.task) {
      this.engine.events.emit('task:dblclick', { task: hit.task, position: point });
      return;
    }
    if (hit.row) this.engine.events.emit('row:dblclick', { row: hit.row, position: point });
  }

  private onContextMenu(event: MouseEvent): void {
    event.preventDefault();
    const point = this.pointFromEvent(event);
    const hit = this.engine.hitTest(point);

    this.engine.contextMenu.open({
      kind: hit.task ? 'task' : hit.row ? 'row' : 'background',
      position: point,
      task: hit.task,
      row: hit.row,
    });

    if (hit.task) this.engine.events.emit('task:contextmenu', { task: hit.task, position: point });
    else if (hit.row) this.engine.events.emit('row:contextmenu', { row: hit.row, position: point });
  }

  private onWheel(event: WheelEvent): void {
    const wheel = this.engine.getOptions().interaction.wheel;
    const action = event.ctrlKey || event.metaKey
      ? wheel.ctrl
      : event.shiftKey
        ? wheel.shift
        : event.altKey
          ? wheel.alt
          : wheel.plain;
    if (action === 'none') return;

    const { x: dx, y: dy } = normalizeWheel(event, this.engine.viewport.state);
    event.preventDefault();

    switch (action) {
      case 'scroll':
        this.engine.viewport.scrollBy(dy);
        return;
      case 'pan':
        this.engine.viewport.panByPx(dx !== 0 ? dx : dy);
        return;
      case 'zoom': {
        const point = this.pointFromEvent(event);
        // Exponential so a fast scroll zooms proportionally, clamped so one
        // trackpad flick cannot jump several orders of magnitude.
        const factor = clampNumber(Math.exp(dy * 0.0025), 0.2, 5);
        this.engine.viewport.zoomAt(factor, point.x);
        return;
      }
    }
  }

  private onKeyDown(event: KeyboardEvent): void {
    const { viewport, selection, drag, contextMenu } = this.engine;
    const additive = event.shiftKey;
    const accel = event.ctrlKey || event.metaKey;

    switch (event.key) {
      case 'ArrowDown':
      case 'ArrowUp': {
        const id = selection.moveFocus(event.key === 'ArrowDown' ? 1 : -1, additive);
        if (id !== null) viewport.scrollTaskIntoView(id);
        break;
      }
      case 'ArrowLeft':
        viewport.panByPx(-viewport.state.width * (accel ? 0.5 : 0.1));
        break;
      case 'ArrowRight':
        viewport.panByPx(viewport.state.width * (accel ? 0.5 : 0.1));
        break;
      case 'PageDown':
        viewport.scrollBy(viewport.state.height * 0.9);
        break;
      case 'PageUp':
        viewport.scrollBy(-viewport.state.height * 0.9);
        break;
      case 'Home':
        if (accel) viewport.scrollTo(0);
        else viewport.fitTime();
        break;
      case 'End':
        viewport.scrollTo(viewport.maxScrollTop);
        break;
      case '+':
      case '=':
        viewport.zoomAt(1 / 1.4, viewport.state.width / 2);
        break;
      case '-':
      case '_':
        viewport.zoomAt(1.4, viewport.state.width / 2);
        break;
      case 'Escape':
        if (drag.state) drag.cancel();
        else if (contextMenu.isOpen) contextMenu.close();
        else selection.clear();
        break;
      case 'a':
      case 'A':
        if (!accel) return;
        selection.selectAll();
        break;
      default:
        return;
    }
    event.preventDefault();
  }

  private cancelGesture(): void {
    if (this.gesture.kind === 'task') this.engine.drag.cancel();
    if (this.gesture.kind === 'marquee') this.engine.store.setState({ marquee: null });
    this.gesture = { kind: 'none' };
  }

  /**
   * Whether the pointer is over a bar's resize handle.
   *
   * Tiny bars are excluded: a 6px handle on an 8px bar would leave nothing to
   * grab for a move.
   */
  private resizeModeAt(taskId: GanttId, point: Point): 'move' | 'resize-start' | 'resize-end' {
    const interaction = this.engine.getOptions().interaction;
    if (!interaction.resize) return 'move';

    const rect = this.engine.getTaskRect(taskId);
    if (!rect) return 'move';
    const handle = this.options.theme.metrics.resizeHandleWidth;
    if (rect.width < handle * 3) return 'move';

    if (point.x - rect.x <= handle) return 'resize-start';
    if (rect.x + rect.width - point.x <= handle) return 'resize-end';
    return 'move';
  }

  private updateCursor(taskId: GanttId | null, point: Point): void {
    const dom = this.dom;
    if (!dom) return;
    if (taskId === null) {
      dom.style.cursor = '';
      return;
    }
    const mode = this.resizeModeAt(taskId, point);
    dom.style.cursor = mode === 'move' ? 'grab' : 'ew-resize';
  }

  /** Plot-pixel rect → the time/content-pixel rect `selectRect` expects. */
  private toContentRect(rect: Rect): Rect {
    const left = this.engine.viewport.pxToTime(rect.x);
    const right = this.engine.viewport.pxToTime(rect.x + rect.width);
    return {
      x: left,
      width: right - left,
      y: this.engine.viewport.pxToContent(rect.y),
      height: rect.height,
    };
  }
}

/**
 * Pointer capture is best-effort: browsers throw for a stale pointer id, and
 * some environments do not implement it at all. Losing capture degrades the
 * gesture at the element boundary; throwing would abort it outright.
 */
function capturePointer(dom: HTMLElement, pointerId: number): void {
  try {
    dom.setPointerCapture?.(pointerId);
  } catch {
    /* ignored */
  }
}

function releasePointer(dom: HTMLElement | null, pointerId: number): void {
  try {
    dom?.releasePointerCapture?.(pointerId);
  } catch {
    /* ignored */
  }
}

function modifiersOf(event: MouseEvent | PointerEvent | KeyboardEvent): PointerModifiers {
  return { ctrl: event.ctrlKey, shift: event.shiftKey, meta: event.metaKey, alt: event.altKey };
}

function normalizeRect(a: Point, b: Point): Rect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(a.x - b.x),
    height: Math.abs(a.y - b.y),
  };
}

/** Wheel deltas in pixels, whatever unit the browser reported. */
function normalizeWheel(
  event: WheelEvent,
  viewport: { width: number; height: number },
): { x: number; y: number } {
  const factor = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewport.height : 1;
  return { x: event.deltaX * factor, y: event.deltaY * factor };
}

function clampNumber(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}
