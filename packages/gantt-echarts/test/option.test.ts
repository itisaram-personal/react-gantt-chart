import { describe, expect, it } from 'vitest';
import { darkTheme, lightTheme } from '@gantt-chart/themes';
import { buildGanttOption, type GanttCustomSeries, type GanttOption } from '../src/option';
import { computeTimeTicks } from '../src/timeScale';
import { DAY, T0, fixture, flatten, ofType } from './helpers';

function seriesById(option: GanttOption, id: string): GanttCustomSeries | undefined {
  return option.series.find((series) => series.id === id);
}

/** Run a single-datum series' renderItem and flatten the result. */
function renderSeries(option: GanttOption, id: string, dataIndex = 0) {
  const series = seriesById(option, id);
  if (!series) throw new Error(`no series ${id}`);
  return flatten(series.renderItem({ dataIndex }, null));
}

describe('buildGanttOption', () => {
  it('emits animation-free background and item series', () => {
    const { engine, theme } = fixture();
    const option = buildGanttOption({ engine, theme });

    expect(option.animation).toBe(false);
    expect(option.backgroundColor).toBe(theme.colors.background);
    expect(option.series.map((series) => series.id)).toEqual(['gantt-background', 'gantt-items']);

    for (const series of option.series) {
      expect(series.type).toBe('custom');
      // No axes exist, so the series must not ask for a coordinate system.
      expect(series.coordinateSystem).toBe('none');
      expect(series.animation).toBe(false);
      expect(series.silent).toBe(true);
      // ECharts' own hover styling would fight the engine's selection state.
      expect(series.emphasis).toEqual({ disabled: true });
    }
  });

  it('gives the item series one datum per visible bar', () => {
    const { engine, theme } = fixture({ groups: 3, tasksPerGroup: 4 });
    const visible = engine.getVisible();
    const option = buildGanttOption({ engine, theme });
    const items = seriesById(option, 'gantt-items');

    expect(visible.items.length).toBeGreaterThan(0);
    expect(items?.data).toHaveLength(visible.items.length);
    expect(items?.data).toEqual(visible.items.map((_, index) => index));
  });

  it('renders a bar as a rect with the engine geometry and a label', () => {
    const { engine, theme } = fixture({ groups: 1, tasksPerGroup: 1 });
    const option = buildGanttOption({ engine, theme });
    const elements = renderSeries(option, 'gantt-items', 0);

    const rects = ofType(elements, 'rect');
    expect(rects).toHaveLength(1);

    const item = engine.getVisible().items[0];
    const shape = rects[0].shape as Record<string, number>;
    expect(shape.x).toBeCloseTo(engine.viewport.timeToPx(item.start), 6);
    expect(shape.width).toBeCloseTo(
      engine.viewport.timeToPx(item.end) - engine.viewport.timeToPx(item.start),
      6,
    );
    expect(shape.y).toBeCloseTo(item.y - engine.viewport.state.scrollTop, 6);
    expect(shape.height).toBe(item.height);

    const texts = ofType(elements, 'text');
    expect((texts[0].style as Record<string, unknown>).text).toBe('Task 0.0');
  });

  it('renders a milestone as a diamond centred on its instant', () => {
    const { engine, theme } = fixture({ groups: 1, tasksPerGroup: 1, milestones: true });
    const option = buildGanttOption({ engine, theme });

    const items = engine.getVisible().items;
    const index = items.findIndex((item) => item.start === item.end);
    expect(index).toBeGreaterThanOrEqual(0);

    const elements = renderSeries(option, 'gantt-items', index);
    const polygons = ofType(elements, 'polygon');
    expect(polygons).toHaveLength(1);

    const points = (polygons[0].shape as { points: [number, number][] }).points;
    expect(points).toHaveLength(4);
    const centreX = engine.viewport.timeToPx(items[index].start);
    // Top and bottom vertices sit on the centre line; left and right straddle it.
    expect(points[0][0]).toBeCloseTo(centreX, 6);
    expect(points[2][0]).toBeCloseTo(centreX, 6);
    expect(points[1][0]).toBeGreaterThan(centreX);
    expect(points[3][0]).toBeLessThan(centreX);
  });

  it('draws a progress fill only when the task carries progress', () => {
    const { engine, theme } = fixture({ groups: 1, tasksPerGroup: 2 });
    const marked = engine.getTasks()[0].id;
    engine.setTasks(
      engine.getTasks().map((task) =>
        task.id === marked ? { ...task, data: { ...task.data, progress: 0.5 } } : task,
      ),
    );

    // The frame is ordered by row then start time, not by input order, so the
    // datum index has to be looked up rather than assumed.
    const items = engine.getVisible().items;
    const withIndex = items.findIndex((item) => item.task.id === marked);
    const withoutIndex = items.findIndex((item) => item.task.id !== marked);
    expect(withIndex).toBeGreaterThanOrEqual(0);
    expect(withoutIndex).toBeGreaterThanOrEqual(0);

    const option = buildGanttOption({ engine, theme });
    const withProgress = ofType(renderSeries(option, 'gantt-items', withIndex), 'rect');
    const without = ofType(renderSeries(option, 'gantt-items', withoutIndex), 'rect');

    expect(withProgress).toHaveLength(2);
    expect(without).toHaveLength(1);

    const bar = withProgress[0].shape as Record<string, number>;
    const fill = withProgress[1].shape as Record<string, number>;
    expect(fill.width).toBeCloseTo(bar.width * 0.5, 6);
  });

  it('honours a custom renderer, including one that skips bars', () => {
    const { engine, theme } = fixture({ groups: 1, tasksPerGroup: 3 });
    const items = engine.getVisible().items;
    const skipped = items[0].task.id;

    const option = buildGanttOption({
      engine,
      theme,
      itemRenderer: (context) =>
        context.task.id === skipped
          ? null
          : { type: 'circle', shape: { cx: context.geometry.x, cy: 0, r: 4 } },
    });

    const series = seriesById(option, 'gantt-items');
    expect(series?.renderItem({ dataIndex: 0 }, null)).toBeNull();
    expect(series?.renderItem({ dataIndex: 1 }, null)?.type).toBe('circle');
  });

  it('returns null past the end of the frame rather than throwing', () => {
    const { engine, theme } = fixture({ groups: 1, tasksPerGroup: 1 });
    const series = seriesById(buildGanttOption({ engine, theme }), 'gantt-items');
    // ECharts can call renderItem for a stale data index during a teardown frame.
    expect(series?.renderItem({ dataIndex: 999 }, null)).toBeNull();
  });
});

