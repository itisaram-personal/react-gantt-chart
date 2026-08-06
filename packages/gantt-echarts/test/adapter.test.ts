import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { TaskChange } from '@gantt-chart/core';
import { lightTheme } from '@gantt-chart/themes';
import { GanttEChartsAdapter } from '../src/adapter';
import { DAY, T0, fixture } from './helpers';
import { fakeChart, fakeElement, keyEvent, pointerEvent, wheelEvent, type FakeChart, type FakeElement } from './fakeDom';

/**
 * Geometry of the fixture, so the coordinates below read as intent:
 *   viewport 800×400 showing 10 days  →  1 px = 18 minutes
 *   rows are 34px tall; bars sit at y = rowY + 7 with height 20
 *   task `gN-tM` spans day 2M → 2M+1, so `g0-t0` is x ∈ [0, 80]
 */
const MS_PER_PX = (10 * DAY) / 800;
const ON_BAR = { x: 40, y: 17 };
const EMPTY_SPACE = { x: 700, y: 17 };

interface Harness {
  adapter: GanttEChartsAdapter<{ label?: string }, unknown>;
  engine: ReturnType<typeof fixture>['engine'];
  dom: FakeElement;
  chart: FakeChart;
}

function harness(options: Parameters<typeof fixture>[0] = {}): Harness {
  const { engine } = fixture(options);
  const chart = fakeChart(options.width ?? 800, options.height ?? 400);
  const dom = fakeElement();
  const adapter = new GanttEChartsAdapter(engine, { theme: lightTheme, now: () => null });
  adapter.attach(chart, dom.element);
  return { adapter, engine, dom, chart };
}

let active: Harness | null = null;

function setup(options: Parameters<typeof fixture>[0] = {}): Harness {
  active = harness(options);
  return active;
}

afterEach(() => {
  active?.adapter.dispose();
  active = null;
});

describe('attach / detach', () => {
  it('adopts the chart size as the viewport and renders once', () => {
    const { engine, chart } = setup();
    expect(engine.viewport.state.width).toBe(800);
    expect(engine.viewport.state.height).toBe(400);
    expect(chart.options).toHaveLength(1);
  });

  it('binds the input handlers it is configured for', () => {
    const { dom } = setup();
    expect(dom.boundTypes()).toEqual(
      expect.arrayContaining(['pointerdown', 'pointermove', 'pointerup', 'wheel', 'keydown', 'contextmenu', 'dblclick']),
    );
  });

  it('can be attached without input handling', () => {
    const { engine } = fixture();
    const adapter = new GanttEChartsAdapter(engine, {
      theme: lightTheme,
      pointer: false,
      wheel: false,
      keyboard: false,
    });
    const dom = fakeElement();
    adapter.attach(fakeChart(), dom.element);
    expect(dom.boundTypes()).toEqual([]);
    adapter.dispose();
  });

  it('releases listeners and stops rendering on detach', () => {
    const { adapter, engine, dom, chart } = setup();
    adapter.detach();
    expect(dom.boundTypes()).toEqual([]);

    const before = chart.options.length;
    engine.selection.set(['g0-t0']);
    adapter.render();
    expect(chart.options).toHaveLength(before);
  });

  it('resizes the chart and the viewport together', () => {
    const { adapter, engine, chart } = setup();
    adapter.resize(500, 250);
    expect(chart.resizes.at(-1)).toEqual({ width: 500, height: 250 });
    expect(engine.viewport.state.width).toBe(500);
    expect(engine.viewport.state.height).toBe(250);
  });
});

