import { afterEach, describe, expect, it } from 'vitest';
import * as echarts from 'echarts';
import { barInset } from '@gantt-chart/core';
import { darkTheme, lightTheme } from '@gantt-chart/themes';
import { GanttEChartsAdapter, type EChartsLike } from '../src/adapter';
import { DAY, T0, fixture } from './helpers';

/**
 * These tests drive a real ECharts instance in SSR mode, which is the only way
 * to prove the option this package builds is one ECharts actually accepts:
 * `coordinateSystem: 'none'`, no axes, and elements positioned in raw pixels.
 * The SVG string is the rendered truth.
 */
interface SsrChart extends EChartsLike {
  renderToSVGString(): string;
  dispose(): void;
}

function ssrChart(width = 800, height = 400): SsrChart {
  return echarts.init(null, null, { renderer: 'svg', ssr: true, width, height }) as unknown as SsrChart;
}

const open: { adapter?: GanttEChartsAdapter<never, never>; chart?: SsrChart }[] = [];

function track(adapter: unknown, chart: SsrChart): void {
  open.push({ adapter: adapter as GanttEChartsAdapter<never, never>, chart });
}

afterEach(() => {
  for (const entry of open.splice(0)) {
    entry.adapter?.dispose();
    entry.chart?.dispose();
  }
});

/** Coordinates of every `<path>`/`<rect>` in the SVG, in document order. */
function paths(svg: string): string[] {
  return svg.match(/<path [^>]*d="[^"]*"/g) ?? [];
}

/**
 * Data indices ECharts tagged for one series. Series 1 is `gantt-items`; the
 * background series is 0 and always contributes its single datum, so it has to
 * be filtered out before counting bars.
 */
function dataIndices(svg: string, seriesIndex = 1): number[] {
  const pattern = /ecmeta_series_index="(\d+)"\s+ecmeta_data_index="(\d+)"/g;
  const out: number[] = [];
  for (let match = pattern.exec(svg); match !== null; match = pattern.exec(svg)) {
    if (Number(match[1]) === seriesIndex) out.push(Number(match[2]));
  }
  return out;
}

/**
 * Was a bar painted at this rect?
 *
 * A square rect serialises as move-then-relative-lines, so the geometry the
 * engine computed is readable straight out of the path data — but zrender
 * rounds those coordinates to one decimal on the way out, so the numbers are
 * pulled back out and compared rather than substring-matched.
 */
function hasBarAt(svg: string, rect: { x: number; y: number; width: number }): boolean {
  const pattern = /M(-?[\d.]+) (-?[\d.]+)l(-?[\d.]+) 0/g;
  const near = (value: number, target: number): boolean => Math.abs(value - target) <= 0.06;
  for (let match = pattern.exec(svg); match !== null; match = pattern.exec(svg)) {
    if (near(Number(match[1]), rect.x) && near(Number(match[2]), rect.y) && near(Number(match[3]), rect.width)) {
      return true;
    }
  }
  return false;
}

/** A square-cornered bar, so the SVG path is a plain move-and-line. */
const plainBar = (context: { geometry: { x: number; y: number; width: number; height: number } }) => ({
  type: 'rect' as const,
  shape: { ...context.geometry },
  style: { fill: '#ff0000' },
});

