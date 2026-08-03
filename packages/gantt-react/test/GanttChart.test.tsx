// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GanttTask, TaskChange } from '@gantt-chart/core';
import { darkTheme, lightTheme } from '@gantt-chart/themes';
import { DAY, T0, dispatch, fixtureData, key, plotOf, renderChart, textsOf } from './dom';

/**
 * Geometry, with the layout stub in place (800×400 plot):
 *   the window is framed to the data on first load, so exact pixels are read
 *   back from the engine rather than assumed.
 */
const open: { unmount: () => void }[] = [];

function mount(...args: Parameters<typeof renderChart>) {
  const harness = renderChart(...args);
  open.push(harness);
  return harness;
}

afterEach(() => {
  for (const harness of open.splice(0)) harness.unmount();
  vi.restoreAllMocks();
});

describe('mounting', () => {
  it('renders the shell: gutter, header and plot', () => {
    const { tasks, groups } = fixtureData();
    const { container } = mount({ tasks, groups });

    expect(container.querySelector('.gantt')).not.toBeNull();
    expect(container.querySelector('.gantt-gutter')).not.toBeNull();
    expect(container.querySelector('.gantt-header')).not.toBeNull();
    expect(container.querySelector('.gantt-plot')).not.toBeNull();
  });

  it('labels one gutter row per group', () => {
    const { tasks, groups } = fixtureData({ groups: 3 });
    const { container } = mount({ tasks, groups });

    expect(textsOf(container, '.gantt-gutter__text')).toEqual(['Group 0', 'Group 1', 'Group 2']);
  });

  it('draws the bars into a real SVG', () => {
    const { tasks, groups } = fixtureData({ groups: 2, tasksPerGroup: 2 });
    const { container, engine } = mount({ tasks, groups });

    const svg = plotOf(container).querySelector('svg');
    expect(svg).not.toBeNull();
    expect(engine.getVisible().items).toHaveLength(4);
    // Bar labels are painted as SVG text.
    expect(svg?.textContent).toContain('Task 0.0');
    expect(svg?.textContent).toContain('Task 1.1');
  });

  it('adopts the measured plot size as the engine viewport', () => {
    const { tasks, groups } = fixtureData();
    const { engine } = mount({ tasks, groups });
    expect(engine.viewport.state.width).toBe(800);
    expect(engine.viewport.state.height).toBe(400);
  });

  it('labels the header from the visible window', () => {
    const { tasks, groups } = fixtureData();
    const { container } = mount({ tasks, groups, locale: 'en-US' });

    const bands = textsOf(container, '.gantt-header__band');
    expect(bands.join(' ')).toContain('March 2026');
    expect(textsOf(container, '.gantt-header__tick').length).toBeGreaterThan(0);
  });

  it('hides chrome on request', () => {
    const { tasks, groups } = fixtureData();
    const { container } = mount({
      tasks,
      groups,
      showHeader: false,
      showRowGutter: false,
      showScrollbar: false,
      tooltip: false,
    });

    expect(container.querySelector('.gantt-header')).toBeNull();
    expect(container.querySelector('.gantt-gutter')).toBeNull();
    expect(container.querySelector('.gantt-plot')).not.toBeNull();
  });

  it('disposes the engine on unmount', () => {
    const { tasks, groups } = fixtureData();
    const harness = renderChart({ tasks, groups });
    const engine = harness.engine;
    expect(engine.isDisposed).toBe(false);

    harness.unmount();
    expect(engine.isDisposed).toBe(true);
  });
});

describe('data and option props', () => {
  it('re-normalizes when the tasks array changes', () => {
    const { tasks, groups } = fixtureData({ groups: 1, tasksPerGroup: 2 });
    const harness = mount({ tasks, groups });
    expect(harness.engine.getTasks()).toHaveLength(2);

    const extra: GanttTask<{ label: string }>[] = [
      ...tasks,
      { id: 'extra', groupId: 'g0', start: T0, end: T0 + DAY, data: { label: 'Extra' } },
    ];
    harness.rerender({ tasks: extra });
    expect(harness.engine.getTasks()).toHaveLength(3);
    expect(harness.engine.getTask('extra')).toBeDefined();
  });

  it('keeps viewport and selection across a data change', () => {
    const { tasks, groups } = fixtureData({ groups: 1, tasksPerGroup: 2 });
    const harness = mount({ tasks, groups });

    harness.engine.selection.set(['g0-t0']);
    harness.engine.viewport.setTimeRange(T0, T0 + 3 * DAY);
    const span = harness.engine.viewport.span;

    harness.rerender({ tasks: [...tasks] });
    expect(harness.engine.selection.isSelected('g0-t0')).toBe(true);
    expect(harness.engine.viewport.span).toBe(span);
  });

  it('pushes option changes into the engine', () => {
    const { tasks, groups } = fixtureData();
    const harness = mount({ tasks, groups });
    expect(harness.engine.getOptions().metrics.laneHeight).toBe(26);

    harness.rerender({ options: { metrics: { laneHeight: 40 } } });
    expect(harness.engine.getOptions().metrics.laneHeight).toBe(40);
  });

  it('does not rebuild the engine when unrelated props change', () => {
    const { tasks, groups } = fixtureData();
    const harness = mount({ tasks, groups });
    const engine = harness.engine;

    harness.rerender({ className: 'changed' });
    expect(harness.engine).toBe(engine);
  });
});

