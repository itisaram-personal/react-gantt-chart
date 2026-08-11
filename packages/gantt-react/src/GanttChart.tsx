import { useEffect, useMemo, useRef, type CSSProperties, type ReactNode, type Ref } from "react";
import {
  applyChanges,
  type AxisRowDescriptor,
  type ContextMenuState,
  type DeepPartial,
  type DragMode,
  type DragState,
  type GanttEngine,
  type GanttEngineOptions,
  type GanttGroup,
  type GanttId,
  type GanttPlugin,
  type GanttRow,
  type GanttTask,
  type Point,
  type TaskChange,
  type ViewportState,
} from "@gantt-chart/core";
import {
  dependenciesPlugin,
  type GanttDependency,
  type GanttEChartsAdapter,
  type GanttExportOptions,
  type GanttItemRenderer,
} from "@gantt-chart/echarts";
import { resolveTheme, themeCssVariables, type GanttTheme } from "@gantt-chart/themes";
import { GanttContextMenu, type GanttMenuItem } from "./GanttContextMenu";
import { GanttPlot } from "./GanttPlot";
import { GanttRowGutter } from "./GanttRowGutter";
import { GanttScrollbar } from "./GanttScrollbar";
import { GanttTimeHeader } from "./GanttTimeHeader";
import { GanttTooltip, type GanttTooltipContext } from "./GanttTooltip";
import { GanttRowZoomBar, GanttTimeZoomBar } from "./GanttZoomBar";
import { useGanttEngine } from "./useGanttEngine";
import { useGanttExport, type GanttExportApi } from "./useGanttExport";

/**
 * What a finished drag or resize did — the gesture, not the data.
 *
 * `changes` is the same list `onChanges` receives, so the tasks and their new
 * values are here too; the rest is what only the gesture knows: where the
 * pointer let go, and what it let go over.
 */
export interface GanttDragEndEvent<T = unknown, G = unknown> {
  /**
   * The tasks the gesture moved, in the same order as {@link changes} and
   * holding the values they had *before* it: this fires before the changes are
   * applied, and `changes[i]` carries the new start, end and group for
   * `tasks[i]` (with the old ones in its `previous`).
   *
   * Empty for a gesture that changed nothing, and for a cancelled one.
   */
  tasks: GanttTask<T>[];
  /** Proposed edits, each with the values it started from in `previous`. */
  changes: TaskChange[];
  /** Move, or which resize handle was dragged. */
  mode: DragMode;
  /** Where the pointer was let go, in plot pixels. */
  point: Point;
  /** The time under that point — the drop time, before any snapping. */
  time: number;
  /**
   * The row the tasks landed on, and its group.
   *
   * Where they *landed*, which is not always what the pointer was over: a drop
   * on a disabled row leaves the tasks where they were, and this reports that
   * row. A gesture that changed nothing — a resize, a cancel, a move that came
   * back to where it started — reports the row it began on. Null only when the
   * origin task is gone, or is drawn on no row at all.
   *
   * One row, not one per task: a selection spanning several rows moves
   * horizontally only, so this is the row the gesture started on and each task's
   * own group is in its change.
   */
  row: GanttRow<G> | null;
  group: GanttGroup<G> | null;
  /** Rows travelled — 0 for a resize, or a move that spanned several rows. */
  deltaRow: number;
  /** Time travelled, after snapping. */
  deltaTime: number;
  /** The gesture was aborted rather than dropped; `changes` is then empty. */
  cancelled: boolean;
}

export interface GanttChartProps<T = unknown, G = unknown> {
  tasks: readonly GanttTask<T>[];
  groups?: readonly GanttGroup<G>[];
  options?: DeepPartial<GanttEngineOptions>;
  theme?: GanttTheme | "light" | "dark";

  className?: string;
  style?: CSSProperties;
  /** Height of the whole widget. Defaults to filling its parent. */
  height?: number | string;

