import { describe, expect, it, vi } from 'vitest';
import { GanttEngine } from '../src/GanttEngine';
import type { GanttTask } from '../src/types';

function makeEngine(): GanttEngine {
  // Deliberately out of visual order in the input array: row order then start
  // time is what selection ranges must follow.
  const tasks: GanttTask[] = [
    { id: 'b2', groupId: 'b', start: 200, end: 250 },
    { id: 'a1', groupId: 'a', start: 0, end: 50 },
    { id: 'b1', groupId: 'b', start: 100, end: 150 },
    { id: 'a2', groupId: 'a', start: 100, end: 150 },
    { id: 'a3', groupId: 'a', start: 200, end: 250 },
  ];
  const groups = [
    { id: 'a', label: 'A' },
    { id: 'b', label: 'B' },
  ];
  return new GanttEngine({ tasks, groups, size: { width: 800, height: 400 }, options: { minTimeSpan: 1 } });
}

describe('selection', () => {
  it('replaces the selection on a plain click and sets the anchor', () => {
    const engine = makeEngine();
    engine.selection.handleClick('a1');
    expect([...engine.selection.selected]).toEqual(['a1']);

    engine.selection.handleClick('a2');
    expect([...engine.selection.selected]).toEqual(['a2']);
    expect(engine.selection.anchor).toBe('a2');
  });

  it('toggles on ctrl-click and keeps the rest of the selection', () => {
    const engine = makeEngine();
    engine.selection.handleClick('a1');
    engine.selection.handleClick('a3', { ctrl: true });
    expect([...engine.selection.selected].sort()).toEqual(['a1', 'a3']);

    engine.selection.handleClick('a1', { ctrl: true });
    expect([...engine.selection.selected]).toEqual(['a3']);
  });

  it('treats meta the same as ctrl', () => {
    const engine = makeEngine();
    engine.selection.handleClick('a1');
    engine.selection.handleClick('a2', { meta: true });
    expect([...engine.selection.selected].sort()).toEqual(['a1', 'a2']);
  });

  it('shift-click selects the visual range, not the insertion range', () => {
    const engine = makeEngine();
    engine.selection.handleClick('a1');
    engine.selection.handleClick('a3', { shift: true });
    // Visual order is a1, a2, a3, b1, b2 — so the range includes a2.
    expect([...engine.selection.selected].sort()).toEqual(['a1', 'a2', 'a3']);
  });

  it('spans rows and replaces the previous selection on shift-click', () => {
    const engine = makeEngine();
    engine.selection.handleClick('a2');
    engine.selection.handleClick('b1', { shift: true });
    expect([...engine.selection.selected].sort()).toEqual(['a2', 'a3', 'b1']);
  });

  it('ctrl+shift-click adds the range instead of replacing it', () => {
    const engine = makeEngine();
    engine.selection.handleClick('b2');
    engine.selection.handleClick('a1');
    engine.selection.handleClick('a2', { ctrl: true, shift: true });
    expect([...engine.selection.selected].sort()).toEqual(['a1', 'a2']);

    engine.selection.handleClick('b1', { ctrl: true });
    engine.selection.handleClick('b2', { ctrl: true, shift: true });
    expect([...engine.selection.selected].sort()).toEqual(['a1', 'a2', 'b1', 'b2']);
  });

  it('selects a rectangle in content space', () => {
    const engine = makeEngine();
    const layout = engine.getLayout();
    const rowA = layout.rows[0];
    const ids = engine.selection.selectRect({
      x: 90,
      width: 80,
      y: rowA.y,
      height: rowA.height,
    });
    expect(ids.sort()).toEqual(['a2']);
  });

  it('emits one change event carrying added and removed ids', () => {
    const engine = makeEngine();
    const listener = vi.fn();
    engine.on('selection:change', listener);

    engine.selection.set(['a1', 'a2']);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0][0].added.sort()).toEqual(['a1', 'a2']);

    engine.selection.set(['a2', 'a3']);
    expect(listener).toHaveBeenCalledTimes(2);
    expect(listener.mock.calls[1][0].added).toEqual(['a3']);
    expect(listener.mock.calls[1][0].removed).toEqual(['a1']);
  });

  it('stays silent when the selection is re-asserted', () => {
    const engine = makeEngine();
    engine.selection.set(['a1']);
    const listener = vi.fn();
    engine.on('selection:change', listener);
    engine.selection.set(['a1']);
    expect(listener).not.toHaveBeenCalled();
  });

  it('drops ids that no longer exist when the data is replaced', () => {
    const engine = makeEngine();
    engine.selection.set(['a1', 'a2']);
    engine.setTasks([{ id: 'a1', groupId: 'a', start: 0, end: 10 }]);
    expect([...engine.selection.selected]).toEqual(['a1']);
  });

  it('walks the visual order with moveFocus', () => {
    const engine = makeEngine();
    engine.selection.handleClick('a1');
    expect(engine.selection.moveFocus(1)).toBe('a2');
    expect(engine.selection.moveFocus(1)).toBe('a3');
    expect(engine.selection.moveFocus(1)).toBe('b1');
    expect(engine.selection.moveFocus(-1)).toBe('a3');
    expect([...engine.selection.selected]).toEqual(['a3']);
  });

  it('extends the selection when moveFocus is told to', () => {
    const engine = makeEngine();
    engine.selection.handleClick('a1');
    engine.selection.moveFocus(2, true);
    expect([...engine.selection.selected].sort()).toEqual(['a1', 'a2', 'a3']);
  });

  it('selectAll and invert cover the displayed tasks', () => {
    const engine = makeEngine();
    engine.selection.selectAll();
    expect(engine.selection.selected.size).toBe(5);
    engine.selection.invert();
    expect(engine.selection.selected.size).toBe(0);
  });

  it('respects the selection and multiSelect switches', () => {
    const engine = makeEngine();
    engine.setOptions({ interaction: { selection: false } });
    engine.selection.handleClick('a1');
    expect(engine.selection.selected.size).toBe(0);

    engine.setOptions({ interaction: { selection: true, multiSelect: false } });
    engine.selection.handleClick('a1');
    engine.selection.handleClick('a2', { ctrl: true });
    expect([...engine.selection.selected]).toEqual(['a2']);
  });

  it('closes every gesture route into a selection when it is switched off', () => {
    const engine = makeEngine();
    engine.setOptions({ interaction: { selection: false } });

    engine.selection.handleClick('a1');
    engine.selection.selectAll();
    engine.selection.invert();
    expect(engine.selection.selectRect({ x: 0, y: 0, width: 1000, height: 1000 })).toEqual([]);
    expect(engine.selection.moveFocus(1)).toBeNull();

    expect(engine.selection.selected.size).toBe(0);
  });

  it('still selects through the API when the gestures are switched off', () => {
    const engine = makeEngine();
    engine.setOptions({ interaction: { selection: false } });

    // An explicit call is the app's own decision, not user input to filter.
    engine.selection.set(['a1', 'a2']);
    expect([...engine.selection.selected].sort()).toEqual(['a1', 'a2']);

    engine.selection.toggle('a3');
    expect(engine.selection.selected.size).toBe(3);
    engine.selection.clear();
    expect(engine.selection.selected.size).toBe(0);
  });

  it('drops the selection when selection is switched off', () => {
    const engine = makeEngine();
    const changes = vi.fn();
    engine.selection.handleClick('a1');
    engine.on('selection:change', changes);

    engine.setOptions({ interaction: { selection: false } });
    expect(engine.selection.selected.size).toBe(0);
    expect(changes).toHaveBeenCalledTimes(1);

    // Switching it back on does not bring it back.
    engine.setOptions({ interaction: { selection: true } });
    expect(engine.selection.selected.size).toBe(0);
  });
});
