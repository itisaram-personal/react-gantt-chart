/**
 * Public data & configuration types for the Gantt engine.
 *
 * The engine is deliberately framework- and renderer-agnostic: nothing in this
 * file references the DOM, React or ECharts.
 */

export type GanttId = string | number;

/** A single bar on the chart. `start === end` is treated as a milestone. */
export interface GanttTask<T = unknown> {
  id: GanttId;
  /** Id of the {@link GanttGroup} (y-axis row) this task belongs to. */
  groupId: GanttId;
  /** Inclusive start, epoch milliseconds. */
  start: number;
  /** Exclusive end, epoch milliseconds. Equal to `start` for milestones. */
  end: number;
  /**
   * Pin the task to an explicit stacking lane. When omitted the stacking
   * engine assigns the lowest free lane.
   */
  lane?: number;
  /** Excluded from overlap detection; always rendered in lane 0. */
  floating?: boolean;
  /** Opt out of dragging for this task only. */
  draggable?: boolean;
  /** Arbitrary consumer payload, surfaced untouched in the render context. */
  data?: T;
}

/** A y-axis row. Groups may form a tree via {@link GanttGroup.parentId}. */
export interface GanttGroup<G = unknown> {
  id: GanttId;
  label?: string;
  parentId?: GanttId | null;
  /** Initial collapsed state; runtime state lives in the store. */
  collapsed?: boolean;
  /**
   * Initial disabled state; runtime state lives in the store, exactly like
   * {@link GanttGroup.collapsed}. See {@link GanttRow.disabled} for what a
   * disabled row ignores.
   */
  disabled?: boolean;
  /** Fixed row height in px. Overrides the lane-derived height. */
  height?: number;
  data?: G;
}

/* ------------------------------------------------------------------ *
 * Geometry
 * ------------------------------------------------------------------ */

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

/* ------------------------------------------------------------------ *
 * Rows (the resolved, collapse-aware y-axis model)
 * ------------------------------------------------------------------ */

/**
 * A display row. One row per *visible* group. Groups hidden behind a collapsed
 * ancestor do not get a row; depending on {@link StackingOptions.rollupCollapsed}
 * their tasks are rolled up onto the nearest visible ancestor row instead.
 */
export interface GanttRow<G = unknown> {
  /** Index into {@link LayoutResult.rows}. */
  index: number;
  group: GanttGroup<G>;
  /** Index into the engine's group array. */
  groupIndex: number;
  /** Tree depth, 0 for roots. */
  depth: number;
  /** Top edge in *content* pixels (independent of scroll). */
  y: number;
  height: number;
  /** Number of stacking lanes occupied by this row's tasks (>= 1). */
  laneCount: number;
  /**
   * Height of one lane at this row's *deepest* stack, px. Equal to
   * {@link GanttMetrics.laneHeight} unless {@link GanttMetrics.uniformRowHeight}
   * is on, where lanes are divided out of the fixed row height instead.
   *
   * Bars in shallower parts of the row are taller than this — see
   * {@link LayoutResult.taskLaneHeight}.
   */
  laneHeight: number;
  /** Offset of lane 0 from the row's top edge, px. Lanes are centred in tall rows. */
  laneOffset: number;
  hasChildren: boolean;
  collapsed: boolean;
  /**
   * The row is inert: its bars ignore every data interaction — selection,
   * click and double-click events, drag, resize, marquee and hover — and no
   * drag may drop a task onto it.
   *
   * View-level controls keep working, so a disabled row can still be
   * collapsed, right-clicked and re-enabled. Programmatic APIs
   * (`selection.set`, `applyChanges`, …) are not gated either: this is an
   * input rule, not a data lock.
   *
   * Unlike {@link GanttRow.collapsed} it changes nothing about geometry, so
   * toggling it never re-runs stacking or layout.
   */
  disabled: boolean;
}

/* ------------------------------------------------------------------ *
 * Options
 * ------------------------------------------------------------------ */

/**
 * A vertical length: a number of pixels, or a percentage of the box it sits in
 * — `'12%'`.
 *
 * A percentage keeps its proportion when the box is resized, which is what
 * makes a chart look the same at any row height: shrink rows to fit a hundred
 * of them on screen and the padding shrinks with them, instead of a fixed 4px
 * swallowing a 6px row.
 *
 * Percentages are clamped to 45% a side, so padding can never consume the box
 * it is measured against.
 */
