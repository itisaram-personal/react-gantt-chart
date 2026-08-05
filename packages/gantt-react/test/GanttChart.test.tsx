// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GanttTask, TaskChange } from '@gantt-chart/core';
import { darkTheme, lightTheme } from '@gantt-chart/themes';
import { DAY, PLOT_HEIGHT, PLOT_WIDTH, T0, dispatch, drag, fixtureData, key, plotOf, renderChart, run, textsOf } from './dom';

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

    run(() => harness.engine.selection.set(['g0-t0']));
    run(() => harness.engine.viewport.setTimeRange(T0, T0 + 3 * DAY));
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
    const { tasks, groups } = fixtureData({ groups: 1, tasksPerGroup: 2, lanesPerGroup: 2 });
    const { container } = mount({ tasks, groups });
    expect(textsOf(container, '.gantt-gutter__lanes')).toEqual(['2']);
  });
});

describe('items per row', () => {
  it('stacks a row into as many lanes as the fixture asks for', () => {
    const { tasks, groups } = fixtureData({ groups: 2, tasksPerGroup: 6, lanesPerGroup: 3 });
    const { engine } = mount({ tasks, groups });

    // Six tasks dealt into three lanes: two columns of three overlapping bars.
    expect(engine.getRows().rows.map((row) => row.laneCount)).toEqual([3, 3]);
    expect(textsOf(mount({ tasks, groups }).container, '.gantt-gutter__lanes')).toEqual(['3', '3']);
  });

  it('leaves a single lane when tasks do not overlap', () => {
    const { tasks, groups } = fixtureData({ groups: 1, tasksPerGroup: 4 });
    const { engine } = mount({ tasks, groups });
    expect(engine.getRows().rows[0].laneCount).toBe(1);
  });

  it('clamps items per row to stacking.maxLanes', () => {
    const { tasks, groups } = fixtureData({ groups: 1, tasksPerGroup: 5, lanesPerGroup: 5 });
    const harness = mount({ tasks, groups, options: { stacking: { maxLanes: 2 } } });
    expect(harness.engine.getRows().rows[0].laneCount).toBe(2);

    // Raising the cap re-stacks without remounting.
    harness.rerender({ options: { stacking: { maxLanes: 5 } } });
    expect(harness.engine.getRows().rows[0].laneCount).toBe(5);
  });

  it('collapses every task onto one lane when stacking is off', () => {
    const { tasks, groups } = fixtureData({ groups: 1, tasksPerGroup: 4, lanesPerGroup: 4 });
    const { engine } = mount({ tasks, groups, options: { stacking: { enabled: false } } });
    expect(engine.getRows().rows[0].laneCount).toBe(1);
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
    run(() => engine.drag.begin('g0-t0', { x: rect.x + 4, y: rect.y + 4 }));
    run(() => engine.drag.move({ x: rect.x + 84, y: rect.y + 4 }));
    const expected = engine.drag.preview()[0].start;
    run(() => engine.drag.commit());

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
    run(() => engine.drag.begin('g0-t0', { x: rect.x + 4, y: rect.y + 4 }));
    run(() => engine.drag.move({ x: rect.x + 84, y: rect.y + 4 }));
    const expected = engine.drag.preview()[0].start;
    run(() => engine.drag.commit());

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
    run(() => engine.drag.begin('g0-t0', { x: rect.x + 4, y: rect.y + 4 }));
    run(() => engine.drag.move({ x: rect.x + 84, y: rect.y + 4 }));
    run(() => engine.drag.cancel());

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

describe('zoom bars', () => {
  const windowOf = (container: HTMLElement, axis: 'horizontal' | 'vertical'): HTMLElement => {
    const node = container.querySelector<HTMLElement>(`.gantt-zoom--${axis} .gantt-zoom__window`);
    if (!node) throw new Error(`no ${axis} zoom window`);
    return node;
  };

  const handleOf = (container: HTMLElement, axis: 'horizontal' | 'vertical', edge: 'start' | 'end'): HTMLElement => {
    const node = container.querySelector<HTMLElement>(
      `.gantt-zoom--${axis} .gantt-zoom__handle--${edge}`,
    );
    if (!node) throw new Error(`no ${axis} ${edge} handle`);
    return node;
  };

  it('are off unless asked for', () => {
    const { tasks, groups } = fixtureData();
    const { container } = mount({ tasks, groups });
    expect(container.querySelector('.gantt-zoom--horizontal')).toBeNull();
    expect(container.querySelector('.gantt-zoom--vertical')).toBeNull();
  });

  it('draws the visible time range as the window', () => {
    const { tasks, groups } = fixtureData();
    const { container, engine } = mount({ tasks, groups, showTimeZoomBar: true });

    const [domainStart, domainEnd] = engine.getDomain();
    const span = domainEnd - domainStart;
    const { timeStart, timeEnd } = engine.viewport.state;

    const node = windowOf(container, 'horizontal');
    expect(Number.parseFloat(node.style.left)).toBeCloseTo(((timeStart - domainStart) / span) * 100, 1);
    expect(Number.parseFloat(node.style.width)).toBeCloseTo(((timeEnd - timeStart) / span) * 100, 1);
  });

  it('pans without zooming when the time window is dragged', () => {
    const { tasks, groups } = fixtureData();
    const { container, engine } = mount({ tasks, groups, showTimeZoomBar: true });

    run(() => engine.viewport.setTimeRange(T0, T0 + 3 * DAY));
    const [domainStart, domainEnd] = engine.getDomain();
    const domainSpan = domainEnd - domainStart;
    const before = engine.viewport.state.timeStart;
    const span = engine.viewport.span;

    // An eighth of the track, so an eighth of the domain.
    drag(windowOf(container, 'horizontal'), { clientX: 0 }, { clientX: PLOT_WIDTH / 8 });

    expect(engine.viewport.state.timeStart - before).toBeCloseTo(domainSpan / 8, -3);
    expect(engine.viewport.span).toBeCloseTo(span, -3);
  });

  it('zooms when a time handle is dragged', () => {
    const { tasks, groups } = fixtureData();
    const { container, engine } = mount({ tasks, groups, showTimeZoomBar: true });

    run(() => engine.viewport.setTimeRange(T0, T0 + 2 * DAY));
    const start = engine.viewport.state.timeStart;
    const span = engine.viewport.span;

    drag(handleOf(container, 'horizontal', 'end'), { clientX: 0 }, { clientX: PLOT_WIDTH / 8 });

    // The grabbed edge moved out, so the window is wider and its start is pinned.
    expect(engine.viewport.span).toBeGreaterThan(span);
    expect(engine.viewport.state.timeStart).toBeCloseTo(start, -3);
  });

  it('scrolls when the row window is dragged', () => {
    const { tasks, groups } = fixtureData({ groups: 40, tasksPerGroup: 1 });
    const { container, engine } = mount({ tasks, groups, showRowZoomBar: true });

    const totalHeight = engine.totalHeight;
    expect(totalHeight).toBeGreaterThan(PLOT_HEIGHT);
    expect(engine.viewport.state.scrollTop).toBe(0);

    drag(windowOf(container, 'vertical'), { clientY: 0 }, { clientY: PLOT_HEIGHT / 10 });

    // A tenth of the track is a tenth of the content.
    expect(engine.viewport.state.scrollTop).toBeCloseTo(totalHeight / 10, 0);
  });

  it('scales row height when a row handle is dragged', () => {
    const { tasks, groups } = fixtureData({ groups: 40, tasksPerGroup: 1 });
    const { container, engine } = mount({ tasks, groups, showRowZoomBar: true });
    expect(engine.getOptions().metrics.laneHeight).toBe(26);

    // Pulling the bottom edge up asks for less content on screen, so rows grow.
    drag(handleOf(container, 'vertical', 'end'), { clientY: PLOT_HEIGHT }, { clientY: PLOT_HEIGHT - 40 });

    const grown = engine.getOptions().metrics.laneHeight;
    expect(grown).toBeGreaterThan(26);
    expect(grown).toBeLessThanOrEqual(120);
    expect(engine.totalHeight).toBeGreaterThan(40 * 34);
  });

  it('never drives lane height outside its bounds', () => {
    const { tasks, groups } = fixtureData({ groups: 40, tasksPerGroup: 1 });
    const { container, engine } = mount({ tasks, groups, showRowZoomBar: true });

    // Collapse the window as far as it will go: the clamp, not the maths, wins.
    drag(handleOf(container, 'vertical', 'end'), { clientY: PLOT_HEIGHT }, { clientY: 0 });
    expect(engine.getOptions().metrics.laneHeight).toBeLessThanOrEqual(120);

    // And the other way, asking for far more content than exists.
    drag(handleOf(container, 'vertical', 'end'), { clientY: 0 }, { clientY: PLOT_HEIGHT * 4 });
    expect(engine.getOptions().metrics.laneHeight).toBeGreaterThanOrEqual(6);
  });
});

function countLinks(html: string): number {
  return (html.match(new RegExp(lightTheme.colors.dependencyLine, 'g')) ?? []).length;
}

/**
 * Clicking a header label to zoom.
 *
 * These go through the mounted component rather than the pure ladder (covered in
 * the echarts package), so the wiring is what is under test: that labels are
 * real buttons, that a click reaches the engine, and that ctrl reverses it.
 *
 * Every case needing a wide view passes an explicit `timeDomain`. `setTimeRange`
 * clamps the span to the domain and the fixture's data spans only about eight
 * days — without it the viewport silently stays a week wide and the ladder never
 * leaves its bottom rung.
 */
describe('interactive header labels', () => {
  const DOMAIN_START = new Date(2024, 0, 1).getTime();
  const DOMAIN_END = new Date(2029, 0, 1).getTime();
  const wide = { options: { timeDomain: [DOMAIN_START, DOMAIN_END] as [number, number] } };

  type Viewport = { viewport: { setTimeRange(a: number, b: number): void } };

  /** Three calendar years on screen, which puts the ladder on its top rung. */
  function overYears(engine: Viewport): void {
    run(() =>
      engine.viewport.setTimeRange(new Date(2025, 0, 1).getTime(), new Date(2028, 0, 1).getTime()),
    );
  }

  /** Ten days on screen — a week-level view, whose rung above is the month. */
  function overDays(engine: Viewport): void {
    run(() => engine.viewport.setTimeRange(T0, T0 + 10 * DAY));
  }

  function labels(container: HTMLElement, selector: string): HTMLButtonElement[] {
    return Array.from(container.querySelectorAll<HTMLButtonElement>(selector));
  }

  it('renders labels as buttons by default', () => {
    const { tasks, groups } = fixtureData();
    const { container } = mount({ tasks, groups, locale: 'en-US' });

    const bands = labels(container, '.gantt-header__band');
    const ticks = labels(container, '.gantt-header__tick');
    expect(bands.length).toBeGreaterThan(0);
    expect(ticks.length).toBeGreaterThan(0);
    // Buttons, not divs: keyboard and screen-reader users get the gesture too.
    for (const node of [...bands, ...ticks]) {
      expect(node.tagName).toBe('BUTTON');
      expect(node.getAttribute('type')).toBe('button');
      expect(node.className).toContain('is-interactive');
    }
  });

  it('renders plain, inert labels when switched off', () => {
    const { tasks, groups } = fixtureData();
    const { container } = mount({ tasks, groups, interactiveLabels: false });

    expect(container.querySelectorAll('.gantt-header__band button')).toHaveLength(0);
    expect(container.querySelector('.gantt-header__band')?.tagName).toBe('DIV');
    expect(container.querySelector('.gantt-header__tick')?.tagName).toBe('DIV');
    expect(container.querySelector('.gantt-header__band')?.className).not.toContain('is-interactive');
  });

  it('zooms to one year when several are visible', () => {
    const { tasks, groups } = fixtureData();
    const { container, engine } = mount({ tasks, groups, locale: 'en-US', ...wide });
    overYears(engine);

    const before = engine.viewport.span;
    const bands = labels(container, '.gantt-header__band');
    expect(bands.length).toBeGreaterThan(1); // several year bands are on screen
    dispatch(bands[1], 'click');

    const { timeStart, timeEnd } = engine.viewport.state;
    expect(engine.viewport.span).toBeLessThan(before);
    // Exactly one calendar year, landing on 1 January.
    expect(new Date(timeStart).getMonth()).toBe(0);
    expect(new Date(timeStart).getDate()).toBe(1);
    expect(new Date(timeEnd).getFullYear()).toBe(new Date(timeStart).getFullYear() + 1);
  });

  it('steps down the ladder on successive clicks', () => {
    const { tasks, groups } = fixtureData();
    const { container, engine } = mount({ tasks, groups, locale: 'en-US', ...wide });
    overYears(engine);

    const spans: number[] = [engine.viewport.span];
    for (let i = 0; i < 4; i++) {
      const band = labels(container, '.gantt-header__band')[0];
      if (!band) break;
      dispatch(band, 'click');
      spans.push(engine.viewport.span);
    }

    // year -> quarter -> month -> week -> day, each strictly narrower.
    for (let i = 1; i < spans.length; i++) {
      expect(spans[i]).toBeLessThan(spans[i - 1]);
    }
    expect(spans).toHaveLength(5);
  });

  it('widens again on ctrl-click', () => {
    const { tasks, groups } = fixtureData();
    const { container, engine } = mount({ tasks, groups, locale: 'en-US', ...wide });
    overDays(engine);

    const before = engine.viewport.span;
    dispatch(labels(container, '.gantt-header__tick')[0], 'click', { ctrlKey: true });

    expect(engine.viewport.span).toBeGreaterThan(before);
    // The month containing the click, so it opens on the 1st.
    expect(new Date(engine.viewport.state.timeStart).getDate()).toBe(1);
  });

  it('treats cmd-click as ctrl-click', () => {
    const { tasks, groups } = fixtureData();
    const { container, engine } = mount({ tasks, groups, locale: 'en-US', ...wide });
    overDays(engine);

    const before = engine.viewport.span;
    dispatch(labels(container, '.gantt-header__tick')[0], 'click', { metaKey: true });
    expect(engine.viewport.span).toBeGreaterThan(before);
  });

  it('zooms from a tick label as well as a band', () => {
    const { tasks, groups } = fixtureData();
    const { container, engine } = mount({ tasks, groups, locale: 'en-US', ...wide });
    overYears(engine);

    const before = engine.viewport.span;
    dispatch(labels(container, '.gantt-header__tick')[1], 'click');
    expect(engine.viewport.span).toBeLessThan(before);
  });

  it('leaves the viewport alone when labels are inert', () => {
    const { tasks, groups } = fixtureData();
    const { container, engine } = mount({ tasks, groups, interactiveLabels: false, ...wide });
    overYears(engine);

    const before = { ...engine.viewport.state };
    const band = container.querySelector('.gantt-header__band');
    if (band) dispatch(band, 'click');

    expect(engine.viewport.state.timeStart).toBe(before.timeStart);
    expect(engine.viewport.state.timeEnd).toBe(before.timeEnd);
  });

  it('names the gesture in the tooltip so it is discoverable', () => {
    const { tasks, groups } = fixtureData();
    const { container, engine } = mount({ tasks, groups, locale: 'en-US', ...wide });
    overYears(engine);

    const title = labels(container, '.gantt-header__band')[0].getAttribute('title') ?? '';
    expect(title).toContain('zoom to year');
    expect(title).toContain('ctrl-click');
  });

  it('reports the current rung, not a fixed one, in the tooltip', () => {
    const { tasks, groups } = fixtureData();
    const { container, engine } = mount({ tasks, groups, locale: 'en-US', ...wide });
    overDays(engine);

    const title = labels(container, '.gantt-header__tick')[0].getAttribute('title') ?? '';
    expect(title).toContain('zoom to week');
  });

  it('stays within the engine domain', () => {
    const { tasks, groups } = fixtureData();
    const { container, engine } = mount({ tasks, groups, locale: 'en-US', ...wide });
    overYears(engine);

    // Repeated ctrl-clicks run off the top of the ladder into a domain fit;
    // clamping stays the engine's job and must still hold.
    for (let i = 0; i < 4; i++) {
      const band = labels(container, '.gantt-header__band')[0];
      if (!band) break;
      dispatch(band, 'click', { ctrlKey: true });
    }

    expect(engine.viewport.state.timeStart).toBeGreaterThanOrEqual(DOMAIN_START);
    expect(engine.viewport.state.timeEnd).toBeLessThanOrEqual(DOMAIN_END);
  });
});

