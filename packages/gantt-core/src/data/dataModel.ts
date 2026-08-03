import type { GanttGroup, GanttId, GanttTask } from '../types';

/**
 * Normalized, render-ready view of the consumer's data.
 *
 * Hot fields (start, end, group index) live in typed arrays rather than on the
 * task objects. At 100 000 tasks this is the difference between the stacking
 * and virtualization passes touching one contiguous buffer and chasing 100 000
 * pointers through the heap; the original objects are kept alongside and handed
 * back untouched to the render callback.
 */
export interface DataModel<T = unknown, G = unknown> {
  readonly tasks: readonly GanttTask<T>[];
  readonly groups: readonly GanttGroup<G>[];
  /** Start time per task index. */
  readonly starts: Float64Array;
  /** End time per task index (always `>= starts[i]`). */
  readonly ends: Float64Array;
  /** Group index per task index. */
  readonly taskGroup: Int32Array;
  readonly taskIndexById: ReadonlyMap<GanttId, number>;
  readonly groupIndexById: ReadonlyMap<GanttId, number>;
  /** Children per group index, in input order. Empty arrays are shared. */
  readonly groupChildren: readonly number[][];
  /** Parent group index per group index, -1 for roots. */
  readonly groupParent: Int32Array;
  /** Root group indices in input order. */
  readonly roots: readonly number[];
  /** Min start / max end across all tasks. */
  readonly domain: readonly [number, number];
  readonly revision: number;
}

const NO_CHILDREN: number[] = [];

export interface NormalizeResult<T, G> {
  model: DataModel<T, G>;
  /** Non-fatal problems found in the input, for developer diagnostics. */
  warnings: string[];
}

export function normalize<T, G>(
  tasks: readonly GanttTask<T>[],
  groups: readonly GanttGroup<G>[] | undefined,
  revision: number,
): NormalizeResult<T, G> {
  const warnings: string[] = [];

  const groupList: GanttGroup<G>[] = groups ? groups.slice() : [];
  const groupIndexById = new Map<GanttId, number>();
  for (let i = 0; i < groupList.length; i++) {
    const group = groupList[i];
    if (groupIndexById.has(group.id)) {
      warnings.push(`Duplicate group id "${String(group.id)}" — the later definition is ignored.`);
      continue;
    }
    groupIndexById.set(group.id, i);
  }

  const count = tasks.length;
  const starts = new Float64Array(count);
  const ends = new Float64Array(count);
  const taskGroup = new Int32Array(count);
  const taskIndexById = new Map<GanttId, number>();

  let min = Infinity;
  let max = -Infinity;

  for (let i = 0; i < count; i++) {
    const task = tasks[i];

    if (taskIndexById.has(task.id)) {
      warnings.push(`Duplicate task id "${String(task.id)}" — hit-testing will resolve to the first one.`);
    } else {
      taskIndexById.set(task.id, i);
    }

    let start = +task.start;
    let end = +task.end;
    if (!Number.isFinite(start) || !Number.isFinite(end)) {
      warnings.push(`Task "${String(task.id)}" has a non-finite start/end and is collapsed to zero length.`);
      start = Number.isFinite(start) ? start : 0;
      end = start;
    }
    if (end < start) {
      // Tolerate reversed ranges rather than dropping the bar.
      const swap = start;
      start = end;
      end = swap;
    }

    starts[i] = start;
    ends[i] = end;
    if (start < min) min = start;
    if (end > max) max = end;

    let groupIndex = groupIndexById.get(task.groupId);
    if (groupIndex === undefined) {
      groupIndex = groupList.length;
      groupIndexById.set(task.groupId, groupIndex);
      groupList.push({ id: task.groupId, label: String(task.groupId) } as GanttGroup<G>);
    }
    taskGroup[i] = groupIndex;
  }

  if (min === Infinity) {
    min = 0;
    max = 0;
  }

  // Group tree.
  const groupCount = groupList.length;
  const groupParent = new Int32Array(groupCount).fill(-1);
  const groupChildren: number[][] = new Array(groupCount);
  const roots: number[] = [];

  for (let i = 0; i < groupCount; i++) groupChildren[i] = NO_CHILDREN;

  for (let i = 0; i < groupCount; i++) {
    const parentId = groupList[i].parentId;
    if (parentId === undefined || parentId === null) {
      roots.push(i);
      continue;
    }
    const parentIndex = groupIndexById.get(parentId);
    if (parentIndex === undefined || parentIndex === i) {
      warnings.push(`Group "${String(groupList[i].id)}" references a missing parent — treated as a root.`);
      roots.push(i);
      continue;
    }
    groupParent[i] = parentIndex;
    if (groupChildren[parentIndex] === NO_CHILDREN) groupChildren[parentIndex] = [];
    groupChildren[parentIndex].push(i);
  }

  // A parent cycle would make the DFS below diverge; break it at the deepest
  // offending node and report it.
  for (let i = 0; i < groupCount; i++) {
    let steps = 0;
    let cursor = groupParent[i];
    while (cursor !== -1) {
      if (cursor === i || steps++ > groupCount) {
        warnings.push(`Group "${String(groupList[i].id)}" is part of a parent cycle — detached to a root.`);
        const parentIndex = groupParent[i];
        if (parentIndex !== -1) {
          const siblings = groupChildren[parentIndex];
          const at = siblings.indexOf(i);
          if (at >= 0) siblings.splice(at, 1);
        }
        groupParent[i] = -1;
        roots.push(i);
        break;
      }
      cursor = groupParent[cursor];
    }
  }

  return {
    warnings,
    model: {
      tasks,
      groups: groupList,
      starts,
      ends,
      taskGroup,
      taskIndexById,
      groupIndexById,
      groupChildren,
      groupParent,
      roots,
      domain: [min, max],
      revision,
    },
  };
}

export function emptyModel<T, G>(revision = 0): DataModel<T, G> {
  return {
    tasks: [],
    groups: [],
    starts: new Float64Array(0),
    ends: new Float64Array(0),
    taskGroup: new Int32Array(0),
    taskIndexById: new Map(),
    groupIndexById: new Map(),
    groupChildren: [],
    groupParent: new Int32Array(0),
    roots: [],
    domain: [0, 0],
    revision,
  };
}
