import type { DataModel } from '../data/dataModel';
import type { GanttId, GanttRow } from '../types';

export interface RowModel<G = unknown> {
  rows: GanttRow<G>[];
  /**
   * Row index each group's tasks render on.
   *
   * For a visible group that is its own row. For a group hidden behind a
   * collapsed ancestor it is the nearest visible ancestor's row when rollup is
   * enabled, and -1 otherwise (the tasks are then not displayed at all).
   */
  groupToRow: Int32Array;
}

/**
 * Flattens the group tree into the visible row list, honouring collapse state.
 *
 * Iterative DFS: a 100 000-node group tree would blow the call stack.
 */
export function resolveRows<T, G>(
  model: DataModel<T, G>,
  collapsed: ReadonlySet<GanttId>,
  rollupCollapsed: boolean,
): RowModel<G> {
  const groupCount = model.groups.length;
  const groupToRow = new Int32Array(groupCount).fill(-1);
  const rows: GanttRow<G>[] = [];

  // [groupIndex, depth, ancestorRow] — ancestorRow is -1 while nothing above is
  // collapsed, otherwise the row that hidden descendants roll up onto.
  const stack: number[] = [];
  for (let i = model.roots.length - 1; i >= 0; i--) {
    stack.push(model.roots[i], 0, -1);
  }

  while (stack.length > 0) {
    const ancestorRow = stack.pop() as number;
    const depth = stack.pop() as number;
    const groupIndex = stack.pop() as number;

    const group = model.groups[groupIndex];
    const children = model.groupChildren[groupIndex];
    const hasChildren = children.length > 0;
    const isCollapsed = collapsed.has(group.id);
    const hidden = ancestorRow !== -1;

    let ownRow = -1;
    if (!hidden) {
      ownRow = rows.length;
      rows.push({
        index: ownRow,
        group,
        groupIndex,
        depth,
        y: 0,
        height: 0,
        laneCount: 1,
        laneHeight: 0,
        laneOffset: 0,
        hasChildren,
        collapsed: isCollapsed,
      });
      groupToRow[groupIndex] = ownRow;
    } else {
      groupToRow[groupIndex] = rollupCollapsed ? ancestorRow : -1;
    }

    if (!hasChildren) continue;

    // Descendants are hidden once this node — or something above it — collapses.
    const childAncestorRow = hidden ? ancestorRow : isCollapsed ? ownRow : -1;
    for (let i = children.length - 1; i >= 0; i--) {
      stack.push(children[i], depth + 1, childAncestorRow);
    }
  }

  return { rows, groupToRow };
}
