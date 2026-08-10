import type { DataModel } from '../data/dataModel';
import { lowerBoundIndex, upperBoundIndex } from '../util/search';
import type {
  DragState,
  GanttEngineOptions,
  GanttId,
  LayoutResult,
  VisibleItem,
  VisibleWindow,
  ViewportState,
} from '../types';
import { barInset, laneTop } from './layout';

export interface VirtualizeInput<T, G> {
  model: DataModel<T, G>;
  layout: LayoutResult<G>;
  viewport: ViewportState;
  options: GanttEngineOptions;
  selection: ReadonlySet<GanttId>;
  hoveredTaskId: GanttId | null;
  drag: DragState | null;
  revision: number;
}

/**
 * Selects the bars that intersect the viewport.
 *
 * Vertical culling is a binary search over the row offsets. Horizontal culling
 * is, per visible row, a binary search for the last task starting before the
 * right edge followed by a backwards scan that stops as soon as
 * `maxEndPrefix` proves no earlier task can reach the left edge. The result is
 * O(visibleRows · log n + visibleItems) — independent of total dataset size.
 */
export function computeVisible<T, G>(input: VirtualizeInput<T, G>): VisibleWindow<T, G> {
  const { model, layout, viewport, options, selection, hoveredTaskId, drag, revision } = input;
  const { metrics, virtualization } = options;
  const rows = layout.rows;
  const rowCount = rows.length;

  const items: VisibleItem<T>[] = [];
  const empty: VisibleWindow<T, G> = {
    items,
    rows: [],
    rowStart: -1,
    rowEnd: -2,
    timeStart: viewport.timeStart,
    timeEnd: viewport.timeEnd,
    truncated: false,
    candidateCount: 0,
    revision,
  };
  if (rowCount === 0 || layout.rankToTask.length === 0) return empty;

  // Overscan in both axes so small pans reuse the previous frame's work.
  const span = viewport.timeEnd - viewport.timeStart;
  const msPerPx = viewport.width > 0 ? span / viewport.width : 0;
  const timePad = virtualization.overscanPx * msPerPx;
  const t0 = viewport.timeStart - timePad;
  const t1 = viewport.timeEnd + timePad;

  const yTop = viewport.scrollTop - virtualization.overscanPx;
  const yBottom = viewport.scrollTop + viewport.height + virtualization.overscanPx;

  // First row whose bottom edge is below the top of the viewport.
  let rowStart = upperBoundIndex(layout.rowY, yTop, 0, rowCount);
  if (rowStart < 0) rowStart = 0;
  rowStart = Math.max(0, rowStart - virtualization.overscanRows);
  // First row that starts at or after the bottom edge.
  let rowEnd = lowerBoundIndex(layout.rowY, yBottom, 0, rowCount) - 1;
  rowEnd = Math.min(rowCount - 1, rowEnd + virtualization.overscanRows);
  if (rowEnd < rowStart) return empty;

  const dragSet = drag && drag.active ? new Set(drag.taskIds) : null;
  const deltaTime = dragSet ? drag!.deltaTime : 0;
  const deltaRow = dragSet ? drag!.deltaRow : 0;
  const dragMode = drag?.mode;

  const starts = model.starts;
  const ends = model.ends;
  const limit = virtualization.maxVisibleItems;

  let candidateCount = 0;
  let truncated = false;
  const emitted = dragSet ? new Set<number>() : null;

  const push = (taskIndex: number, rowIndex: number): void => {
    const task = model.tasks[taskIndex] as VisibleItem<T>['task'];
    const lane = layout.taskLane[taskIndex];
    const dragging = dragSet ? dragSet.has(task.id) : false;

    let start = starts[taskIndex];
    let end = ends[taskIndex];
    let effectiveRow = rowIndex;

    if (dragging) {
      if (dragMode === 'resize-start') start = Math.min(start + deltaTime, end);
      else if (dragMode === 'resize-end') end = Math.max(end + deltaTime, start);
      else {
        start += deltaTime;
        end += deltaTime;
        if (dragMode === 'free' && deltaRow !== 0) {
          effectiveRow = Math.min(rowCount - 1, Math.max(0, rowIndex + deltaRow));
        }
      }
    }

    // Lane height is per task: in a uniform row only the bars that collide with
    // something are compressed, so the lane is as tall as its cluster allows.
    const row = rows[effectiveRow];
    const laneHeight = layout.taskLaneHeight[taskIndex];
    const inset = barInset(laneHeight, metrics.itemPaddingY);
    items.push({
      taskIndex,
      task,
      rowIndex: effectiveRow,
      lane,
      start,
      end,
      y: laneTop(row, lane, laneHeight) + inset,
      height: Math.max(1, laneHeight - inset * 2),
      laneHeight,
      selected: selection.has(task.id),
      hovered: hoveredTaskId === task.id,
      dragging,
    });
    emitted?.add(taskIndex);
  };

  outer: for (let r = rowStart; r <= rowEnd; r++) {
    const from = layout.rowOffsets[r];
    const to = layout.rowOffsets[r + 1];
    if (from === to) continue;

    // Last task in this row that starts at or before the right edge.
    const hi = upperBoundIndex(
      layout.rankToTask,
      t1,
      from,
      to,
      (rank) => starts[layout.rankToTask[rank]],
    );

    for (let rank = hi; rank >= from; rank--) {
      // Nothing at or before `rank` can still be running at t0.
      if (layout.maxEndPrefix[rank] < t0) break;
      const taskIndex = layout.rankToTask[rank];
      if (ends[taskIndex] < t0) continue;

      candidateCount++;
      if (items.length >= limit) {
        truncated = true;
        break outer;
      }
      push(taskIndex, r);
    }
  }

  // Bars being dragged must stay on screen even once the gesture has carried
  // them out of the culled window.
  if (dragSet && emitted) {
    for (const id of dragSet) {
      const taskIndex = model.taskIndexById.get(id);
      if (taskIndex === undefined || emitted.has(taskIndex)) continue;
      const rowIndex = layout.taskRow[taskIndex];
      if (rowIndex < 0) continue;
      if (items.length >= limit) {
        truncated = true;
        break;
      }
      candidateCount++;
      push(taskIndex, rowIndex);
    }
  }

  return {
    items,
    rows: rows.slice(rowStart, rowEnd + 1),
    rowStart,
    rowEnd,
    timeStart: viewport.timeStart,
    timeEnd: viewport.timeEnd,
    truncated,
    candidateCount,
    revision,
  };
}

