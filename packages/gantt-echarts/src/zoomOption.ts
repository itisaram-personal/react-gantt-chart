import { clamp, type GanttEngine, type GanttTheme } from "@gantt-chart/core";

/**
 * The `dataZoom` sliders: the option each renders from, and the mapping between
 * a slider window and the engine's camera.
 *
 * These are real ECharts `dataZoom` components — but each lives on its own
 * slider-only chart rather than on the plot, for two reasons. The plot's series
 * is `coordinateSystem: 'none'` and so has no axis for a dataZoom to bind to;
 * and a slider sharing the plot's canvas would lay ECharts' pointer handling
 * over the plot's own drag, marquee and wheel gestures.
 *
 * The engine still owns the camera. A slider is a controller and a view of it,
 * never a second source of truth: it maps its window onto
 * `viewport.setTimeRange` / `viewport.scrollTo`, and the engine's state — after
 * the engine's own clamping — is written back to the slider. Everything here is
 * pure, so both directions of that mapping are testable without a chart.
 */

/** A `dataZoom` window: both edges as percentages of the axis, 0..100. */
export interface GanttZoomWindow {
  start: number;
  end: number;
}

/** The whole axis, in the percentages `dataZoom` speaks. */
const FULL = 100;

/** How many buckets the time overview is summarised into. */
export const ZOOM_DENSITY_BUCKETS = 240;

/**
 * Lane-height rewrites below this many pixels are dropped.
 *
 * A drag that only pans asks for the scale it already has, but never to the last
 * decimal — the deadband keeps that rounding from churning the layout cache on
 * every frame of a pan.
 */
const LANE_HEIGHT_DEADBAND = 0.25;

/* ------------------------------------------------------------------ x axis */

/** Where the visible time window sits on the domain, as a slider window. */
export function timeZoomWindow(
  domain: readonly [number, number],
  range: { timeStart: number; timeEnd: number },
): GanttZoomWindow {
  const span = domain[1] - domain[0];
  if (span <= 0) return { start: 0, end: FULL };
  const at = (time: number): number => clamp(((time - domain[0]) / span) * FULL, 0, FULL);
  const start = at(range.timeStart);
  return { start, end: clamp(at(range.timeEnd), start, FULL) };
}

/**
 * The inverse: the time range a slider window asks for.
 *
 * Only what the window *asks for* — `viewport.setTimeRange` still has the last
 * word, since it is the one that knows about `min`/`maxTimeSpan` and the domain.
 */
export function timeZoomRange(
  domain: readonly [number, number],
  window: GanttZoomWindow,
): { start: number; end: number } {
  const span = domain[1] - domain[0];
  return {
    start: domain[0] + (window.start / FULL) * span,
    end: domain[0] + (window.end / FULL) * span,
  };
}

/**
 * Task starts per bucket across the domain, normalised to 0..1.
 *
 * Feeds the slider's data shadow, which is the overview drawn behind the window.
 * Bucketed by start alone rather than by covered span: this is a legibility aid a
 * couple of hundred pixels wide, and an O(n) pass keeps it affordable at 250K
 * tasks.
 */
export function taskDensity<T, G>(
  engine: GanttEngine<T, G>,
  buckets = ZOOM_DENSITY_BUCKETS,
): Float64Array {
  const out = new Float64Array(buckets);
  const [start, end] = engine.getDomain();
  const span = end - start;
  if (span <= 0) return out;

  const starts = engine.getDataModel().starts;
  for (let i = 0; i < starts.length; i++) {
    const bucket = Math.floor(((starts[i] - start) / span) * buckets);
    if (bucket >= 0 && bucket < buckets) out[bucket]++;
  }

  let peak = 0;
  for (let i = 0; i < buckets; i++) if (out[i] > peak) peak = out[i];
  if (peak > 0) for (let i = 0; i < buckets; i++) out[i] /= peak;
  return out;
}

/** Density buckets as `[time, value]` pairs on the domain. */
export function densitySeriesData(
  domain: readonly [number, number],
  density: ArrayLike<number>,
): [number, number][] {
  const span = domain[1] - domain[0];
  const width = span / Math.max(1, density.length);
  const data: [number, number][] = [];
  for (let i = 0; i < density.length; i++) {
    // Bucket centre: the shadow is a line, and its vertices belong mid-bucket.
    data.push([domain[0] + (i + 0.5) * width, density[i]]);
  }
  return data;
}