  /**
   * Accept edits. When provided the component is *controlled*: it never mutates
   * the data itself, and the caller is expected to render the returned array.
   * Without it, edits are applied to the engine's own copy.
   */
  onTasksChange?: (tasks: GanttTask<T>[], changes: TaskChange[]) => void;
  /** Every committed drag/resize, whether controlled or not. */
  onChanges?: (changes: TaskChange[]) => void;
  /**
   * A drag or resize finished: which tasks moved, where the pointer let go, and
   * the row and group they landed on. See {@link GanttDragEndEvent}.
   *
   * Called before the changes are applied — and before `onChanges` and
   * `onTasksChange` — so it reports the gesture rather than its result. A
   * cancelled gesture is reported too, with `cancelled: true` and no changes,
   * which is the signal to tear down anything a `drag:start` put up.
   */
  onDragEnd?: (event: GanttDragEndEvent<T, G>) => void;
  onSelectionChange?: (selected: GanttId[]) => void;
  onTaskClick?: (task: GanttTask<T>) => void;
  onTaskDoubleClick?: (task: GanttTask<T>) => void;
  onRowToggle?: (row: GanttRow<G>, collapsed: boolean) => void;
  /**
   * A row was enabled or disabled from the gutter button (or from the engine).
   * A disabled row keeps its bars but ignores every interaction with them; seed
   * the state with `group.disabled`.
   */
  onRowDisabledChange?: (row: GanttRow<G>, disabled: boolean) => void;
  onViewportChange?: (viewport: ViewportState) => void;

  itemRenderer?: GanttItemRenderer<T, G>;
  dependencies?: readonly GanttDependency[];
  plugins?: readonly GanttPlugin<T, G>[];

  contextMenuItems?: (state: ContextMenuState<T, G>, engine: GanttEngine<T, G>) => GanttMenuItem[];
  /**
   * Items for the row gutter's "more options" (⋯) button, which appears on a
   * row when it is hovered or the button is focused.
   *
   * Separate from `contextMenuItems`, so the button and a right-click can offer
   * different things. Returning an empty array leaves that row without a button
   * at all, which is how a subset of rows gets one. Called once per visible row
   * while rendering the gutter, so keep it cheap and side-effect free.
   *
   * Omit it for a row-scoped default set: collapse/expand, select the row's
   * tasks, zoom to the row's time span.
   */
  rowMenuItems?: (row: GanttRow<G>, engine: GanttEngine<T, G>) => GanttMenuItem[];
  /** Custom tooltip body; `false` disables the tooltip. */
  tooltip?: ((context: GanttTooltipContext<T, G>) => ReactNode | null) | false;
  /**
   * Let the pointer into the tooltip, so its content can be hovered, selected
   * and clicked — the only way a link or a button in a custom body is reachable.
   * The tooltip stays up while the pointer is inside it, and the wheel is passed
   * through to the plot underneath so scrolling and zooming still work over it.
   *
   * On by default. Pass `false` for a tooltip that is only a label and never
   * stands between the pointer and a bar.
   */
  tooltipInteractive?: boolean;

  showHeader?: boolean;
  showRowGutter?: boolean;
  /** The gutter's per-row "more options" button. On by default. */
  showRowMenu?: boolean;
  /**
   * The gutter's per-row enable/disable button, drawn right after the label. On
   * by default; pass `false` for a chart where rows cannot be switched off from
   * the UI (`engine.setRowDisabled` still works).
   */
  showRowEnableToggle?: boolean;
  showScrollbar?: boolean;
  showGrid?: boolean;
  showRowBands?: boolean;
  /**
   * Horizontal zoom bar under the plot: an ECharts `dataZoom` slider over the
   * whole time domain, with a task-density overview behind the window. Drag the
   * window to pan, its handles to zoom. Off by default — it adds a strip below
   * the body.
   */
  showTimeZoomBar?: boolean;
  /**
   * Vertical `dataZoom` slider beside the plot. Drag the window to scroll, its
   * handles to scale row height so the selected rows fill the plot. Off by
   * default.
   */
  showRowZoomBar?: boolean;
  /**
   * Clicking a time-header label zooms to the period it names, ctrl/cmd-click
   * zooms back out. The granularity follows what is on screen: a multi-year view
   * zooms to a year, under a year to a quarter, under three months to a month,
   * under a month to a week, and under a week to a day.
   *
   * On by default. Pass `false` for a header that is only a scale.
   */
  interactiveLabels?: boolean;
  /** Overrides the theme's `axisWidth`. */
  gutterWidth?: number;
  headerCorner?: ReactNode;
  renderRow?: (row: AxisRowDescriptor<G>) => ReactNode;

