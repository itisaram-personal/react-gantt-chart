/**
 * `@gantt-chart/echarts` — the ECharts renderer for the Gantt engine.
 *
 * The chart is a single `custom` series with `coordinateSystem: 'none'`: the
 * engine resolves every bar to plot pixels, and ECharts is used for what it is
 * good at — batching, diffing and painting thousands of elements. The plot has no
 * axis and no dataZoom, so pan/zoom has exactly one owner: the engine.
 *
 * The zoom bars *are* ECharts `dataZoom` sliders, but each on its own slider-only
 * chart, and each a controller and a view of the engine's viewport rather than a
 * second copy of it — see `zoomOption`.
 */

export { GanttEChartsAdapter } from './adapter';
export type { EChartsLike, GanttAdapterOptions } from './adapter';

export { createGanttChart } from './create';
export type { CreateGanttChartInput, EChartsModuleLike } from './create';

export { buildGanttOption } from './option';
export type { GanttOption, GanttOptionInput, GanttCustomSeries } from './option';

export {
  ZOOM_DENSITY_BUCKETS,
  buildRowZoomOption,
  buildTimeZoomOption,
  densitySeriesData,
  rowZoomLaneHeight,
  rowZoomScrollTop,
  rowZoomWindow,
  taskDensity,
  timeZoomRange,
  timeZoomWindow,
} from './zoomOption';
export type {
  GanttZoomAxis,
  GanttZoomOption,
  GanttZoomSeries,
  GanttZoomSlider,
  GanttZoomWindow,
  RowZoomLaneHeightInput,
  RowZoomOptionInput,
  RowZoomState,
  TimeZoomOptionInput,
} from './zoomOption';

export {
  downloadGanttPng,
  ganttToPngBlob,
  ganttToPngDataURL,
  planGanttExport,
  renderGanttToCanvas,
  resolveExportFrame,
} from './export';
export type {
  GanttDownloadInput,
  GanttExportFrame,
  GanttExportInput,
  GanttExportOptions,
  GanttExportPlan,
  GanttExportResult,
  GanttExportScope,
} from './export';

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
  labelZoomAction,
  labelZoomRung,
  parentUnit,
  unitLength,
} from './timeScale';
export type {
  FormatOptions,
  LabelZoomAction,
  LabelZoomInput,
  TimeBand,
  TimeBandInput,
  TimeHeaderModel,
  TimeScaleInput,
  TimeTick,
  TimeTickScale,
  TimeUnit,
  ZoomRung,
} from './timeScale';

export { dependenciesPlugin } from './plugins/dependencies';
export type {
  DependencyKind,
  DependencyPlugin,
  DependencyPluginOptions,
  GanttDependency,
} from './plugins/dependencies';
