import type { DataModel } from '../data/dataModel';
import { LaneAllocator, MILESTONE_EPSILON } from '../util/laneAllocator';
import { upperBoundIndex } from '../util/search';
import type { GanttEngineOptions, GanttRow, LayoutResult } from '../types';
import type { RowModel } from './rows';

/**
 * Stacking + layout pass.
 *
 * Produces, in a single sweep over the data:
 *  - a CSR index (`rowOffsets` + `rankToTask`) of every displayed task, sorted
 *    by row then start time — this doubles as the *visual order* used by
 *    range selection and keyboard navigation;
 *  - a stacking lane per task (see {@link LaneAllocator});
 *  - `maxEndPrefix`, the running maximum of `end` within each row slice, which
 *    lets the virtualizer terminate a backwards scan early instead of walking
 *    a whole row;
 *  - row geometry (y offset + height) in content pixels.
 *
 * Everything here is computed in *data space*, so panning and zooming never
 * invalidate it — only a data, collapse or metrics change does.
 */
export function computeLayout<T, G>(
  model: DataModel<T, G>,
  rowModel: RowModel<G>,
  options: GanttEngineOptions,
  revision: number,
): LayoutResult<G> {
  const { metrics, stacking } = options;
  const rows = rowModel.rows;
  const rowCount = rows.length;
  const taskCount = model.tasks.length;

  const taskRow = new Int32Array(taskCount).fill(-1);
  const taskLane = new Int32Array(taskCount);
  const taskRank = new Int32Array(taskCount).fill(-1);
  const rowOffsets = new Int32Array(rowCount + 1);

  // ---- bucket tasks into rows -------------------------------------------
  let displayed = 0;
  for (let i = 0; i < taskCount; i++) {
    const row = rowModel.groupToRow[model.taskGroup[i]];
    taskRow[i] = row;
    if (row >= 0) {
      rowOffsets[row + 1]++;
      displayed++;
    }
  }
  for (let r = 0; r < rowCount; r++) rowOffsets[r + 1] += rowOffsets[r];

  const rankToTask = new Int32Array(displayed);
  const maxEndPrefix = new Float64Array(displayed);

  {
    const cursor = rowOffsets.slice(0, rowCount);
    for (let i = 0; i < taskCount; i++) {
      const row = taskRow[i];
      if (row >= 0) rankToTask[cursor[row]++] = i;
    }
  }

  // ---- order each row slice by start time --------------------------------
  const starts = model.starts;
  const ends = model.ends;
  const byStart = (a: number, b: number): number => {
    const d = starts[a] - starts[b];
    // Ties broken by original index so the order is deterministic across runs.
    return d !== 0 ? d : a - b;
  };
  for (let r = 0; r < rowCount; r++) {
    const from = rowOffsets[r];
    const to = rowOffsets[r + 1];
    if (to - from > 1) rankToTask.subarray(from, to).sort(byStart);
  }

  for (let rank = 0; rank < displayed; rank++) taskRank[rankToTask[rank]] = rank;

  // ---- lane assignment + per-row running max end -------------------------
  const allocator = new LaneAllocator(32);
  const maxLanes = Math.max(1, stacking.maxLanes | 0);
  const minGap = stacking.minGap;
  const rowLaneCount = new Int32Array(rowCount);
  // Scratch: each task's *cluster* lane count. The row geometry pass below
  // turns it into the pixel lane height the bar is actually drawn at.
  const taskLaneHeight = new Float64Array(taskCount);

  for (let r = 0; r < rowCount; r++) {
    const from = rowOffsets[r];
    const to = rowOffsets[r + 1];
    if (from === to) {
      rowLaneCount[r] = 1;
      continue;
    }

    allocator.reset();
    let runningMax = -Infinity;
    let lanes = 1;
    // A cluster is a maximal run of tasks joined by overlap. Tracked separately
    // from `runningMax` because floating tasks are outside overlap detection.
    let clusterEnd = -Infinity;
    let clusterFrom = from;
    let clusterLanes = 1;

    for (let rank = from; rank < to; rank++) {
      const i = rankToTask[rank];
      const end = ends[i];
      if (end > runningMax) runningMax = end;
      maxEndPrefix[rank] = runningMax;

      if (!stacking.enabled) {
        taskLane[i] = 0;
        continue;
      }

      const task = model.tasks[i];
      if (task.floating) {
        taskLane[i] = 0;
        continue;
      }

      // Zero-length tasks are widened infinitesimally so two milestones at the
      // same instant do not share a lane.
      const busyUntil = end > starts[i] ? end : starts[i] + MILESTONE_EPSILON;

      // Nothing before this task is still busy, so the stack starts over: a
      // task that collides with nothing gets a cluster — and a row — to itself.
      if (starts[i] - minGap >= clusterEnd) {
        writeClusterLanes(taskLaneHeight, rankToTask, clusterFrom, rank, clusterLanes);
        allocator.reset();
        clusterFrom = rank;
        clusterLanes = 1;
      }
      if (busyUntil > clusterEnd) clusterEnd = busyUntil;

      if (task.lane !== undefined) {
        taskLane[i] = allocator.occupy(task.lane, busyUntil, maxLanes);
      } else {
        taskLane[i] = allocator.allocate(starts[i] - minGap, busyUntil, maxLanes);
      }
      if (taskLane[i] + 1 > clusterLanes) clusterLanes = taskLane[i] + 1;
      if (taskLane[i] + 1 > lanes) lanes = taskLane[i] + 1;
    }
    // Closes the last cluster, and covers every task in a row that never
    // reached the allocator (stacking off, or all floating).
    writeClusterLanes(taskLaneHeight, rankToTask, clusterFrom, to, clusterLanes);

    rowLaneCount[r] = stacking.enabled ? Math.max(1, lanes) : 1;
  }

  // ---- row geometry ------------------------------------------------------
  const rowY = new Float64Array(rowCount);
  const rowHeight = new Float64Array(rowCount);
  let y = 0;

  // In uniform mode every row is as tall as a single-lane row would be, and
  // deeper stacks are absorbed by thinner lanes rather than a taller row.
  const uniformHeight = metrics.uniformRowHeight
    ? Math.max(metrics.minRowHeight, metrics.laneHeight + metrics.rowPaddingY * 2)
    : 0;

  for (let r = 0; r < rowCount; r++) {
    const row = rows[r] as GanttRow<G>;
    const laneCount = rowLaneCount[r];

    let height: number;
    let laneHeight: number;
    if (uniformHeight > 0) {
      height = row.group.height ?? uniformHeight;
      laneHeight = Math.max(1, height - metrics.rowPaddingY * 2) / laneCount;
    } else {
      laneHeight = metrics.laneHeight;
      const natural = laneCount * laneHeight + metrics.rowPaddingY * 2;
      height = row.group.height ?? Math.max(metrics.minRowHeight, natural);
    }
    const content = laneCount * laneHeight;

    row.laneCount = laneCount;
    row.laneHeight = laneHeight;
    row.y = y;
    row.height = height;
    // Lanes are centred when the row is taller than the stack needs.
    row.laneOffset = Math.max(metrics.rowPaddingY, (height - content) / 2);

    // Cluster lane counts → pixels. Uniform rows divide the same band between
    // however many lanes *that cluster* needs, so an isolated bar fills the row
    // while a three-deep pile-up gets a third each. Growing rows keep one
    // height for every bar — the row already grew to make room.
    const available = uniformHeight > 0 ? Math.max(1, height - metrics.rowPaddingY * 2) : 0;
    for (let rank = rowOffsets[r]; rank < rowOffsets[r + 1]; rank++) {
      const i = rankToTask[rank];
      taskLaneHeight[i] = uniformHeight > 0 ? available / taskLaneHeight[i] : laneHeight;
    }

    rowY[r] = y;
    rowHeight[r] = height;
    y += height;
  }

  return {
    rows,
    rowY,
    rowHeight,
    totalHeight: y,
    taskRow,
    taskLane,
    taskLaneHeight,
    taskRank,
    rankToTask,
    rowOffsets,
    maxEndPrefix,
    revision,
  };
}

