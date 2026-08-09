import { emptyModel, normalize, type DataModel } from './data/dataModel';
import { affectsLayout, resolveOptions, defaultOptions, DAY } from './defaults';
import { ContextMenuEngine } from './engine/contextMenu';
import type { EngineContext } from './engine/context';
import { DragEngine } from './engine/drag';
import { barInset, computeLayout, laneTop, nearestRowIndex, rowIndexAt } from './engine/layout';
import { resolveRows, type RowModel } from './engine/rows';
import { SelectionEngine } from './engine/selection';
import { ViewportController } from './engine/viewport';
import { computeVisible } from './engine/virtualize';
import { applyChanges } from './history';
import { OverlayRegistry, type GanttPlugin } from './plugins';
import { createInitialState, type GanttState } from './store/ganttState';
import { Store } from './store/store';
import { Emitter, type Unsubscribe } from './util/emitter';
import { clamp, upperBoundIndex } from './util/search';
import type {
  DeepPartial,
  GanttEngineOptions,
  GanttEventMap,
  GanttGroup,
  GanttId,
  GanttRow,
  GanttTask,
  LayoutResult,
  Point,
  TaskChange,
  ViewportState,
  VisibleWindow,
} from './types';

export interface GanttEngineInit<T = unknown, G = unknown> {
  tasks?: readonly GanttTask<T>[];
  groups?: readonly GanttGroup<G>[];
  options?: DeepPartial<GanttEngineOptions>;
  /** Initial plot size in px. */
  size?: { width: number; height: number };
  /** Emit `console.warn` for data problems found during normalization. */
  warn?: boolean;
}

export interface HitTestResult<T = unknown, G = unknown> {
  task: GanttTask<T> | null;
  taskIndex: number;
  row: GanttRow<G> | null;
  rowIndex: number;
  lane: number;
  time: number;
  contentY: number;
}

/**
 * The Gantt engine.
 *
 * Owns the pipeline
 * `data → rows → layout(+stack) → virtualize → render context`
 * and the interaction sub-engines that write into the store. Each pipeline
 * stage is memoized on its inputs, so panning re-runs only the virtualizer,
 * selecting re-runs nothing but the frame assembly, and a collapse toggle is
 * the only interaction that reaches back as far as stacking.
 *
 * Nothing here touches the DOM; renderers subscribe and read.
 */
export class GanttEngine<T = unknown, G = unknown> {
  readonly store: Store<GanttState<T, G>>;
  readonly events = new Emitter<GanttEventMap<T, G>>();
  readonly overlays = new OverlayRegistry<T, G>();
  readonly selection: SelectionEngine<T, G>;
  readonly viewport: ViewportController<T, G>;
  readonly drag: DragEngine<T, G>;
  readonly contextMenu: ContextMenuEngine<T, G>;

  private options: GanttEngineOptions;
  private model: DataModel<T, G>;
  private groupsInput: readonly GanttGroup<G>[] | undefined;
  private revision = 0;
  private disposed = false;
  private readonly warn: boolean;
  private readonly teardowns: Unsubscribe[] = [];
  private readonly plugins = new Map<string, GanttPlugin<T, G>>();
  /** Group ids ever seen, so `group.collapsed` only seeds state once. */
  private readonly seenGroups = new Set<GanttId>();

  // --- memoized pipeline stages ---
  private rowCache: { key: string; value: RowModel<G> } | null = null;
  private layoutCache: { rows: RowModel<G>; options: GanttEngineOptions; value: LayoutResult<G> } | null = null;
  private visibleCache: {
    layout: LayoutResult<G>;
    viewport: ViewportState;
    selection: ReadonlySet<GanttId>;
    hovered: GanttId | null;
    drag: GanttState<T, G>['drag'];
    options: GanttEngineOptions;
    value: VisibleWindow<T, G>;
  } | null = null;

  private readonly ctx: EngineContext<T, G>;