export type GanttLength = number | `${number}%`;

export interface GanttMetrics {
  /** Height of one stacking lane, px. */
  laneHeight: number;
  /**
   * Vertical padding between the row edge and the first/last lane.
   *
   * A percentage is measured against the **row height** — so it stays a
   * constant share of the row however tall the row becomes, and every row in a
   * uniform-height chart gets the same inset whatever its stack depth.
   */
  rowPaddingY: GanttLength;
  /**
   * Inset of the bar inside its lane.
   *
   * A percentage is measured against the **lane height** — the bar's own lane,
   * which in a uniform row is what the overlap cluster left it. So a bar that
   * collides with nothing is inset proportionally more than one squeezed into a
   * four-deep pile-up, rather than both losing the same fixed pixels.
   *
   * Capped at a quarter of the lane either way, so a compressed stack still
   * renders bars instead of collapsing into padding.
   */
  itemPaddingY: GanttLength;
  /** Rows never render shorter than this, px. */
  minRowHeight: number;
  /**
   * Give every row the same height instead of growing it with the stack.
   *
   * The shared height is the height a single-lane row would take, floored by
   * `minRowHeight` — `laneHeight + 2 * rowPaddingY` in pixels, or
   * `laneHeight / (1 - 2 * ratio)` when the padding is a percentage of the row
   * — and the row is divided per *overlap
   * cluster*, so a pile-up of four renders four thin bars while a bar that
   * collides with nothing keeps the full row height. A `group.height` override
   * still wins for that one row, with its clusters divided out of the override.
   */
  uniformRowHeight: boolean;
  /** Bars never render narrower than this, px (keeps short tasks clickable). */
  minItemWidth: number;
}

export interface StackingOptions {
  enabled: boolean;
  /**
   * Minimum time gap (ms) two tasks must have between them to share a lane.
   * Stacking is computed in data space so the layout stays stable under zoom.
   */
  minGap: number;
  /** Hard ceiling on lanes per row; beyond it tasks are packed into the last lane. */
  maxLanes: number;
  /** Render tasks of hidden descendants on their nearest visible ancestor row. */
  rollupCollapsed: boolean;
}

export interface VirtualizationOptions {
  /** Extra pixels rendered beyond each viewport edge, reduces churn while panning. */
  overscanPx: number;
  /** Extra rows rendered above/below the viewport. */
  overscanRows: number;
  /**
   * Safety valve: at most this many bars are handed to the renderer in one
   * frame. Overflow is reported on {@link VisibleWindow.truncated}.
   */
  maxVisibleItems: number;
}

export type WheelAction = "scroll" | "zoom" | "pan" | "none";

/** What a left-button drag starting on empty plot background does. */
export type BackgroundDragAction = "marquee" | "pan" | "none";

export interface InteractionOptions {
  selection: boolean;
  /** Allow multi-select via ctrl/meta and shift. */
  multiSelect: boolean;
  drag: boolean;
  /** Allow resizing via edge handles. */
  resize: boolean;
  /** Snap dragged/resized times to this many ms. 0 disables snapping. */
  snapMs: number;
  /**
   * Master switch for rubber-band (marquee) selection. When false, any
   * {@link backgroundDrag} entry resolving to `'marquee'` falls back to `'pan'`.
   */
  marquee: boolean;
  /**
   * A left-drag that starts *on a bar* draws a marquee instead of moving it.
   *
   * Off by default, where a press on a bar belongs to that bar and the marquee
   * can only be drawn from empty background. Turning it on makes the rubber band
   * reachable from anywhere in the plot, at the cost of the drag-to-move
   * gesture — set {@link drag} and {@link resize} to false alongside it, or a
   * bar becomes the one place the marquee cannot start.
   *
   * A press that never travels far enough to be a drag is still a click on that
   * bar: it selects it and emits `task:click`.
   *
   * Needs {@link marquee} and {@link selection}; without either, a press on a
   * bar behaves as it does with this off.
   */
  marqueeOnTasks: boolean;
  /**
   * A bar has to be selected before a drag can move it.
   *
   * On by default. A press on an *unselected* bar runs the background gesture
   * instead — a plain drag pans, a modifier drag rubber-bands, per
   * {@link backgroundDrag} — so a stray drag scrolls the chart rather than
   * rescheduling work nobody aimed at. Selecting the bar takes one click first,
   * which is exactly what the release of that same press does when it never
   * travelled far enough to be a drag.
   *
   * Resize handles are unaffected: grabbing a 6px edge is deliberate enough on
   * its own, and the cursor has already promised a resize.
   *
   * Set false for the pick-up-anything behaviour, where the press selects the
   * bar and carries it in one gesture.
   *
   * Gesture-level, like the rest of {@link InteractionOptions}: calling
   * `engine.drag.begin` directly is the consumer's own decision and is never
   * filtered by this.
   */
  dragSelectedOnly: boolean;
  /**
   * Gesture for a left-button drag on empty background, keyed by modifier.
   *
   * Resolved with the same precedence as {@link InteractionOptions.wheel}:
   * ctrl/meta, then shift, then alt, then plain. Swap `plain` and `shift` for
   * the drag-to-pan behaviour most map and design tools use.
   *
   * Note that ctrl/meta and alt still pick the marquee *mode* (add / remove)
   * when they resolve to `'marquee'`, so overriding them to `'pan'` also gives
   * up additive marquee selection.
   */
  backgroundDrag: {
    plain: BackgroundDragAction;
    ctrl: BackgroundDragAction;
    shift: BackgroundDragAction;
    alt: BackgroundDragAction;
  };
  wheel: {
    plain: WheelAction;
    ctrl: WheelAction;
    shift: WheelAction;
    alt: WheelAction;
  };
}