describe('click and selection', () => {
  it('selects a bar on press so the same gesture can drag it', () => {
    const { engine, dom } = setup();
    dom.dispatch('pointerdown', pointerEvent(ON_BAR.x, ON_BAR.y));
    expect(Array.from(engine.selection.selected)).toEqual(['g0-t0']);
    expect(dom.captured).toEqual([1]);
    expect(dom.focused).toBe(1);
  });

  it('emits task:click when the press never became a drag', () => {
    const { engine, dom } = setup();
    const clicks: string[] = [];
    engine.on('task:click', (payload) => clicks.push(String(payload.task.id)));

    dom.dispatch('pointerdown', pointerEvent(ON_BAR.x, ON_BAR.y));
    dom.dispatch('pointermove', pointerEvent(ON_BAR.x + 1, ON_BAR.y));
    dom.dispatch('pointerup', pointerEvent(ON_BAR.x + 1, ON_BAR.y));

    expect(clicks).toEqual(['g0-t0']);
    expect(engine.drag.state).toBeNull();
    expect(dom.released).toEqual([1]);
  });

  it('deselects an already-selected bar on ctrl-click', () => {
    const { engine, dom } = setup();
    dom.dispatch('pointerdown', pointerEvent(ON_BAR.x, ON_BAR.y));
    dom.dispatch('pointerup', pointerEvent(ON_BAR.x, ON_BAR.y));
    expect(engine.selection.isSelected('g0-t0')).toBe(true);

    // Toggling off has to happen on release: on press the task is still needed
    // as a potential drag subject.
    dom.dispatch('pointerdown', pointerEvent(ON_BAR.x, ON_BAR.y, { ctrl: true }));
    expect(engine.selection.isSelected('g0-t0')).toBe(true);
    dom.dispatch('pointerup', pointerEvent(ON_BAR.x, ON_BAR.y, { ctrl: true }));
    expect(engine.selection.isSelected('g0-t0')).toBe(false);
  });

  it('adds to the selection with ctrl-click on a new bar', () => {
    const { engine, dom } = setup();
    dom.dispatch('pointerdown', pointerEvent(ON_BAR.x, ON_BAR.y));
    dom.dispatch('pointerup', pointerEvent(ON_BAR.x, ON_BAR.y));
    // `g0-t1` spans day 2→3, i.e. x ∈ [160, 240].
    dom.dispatch('pointerdown', pointerEvent(200, ON_BAR.y, { ctrl: true }));
    dom.dispatch('pointerup', pointerEvent(200, ON_BAR.y, { ctrl: true }));

    expect(Array.from(engine.selection.selected).sort()).toEqual(['g0-t0', 'g0-t1']);
  });

  it('clears the selection when the background is clicked', () => {
    const { engine, dom } = setup();
    engine.selection.set(['g0-t0', 'g0-t1']);

    dom.dispatch('pointerdown', pointerEvent(EMPTY_SPACE.x, EMPTY_SPACE.y));
    dom.dispatch('pointerup', pointerEvent(EMPTY_SPACE.x, EMPTY_SPACE.y));
    expect(engine.selection.selected.size).toBe(0);
  });

  it('emits row:click for a click on empty space in a row', () => {
    const { engine, dom } = setup();
    const rows: number[] = [];
    engine.on('row:click', (payload) => rows.push(payload.row.index));

    dom.dispatch('pointerdown', pointerEvent(EMPTY_SPACE.x, 45));
    dom.dispatch('pointerup', pointerEvent(EMPTY_SPACE.x, 45));
    expect(rows).toEqual([1]);
  });
});

