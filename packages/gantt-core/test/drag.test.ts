import { describe, expect, it, vi } from 'vitest';
import { GanttEngine } from '../src/GanttEngine';
import type { GanttTask } from '../src/types';

/**
 * 1000px plot over a 1000ms window gives a scale of exactly 1px per ms, so a
 * pixel delta reads directly as a time delta.
 */
function makeEngine(): GanttEngine {
  const tasks: GanttTask[] = [
    { id: 'a1', groupId: 'a', start: 100, end: 200 },
    { id: 'a2', groupId: 'a', start: 300, end: 400 },
    { id: 'b1', groupId: 'b', start: 100, end: 200 },
    { id: 'c1', groupId: 'c', start: 500, end: 600 },
  ];
  const groups = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  const engine = new GanttEngine({
    tasks,
    groups,
    size: { width: 1000, height: 400 },
    // An explicit domain keeps the window exactly 1000ms wide; otherwise it
    // would be clamped to the (narrower) extent of the data.
    options: { minTimeSpan: 1, timeDomain: [0, 1000] },
  });
  engine.viewport.setTimeRange(0, 1000);
  return engine;
}

describe('drag mode derivation', () => {
  it('allows free movement when the selection sits in one row', () => {
    const engine = makeEngine();
    engine.selection.set(['a1', 'a2']);
    engine.drag.begin('a1', { x: 100, y: 10 });
    engine.drag.move({ x: 150, y: 10 });
    expect(engine.drag.state?.mode).toBe('free');
  });

  it('restricts to the x axis when the selection spans rows', () => {
    const engine = makeEngine();
    engine.selection.set(['a1', 'b1']);
    engine.drag.begin('a1', { x: 100, y: 10 });
    engine.drag.move({ x: 150, y: 120 });
    expect(engine.drag.state?.mode).toBe('horizontal');
    expect(engine.drag.state?.deltaRow).toBe(0);
  });

  it('selects an unselected task before dragging it', () => {
    const engine = makeEngine();
    engine.selection.set(['a1']);
    engine.drag.begin('b1', { x: 100, y: 50 });
    expect([...engine.selection.selected]).toEqual(['b1']);
    expect(engine.drag.state?.taskIds).toEqual(['b1']);
  });
});

