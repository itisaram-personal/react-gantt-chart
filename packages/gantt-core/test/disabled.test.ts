import { describe, expect, it, vi } from 'vitest';
import { GanttEngine } from '../src/GanttEngine';
import type { GanttGroup, GanttTask } from '../src/types';

const groups: GanttGroup[] = [
  { id: 'a', label: 'A' },
  { id: 'b', label: 'B' },
  { id: 'c', label: 'C' },
];

const tasks: GanttTask[] = [
  { id: 'a1', groupId: 'a', start: 0, end: 100 },
  { id: 'a2', groupId: 'a', start: 200, end: 300 },
  { id: 'b1', groupId: 'b', start: 0, end: 100 },
  { id: 'b2', groupId: 'b', start: 200, end: 300 },
  { id: 'c1', groupId: 'c', start: 0, end: 100 },
];

function makeEngine(): GanttEngine {
  return new GanttEngine({
    tasks,
    groups,
    size: { width: 800, height: 400 },
    options: { minTimeSpan: 1 },
  });
}

function rowOf(engine: GanttEngine, groupId: string) {
  return engine.getLayout().rows.find((row) => row.group.id === groupId)!;
}

describe('disabled rows', () => {
  it('stamps the flag onto the row and reports it back', () => {
    const engine = makeEngine();
    expect(rowOf(engine, 'b').disabled).toBe(false);

    engine.setRowDisabled('b', true);
    expect(engine.isRowDisabled('b')).toBe(true);
    expect(rowOf(engine, 'b').disabled).toBe(true);
    expect(rowOf(engine, 'a').disabled).toBe(false);

    engine.toggleRowDisabled('b');
    expect(rowOf(engine, 'b').disabled).toBe(false);
  });

  it('keeps the geometry — and the layout it came from — untouched', () => {
    const engine = makeEngine();
    const before = engine.getLayout();

    engine.setRowDisabled('b', true);
    const after = engine.getLayout();

    // Same layout object: disabling changes no geometry, so nothing upstream of
    // the row stamp is allowed to re-run.
    expect(after).toBe(before);
    expect(after.totalHeight).toBe(before.totalHeight);
  });

  it('emits row:disable with the affected row', () => {
    const engine = makeEngine();
    const listener = vi.fn();
    engine.on('row:disable', listener);

    engine.toggleRowDisabled('b');
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][0].disabled).toBe(true);
    expect(listener.mock.calls[0][0].row.group.id).toBe('b');

    // Setting the state it already has is not a change.
    engine.setRowDisabled('b', true);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('seeds from group.disabled once, then keeps runtime state', () => {
    const engine = new GanttEngine({
      tasks,
      groups: groups.map((group) => (group.id === 'b' ? { ...group, disabled: true } : group)),
      options: { minTimeSpan: 1 },
    });
    expect(engine.isRowDisabled('b')).toBe(true);

    engine.setRowDisabled('b', false);
    // A data refresh must not undo the user's enable.
    engine.setTasks([...tasks]);
    expect(engine.isRowDisabled('b')).toBe(false);
    expect(rowOf(engine, 'b').disabled).toBe(false);
  });

  it('ignores clicks on its tasks', () => {
    const engine = makeEngine();
    engine.setRowDisabled('b', true);

    engine.selection.handleClick('b1');
    expect(engine.selection.selected.size).toBe(0);

    engine.selection.handleClick('a1');
    expect([...engine.selection.selected]).toEqual(['a1']);
  });

  it('refuses to start a drag on its tasks, and drops them from one', () => {
    const engine = makeEngine();
    engine.setRowDisabled('b', true);

    expect(engine.drag.begin('b1', { x: 10, y: 10 })).toBe(false);
    expect(engine.drag.state).toBeNull();

    // A selection spanning both rows drags only what is still reachable.
    engine.selection.set(['a1', 'b1']);
    expect(engine.drag.begin('a1', { x: 10, y: 10 })).toBe(true);
    expect(engine.drag.state?.taskIds).toEqual(['a1']);
  });

  it('is not a drop target for a drag crossing it', () => {
    const engine = makeEngine();
    engine.setRowDisabled('b', true);
    const layout = engine.getLayout();
    const rowB = rowOf(engine, 'b');
    const rowC = rowOf(engine, 'c');

    engine.drag.begin('a1', { x: 10, y: layout.rows[0].y + 5 });
    // Over the disabled row: the gesture holds its ground.
    engine.drag.move({ x: 40, y: rowB.y + rowB.height / 2 });
    expect(engine.drag.state?.deltaRow).toBe(0);

    // Past it, onto a row that does accept the drop.
    engine.drag.move({ x: 40, y: rowC.y + rowC.height / 2 });
    expect(engine.drag.state?.deltaRow).toBe(2);
    expect(engine.drag.preview()[0]?.groupId).toBe('c');
  });

  it('is skipped by marquee, select-all, invert and ranges', () => {
    const engine = makeEngine();
    engine.setRowDisabled('b', true);

    engine.selection.selectAll();
    expect([...engine.selection.selected].sort()).toEqual(['a1', 'a2', 'c1']);

    engine.selection.clear();
    engine.selection.invert();
    expect([...engine.selection.selected].sort()).toEqual(['a1', 'a2', 'c1']);

    // A rectangle over every row and the whole time span.
    engine.selection.clear();
    const ids = engine.selection.selectRect({
      x: -1,
      width: 1000,
      y: 0,
      height: engine.getLayout().totalHeight,
    });
    expect([...ids].sort()).toEqual(['a1', 'a2', 'c1']);

    // A range spanning the disabled row reaches over it.
    expect(engine.selection.rangeBetween('a1', 'c1').sort()).toEqual(['a1', 'a2', 'c1']);
  });

  it('is stepped over by keyboard navigation', () => {
    const engine = makeEngine();
    engine.setRowDisabled('b', true);

    engine.selection.handleClick('a1');
    expect(engine.selection.moveFocus(1)).toBe('a2');
    expect(engine.selection.moveFocus(1)).toBe('c1');
    expect(engine.selection.moveFocus(1)).toBeNull();
    expect(engine.selection.moveFocus(-1)).toBe('a2');
  });

  it('gives up the interaction state it is no longer allowed to hold', () => {
    const engine = makeEngine();
    engine.selection.set(['a1', 'b1']);
    engine.setHovered('b1', rowOf(engine, 'b').index);
    engine.drag.begin('b1', { x: 10, y: 10 });

    engine.setRowDisabled('b', true);

    expect([...engine.selection.selected]).toEqual(['a1']);
    expect(engine.store.getState().hoveredTaskId).toBeNull();
    expect(engine.drag.state).toBeNull();
  });

  it('leaves programmatic selection and edits alone', () => {
    const engine = makeEngine();
    engine.setRowDisabled('b', true);

    // Explicit API calls are the consumer's decision, not user input.
    engine.selection.set(['b1']);
    expect([...engine.selection.selected]).toEqual(['b1']);

    engine.applyChanges([
      { id: 'b1', start: 10, end: 110, groupId: 'b', previous: { start: 0, end: 100, groupId: 'b' } },
    ]);
    expect(engine.getTask('b1')?.start).toBe(10);
  });
});