describe('drag', () => {
  it('moves the pressed bar and proposes a change on release', () => {
    const { engine, dom } = setup();
    const ends: { changes: TaskChange[]; cancelled: boolean }[] = [];
    engine.on('drag:end', (payload) => ends.push(payload));

    dom.dispatch('pointerdown', pointerEvent(ON_BAR.x, ON_BAR.y));
    dom.dispatch('pointermove', pointerEvent(ON_BAR.x + 100, ON_BAR.y));
    expect(engine.drag.isDragging).toBe(true);

    dom.dispatch('pointerup', pointerEvent(ON_BAR.x + 100, ON_BAR.y));

    expect(ends).toHaveLength(1);
    expect(ends[0].cancelled).toBe(false);
    expect(ends[0].changes).toHaveLength(1);

    const change = ends[0].changes[0];
    const expectedDelta = 100 * MS_PER_PX;
    expect(change.id).toBe('g0-t0');
    expect(change.start - change.previous.start).toBeCloseTo(expectedDelta, 6);
    expect(change.end - change.previous.end).toBeCloseTo(expectedDelta, 6);
    // The engine proposes; it never mutates the caller's data.
    expect(engine.getTask('g0-t0')?.start).toBe(T0);
  });

  it('does not fire a click for a gesture that did drag', () => {
    const { engine, dom } = setup();
    let clicks = 0;
    engine.on('task:click', () => clicks++);

    dom.dispatch('pointerdown', pointerEvent(ON_BAR.x, ON_BAR.y));
    dom.dispatch('pointermove', pointerEvent(ON_BAR.x + 60, ON_BAR.y));
    dom.dispatch('pointerup', pointerEvent(ON_BAR.x + 60, ON_BAR.y));
    expect(clicks).toBe(0);
  });

  it('ignores movement below the drag threshold', () => {
    const { engine, dom } = setup();
    let starts = 0;
    engine.on('drag:start', () => starts++);

    dom.dispatch('pointerdown', pointerEvent(ON_BAR.x, ON_BAR.y));
    dom.dispatch('pointermove', pointerEvent(ON_BAR.x + 2, ON_BAR.y + 1));
    expect(starts).toBe(0);
    expect(engine.drag.isDragging).toBe(false);
    dom.dispatch('pointerup', pointerEvent(ON_BAR.x + 2, ON_BAR.y + 1));
  });

  it('carries the whole selection, horizontally when it spans rows', () => {
    const { engine, dom } = setup();
    engine.selection.set(['g0-t0', 'g1-t0']);

    dom.dispatch('pointerdown', pointerEvent(ON_BAR.x, ON_BAR.y));
    dom.dispatch('pointermove', pointerEvent(ON_BAR.x + 100, ON_BAR.y + 40));
    expect(engine.drag.state?.mode).toBe('horizontal');
    expect(engine.drag.state?.deltaRow).toBe(0);

    const changes = engine.drag.preview();
    expect(changes.map((change) => change.id).sort()).toEqual(['g0-t0', 'g1-t0']);
    // Horizontal mode never reassigns groups.
    for (const change of changes) expect(change.groupId).toBe(change.previous.groupId);
    dom.dispatch('pointerup', pointerEvent(ON_BAR.x + 100, ON_BAR.y + 40));
  });

  it('moves a single-row selection between rows', () => {
    const { engine, dom } = setup();
    dom.dispatch('pointerdown', pointerEvent(ON_BAR.x, ON_BAR.y));
    // One row down: rows are 34px tall.
    dom.dispatch('pointermove', pointerEvent(ON_BAR.x + 10, ON_BAR.y + 34));
    expect(engine.drag.state?.mode).toBe('free');
    expect(engine.drag.state?.deltaRow).toBe(1);

    const [change] = engine.drag.preview();
    expect(change.groupId).toBe('g1');
    dom.dispatch('pointerup', pointerEvent(ON_BAR.x + 10, ON_BAR.y + 34));
  });

  it('resizes from an edge handle without moving the other edge', () => {
    const { engine, dom } = setup();
    // Within `resizeHandleWidth` of the bar's left edge at x = 0.
    dom.dispatch('pointerdown', pointerEvent(2, ON_BAR.y));
    expect(engine.drag.state?.mode).toBe('resize-start');

    dom.dispatch('pointermove', pointerEvent(42, ON_BAR.y));
    const [change] = engine.drag.preview();
    expect(change.start - change.previous.start).toBeCloseTo(40 * MS_PER_PX, 6);
    expect(change.end).toBe(change.previous.end);
    dom.dispatch('pointerup', pointerEvent(42, ON_BAR.y));
  });

  it('resizes from the right edge', () => {
    const { engine, dom } = setup();
    dom.dispatch('pointerdown', pointerEvent(78, ON_BAR.y));
    expect(engine.drag.state?.mode).toBe('resize-end');
    dom.dispatch('pointermove', pointerEvent(178, ON_BAR.y));

    const [change] = engine.drag.preview();
    expect(change.start).toBe(change.previous.start);
    expect(change.end - change.previous.end).toBeCloseTo(100 * MS_PER_PX, 6);
    dom.dispatch('pointerup', pointerEvent(178, ON_BAR.y));
  });

  it('snaps the delta when the engine asks for it', () => {
    const { engine, dom } = setup();
    engine.setOptions({ interaction: { snapMs: DAY } });

    dom.dispatch('pointerdown', pointerEvent(ON_BAR.x, ON_BAR.y));
    dom.dispatch('pointermove', pointerEvent(ON_BAR.x + 100, ON_BAR.y));
    const [change] = engine.drag.preview();
    // 100px is 1.25 days, which snaps to one.
    expect(change.start - change.previous.start).toBe(DAY);
    dom.dispatch('pointerup', pointerEvent(ON_BAR.x + 100, ON_BAR.y));
  });

  it('abandons the gesture on pointercancel', () => {
    const { engine, dom } = setup();
    const ends: { cancelled: boolean }[] = [];
    engine.on('drag:end', (payload) => ends.push(payload));

    dom.dispatch('pointerdown', pointerEvent(ON_BAR.x, ON_BAR.y));
    dom.dispatch('pointermove', pointerEvent(ON_BAR.x + 100, ON_BAR.y));
    dom.dispatch('pointercancel', pointerEvent(ON_BAR.x + 100, ON_BAR.y));

    expect(engine.drag.state).toBeNull();
    expect(ends).toHaveLength(1);
    expect(ends[0].cancelled).toBe(true);
  });

  it('respects a disabled drag interaction', () => {
    const { engine, dom } = setup();
    engine.setOptions({ interaction: { drag: false } });

    dom.dispatch('pointerdown', pointerEvent(ON_BAR.x, ON_BAR.y));
    dom.dispatch('pointermove', pointerEvent(ON_BAR.x + 100, ON_BAR.y));
    expect(engine.drag.state).toBeNull();
    // Selection still works — only the gesture is refused.
    expect(engine.selection.isSelected('g0-t0')).toBe(true);
    dom.dispatch('pointerup', pointerEvent(ON_BAR.x + 100, ON_BAR.y));
  });
});

