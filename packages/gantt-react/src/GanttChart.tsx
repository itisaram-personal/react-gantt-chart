import { useEffect, useMemo, useRef, type CSSProperties, type ReactNode, type Ref } from "react";
import {
  applyChanges,
  defaultOptions,
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
  type GanttTimeMarker,
  type InteractionOptions,
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
   * Master switch for selecting bars. On by default.
   *
   * `false` closes every route into a selection: clicking a bar, ctrl/shift
   * clicking, the rubber band, ctrl+A, the arrow keys and the menu items that
   * select. Bars still hover, click (`onTaskClick` keeps firing), drag and
   * resize — they just never light up. Switching it off also clears whatever
   * was selected, since no gesture would be left to clear it.
   *
   * `engine.selection.set(...)` still works: an API call is the app's own
   * decision, not user input to be filtered.
   */
  enableSelection?: boolean;
  /**
   * Select by dragging a box over the plot. Off by default.
   *
   * Turns the left-drag into a rubber band that selects every bar it covers,
   * started from anywhere — empty background *or* a bar. Dragging a bar to move
   * or resize it is turned off in exchange, since one gesture cannot do both; a
   * click on a bar still selects it and fires `onTaskClick`.
   *
   * Modifiers work as they do for the background marquee: ctrl/meta adds to the
   * selection, alt removes from it. Ignored when `enableSelection` is `false`.
   *
   * This is the master switch for the band, so `false` is not merely "the plain
   * drag pans": no modifier draws a box either, where ctrl and shift otherwise
   * would. Leave it unset to keep whatever `options.interaction` says — which,
   * left alone, is the library default of ctrl/shift rubber-banding.
   */
  enableMarqueeSelection?: boolean;

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
   * A disabled row keeps its bars, faded, and by default ignores every
   * interaction with them — `options.interaction.disabledRows` decides that
   * part. Seed the state with `group.disabled`.
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
  /**
   * How long the pointer has to rest on a bar before its tooltip opens, ms.
   * Defaults to 1000; `0` opens on contact.
   *
   * The dwell is per bar and starts over on each one, so sweeping the pointer
   * across a row raises nothing. Moving to a second bar takes the first one's
   * tooltip down at once rather than leaving it up during the new wait, and
   * leaving the bar before the delay is up opens nothing at all.
   */
  tooltipOpenDelay?: number;

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
   * whole time domain, with a task-density overview behind the window. Draw a
   * band over the track, or drag the window's handles, to zoom to a range; the
   * strip along the edge of the track drags the window to pan. Off by default —
   * it adds a strip below the body.
   */
  showTimeZoomBar?: boolean;
  /**
   * Vertical `dataZoom` slider beside the plot. Draw a band over the track, or
   * drag the window's handles, to scale row height so those rows fill the plot;
   * the strip along the edge of the track drags the window to scroll. Off by
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

  /**
   * Vertical lines at fixed instants — releases, freezes, sprint boundaries —
   * drawn the full height of the plot under the bars, with an optional chip
   * naming each one above them.
   *
   * A "today" line is one of these rather than a feature of its own: pass
   * `{ time: Date.now(), color: theme.colors.todayLine }` (and refresh it on
   * whatever cadence your app wants the line to move).
   *
   * Chrome, not data: markers take no part in layout or hit-testing and never
   * take pointer input. Off-screen ones cost nothing, so the whole list can be
   * passed and left to the viewport to filter. Pass a stable reference
   * (`useMemo`) — a new array identity re-renders the plot.
   */
  markers?: readonly GanttTimeMarker[];
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
    locale,
    weekStartsOn,
    renderer,
    tooltip,
    tooltipInteractive = true,
    tooltipOpenDelay = 1000,
    enableSelection,
    enableMarqueeSelection,
  } = props;

  const theme = useMemo(() => resolveTheme(themeInput), [themeInput]);

  // The two selection props are sugar over `options.interaction`, and win over
  // it — they are the more specific statement. Left undefined they add nothing,
  // so `options` alone still configures a chart the way it always did.
  const engineOptions = useMemo(
    () => withSelectionProps(options, enableSelection, enableMarqueeSelection),
    [options, enableSelection, enableMarqueeSelection],
  );

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

  const engine = useGanttEngine<T, G>({ tasks, groups, options: engineOptions, plugins });

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
    markers: props.markers,
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
            markers={props.markers}
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
              openDelay={tooltipOpenDelay}
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
 * Fold the two selection props into the engine options they stand for.
 *
 * Both are sugar: `enableSelection` is `interaction.selection`, and
 * `enableMarqueeSelection` is the handful of settings that together make the
 * drag a rubber band — the band itself, its reach over bars, a plain background
 * drag that draws one, and the drag-to-move gesture it displaces.
 *
 * Undefined props change nothing, so a chart configured through `options` alone
 * is untouched. A prop that *is* set wins over `options`, being the more
 * specific statement of the same thing.
 */
function withSelectionProps(
  options: DeepPartial<GanttEngineOptions> | undefined,
  enableSelection: boolean | undefined,
  enableMarqueeSelection: boolean | undefined,
): DeepPartial<GanttEngineOptions> | undefined {
  if (enableSelection === undefined && enableMarqueeSelection === undefined) return options;

  const given = options?.interaction;
  const fallback = defaultOptions.interaction;
  const interaction: DeepPartial<InteractionOptions> = {};

  // "No selection in any way" outranks a request for the rubber band: a band
  // that could select nothing is worse than no band, so the drag stays a pan
  // and the bar-moving gesture is left alone.
  const marqueeSelects = enableSelection !== false && enableMarqueeSelection === true;

  if (enableSelection !== undefined) interaction.selection = enableSelection;

  if (enableMarqueeSelection !== undefined) {
    // Both states are spelled out rather than left to the merge: `setOptions`
    // layers over what the engine already holds, so switching the prop off has
    // to hand back what switching it on took away — the caller's own `options`
    // if they said, and the library default if they did not.
    interaction.marqueeOnTasks = marqueeSelects;
    // One gesture cannot both draw the band and carry the bar.
    interaction.drag = marqueeSelects ? false : (given?.drag ?? fallback.drag);
    interaction.resize = marqueeSelects ? false : (given?.resize ?? fallback.resize);
  }

  if (enableSelection === false) {
    interaction.marquee = false;
    interaction.marqueeOnTasks = false;
  } else if (enableMarqueeSelection !== undefined) {
    // The prop is the master switch for the band, not merely a mapping for the
    // plain drag: `false` means no box from any modifier, so ctrl and shift
    // drags pan rather than rubber-band.
    interaction.marquee = marqueeSelects;
  }

  const backgroundDrag =
    enableMarqueeSelection === undefined
      ? given?.backgroundDrag
      : {
          ...given?.backgroundDrag,
          plain: marqueeSelects
            ? ("marquee" as const)
            : (given?.backgroundDrag?.plain ?? fallback.backgroundDrag.plain),
        };

  return {
    ...options,
    interaction: {
      ...given,
      ...interaction,
      ...(backgroundDrag ? { backgroundDrag } : null),
    },
  };
}

/**
 * The engine's `drag:end` payload, plus the two things it does not carry.
 *
 * The drop time comes off the pointer's own x — the gesture's `deltaTime` is
 * snapped, the pointer is not. The row is resolved from the group the origin
 * task *ended up in*, not from what the pointer was over: a drop on an inert
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
