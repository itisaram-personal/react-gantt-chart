import { describe, expect, it, vi } from 'vitest';
import { GanttEngine } from '../src/GanttEngine';
import type { GanttGroup, GanttTask } from '../src/types';

const groups: GanttGroup[] = [
  { id: 'root', label: 'Root' },
  { id: 'childA', label: 'Child A', parentId: 'root' },
  { id: 'childB', label: 'Child B', parentId: 'root' },
  { id: 'grandchild', label: 'Grandchild', parentId: 'childA' },
  { id: 'other', label: 'Other' },
];

const tasks: GanttTask[] = [
  { id: 'root-1', groupId: 'root', start: 0, end: 100 },
  { id: 'a-1', groupId: 'childA', start: 100, end: 200 },
  { id: 'b-1', groupId: 'childB', start: 200, end: 300 },
  { id: 'gc-1', groupId: 'grandchild', start: 300, end: 400 },
  { id: 'other-1', groupId: 'other', start: 0, end: 50 },
];

function makeEngine(): GanttEngine {
  return new GanttEngine({ tasks, groups, size: { width: 800, height: 600 }, options: { minTimeSpan: 1 } });
}

function rowIds(engine: GanttEngine): string[] {
  return engine.getLayout().rows.map((row) => String(row.group.id));
}

function rowOf(engine: GanttEngine, taskId: string): string | null {
  const layout = engine.getLayout();
  const index = engine.getDataModel().taskIndexById.get(taskId)!;
  const rowIndex = layout.taskRow[index];
  return rowIndex < 0 ? null : String(layout.rows[rowIndex].group.id);
}

describe('group tree and collapsing', () => {
  it('flattens the tree depth-first with depths', () => {
    const engine = makeEngine();
    expect(rowIds(engine)).toEqual(['root', 'childA', 'grandchild', 'childB', 'other']);
    expect(engine.getLayout().rows.map((row) => row.depth)).toEqual([0, 1, 2, 1, 0]);
  });

  it('hides descendant rows when a group collapses', () => {
    const engine = makeEngine();
    engine.setCollapsed('root', true);
    expect(rowIds(engine)).toEqual(['root', 'other']);
  });

  it('rolls hidden tasks up onto the nearest visible ancestor', () => {
    const engine = makeEngine();
    engine.setCollapsed('root', true);
    expect(rowOf(engine, 'a-1')).toBe('root');
    expect(rowOf(engine, 'gc-1')).toBe('root');
    expect(rowOf(engine, 'other-1')).toBe('other');
  });

  it('stacks rolled-up tasks so the collapsed row shows all of them', () => {
    const engine = new GanttEngine({
      groups,
      tasks: [
        { id: 'x', groupId: 'childA', start: 0, end: 100 },
        { id: 'y', groupId: 'childB', start: 0, end: 100 },
        { id: 'z', groupId: 'grandchild', start: 0, end: 100 },
      ],
      options: { minTimeSpan: 1 },
    });
    engine.setCollapsed('root', true);
    const rootRow = engine.getLayout().rows.find((row) => row.group.id === 'root')!;
    expect(rootRow.laneCount).toBe(3);
  });

  it('drops hidden tasks entirely when rollup is disabled', () => {
    const engine = new GanttEngine({
      tasks,
      groups,
      options: { minTimeSpan: 1, stacking: { rollupCollapsed: false } },
    });
    engine.setCollapsed('root', true);
    expect(rowOf(engine, 'a-1')).toBeNull();
    expect(engine.getLayout().rankToTask.length).toBe(2);
  });

  it('collapses and expands everything with children', () => {
    const engine = makeEngine();
    engine.collapseAll();
    expect(rowIds(engine)).toEqual(['root', 'other']);
    engine.expandAll();
    expect(rowIds(engine)).toEqual(['root', 'childA', 'grandchild', 'childB', 'other']);
  });

  it('seeds collapse state from the data once, then keeps runtime state', () => {
    const engine = new GanttEngine({
      tasks,
      groups: groups.map((group) => (group.id === 'root' ? { ...group, collapsed: true } : group)),
      options: { minTimeSpan: 1 },
    });
    expect(rowIds(engine)).toEqual(['root', 'other']);

    engine.setCollapsed('root', false);
    // A data refresh must not undo the user's expand.
    engine.setTasks([...tasks]);
    expect(rowIds(engine)).toEqual(['root', 'childA', 'grandchild', 'childB', 'other']);
  });

  it('emits row:toggle with the affected row', () => {
    const engine = makeEngine();
    const listener = vi.fn();
    engine.on('row:toggle', listener);
    engine.toggleCollapse('childA');
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][0].collapsed).toBe(true);
    expect(listener.mock.calls[0][0].row.group.id).toBe('childA');
  });

  it('recomputes row offsets after a collapse', () => {
    const engine = makeEngine();
    const before = engine.getLayout().totalHeight;
    engine.setCollapsed('root', true);
    const after = engine.getLayout();
    expect(after.totalHeight).toBeLessThan(before);
    expect(after.rowY[1]).toBe(after.rowHeight[0]);
  });

  it('treats a parent cycle as a root instead of hanging', () => {
    const engine = new GanttEngine({
      tasks: [{ id: 't', groupId: 'x', start: 0, end: 1 }],
      groups: [
        { id: 'x', parentId: 'y' },
        { id: 'y', parentId: 'x' },
      ],
      options: { minTimeSpan: 1 },
      warn: false,
    });
    expect(engine.getLayout().rows.length).toBe(2);
  });

  it('creates rows for groups referenced only by tasks', () => {
    const engine = new GanttEngine({
      tasks: [{ id: 't', groupId: 'ghost', start: 0, end: 1 }],
      options: { minTimeSpan: 1 },
    });
    expect(rowIds(engine)).toEqual(['ghost']);
  });
});