describe('marquee', () => {
  it('tracks a rectangle in store state while dragging empty space', () => {
    const { engine, dom } = setup();
    dom.dispatch('pointerdown', pointerEvent(700, 20, { shift: true }));
    expect(engine.store.getState().marquee).toEqual({ x: 700, y: 20, width: 0, height: 0 });

    // Dragging up and to the left still yields a positive rectangle.
    dom.dispatch('pointermove', pointerEvent(500, 90, { shift: true }));
    expect(engine.store.getState().marquee).toEqual({ x: 500, y: 20, width: 200, height: 70 });

    dom.dispatch('pointerup', pointerEvent(500, 90, { shift: true }));
    expect(engine.store.getState().marquee).toBeNull();
  });

  it('selects every bar the rectangle covers and nothing outside it', () => {
    const { engine, dom } = setup();
    dom.dispatch('pointerdown', pointerEvent(700, 10, { shift: true }));
    dom.dispatch('pointermove', pointerEvent(100, 100, { shift: true }));
    dom.dispatch('pointerup', pointerEvent(100, 100, { shift: true }));

    const selected = Array.from(engine.selection.selected).map(String);
    expect(selected.length).toBeGreaterThan(0);

    const from = engine.viewport.pxToTime(100);
    const to = engine.viewport.pxToTime(700);
    for (const id of selected) {
      const task = engine.getTask(id)!;
      expect(task.start <= to && task.end >= from, `${id} intersects the marquee`).toBe(true);
    }
    // Day 0→1 sits left of the rectangle.
    expect(selected).not.toContain('g0-t0');
  });

  it('adds to the selection with ctrl and removes with alt', () => {
    const { engine, dom } = setup();
    // Remove mode is only reachable through an alt drag, which the default map
    // spends on panning — opt alt back into marquee to exercise the modes.
    engine.setOptions({ interaction: { backgroundDrag: { alt: 'marquee' } } });
    engine.selection.set(['g0-t0']);

    dom.dispatch('pointerdown', pointerEvent(700, 10, { ctrl: true }));
    dom.dispatch('pointermove', pointerEvent(100, 100, { ctrl: true }));
    dom.dispatch('pointerup', pointerEvent(100, 100, { ctrl: true }));
    expect(engine.selection.isSelected('g0-t0')).toBe(true);
    const grown = engine.selection.selected.size;
    expect(grown).toBeGreaterThan(1);

    dom.dispatch('pointerdown', pointerEvent(700, 10, { alt: true }));
    dom.dispatch('pointermove', pointerEvent(100, 100, { alt: true }));
    dom.dispatch('pointerup', pointerEvent(100, 100, { alt: true }));
    expect(engine.selection.selected.size).toBeLessThan(grown);
    expect(engine.selection.isSelected('g0-t0')).toBe(true);
  });

  it('pans the background instead when marquee is disabled', () => {
    const { engine, dom } = setup();
    engine.setOptions({ interaction: { marquee: false } });
    const before = engine.viewport.state.timeStart;

    // Shift marquees under the default map, so it is what the master switch
    // has to override; a plain drag already pans and would prove nothing.
    dom.dispatch('pointerdown', pointerEvent(400, 200, { shift: true }));
    dom.dispatch('pointermove', pointerEvent(300, 200, { shift: true }));
    dom.dispatch('pointerup', pointerEvent(300, 200, { shift: true }));

    expect(engine.store.getState().marquee).toBeNull();
    // Dragging content left moves the window forward in time.
    expect(engine.viewport.state.timeStart).toBeGreaterThan(before);
  });

  it('pans on middle-button drag', () => {
    const { engine, dom } = setup();
    const before = engine.viewport.state.timeStart;
    dom.dispatch('pointerdown', pointerEvent(400, 200, { button: 1 }));
    dom.dispatch('pointermove', pointerEvent(300, 200, { button: 1 }));
    dom.dispatch('pointerup', pointerEvent(300, 200, { button: 1 }));
    expect(engine.viewport.state.timeStart).toBeGreaterThan(before);
  });
});