  constructor(init: GanttEngineInit<T, G> = {}) {
    this.options = resolveOptions(init.options);
    this.warn = init.warn ?? true;
    this.model = emptyModel<T, G>(0);
    this.groupsInput = init.groups;

    const viewport: ViewportState = {
      timeStart: 0,
      timeEnd: 0,
      scrollTop: 0,
      width: init.size?.width ?? 0,
      height: init.size?.height ?? 0,
    };
    this.store = new Store<GanttState<T, G>>(createInitialState<T, G>(viewport));

    this.ctx = {
      store: this.store,
      events: this.events,
      getModel: () => this.model,
      getLayout: () => this.getLayout(),
      getOptions: () => this.options,
      getDomain: () => this.getDomain(),
    };

    this.selection = new SelectionEngine(this.ctx);
    this.viewport = new ViewportController(this.ctx);
    this.drag = new DragEngine(this.ctx, this.selection, this.viewport);
    this.contextMenu = new ContextMenuEngine(this.ctx, this.selection);

    if (init.tasks || init.groups) this.setData(init.tasks ?? [], init.groups);
  }

  /* ---------------------------------------------------------------- *
   * Data
   * ---------------------------------------------------------------- */

  setData(tasks: readonly GanttTask<T>[], groups?: readonly GanttGroup<G>[]): void {
    const isFirstLoad = this.model.tasks.length === 0 && this.model.groups.length === 0;
    this.groupsInput = groups ?? this.groupsInput;

    const { model, warnings } = normalize<T, G>(tasks, this.groupsInput, ++this.revision);
    this.model = model;
    if (this.warn && warnings.length > 0) {
      for (const warning of warnings.slice(0, 10)) console.warn(`[gantt] ${warning}`);
      if (warnings.length > 10) console.warn(`[gantt] …and ${warnings.length - 10} more data warnings.`);
    }

    this.invalidateRows();
    this.reconcileStateWithData(isFirstLoad);

    this.events.emit('data:change', { taskCount: tasks.length, groupCount: model.groups.length });
    this.events.emit('layout:change', this.getLayout());
  }

  setTasks(tasks: readonly GanttTask<T>[]): void {
    this.setData(tasks, this.groupsInput);
  }

  setGroups(groups: readonly GanttGroup<G>[]): void {
    this.setData(this.model.tasks, groups);
  }

  /** Replace tasks with a change set applied. Convenience for uncontrolled use. */
  applyChanges(changes: readonly TaskChange[]): GanttTask<T>[] {
    const next = applyChanges(this.model.tasks, changes);
    if (next !== this.model.tasks) this.setTasks(next);
    return next;
  }

  getTasks(): readonly GanttTask<T>[] {
    return this.model.tasks;
  }

  getGroups(): readonly GanttGroup<G>[] {
    return this.model.groups;
  }

  getTask(id: GanttId): GanttTask<T> | undefined {
    const index = this.model.taskIndexById.get(id);
    return index === undefined ? undefined : this.model.tasks[index];
  }

  getDataModel(): DataModel<T, G> {
    return this.model;
  }

  /* ---------------------------------------------------------------- *
   * Options
   * ---------------------------------------------------------------- */

  getOptions(): GanttEngineOptions {
    return this.options;
  }

  setOptions(partial: DeepPartial<GanttEngineOptions>): void {
    const previous = this.options;
    const next = resolveOptions(partial, previous);
    this.options = next;
    if (affectsLayout(previous, next)) this.invalidateLayout();
    this.events.emit('options:change', next);
  }

  /* ---------------------------------------------------------------- *
   * Pipeline
   * ---------------------------------------------------------------- */

  getRows(): RowModel<G> {
    const collapsed = this.store.getState().collapsed;
    const key = `${this.model.revision}:${this.options.stacking.rollupCollapsed}:${collapsed.size}:${hashIds(collapsed)}`;
    if (this.rowCache && this.rowCache.key === key) return this.rowCache.value;
    const value = resolveRows(this.model, collapsed, this.options.stacking.rollupCollapsed);
    this.rowCache = { key, value };
    return value;
  }

