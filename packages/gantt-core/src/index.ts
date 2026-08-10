/**
 * `@gantt-chart/core` — the framework- and renderer-agnostic Gantt engine.
 *
 * Nothing exported here touches the DOM, React or ECharts. Adapters consume
 * the pipeline output; the React package wires it to components.
 */

export { GanttEngine } from './GanttEngine';
export type { GanttEngineInit, HitTestResult } from './GanttEngine';

export { defaultOptions, resolveOptions, affectsLayout, MINUTE, HOUR, DAY, WEEK, YEAR } from './defaults';

export { normalize, emptyModel } from './data/dataModel';
export type { DataModel, NormalizeResult } from './data/dataModel';

export { resolveRows, applyDisabled } from './engine/rows';
export type { RowModel } from './engine/rows';

export {
  computeLayout,
  laneTop,
  barInset,
  resolveLength,
  rowIndexAt,
  nearestRowIndex,
  isRowDisabled,
  isTaskRowDisabled,
} from './engine/layout';
export { computeVisible, queryRect } from './engine/virtualize';
export type { VirtualizeInput } from './engine/virtualize';

export { SelectionEngine } from './engine/selection';
export type { SelectionMode } from './engine/selection';

export { DragEngine } from './engine/drag';
export type { DragBeginOptions, DragConstraint } from './engine/drag';

export { ViewportController } from './engine/viewport';
export { ContextMenuEngine } from './engine/contextMenu';
export type { OpenContextMenuInput } from './engine/contextMenu';

export { computeAxisRows, computeRowBands } from './engine/axis';
export type { AxisRowDescriptor, RowBand } from './engine/axis';

export type { EngineContext } from './engine/context';

export { RenderContextBuilder } from './render/renderContext';
export type {
  GanttRenderContext,
  GanttItemGeometry,
  GanttItemState,
  GanttRenderHelpers,
  RenderContextInput,
} from './render/renderContext';

export { Store, shallowEqual } from './store/store';
export type { StoreListener } from './store/store';
export { createInitialState, EMPTY_SELECTION } from './store/ganttState';
export type { GanttState } from './store/ganttState';

export { OverlayRegistry } from './plugins';
export type { GanttPlugin, OverlayRenderer, OverlayContext } from './plugins';

export { GanttHistory, applyChanges } from './history';
export type { HistoryEntry, HistoryOptions } from './history';

export { categorical } from './theme';
export type { GanttTheme, GanttThemeColors, GanttThemeMetrics, GanttThemeFont } from './theme';

export { Emitter } from './util/emitter';
export type { Unsubscribe } from './util/emitter';
export { LaneAllocator, MILESTONE_EPSILON } from './util/laneAllocator';
export { clamp, lowerBoundIndex, upperBoundIndex, nextPowerOfTwo } from './util/search';

export type * from './types';