describe('background drag modifier map', () => {
  it('pans on a plain drag by default, leaving the selection alone', () => {
    const { engine, dom } = setup();
    engine.selection.set(['g0-t0']);
    const before = engine.viewport.state.timeStart;

    dom.dispatch('pointerdown', pointerEvent(400, 200));
    dom.dispatch('pointermove', pointerEvent(300, 200));
    dom.dispatch('pointerup', pointerEvent(300, 200));

    expect(engine.store.getState().marquee).toBeNull();
    expect(engine.viewport.state.timeStart).toBeGreaterThan(before);
    expect(engine.selection.isSelected('g0-t0')).toBe(true);
  });

  it('marquees on shift and ctrl by default', () => {
    const { engine, dom } = setup();
    const before = engine.viewport.state.timeStart;

    dom.dispatch('pointerdown', pointerEvent(700, 10, { shift: true }));
    dom.dispatch('pointermove', pointerEvent(100, 100, { shift: true }));
    expect(engine.store.getState().marquee).not.toBeNull();
    dom.dispatch('pointerup', pointerEvent(100, 100, { shift: true }));
    expect(engine.selection.selected.size).toBeGreaterThan(0);
    expect(engine.viewport.state.timeStart).toBe(before);

    engine.selection.clear();
    dom.dispatch('pointerdown', pointerEvent(700, 10, { ctrl: true }));
    dom.dispatch('pointermove', pointerEvent(100, 100, { ctrl: true }));
    expect(engine.store.getState().marquee).not.toBeNull();
    dom.dispatch('pointerup', pointerEvent(100, 100, { ctrl: true }));
    expect(engine.selection.selected.size).toBeGreaterThan(0);
  });

  it('swaps the map back so a plain drag marquees and shift pans', () => {
    const { engine, dom } = setup();
    engine.setOptions({ interaction: { backgroundDrag: { plain: 'marquee', shift: 'pan' } } });
    const before = engine.viewport.state.timeStart;

    dom.dispatch('pointerdown', pointerEvent(700, 10));
    dom.dispatch('pointermove', pointerEvent(100, 100));
    expect(engine.store.getState().marquee).not.toBeNull();
    dom.dispatch('pointerup', pointerEvent(100, 100));
    expect(engine.selection.selected.size).toBeGreaterThan(0);

    dom.dispatch('pointerdown', pointerEvent(400, 200, { shift: true }));
    dom.dispatch('pointermove', pointerEvent(300, 200, { shift: true }));
    dom.dispatch('pointerup', pointerEvent(300, 200, { shift: true }));
    expect(engine.viewport.state.timeStart).toBeGreaterThan(before);
  });

  it('starts no gesture at all when the resolved action is none', () => {
    const { engine, dom } = setup();
    engine.setOptions({ interaction: { backgroundDrag: { plain: 'none' } } });
    engine.selection.set(['g0-t0']);
    const before = engine.viewport.state.timeStart;

    dom.dispatch('pointerdown', pointerEvent(400, 200));
    dom.dispatch('pointermove', pointerEvent(300, 200));
    dom.dispatch('pointerup', pointerEvent(300, 200));

    expect(engine.store.getState().marquee).toBeNull();
    expect(engine.viewport.state.timeStart).toBe(before);
    expect(engine.selection.isSelected('g0-t0')).toBe(true);
  });

  it('still clears the selection on a click when a plain drag pans', () => {
    const { engine, dom } = setup();
    engine.setOptions({ interaction: { backgroundDrag: { plain: 'pan' } } });
    engine.selection.set(['g0-t0']);

    // A press and release with no travel is a click, not a pan.
    dom.dispatch('pointerdown', pointerEvent(EMPTY_SPACE.x, EMPTY_SPACE.y));
    dom.dispatch('pointerup', pointerEvent(EMPTY_SPACE.x, EMPTY_SPACE.y));

    expect(engine.selection.selected.size).toBe(0);
  });

  it('does not treat a real pan as a background click', () => {
    const { engine, dom } = setup();
    engine.setOptions({ interaction: { backgroundDrag: { plain: 'pan' } } });
    engine.selection.set(['g0-t0']);

    dom.dispatch('pointerdown', pointerEvent(400, 200));
    dom.dispatch('pointermove', pointerEvent(300, 200));
    dom.dispatch('pointerup', pointerEvent(300, 200));

    expect(engine.selection.isSelected('g0-t0')).toBe(true);
  });

  it('leaves the selection alone on a middle-button click', () => {
    const { engine, dom } = setup();
    engine.selection.set(['g0-t0']);

    dom.dispatch('pointerdown', pointerEvent(EMPTY_SPACE.x, EMPTY_SPACE.y, { button: 1 }));
    dom.dispatch('pointerup', pointerEvent(EMPTY_SPACE.x, EMPTY_SPACE.y, { button: 1 }));

    expect(engine.selection.isSelected('g0-t0')).toBe(true);
  });

  it('keeps `marquee: false` as a master switch over the map', () => {
    const { engine, dom } = setup();
    engine.setOptions({
      interaction: { marquee: false, backgroundDrag: { plain: 'marquee' } },
    });
    const before = engine.viewport.state.timeStart;

    dom.dispatch('pointerdown', pointerEvent(400, 200));
    dom.dispatch('pointermove', pointerEvent(300, 200));
    dom.dispatch('pointerup', pointerEvent(300, 200));

    expect(engine.store.getState().marquee).toBeNull();
    expect(engine.viewport.state.timeStart).toBeGreaterThan(before);
  });
});