/**
 * Task indices whose bars intersect a rectangle in content pixels / time.
 *
 * Disabled rows are skipped, so a marquee dragged across one passes over it
 * instead of picking its bars up.
 *
 * `options` is unused — lane geometry now comes off the row — but kept so the
 * signature stays source-compatible.
 */
export function queryRect<T, G>(
  model: DataModel<T, G>,
  layout: LayoutResult<G>,
  options: GanttEngineOptions,
  timeStart: number,
  timeEnd: number,
  yStart: number,
  yEnd: number,
): number[] {
  const rows = layout.rows;
  const rowCount = rows.length;
  const result: number[] = [];
  if (rowCount === 0) return result;

  let rowStart = upperBoundIndex(layout.rowY, yStart, 0, rowCount);
  if (rowStart < 0) rowStart = 0;
  const rowEnd = Math.min(rowCount - 1, lowerBoundIndex(layout.rowY, yEnd, 0, rowCount) - 1);

  const starts = model.starts;
  const ends = model.ends;

  for (let r = rowStart; r <= rowEnd; r++) {
    const row = rows[r];
    if (row.disabled) continue;
    if (row.y > yEnd || row.y + row.height < yStart) continue;
    const from = layout.rowOffsets[r];
    const to = layout.rowOffsets[r + 1];
    if (from === to) continue;

    const hi = upperBoundIndex(layout.rankToTask, timeEnd, from, to, (rank) => starts[layout.rankToTask[rank]]);
    for (let rank = hi; rank >= from; rank--) {
      if (layout.maxEndPrefix[rank] < timeStart) break;
      const taskIndex = layout.rankToTask[rank];
      if (ends[taskIndex] < timeStart) continue;

      const laneHeight = layout.taskLaneHeight[taskIndex];
      const top = laneTop(row, layout.taskLane[taskIndex], laneHeight);
      if (top > yEnd || top + laneHeight < yStart) continue;
      result.push(taskIndex);
    }
  }
  return result;
}
