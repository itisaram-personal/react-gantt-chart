import { clamp } from '../util/search';
import type { DragMode, DragState, GanttId, Point, TaskChange } from '../types';
import type { EngineContext } from './context';
import { nearestRowIndex } from './layout';
import type { SelectionEngine } from './selection';
import type { ViewportController } from './viewport';

/** Pixels the pointer must travel before a press turns into a drag. */
const DRAG_THRESHOLD_PX = 3;

export interface DragBeginOptions {
  /** Force a resize gesture instead of a move. */
  mode?: 'move' | 'resize-start' | 'resize-end';
  /**
   * Select the origin task when it is not already selected. Matches the
   * behaviour every desktop app has: dragging an unselected item selects it.
   */
  selectOnBegin?: boolean;
}

/**
 * A veto/adjust hook applied to every proposed change before it is emitted.
 * Return a modified change, or `null` to drop the task from the commit.
 */
export type DragConstraint<T = unknown> = (
  change: TaskChange,
  context: { mode: DragMode; drag: DragState; index: number },
) => TaskChange | null;

/**
 * Drag engine.
 *
 * Movement mode is derived, never configured by the caller:
 *  - a selection confined to a single row can move freely on both axes;
 *  - a selection spanning several rows moves horizontally only, because there
 *    is no unambiguous vertical delta to apply to it.
 *
 * The gesture never mutates task data. It writes a `DragState` to the store,
 * the virtualizer applies that offset when it builds the frame, and on commit
 * the engine emits a list of proposed {@link TaskChange}s for the consumer to
 * accept (or apply automatically via `engine.applyChanges`).
 */
export class DragEngine<T = unknown, G = unknown> {
  private constraint: DragConstraint<T> | null = null;
  /** Row index of each dragged task at gesture start, keyed by task id. */
  private originRows = new Map<GanttId, number>();
  private originRowIndex = -1;

  constructor(
    private readonly ctx: EngineContext<T, G>,
    private readonly selection: SelectionEngine<T, G>,
    private readonly viewport: ViewportController<T, G>,
  ) {}

  get state(): DragState | null {
    return this.ctx.store.getState().drag;
  }

  get isDragging(): boolean {
    const drag = this.state;
    return drag !== null && drag.active;
  }

  setConstraint(constraint: DragConstraint<T> | null): void {
    this.constraint = constraint;
  }

  /**
   * Arm a gesture. Returns false when dragging is disabled or the task is
   * unknown. The gesture stays inactive (and renders nothing) until the
   * pointer passes {@link DRAG_THRESHOLD_PX}.
   */
  begin(taskId: GanttId, point: Point, options: DragBeginOptions = {}): boolean {
    const interaction = this.ctx.getOptions().interaction;
    const requested = options.mode ?? 'move';
    if (requested === 'move' && !interaction.drag) return false;
    if (requested !== 'move' && !interaction.resize) return false;

    const model = this.ctx.getModel();
    const layout = this.ctx.getLayout();
    const taskIndex = model.taskIndexById.get(taskId);
    if (taskIndex === undefined) return false;
    if (model.tasks[taskIndex].draggable === false) return false;

    if (options.selectOnBegin !== false && !this.selection.isSelected(taskId)) {
      this.selection.handleClick(taskId);
    }

    // Resizing only ever affects the task under the pointer; moving carries the
    // whole selection.
    let taskIds: GanttId[];
    if (requested === 'move') {
      const selected = this.selection.selected;
      taskIds = selected.has(taskId) ? Array.from(selected) : [taskId];
    } else {
      taskIds = [taskId];
    }

    taskIds = taskIds.filter((id) => {
      const index = model.taskIndexById.get(id);
      return index !== undefined && model.tasks[index].draggable !== false && layout.taskRow[index] >= 0;
    });
    if (taskIds.length === 0) return false;

    this.originRows.clear();
    const rowsTouched = new Set<number>();
    for (const id of taskIds) {
      const index = model.taskIndexById.get(id)!;
      const row = layout.taskRow[index];
      this.originRows.set(id, row);
      rowsTouched.add(row);
    }

    const mode: DragMode =
      requested === 'move' ? (rowsTouched.size === 1 ? 'free' : 'horizontal') : requested;

    this.originRowIndex = layout.taskRow[taskIndex];

    const drag: DragState = {
      mode,
      originTaskId: taskId,
      taskIds,
      originPoint: point,
      currentPoint: point,
      deltaTime: 0,
      deltaRow: 0,
      active: false,
    };
    this.ctx.store.setState({ drag });
    return true;
  }

