import type { ContextMenuState, ContextMenuTargetKind, GanttId, GanttRow, GanttTask, Point } from '../types';
import type { EngineContext } from './context';
import type { SelectionEngine } from './selection';

export interface OpenContextMenuInput<T, G> {
  kind: ContextMenuTargetKind;
  position: Point;
  task?: GanttTask<T> | null;
  row?: GanttRow<G> | null;
  /**
   * Bring the target into the selection before opening, unless it is already
   * part of a multi-selection. This is what makes "right-click → act on the
   * selection" behave predictably.
   */
  selectTarget?: boolean;
}

/**
 * Context menu engine.
 *
 * The engine owns *what* the menu is about (target, position, selection
 * snapshot); the view layer owns what it looks like.
 */
export class ContextMenuEngine<T = unknown, G = unknown> {
  constructor(
    private readonly ctx: EngineContext<T, G>,
    private readonly selection: SelectionEngine<T, G>,
  ) {}

  get state(): ContextMenuState<T, G> | null {
    return this.ctx.store.getState().contextMenu;
  }

  get isOpen(): boolean {
    return this.state !== null;
  }

  open(input: OpenContextMenuInput<T, G>): ContextMenuState<T, G> {
    const task = input.task ?? null;

    if (task && input.selectTarget !== false && !this.selection.isSelected(task.id)) {
      this.selection.handleClick(task.id);
    }

    const state: ContextMenuState<T, G> = {
      kind: input.kind,
      position: input.position,
      task,
      row: input.row ?? null,
      selection: Array.from(this.selection.selected) as readonly GanttId[],
    };

    this.ctx.store.setState({ contextMenu: state });
    this.ctx.events.emit('contextmenu:open', state);
    return state;
  }

  close(): void {
    if (!this.state) return;
    this.ctx.store.setState({ contextMenu: null });
    this.ctx.events.emit('contextmenu:close', undefined);
  }
}