describe('background series', () => {
  it('bands every visible row and separates them', () => {
    const { engine, theme } = fixture({ groups: 4, tasksPerGroup: 2 });
    const rowCount = engine.getVisible().rows.length;
    const elements = renderSeries(buildGanttOption({ engine, theme }), 'gantt-background');

    const rects = ofType(elements, 'rect');
    expect(rects).toHaveLength(rowCount);
    for (const rect of rects) {
      const shape = rect.shape as Record<string, number>;
      expect(shape.x).toBe(0);
      expect(shape.width).toBe(engine.viewport.state.width);
    }

    // One separator per row, plus one grid line per tick, plus the now marker.
    const lines = ofType(elements, 'line');
    expect(lines.length).toBeGreaterThanOrEqual(rowCount);
  });

  it('alternates band colours and highlights the hovered row', () => {
    const { engine, theme } = fixture({ groups: 4, tasksPerGroup: 1 });
    engine.setHovered(null, 2);

    const rects = ofType(renderSeries(buildGanttOption({ engine, theme }), 'gantt-background'), 'rect');
    const fills = rects.map((rect) => (rect.style as Record<string, string>).fill);

    expect(fills[0]).toBe(theme.colors.rowEven);
    expect(fills[1]).toBe(theme.colors.rowOdd);
    expect(fills[2]).toBe(theme.colors.rowHover);
  });

  it('draws one grid line per tick, emphasising major ones', () => {
    const { engine, theme } = fixture();
    const viewport = engine.viewport.state;
    const ticks = computeTimeTicks({
      timeStart: viewport.timeStart,
      timeEnd: viewport.timeEnd,
      width: viewport.width,
    });

    const elements = renderSeries(
      buildGanttOption({ engine, theme, ticks, showRowBands: false, now: null }),
      'gantt-background',
    );
    const lines = ofType(elements, 'line');
    expect(lines).toHaveLength(ticks.ticks.length);

    const strokes = lines.map((line) => (line.style as Record<string, string>).stroke);
    const expected = ticks.ticks.map((tick) =>
      tick.major ? theme.colors.gridLineStrong : theme.colors.gridLine,
    );
    expect(strokes).toEqual(expected);

    for (let i = 0; i < lines.length; i++) {
      const shape = lines[i].shape as Record<string, number>;
      // Half-pixel offset keeps a 1px line crisp instead of smeared over two.
      expect(shape.x1).toBeCloseTo(Math.round(ticks.ticks[i].x) + 0.5, 6);
      expect(shape.x1).toBe(shape.x2);
      expect(shape.y1).toBe(0);
      expect(shape.y2).toBe(viewport.height);
    }
  });

  it('shows the now marker only while it is inside the window', () => {
    const { engine, theme } = fixture();
    const inside = T0 + 3 * DAY;

    const withMarker = renderSeries(
      buildGanttOption({ engine, theme, now: inside, showGrid: false, showRowBands: false }),
      'gantt-background',
    );
    const markers = ofType(withMarker, 'line').filter(
      (line) => (line.style as Record<string, string>).stroke === theme.colors.todayLine,
    );
    expect(markers).toHaveLength(1);
    expect((markers[0].shape as Record<string, number>).x1).toBeCloseTo(
      engine.viewport.timeToPx(inside),
      6,
    );

    for (const now of [T0 - 30 * DAY, T0 + 300 * DAY, null]) {
      const elements = renderSeries(
        buildGanttOption({ engine, theme, now, showGrid: false, showRowBands: false }),
        'gantt-background',
      );
      expect(ofType(elements, 'line')).toHaveLength(0);
    }
  });

  it('can drop bands and grid lines entirely', () => {
    const { engine, theme } = fixture();
    const elements = renderSeries(
      buildGanttOption({ engine, theme, showRowBands: false, showGrid: false, now: null }),
      'gantt-background',
    );
    // Only the wrapping group survives.
    expect(elements).toHaveLength(1);
    expect(elements[0].type).toBe('group');
  });
});