  getLayout(): LayoutResult<G> {
    const rows = this.getRows();
    const cache = this.layoutCache;
    if (cache && cache.rows === rows && cache.options === this.options) return cache.value;
    const value = computeLayout(this.model, rows, this.options, ++this.revision);
    this.layoutCache = { rows, options: this.options, value };
    return value;
  }

  /**
   * The frame: every bar that intersects the viewport, with interaction state
   * and any in-flight drag offset already applied.
   */
  getVisible(): VisibleWindow<T, G> {
    const layout = this.getLayout();
    const state = this.store.getState();
    const cache = this.visibleCache;
    if (
      cache &&
      cache.layout === layout &&
      cache.viewport === state.viewport &&
      cache.selection === state.selection &&
      cache.hovered === state.hoveredTaskId &&
      cache.drag === state.drag &&
      cache.options === this.options
    ) {
      return cache.value;
    }

    const value = computeVisible<T, G>({
      model: this.model,
      layout,
      viewport: state.viewport,
      options: this.options,
      selection: state.selection,
      hoveredTaskId: state.hoveredTaskId,
      drag: state.drag,
      revision: layout.revision,
    });

    this.visibleCache = {
      layout,
      viewport: state.viewport,
      selection: state.selection,
      hovered: state.hoveredTaskId,
      drag: state.drag,
      options: this.options,
      value,
    };
    return value;
  }

  get totalHeight(): number {
    return this.getLayout().totalHeight;
  }

  getDomain(): readonly [number, number] {
    const configured = this.options.timeDomain;
    if (configured) return configured;
    const [start, end] = this.model.domain;
    if (end > start) return [start, end];
    // A single-instant (or empty) dataset still needs a scrollable window.
    return [start - DAY / 2, start + DAY / 2];
  }

  /* ---------------------------------------------------------------- *
   * Interaction state
   * ---------------------------------------------------------------- */

  setHovered(taskId: GanttId | null, rowIndex: number | null = null): void {
    const state = this.store.getState();
    if (state.hoveredTaskId === taskId && state.hoveredRowIndex === rowIndex) return;
    this.store.setState({ hoveredTaskId: taskId, hoveredRowIndex: rowIndex });
    this.events.emit('hover:change', { taskId, rowIndex });
  }

  isCollapsed(groupId: GanttId): boolean {
    return this.store.getState().collapsed.has(groupId);
  }

  setCollapsed(groupId: GanttId, collapsed: boolean): void {
    const current = this.store.getState().collapsed;
    if (current.has(groupId) === collapsed) return;
    const next = new Set(current);
    if (collapsed) next.add(groupId);
    else next.delete(groupId);
    this.commitCollapsed(next, groupId, collapsed);
  }

  toggleCollapse(groupId: GanttId): void {
    this.setCollapsed(groupId, !this.isCollapsed(groupId));
  }

  collapseAll(): void {
    const next = new Set<GanttId>();
    for (let i = 0; i < this.model.groups.length; i++) {
      if (this.model.groupChildren[i].length > 0) next.add(this.model.groups[i].id);
    }
    this.commitCollapsed(next, null, true);
  }

  expandAll(): void {
    if (this.store.getState().collapsed.size === 0) return;
    this.commitCollapsed(new Set<GanttId>(), null, false);
  }

  /* ---------------------------------------------------------------- *
   * Hit testing
   * ---------------------------------------------------------------- */