describe('drag gesture', () => {
  it('stays inactive until the pointer passes the threshold', () => {
    const engine = makeEngine();
    engine.selection.set(['a1']);
    engine.drag.begin('a1', { x: 100, y: 10 });
    engine.drag.move({ x: 101, y: 10 });
    expect(engine.drag.state?.active).toBe(false);
    expect(engine.drag.isDragging).toBe(false);

    engine.drag.move({ x: 110, y: 10 });
    expect(engine.drag.isDragging).toBe(true);
  });

  it('converts pixel movement into a time delta', () => {
    const engine = makeEngine();
    engine.selection.set(['a1']);
    engine.drag.begin('a1', { x: 100, y: 10 });
    engine.drag.move({ x: 175, y: 10 });
    expect(engine.drag.state?.deltaTime).toBe(75);

    const [change] = engine.drag.commit();
    expect(change).toMatchObject({ id: 'a1', start: 175, end: 275, groupId: 'a' });
    expect(change.previous).toEqual({ start: 100, end: 200, groupId: 'a' });
  });

  it('snaps the delta when snapMs is set', () => {
    const engine = makeEngine();
    engine.setOptions({ interaction: { snapMs: 50 } });
    engine.selection.set(['a1']);
    engine.drag.begin('a1', { x: 100, y: 10 });
    engine.drag.move({ x: 170, y: 10 });
    expect(engine.drag.state?.deltaTime).toBe(50);
  });

  it('moves every selected bar by the same delta', () => {
    const engine = makeEngine();
    engine.selection.set(['a1', 'a2']);
    engine.drag.begin('a1', { x: 100, y: 10 });
    engine.drag.move({ x: 140, y: 10 });

    const changes = engine.drag.commit().sort((x, y) => String(x.id).localeCompare(String(y.id)));
    expect(changes.map((c) => [c.id, c.start, c.end])).toEqual([
      ['a1', 140, 240],
      ['a2', 340, 440],
    ]);
  });

  it('re-targets the group when a free drag crosses rows', () => {
    const engine = makeEngine();
    engine.selection.set(['a1']);
    engine.drag.begin('a1', { x: 100, y: 10 });
    // Rows are 34px tall: y=44 lands in row 1 (group b).
    engine.drag.move({ x: 100, y: 44 });
    expect(engine.drag.state?.deltaRow).toBe(1);

    const [change] = engine.drag.commit();
    expect(change.groupId).toBe('b');
    expect(change.start).toBe(100);
  });

  it('clamps a free drag to the last row instead of running off the end', () => {
    const engine = makeEngine();
    engine.selection.set(['a1']);
    engine.drag.begin('a1', { x: 100, y: 10 });
    // Far below the 3 rows of content.
    engine.drag.move({ x: 100, y: 4000 });
    expect(engine.drag.state?.deltaRow).toBe(2);
    expect(engine.drag.commit()[0].groupId).toBe('c');
  });

  it('resizes only the edge under the pointer', () => {
    const engine = makeEngine();
    engine.selection.set(['a1']);

    engine.drag.begin('a1', { x: 200, y: 10 }, { mode: 'resize-end' });
    engine.drag.move({ x: 250, y: 10 });
    let [change] = engine.drag.commit();
    expect([change.start, change.end]).toEqual([100, 250]);

    engine.drag.begin('a1', { x: 100, y: 10 }, { mode: 'resize-start' });
    engine.drag.move({ x: 60, y: 10 });
    [change] = engine.drag.commit();
    expect([change.start, change.end]).toEqual([60, 200]);
  });

  it('never lets a resize invert the bar', () => {
    const engine = makeEngine();
    engine.selection.set(['a1']);
    engine.drag.begin('a1', { x: 100, y: 10 }, { mode: 'resize-start' });
    engine.drag.move({ x: 900, y: 10 });
    const [change] = engine.drag.commit();
    expect(change.start).toBe(200);
    expect(change.end).toBe(200);
  });

  it('cancel discards the gesture without emitting changes', () => {
    const engine = makeEngine();
    const ended = vi.fn();
    engine.on('drag:end', ended);

    engine.selection.set(['a1']);
    engine.drag.begin('a1', { x: 100, y: 10 });
    engine.drag.move({ x: 200, y: 10 });
    engine.drag.cancel();

    expect(engine.drag.state).toBeNull();
    expect(ended).toHaveBeenCalledWith(expect.objectContaining({ cancelled: true, changes: [] }));
    expect(engine.getTask('a1')).toMatchObject({ start: 100, end: 200 });
  });

  it('emits start once and move thereafter', () => {
    const engine = makeEngine();
    const started = vi.fn();
    const moved = vi.fn();
    engine.on('drag:start', started);
    engine.on('drag:move', moved);

    engine.selection.set(['a1']);
    engine.drag.begin('a1', { x: 100, y: 10 });
    engine.drag.move({ x: 120, y: 10 });
    engine.drag.move({ x: 140, y: 10 });
    engine.drag.move({ x: 160, y: 10 });

    expect(started).toHaveBeenCalledTimes(1);
    expect(moved).toHaveBeenCalledTimes(2);
  });

  it('applies a constraint hook and can drop a change', () => {
    const engine = makeEngine();
    engine.drag.setConstraint((change) =>
      change.id === 'a2' ? null : { ...change, start: Math.max(0, change.start), end: change.end },
    );
    engine.selection.set(['a1', 'a2']);
    engine.drag.begin('a1', { x: 100, y: 10 });
    engine.drag.move({ x: 140, y: 10 });

    const changes = engine.drag.commit();
    expect(changes.map((c) => c.id)).toEqual(['a1']);
  });

  it('leaves task data untouched — the commit is a proposal', () => {
    const engine = makeEngine();
    engine.selection.set(['a1']);
    engine.drag.begin('a1', { x: 100, y: 10 });
    engine.drag.move({ x: 200, y: 10 });
    const changes = engine.drag.commit();

    expect(engine.getTask('a1')).toMatchObject({ start: 100, end: 200 });
    engine.applyChanges(changes);
    expect(engine.getTask('a1')).toMatchObject({ start: 200, end: 300 });
  });

  it('refuses to drag tasks that opt out', () => {
    const engine = makeEngine();
    engine.setTasks([{ id: 'x', groupId: 'a', start: 0, end: 10, draggable: false }]);
    expect(engine.drag.begin('x', { x: 0, y: 10 })).toBe(false);
  });
});