describe('interaction series', () => {
  it('is absent when nothing is being dragged or marqueed', () => {
    const { engine, theme } = fixture();
    expect(seriesById(buildGanttOption({ engine, theme }), 'gantt-interaction')).toBeUndefined();
  });

  it('draws the marquee rectangle from store state', () => {
    const { engine, theme } = fixture();
    engine.store.setState({ marquee: { x: 20, y: 30, width: 120, height: 60 } });

    const elements = renderSeries(buildGanttOption({ engine, theme }), 'gantt-interaction');
    const rects = ofType(elements, 'rect');
    expect(rects).toHaveLength(1);
    expect(rects[0].shape).toMatchObject({ x: 20, y: 30, width: 120, height: 60 });
    expect((rects[0].style as Record<string, unknown>).fill).toBe(theme.colors.marqueeFill);
  });

  it('ignores a zero-area marquee', () => {
    const { engine, theme } = fixture();
    engine.store.setState({ marquee: { x: 20, y: 30, width: 0, height: 0 } });
    expect(seriesById(buildGanttOption({ engine, theme }), 'gantt-interaction')).toBeUndefined();
  });

  it('ghosts the origin of an active drag', () => {
    const { engine, theme } = fixture({ groups: 1, tasksPerGroup: 2 });
    const task = engine.getTasks()[0];
    const before = engine.getTaskRect(task.id);
    expect(before).not.toBeNull();

    engine.drag.begin(task.id, { x: before!.x + 4, y: before!.y + 4 });
    engine.drag.move({ x: before!.x + 80, y: before!.y + 4 });
    expect(engine.drag.isDragging).toBe(true);

    const elements = renderSeries(buildGanttOption({ engine, theme }), 'gantt-interaction');
    const ghost = ofType(elements, 'rect')[0];
    // The ghost marks where the bar *was*; the moved copy is drawn by the item
    // series, which is why the two must not share coordinates.
    expect(ghost.shape).toMatchObject({ x: before!.x, y: before!.y, width: before!.width });
    expect((ghost.style as Record<string, unknown>).lineDash).toEqual([4, 3]);

    const moved = engine.getVisible().items.find((item) => item.task.id === task.id);
    expect(moved?.start).toBeGreaterThan(task.start);
  });
});

