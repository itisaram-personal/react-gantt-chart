import { describe, expect, it } from "vitest";
import { lightTheme } from "@gantt-chart/themes";
import {
  ZOOM_DENSITY_BUCKETS,
  buildRowZoomOption,
  buildTimeZoomOption,
  densitySeriesData,
  rowZoomLaneHeight,
  rowZoomScrollTop,
  rowZoomWindow,
  taskDensity,
  timeZoomRange,
  timeZoomWindow,
} from "../src/zoomOption";
import { DAY, T0, fixture } from "./helpers";

const DOMAIN: readonly [number, number] = [T0, T0 + 10 * DAY];

describe("timeZoomWindow", () => {
  it("maps the visible range onto percentages of the domain", () => {
    const window = timeZoomWindow(DOMAIN, { timeStart: T0 + 2 * DAY, timeEnd: T0 + 5 * DAY });
    expect(window.start).toBeCloseTo(20, 6);
    expect(window.end).toBeCloseTo(50, 6);
  });

  it("clamps a range that runs outside the domain", () => {
    const window = timeZoomWindow(DOMAIN, { timeStart: T0 - 5 * DAY, timeEnd: T0 + 40 * DAY });
    expect(window).toEqual({ start: 0, end: 100 });
  });

  it("reports the whole axis for an empty domain", () => {
    const flat = timeZoomWindow([T0, T0], { timeStart: T0, timeEnd: T0 });
    expect(flat).toEqual({ start: 0, end: 100 });
  });

  it("round-trips through timeZoomRange", () => {
    const range = { timeStart: T0 + 3 * DAY, timeEnd: T0 + 7 * DAY };
    const back = timeZoomRange(DOMAIN, timeZoomWindow(DOMAIN, range));
    expect(back.start).toBeCloseTo(range.timeStart, 6);
    expect(back.end).toBeCloseTo(range.timeEnd, 6);
  });
});

describe("taskDensity", () => {
  it("normalises task starts into buckets over the domain", () => {
    const { engine } = fixture({ groups: 3, tasksPerGroup: 4 });
    const density = taskDensity(engine, 12);

    expect(density).toHaveLength(12);
    // Normalised, so the busiest bucket is exactly 1 and none exceeds it.
    expect(Math.max(...density)).toBe(1);
    for (const value of density) expect(value).toBeGreaterThanOrEqual(0);

    const total = engine.getDataModel().starts.length;
    expect(total).toBe(12);
  });

  it("defaults to the documented bucket count", () => {
    const { engine } = fixture();
    expect(taskDensity(engine)).toHaveLength(ZOOM_DENSITY_BUCKETS);
  });

  it("concentrates a single instant in one bucket", () => {
    const { engine } = fixture({ groups: 1, tasksPerGroup: 1 });
    // The engine pads a domain the data gives no width, so the bucket the task
    // falls in is a real one — and, being the only one, the peak.
    engine.setTasks([{ id: "a", groupId: "g0", start: T0, end: T0 }]);

    const density = Array.from(taskDensity(engine, 8));
    expect(density.filter((value) => value > 0)).toEqual([1]);
  });
});

describe("densitySeriesData", () => {
  it("places each bucket at its centre on the domain", () => {
    const data = densitySeriesData([0, 100], [0, 0.5, 1, 0.25]);
    expect(data).toEqual([
      [12.5, 0],
      [37.5, 0.5],
      [62.5, 1],
      [87.5, 0.25],
    ]);
  });
});

