import { describe, expect, it } from "vitest";
import { darkTheme, lightTheme } from "@gantt-chart/themes";
import { planGanttExport, resolveExportFrame } from "../src/export";
import type { GanttOption } from "../src/option";
import { dependenciesPlugin } from "../src/plugins/dependencies";
import { DAY, T0, fixture, flatten, ofType } from "./helpers";

/** `echarts` is never reached by the planning half of an export. */
const echarts = {
  init: () => {
    throw new Error("not used");
  },
} as never;

function seriesIds(option: GanttOption): string[] {
  return option.series.map((series) => series.id);
}

/** Run a single-datum series' renderItem and flatten the result. */
function renderSeries(option: GanttOption, id: string, dataIndex = 0) {
  const series = option.series.find((candidate) => candidate.id === id);
  if (!series) throw new Error(`no series ${id}`);
  return flatten(series.renderItem({ dataIndex }, null));
}

describe("resolveExportFrame", () => {
  it("defaults to the live viewport, with room for the chrome", () => {
    const { engine, theme } = fixture({ width: 800, height: 400 });
    const frame = resolveExportFrame({ engine, theme, echarts });

    expect(frame.viewport).toEqual(engine.viewport.state);
    expect(frame.gutterWidth).toBe(theme.metrics.axisWidth);
    expect(frame.headerHeight).toBe(theme.metrics.headerHeight);
    expect(frame.plotX).toBe(theme.metrics.axisWidth);
    expect(frame.plotY).toBe(theme.metrics.headerHeight);
    expect(frame.width).toBe(800 + theme.metrics.axisWidth);
    expect(frame.height).toBe(400 + theme.metrics.headerHeight);
    expect(frame.pixelRatio).toBe(2);
    expect(frame.downscaled).toBe(false);
  });

  it("frames the whole chart for scope 'full'", () => {
    const { engine, theme } = fixture({ groups: 6, tasksPerGroup: 3 });
    engine.viewport.scrollTo(50);
    const frame = resolveExportFrame({ engine, theme, echarts, scope: "full" });

    expect(frame.viewport.timeStart).toBe(engine.getDomain()[0]);
    expect(frame.viewport.timeEnd).toBe(engine.getDomain()[1]);
    // Every row, from the top, whatever the live scroll position is.
    expect(frame.viewport.height).toBe(Math.ceil(engine.totalHeight));
    expect(frame.viewport.scrollTop).toBe(0);
    // Width is the one thing a full export keeps from the screen.
    expect(frame.viewport.width).toBe(engine.viewport.state.width);
  });

  it("honours an explicit size, time range and padding, and drops the chrome", () => {
    const { engine, theme } = fixture();
    const frame = resolveExportFrame({
      engine,
      theme,
      echarts,
      width: 1200,
      height: 300,
      timeRange: [T0, T0 + 2 * DAY],
      padding: 16,
      showHeader: false,
      showRowGutter: false,
    });

    expect(frame.viewport.width).toBe(1200);
    expect(frame.viewport.height).toBe(300);
    expect(frame.viewport.timeStart).toBe(T0);
    expect(frame.viewport.timeEnd).toBe(T0 + 2 * DAY);
    expect(frame.headerHeight).toBe(0);
    expect(frame.gutterWidth).toBe(0);
    expect(frame.plotX).toBe(16);
    expect(frame.plotY).toBe(16);
    expect(frame.width).toBe(1200 + 32);
    expect(frame.height).toBe(300 + 32);
  });

  it("reduces the pixel ratio rather than the content when the canvas is capped", () => {
    const { engine, theme } = fixture();
    const frame = resolveExportFrame({
      engine,
      theme,
      echarts,
      width: 2000,
      height: 1000,
      showHeader: false,
      showRowGutter: false,
      pixelRatio: 4,
      maxDimension: 4000,
    });

    expect(frame.viewport.width).toBe(2000);
    expect(frame.pixelRatio).toBe(2);
    expect(frame.downscaled).toBe(true);
    expect(frame.width * frame.pixelRatio).toBeLessThanOrEqual(4000);
  });

  it("refuses an export that cannot fit even at 1×", () => {
    const { engine, theme } = fixture();
    expect(() =>
      resolveExportFrame({
        engine,
        theme,
        echarts,
        width: 40_000,
        showHeader: false,
        showRowGutter: false,
        pixelRatio: 1,
      }),
    ).toThrow(/exceeds the canvas limits/);
  });
});