describe('hover', () => {
  it('follows the pointer and clears on leave', () => {
    const { engine, dom } = setup();
    dom.dispatch('pointermove', pointerEvent(ON_BAR.x, ON_BAR.y));
    expect(engine.store.getState().hoveredTaskId).toBe('g0-t0');
    expect(engine.store.getState().hoveredRowIndex).toBe(0);

    dom.dispatch('pointermove', pointerEvent(EMPTY_SPACE.x, EMPTY_SPACE.y));
    expect(engine.store.getState().hoveredTaskId).toBeNull();
    expect(engine.store.getState().hoveredRowIndex).toBe(0);

    dom.dispatch('pointerleave', pointerEvent(EMPTY_SPACE.x, EMPTY_SPACE.y));
    expect(engine.store.getState().hoveredRowIndex).toBeNull();
  });

  it('shows a resize cursor over an edge and a grab cursor over the body', () => {
    const { dom } = setup();
    dom.dispatch('pointermove', pointerEvent(2, ON_BAR.y));
    expect(dom.style.cursor).toBe('ew-resize');

    dom.dispatch('pointermove', pointerEvent(40, ON_BAR.y));
    expect(dom.style.cursor).toBe('grab');

    dom.dispatch('pointermove', pointerEvent(EMPTY_SPACE.x, EMPTY_SPACE.y));
    expect(dom.style.cursor).toBe('');
  });

  it('does not re-hit-test while a gesture is running', () => {
    const { engine, dom } = setup();
    dom.dispatch('pointermove', pointerEvent(ON_BAR.x, ON_BAR.y));
    dom.dispatch('pointerdown', pointerEvent(ON_BAR.x, ON_BAR.y));
    dom.dispatch('pointermove', pointerEvent(EMPTY_SPACE.x, EMPTY_SPACE.y));
    // Hover stays on the dragged bar rather than flickering to whatever the
    // pointer passes over.
    expect(engine.store.getState().hoveredTaskId).toBe('g0-t0');
    dom.dispatch('pointerup', pointerEvent(EMPTY_SPACE.x, EMPTY_SPACE.y));
  });
});

