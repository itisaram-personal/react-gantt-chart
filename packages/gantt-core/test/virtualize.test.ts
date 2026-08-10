import { describe, expect, it } from 'vitest';
import { GanttEngine } from '../src/GanttEngine';
import type { GanttTask } from '../src/types';
import { generate } from './helpers';

const EXACT = {
  minTimeSpan: 1,
  virtualization: { overscanPx: 0, overscanRows: 0, maxVisibleItems: 1_000_000 },
} as const;

describe('virtualization', () => {
  it('returns only the bars intersecting the window', () => {
    const tasks: GanttTask[] = [
      { id: 'before', groupId: 'g', start: 0, end: 100 },
      { id: 'crossing', groupId: 'g', start: 150, end: 350 },
      { id: 'inside', groupId: 'g', start: 220, end: 260 },
      { id: 'after', groupId: 'g', start: 400, end: 500 },
    ];
    const engine = new GanttEngine({ tasks, size: { width: 1000, height: 400 }, options: EXACT });
    engine.viewport.setTimeRange(200, 300);

    const ids = engine
      .getVisible()
      .items.map((item) => item.task.id)
      .sort();
    expect(ids).toEqual(['crossing', 'inside']);
  });

  it('culls rows outside the vertical window', () => {
    const { tasks, groups } = generate({ groupCount: 100, tasksPerGroup: 3, seed: 3, domain: [0, 1000] });
    const engine = new GanttEngine({ tasks, groups, size: { width: 800, height: 100 }, options: EXACT });
    engine.viewport.setTimeRange(0, 1000);

    const window = engine.getVisible();
    const layout = engine.getLayout();
    // 100px of viewport over 34px rows: at most 4 rows can be touched.
    expect(window.rows.length).toBeLessThanOrEqual(4);
    expect(window.rowStart).toBe(0);
    expect(layout.rows.length).toBe(100);
  });

  it('matches a brute-force scan across random viewports', () => {
    const { tasks, groups } = generate({ groupCount: 25, tasksPerGroup: 60, seed: 11, domain: [0, 10_000] });
    const engine = new GanttEngine({ tasks, groups, size: { width: 900, height: 300 }, options: EXACT });
    const layout = engine.getLayout();
    const model = engine.getDataModel();

    const windows: Array<[number, number, number]> = [
      [0, 1000, 0],
      [2500, 4200, 120],
      [9000, 10_000, layout.totalHeight - 300],
      [4000, 4001, 40],
    ];

    for (const [timeStart, timeEnd, scrollTop] of windows) {
      engine.viewport.setTimeRange(timeStart, timeEnd);
      engine.viewport.scrollTo(scrollTop);
      const viewport = engine.viewport.state;

      const expected = new Set<string>();
      for (let i = 0; i < tasks.length; i++) {
        const rowIndex = layout.taskRow[i];
        if (rowIndex < 0) continue;
        const row = layout.rows[rowIndex];
        const rowVisible =
          row.y < viewport.scrollTop + viewport.height && row.y + row.height > viewport.scrollTop;
        const timeVisible = model.starts[i] <= viewport.timeEnd && model.ends[i] >= viewport.timeStart;
        if (rowVisible && timeVisible) expected.add(String(tasks[i].id));
      }

      const actual = new Set(engine.getVisible().items.map((item) => String(item.task.id)));
      expect([...actual].sort()).toEqual([...expected].sort());
    }
  });

  it('reports truncation instead of flooding the renderer', () => {
    const tasks: GanttTask[] = [];
    for (let i = 0; i < 500; i++) tasks.push({ id: i, groupId: 'g', start: 0, end: 1000 });

    const engine = new GanttEngine({
      tasks,
      size: { width: 800, height: 4000 },
      options: { minTimeSpan: 1, virtualization: { maxVisibleItems: 50 } },
    });
    engine.viewport.setTimeRange(0, 1000);

    const window = engine.getVisible();
    expect(window.items.length).toBe(50);
    expect(window.truncated).toBe(true);
  });

  it('keeps dragged bars in the frame after they leave the time window', () => {
    const tasks: GanttTask[] = [
      { id: 'a', groupId: 'g', start: 0, end: 100 },
      { id: 'b', groupId: 'g', start: 5000, end: 5100 },
    ];
    const engine = new GanttEngine({ tasks, size: { width: 1000, height: 400 }, options: EXACT });
    engine.viewport.setTimeRange(0, 1000);

    engine.selection.set(['a']);
    engine.drag.begin('a', { x: 10, y: 10 });
    // 1000px across a 1000ms window is 1px/ms: this carries the bar to
    // [-400, -300), entirely left of the window, so the normal cull drops it.
    engine.drag.move({ x: -390, y: 10 });

    const dragged = engine.getVisible().items.find((item) => item.task.id === 'a');
    expect(dragged).toBeDefined();
    expect(dragged!.dragging).toBe(true);
    expect(dragged!.end).toBeLessThan(0);
  });

  it('reuses the previous frame when nothing relevant changed', () => {
    // Enough rows to overflow the 300px plot — with uniform row heights five
    // rows fit inside it, and a scroll that clamps to zero would prove nothing.
    const { tasks, groups } = generate({ groupCount: 20, tasksPerGroup: 5, seed: 5, domain: [0, 1000] });
    const engine = new GanttEngine({ tasks, groups, size: { width: 800, height: 300 }, options: EXACT });
    engine.viewport.setTimeRange(0, 500);

    const first = engine.getVisible();
    expect(engine.getVisible()).toBe(first);

    engine.viewport.scrollTo(50);
    expect(engine.getVisible()).not.toBe(first);
  });

  it('re-runs only the frame assembly when the selection changes', () => {
    const { tasks, groups } = generate({ groupCount: 3, tasksPerGroup: 10, seed: 9, domain: [0, 1000] });
    const engine = new GanttEngine({ tasks, groups, size: { width: 800, height: 300 }, options: EXACT });
    engine.viewport.setTimeRange(0, 1000);

    const layout = engine.getLayout();
    const before = engine.getVisible();
    engine.selection.set([tasks[0].id]);
    const after = engine.getVisible();

    // Layout is untouched; only the visible window is rebuilt.
    expect(engine.getLayout()).toBe(layout);
    expect(after).not.toBe(before);
    expect(after.items.find((item) => item.task.id === tasks[0].id)?.selected).toBe(true);
  });
});