describe("planGanttExport", () => {
  it("builds a one-pass plot option on the export background", () => {
    const { engine, theme } = fixture();
    const plan = planGanttExport({ engine, theme, echarts, now: null });

    expect(seriesIds(plan.option)).toEqual(["gantt-background", "gantt-items"]);
    expect(plan.option.backgroundColor).toBe(theme.colors.background);
    // Progressive chunking would be read back half-painted.
    for (const series of plan.option.series) expect(series.progressive ?? 0).toBe(0);
  });

  it("paints a transparent export on nothing", () => {
    const { engine, theme } = fixture();
    const plan = planGanttExport({ engine, theme, echarts, background: "transparent" });
    expect(plan.option.backgroundColor).toBe("transparent");
  });

  it("covers every bar and row for scope 'full'", () => {
    // Forty rows do not fit in 400 px (nor in the overscan around it), so the
    // live frame is missing bars the export has to include.
    const { engine, theme, tasks } = fixture({ groups: 40, tasksPerGroup: 2, height: 400 });
    expect(engine.getVisible().items.length).toBeLessThan(tasks.length);

    const plan = planGanttExport({ engine, theme, echarts, scope: "full", now: null });

    expect(plan.window.items).toHaveLength(tasks.length);
    expect(plan.rows).toHaveLength(engine.getLayout().rows.length);
    expect(plan.truncated).toBe(false);
    expect(plan.rows[0]?.label).toBe("Group 0");
    // Rows are positioned from the export viewport, so the first one starts at 0.
    expect(plan.rows[0]?.y).toBe(0);
  });

  it("reports truncation instead of hiding it", () => {
    const { engine, theme } = fixture({ groups: 4, tasksPerGroup: 6 });
    const plan = planGanttExport({ engine, theme, echarts, scope: "full", maxItems: 5 });

    expect(plan.window.items).toHaveLength(5);
    expect(plan.truncated).toBe(true);
  });

  it("leaves interaction state out of the image", () => {
    const { engine, theme, tasks } = fixture();
    engine.selection.set([tasks[0].id]);
    engine.setHovered(tasks[1].id, 0);
    engine.store.setState({ marquee: { x: 10, y: 10, width: 100, height: 50 } });

    const plan = planGanttExport({ engine, theme, echarts, now: null });

    // No marquee rectangle, no drag ghost.
    expect(seriesIds(plan.option)).not.toContain("gantt-interaction");
    // No hovered row band either.
    const bands = ofType(renderSeries(plan.option, "gantt-background"), "rect");
    for (const band of bands) {
      expect((band.style as { fill: string }).fill).not.toBe(theme.colors.rowHover);
    }
    // Selection, though, is state a reader set on purpose.
    const selected = plan.window.items.filter((item) => item.selected);
    expect(selected.map((item) => item.task.id)).toEqual([tasks[0].id]);
    expect(plan.window.items.some((item) => item.hovered)).toBe(false);
  });

  it("never moves the live chart", () => {
    const { engine, theme } = fixture();
    const viewport = engine.viewport.state;
    const version = engine.store.version;
    let viewportChanges = 0;
    engine.on("viewport:change", () => viewportChanges++);

    planGanttExport({ engine, theme, echarts, scope: "full", width: 2400 });

    expect(engine.viewport.state).toBe(viewport);
    expect(engine.store.version).toBe(version);
    expect(viewportChanges).toBe(0);
    expect(engine.getOptions().virtualization.overscanPx).toBeGreaterThan(0);
  });

  it("draws the grid from the same ticks the header labels", () => {
    const { engine, theme } = fixture();
    const plan = planGanttExport({ engine, theme, echarts, now: null });

    const lines = ofType(renderSeries(plan.option, "gantt-background"), "line");
    const vertical = lines.filter((line) => {
      const shape = line.shape as Record<string, number>;
      return shape.x1 === shape.x2;
    });

    expect(plan.header.scale.ticks.length).toBeGreaterThan(0);
    expect(vertical).toHaveLength(plan.header.scale.ticks.length);
    for (let i = 0; i < vertical.length; i++) {
      const shape = vertical[i].shape as Record<string, number>;
      expect(shape.x1).toBe(Math.round(plan.header.scale.ticks[i].x) + 0.5);
      // Grid lines span the export's height, not the screen's.
      expect(shape.y2).toBe(plan.frame.viewport.height);
    }
  });

  it("gives overlay plugins export geometry, not live geometry", () => {
    const { engine, theme, tasks } = fixture({ groups: 1, tasksPerGroup: 2 });
    engine.use(
      dependenciesPlugin({ theme, dependencies: [{ from: tasks[0].id, to: tasks[1].id }] }),
    );

    const plan = planGanttExport({ engine, theme, echarts, scope: "full", width: 1000, now: null });
    const polylines = ofType(renderSeries(plan.option, "gantt-overlay"), "polyline");
    expect(polylines).toHaveLength(1);

    const [domainStart, domainEnd] = engine.getDomain();
    const scale = 1000 / (domainEnd - domainStart);
    const points = (polylines[0].shape as { points: [number, number][] }).points;
    // The connector leaves the source bar's finish edge.
    expect(points[0][0]).toBeCloseTo((tasks[0].end - domainStart) * scale, 6);
    // Which is a very different pixel from where the live 10-day window puts it.
    expect(points[0][0]).not.toBeCloseTo(engine.viewport.timeToPx(tasks[0].end), 0);
  });

  it("skips the gutter model when the gutter is off", () => {
    const { engine, theme } = fixture();
    const plan = planGanttExport({ engine, theme, echarts, showRowGutter: false });
    expect(plan.rows).toEqual([]);
    expect(plan.frame.plotX).toBe(0);
  });

  it("follows the theme it is handed", () => {
    const { engine } = fixture();
    const plan = planGanttExport({ engine, theme: darkTheme, echarts });
    expect(plan.option.backgroundColor).toBe(darkTheme.colors.background);
    expect(plan.option.backgroundColor).not.toBe(lightTheme.colors.background);
  });
});