export interface GanttEngineOptions {
  metrics: GanttMetrics;
  stacking: StackingOptions;
  virtualization: VirtualizationOptions;
  interaction: InteractionOptions;
  /** Absolute bounds of the time domain. Derived from data when omitted. */
  timeDomain?: [number, number];
  /** Smallest and largest visible time span (ms) — the zoom limits. */
  minTimeSpan: number;
  maxTimeSpan: number;
}

export type GanttEngineConfig = DeepPartial<GanttEngineOptions>;

export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? (T[K] extends unknown[] ? T[K] : DeepPartial<T[K]>) : T[K];
};

/* ------------------------------------------------------------------ *
 * Viewport
 * ------------------------------------------------------------------ */

export interface ViewportState {
  /** Left edge of the visible time window, epoch ms. */
  timeStart: number;
  /** Right edge of the visible time window, epoch ms. */
  timeEnd: number;
  /** Vertical scroll offset in content px. */
  scrollTop: number;
  /** Plot area size in px (excludes the y-axis gutter and header). */
  width: number;
  height: number;
}

/* ------------------------------------------------------------------ *
 * Interaction state
 * ------------------------------------------------------------------ */

export type DragMode =
  /** Selection spans several rows: x-axis movement only. */
  | "horizontal"
  /** Selection is confined to one row: free x/y movement. */
  | "free"
  | "resize-start"
  | "resize-end";

export interface DragState {
  mode: DragMode;
  /** Task the gesture started on. */
  originTaskId: GanttId;
  /** Every task moving with the gesture (the selection at gesture start). */
  taskIds: readonly GanttId[];
  /** Pointer position where the gesture began, in plot px. */
  originPoint: Point;
  /** Current pointer position, in plot px. */
  currentPoint: Point;
  /** Time delta applied to the moving tasks, ms (already snapped). */
  deltaTime: number;
  /** Row delta applied to the moving tasks. Always 0 unless mode is `free`. */
  deltaRow: number;
  /** True once the pointer has moved beyond the drag threshold. */
  active: boolean;
}

/** A change proposal emitted when a drag or resize is committed. */
export interface TaskChange {
  id: GanttId;
  start: number;
  end: number;
  groupId: GanttId;
  previous: { start: number; end: number; groupId: GanttId };
}

/**
 * What a menu was opened on.
 *
 * `row-options` is the odd one out: it comes from a deliberate click on a
 * control (the row gutter's "more options" button) rather than a right-click, so
 * a view layer may draw it differently and fill it from a different item source.
 */
export type ContextMenuTargetKind = "task" | "row" | "axis" | "row-options" | "background";