describe('rendering through a real ECharts instance', () => {
  it('accepts the option and draws the frame', () => {
    const { engine } = fixture({ groups: 3, tasksPerGroup: 4 });
    const chart = ssrChart();
    const adapter = new GanttEChartsAdapter(engine, { theme: lightTheme, now: () => null });
    adapter.attach(chart);
    track(adapter, chart);

    const svg = chart.renderToSVGString();
    expect(svg.startsWith('<svg')).toBe(true);
    expect(svg).toContain('width="800"');
    expect(svg).toContain('height="400"');

    // Bars, row bands and grid lines all made it onto the canvas.
    expect(paths(svg).length).toBeGreaterThan(engine.getVisible().items.length);
    // ECharts tagged one element per visible datum, which only happens if the
    // custom series was understood.
    expect(new Set(dataIndices(svg)).size).toBeGreaterThan(1);
  });

  it('renders bar labels as real text', () => {
    const { engine } = fixture({ groups: 2, tasksPerGroup: 2 });
    const chart = ssrChart();
    const adapter = new GanttEChartsAdapter(engine, { theme: lightTheme, now: () => null });
    adapter.attach(chart);
    track(adapter, chart);

    const svg = chart.renderToSVGString();
    expect(svg).toContain('Task 0.0');
    expect(svg).toContain('Task 1.1');
  });

  it('places a bar where the engine says it goes', () => {
    const { engine } = fixture({ groups: 1, tasksPerGroup: 1 });
    const chart = ssrChart();
    const adapter = new GanttEChartsAdapter(engine, {
      theme: lightTheme,
      now: () => null,
      itemRenderer: plainBar,
      showGrid: false,
      showRowBands: false,
    });
    adapter.attach(chart);
    track(adapter, chart);

    const row = engine.getLayout().rows[0];
    const rect = engine.getTaskRect('g0-t0')!;
    expect(rect.x).toBeCloseTo(0, 6);
    expect(rect.width).toBeCloseTo(80, 6); // One day at 10 days per 800px.
    // Row top + lane offset + item padding. Read off the layout rather than
    // hardcoded: both paddings are proportions of their box by default.
    expect(rect.y).toBeCloseTo(
      row.y + row.laneOffset + barInset(row.laneHeight, engine.getOptions().metrics.itemPaddingY),
      6,
    );

    expect(hasBarAt(chart.renderToSVGString(), rect)).toBe(true);
  });

  it('moves the bars when the viewport pans', () => {
    const { engine } = fixture({ groups: 1, tasksPerGroup: 4 });
    const chart = ssrChart();
    const adapter = new GanttEChartsAdapter(engine, {
      theme: lightTheme,
      now: () => null,
      itemRenderer: plainBar,
    });
    adapter.attach(chart);
    track(adapter, chart);

    const start = engine.getTaskRect('g0-t2')!; // Starts on day 4.
    const before = chart.renderToSVGString();
    expect(start.x).toBeCloseTo(320, 6);
    expect(hasBarAt(before, start)).toBe(true);

    engine.viewport.panByTime(2 * DAY);
    adapter.render();
    const after = chart.renderToSVGString();

    expect(after).not.toBe(before);
    // Panning two days forward moves that bar 160px left.
    const moved = engine.getTaskRect('g0-t2')!;
    expect(moved.x).toBeCloseTo(160, 6);
    expect(hasBarAt(after, moved)).toBe(true);
  });

  it('repaints with the new theme', () => {
    const { engine } = fixture({ groups: 2, tasksPerGroup: 2 });
    const chart = ssrChart();
    const adapter = new GanttEChartsAdapter(engine, { theme: lightTheme, now: () => null });
    adapter.attach(chart);
    track(adapter, chart);

    expect(chart.renderToSVGString()).toContain(lightTheme.colors.rowOdd);
    adapter.setTheme(darkTheme);
    adapter.render();

    const svg = chart.renderToSVGString();
    expect(svg).toContain(darkTheme.colors.rowOdd);
    expect(svg).not.toContain(lightTheme.colors.rowOdd);
  });

  it('thickens the outline of a selected bar', () => {
    const { engine } = fixture({ groups: 1, tasksPerGroup: 2 });
    const chart = ssrChart();
    const adapter = new GanttEChartsAdapter(engine, { theme: lightTheme, now: () => null });
    adapter.attach(chart);
    track(adapter, chart);

    expect(chart.renderToSVGString()).not.toContain(lightTheme.colors.selectionStroke);
    engine.selection.set(['g0-t0']);
    adapter.render();

    const svg = chart.renderToSVGString();
    expect(svg).toContain(lightTheme.colors.selectionStroke);
    expect(svg).toContain(`stroke-width="${lightTheme.metrics.selectedStrokeWidth}"`);
  });

  it('draws the now marker inside the window', () => {
    const { engine } = fixture();
    const chart = ssrChart();
    const adapter = new GanttEChartsAdapter(engine, {
      theme: lightTheme,
      now: () => T0 + 3 * DAY,
    });
    adapter.attach(chart);
    track(adapter, chart);

    expect(chart.renderToSVGString()).toContain(lightTheme.colors.todayLine);
  });

  it('survives an empty dataset', () => {
    const { engine } = fixture({ groups: 1, tasksPerGroup: 1 });
    engine.setData([], []);
    const chart = ssrChart();
    const adapter = new GanttEChartsAdapter(engine, { theme: lightTheme, now: () => null });
    adapter.attach(chart);
    track(adapter, chart);

    const svg = chart.renderToSVGString();
    expect(svg.startsWith('<svg')).toBe(true);
    expect(dataIndices(svg)).toEqual([]);
  });

  it('re-renders after a resize at the new size', () => {
    const { engine } = fixture({ groups: 2, tasksPerGroup: 2 });
    const chart = ssrChart();
    const adapter = new GanttEChartsAdapter(engine, { theme: lightTheme, now: () => null });
    adapter.attach(chart);
    track(adapter, chart);

    adapter.resize(500, 200);
    const svg = chart.renderToSVGString();
    expect(svg).toContain('width="500"');
    expect(svg).toContain('height="200"');
    expect(engine.viewport.state.width).toBe(500);
    // Bars are re-laid out for the narrower plot: one day is now 50px.
    expect(engine.getTaskRect('g0-t0')?.width).toBeCloseTo(50, 6);
  });

  it('renders a large frame within the visible-item cap', () => {
    const { engine } = fixture({ groups: 200, tasksPerGroup: 20 });
    const chart = ssrChart(1200, 800);
    const adapter = new GanttEChartsAdapter(engine, { theme: lightTheme, now: () => null });
    adapter.attach(chart);
    track(adapter, chart);

    const visible = engine.getVisible();
    expect(engine.getTasks()).toHaveLength(4000);
    // Virtualization keeps the frame proportional to the viewport, not the data.
    expect(visible.items.length).toBeLessThan(engine.getTasks().length);

    const svg = chart.renderToSVGString();
    expect(new Set(dataIndices(svg)).size).toBeGreaterThan(0);
    expect(new Set(dataIndices(svg)).size).toBeLessThanOrEqual(visible.items.length);
  });
});