describe('row gutter interaction', () => {
  it('collapses and expands a group from its chevron', () => {
    const { tasks, groups } = fixtureData({ groups: 3, nested: true });
    const { container, engine } = mount({ tasks, groups });

    // g1 and g2 are children of g0.
    expect(textsOf(container, '.gantt-gutter__text')).toHaveLength(3);

    const toggle = container.querySelector<HTMLButtonElement>('.gantt-gutter__toggle');
    expect(toggle).not.toBeNull();
    dispatch(toggle!, 'click');

    expect(engine.isCollapsed('g0')).toBe(true);
    expect(textsOf(container, '.gantt-gutter__text')).toEqual(['Group 0']);

    dispatch(container.querySelector<HTMLButtonElement>('.gantt-gutter__toggle')!, 'click');
    expect(engine.isCollapsed('g0')).toBe(false);
    expect(textsOf(container, '.gantt-gutter__text')).toHaveLength(3);
  });

  it('reports toggles to the caller', () => {
    const { tasks, groups } = fixtureData({ groups: 2, nested: true });
    const onRowToggle = vi.fn();
    const { container } = mount({ tasks, groups, onRowToggle });

    dispatch(container.querySelector<HTMLButtonElement>('.gantt-gutter__toggle')!, 'click');
    expect(onRowToggle).toHaveBeenCalledTimes(1);
    expect(onRowToggle.mock.calls[0][1]).toBe(true);
  });

  it('marks the hovered row in the gutter', () => {
    const { tasks, groups } = fixtureData({ groups: 2 });
    const { container, engine } = mount({ tasks, groups });

    const rows = container.querySelectorAll('.gantt-gutter__row');
    // React derives `onPointerEnter` from the native `pointerover`.
    dispatch(rows[1], 'pointerover');
    expect(engine.store.getState().hoveredRowIndex).toBe(1);
    expect(container.querySelectorAll('.gantt-gutter__row.is-hovered')).toHaveLength(1);
  });

  it('shows a lane count badge for stacked rows', () => {
    const overlapping: GanttTask<{ label: string }>[] = [
      { id: 'a', groupId: 'g0', start: T0, end: T0 + 4 * DAY, data: { label: 'A' } },
      { id: 'b', groupId: 'g0', start: T0 + DAY, end: T0 + 5 * DAY, data: { label: 'B' } },
    ];
    const { container } = mount({ tasks: overlapping, groups: [{ id: 'g0', label: 'Stacked' }] });
    expect(textsOf(container, '.gantt-gutter__lanes')).toEqual(['2']);
  });
});