export interface ContextMenuState<T = unknown, G = unknown> {
  kind: ContextMenuTargetKind;
  /** Viewport-relative position for the menu, px. */
  position: Point;
  task: GanttTask<T> | null;
  row: GanttRow<G> | null;
  /**
   * The control the menu belongs to, in *client* pixels, when it was opened from
   * one rather than from a pointer position. A view layer attaches the menu to
   * this box instead of guessing where the gesture happened.
   */
  anchor: Rect | null;
  /** Snapshot of the selection at the moment the menu opened. */
  selection: readonly GanttId[];
}

/* ------------------------------------------------------------------ *
 * Layout / virtualization results
 * ------------------------------------------------------------------ */

export interface LayoutResult<G = unknown> {
  rows: GanttRow<G>[];
  /** Row top offsets, content px. Parallel to `rows`. */
  rowY: Float64Array;
  rowHeight: Float64Array;
  totalHeight: number;
  /** Row index per task index; -1 when the task is not displayed. */
  taskRow: Int32Array;
  /** Stacking lane per task index. */
  taskLane: Int32Array;
  /**
   * Height of the lane each task is drawn in, px, per task index.
   *
   * Equal to {@link GanttMetrics.laneHeight} everywhere unless
   * {@link GanttMetrics.uniformRowHeight} is on, where it is the row's usable
   * height divided by the lanes the task's *overlap cluster* needs — so a bar
   * that overlaps nothing keeps the full row height.
   */
  taskLaneHeight: Float64Array;
  /** Rank of each task in visual order (row order, then start time). */
  taskRank: Int32Array;
  /** Task index per visual rank — the inverse of `taskRank`. */
  rankToTask: Int32Array;
  /** CSR offsets into {@link rankToTask}, one extra trailing entry. */
  rowOffsets: Int32Array;
  /** Running max of `end` within each row slice of {@link rankToTask}. */
  maxEndPrefix: Float64Array;
  revision: number;
}

/** One bar selected for rendering this frame. */
export interface VisibleItem<T = unknown> {
  taskIndex: number;
  task: GanttTask<T>;
  rowIndex: number;
  lane: number;
  /** Effective time span, including any in-flight drag offset. */
  start: number;
  end: number;
  /** Top edge in content px, including any in-flight drag offset. */
  y: number;
  height: number;
  /** Height of the lane this bar sits in — its height plus the bar insets. */
  laneHeight: number;
  selected: boolean;
  hovered: boolean;
  dragging: boolean;
}

export interface VisibleWindow<T = unknown, G = unknown> {
  items: VisibleItem<T>[];
  rows: GanttRow<G>[];
  /** First/last row index included, inclusive. -1/-2 when empty. */
  rowStart: number;
  rowEnd: number;
  timeStart: number;
  timeEnd: number;
  /** True when {@link VirtualizationOptions.maxVisibleItems} clipped the result. */
  truncated: boolean;
  /** Number of bars that intersected the viewport before truncation. */
  candidateCount: number;
  revision: number;
}

/* ------------------------------------------------------------------ *
 * Events
 * ------------------------------------------------------------------ */

export interface PointerModifiers {
  ctrl: boolean;
  shift: boolean;
  meta: boolean;
  alt: boolean;
}

export interface GanttEventMap<T = unknown, G = unknown> {
  "data:change": { taskCount: number; groupCount: number };
  "layout:change": LayoutResult<G>;
  "viewport:change": ViewportState;
  "selection:change": {
    selected: readonly GanttId[];
    added: readonly GanttId[];
    removed: readonly GanttId[];
  };
  "hover:change": { taskId: GanttId | null; rowIndex: number | null };
  "drag:start": DragState;
  "drag:move": DragState;
  "drag:end": { drag: DragState; changes: TaskChange[]; cancelled: boolean };
  "task:click": { task: GanttTask<T>; modifiers: PointerModifiers; position: Point };
  "task:dblclick": { task: GanttTask<T>; position: Point };
  "task:contextmenu": { task: GanttTask<T>; position: Point };
  "row:click": { row: GanttRow<G>; modifiers: PointerModifiers; position: Point };
  "row:dblclick": { row: GanttRow<G>; position: Point };
  "row:contextmenu": { row: GanttRow<G>; position: Point };
  "row:toggle": { row: GanttRow<G>; collapsed: boolean };
  "row:disable": { row: GanttRow<G>; disabled: boolean };
  "contextmenu:open": ContextMenuState<T, G>;
  "contextmenu:close": void;
  "options:change": GanttEngineOptions;
}