describe('overlay series', () => {
  it('appears only when a plugin contributes elements, and receives plot geometry', () => {
    const { engine, theme } = fixture();
    expect(seriesById(buildGanttOption({ engine, theme }), 'gantt-overlay')).toBeUndefined();

    const seen: { width: number; height: number; atStart: number }[] = [];
    engine.overlays.register('probe', (context) => {
      seen.push({
        width: context.width,
        height: context.height,
        atStart: context.timeToPx(engine.viewport.state.timeStart),
      });
      return [{ type: 'circle', shape: { cx: 1, cy: 2, r: 3 } }];
    });

    const elements = renderSeries(buildGanttOption({ engine, theme }), 'gantt-overlay');
    expect(ofType(elements, 'circle')).toHaveLength(1);
    expect(seen[0]).toEqual({
      width: engine.viewport.state.width,
      height: engine.viewport.state.height,
      atStart: 0,
    });
  });

  it('paints overlays above bars and interaction above overlays', () => {
    const { engine, theme } = fixture();
    engine.overlays.register('probe', () => [{ type: 'circle', shape: { cx: 0, cy: 0, r: 1 } }]);
    engine.store.setState({ marquee: { x: 0, y: 0, width: 10, height: 10 } });

    const option = buildGanttOption({ engine, theme });
    const z = new Map(option.series.map((series) => [series.id, series.z]));
    expect(z.get('gantt-background')).toBeLessThan(z.get('gantt-items')!);
    expect(z.get('gantt-items')).toBeLessThan(z.get('gantt-overlay')!);
    expect(z.get('gantt-overlay')).toBeLessThan(z.get('gantt-interaction')!);
  });
});

describe('theming and progressive rendering', () => {
  it('takes every colour from the supplied theme', () => {
    const { engine } = fixture();
    const option = buildGanttOption({ engine, theme: darkTheme });
    expect(option.backgroundColor).toBe(darkTheme.colors.background);

    const rects = ofType(renderSeries(option, 'gantt-background'), 'rect');
    expect((rects[0].style as Record<string, string>).fill).toBe(darkTheme.colors.rowEven);
    expect(darkTheme.colors.rowEven).not.toBe(lightTheme.colors.rowEven);
  });

  it('passes the progressive threshold through to the item series', () => {
    const { engine, theme } = fixture();
    const option = buildGanttOption({
      engine,
      theme,
      progressiveThreshold: 500,
      progressiveChunkSize: 250,
      // The fixture is tiny, so opt it past the dataset gate — what is under test
      // here is the plumbing, not the gate.
      progressiveMinTasks: 0,
    });
    const items = seriesById(option, 'gantt-items');
    expect(items?.progressiveThreshold).toBe(500);
    expect(items?.progressive).toBe(250);
  });

  it('switches chunking off for a dataset below the gate', () => {
    const { engine, theme } = fixture({ groups: 3, tasksPerGroup: 4 });
    const option = buildGanttOption({ engine, theme, progressiveChunkSize: 250, progressiveMinTasks: 50_000 });
    // 12 tasks. `progressive: 0` is how ECharts is told to draw in one pass.
    expect(seriesById(option, 'gantt-items')?.progressive).toBe(0);
  });

  it('chunks once the dataset reaches the gate', () => {
    const { engine, theme } = fixture({ groups: 4, tasksPerGroup: 5 });
    expect(engine.getDataModel().tasks).toHaveLength(20);

    const option = buildGanttOption({ engine, theme, progressiveChunkSize: 250, progressiveMinTasks: 20 });
    expect(seriesById(option, 'gantt-items')?.progressive).toBe(250);
  });

  it('gates on the dataset by default, so a small chart is never chunked', () => {
    const { engine, theme } = fixture();
    expect(seriesById(buildGanttOption({ engine, theme }), 'gantt-items')?.progressive).toBe(0);
  });
});