  /** Epoch ms for the "now" marker. `null` hides it; omit for the live clock. */
  now?: number | null;
  locale?: string;
  weekStartsOn?: 0 | 1;
  renderer?: "canvas" | "svg";

  /** Escape hatch to the engine, for undo stacks, exports, custom toolbars. */
  engineRef?: Ref<GanttEngine<T, G>>;
  /** Receives the ECharts adapter once attached, and `null` on teardown. */
  onAdapter?: (adapter: GanttEChartsAdapter<T, G> | null) => void;
  /**
   * Receives a PNG exporter for this chart — `toCanvas`, `toDataURL`, `toBlob`
   * and `download`, each taking a scope (`'viewport'` or `'full'`), a size and a
   * pixel ratio.
   *
   * The exporter renders its own chart rather than screenshotting this one, so a
   * `'full'` export can be a different size and time window than the live view
   * without moving it. Defaults follow this component's chrome props, so an
   * export matches the widget unless a call says otherwise.
   */
  exportRef?: Ref<GanttExportApi>;
  /** Defaults for every `exportRef` call. */
  exportOptions?: GanttExportOptions;
}

/**
 * The Gantt chart.
 *
 * Composition, not a monolith: the engine owns state and geometry, the ECharts
 * adapter paints the plot, and the header, row gutter, scrollbar, tooltip and
 * menu are ordinary DOM driven by the same store. Every piece is exported
 * separately, so an app that wants a different shell can keep the engine and
 * replace the chrome.
 */
