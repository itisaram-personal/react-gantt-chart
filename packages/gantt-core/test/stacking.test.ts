import { describe, expect, it } from 'vitest';
import { GanttEngine } from '../src/GanttEngine';
import { barInset, resolveLength } from '../src/engine/layout';
import { LaneAllocator } from '../src/util/laneAllocator';
import type { GanttTask } from '../src/types';
import { generate, mulberry32 } from './helpers';

function laneOf(engine: GanttEngine, id: string): number {
  const model = engine.getDataModel();
  const layout = engine.getLayout();
  return layout.taskLane[model.taskIndexById.get(id)!];
}

describe('LaneAllocator', () => {
  it('reuses lane 0 for a chain of non-overlapping intervals', () => {
    const allocator = new LaneAllocator(4);
    expect(allocator.allocate(0, 10, 64)).toBe(0);
    expect(allocator.allocate(10, 20, 64)).toBe(0);
    expect(allocator.allocate(20, 30, 64)).toBe(0);
    expect(allocator.laneCount).toBe(1);
  });

  it('opens a new lane per concurrent interval', () => {
    const allocator = new LaneAllocator(2);
    expect(allocator.allocate(0, 100, 64)).toBe(0);
    expect(allocator.allocate(1, 100, 64)).toBe(1);
    expect(allocator.allocate(2, 100, 64)).toBe(2);
    expect(allocator.laneCount).toBe(3);
  });

  it('prefers the lowest free lane rather than the earliest-freeing one', () => {
    const allocator = new LaneAllocator(8);
    allocator.allocate(0, 100, 64); // lane 0, busy until 100
    allocator.allocate(0, 10, 64); // lane 1, busy until 10
    // Lane 1 frees first, but lane 0 is still busy, so 1 is also the lowest free.
    expect(allocator.allocate(20, 30, 64)).toBe(1);
    // Once lane 0 frees it is preferred again, keeping the layout stable.
    expect(allocator.allocate(150, 160, 64)).toBe(0);
  });

  it('grows past its initial capacity', () => {
    const allocator = new LaneAllocator(1);
    for (let i = 0; i < 300; i++) {
      expect(allocator.allocate(i, 100_000, 1024)).toBe(i);
    }
    expect(allocator.laneCount).toBe(300);
  });

  it('packs overflow into the last lane once maxLanes is reached', () => {
    const allocator = new LaneAllocator(4);
    for (let i = 0; i < 3; i++) allocator.allocate(i, 1000, 3);
    expect(allocator.allocate(4, 1000, 3)).toBe(2);
    expect(allocator.laneCount).toBe(3);
  });

  it('clears only the lanes it handed out', () => {
    const allocator = new LaneAllocator(8);
    allocator.allocate(0, 100, 64);
    allocator.allocate(0, 100, 64);
    allocator.reset();
    expect(allocator.laneCount).toBe(0);
    expect(allocator.allocate(0, 5, 64)).toBe(0);
  });
});

