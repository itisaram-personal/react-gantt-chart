import { useEffect, useMemo, useRef, type CSSProperties, type ReactNode, type Ref } from 'react';
import {
  applyChanges,
  type AxisRowDescriptor,
  type ContextMenuState,
  type DeepPartial,
  type GanttEngine,
  type GanttEngineOptions,
  type GanttGroup,
  type GanttId,
  type GanttPlugin,
  type GanttRow,
  type GanttTask,
  type TaskChange,
  type ViewportState,
} from '@gantt-chart/core';
import {
  dependenciesPlugin,
  type GanttDependency,
  type GanttEChartsAdapter,
  type GanttItemRenderer,
} from '@gantt-chart/echarts';
import { resolveTheme, themeCssVariables, type GanttTheme } from '@gantt-chart/themes';
import { GanttContextMenu, type GanttMenuItem } from './GanttContextMenu';
import { GanttPlot } from './GanttPlot';
import { GanttRowGutter } from './GanttRowGutter';
import { GanttScrollbar } from './GanttScrollbar';
import { GanttTimeHeader } from './GanttTimeHeader';
import { GanttTooltip, type GanttTooltipContext } from './GanttTooltip';
import { GanttRowZoomBar, GanttTimeZoomBar } from './GanttZoomBar';
import { useGanttEngine } from './useGanttEngine';

export interface GanttChartProps<T = unknown, G = unknown> {
  tasks: readonly GanttTask<T>[];
  groups?: readonly GanttGroup<G>[];
  options?: DeepPartial<GanttEngineOptions>;
  theme?: GanttTheme | 'light' | 'dark';

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
  onSelectionChange?: (selected: GanttId[]) => void;
  onTaskClick?: (task: GanttTask<T>) => void;
  onTaskDoubleClick?: (task: GanttTask<T>) => void;
  onRowToggle?: (row: GanttRow<G>, collapsed: boolean) => void;
  onViewportChange?: (viewport: ViewportState) => void;

  itemRenderer?: GanttItemRenderer<T, G>;
  dependencies?: readonly GanttDependency[];
  plugins?: readonly GanttPlugin<T, G>[];

  contextMenuItems?: (state: ContextMenuState<T, G>, engine: GanttEngine<T, G>) => GanttMenuItem[];
  /** Custom tooltip body; `false` disables the tooltip. */
  tooltip?: ((context: GanttTooltipContext<T, G>) => ReactNode | null) | false;

  showHeader?: boolean;
  showRowGutter?: boolean;
  showScrollbar?: boolean;
  showGrid?: boolean;
  showRowBands?: boolean;
  /**
   * Horizontal zoom bar under the plot: an overview of the whole time domain
   * with the visible window drawn on it. Drag the window to pan, its handles to
   * zoom. Off by default — it adds a strip below the body.
   */
  showTimeZoomBar?: boolean;
  /**
   * Vertical zoom bar beside the plot. Drag the window to scroll, its handles to
   * scale row height so the selected rows fill the plot. Off by default.
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
  renderer?: 'canvas' | 'svg';

  /** Escape hatch to the engine, for undo stacks, exports, custom toolbars. */
  engineRef?: Ref<GanttEngine<T, G>>;
  /** Receives the ECharts adapter once attached, and `null` on teardown. */
  onAdapter?: (adapter: GanttEChartsAdapter<T, G> | null) => void;
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
    theme: themeInput = 'light',
    className,
    style,
    height = '100%',
    showHeader = true,
    showRowGutter = true,
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
    if (dependencyPlugin && props.dependencies) dependencyPlugin.setDependencies(props.dependencies);
  }, [dependencyPlugin, props.dependencies]);

  // Callbacks live in a ref so a parent re-render never re-subscribes the bus.
  const handlers = useRef(props);
  handlers.current = props;

  useEffect(() => {
    const offs = [
      engine.on('drag:end', ({ changes, cancelled }) => {
        if (cancelled || changes.length === 0) return;
        handlers.current.onChanges?.(changes);
        const onTasksChange = handlers.current.onTasksChange;
        if (onTasksChange) onTasksChange(applyChanges(engine.getTasks(), changes), changes);
        else engine.applyChanges(changes);
      }),
      engine.on('selection:change', ({ selected }) =>
        handlers.current.onSelectionChange?.(selected.slice()),
      ),
      engine.on('task:click', ({ task }) => handlers.current.onTaskClick?.(task)),
      engine.on('task:dblclick', ({ task }) => handlers.current.onTaskDoubleClick?.(task)),
      engine.on('row:toggle', ({ row, collapsed }) => handlers.current.onRowToggle?.(row, collapsed)),
      engine.on('viewport:change', (viewport) => handlers.current.onViewportChange?.(viewport)),
    ];
    return () => {
      for (const off of offs) off();
    };
  }, [engine]);

  // Support both object and callback refs without forwardRef generics.
  const engineRef = props.engineRef;
  useEffect(() => {
    if (!engineRef) return;
    if (typeof engineRef === 'function') {
      engineRef(engine);
      return () => engineRef(null);
    }
    (engineRef as { current: GanttEngine<T, G> | null }).current = engine;
    return () => {
      (engineRef as { current: GanttEngine<T, G> | null }).current = null;
    };
  }, [engine, engineRef]);

  const gutterWidth = showRowGutter ? (props.gutterWidth ?? theme.metrics.axisWidth) : 0;

  return (
    <div
      className={['gantt', theme.dark ? 'gantt--dark' : 'gantt--light', className].filter(Boolean).join(' ')}
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
            />
          )}
        </div>

        {showRowZoomBar ? <GanttRowZoomBar engine={engine} theme={theme} /> : null}
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
            <GanttTimeZoomBar engine={engine} theme={theme} />
          </div>
        </div>
      ) : null}

      <GanttContextMenu engine={engine} theme={theme} items={props.contextMenuItems} />
    </div>
  );
}