export function GanttChart<T = unknown, G = unknown>(props: GanttChartProps<T, G>): JSX.Element {
  const {
    tasks,
    groups,
    options,
    theme: themeInput = "light",
    className,
    style,
    height = "100%",
    showHeader = true,
    showRowGutter = true,
    showRowMenu = true,
    showRowEnableToggle = true,
    showScrollbar = true,
    showGrid,
    showRowBands,
    showTimeZoomBar = false,
    showRowZoomBar = false,
    interactiveLabels = true,
    now,
    locale,
    weekStartsOn,
    renderer,
    tooltip,
    tooltipInteractive = true,
  } = props;

  const theme = useMemo(() => resolveTheme(themeInput), [themeInput]);

  // Dependencies are drawn by a plugin, created once and updated in place.
  const dependencyPlugin = useMemo(
    () => (props.dependencies ? dependenciesPlugin<T, G>({ theme }) : null),
    // The plugin instance must outlive theme changes; `setTheme` handles those.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [Boolean(props.dependencies)],
  );

  const plugins = useMemo(() => {
    const list: GanttPlugin<T, G>[] = [];
    if (dependencyPlugin) list.push(dependencyPlugin);
    if (props.plugins) list.push(...props.plugins);
    return list;
  }, [dependencyPlugin, props.plugins]);

  const engine = useGanttEngine<T, G>({ tasks, groups, options, plugins });

  useEffect(() => {
    dependencyPlugin?.setTheme(theme);
  }, [dependencyPlugin, theme]);

  useEffect(() => {
    if (dependencyPlugin && props.dependencies)
      dependencyPlugin.setDependencies(props.dependencies);
  }, [dependencyPlugin, props.dependencies]);

  // Callbacks live in a ref so a parent re-render never re-subscribes the bus.
  const handlers = useRef(props);
  handlers.current = props;

  useEffect(() => {
    const offs = [
      engine.on("drag:end", ({ drag, changes, cancelled }) => {
        const onDragEnd = handlers.current.onDragEnd;
        if (onDragEnd) onDragEnd(dragEndEvent(engine, drag, changes, cancelled));
        if (cancelled || changes.length === 0) return;
        handlers.current.onChanges?.(changes);
        const onTasksChange = handlers.current.onTasksChange;
        if (onTasksChange) onTasksChange(applyChanges(engine.getTasks(), changes), changes);
        else engine.applyChanges(changes);
      }),
      engine.on("selection:change", ({ selected }) =>
        handlers.current.onSelectionChange?.(selected.slice()),
      ),
      engine.on("task:click", ({ task }) => handlers.current.onTaskClick?.(task)),
      engine.on("task:dblclick", ({ task }) => handlers.current.onTaskDoubleClick?.(task)),
      engine.on("row:toggle", ({ row, collapsed }) =>
        handlers.current.onRowToggle?.(row, collapsed),
      ),
      engine.on("row:disable", ({ row, disabled }) =>
        handlers.current.onRowDisabledChange?.(row, disabled),
      ),
      engine.on("viewport:change", (viewport) => handlers.current.onViewportChange?.(viewport)),
    ];
    return () => {
      for (const off of offs) off();
    };
  }, [engine]);

  // Support both object and callback refs without forwardRef generics.
  const engineRef = props.engineRef;
  useEffect(() => {
    if (!engineRef) return;
    if (typeof engineRef === "function") {
      engineRef(engine);
      return () => engineRef(null);
    }
    (engineRef as { current: GanttEngine<T, G> | null }).current = engine;
    return () => {
      (engineRef as { current: GanttEngine<T, G> | null }).current = null;
    };
  }, [engine, engineRef]);

  const gutterWidth = showRowGutter ? (props.gutterWidth ?? theme.metrics.axisWidth) : 0;

  /**
   * Export defaults that mirror what this component renders — same chrome, same
   * gutter width, same grid — so a saved PNG looks like the widget it came from.
   * `exportOptions`, and any per-call argument, override them.
   */
  const exportDefaults = useMemo<GanttExportOptions>(
    () => ({
      showHeader,
      showRowGutter,
      gutterWidth,
      showGrid,
      showRowBands,
      ...props.exportOptions,
    }),
    [showHeader, showRowGutter, gutterWidth, showGrid, showRowBands, props.exportOptions],
  );

  const exporter = useGanttExport<T, G>({
    engine,
    theme,
    itemRenderer: props.itemRenderer,
    locale,
    weekStartsOn,
    now,
    defaults: exportDefaults,
  });

  // Handed over the same way as `engineRef`, supporting object and callback refs.
  const exportRef = props.exportRef;
  useEffect(() => {
    if (!exportRef) return;
    if (typeof exportRef === "function") {
      exportRef(exporter);
      return () => exportRef(null);
    }
    (exportRef as { current: GanttExportApi | null }).current = exporter;
    return () => {
      (exportRef as { current: GanttExportApi | null }).current = null;
    };
  }, [exporter, exportRef]);

  return (
    <div
      className={["gantt", theme.dark ? "gantt--dark" : "gantt--light", className]
        .filter(Boolean)
        .join(" ")}
      style={{
        ...(themeCssVariables(theme) as unknown as CSSProperties),
        height,
        background: theme.colors.background,
        color: theme.colors.text,
        borderColor: theme.colors.border,
        ...style,
      }}
    >
      {showHeader ? (
        <div className="gantt__header-row" style={{ height: theme.metrics.headerHeight }}>
          {showRowGutter ? (
            <div
              className="gantt__corner"
              style={{ width: gutterWidth, borderRightColor: theme.colors.border }}
            >
              {props.headerCorner ?? null}
            </div>
          ) : null}
          <div className="gantt__header-scale">
            <GanttTimeHeader
              engine={engine}
              theme={theme}
              locale={locale}
              weekStartsOn={weekStartsOn}
              interactiveLabels={interactiveLabels}
            />
          </div>
        </div>
      ) : null}

      <div className="gantt__body">
        {showRowGutter ? (
          <GanttRowGutter
            engine={engine}
            theme={theme}
            width={gutterWidth}
            renderRow={props.renderRow}
            showRowMenu={showRowMenu}
            showRowEnableToggle={showRowEnableToggle}
            rowMenuItems={props.rowMenuItems}
          />
        ) : null}

        <div className="gantt__plot-wrap">
          <GanttPlot
            engine={engine}
            theme={theme}
            itemRenderer={props.itemRenderer}
            now={now}
            locale={locale}
            weekStartsOn={weekStartsOn}
            renderer={renderer}
            showGrid={showGrid}
            showRowBands={showRowBands}
            onAdapter={props.onAdapter}
          />
          {tooltip === false ? null : (
            <GanttTooltip
              engine={engine}
              theme={theme}
              locale={locale}
              render={tooltip ?? undefined}
              interactive={tooltipInteractive}
            />
          )}
        </div>

        {showRowZoomBar ? (
          <GanttRowZoomBar engine={engine} theme={theme} renderer={renderer} />
        ) : null}
        {showScrollbar ? <GanttScrollbar engine={engine} theme={theme} /> : null}
      </div>

      {showTimeZoomBar ? (
        <div className="gantt__zoom-row">
          {showRowGutter ? (
            <div
              className="gantt__zoom-corner"
              style={{ width: gutterWidth, borderRightColor: theme.colors.border }}
            />
          ) : null}
          {/*
            Deliberately not pixel-aligned with the plot's right edge: the bar
            spans the whole *domain*, not the visible window, so it is an
            overview rather than a second time axis to keep in register.
          */}
          <div className="gantt__zoom-scale">
            <GanttTimeZoomBar engine={engine} theme={theme} renderer={renderer} />
          </div>
        </div>
      ) : null}

      <GanttContextMenu
        engine={engine}
        theme={theme}
        items={props.contextMenuItems}
        rowItems={props.rowMenuItems}
      />
    </div>
  );
}