describe('stacking through the engine', () => {
  it('leaves non-overlapping tasks in lane 0 and keeps the row one lane tall', () => {
    const tasks: GanttTask[] = [
      { id: 'a', groupId: 'g', start: 0, end: 10 },
      { id: 'b', groupId: 'g', start: 10, end: 20 },
      { id: 'c', groupId: 'g', start: 20, end: 30 },
    ];
    const engine = new GanttEngine({ tasks, options: { minTimeSpan: 1 } });
    expect([laneOf(engine, 'a'), laneOf(engine, 'b'), laneOf(engine, 'c')]).toEqual([0, 0, 0]);
    expect(engine.getLayout().rows[0].laneCount).toBe(1);
  });

  it('stacks overlapping tasks and grows the row', () => {
    const tasks: GanttTask[] = [
      { id: 'a', groupId: 'g', start: 0, end: 100 },
      { id: 'b', groupId: 'g', start: 10, end: 100 },
      { id: 'c', groupId: 'g', start: 20, end: 100 },
    ];
    // Growing rows are what this is about, so the uniform default is off.
    const engine = new GanttEngine({
      tasks,
      options: { minTimeSpan: 1, metrics: { uniformRowHeight: false } },
    });
    expect([laneOf(engine, 'a'), laneOf(engine, 'b'), laneOf(engine, 'c')]).toEqual([0, 1, 2]);

    const row = engine.getLayout().rows[0];
    expect(row.laneCount).toBe(3);
    const { laneHeight, rowPaddingY } = engine.getOptions().metrics;
    expect(row.height).toBeCloseTo(3 * laneHeight + 2 * resolveLength(rowPaddingY, row.height));
  });

  it('honours minGap when deciding whether two tasks may share a lane', () => {
    const tasks: GanttTask[] = [
      { id: 'a', groupId: 'g', start: 0, end: 10 },
      { id: 'b', groupId: 'g', start: 15, end: 25 },
    ];
    const shared = new GanttEngine({ tasks, options: { minTimeSpan: 1, stacking: { minGap: 3 } } });
    expect(laneOf(shared, 'b')).toBe(0);

    const split = new GanttEngine({ tasks, options: { minTimeSpan: 1, stacking: { minGap: 20 } } });
    expect(laneOf(split, 'b')).toBe(1);
  });

  it('separates milestones that fall on the same instant', () => {
    const tasks: GanttTask[] = [
      { id: 'm1', groupId: 'g', start: 500, end: 500 },
      { id: 'm2', groupId: 'g', start: 500, end: 500 },
      { id: 'm3', groupId: 'g', start: 900, end: 900 },
    ];
    const engine = new GanttEngine({ tasks, options: { minTimeSpan: 1 } });
    expect(laneOf(engine, 'm1')).toBe(0);
    expect(laneOf(engine, 'm2')).toBe(1);
    // A later milestone is free to reuse lane 0.
    expect(laneOf(engine, 'm3')).toBe(0);
  });

  it('pins tasks that declare an explicit lane', () => {
    const tasks: GanttTask[] = [
      { id: 'a', groupId: 'g', start: 0, end: 10, lane: 2 },
      { id: 'b', groupId: 'g', start: 0, end: 10 },
    ];
    const engine = new GanttEngine({ tasks, options: { minTimeSpan: 1 } });
    expect(laneOf(engine, 'a')).toBe(2);
    expect(laneOf(engine, 'b')).toBe(0);
    expect(engine.getLayout().rows[0].laneCount).toBe(3);
  });

  it('keeps floating tasks out of overlap detection', () => {
    const tasks: GanttTask[] = [
      { id: 'float', groupId: 'g', start: 0, end: 100, floating: true },
      { id: 'a', groupId: 'g', start: 0, end: 100 },
    ];
    const engine = new GanttEngine({ tasks, options: { minTimeSpan: 1 } });
    expect(laneOf(engine, 'float')).toBe(0);
    expect(laneOf(engine, 'a')).toBe(0);
    expect(engine.getLayout().rows[0].laneCount).toBe(1);
  });

  it('collapses everything to one lane when stacking is disabled', () => {
    const tasks: GanttTask[] = [
      { id: 'a', groupId: 'g', start: 0, end: 100 },
      { id: 'b', groupId: 'g', start: 0, end: 100 },
    ];
    const engine = new GanttEngine({ tasks, options: { minTimeSpan: 1, stacking: { enabled: false } } });
    expect([laneOf(engine, 'a'), laneOf(engine, 'b')]).toEqual([0, 0]);
    expect(engine.getLayout().rows[0].laneCount).toBe(1);
  });

  it('never places two overlapping tasks in the same lane (randomized)', () => {
    const { tasks, groups } = generate({ groupCount: 6, tasksPerGroup: 250, seed: 7, domain: [0, 20_000] });
    const engine = new GanttEngine({ tasks, groups, options: { minTimeSpan: 1 } });
    const layout = engine.getLayout();
    const model = engine.getDataModel();

    for (let r = 0; r < layout.rows.length; r++) {
      const from = layout.rowOffsets[r];
      const to = layout.rowOffsets[r + 1];
      // Tasks are visited in start order, so the previous occupant of a lane is
      // the only one that could overlap the current task.
      const laneEnd = new Map<number, number>();
      for (let rank = from; rank < to; rank++) {
        const index = layout.rankToTask[rank];
        const lane = layout.taskLane[index];
        const start = model.starts[index];
        const end = model.ends[index];
        const previousEnd = laneEnd.get(lane);
        if (previousEnd !== undefined) {
          // Half-open intervals: sharing a lane requires start >= previous end.
          expect(start).toBeGreaterThanOrEqual(previousEnd);
        }
        laneEnd.set(lane, Math.max(end, start));
      }
    }
  });

  it('uses the minimum possible number of lanes (matches peak concurrency)', () => {
    const random = mulberry32(42);
    const tasks: GanttTask[] = [];
    for (let i = 0; i < 400; i++) {
      const start = Math.floor(random() * 2000);
      tasks.push({ id: `t${i}`, groupId: 'g', start, end: start + 1 + Math.floor(random() * 200) });
    }
    const engine = new GanttEngine({ tasks, options: { minTimeSpan: 1 } });

    // Peak concurrency is the chromatic number of an interval graph, which
    // first-fit-by-start-time achieves exactly.
    const events: Array<[number, number]> = [];
    for (const task of tasks) {
      events.push([task.start, 1], [task.end, -1]);
    }
    events.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    let concurrent = 0;
    let peak = 0;
    for (const [, delta] of events) {
      concurrent += delta;
      if (concurrent > peak) peak = concurrent;
    }

    expect(engine.getLayout().rows[0].laneCount).toBe(peak);
  });
});

