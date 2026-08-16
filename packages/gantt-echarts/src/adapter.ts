import type {
  BackgroundDragAction,
  GanttEngine,
  GanttId,
  GanttTheme,
  Point,
  PointerModifiers,
  Rect,
  SelectionMode,
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

/**
 * Below this travel (px), a background pan is treated as a click instead.
 *
 * Without it, configuring a plain drag to pan would silently cost you the
 * click-empty-space-to-clear-selection behaviour the marquee gesture provides.
 */
const PAN_CLICK_SLOP = 3;

/** The subset of {@link SelectionMode} a background gesture can produce. */
type MarqueeMode = Extract<SelectionMode, 'replace' | 'add' | 'remove'>;

type Gesture =
  | { kind: 'none' }
  | {
      kind: 'task';
      pointerId: number;
      taskId: GanttId;
      /**
       * Run click selection semantics on a no-travel release. False when the
       * press already ran them, so the drag could carry what it selected.
       */
      clickSelects: boolean;
      modifiers: PointerModifiers;
    }
  | {
      kind: 'marquee';
      pointerId: number;
      origin: Point;
      mode: MarqueeMode;
      /** Modifiers at press, for click semantics on a no-travel release. */
      modifiers: PointerModifiers;
      /**
       * The bar the press landed on, when the marquee was started from one
       * (`interaction.marqueeOnTasks`). A release too small to be a drag is then
       * a click on that bar rather than on the background.
       */
      taskId: GanttId | null;
    }
  | {
      kind: 'pan';
      pointerId: number;
      origin: Point;
      last: Point;
      /** Modifiers at press, for background-click semantics on a no-move release. */
      modifiers: PointerModifiers;
      /** False for middle-button pans, which never stand in for a click. */
      click: boolean;
      /**
       * The bar the press landed on, when a press on an unselected bar fell
       * through to the pan (`interaction.dragSelectedOnly`). A release that
       * never travelled is then a click on that bar rather than on the
       * background.
       */
      taskId: GanttId | null;
    };

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
      this.beginPan(point, modifiersOf(event), event.pointerId, dom, { click: false });
      return;
    }
    if (event.button !== 0) return;

    dom.focus?.({ preventScroll: true });
    const modifiers = modifiersOf(event);
    const hit = this.engine.hitTest(point);

    // A bar on a disabled row is not a target: the press falls through to the
    // background gesture, so panning and marqueeing still work over the row.
    if (hit.task && !hit.row?.disabled) {
      const taskId = hit.task.id;

      // Drag-to-select claims the gesture: the press starts a rubber band
      // anchored on the bar instead of picking it up. Selection is deferred to
      // the release, since there is no drag here to carry it.
      //
      // A *modified* press does the same whenever that modifier maps to the
      // band, bars included: ctrl-drag extends the selection over everything it
      // covers rather than picking the pressed bar up — which is the one thing
      // a bar could otherwise never be the start of. An unmodified press is
      // left to `marqueeOnTasks`, so a `plain: 'marquee'` map does not quietly
      // cost every chart its drag-to-move.
      if (
        this.marqueeStartsOnTasks() ||
        (hasModifier(modifiers) && this.backgroundDragAction(modifiers) === 'marquee')
      ) {
        this.beginMarquee(point, modifiers, taskId, event.pointerId, dom);
        return;
      }

      const wasSelected = this.engine.selection.isSelected(taskId);
      const mode = this.resizeModeAt(taskId, point);

      // A move picks the bar up only once it is selected: on an unselected one
      // the press runs the background gesture instead, so a stray drag pans the
      // chart rather than rescheduling work nobody aimed at. Resize handles are
      // exempt — the cursor there has already promised a resize.
      if (mode === 'move' && !wasSelected && interaction.drag && interaction.dragSelectedOnly) {
        this.beginUnselectedTaskGesture(point, modifiers, taskId, event.pointerId, dom);
        return;
      }

      // Selecting on press (not release) is what lets the same gesture drag the
      // task it just selected.
      if (!wasSelected && interaction.selection) this.engine.selection.handleClick(taskId, modifiers);

      this.engine.drag.begin(taskId, point, { mode, selectOnBegin: false });
      this.gesture = {
        kind: 'task',
        pointerId: event.pointerId,
        taskId,
        clickSelects: wasSelected,
        modifiers,
      };
      capturePointer(dom, event.pointerId);
      return;
    }

    const action = this.backgroundDragAction(modifiers);
    if (action === 'none') {
      this.gesture = { kind: 'none' };
      return;
    }

    if (action === 'marquee') {
      this.beginMarquee(point, modifiers, null, event.pointerId, dom);
      return;
    }
    this.beginPan(point, modifiers, event.pointerId, dom);
  }

  /**
   * A press on a bar that is not selected, with `interaction.dragSelectedOnly`
   * on.
   *
   * The gesture becomes whatever the same press on empty background would be,
   * anchored on the bar so a release that never travelled is still a click on
   * it — which is what selects the bar, ready for the next drag to carry it. A
   * modifier mapped to `'none'` leaves that click and nothing else.
   */
  private beginUnselectedTaskGesture(
    point: Point,
    modifiers: PointerModifiers,
    taskId: GanttId,
    pointerId: number,
    dom: HTMLElement,
  ): void {
    const action = this.backgroundDragAction(modifiers);
    if (action === 'marquee') {
      this.beginMarquee(point, modifiers, taskId, pointerId, dom);
      return;
    }
    if (action === 'pan') {
      this.beginPan(point, modifiers, pointerId, dom, { taskId });
      return;
    }
    // No drag armed: the gesture exists only to carry the click on release.
    this.gesture = { kind: 'task', pointerId, taskId, clickSelects: true, modifiers };
    capturePointer(dom, pointerId);
  }

  /**
   * Does a press on a bar start a rubber band rather than pick the bar up?
   *
   * Needs the marquee to be drawable at all, so the option cannot leave a press
   * on a bar doing nothing when selection is switched off underneath it.
   */
  private marqueeStartsOnTasks(): boolean {
    const interaction = this.engine.getOptions().interaction;
    return interaction.marqueeOnTasks && interaction.marquee && interaction.selection;
  }

  private beginMarquee(
    origin: Point,
    modifiers: PointerModifiers,
    taskId: GanttId | null,
    pointerId: number,
    dom: HTMLElement,
  ): void {
    this.gesture = {
      kind: 'marquee',
      pointerId,
      origin,
      mode: marqueeModeOf(modifiers),
      modifiers,
      taskId,
    };
    this.engine.store.setState({ marquee: { x: origin.x, y: origin.y, width: 0, height: 0 } });
    capturePointer(dom, pointerId);
  }

  private beginPan(
    origin: Point,
    modifiers: PointerModifiers,
    pointerId: number,
    dom: HTMLElement,
    options: { click?: boolean; taskId?: GanttId | null } = {},
  ): void {
    this.gesture = {
      kind: 'pan',
      pointerId,
      origin,
      last: origin,
      modifiers,
      click: options.click ?? true,
      taskId: options.taskId ?? null,
    };
    capturePointer(dom, pointerId);
  }

  /**
   * Gesture for a left-button drag on empty background.
   *
   * Mirrors the wheel resolution order — ctrl/meta, shift, alt, then plain — so
   * both modifier maps behave the same way.
   */
  private backgroundDragAction(modifiers: PointerModifiers): BackgroundDragAction {
    const interaction = this.engine.getOptions().interaction;
    const map = interaction.backgroundDrag;
    const action =
      modifiers.ctrl || modifiers.meta
        ? map.ctrl
        : modifiers.shift
          ? map.shift
          : modifiers.alt
            ? map.alt
            : map.plain;

    // `marquee` and `selection` stay master switches: a marquee we are not
    // allowed to draw degrades to a pan, as it did before this map existed.
    if (action === 'marquee' && !(interaction.marquee && interaction.selection)) return 'pan';
    return action;
  }

  /**
   * A press on a bar that never travelled far enough to be a drag.
   *
   * `select` runs click selection semantics; pass false when the press already
   * ran them. `handleClick` is itself a no-op when selection is off, so this
   * still emits `task:click` for a chart that only wants the event.
   */
  private taskClick(
    taskId: GanttId,
    modifiers: PointerModifiers,
    point: Point,
    select = true,
  ): void {
    const task = this.engine.getTask(taskId);
    if (!task) return;
    if (select) this.engine.selection.handleClick(taskId, modifiers);
    this.engine.events.emit('task:click', { task, modifiers, position: point });
  }

  /**
   * Selection semantics for a press on empty background that never travelled
   * far enough to be a drag. Shared by the marquee and pan gestures so the
   * choice of background gesture does not change what a click does.
   */
  private backgroundClick(point: Point, mode: MarqueeMode, event: PointerEvent): void {
    if (mode === 'replace' && this.engine.getOptions().interaction.selection) {
      this.engine.selection.clear();
    }
    const row = this.engine.nearestRow(point.y);
    if (row && !row.disabled) {
      this.engine.events.emit('row:click', { row, modifiers: modifiersOf(event), position: point });
    }
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
        // Hover is reported truthfully, disabled row or not: a disabled row is
        // still readable, so its bars keep their tooltip, and the row itself
        // still lights up and reveals its gutter controls. What a disabled row
        // withholds is anything that offers input — the emphasis stroke (the
        // item renderer drops it) and the grab cursor (below).
        const taskId = hit.task?.id ?? null;
        this.engine.setHovered(taskId, hit.rowIndex >= 0 ? hit.rowIndex : null);
        this.updateCursor(hit.row?.disabled ? null : taskId, point);
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
        // deselect it; a task the press already selected must not have them run
        // twice.
        this.taskClick(gesture.taskId, gesture.modifiers, point, gesture.clickSelects);
        return;
      }
      case 'marquee': {
        const rect = normalizeRect(gesture.origin, point);
        this.engine.store.setState({ marquee: null });

        if (rect.width * rect.height < MARQUEE_MIN_AREA) {
          // Too small to be a rubber band, so it was a click — on the bar it
          // started on, or on empty space, which clears the selection.
          if (gesture.taskId !== null) this.taskClick(gesture.taskId, gesture.modifiers, point);
          else this.backgroundClick(point, gesture.mode, event);
          return;
        }
        this.engine.selection.selectRect(this.toContentRect(rect), gesture.mode);
        return;
      }
      case 'pan': {
        // A pan that never travelled is a click, and has to mean the same thing
        // here as it does under the marquee gesture — on the bar it started on,
        // or on the background.
        if (!gesture.click) return;
        const dx = point.x - gesture.origin.x;
        const dy = point.y - gesture.origin.y;
        if (dx * dx + dy * dy <= PAN_CLICK_SLOP * PAN_CLICK_SLOP) {
          if (gesture.taskId !== null) this.taskClick(gesture.taskId, gesture.modifiers, point);
          else this.backgroundClick(point, marqueeModeOf(gesture.modifiers), event);
        }
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
    if (hit.row?.disabled) return;
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
    // The menu still opens over a disabled row — it is the way back out — but
    // it is about the row, never the bar under the pointer.
    const task = hit.row?.disabled ? null : hit.task;

    this.engine.contextMenu.open({
      kind: task ? 'task' : hit.row ? 'row' : 'background',
      position: point,
      task,
      row: hit.row,
    });

    if (task) this.engine.events.emit('task:contextmenu', { task, position: point });
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
    if (this.resizeModeAt(taskId, point) !== 'move') {
      dom.style.cursor = 'ew-resize';
      return;
    }
    // A bar that cannot be picked up must not offer the grab hand: with drag
    // off — or unselected, where a drag pans instead — it is a click target, or
    // nothing at all when selection is off too.
    const interaction = this.engine.getOptions().interaction;
    const movable =
      interaction.drag &&
      (!interaction.dragSelectedOnly || this.engine.selection.isSelected(taskId));
    if (movable) dom.style.cursor = 'grab';
    else dom.style.cursor = interaction.selection ? 'pointer' : '';
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

function hasModifier(modifiers: PointerModifiers): boolean {
  return modifiers.ctrl || modifiers.meta || modifiers.shift || modifiers.alt;
}

/** Alt removes from the selection, ctrl/meta adds, anything else replaces. */
function marqueeModeOf(modifiers: PointerModifiers): MarqueeMode {
  if (modifiers.alt) return 'remove';
  if (modifiers.ctrl || modifiers.meta) return 'add';
  return 'replace';
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