/**
 * The engine's `drag:end` payload, plus the two things it does not carry.
 *
 * The drop time comes off the pointer's own x — the gesture's `deltaTime` is
 * snapped, the pointer is not. The row is resolved from the group the origin
 * task *ended up in*, not from what the pointer was over: a drop on a disabled
 * row leaves the tasks where they were, and the report has to say so.
 */
function dragEndEvent<T, G>(
  engine: GanttEngine<T, G>,
  drag: DragState,
  changes: TaskChange[],
  cancelled: boolean,
): GanttDragEndEvent<T, G> {
  const tasks: GanttTask<T>[] = [];
  for (const change of changes) {
    const task = engine.getTask(change.id);
    if (task) tasks.push(task);
  }

  // A gesture that changed nothing still landed somewhere: the row it began on.
  const landed = changes.find((change) => change.id === drag.originTaskId) ?? changes[0];
  const groupId = landed ? landed.groupId : engine.getTask(drag.originTaskId)?.groupId;
  const row = groupId === undefined ? null : engine.getRow(groupId);

  return {
    tasks,
    changes,
    mode: drag.mode,
    point: drag.currentPoint,
    time: engine.viewport.pxToTime(drag.currentPoint.x),
    row,
    group: row ? row.group : null,
    deltaRow: drag.deltaRow,
    deltaTime: drag.deltaTime,
    cancelled,
  };
}
