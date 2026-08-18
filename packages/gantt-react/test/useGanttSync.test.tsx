// @vitest-environment jsdom
import { createElement, useState, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import type { GanttEngine } from '@gantt-chart/core';
import { GanttChart } from '../src/GanttChart';
import { useGanttSync } from '../src/useGanttSync';
import { DAY, T0, fixtureData, installLayout } from './dom';

/*
 * Three charts is the case the hook exists for: two would not tell a following
 * chart apart from a leading one, and the third is what catches a propagation
 * that stops at the first target.
 */
const NARROW = fixtureData({ groups: 3, tasksPerGroup: 4 });
const WIDE = fixtureData({ groups: 6, tasksPerGroup: 20 });

interface GroupHandle {
  engines: () => (GanttEngine | null)[];
  /** Re-render the parent without changing anything the hook should react to. */
  touch: () => void;
  setCount: (count: number) => void;
  unmount: () => void;
}

const open: GroupHandle[] = [];
afterEach(() => {
  while (open.length) open.pop()!.unmount();
});

/**
 * Mount `count` synced charts, the last of which carries the wide dataset so
 * the group has more than one time domain in it.
 */
function mountGroup(count = 3, options?: Parameters<typeof useGanttSync>[1]): GroupHandle {
  installLayout();
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

  const captured: (GanttEngine | null)[] = [];
  let touch: () => void = () => {};
  let setCount: (next: number) => void = () => {};

  function Group(): ReactElement {
    const [charts, setCharts] = useState(count);
    const [, setTick] = useState(0);
    const [a, setA] = useState<GanttEngine | null>(null);
    const [b, setB] = useState<GanttEngine | null>(null);
    const [c, setC] = useState<GanttEngine | null>(null);

    touch = () => setTick((tick) => tick + 1);
    setCount = setCharts;

    // A fresh array literal every render, as a caller would write it.
    useGanttSync([a, b, c].slice(0, charts), options);
    captured.length = 0;
    captured.push(a, b, c);

    const setters = [setA, setB, setC];
    const data = [NARROW, NARROW, WIDE];
    return createElement(
      'div',
      null,
      ...setters.slice(0, charts).map((setter, index) =>
        createElement(GanttChart as never, {
          key: index,
          renderer: 'svg',
          tasks: data[index].tasks,
          groups: data[index].groups,
          engineRef: setter,
          showTimeZoomBar: true,
          showRowZoomBar: true,
        } as never),
      ),
    );
  }

  const container = document.createElement('div');
  document.body.appendChild(container);
  let root: Root;
  act(() => {
    root = createRoot(container);
    root.render(createElement(Group));
  });

  const handle: GroupHandle = {
    engines: () => captured.slice(),
    touch: () => act(() => touch()),
    setCount: (next) => act(() => setCount(next)),
    unmount: () => act(() => root.unmount()),
  };
  open.push(handle);
  return handle;
}

const timeOf = (engine: GanttEngine): [number, number] => [
  engine.viewport.state.timeStart,
  engine.viewport.state.timeEnd,
];

describe('useGanttSync', () => {
  it('links three mounted charts on both axes', () => {
    const group = mountGroup();
    const [a, b, c] = group.engines();
    expect(a && b && c).toBeTruthy();

    act(() => b!.viewport.setTimeRange(T0 + DAY, T0 + 2 * DAY));
    expect(timeOf(a!)).toEqual([T0 + DAY, T0 + 2 * DAY]);
    expect(timeOf(c!)).toEqual([T0 + DAY, T0 + 2 * DAY]);

    act(() => c!.setOptions({ metrics: { laneHeight: 40 } }));
    expect(a!.getOptions().metrics.laneHeight).toBe(40);
    expect(b!.getOptions().metrics.laneHeight).toBe(40);

    act(() => c!.viewport.scrollTo(c!.totalHeight / 3));
    const fraction = (engine: GanttEngine): number =>
      engine.viewport.state.scrollTop / engine.totalHeight;
    expect(fraction(a!)).toBeCloseTo(fraction(c!), 6);
  });

  it('does not re-adopt on a plain re-render', () => {
    const group = mountGroup();
    const [a, , c] = group.engines();

    // Past the narrow charts' domain, so `a` clamps and the group genuinely
    // disagrees — which is what a spurious re-sync would flatten.
    act(() => c!.viewport.setTimeRange(T0 + 30 * DAY, T0 + 32 * DAY));
    const wide = timeOf(c!);
    expect(timeOf(a!)).not.toEqual(wide);

    group.touch();
    expect(timeOf(c!)).toEqual(wide);
  });

  it('re-forms the group when a chart unmounts', () => {
    const group = mountGroup();
    const [, , c] = group.engines();

    group.setCount(2);
    const [a, b] = group.engines();

    act(() => a!.viewport.setTimeRange(T0 + 2 * DAY, T0 + 3 * DAY));
    expect(timeOf(b!)).toEqual([T0 + 2 * DAY, T0 + 3 * DAY]);
    // The unmounted chart's engine is disposed and no longer follows.
    expect(timeOf(c!)).not.toEqual([T0 + 2 * DAY, T0 + 3 * DAY]);
  });

  it('waits for a second chart before linking anything', () => {
    const group = mountGroup(1);
    const [a] = group.engines();
    act(() => a!.viewport.setTimeRange(T0 + DAY, T0 + 2 * DAY));

    group.setCount(2);
    const [, b] = group.engines();
    // The group forms with the first chart's window, and moves together after.
    expect(timeOf(b!)).toEqual([T0 + DAY, T0 + 2 * DAY]);

    act(() => b!.viewport.setTimeRange(T0 + 3 * DAY, T0 + 4 * DAY));
    expect(timeOf(a!)).toEqual([T0 + 3 * DAY, T0 + 4 * DAY]);
  });

  it('honours the axis switches', () => {
    const group = mountGroup(3, { rows: false });
    const [a, b] = group.engines();

    act(() => {
      a!.viewport.setTimeRange(T0 + DAY, T0 + 2 * DAY);
      a!.viewport.scrollTo(60);
    });
    expect(timeOf(b!)).toEqual([T0 + DAY, T0 + 2 * DAY]);
    expect(b!.viewport.state.scrollTop).toBe(0);
  });
});
