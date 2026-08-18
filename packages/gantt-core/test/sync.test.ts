import { describe, expect, it } from 'vitest';
import { GanttEngine } from '../src/GanttEngine';
import { syncGanttViewports } from '../src/engine/sync';
import { generate } from './helpers';

const DAY = 86_400_000;
/** 2026-03-02 00:00 UTC. */
const T0 = Date.UTC(2026, 2, 2);

const WIDTH = 800;
const HEIGHT = 400;

/** A chart with `groupCount` rows over `[T0, T0 + days)`. */
function chart(groupCount: number, days = 30): GanttEngine {
  const { tasks, groups } = generate({
    groupCount,
    tasksPerGroup: 3,
    domain: [T0, T0 + days * DAY],
    maxDuration: DAY,
  });
  const engine = new GanttEngine({ tasks, groups, size: { width: WIDTH, height: HEIGHT }, warn: false });
  engine.viewport.fitTime(0);
  return engine;
}

const timeOf = (engine: GanttEngine): [number, number] => [
  engine.viewport.state.timeStart,
  engine.viewport.state.timeEnd,
];

/** Where the vertical bar's window sits: scroll as a fraction of content. */
const fractionOf = (engine: GanttEngine): number =>
  engine.totalHeight > 0 ? engine.viewport.state.scrollTop / engine.totalHeight : 0;

describe('syncGanttViewports', () => {
  it('moves the whole group from whichever chart moved', () => {
    const [a, b, c] = [chart(20), chart(20), chart(20)];
    const stop = syncGanttViewports([a, b, c]);

    b.viewport.setTimeRange(T0 + 5 * DAY, T0 + 9 * DAY);
    expect(timeOf(a)).toEqual([T0 + 5 * DAY, T0 + 9 * DAY]);
    expect(timeOf(c)).toEqual([T0 + 5 * DAY, T0 + 9 * DAY]);

    // No leader: the last chart drives the other two just the same.
    c.viewport.setTimeRange(T0 + 12 * DAY, T0 + 13 * DAY);
    expect(timeOf(a)).toEqual([T0 + 12 * DAY, T0 + 13 * DAY]);
    expect(timeOf(b)).toEqual([T0 + 12 * DAY, T0 + 13 * DAY]);

    stop();
  });

  it('adopts the first chart on sync, and can be told not to', () => {
    const [a, b] = [chart(20), chart(20)];
    a.viewport.setTimeRange(T0 + DAY, T0 + 2 * DAY);
    b.viewport.setTimeRange(T0 + 8 * DAY, T0 + 9 * DAY);

    const stop = syncGanttViewports([a, b]);
    expect(timeOf(b)).toEqual(timeOf(a));
    stop();

    const [c, d] = [chart(20), chart(20)];
    c.viewport.setTimeRange(T0 + DAY, T0 + 2 * DAY);
    d.viewport.setTimeRange(T0 + 8 * DAY, T0 + 9 * DAY);

    const stopLater = syncGanttViewports([c, d], { adopt: false });
    expect(timeOf(d)).toEqual([T0 + 8 * DAY, T0 + 9 * DAY]);
    stopLater();
  });

  it('leaves the group alone once torn down', () => {
    const [a, b] = [chart(20), chart(20)];
    syncGanttViewports([a, b])();

    a.viewport.setTimeRange(T0 + 5 * DAY, T0 + 6 * DAY);
    expect(timeOf(b)).not.toEqual(timeOf(a));
  });

  it('shares dates rather than bar positions across unequal domains', () => {
    const wide = chart(20, 60);
    const narrow = chart(20, 30);
    const stop = syncGanttViewports([wide, narrow], { adopt: false });

    wide.viewport.setTimeRange(T0 + 10 * DAY, T0 + 12 * DAY);
    expect(timeOf(narrow)).toEqual([T0 + 10 * DAY, T0 + 12 * DAY]);

    stop();
  });

  it('lets a follower clamp to its own domain without dragging the group back', () => {
    const wide = chart(20, 60);
    const narrow = chart(20, 30);
    const stop = syncGanttViewports([wide, narrow], { adopt: false });

    // Past the end of the narrow chart's data: it clamps, the source does not.
    wide.viewport.setTimeRange(T0 + 50 * DAY, T0 + 52 * DAY);
    expect(timeOf(wide)).toEqual([T0 + 50 * DAY, T0 + 52 * DAY]);
    expect(narrow.viewport.state.timeEnd).toBeLessThan(T0 + 52 * DAY);

    stop();
  });

  it('rescales rows and shows the same slice of each chart', () => {
    const short = chart(20);
    const long = chart(60);
    const stop = syncGanttViewports([short, long]);

    short.setOptions({ metrics: { laneHeight: 48 } });
    expect(long.getOptions().metrics.laneHeight).toBe(48);

    long.viewport.scrollTo(long.totalHeight / 2);
    expect(fractionOf(short)).toBeCloseTo(fractionOf(long), 6);

    stop();
  });

  it('holds each axis independently', () => {
    const [a, b] = [chart(40), chart(40)];
    const stop = syncGanttViewports([a, b], { rows: false, adopt: false });

    a.viewport.setTimeRange(T0 + 3 * DAY, T0 + 4 * DAY);
    a.viewport.scrollTo(200);
    expect(timeOf(b)).toEqual([T0 + 3 * DAY, T0 + 4 * DAY]);
    expect(b.viewport.state.scrollTop).toBe(0);
    stop();

    const [c, d] = [chart(40), chart(40)];
    const stopRows = syncGanttViewports([c, d], { time: false, adopt: false });

    const before = timeOf(d);
    c.viewport.setTimeRange(T0 + 3 * DAY, T0 + 4 * DAY);
    c.viewport.scrollTo(200);
    expect(timeOf(d)).toEqual(before);
    expect(d.viewport.state.scrollTop).toBe(200);
    stopRows();
  });

  it('ignores an option change that is not part of a zoom window', () => {
    const [a, b] = [chart(20), chart(20)];
    const stop = syncGanttViewports([a, b], { adopt: false });

    a.viewport.setTimeRange(T0 + 2 * DAY, T0 + 3 * DAY);
    b.viewport.setTimeRange(T0 + 6 * DAY, T0 + 7 * DAY);
    // Both charts now sit where the other put them; an unrelated option must
    // not be mistaken for a camera move and shove the group back.
    const settled = timeOf(a);
    a.setOptions({ snap: DAY });
    expect(timeOf(b)).toEqual(settled);

    stop();
  });

  it('is a no-op for a group that cannot be synced', () => {
    const a = chart(20);
    expect(syncGanttViewports([a])).toBeTypeOf('function');
    expect(() => syncGanttViewports([a])()).not.toThrow();

    const b = chart(20);
    const stop = syncGanttViewports([a, a, b], { time: false, rows: false });
    b.viewport.setTimeRange(T0 + DAY, T0 + 2 * DAY);
    expect(timeOf(a)).not.toEqual(timeOf(b));
    stop();
  });
});
