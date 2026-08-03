import { describe, expect, it, vi } from 'vitest';
import { Store, shallowEqual } from '../src/store/store';
import { GanttEngine } from '../src/GanttEngine';
import { GanttHistory, applyChanges } from '../src/history';
import type { TaskChange } from '../src/types';

describe('Store', () => {
  it('drops patches that change nothing', () => {
    const store = new Store({ a: 1, b: 'x' });
    const listener = vi.fn();
    store.subscribe(listener);

    expect(store.setState({ a: 1 })).toBe(false);
    expect(listener).not.toHaveBeenCalled();

    expect(store.setState({ a: 2 })).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('coalesces a batch into one notification', () => {
    const store = new Store({ a: 1, b: 2 });
    const listener = vi.fn();
    store.subscribe(listener);

    store.batch(() => {
      store.setState({ a: 10 });
      store.setState({ b: 20 });
    });

    expect(listener).toHaveBeenCalledTimes(1);
    expect(store.getState()).toEqual({ a: 10, b: 20 });
  });

  it('produces a fresh snapshot object per accepted mutation', () => {
    const store = new Store({ a: 1 });
    const first = store.getState();
    store.setState({ a: 2 });
    expect(store.getState()).not.toBe(first);
    expect(first.a).toBe(1);
  });

  it('notifies selector subscribers only on a real change', () => {
    const store = new Store({ a: 1, b: 1 });
    const listener = vi.fn();
    store.subscribeSelector((state) => state.a, listener);

    store.setState({ b: 2 });
    expect(listener).not.toHaveBeenCalled();

    store.setState({ a: 5 });
    expect(listener).toHaveBeenCalledWith(5, 1);
  });

  it('shallowEqual compares one level deep', () => {
    expect(shallowEqual({ a: 1 }, { a: 1 })).toBe(true);
    expect(shallowEqual({ a: 1 }, { a: 2 })).toBe(false);
    expect(shallowEqual({ a: { b: 1 } }, { a: { b: 1 } })).toBe(false);
  });
});

describe('viewport', () => {
  const engine = (): GanttEngine =>
    new GanttEngine({
      tasks: [{ id: 't', groupId: 'g', start: 0, end: 1000 }],
      size: { width: 1000, height: 200 },
      options: { minTimeSpan: 1, timeDomain: [0, 10_000] },
    });

  it('keeps the anchor time under the cursor when zooming', () => {
    const chart = engine();
    chart.viewport.setTimeRange(0, 1000);
    // Zoom in 2x around the midpoint.
    chart.viewport.zoomAt(0.5, 500);
    expect(chart.viewport.state.timeStart).toBe(250);
    expect(chart.viewport.state.timeEnd).toBe(750);
  });

  it('clamps panning to the domain', () => {
    const chart = engine();
    chart.viewport.setTimeRange(0, 1000);
    chart.viewport.panByPx(-500);
    expect(chart.viewport.state.timeStart).toBe(0);

    chart.viewport.setTimeRange(9500, 10_500);
    expect(chart.viewport.state.timeEnd).toBe(10_000);
  });

  it('respects the zoom limits', () => {
    const chart = engine();
    chart.setOptions({ minTimeSpan: 100, maxTimeSpan: 5000 });
    chart.viewport.setTimeRange(0, 10);
    expect(chart.viewport.span).toBe(100);
    chart.viewport.setTimeRange(0, 100_000);
    expect(chart.viewport.span).toBe(5000);
  });

  it('clamps vertical scrolling to the content height', () => {
    const chart = engine();
    chart.viewport.scrollTo(10_000);
    expect(chart.viewport.state.scrollTop).toBe(Math.max(0, chart.totalHeight - 200));
    chart.viewport.scrollTo(-50);
    expect(chart.viewport.state.scrollTop).toBe(0);
  });

  it('emits viewport:change only when something moved', () => {
    const chart = engine();
    chart.viewport.setTimeRange(0, 1000);
    const listener = vi.fn();
    chart.on('viewport:change', listener);
    chart.viewport.setTimeRange(0, 1000);
    expect(listener).not.toHaveBeenCalled();
    chart.viewport.panByPx(10);
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe('history', () => {
  const change = (id: string, start: number, from: number): TaskChange => ({
    id,
    start,
    end: start + 10,
    groupId: 'g',
    previous: { start: from, end: from + 10, groupId: 'g' },
  });

  it('inverts a change set on undo and restores it on redo', () => {
    const history = new GanttHistory();
    expect(history.canUndo).toBe(false);

    history.push([change('a', 100, 0)], 'move');
    expect(history.canUndo).toBe(true);

    const undone = history.undo()!;
    expect(undone.changes[0]).toMatchObject({ id: 'a', start: 0, end: 10 });
    expect(history.canRedo).toBe(true);

    const redone = history.redo()!;
    expect(redone.changes[0]).toMatchObject({ id: 'a', start: 100, end: 110 });
  });

  it('clears the redo branch on a new edit', () => {
    const history = new GanttHistory();
    history.push([change('a', 100, 0)]);
    history.undo();
    history.push([change('b', 50, 0)]);
    expect(history.canRedo).toBe(false);
  });

  it('honours the depth limit', () => {
    const history = new GanttHistory({ limit: 2 });
    history.push([change('a', 1, 0)]);
    history.push([change('b', 2, 0)]);
    history.push([change('c', 3, 0)]);
    expect(history.depth).toBe(2);
  });

  it('applyChanges returns a new array and leaves untouched tasks identical', () => {
    const tasks = [
      { id: 'a', groupId: 'g', start: 0, end: 10 },
      { id: 'b', groupId: 'g', start: 20, end: 30 },
    ];
    const next = applyChanges(tasks, [change('a', 100, 0)]);
    expect(next).not.toBe(tasks);
    expect(next[0]).toMatchObject({ start: 100, end: 110 });
    expect(next[1]).toBe(tasks[1]);
  });
});