describe('plot interaction', () => {
  it('selects a bar on click and reports it', () => {
    const { tasks, groups } = fixtureData({ groups: 1, tasksPerGroup: 2 });
    const onSelectionChange = vi.fn();
    const onTaskClick = vi.fn();
    const { container, engine } = mount({ tasks, groups, onSelectionChange, onTaskClick });

    const rect = engine.getTaskRect('g0-t0')!;
    const point = { clientX: rect.x + rect.width / 2, clientY: rect.y + rect.height / 2 };
    const plot = plotOf(container);

    dispatch(plot, 'pointerdown', point);
    dispatch(plot, 'pointerup', point);

    expect(Array.from(engine.selection.selected)).toEqual(['g0-t0']);
    expect(onSelectionChange).toHaveBeenCalledWith(['g0-t0']);
    expect(onTaskClick.mock.calls[0][0].id).toBe('g0-t0');
  });

  it('opens the context menu on right click, and acts on the selection', () => {
    const { tasks, groups } = fixtureData({ groups: 2, tasksPerGroup: 2 });
    const { container, engine } = mount({ tasks, groups });
    const rect = engine.getTaskRect('g0-t0')!;

    dispatch(plotOf(container), 'contextmenu', {
      clientX: rect.x + 4,
      clientY: rect.y + 4,
      button: 2,
    });

    const menu = container.ownerDocument.querySelector('.gantt-menu');
    expect(menu).not.toBeNull();
    const labels = Array.from(menu!.querySelectorAll('.gantt-menu__item')).map((n) => n.textContent);
    expect(labels).toContain('Zoom to task');
    expect(labels).toContain('Select all');

    const selectAll = Array.from(menu!.querySelectorAll<HTMLButtonElement>('.gantt-menu__item')).find(
      (node) => node.textContent === 'Select all',
    )!;
    dispatch(selectAll, 'click');

    expect(engine.selection.selected.size).toBe(4);
    // Choosing an item closes the menu.
    expect(container.ownerDocument.querySelector('.gantt-menu')).toBeNull();
  });

  it('accepts custom context menu items', () => {
    const { tasks, groups } = fixtureData({ groups: 1, tasksPerGroup: 1 });
    const onSelect = vi.fn();
    const { container } = mount({
      tasks,
      groups,
      contextMenuItems: () => [{ id: 'custom', label: 'Do the thing', onSelect }],
    });

    dispatch(plotOf(container), 'contextmenu', { clientX: 10, clientY: 300, button: 2 });
    const item = container.ownerDocument.querySelector<HTMLButtonElement>('.gantt-menu__item')!;
    expect(item.textContent).toBe('Do the thing');

    dispatch(item, 'click');
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it('shows a tooltip for the hovered task', () => {
    const { tasks, groups } = fixtureData({ groups: 1, tasksPerGroup: 2 });
    const { container, engine } = mount({ tasks, groups, locale: 'en-US' });
    expect(container.querySelector('.gantt-tooltip')).toBeNull();

    const rect = engine.getTaskRect('g0-t0')!;
    dispatch(plotOf(container), 'pointermove', {
      clientX: rect.x + rect.width / 2,
      clientY: rect.y + rect.height / 2,
    });

    const tooltip = container.querySelector('.gantt-tooltip');
    expect(tooltip?.textContent).toContain('Task 0.0');
    // One day long, so the duration line is in days.
    expect(tooltip?.textContent).toContain('1 day');
  });

  it('renders a custom tooltip body', () => {
    const { tasks, groups } = fixtureData({ groups: 1, tasksPerGroup: 1 });
    const { container, engine } = mount({
      tasks,
      groups,
      tooltip: ({ task }) => `custom: ${String(task.id)}`,
    });

    const rect = engine.getTaskRect('g0-t0')!;
    dispatch(plotOf(container), 'pointermove', { clientX: rect.x + 2, clientY: rect.y + 2 });
    expect(container.querySelector('.gantt-tooltip')?.textContent).toBe('custom: g0-t0');
  });

  it('routes keyboard shortcuts to the engine', () => {
    const { tasks, groups } = fixtureData({ groups: 2, tasksPerGroup: 2 });
    const { container, engine } = mount({ tasks, groups });

    key(plotOf(container), 'a', { ctrlKey: true });
    expect(engine.selection.selected.size).toBe(4);

    key(plotOf(container), 'Escape');
    expect(engine.selection.selected.size).toBe(0);
  });
});

describe('editing', () => {
  it('applies drags itself when uncontrolled', async () => {
    const { tasks, groups } = fixtureData({ groups: 1, tasksPerGroup: 2 });
    const onChanges = vi.fn<[TaskChange[]], void>();
    const harness = mount({ tasks, groups, onChanges });
    const { engine } = harness;

    const rect = engine.getTaskRect('g0-t0')!;
    engine.drag.begin('g0-t0', { x: rect.x + 4, y: rect.y + 4 });
    engine.drag.move({ x: rect.x + 84, y: rect.y + 4 });
    const expected = engine.drag.preview()[0].start;
    engine.drag.commit();

    expect(onChanges).toHaveBeenCalledTimes(1);
    // Uncontrolled: the engine holds the edited copy.
    expect(engine.getTask('g0-t0')?.start).toBe(expected);
    expect(tasks[0].start).toBe(T0);
    await harness.flush();
  });

  it('defers to the caller when controlled', () => {
    const { tasks, groups } = fixtureData({ groups: 1, tasksPerGroup: 2 });
    const onTasksChange = vi.fn<[GanttTask<{ label: string }>[], TaskChange[]], void>();
    const { engine } = mount({ tasks, groups, onTasksChange });

    const rect = engine.getTaskRect('g0-t0')!;
    engine.drag.begin('g0-t0', { x: rect.x + 4, y: rect.y + 4 });
    engine.drag.move({ x: rect.x + 84, y: rect.y + 4 });
    const expected = engine.drag.preview()[0].start;
    engine.drag.commit();

    expect(onTasksChange).toHaveBeenCalledTimes(1);
    const [next, changes] = onTasksChange.mock.calls[0];
    expect(changes).toHaveLength(1);
    expect(next.find((task) => task.id === 'g0-t0')?.start).toBe(expected);
    // Controlled: the engine's own copy is untouched until props come back.
    expect(engine.getTask('g0-t0')?.start).toBe(T0);
  });

  it('ignores a cancelled drag', () => {
    const { tasks, groups } = fixtureData({ groups: 1, tasksPerGroup: 1 });
    const onChanges = vi.fn();
    const { engine } = mount({ tasks, groups, onChanges });

    const rect = engine.getTaskRect('g0-t0')!;
    engine.drag.begin('g0-t0', { x: rect.x + 4, y: rect.y + 4 });
    engine.drag.move({ x: rect.x + 84, y: rect.y + 4 });
    engine.drag.cancel();

    expect(onChanges).not.toHaveBeenCalled();
    expect(engine.getTask('g0-t0')?.start).toBe(T0);
  });
});

describe('theming', () => {
  it('exposes theme colours as CSS variables', () => {
    const { tasks, groups } = fixtureData();
    const harness = mount({ tasks, groups, theme: 'light' });
    const root = harness.container.querySelector<HTMLElement>('.gantt')!;

    expect(root.classList.contains('gantt--light')).toBe(true);
    expect(root.style.getPropertyValue('--gantt-row-odd')).not.toBe('');

    harness.rerender({ theme: 'dark' });
    expect(root.classList.contains('gantt--dark')).toBe(true);
    expect(root.style.getPropertyValue('--gantt-row-odd')).toBe(darkTheme.colors.rowOdd);
  });

  it('repaints the plot with the new theme', async () => {
    const { tasks, groups } = fixtureData({ groups: 2, tasksPerGroup: 2 });
    const harness = mount({ tasks, groups, theme: 'light' });

    harness.rerender({ theme: 'dark' });
    await harness.flush();

    const svg = plotOf(harness.container).innerHTML;
    expect(svg).toContain(darkTheme.colors.rowOdd);
  });
});

describe('scrollbar', () => {
  it('appears only when the content overflows', () => {
    const short = fixtureData({ groups: 2, tasksPerGroup: 1 });
    const harness = mount({ tasks: short.tasks, groups: short.groups });
    expect(harness.container.querySelector('.gantt-scrollbar__thumb')).toBeNull();

    const tall = fixtureData({ groups: 40, tasksPerGroup: 1 });
    harness.rerender({ tasks: tall.tasks, groups: tall.groups });
    expect(harness.container.querySelector('.gantt-scrollbar__thumb')).not.toBeNull();
  });

  it('sizes the thumb from the scrollable range', () => {
    const { tasks, groups } = fixtureData({ groups: 40, tasksPerGroup: 1 });
    const { container, engine } = mount({ tasks, groups });

    const thumb = container.querySelector<HTMLElement>('.gantt-scrollbar__thumb')!;
    const ratio = engine.viewport.state.height / engine.totalHeight;
    expect(Number.parseFloat(thumb.style.height)).toBeCloseTo(ratio * engine.viewport.state.height, 0);
    expect(thumb.getAttribute('aria-valuemax')).toBe(
      String(Math.round(engine.totalHeight - engine.viewport.state.height)),
    );
  });

  it('follows the engine scroll position', () => {
    const { tasks, groups } = fixtureData({ groups: 40, tasksPerGroup: 1 });
    const { container, engine } = mount({ tasks, groups });

    dispatch(plotOf(container), 'wheel', { deltaY: 200 });
    expect(engine.viewport.state.scrollTop).toBe(200);

    const thumb = container.querySelector<HTMLElement>('.gantt-scrollbar__thumb')!;
    expect(Number.parseFloat(thumb.style.top)).toBeGreaterThan(0);
    expect(thumb.getAttribute('aria-valuenow')).toBe('200');
  });
});

describe('dependencies', () => {
  it('draws links between tasks', async () => {
    const { tasks, groups } = fixtureData({ groups: 1, tasksPerGroup: 3 });
    const harness = mount({
      tasks,
      groups,
      dependencies: [{ from: 'g0-t0', to: 'g0-t1' }],
    });
    await harness.flush();

    // zrender serialises every shape as a `<path>`, so the connector is
    // identified by its colour — nothing else in the frame uses it.
    expect(countLinks(plotOf(harness.container).innerHTML)).toBeGreaterThan(0);
  });

  it('updates when the dependency list changes', async () => {
    const { tasks, groups } = fixtureData({ groups: 1, tasksPerGroup: 3 });
    const harness = mount({ tasks, groups, dependencies: [] });
    await harness.flush();
    expect(countLinks(plotOf(harness.container).innerHTML)).toBe(0);

    harness.rerender({
      dependencies: [
        { from: 'g0-t0', to: 'g0-t1' },
        { from: 'g0-t1', to: 'g0-t2' },
      ],
    });
    await harness.flush();

    // Two links, each an arrow head plus a connector.
    expect(countLinks(plotOf(harness.container).innerHTML)).toBe(4);
  });
});

function countLinks(html: string): number {
  return (html.match(new RegExp(lightTheme.colors.dependencyLine, 'g')) ?? []).length;
}