/* ------------------------------------------------------------------ y axis */

export interface RowZoomState {
  scrollTop: number;
  /** Plot height in px. */
  height: number;
  totalHeight: number;
}

/** Where the visible rows sit in the content, as a slider window. */
export function rowZoomWindow(state: RowZoomState): GanttZoomWindow {
  const { scrollTop, height, totalHeight } = state;
  if (totalHeight <= 0) return { start: 0, end: FULL };
  const start = clamp((scrollTop / totalHeight) * FULL, 0, FULL);
  return { start, end: clamp(((scrollTop + height) / totalHeight) * FULL, start, FULL) };
}

/** Content offset a row-slider window asks to be scrolled to. */
export function rowZoomScrollTop(window: GanttZoomWindow, totalHeight: number): number {
  return (window.start / FULL) * totalHeight;
}

export interface RowZoomLaneHeightInput {
  window: GanttZoomWindow;
  /** Plot height in px — what the window is asked to fill. */
  height: number;
  laneHeight: number;
  totalHeight: number;
  minLaneHeight: number;
  maxLaneHeight: number;
}

/**
 * The lane height that makes the window's slice of the rows fill the plot.
 *
 * Solved rather than stepped, which is why no snapshot of where the drag began is
 * needed: `totalHeight` is very nearly proportional to `laneHeight`, so
 * `laneHeight · height / (fraction · totalHeight)` lands on the scale at which
 * `height / totalHeight` *is* the window's own fraction — the same answer
 * whatever scale the drag is currently at, rather than one that compounds as the
 * events arrive. The residue from the parts of the layout that do not scale
 * (group headers, padding) is worked off over the next few events of the drag.
 *
 * A drag that only pans leaves the fraction alone, and so asks for the height it
 * already has. Null when the answer is the scale already in force — see
 * {@link LANE_HEIGHT_DEADBAND}.
 */
export function rowZoomLaneHeight(input: RowZoomLaneHeightInput): number | null {
  const { window, height, laneHeight, totalHeight, minLaneHeight, maxLaneHeight } = input;
  const fraction = (window.end - window.start) / FULL;
  if (fraction <= 0 || height <= 0 || totalHeight <= 0 || laneHeight <= 0) return null;

  const solved = (laneHeight * height) / (fraction * totalHeight);
  // Rounded so a sub-pixel wobble does not invalidate the layout cache.
  const next = Math.round(clamp(solved, minLaneHeight, maxLaneHeight) * 10) / 10;
  return Math.abs(next - laneHeight) < LANE_HEIGHT_DEADBAND ? null : next;
}

/* ------------------------------------------------------------------ options */

/** The bits of an axis a slider-only chart needs: an extent, and nothing drawn. */
export interface GanttZoomAxis {
  type: "value";
  show: false;
  min: number;
  max: number;
  inverse?: boolean;
  splitLine: { show: false };
}

/**
 * The series behind a slider.
 *
 * Invisible in the (zero-height) grid: it exists to give the axis an extent and
 * to be the shape the slider paints as its data shadow, which the slider styles
 * itself through `dataBackground`.
 */
export interface GanttZoomSeries {
  type: "line";
  silent: true;
  animation: false;
  symbol: "none";
  lineStyle: { opacity: 0 };
  areaStyle: { opacity: 0 };
  data: [number, number][];
}