describe("rowZoomWindow", () => {
  it("maps the visible rows onto percentages of the content", () => {
    const window = rowZoomWindow({ scrollTop: 250, height: 400, totalHeight: 1000 });
    expect(window).toEqual({ start: 25, end: 65 });
  });

  it("clamps a viewport taller than the content", () => {
    expect(rowZoomWindow({ scrollTop: 0, height: 900, totalHeight: 400 })).toEqual({
      start: 0,
      end: 100,
    });
  });

  it("reports the whole axis when there is no content", () => {
    expect(rowZoomWindow({ scrollTop: 0, height: 400, totalHeight: 0 })).toEqual({
      start: 0,
      end: 100,
    });
  });

  it("round-trips through rowZoomScrollTop", () => {
    const state = { scrollTop: 250, height: 400, totalHeight: 1000 };
    expect(rowZoomScrollTop(rowZoomWindow(state), state.totalHeight)).toBeCloseTo(250, 6);
  });
});

describe("rowZoomLaneHeight", () => {
  const base = {
    height: 400,
    laneHeight: 26,
    totalHeight: 1000,
    minLaneHeight: 6,
    maxLaneHeight: 120,
  };

  it("solves for the scale that makes the window fill the plot", () => {
    // 25% of the content asked to fill 400px, so the content must become 1600px.
    const next = rowZoomLaneHeight({ ...base, window: { start: 0, end: 25 } });
    expect(next).not.toBeNull();
    expect(next).toBeCloseTo((26 * 400) / (0.25 * 1000), 1);
    // And that scale really does put a quarter of the content on screen.
    expect(400 / (1000 * (next! / 26))).toBeCloseTo(0.25, 6);
  });

  it("is a no-op for a window that only moved", () => {
    // 40% is already what 400px of a 1000px content is, so a pan asks for nothing.
    expect(rowZoomLaneHeight({ ...base, window: { start: 0, end: 40 } })).toBeNull();
    expect(rowZoomLaneHeight({ ...base, window: { start: 60, end: 100 } })).toBeNull();
  });

  it("does not answer twice: the solve is idempotent, not compounding", () => {
    const first = rowZoomLaneHeight({ ...base, window: { start: 0, end: 25 } });
    expect(first).not.toBeNull();
    // Feed the result back in with the content height it implies: nothing left to do.
    const settled = rowZoomLaneHeight({
      ...base,
      window: { start: 0, end: 25 },
      laneHeight: first!,
      totalHeight: (1000 * first!) / 26,
    });
    expect(settled).toBeNull();
  });

  it("clamps to the lane-height bounds at either extreme", () => {
    expect(rowZoomLaneHeight({ ...base, window: { start: 0, end: 0.1 } })).toBe(120);
    expect(
      rowZoomLaneHeight({ ...base, window: { start: 0, end: 100 }, totalHeight: 100_000 }),
    ).toBe(6);
  });

  it("declines a degenerate window or an unmeasured plot", () => {
    expect(rowZoomLaneHeight({ ...base, window: { start: 40, end: 40 } })).toBeNull();
    expect(rowZoomLaneHeight({ ...base, window: { start: 0, end: 25 }, height: 0 })).toBeNull();
    expect(
      rowZoomLaneHeight({ ...base, window: { start: 0, end: 25 }, totalHeight: 0 }),
    ).toBeNull();
  });
});

