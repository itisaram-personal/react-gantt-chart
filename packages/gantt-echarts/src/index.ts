/**
 * `@gantt-chart/echarts` — the ECharts renderer for the Gantt engine.
 *
 * The chart is a single `custom` series with `coordinateSystem: 'none'`: the
 * engine resolves every bar to plot pixels, and ECharts is used for what it is
 * good at — batching, diffing and painting thousands of elements. There is no
 * axis or dataZoom component, so pan/zoom has exactly one owner (the engine).
 */

export { GanttEChartsAdapter } from './adapter';
export type { EChartsLike, GanttAdapterOptions } from './adapter';

export { createGanttChart } from './create';
export type { CreateGanttChartInput, EChartsModuleLike } from './create';

export { buildGanttOption } from './option';
export type { GanttOption, GanttOptionInput, GanttCustomSeries } from './option';

export { defaultItemRenderer, taskLabel, taskColor } from './itemRenderer';
export type { GanttItemRenderer, DefaultTaskMeta } from './itemRenderer';

export { fontShorthand, group } from './elements';
export type { GanttElement, GanttElementStyle } from './elements';

export {
  addUnits,
  chooseStep,
  computeTimeBands,
  computeTimeHeader,
  computeTimeTicks,
  floorTo,
  formatTime,
  isoWeek,
  parentUnit,
  unitLength,
} from './timeScale';
export type {
  FormatOptions,
  TimeBand,
  TimeBandInput,
  TimeHeaderModel,
  TimeScaleInput,
  TimeTick,
  TimeTickScale,
  TimeUnit,
} from './timeScale';

export { dependenciesPlugin } from './plugins/dependencies';
export type {
  DependencyKind,
  DependencyPlugin,
  DependencyPluginOptions,
  GanttDependency,
} from './plugins/dependencies';