describe('wheel', () => {
  it('scrolls vertically by default', () => {
    const { engine, dom } = setup({ groups: 40, tasksPerGroup: 2 });
    dom.dispatch('wheel', wheelEvent(400, 200, { deltaY: 120 }));
    expect(engine.viewport.state.scrollTop).toBe(120);
  });

  it('converts line and page deltas to pixels', () => {
    const { engine, dom } = setup({ groups: 40, tasksPerGroup: 2 });
    dom.dispatch('wheel', wheelEvent(400, 200, { deltaY: 3, deltaMode: 1 }));
    expect(engine.viewport.state.scrollTop).toBe(48);

    engine.viewport.scrollTo(0);
    dom.dispatch('wheel', wheelEvent(400, 200, { deltaY: 1, deltaMode: 2 }));
    expect(engine.viewport.state.scrollTop).toBe(400);
  });

  it('zooms around the pointer with ctrl held', () => {
    const { engine, dom } = setup();
    const anchorTime = engine.viewport.pxToTime(200);
    const spanBefore = engine.viewport.span;

    dom.dispatch('wheel', wheelEvent(200, 100, { deltaY: -100, ctrl: true }));

    expect(engine.viewport.span).toBeLessThan(spanBefore);
    // The time under the cursor stays under the cursor.
    expect(engine.viewport.pxToTime(200)).toBeCloseTo(anchorTime, -3);
  });

  it('pans with shift held', () => {
    const { engine, dom } = setup();
    const before = engine.viewport.state.timeStart;
    dom.dispatch('wheel', wheelEvent(400, 200, { deltaY: 100, shift: true }));
    expect(engine.viewport.state.timeStart).toBeGreaterThan(before);
  });

  it('leaves the event alone for a mapped-to-none modifier', () => {
    const { engine, dom } = setup({ groups: 40, tasksPerGroup: 2 });
    const before = dom.prevented;
    dom.dispatch('wheel', wheelEvent(400, 200, { deltaY: 100, alt: true }));
    // `alt` maps to 'none': the page keeps its scroll.
    expect(dom.prevented).toBe(before);
    expect(engine.viewport.state.scrollTop).toBe(0);
  });

  it('honours a remapped wheel configuration', () => {
    const { engine, dom } = setup({ groups: 40, tasksPerGroup: 2 });
    engine.setOptions({ interaction: { wheel: { plain: 'zoom' } } });
    const spanBefore = engine.viewport.span;

    dom.dispatch('wheel', wheelEvent(400, 200, { deltaY: -100 }));
    expect(engine.viewport.span).toBeLessThan(spanBefore);
    expect(engine.viewport.state.scrollTop).toBe(0);
  });
});

describe('keyboard', () => {
  it('moves the focused task and keeps it in view', () => {
    const { engine, dom } = setup({ groups: 40, tasksPerGroup: 2 });
    engine.selection.set(['g0-t0'], 'g0-t0');

    dom.dispatch('keydown', keyEvent('ArrowDown'));
    expect(engine.selection.selected.size).toBe(1);
    expect(engine.selection.isSelected('g0-t0')).toBe(false);

    for (let i = 0; i < 40; i++) dom.dispatch('keydown', keyEvent('ArrowDown'));
    // Walking off the bottom of the viewport scrolls it into view.
    expect(engine.viewport.state.scrollTop).toBeGreaterThan(0);
  });

  it('extends the selection with shift', () => {
    const { engine, dom } = setup();
    engine.selection.set(['g0-t0'], 'g0-t0');
    dom.dispatch('keydown', keyEvent('ArrowDown', { shift: true }));
    expect(engine.selection.selected.size).toBeGreaterThan(1);
  });

  it('selects everything with ctrl+a', () => {
    const { engine, dom } = setup({ groups: 3, tasksPerGroup: 4 });
    dom.dispatch('keydown', keyEvent('a', { ctrl: true }));
    expect(engine.selection.selected.size).toBe(12);
  });

  it('escapes out of a drag, then a menu, then the selection', () => {
    const { engine, dom } = setup();
    engine.selection.set(['g0-t0']);

    dom.dispatch('pointerdown', pointerEvent(ON_BAR.x, ON_BAR.y));
    dom.dispatch('pointermove', pointerEvent(ON_BAR.x + 100, ON_BAR.y));
    dom.dispatch('keydown', keyEvent('Escape'));
    expect(engine.drag.state).toBeNull();
    expect(engine.selection.selected.size).toBe(1);

    engine.contextMenu.open({ kind: 'background', position: { x: 0, y: 0 } });
    dom.dispatch('keydown', keyEvent('Escape'));
    expect(engine.contextMenu.isOpen).toBe(false);
    expect(engine.selection.selected.size).toBe(1);

    dom.dispatch('keydown', keyEvent('Escape'));
    expect(engine.selection.selected.size).toBe(0);
  });

  it('zooms with + and -, pans with arrows', () => {
    const { engine, dom } = setup();
    const spanBefore = engine.viewport.span;
    dom.dispatch('keydown', keyEvent('+'));
    expect(engine.viewport.span).toBeLessThan(spanBefore);
    dom.dispatch('keydown', keyEvent('-'));
    expect(engine.viewport.span).toBeCloseTo(spanBefore, -3);

    const startBefore = engine.viewport.state.timeStart;
    dom.dispatch('keydown', keyEvent('ArrowRight'));
    expect(engine.viewport.state.timeStart).toBeGreaterThan(startBefore);
    dom.dispatch('keydown', keyEvent('ArrowLeft'));
    expect(engine.viewport.state.timeStart).toBeCloseTo(startBefore, -3);
  });

  it('pages and homes through the content', () => {
    const { engine, dom } = setup({ groups: 60, tasksPerGroup: 1 });
    dom.dispatch('keydown', keyEvent('PageDown'));
    expect(engine.viewport.state.scrollTop).toBeCloseTo(360, 6);

    dom.dispatch('keydown', keyEvent('End'));
    expect(engine.viewport.state.scrollTop).toBe(engine.viewport.maxScrollTop);

    dom.dispatch('keydown', keyEvent('Home', { ctrl: true }));
    expect(engine.viewport.state.scrollTop).toBe(0);

    // Plain Home frames the whole time domain.
    engine.viewport.setTimeRange(T0, T0 + DAY);
    dom.dispatch('keydown', keyEvent('Home'));
    expect(engine.viewport.span).toBeGreaterThan(DAY);
  });

  it('ignores keys it does not handle', () => {
    const { dom } = setup();
    const before = dom.prevented;
    dom.dispatch('keydown', keyEvent('q'));
    dom.dispatch('keydown', keyEvent('a'));
    expect(dom.prevented).toBe(before);
  });
});

