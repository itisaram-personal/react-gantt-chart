import { describe, expect, it } from 'vitest';
import { GanttEngine } from '../src/GanttEngine';
import { barInset, resolveLength } from '../src/engine/layout';
import type { GanttGroup, GanttTask } from '../src/types';

/** One flat row and one three-deep pile-up. */
const TASKS: GanttTask[] = [
  { id: 'flat', groupId: 'flat', start: 0, end: 100 },
  { id: 's1', groupId: 'stacked', start: 0, end: 100 },
  { id: 's2', groupId: 'stacked', start: 10, end: 100 },
  { id: 's3', groupId: 'stacked', start: 20, end: 100 },
];

function makeEngine(
  metrics: Record<string, unknown> = {},
  groups?: GanttGroup[],
): GanttEngine {
  return new GanttEngine({
    tasks: TASKS,
    groups,
    size: { width: 800, height: 400 },
    options: { minTimeSpan: 1, metrics },
  });
}

describe('resolveLength', () => {
  it('passes pixels through and resolves percentages against the basis', () => {
    expect(resolveLength(4, 200)).toBe(4);
    expect(resolveLength('10%', 200)).toBe(20);
    expect(resolveLength('0%', 200)).toBe(0);
  });

  it('refuses to let padding consume its box', () => {
    // Clamped at 45% a side, so two sides always leave content behind.
    expect(resolveLength('80%', 100)).toBe(45);
    expect(resolveLength(-8, 100)).toBe(0);
    expect(resolveLength(Number.NaN, 100)).toBe(0);
  });
});

describe('percentage row padding', () => {
  it('solves the uniform row height so one lane fits inside its own padding', () => {
    const engine = makeEngine({ rowPaddingY: '20%', minRowHeight: 0, laneHeight: 20 });
    const [flat] = engine.getLayout().rows;

    // 20 / (1 - 0.4) = 33.33, of which 20% either side is padding.
    expect(flat.height).toBeCloseTo(33.333, 3);
    expect(flat.laneOffset).toBeCloseTo(6.667, 3);
    expect(flat.height - flat.laneOffset * 2).toBeCloseTo(20);
  });

  it('gives every uniform row the same inset whatever its stack depth', () => {
    const [flat, stacked] = makeEngine({ rowPaddingY: '20%' }).getLayout().rows;

    expect(stacked.laneCount).toBe(3);
    expect(stacked.height).toBe(flat.height);
    // The point of measuring against the row: bar tops line up across rows.
    expect(stacked.laneOffset).toBeCloseTo(flat.laneOffset);
    expect(stacked.laneHeight).toBeCloseTo(flat.laneHeight / 3);
  });

  it('scales with a group height override', () => {
    const rows = makeEngine({ rowPaddingY: '10%' }, [
      { id: 'flat' },
      { id: 'stacked', height: 200 },
    ]).getLayout().rows;

    expect(rows[1].height).toBe(200);
    expect(rows[1].laneOffset).toBeCloseTo(20);
    expect(rows[0].laneOffset).toBeLessThan(rows[1].laneOffset);
  });

  it('holds its proportion when the rows are rescaled to fit', () => {
    const engine = makeEngine({ rowPaddingY: '12%' });
    const before = engine.getLayout().rows[0];
    const ratio = before.laneOffset / before.height;

    // What "fit every row on screen" does: scale the pixel metrics only.
    engine.setOptions({ metrics: { laneHeight: 4, minRowHeight: 4 } });
    const after = engine.getLayout().rows[0];

    expect(after.height).toBeLessThan(before.height / 4);
    expect(after.laneOffset / after.height).toBeCloseTo(ratio, 6);
  });

  it('still accepts plain pixels', () => {
    const [flat] = makeEngine({ rowPaddingY: 4, laneHeight: 26, minRowHeight: 0 }).getLayout().rows;
    expect(flat.height).toBe(34);
    expect(flat.laneOffset).toBe(4);
  });

  it('grows a non-uniform row by the same proportion at any depth', () => {
    const [flat, stacked] = makeEngine({
      rowPaddingY: '10%',
      minRowHeight: 0,
      uniformRowHeight: false,
    }).getLayout().rows;

    // Padding is 10% of whatever height the stack ends up needing, so a deep
    // row looks like a shallow one rather than gaining a fixed hairline.
    expect(flat.laneOffset / flat.height).toBeCloseTo(0.1, 6);
    expect(stacked.laneOffset / stacked.height).toBeCloseTo(0.1, 6);
    expect(stacked.height).toBeCloseTo(flat.height * 3, 6);
  });
});

describe('percentage item padding', () => {
  it('insets a bar by a share of the lane it was given', () => {
    const engine = makeEngine({ itemPaddingY: '10%', rowPaddingY: 0, laneHeight: 40, minRowHeight: 0 });
    const [flat, stacked] = engine.getLayout().rows;

    expect(barInset(flat.laneHeight, '10%')).toBeCloseTo(4);
    // The stacked row's lanes are a third as tall, so their bars are inset a
    // third as much — the same look at any density.
    expect(barInset(stacked.laneHeight, '10%')).toBeCloseTo(4 / 3);
  });

  it('keeps the quarter-lane cap', () => {
    // 40% would leave nothing; the cap wins for both units.
    expect(barInset(20, '40%')).toBe(5);
    expect(barInset(20, 9)).toBe(5);
  });

  it('reaches the rendered bar', () => {
    const engine = makeEngine({ itemPaddingY: '10%', rowPaddingY: 0, laneHeight: 40, minRowHeight: 0 });
    engine.viewport.setTimeRange(0, 100);
    const row = engine.getLayout().rows[0];
    const bar = engine.getVisible().items.find((item) => item.task.id === 'flat')!;

    expect(bar.y).toBeCloseTo(row.y + row.laneOffset + 4);
    expect(bar.height).toBeCloseTo(row.laneHeight - 8);
  });
});