  /** Feed a pointer position. Activates the gesture once past the threshold. */
  move(point: Point): void {
    const drag = this.state;
    if (!drag) return;

    const dx = point.x - drag.originPoint.x;
    const dy = point.y - drag.originPoint.y;
    const active = drag.active || Math.abs(dx) >= DRAG_THRESHOLD_PX || Math.abs(dy) >= DRAG_THRESHOLD_PX;
    if (!active) {
      if (drag.currentPoint.x !== point.x || drag.currentPoint.y !== point.y) {
        this.ctx.store.setState({ drag: { ...drag, currentPoint: point } });
      }
      return;
    }

    const deltaTime = this.snap(dx / Math.max(this.viewport.scale, Number.MIN_VALUE));
    const deltaRow = drag.mode === 'free' ? this.resolveRowDelta(point.y) : 0;

    if (drag.active && drag.deltaTime === deltaTime && drag.deltaRow === deltaRow) {
      // Sub-pixel pointer noise — nothing visible would change.
      this.ctx.store.setState({ drag: { ...drag, currentPoint: point } });
      return;
    }

    const next: DragState = { ...drag, currentPoint: point, deltaTime, deltaRow, active: true };
    this.ctx.store.setState({ drag: next });
    this.ctx.events.emit(drag.active ? 'drag:move' : 'drag:start', next);
  }

  /** Finish the gesture and emit the proposed changes. */
  commit(): TaskChange[] {
    const drag = this.state;
    if (!drag) return [];

    const changes = drag.active ? this.buildChanges(drag) : [];
    this.ctx.store.setState({ drag: null });
    this.originRows.clear();
    if (drag.active) this.ctx.events.emit('drag:end', { drag, changes, cancelled: false });
    return changes;
  }

  /** Abort without emitting changes. */
  cancel(): void {
    const drag = this.state;
    if (!drag) return;
    this.ctx.store.setState({ drag: null });
    this.originRows.clear();
    if (drag.active) this.ctx.events.emit('drag:end', { drag, changes: [], cancelled: true });
  }

  /** The changes the current gesture would produce if committed now. */
  preview(): TaskChange[] {
    const drag = this.state;
    return drag && drag.active ? this.buildChanges(drag) : [];
  }

  private buildChanges(drag: DragState): TaskChange[] {
    const model = this.ctx.getModel();
    const layout = this.ctx.getLayout();
    const changes: TaskChange[] = [];

    for (let i = 0; i < drag.taskIds.length; i++) {
      const id = drag.taskIds[i];
      const index = model.taskIndexById.get(id);
      if (index === undefined) continue;

      const task = model.tasks[index];
      const prevStart = model.starts[index];
      const prevEnd = model.ends[index];
      const previous = { start: prevStart, end: prevEnd, groupId: task.groupId };

      let start = prevStart;
      let end = prevEnd;
      let groupId = task.groupId;

      switch (drag.mode) {
        case 'resize-start':
          start = Math.min(prevStart + drag.deltaTime, prevEnd);
          break;
        case 'resize-end':
          end = Math.max(prevEnd + drag.deltaTime, prevStart);
          break;
        default: {
          start = prevStart + drag.deltaTime;
          end = prevEnd + drag.deltaTime;
          if (drag.mode === 'free' && drag.deltaRow !== 0) {
            const originRow = this.originRows.get(id) ?? layout.taskRow[index];
            const targetRow = clamp(originRow + drag.deltaRow, 0, layout.rows.length - 1);
            groupId = layout.rows[targetRow].group.id;
          }
        }
      }

      if (start === prevStart && end === prevEnd && groupId === task.groupId) continue;

      let change: TaskChange | null = { id, start, end, groupId, previous };
      if (this.constraint) change = this.constraint(change, { mode: drag.mode, drag, index: i });
      if (change) changes.push(change);
    }

    return changes;
  }

  /**
   * Vertical delta in *rows*, derived from the row under the pointer rather
   * than from a pixel division — row heights vary with lane count.
   */
  private resolveRowDelta(pointerY: number): number {
    const layout = this.ctx.getLayout();
    if (layout.rows.length === 0 || this.originRowIndex < 0) return 0;
    const targetRow = nearestRowIndex(layout, this.viewport.pxToContent(pointerY));
    if (targetRow < 0) return 0;

    const delta = targetRow - this.originRowIndex;
    if (delta === 0) return 0;

    // Clamp so no dragged task is pushed past either end of the row list.
    let minRow = Infinity;
    let maxRow = -Infinity;
    for (const row of this.originRows.values()) {
      if (row < minRow) minRow = row;
      if (row > maxRow) maxRow = row;
    }
    return clamp(delta, -minRow, layout.rows.length - 1 - maxRow);
  }

  private snap(deltaTime: number): number {
    const snap = this.ctx.getOptions().interaction.snapMs;
    if (!snap || snap <= 0) return deltaTime;
    return Math.round(deltaTime / snap) * snap;
  }
}
