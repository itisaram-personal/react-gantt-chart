/**
 * `@gantt-chart/react` — React bindings for the Gantt engine.
 *
 * `GanttChart` is the assembled widget. Every part it is made of is exported
 * too, so an application can keep the engine and the ECharts plot while
 * replacing the header, the gutter or the menus with its own components.
 *
 * Import the stylesheet once: `import '@gantt-chart/react/styles.css'`.
 */

export { GanttChart } from './GanttChart';
export type { GanttChartProps } from './GanttChart';

export { GanttPlot } from './GanttPlot';
export type { GanttPlotProps } from './GanttPlot';

export { GanttTimeHeader } from './GanttTimeHeader';
export type { GanttTimeHeaderProps } from './GanttTimeHeader';

export { GanttRowGutter } from './GanttRowGutter';
export type { GanttRowGutterProps } from './GanttRowGutter';

export { GanttScrollbar } from './GanttScrollbar';
export type { GanttScrollbarProps } from './GanttScrollbar';

export { GanttTooltip } from './GanttTooltip';
export type { GanttTooltipProps, GanttTooltipContext } from './GanttTooltip';

export { GanttContextMenu } from './GanttContextMenu';
export type { GanttContextMenuProps, GanttMenuItem } from './GanttContextMenu';

export { useGanttEngine } from './useGanttEngine';
export type { UseGanttEngineInput } from './useGanttEngine';

export { useEngineState, useEngineVersion } from './useEngineState';
export { useElementSize } from './useResizeObserver';
export type { Size } from './useResizeObserver';
export { useNativeWheel } from './useNativeWheel';

// Re-exported so a consuming app needs one dependency for the common case.
export type {
  DragConstraint,
  GanttEngine,
  GanttGroup,
  GanttId,
  GanttPlugin,
  GanttRow,
  GanttTask,
  TaskChange,
  ViewportState,
} from '@gantt-chart/core';
export { GanttHistory } from '@gantt-chart/core';
export type { GanttDependency, GanttItemRenderer } from '@gantt-chart/echarts';
export { createTheme, darkTheme, lightTheme, resolveTheme } from '@gantt-chart/themes';
export type { GanttTheme } from '@gantt-chart/themes';