/** Stamps a finished cluster's lane count onto each of its tasks. */
function writeClusterLanes(
  taskLaneHeight: Float64Array,
  rankToTask: Int32Array,
  from: number,
  to: number,
  lanes: number,
): void {
  for (let rank = from; rank < to; rank++) taskLaneHeight[rankToTask[rank]] = lanes;
}

/**
 * Top edge of a lane within a row, in content pixels.
 *
 * `laneHeight` defaults to the row's own lane height, which is the one that
 * accounts for uniform rows; pass it only to measure against a different scale.
 */
export function laneTop(row: GanttRow, lane: number, laneHeight: number = row.laneHeight): number {
  return row.y + row.laneOffset + lane * laneHeight;
}

/**
 * Inset of a bar inside its lane, px.
 *
 * Capped at a quarter of the lane so a compressed stack still renders bars
 * rather than collapsing into padding.
 */
export function barInset(laneHeight: number, itemPaddingY: number): number {
  return Math.min(itemPaddingY, laneHeight / 4);
}

/**
 * Row containing a content-space y coordinate, or -1 when outside the content.
 * Rows have variable heights, so this is a binary search rather than a divide.
 */
export function rowIndexAt<G>(layout: LayoutResult<G>, contentY: number): number {
  const count = layout.rows.length;
  if (count === 0 || contentY < 0 || contentY >= layout.totalHeight) return -1;
  const index = upperBoundIndex(layout.rowY, contentY, 0, count);
  return index < 0 ? -1 : index;
}

/** Nearest row to a content-space y coordinate, clamped to the content bounds. */
export function nearestRowIndex<G>(layout: LayoutResult<G>, contentY: number): number {
  const count = layout.rows.length;
  if (count === 0) return -1;
  if (contentY < 0) return 0;
  if (contentY >= layout.totalHeight) return count - 1;
  const index = upperBoundIndex(layout.rowY, contentY, 0, count);
  return index < 0 ? 0 : index;
}