describe('uniform row heights', () => {
  /** Row 'flat' takes one lane, row 'stacked' takes three. */
  const TASKS: GanttTask[] = [
    { id: 'a', groupId: 'flat', start: 0, end: 10 },
    { id: 'b', groupId: 'flat', start: 10, end: 20 },
    { id: 'c', groupId: 'stacked', start: 0, end: 100 },
    { id: 'd', groupId: 'stacked', start: 10, end: 100 },
    { id: 'e', groupId: 'stacked', start: 20, end: 100 },
  ];

  const uniform = (): GanttEngine =>
    new GanttEngine({
      tasks: TASKS,
      size: { width: 1000, height: 400 },
      options: { minTimeSpan: 1, metrics: { uniformRowHeight: true } },
    });

  it('gives every row the same height and divides the lanes out of it', () => {
    const engine = uniform();
    const { laneHeight, rowPaddingY, minRowHeight } = engine.getOptions().metrics;
    const layout = engine.getLayout();
    const [flat, stacked] = layout.rows;
    // The height a single-lane row takes, floored by minRowHeight. With a
    // percentage padding that is the height whose own padding leaves exactly
    // one lane, so it is read back off the row rather than added up here.
    const expected = flat.height;
    expect(expected).toBeGreaterThanOrEqual(minRowHeight);
    expect(expected - 2 * resolveLength(rowPaddingY, expected)).toBeCloseTo(laneHeight);

    expect(layout.rows.map((row) => row.height)).toEqual([expected, expected]);
    expect(layout.totalHeight).toBe(expected * 2);

    expect(flat.laneCount).toBe(1);
    expect(stacked.laneCount).toBe(3);
    // Same usable space, three ways: a third of the lane height each.
    expect(stacked.laneHeight).toBeCloseTo(flat.laneHeight / 3);
    // Every uniform row gets the same inset, whatever its stack depth — the
    // point of measuring the padding against the row.
    expect(stacked.laneOffset).toBeCloseTo(resolveLength(rowPaddingY, stacked.height));
    expect(stacked.laneOffset).toBeCloseTo(flat.laneOffset);
  });

  it('shrinks stacked bars to fit and keeps them inside the row', () => {
    const engine = uniform();
    engine.viewport.setTimeRange(0, 100);
    const layout = engine.getLayout();
    const items = engine.getVisible().items;

    const flatBar = items.find((item) => item.task.id === 'a')!;
    const stackedBars = items.filter((item) => item.task.id !== 'a' && item.task.id !== 'b');
    expect(stackedBars).toHaveLength(3);

    for (const bar of stackedBars) {
      expect(bar.height).toBeLessThan(flatBar.height);
      const row = layout.rows[bar.rowIndex];
      expect(bar.y).toBeGreaterThanOrEqual(row.y);
      expect(bar.y + bar.height).toBeLessThanOrEqual(row.y + row.height);
    }
    // Lanes stay in order and do not overlap.
    const tops = stackedBars.map((bar) => bar.y).sort((x, y) => x - y);
    expect(tops[1]).toBeGreaterThanOrEqual(tops[0]);
    expect(tops[2]).toBeGreaterThanOrEqual(tops[1]);
  });

  it('hit-tests the compressed lanes', () => {
    const engine = uniform();
    engine.viewport.setTimeRange(0, 100);
    const row = engine.getLayout().rows[1];

    for (const [lane, id] of [
      [0, 'c'],
      [1, 'd'],
      [2, 'e'],
    ] as const) {
      // Middle of the lane, in plot pixels (scrollTop is 0).
      const y = row.y + row.laneOffset + (lane + 0.5) * row.laneHeight;
      const hit = engine.hitTest({ x: 500, y });
      expect(hit.lane).toBe(lane);
      expect(hit.task?.id).toBe(id);
    }
  });

  it('only shrinks bars that actually collide with something', () => {
    const tasks: GanttTask[] = [
      // A three-deep pile-up, then a task on its own further along the row.
      { id: 'c', groupId: 'mixed', start: 0, end: 100 },
      { id: 'd', groupId: 'mixed', start: 10, end: 100 },
      { id: 'e', groupId: 'mixed', start: 20, end: 100 },
      { id: 'alone', groupId: 'mixed', start: 200, end: 300 },
    ];
    const engine = new GanttEngine({
      tasks,
      size: { width: 1000, height: 400 },
      options: { minTimeSpan: 1, metrics: { uniformRowHeight: true } },
    });
    engine.viewport.setTimeRange(0, 300);

    const layout = engine.getLayout();
    const row = layout.rows[0];
    const available = row.laneCount * row.laneHeight;
    const laneHeightOf = (id: string): number =>
      layout.taskLaneHeight[engine.getDataModel().taskIndexById.get(id)!];

    // The pile-up splits the band three ways; the loner keeps all of it.
    expect(laneHeightOf('c')).toBeCloseTo(available / 3);
    expect(laneHeightOf('alone')).toBeCloseTo(available);

    const items = engine.getVisible().items;
    const bar = (id: string): (typeof items)[number] => items.find((item) => item.task.id === id)!;
    expect(bar('alone').height).toBeGreaterThan(bar('c').height);
    const { itemPaddingY } = engine.getOptions().metrics;
    expect(bar('alone').y).toBe(row.y + row.laneOffset + barInset(available, itemPaddingY));
    expect(bar('alone').y + bar('alone').height).toBeLessThanOrEqual(row.y + row.height);
  });

  it('treats a chain of overlaps as one cluster', () => {
    // a–b overlap and b–c overlap, so all three share the row even though a and
    // c never touch. Peak concurrency is 2, so each gets half the band.
    const tasks: GanttTask[] = [
      { id: 'a', groupId: 'g', start: 0, end: 10 },
      { id: 'b', groupId: 'g', start: 5, end: 20 },
      { id: 'c', groupId: 'g', start: 15, end: 25 },
    ];
    const engine = new GanttEngine({
      tasks,
      options: { minTimeSpan: 1, metrics: { uniformRowHeight: true } },
    });
    const layout = engine.getLayout();
    const row = layout.rows[0];
    const available = row.laneCount * row.laneHeight;

    for (const id of ['a', 'b', 'c']) {
      const index = engine.getDataModel().taskIndexById.get(id)!;
      expect(layout.taskLaneHeight[index]).toBeCloseTo(available / 2);
    }
  });

  it('hit-tests a full-height bar anywhere down the row', () => {
    const tasks: GanttTask[] = [
      { id: 'c', groupId: 'mixed', start: 0, end: 100 },
      { id: 'd', groupId: 'mixed', start: 10, end: 100 },
      { id: 'alone', groupId: 'mixed', start: 200, end: 300 },
    ];
    const engine = new GanttEngine({
      tasks,
      size: { width: 1000, height: 400 },
      options: { minTimeSpan: 1, metrics: { uniformRowHeight: true } },
    });
    engine.viewport.setTimeRange(0, 300);
    const row = engine.getLayout().rows[0];

    // Bottom lane of the row: inside the loner, but in lane 1 of the pile-up.
    const low = row.y + row.laneOffset + row.laneCount * row.laneHeight - 1;
    expect(engine.hitTest({ x: 833, y: low }).task?.id).toBe('alone');
    expect(engine.hitTest({ x: 100, y: low }).task?.id).toBe('d');
    // Top lane at the same time still finds the other half of the pile-up.
    const high = row.y + row.laneOffset + 1;
    expect(engine.hitTest({ x: 100, y: high }).task?.id).toBe('c');
  });

  it('lets a group height override the uniform height', () => {
    const engine = new GanttEngine({
      tasks: TASKS,
      groups: [{ id: 'flat' }, { id: 'stacked', height: 90 }],
      options: { minTimeSpan: 1, metrics: { uniformRowHeight: true } },
    });
    const { rowPaddingY } = engine.getOptions().metrics;
    const row = engine.getLayout().rows[1];

    expect(row.height).toBe(90);
    // The padding is resolved against the override, so it scales with it.
    expect(row.laneHeight).toBeCloseTo((90 - resolveLength(rowPaddingY, 90) * 2) / 3);
  });

  it('leaves rows growing with the stack when the option is off', () => {
    const engine = new GanttEngine({
      tasks: TASKS,
      options: { minTimeSpan: 1, metrics: { uniformRowHeight: false } },
    });
    const { laneHeight, rowPaddingY } = engine.getOptions().metrics;
    const [flat, stacked] = engine.getLayout().rows;

    expect(stacked.height).toBeCloseTo(
      3 * laneHeight + resolveLength(rowPaddingY, stacked.height) * 2,
    );
    expect(stacked.height).toBeGreaterThan(flat.height);
    expect(stacked.laneHeight).toBe(laneHeight);
  });
});