export interface GanttZoomSlider {
  type: "slider";
  show: true;
  orient: "horizontal" | "vertical";
  xAxisIndex?: number;
  yAxisIndex?: number;
  start: number;
  end: number;
  /** The slider fills its own canvas: the container is the layout. */
  left: number;
  right: number;
  top: number;
  bottom: number;
  /**
   * Decided per slider, because the two want opposite things from the track.
   *
   * With it on, ECharts hands the track over to drawing a *new* window — a drag
   * anywhere on it brushes one out — and silences the filler, leaving the
   * existing window to be moved from a strip of its own along the edge. With it
   * off, the filler keeps its pointer events and dragging the window is what
   * pans.
   *
   * Off on the time bar, where panning is the gesture that matters and the
   * handles already zoom. On on the row bar, where brushing a band of rows to
   * zoom to them is worth more than a drag that only scrolls — see
   * {@link buildRowZoomOption}.
   */
  brushSelect: boolean;
  /** The band drawn while brushing. Only reachable with {@link brushSelect}. */
  brushStyle: { color: string };
  realtime: true;
  backgroundColor: string;
  borderColor: string;
  borderRadius: number;
  fillerColor: string;
  handleSize: string;
  handleStyle: { color: string; borderColor: string };
  /**
   * No *drawn* move strip. ECharts lays that handle outside the track, past the
   * thickness a slider filling its own canvas has already used up, so it would
   * be clipped away rather than seen. Its invisible grab zone survives at zero
   * size — ECharts gives it a 10px floor — which is what still lets the row
   * bar's window be dragged along the edge with {@link brushSelect} on.
   */
  moveHandleSize: 0;
  /**
   * Off on both sliders.
   *
   * ECharts draws the read-out *outside* the track, which a strip sized to the
   * slider would clip. The time header is already a live read-out of the window
   * the horizontal slider moves, and a content-pixel offset — all the vertical
   * one could report — is not worth reading out at all.
   */
  showDetail: false;
  showDataShadow: boolean;
  dataBackground: ZoomShadowStyle;
  selectedDataBackground: ZoomShadowStyle;
  emphasis: {
    handleStyle: { borderColor: string };
    /** Hover label, clipped for the same reason as {@link showDetail}. */
    handleLabel: { show: false };
  };
}

interface ZoomShadowStyle {
  lineStyle: { color: string; width: number };
  areaStyle: { color: string; opacity: number };
}

export interface GanttZoomOption {
  animation: false;
  backgroundColor: string;
  /**
   * Collapsed to nothing: the canvas is all slider. The grid still has to exist
   * for the axes to have a coordinate system, and the slider positions itself
   * relative to it when not told otherwise — which is why it is told otherwise.
   */
  grid: { left: number; right: number; top: number; height: number; show: false };
  xAxis: GanttZoomAxis;
  yAxis: GanttZoomAxis;
  dataZoom: [GanttZoomSlider];
  series: [GanttZoomSeries];
}

export interface TimeZoomOptionInput {
  domain: readonly [number, number];
  window: GanttZoomWindow;
  theme: GanttTheme;
  /** Density buckets over the domain; omit for a slider with a plain track. */
  density?: ArrayLike<number> | null;
}

/** The whole option for the horizontal time slider. */
export function buildTimeZoomOption(input: TimeZoomOptionInput): GanttZoomOption {
  const { domain, window, theme, density } = input;
  const shadow = Boolean(density && density.length > 0);

  return {
    ...zoomChrome(),
    xAxis: {
      type: "value",
      show: false,
      min: domain[0],
      max: domain[1],
      splitLine: { show: false },
    },
    yAxis: { type: "value", show: false, min: 0, max: 1, splitLine: { show: false } },
    dataZoom: [
      {
        ...slider(theme),
        orient: "horizontal",
        xAxisIndex: 0,
        start: window.start,
        end: window.end,
        showDataShadow: shadow,
        // The window is the pan grip here. See {@link GanttZoomSlider.brushSelect}.
        brushSelect: true,
      },
    ],
    series: [
      {
        ...zoomSeries(),
        data: shadow
          ? densitySeriesData(domain, density as ArrayLike<number>)
          : [
              [domain[0], 0],
              [domain[1], 0],
            ],
      },
    ],
  };
}

export interface RowZoomOptionInput {
  window: GanttZoomWindow;
  theme: GanttTheme;
}

