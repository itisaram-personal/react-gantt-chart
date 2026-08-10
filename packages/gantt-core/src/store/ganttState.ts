import type { ContextMenuState, DragState, GanttId, Rect, ViewportState } from '../types';

export interface GanttState<T = unknown, G = unknown> {
  selection: ReadonlySet<GanttId>;
  /** Pivot for shift-range selection. */
  selectionAnchor: GanttId | null;
  hoveredTaskId: GanttId | null;
  hoveredRowIndex: number | null;
  drag: DragState | null;
  /** Rubber-band rectangle in plot pixels while marquee-selecting. */
  marquee: Rect | null;
  viewport: ViewportState;
  contextMenu: ContextMenuState<T, G> | null;
  collapsed: ReadonlySet<GanttId>;
  /**
   * Ids of the groups whose rows ignore input. Geometry is unaffected, so this
   * lives outside the layout inputs and never bumps `layoutRevision`.
   */
  disabled: ReadonlySet<GanttId>;
  /** Bumped whenever tasks/groups are replaced. */
  dataRevision: number;
  /** Bumped whenever layout inputs change (data, collapse, metrics). */
  layoutRevision: number;
}

export const EMPTY_SELECTION: ReadonlySet<GanttId> = new Set<GanttId>();

export function createInitialState<T, G>(viewport: ViewportState): GanttState<T, G> {
  return {
    selection: EMPTY_SELECTION,
    selectionAnchor: null,
    hoveredTaskId: null,
    hoveredRowIndex: null,
    drag: null,
    marquee: null,
    viewport,
    contextMenu: null,
    collapsed: new Set<GanttId>(),
    disabled: new Set<GanttId>(),
    dataRevision: 0,
    layoutRevision: 0,
  };
}