  /**
   * What sits under a point in plot pixels.
   *
   * Renderers that already know the hit target (ECharts hands us a data index)
   * should use that; this exists for background clicks, axis interactions and
   * headless testing.
   */
  hitTest(point: Point): HitTestResult<T, G> {
    const layout = this.getLayout();
    const time = this.viewport.pxToTime(point.x);
    const contentY = this.viewport.pxToContent(point.y);
    const rowIndex = rowIndexAt(layout, contentY);

    const result: HitTestResult<T, G> = {
      task: null,
      taskIndex: -1,
      row: rowIndex >= 0 ? layout.rows[rowIndex] : null,
      rowIndex,
      lane: -1,
      time,
      contentY,
    };
    if (rowIndex < 0) return result;

    const row = layout.rows[rowIndex];
    const { minItemWidth } = this.options.metrics;
    // Offset into the row's lane band. Every cluster fills the same band, so
    // this bounds check is shared even though lane heights differ inside it.
    const laneY = contentY - row.y - row.laneOffset;
    const band = row.laneCount * row.laneHeight;
    if (laneY < 0 || laneY >= band) return result;
    // Reported for empty space; a hit below replaces it with the bar's own lane.
    result.lane = Math.min(row.laneCount - 1, Math.floor(laneY / row.laneHeight));

    // Short bars are widened to `minItemWidth` on screen, so hit-testing has to
    // use the same tolerance in time space.
    const scale = this.viewport.scale;
    const tolerance = scale > 0 ? minItemWidth / scale : 0;

    const from = layout.rowOffsets[rowIndex];
    const to = layout.rowOffsets[rowIndex + 1];
    const hi = upperBoundIndex(layout.rankToTask, time, from, to, (rank) => this.model.starts[layout.rankToTask[rank]]);

    for (let rank = hi; rank >= from; rank--) {
      if (layout.maxEndPrefix[rank] < time - tolerance) break;
      const taskIndex = layout.rankToTask[rank];
      const laneHeight = layout.taskLaneHeight[taskIndex];
      const top = layout.taskLane[taskIndex] * laneHeight;
      if (laneY < top || laneY >= top + laneHeight) continue;
      const end = Math.max(this.model.ends[taskIndex], this.model.starts[taskIndex] + tolerance);
      if (end >= time) {
        result.task = this.model.tasks[taskIndex];
        result.taskIndex = taskIndex;
        result.lane = layout.taskLane[taskIndex];
        return result;
      }
    }
    return result;
  }

  /** Row under a plot-space y coordinate, clamped into range. */
  nearestRow(plotY: number): GanttRow<G> | null {
    const layout = this.getLayout();
    const index = nearestRowIndex(layout, this.viewport.pxToContent(plotY));
    return index >= 0 ? layout.rows[index] : null;
  }

  /** Plot-space rect for a task, or null when it is not currently displayed. */
  getTaskRect(id: GanttId): { x: number; y: number; width: number; height: number } | null {
    const index = this.model.taskIndexById.get(id);
    if (index === undefined) return null;
    const layout = this.getLayout();
    const rowIndex = layout.taskRow[index];
    if (rowIndex < 0) return null;

    const { itemPaddingY, minItemWidth } = this.options.metrics;
    const row = layout.rows[rowIndex];
    const laneHeight = layout.taskLaneHeight[index];
    const inset = barInset(laneHeight, itemPaddingY);
    const x = this.viewport.timeToPx(this.model.starts[index]);
    const right = this.viewport.timeToPx(this.model.ends[index]);
    return {
      x,
      width: Math.max(minItemWidth, right - x),
      y: this.viewport.contentToPx(laneTop(row, layout.taskLane[index], laneHeight) + inset),
      height: Math.max(1, laneHeight - inset * 2),
    };
  }

  /* ---------------------------------------------------------------- *
   * Plugins
   * ---------------------------------------------------------------- */

  use(plugin: GanttPlugin<T, G>): Unsubscribe {
    if (this.plugins.has(plugin.name)) {
      throw new Error(`[gantt] a plugin named "${plugin.name}" is already installed.`);
    }
    this.plugins.set(plugin.name, plugin);
    const teardown = plugin.setup(this);
    const dispose = (): void => {
      if (!this.plugins.delete(plugin.name)) return;
      teardown?.();
    };
    this.teardowns.push(dispose);
    return dispose;
  }

  hasPlugin(name: string): boolean {
    return this.plugins.has(name);
  }

  /* ---------------------------------------------------------------- *
   * Lifecycle
   * ---------------------------------------------------------------- */

  on<K extends keyof GanttEventMap<T, G>>(
    event: K,
    listener: (payload: GanttEventMap<T, G>[K]) => void,
  ): Unsubscribe {
    return this.events.on(event, listener);
  }

