import type { DataModel } from '../data/dataModel';
import type { GanttState } from '../store/ganttState';
import type { Store } from '../store/store';
import type { Emitter } from '../util/emitter';
import type { GanttEngineOptions, GanttEventMap, LayoutResult } from '../types';

/**
 * Everything the interaction engines are allowed to touch.
 *
 * They read derived data through getters (so they always observe the current
 * layout without holding a stale reference) and write only through the store —
 * which is what keeps the "interaction → state → render" direction one-way.
 */
export interface EngineContext<T = unknown, G = unknown> {
  readonly store: Store<GanttState<T, G>>;
  readonly events: Emitter<GanttEventMap<T, G>>;
  getModel(): DataModel<T, G>;
  getLayout(): LayoutResult<G>;
  getOptions(): GanttEngineOptions;
  /** Scrollable time bounds — `options.timeDomain` or the data extent. */
  getDomain(): readonly [number, number];
}