/**
 * The whole option for the vertical row slider.
 *
 * Its axis is the *fraction* of the content, 0..1, not the content height in
 * pixels — deliberately, because dragging a handle rescales the rows and so
 * changes that height. An axis measured in pixels would have to be rewritten on
 * every frame of the drag, and rewriting the option is also what puts the window
 * back, so the slider would be fighting the pointer. In fractions nothing about
 * this option changes while the rows are rescaled.
 *
 * The axis is inverted so fraction 0 is at the top of the bar, where the first
 * row is: ECharts lays a vertical slider out from the axis minimum, and an
 * upright value axis puts its minimum at the bottom.
 *
 * Unlike the time bar it brushes: a drag anywhere on the track draws a band, and
 * the rows under it become the window — which, since the window is what sets the
 * scale, is a zoom straight to a stretch of rows however far off screen it
 * starts. The cost is the filler, which ECharts silences to make room for the
 * gesture, so dragging the window itself scrolls only from the strip along the
 * edge of the track. Scrolling has the wheel, the gutter and the scrollbar;
 * zooming to a run of rows had nothing.
 */
export function buildRowZoomOption(input: RowZoomOptionInput): GanttZoomOption {
  const { window, theme } = input;

  return {
    ...zoomChrome(),
    xAxis: { type: "value", show: false, min: 0, max: 1, splitLine: { show: false } },
    yAxis: {
      type: "value",
      show: false,
      min: 0,
      max: 1,
      inverse: true,
      splitLine: { show: false },
    },
    dataZoom: [
      {
        ...slider(theme),
        orient: "vertical",
        yAxisIndex: 0,
        start: window.start,
        end: window.end,
        showDataShadow: false,
        // Drawing a band over the rows zooms to them. See
        // {@link GanttZoomSlider.brushSelect}.
        brushSelect: true,
      },
    ],
    series: [
      {
        ...zoomSeries(),
        data: [
          [0, 0],
          [0, 1],
        ],
      },
    ],
  };
}

function zoomChrome(): Omit<GanttZoomOption, "xAxis" | "yAxis" | "dataZoom" | "series"> {
  return {
    animation: false,
    // The strip's own background shows through, so the track is themed in one
    // place — the slider's `backgroundColor`.
    backgroundColor: "transparent",
    grid: { left: 0, right: 0, top: 0, height: 0, show: false },
  };
}

function zoomSeries(): Omit<GanttZoomSeries, "data"> {
  return {
    type: "line",
    silent: true,
    animation: false,
    symbol: "none",
    lineStyle: { opacity: 0 },
    areaStyle: { opacity: 0 },
  };
}

/**
 * Styling shared by both sliders, taken off the theme.
 *
 * `brushSelect` is left out with the rest of what the two sliders disagree
 * about: it is a gesture decision, not chrome, and each builder states its own.
 */
type SliderChrome = Omit<
  GanttZoomSlider,
  "orient" | "start" | "end" | "showDataShadow" | "brushSelect"
>;

function slider(theme: GanttTheme): SliderChrome {
  const { colors } = theme;
  return {
    type: "slider",
    show: true,
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    realtime: true,
    backgroundColor: colors.scrollbarTrack,
    borderColor: colors.border,
    borderRadius: 3,
    fillerColor: withAlpha(colors.scrollbarThumb, 0.55),
    handleSize: "100%",
    handleStyle: { color: colors.background, borderColor: colors.accent },
    // Themed here rather than left to ECharts' own blue, which is tuned for a
    // light chart and reads as a smear on a dark one.
    brushStyle: { color: withAlpha(colors.accent, 0.18) },
    moveHandleSize: 0,
    showDetail: false,
    dataBackground: {
      lineStyle: { color: colors.gridLineStrong, width: 0.5 },
      areaStyle: { color: colors.gridLineStrong, opacity: 0.45 },
    },
    selectedDataBackground: {
      lineStyle: { color: colors.accent, width: 0.5 },
      areaStyle: { color: colors.accent, opacity: 0.35 },
    },
    emphasis: {
      handleStyle: { borderColor: colors.accent },
      handleLabel: { show: false },
    },
  };
}

/**
 * `#rrggbb` at a given opacity, and anything else untouched.
 *
 * Themes are free to use `rgba(...)` already, in which case its own alpha is the
 * one that was asked for.
 */
function withAlpha(color: string, alpha: number): string {
  if (!/^#[0-9a-f]{6}$/i.test(color)) return color;
  const value = Number.parseInt(color.slice(1), 16);
  // eslint-disable-next-line no-bitwise
  return `rgba(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}, ${alpha})`;
}