describe('context menu and double click', () => {
  it('opens a task menu and suppresses the native one', () => {
    const { engine, dom } = setup();
    const before = dom.prevented;
    dom.dispatch('contextmenu', pointerEvent(ON_BAR.x, ON_BAR.y));

    const menu = engine.contextMenu.state;
    expect(menu?.kind).toBe('task');
    expect(menu?.task?.id).toBe('g0-t0');
    expect(menu?.position).toEqual({ x: ON_BAR.x, y: ON_BAR.y });
    // Right-clicking an unselected task brings it into the selection, so menu
    // actions operate on what the user pointed at.
    expect(menu?.selection).toEqual(['g0-t0']);
    expect(dom.prevented).toBe(before + 1);
  });

  it('reports row and background targets', () => {
    const { engine, dom } = setup();
    dom.dispatch('contextmenu', pointerEvent(EMPTY_SPACE.x, 45));
    expect(engine.contextMenu.state?.kind).toBe('row');
    expect(engine.contextMenu.state?.row?.index).toBe(1);

    // Below the last row there is no row to target.
    dom.dispatch('contextmenu', pointerEvent(EMPTY_SPACE.x, 380));
    expect(engine.contextMenu.state?.kind).toBe('background');
    expect(engine.contextMenu.state?.row).toBeNull();
  });

  it('emits dblclick for tasks and rows', () => {
    const { engine, dom } = setup();
    const seen: string[] = [];
    engine.on('task:dblclick', (payload) => seen.push(`task:${payload.task.id}`));
    engine.on('row:dblclick', (payload) => seen.push(`row:${payload.row.index}`));

    dom.dispatch('dblclick', pointerEvent(ON_BAR.x, ON_BAR.y));
    dom.dispatch('dblclick', pointerEvent(EMPTY_SPACE.x, 45));
    expect(seen).toEqual(['task:g0-t0', 'row:1']);
  });
});

describe('render scheduling', () => {
  it('coalesces store changes into one render', async () => {
    const { chart, engine } = setup();
    const before = chart.options.length;

    engine.selection.set(['g0-t0']);
    engine.setHovered('g0-t1', 0);
    engine.viewport.scrollTo(0);
    expect(chart.options).toHaveLength(before);

    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(chart.options).toHaveLength(before + 1);
  });

  it('renders on an options change', async () => {
    const { chart, engine } = setup();
    const before = chart.options.length;
    engine.setOptions({ metrics: { laneHeight: 40 } });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(chart.options.length).toBeGreaterThan(before);
  });

  it('exposes the tick scale of the last frame for the header to reuse', () => {
    const { adapter, engine } = setup();
    const ticks = adapter.getTicks();
    // 10 days across 800px leaves ~1.1 days per 88px of target spacing, so the
    // next nice step up from a day is a week.
    expect(ticks.unit).toBe('week');
    expect(ticks.ticks.length).toBeGreaterThan(0);
    expect(ticks.ticks[0].time).toBeGreaterThanOrEqual(engine.viewport.state.timeStart);
  });

  it('stops rendering once disposed', () => {
    const { adapter, chart, engine } = setup();
    adapter.dispose();
    const after = chart.options.length;
    engine.selection.set(['g0-t0']);
    adapter.render();
    expect(chart.options).toHaveLength(after);
  });
});