  subscribe(listener: (state: GanttState<T, G>) => void): Unsubscribe {
    return this.store.subscribe(listener);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const teardown of this.teardowns.splice(0)) teardown();
    this.plugins.clear();
    this.overlays.clear();
    this.events.clear();
    this.store.destroy();
    this.rowCache = null;
    this.layoutCache = null;
    this.visibleCache = null;
  }

  get isDisposed(): boolean {
    return this.disposed;
  }

  /* ---------------------------------------------------------------- *
   * Internals
   * ---------------------------------------------------------------- */

  private invalidateRows(): void {
    this.rowCache = null;
    this.invalidateLayout();
  }

  private invalidateLayout(): void {
    this.layoutCache = null;
    this.visibleCache = null;
    this.store.setState({ layoutRevision: this.store.getState().layoutRevision + 1 });
  }

  private commitCollapsed(next: ReadonlySet<GanttId>, groupId: GanttId | null, collapsed: boolean): void {
    this.store.setState({ collapsed: next });
    this.invalidateRows();

    if (groupId !== null) {
      const rowIndex = this.getRows().groupToRow[this.model.groupIndexById.get(groupId) ?? -1];
      const row = rowIndex >= 0 ? this.getLayout().rows[rowIndex] : null;
      if (row) this.events.emit('row:toggle', { row, collapsed });
    }
    this.clampScroll();
    this.events.emit('layout:change', this.getLayout());
  }

  /**
   * Keep store state meaningful across a data replacement: drop selection and
   * hover entries for tasks that no longer exist, seed collapse state from
   * newly-introduced groups, and frame the data on first load.
   */
  private reconcileStateWithData(isFirstLoad: boolean): void {
    this.store.batch(() => {
      const state = this.store.getState();

      let collapsed = state.collapsed;
      const nextCollapsed = new Set<GanttId>();
      for (const group of this.model.groups) {
        const known = collapsed.has(group.id);
        // Groups seen before keep their runtime state; new ones adopt the
        // `collapsed` flag from the data.
        if (known || (group.collapsed && !this.seenGroups.has(group.id))) nextCollapsed.add(group.id);
        this.seenGroups.add(group.id);
      }
      if (nextCollapsed.size !== collapsed.size || !isSuperset(collapsed, nextCollapsed)) {
        collapsed = nextCollapsed;
        this.store.setState({ collapsed });
        this.rowCache = null;
        this.layoutCache = null;
      }

      if (state.selection.size > 0) {
        const kept = new Set<GanttId>();
        for (const id of state.selection) if (this.model.taskIndexById.has(id)) kept.add(id);
        if (kept.size !== state.selection.size) this.store.setState({ selection: kept });
      }
      if (state.hoveredTaskId !== null && !this.model.taskIndexById.has(state.hoveredTaskId)) {
        this.store.setState({ hoveredTaskId: null, hoveredRowIndex: null });
      }
      if (state.drag) this.store.setState({ drag: null });
      this.store.setState({ dataRevision: this.model.revision });
    });

    if (isFirstLoad && this.store.getState().viewport.timeStart === this.store.getState().viewport.timeEnd) {
      this.viewport.fitTime();
    }
    this.clampScroll();
  }

  private clampScroll(): void {
    const { scrollTop, height } = this.store.getState().viewport;
    const max = Math.max(0, this.getLayout().totalHeight - height);
    const next = clamp(scrollTop, 0, max);
    if (next !== scrollTop) this.viewport.scrollTo(next);
  }
}

function isSuperset(superset: ReadonlySet<GanttId>, subset: ReadonlySet<GanttId>): boolean {
  for (const id of subset) if (!superset.has(id)) return false;
  return true;
}

/** Cheap order-independent hash of an id set, used only for cache keys. */
function hashIds(ids: ReadonlySet<GanttId>): number {
  let hash = 0;
  for (const id of ids) {
    const text = String(id);
    let local = 2166136261;
    for (let i = 0; i < text.length; i++) {
      local ^= text.charCodeAt(i);
      local = Math.imul(local, 16777619);
    }
    hash = (hash + local) | 0;
  }
  return hash;
}