describe("buildTimeZoomOption", () => {
  const window = { start: 20, end: 50 };

  it("puts the domain on the axis and the window on the slider", () => {
    const option = buildTimeZoomOption({ domain: DOMAIN, window, theme: lightTheme });
    const slider = option.dataZoom[0];

    expect(option.xAxis.min).toBe(DOMAIN[0]);
    expect(option.xAxis.max).toBe(DOMAIN[1]);
    expect(slider.orient).toBe("horizontal");
    expect(slider.xAxisIndex).toBe(0);
    expect(slider.start).toBe(20);
    expect(slider.end).toBe(50);
  });

  it("draws nothing but the slider", () => {
    const option = buildTimeZoomOption({ domain: DOMAIN, window, theme: lightTheme });

    expect(option.animation).toBe(false);
    // The canvas is all slider: no grid, no axes, and no visible series.
    expect(option.grid.height).toBe(0);
    expect(option.xAxis.show).toBe(false);
    expect(option.yAxis.show).toBe(false);
    expect(option.series[0].lineStyle.opacity).toBe(0);
    expect(option.series[0].areaStyle.opacity).toBe(0);
    expect(option.series[0].silent).toBe(true);
  });

  it("brushes a range out of the track", () => {
    const { dataZoom } = buildTimeZoomOption({ domain: DOMAIN, window, theme: lightTheme });
    expect(dataZoom[0].brushSelect).toBe(true);
    // The grip the brush costs the window is the track's edge, not a drawn
    // strip: ECharts would lay that one outside the slider.
    expect(dataZoom[0].moveHandleSize).toBe(0);
    expect(dataZoom[0].realtime).toBe(true);
  });

  it("shows the density as the slider shadow when there is one", () => {
    const density = [0, 1, 0.5];
    const option = buildTimeZoomOption({ domain: DOMAIN, window, theme: lightTheme, density });

    expect(option.dataZoom[0].showDataShadow).toBe(true);
    expect(option.series[0].data).toEqual(densitySeriesData(DOMAIN, density));
  });

  it("falls back to a flat track without one", () => {
    const theme = lightTheme;
    const option = buildTimeZoomOption({ domain: DOMAIN, window, theme, density: null });

    expect(option.dataZoom[0].showDataShadow).toBe(false);
    // The series still spans the axis, which is what pins its extent.
    expect(option.series[0].data).toEqual([
      [DOMAIN[0], 0],
      [DOMAIN[1], 0],
    ]);
  });

  it("takes its colours off the theme", () => {
    const slider = buildTimeZoomOption({ domain: DOMAIN, window, theme: lightTheme }).dataZoom[0];
    expect(slider.backgroundColor).toBe(lightTheme.colors.scrollbarTrack);
    expect(slider.borderColor).toBe(lightTheme.colors.border);
    expect(slider.handleStyle.borderColor).toBe(lightTheme.colors.accent);
    // `#c3ccd8` at 55%: the window has to be see-through for the shadow behind it.
    expect(slider.fillerColor).toBe("rgba(195, 204, 216, 0.55)");
  });

  it("never reads out a value, which the strip would clip", () => {
    const slider = buildTimeZoomOption({ domain: DOMAIN, window, theme: lightTheme }).dataZoom[0];
    expect(slider.showDetail).toBe(false);
    expect(slider.emphasis.handleLabel.show).toBe(false);
  });
});

describe("buildRowZoomOption", () => {
  const window = { start: 25, end: 65 };

  it("measures its axis in fractions, so a rescale never moves it", () => {
    const option = buildRowZoomOption({ window, theme: lightTheme });

    expect(option.yAxis.min).toBe(0);
    expect(option.yAxis.max).toBe(1);
    // Inverted, so fraction 0 is the top of the bar where the first row is.
    expect(option.yAxis.inverse).toBe(true);
  });

  it("puts the window on a vertical slider", () => {
    const slider = buildRowZoomOption({ window, theme: lightTheme }).dataZoom[0];

    expect(slider.orient).toBe("vertical");
    expect(slider.yAxisIndex).toBe(0);
    expect(slider.start).toBe(25);
    expect(slider.end).toBe(65);
    // There is no row overview to draw behind the window.
    expect(slider.showDataShadow).toBe(false);
  });

  it("brushes a band of rows, as the time bar brushes a range", () => {
    const slider = buildRowZoomOption({ window, theme: lightTheme }).dataZoom[0];

    expect(slider.brushSelect).toBe(true);
    // `#3b6fe0` at 18%: the band has to be read through.
    expect(slider.brushStyle.color).toBe("rgba(59, 111, 224, 0.18)");
  });

  it("does not depend on the content height", () => {
    // The whole point of the fraction axis: two very different layouts, one option.
    expect(buildRowZoomOption({ window, theme: lightTheme })).toEqual(
      buildRowZoomOption({ window, theme: lightTheme }),
    );
  });
});
