import type { GanttId, PointerModifiers, Rect } from '../types';
import { EMPTY_SELECTION } from '../store/ganttState';
import type { EngineContext } from './context';
import { queryRect } from './virtualize';

export type SelectionMode = 'replace' | 'add' | 'remove' | 'toggle';

/**
 * Selection engine.
 *
 * Ranges are expressed over the *visual* order produced by the layout pass
 * (row order, then start time), so shift-selecting behaves the way the chart
 * reads rather than following insertion order.
 */
export class SelectionEngine<T = unknown, G = unknown> {
  constructor(private readonly ctx: EngineContext<T, G>) {}

  get selected(): ReadonlySet<GanttId> {
    return this.ctx.store.getState().selection;
  }

  get anchor(): GanttId | null {
    return this.ctx.store.getState().selectionAnchor;
  }

  isSelected(id: GanttId): boolean {
    return this.ctx.store.getState().selection.has(id);
  }

  /** Replace the selection wholesale. */
  set(ids: Iterable<GanttId>, anchor?: GanttId | null): void {
    this.commit(new Set(ids), anchor);
  }

  add(ids: Iterable<GanttId>, anchor?: GanttId | null): void {
    const next = new Set(this.selected);
    for (const id of ids) next.add(id);
    this.commit(next, anchor);
  }

  remove(ids: Iterable<GanttId>): void {
    const next = new Set(this.selected);
    for (const id of ids) next.delete(id);
    this.commit(next);
  }

  toggle(id: GanttId): void {
    const next = new Set(this.selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    this.commit(next, id);
  }

  clear(): void {
    if (this.selected.size === 0) return;
    this.commit(EMPTY_SELECTION, null);
  }

  selectAll(): void {
    const layout = this.ctx.getLayout();
    const model = this.ctx.getModel();
    const next = new Set<GanttId>();
    for (let rank = 0; rank < layout.rankToTask.length; rank++) {
      next.add(model.tasks[layout.rankToTask[rank]].id);
    }
    this.commit(next, this.anchor);
  }

  invert(): void {
    const layout = this.ctx.getLayout();
    const model = this.ctx.getModel();
    const current = this.selected;
    const next = new Set<GanttId>();
    for (let rank = 0; rank < layout.rankToTask.length; rank++) {
      const id = model.tasks[layout.rankToTask[rank]].id;
      if (!current.has(id)) next.add(id);
    }
    this.commit(next, this.anchor);
  }

  /**
   * Standard click semantics:
   *  - plain click        → replace with the clicked task
   *  - ctrl/meta + click  → toggle the clicked task, move the anchor
   *  - shift + click      → replace with the range anchor→task
   *  - ctrl + shift+click → add the range anchor→task
   */
  handleClick(id: GanttId, modifiers: Partial<PointerModifiers> = {}): void {
    const options = this.ctx.getOptions().interaction;
    if (!options.selection) return;

    const additive = options.multiSelect && (modifiers.ctrl === true || modifiers.meta === true);
    const ranged = options.multiSelect && modifiers.shift === true;

    if (ranged && this.anchor !== null) {
      const range = this.rangeBetween(this.anchor, id);
      if (additive) this.add(range, this.anchor);
      else this.commit(new Set(range), this.anchor);
      return;
    }

    if (additive) {
      this.toggle(id);
      return;
    }

    this.commit(new Set([id]), id);
  }

  /** Every task id between two tasks in visual order, inclusive. */
  rangeBetween(fromId: GanttId, toId: GanttId): GanttId[] {
    const model = this.ctx.getModel();
    const layout = this.ctx.getLayout();
    const fromIndex = model.taskIndexById.get(fromId);
    const toIndex = model.taskIndexById.get(toId);
    if (fromIndex === undefined || toIndex === undefined) return [];

    const a = layout.taskRank[fromIndex];
    const b = layout.taskRank[toIndex];
    if (a < 0 || b < 0) return [];

    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    const out: GanttId[] = new Array(hi - lo + 1);
    for (let rank = lo; rank <= hi; rank++) {
      out[rank - lo] = model.tasks[layout.rankToTask[rank]].id;
    }
    return out;
  }

  /**
   * Rubber-band selection. The rectangle is given in *content* coordinates:
   * `x` in epoch ms, `y` in content pixels.
   */
  selectRect(rect: Rect, mode: SelectionMode = 'replace'): GanttId[] {
    const model = this.ctx.getModel();
    const indices = queryRect(
      model,
      this.ctx.getLayout(),
      this.ctx.getOptions(),
      rect.x,
      rect.x + rect.width,
      rect.y,
      rect.y + rect.height,
    );
    const ids = indices.map((i) => model.tasks[i].id);

    switch (mode) {
      case 'add':
        this.add(ids);
        break;
      case 'remove':
        this.remove(ids);
        break;
      case 'toggle': {
        const next = new Set(this.selected);
        for (const id of ids) {
          if (next.has(id)) next.delete(id);
          else next.add(id);
        }
        this.commit(next);
        break;
      }
      default:
        this.commit(new Set(ids), ids.length > 0 ? ids[0] : null);
    }
    return ids;
  }

  /** Move the selection by `delta` positions in visual order. */
  moveFocus(delta: number, extend = false): GanttId | null {
    const model = this.ctx.getModel();
    const layout = this.ctx.getLayout();
    if (layout.rankToTask.length === 0) return null;

    const anchorIndex = this.anchor !== null ? model.taskIndexById.get(this.anchor) : undefined;
    const currentRank = anchorIndex !== undefined ? layout.taskRank[anchorIndex] : -1;
    const nextRank = Math.min(
      layout.rankToTask.length - 1,
      Math.max(0, (currentRank < 0 ? (delta > 0 ? -1 : layout.rankToTask.length) : currentRank) + delta),
    );

    const id = model.tasks[layout.rankToTask[nextRank]].id;
    if (extend && this.anchor !== null) this.add(this.rangeBetween(this.anchor, id), this.anchor);
    else this.commit(new Set([id]), id);
    return id;
  }

  private commit(next: ReadonlySet<GanttId>, anchor?: GanttId | null): void {
    const previous = this.selected;

    let identical = previous.size === next.size;
    if (identical) {
      for (const id of next) {
        if (!previous.has(id)) {
          identical = false;
          break;
        }
      }
    }

    const anchorChanged = anchor !== undefined && anchor !== this.anchor;
    if (identical && !anchorChanged) return;

    const added: GanttId[] = [];
    const removed: GanttId[] = [];
    if (!identical) {
      for (const id of next) if (!previous.has(id)) added.push(id);
      for (const id of previous) if (!next.has(id)) removed.push(id);
    }

    this.ctx.store.batch(() => {
      this.ctx.store.setState({
        selection: identical ? previous : next,
        ...(anchor !== undefined ? { selectionAnchor: anchor } : null),
      });
    });

    if (!identical) {
      this.ctx.events.emit('selection:change', {
        selected: Array.from(next),
        added,
        removed,
      });
    }
  }
}
