/**
 * PNG export.
 *
 * The chart is a canvas, but the widget is not: the header and the row gutter are
 * DOM, so "export the chart" cannot be a single `toDataURL` on the live canvas.
 * The export is therefore assembled in two steps.
 *
 * 1. The plot is re-rendered into a throw-away ECharts instance at the requested
 *    size and pixel ratio, and pulled back out through zrender's painter
 *    (`getZr().painter.getRenderedCanvas()` — the internal call ECharts' own
 *    `getDataURL` is built on). Re-rendering rather than capturing the live
 *    canvas is what makes the export independent of the on-screen size, of the
 *    device pixel ratio, and of the live renderer being `svg`; it also leaves out
 *    the interaction artefacts (marquee, drag ghost, hovered row) that belong on
 *    screen and not in a saved image.
 * 2. The header and gutter are drawn onto the output canvas with the 2D API from
 *    the same models the React chrome renders — `computeTimeHeader` for the two
 *    tiers, `computeAxisRows` for the row labels — so the image lines up with the
 *    widget instead of approximating it.
 *
 * The engine is never mutated. `scope: 'full'` needs a different viewport than
 * the one on screen, and it gets one by building the frame for a *substituted*
 * viewport (see `exportEngineView`) rather than by panning the live chart and
 * putting it back.
 */

import {
  computeAxisRows,
  computeVisible,
  DAY,
  Store,
  ViewportController,
  type AxisRowDescriptor,
  type GanttEngine,
  type GanttEngineOptions,
  type GanttState,
  type GanttTheme,
  type GanttTimeMarker,
  type ViewportState,
  type VisibleWindow,
} from "@gantt-chart/core";
import type { EChartsLike } from "./adapter";
import type { EChartsModuleLike } from "./create";
import { fontShorthand } from "./elements";
import type { GanttItemRenderer } from "./itemRenderer";
import { buildGanttOption, type GanttOption } from "./option";
import { computeTimeHeader, type TimeHeaderModel } from "./timeScale";

/**
 * What to put in the image.
 *
 * `viewport` is what is on screen. `full` is the whole chart: every row, and the
 * entire time domain compressed into `width`.
 */
export type GanttExportScope = "viewport" | "full";

export interface GanttExportOptions {
  scope?: GanttExportScope;
  /** Plot width in CSS px, excluding the gutter. Defaults to the live width. */
  width?: number;
  /**
   * Plot height in CSS px, excluding the header. Defaults to the live height,
   * or — for `scope: 'full'` — to the height every row needs.
   */
  height?: number;
  /** Explicit time window, overriding whatever `scope` would choose. */
  timeRange?: readonly [number, number];
  /** Device pixels per CSS px. Defaults to 2; reduced if the image would be too big. */
  pixelRatio?: number;
  /** Image background. Defaults to the theme's; `'transparent'` leaves it unpainted. */
  background?: string | "transparent";
  /** Include the two-tier time header. On by default. */
  showHeader?: boolean;
  /** Include the row-label gutter. On by default. */
  showRowGutter?: boolean;
  /** Overrides the theme's `axisWidth`. */
  gutterWidth?: number;
  showGrid?: boolean;
  showRowBands?: boolean;
  /** Blank margin around the whole image, CSS px. Defaults to 0. */
  padding?: number;
  /** Desired pixel distance between time ticks; the step is chosen around it. */
  tickTargetPx?: number;
  /**
   * Ceiling on bars in the image. Defaults to 50 000 — well above the engine's
   * own per-frame limit, because an export is not asked to hold 60 fps. When it
   * bites, `truncated` says so.
   */
  maxItems?: number;
  /** Largest side of the output canvas in device px. Defaults to 16 384. */
  maxDimension?: number;
  /** Largest total area of the output canvas in device px. Defaults to 32 000 000. */
  maxPixels?: number;
}

export interface GanttExportInput<T = unknown, G = unknown> extends GanttExportOptions {
  engine: GanttEngine<T, G>;
  theme: GanttTheme;
  /** The `echarts` module — injected, so this package need not import it. */
  echarts: EChartsModuleLike;
  itemRenderer?: GanttItemRenderer<T, G>;
  locale?: string;
  weekStartsOn?: 0 | 1;
  /** Vertical time markers, drawn in the image exactly as they are on screen. */
  markers?: readonly GanttTimeMarker[];
  /** Last chance to adjust the plot option before it is rendered. */
  transformOption?: (option: GanttOption) => GanttOption;
}

/** Geometry of one export, in CSS px. */
export interface GanttExportFrame {
  /** The viewport the plot is rendered with — not the live one. */
  viewport: ViewportState;
  /** Top-left of the plot area inside the image. */
  plotX: number;
  plotY: number;
  headerHeight: number;
  gutterWidth: number;
  padding: number;
  /** The whole image. */
  width: number;
  height: number;
  pixelRatio: number;
  /** True when `pixelRatio` was reduced from what was asked to stay in budget. */
  downscaled: boolean;
}

/** Everything needed to paint an export, with nothing painted yet. */
export interface GanttExportPlan<T = unknown, G = unknown> {
  frame: GanttExportFrame;
  /** Option for the plot area alone. */
  option: GanttOption;
  header: TimeHeaderModel;
  /** Gutter rows; empty when the gutter is off. */
  rows: AxisRowDescriptor<G>[];
  window: VisibleWindow<T, G>;
  /** True when `maxItems` cut bars out of the frame. */
  truncated: boolean;
}

export interface GanttExportResult {
  canvas: HTMLCanvasElement;
  /** CSS px; the canvas itself is this times `pixelRatio`. */
  width: number;
  height: number;
  pixelRatio: number;
  /** True when `pixelRatio` was reduced to stay inside the canvas limits. */
  downscaled: boolean;
  /** True when `maxItems` cut bars out of the image. */
  truncated: boolean;
  rows: number;
  bars: number;
}

const DEFAULT_PIXEL_RATIO = 2;
/**
 * Browser canvas limits, conservatively. Chrome and Firefox cap a side at 32 767
 * px and Safari caps the area; both defaults sit below the lowest of those, and
 * both are overridable for a caller who knows their target.
 */
const DEFAULT_MAX_DIMENSION = 16_384;
const DEFAULT_MAX_PIXELS = 32_000_000;
const DEFAULT_MAX_ITEMS = 50_000;
/** Plot size to fall back on when the engine has never been sized (SSR, headless). */
const FALLBACK_PLOT_WIDTH = 960;
const FALLBACK_PLOT_HEIGHT = 540;

/* Chrome metrics, mirroring `styles.css` so the image matches the widget. */
const MIN_BAND_LABEL_WIDTH = 44;
const BAND_PADDING_X = 8;
const TICK_PADDING_X = 4;
const GUTTER_PADDING_X = 8;
const GUTTER_INDENT_PX = 14;
const GUTTER_TOGGLE_WIDTH = 16;
const GUTTER_TOGGLE_GAP = 4;

/* ------------------------------------------------------------------ *
 * Planning (pure)
 * ------------------------------------------------------------------ */

/**
 * Resolve the requested export into concrete geometry.
 *
 * `pixelRatio` is the only thing that gives way when an export does not fit:
 * content is never dropped to make room, so a 400-row export stays 400 rows and
 * simply lands at a lower ratio. An export that cannot fit even at 1× is an
 * error rather than a silent crop.
 */
export function resolveExportFrame<T, G>(input: GanttExportInput<T, G>): GanttExportFrame {
  const { engine, theme } = input;
  const live = engine.viewport.state;
  const scope = input.scope ?? "viewport";

  const padding = Math.max(0, Math.round(input.padding ?? 0));
  const gutterWidth =
    input.showRowGutter === false
      ? 0
      : Math.max(0, Math.round(input.gutterWidth ?? theme.metrics.axisWidth));
  const headerHeight =
    input.showHeader === false ? 0 : Math.max(0, Math.round(theme.metrics.headerHeight));

  const plotWidth = Math.max(1, Math.round(input.width ?? live.width ?? 0) || FALLBACK_PLOT_WIDTH);
  const wantedHeight =
    input.height ?? (scope === "full" ? Math.ceil(engine.totalHeight) : live.height);
  const plotHeight = Math.max(1, Math.round(wantedHeight) || FALLBACK_PLOT_HEIGHT);

  const [start, end] = resolveTimeRange(input, scope);
  const viewport: ViewportState = {
    timeStart: start,
    timeEnd: end,
    // A full export starts at the top; anything else keeps the live scroll so it
    // shows what the user is looking at.
    scrollTop: scope === "full" ? 0 : live.scrollTop,
    width: plotWidth,
    height: plotHeight,
  };

  const width = plotWidth + gutterWidth + padding * 2;
  const height = plotHeight + headerHeight + padding * 2;
  const maxDimension = input.maxDimension ?? DEFAULT_MAX_DIMENSION;
  const maxPixels = input.maxPixels ?? DEFAULT_MAX_PIXELS;
  const requested = Math.max(0.1, input.pixelRatio ?? DEFAULT_PIXEL_RATIO);

  const ceiling = Math.min(
    maxDimension / width,
    maxDimension / height,
    Math.sqrt(maxPixels / (width * height)),
  );
  if (ceiling < 1) {
    throw new Error(
      `[gantt] a ${width}×${height} px export exceeds the canvas limits ` +
        `(${maxDimension} px per side, ${maxPixels} px in total) even at 1×. ` +
        `Export a narrower width, fewer rows, or raise maxDimension/maxPixels.`,
    );
  }

  // Truncated rather than rounded: rounding up could push the canvas past a
  // limit the ceiling was computed to respect.
  const pixelRatio = Math.min(requested, Math.floor(ceiling * 100) / 100);

  return {
    viewport,
    plotX: padding + gutterWidth,
    plotY: padding + headerHeight,
    headerHeight,
    gutterWidth,
    padding,
    width,
    height,
    pixelRatio,
    downscaled: pixelRatio < requested,
  };
}

function resolveTimeRange<T, G>(
  input: GanttExportInput<T, G>,
  scope: GanttExportScope,
): [number, number] {
  const live = input.engine.viewport.state;
  const [start, end] =
    input.timeRange ??
    (scope === "full" ? input.engine.getDomain() : [live.timeStart, live.timeEnd]);
  // A degenerate window would render an empty plot; one day is the same
  // fallback the engine uses for a single-instant dataset.
  return end > start ? [start, end] : [start, start + DAY];
}

/**
 * Everything an export needs, computed without touching the DOM.
 *
 * Split out from the rendering so the geometry, the frame contents and the
 * chrome models can be tested in a plain node environment — and so a caller with
 * its own painter can use the plan directly.
 */
export function planGanttExport<T, G>(input: GanttExportInput<T, G>): GanttExportPlan<T, G> {
  const frame = resolveExportFrame(input);
  const view = exportEngineView(input.engine, frame.viewport, input.maxItems ?? DEFAULT_MAX_ITEMS);

  const header = computeTimeHeader({
    timeStart: frame.viewport.timeStart,
    timeEnd: frame.viewport.timeEnd,
    width: frame.viewport.width,
    targetPx: input.tickTargetPx,
    locale: input.locale,
    weekStartsOn: input.weekStartsOn,
  });

  let option = buildGanttOption<T, G>({
    engine: view.engine,
    theme: input.theme,
    itemRenderer: input.itemRenderer,
    // The header's own ticks, so the grid lines and the labels above them cannot
    // disagree about where a boundary is.
    ticks: header.scale,
    locale: input.locale,
    weekStartsOn: input.weekStartsOn,
    markers: input.markers,
    showGrid: input.showGrid,
    showRowBands: input.showRowBands,
    // A capture is read back the instant the option lands, so the frame has to
    // be painted in one pass: progressive chunking would hand back a
    // half-drawn plot.
    progressiveMinTasks: Number.POSITIVE_INFINITY,
  });
  if (input.transformOption) option = input.transformOption(option);

  const background = resolveBackground(input);
  option = { ...option, backgroundColor: background ?? "transparent" };

  return {
    frame,
    option,
    header,
    rows: frame.gutterWidth > 0 ? computeAxisRows(view.window, frame.viewport) : [],
    window: view.window,
    truncated: view.window.truncated,
  };
}

interface EngineView<T, G> {
  engine: GanttEngine<T, G>;
  window: VisibleWindow<T, G>;
}

/**
 * An engine that reports the export's viewport instead of the live one.
 *
 * Substituting rather than mutating is what keeps an export invisible to the
 * chart on screen: no viewport write, no store notification, no `viewport:change`
 * for the application to react to. The view is `Object.create(engine)`, so every
 * method and field falls through to the real engine except the five that must
 * not — the store (with interaction state cleared), the viewport controller, the
 * frame, the layout and the options.
 *
 * Going through the engine's own surface, rather than passing a viewport into the
 * option builder, is also what keeps *plugins* right: overlays are handed this
 * view, so a dependency arrow asking for `getTaskRect` gets export pixels.
 */
function exportEngineView<T, G>(
  engine: GanttEngine<T, G>,
  viewport: ViewportState,
  maxItems: number,
): EngineView<T, G> {
  const layout = engine.getLayout();
  const live = engine.store.getState();

  const options: GanttEngineOptions = {
    ...engine.getOptions(),
    // Overscan buys nothing when there is no next frame to pan into.
    virtualization: { overscanPx: 0, overscanRows: 0, maxVisibleItems: maxItems },
  };

  const window = computeVisible<T, G>({
    model: engine.getDataModel(),
    layout,
    viewport,
    options,
    // Selection is real state a reader set, so it stays; hover and drag are
    // transient and have no business in a saved image.
    selection: live.selection,
    hoveredTaskId: null,
    drag: null,
    revision: layout.revision,
  });

  const state: GanttState<T, G> = {
    ...live,
    viewport,
    drag: null,
    marquee: null,
    hoveredTaskId: null,
    hoveredRowIndex: null,
    contextMenu: null,
  };
  const store = new Store<GanttState<T, G>>(state);

  const view = Object.create(engine) as GanttEngine<T, G>;
  Object.defineProperties(view, {
    store: { value: store },
    viewport: {
      value: new ViewportController<T, G>({
        store,
        events: engine.events,
        getModel: () => engine.getDataModel(),
        getLayout: () => layout,
        getOptions: () => options,
        getDomain: () => engine.getDomain(),
      }),
    },
    getVisible: { value: () => window },
    getLayout: { value: () => layout },
    getOptions: { value: () => options },
  });

  return { engine: view, window };
}

/** `null` means "leave it unpainted". */
function resolveBackground<T, G>(input: GanttExportInput<T, G>): string | null {
  if (input.background === "transparent") return null;
  return input.background ?? input.theme.colors.background;
}

/* ------------------------------------------------------------------ *
 * Rendering
 * ------------------------------------------------------------------ */

/** The subset of an ECharts instance the export reads back through. */
interface EChartsExportable extends EChartsLike {
  getZr?(): {
    painter?: {
      getRenderedCanvas?(opts?: {
        pixelRatio?: number;
        backgroundColor?: string;
      }): HTMLCanvasElement;
    };
  };
}

/**
 * Render an export and return the canvas.
 *
 * Synchronous: the plot is drawn in one non-progressive pass and read straight
 * out of the painter, so there is no frame to wait for.
 */
export function renderGanttToCanvas<T, G>(input: GanttExportInput<T, G>): GanttExportResult {
  const plan = planGanttExport(input);
  const plot = renderPlotCanvas(input, plan);
  const canvas = composeExport(input, plan, plot);

  if (plan.truncated) {
    console.warn(
      `[gantt] the export was truncated at ${input.maxItems ?? DEFAULT_MAX_ITEMS} bars; ` +
        `raise maxItems to include the rest.`,
    );
  }

  return {
    canvas,
    width: plan.frame.width,
    height: plan.frame.height,
    pixelRatio: plan.frame.pixelRatio,
    downscaled: plan.frame.downscaled,
    truncated: plan.truncated,
    rows: plan.window.rows.length,
    bars: plan.window.items.length,
  };
}

/** The export as a `data:image/png` URL. */
export function ganttToPngDataURL<T, G>(input: GanttExportInput<T, G>): string {
  return renderGanttToCanvas(input).canvas.toDataURL("image/png");
}

/** The export as a PNG blob — the cheap route to a file or an upload. */
export function ganttToPngBlob<T, G>(input: GanttExportInput<T, G>): Promise<Blob> {
  const { canvas } = renderGanttToCanvas(input);
  return new Promise((resolve, reject) => {
    if (typeof canvas.toBlob !== "function") {
      reject(new Error("[gantt] this environment has no canvas.toBlob; use ganttToPngDataURL."));
      return;
    }
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("[gantt] the browser produced no PNG blob for the export."));
    }, "image/png");
  });
}

export interface GanttDownloadInput<T = unknown, G = unknown> extends GanttExportInput<T, G> {
  /** Defaults to `gantt.png`; `.png` is appended when missing. */
  filename?: string;
}

/** Render and save the export as a file. */
export async function downloadGanttPng<T, G>(input: GanttDownloadInput<T, G>): Promise<void> {
  const blob = await ganttToPngBlob(input);
  const document = requireDocument();
  const url = URL.createObjectURL(blob);
  const name = input.filename ?? "gantt.png";
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name.toLowerCase().endsWith(".png") ? name : `${name}.png`;
  anchor.rel = "noopener";
  anchor.click();

  // Deferred, not immediate: some browsers read the blob after the click
  // returns, and revoking in a `finally` cancels the save they were starting.
  if (typeof setTimeout === "function") setTimeout(() => URL.revokeObjectURL(url), 10_000);
  else URL.revokeObjectURL(url);
}

function requireDocument(): Document {
  const candidate = (globalThis as { document?: Document }).document;
  if (!candidate?.createElement) {
    throw new Error("[gantt] a PNG export needs a DOM; there is no document here.");
  }
  return candidate;
}

/**
 * The plot area, rendered by a throw-away chart and read back out of zrender.
 *
 * The host element is never attached to the page: the size is passed to `init`
 * explicitly, so nothing has to be measured, and an export therefore costs the
 * document no reflow.
 */
function renderPlotCanvas<T, G>(
  input: GanttExportInput<T, G>,
  plan: GanttExportPlan<T, G>,
): HTMLCanvasElement {
  const { frame, option } = plan;
  const document = requireDocument();
  const host = document.createElement("div");
  host.setAttribute("aria-hidden", "true");
  host.style.position = "absolute";
  host.style.width = `${frame.viewport.width}px`;
  host.style.height = `${frame.viewport.height}px`;

  const chart = input.echarts.init(host, null, {
    renderer: "canvas",
    width: frame.viewport.width,
    height: frame.viewport.height,
    devicePixelRatio: frame.pixelRatio,
  });
  try {
    chart.setOption(option, { lazyUpdate: false, silent: true });
    return renderedCanvas(chart, frame.pixelRatio, resolveBackground(input));
  } finally {
    chart.dispose?.();
  }
}

/**
 * zrender's painter, which is where a canvas at an arbitrary pixel ratio comes
 * from. ECharts' own `getDataURL` calls the same method and then stringifies it;
 * the canvas is what this needs, because the chrome is drawn on top of it.
 */
function renderedCanvas(
  chart: EChartsLike,
  pixelRatio: number,
  background: string | null,
): HTMLCanvasElement {
  const painter = (chart as EChartsExportable).getZr?.()?.painter;
  const get = painter?.getRenderedCanvas;
  if (typeof get !== "function") {
    throw new Error(
      "[gantt] this ECharts build exposes no canvas painter to export from " +
        "(getZr().painter.getRenderedCanvas is missing).",
    );
  }
  return get.call(painter, {
    pixelRatio,
    ...(background === null ? null : { backgroundColor: background }),
  });
}

/** Stitch the plot together with the chrome at the export's pixel ratio. */
function composeExport<T, G>(
  input: GanttExportInput<T, G>,
  plan: GanttExportPlan<T, G>,
  plot: HTMLCanvasElement,
): HTMLCanvasElement {
  const { frame } = plan;
  const canvas = requireDocument().createElement("canvas");
  canvas.width = Math.round(frame.width * frame.pixelRatio);
  canvas.height = Math.round(frame.height * frame.pixelRatio);

  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("[gantt] could not acquire a 2d context for the export canvas.");
  // Everything below is written in CSS px; the ratio is applied once, here.
  ctx.scale(frame.pixelRatio, frame.pixelRatio);

  const background = resolveBackground(input);
  if (background !== null) {
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, frame.width, frame.height);
  }

  ctx.drawImage(plot, frame.plotX, frame.plotY, frame.viewport.width, frame.viewport.height);
  drawChrome(ctx, input.theme, plan);
  return canvas;
}

/* ------------------------------------------------------------------ *
 * Chrome
 * ------------------------------------------------------------------ */

function drawChrome<T, G>(
  ctx: CanvasRenderingContext2D,
  theme: GanttTheme,
  plan: GanttExportPlan<T, G>,
): void {
  const { frame } = plan;
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";

  if (frame.gutterWidth > 0) drawGutter(ctx, theme, plan);
  if (frame.headerHeight > 0) drawHeader(ctx, theme, plan);

  const right = frame.plotX + frame.viewport.width;
  const bottom = frame.plotY + frame.viewport.height;

  // Gutter/plot divider, and the line under the header, both full-length so the
  // corner reads as part of the same frame.
  if (frame.gutterWidth > 0) {
    strokeLine(ctx, frame.plotX, frame.padding, frame.plotX, bottom, theme.colors.border);
  }
  if (frame.headerHeight > 0) {
    strokeLine(ctx, frame.padding, frame.plotY, right, frame.plotY, theme.colors.border);
  }

  // The widget's own outer border, so the image has an edge on any background.
  ctx.strokeStyle = theme.colors.border;
  ctx.lineWidth = 1;
  ctx.strokeRect(
    frame.padding + 0.5,
    frame.padding + 0.5,
    frame.gutterWidth + frame.viewport.width - 1,
    frame.headerHeight + frame.viewport.height - 1,
  );
}

function drawHeader<T, G>(
  ctx: CanvasRenderingContext2D,
  theme: GanttTheme,
  plan: GanttExportPlan<T, G>,
): void {
  const { frame, header } = plan;
  const x = frame.plotX;
  const top = frame.padding;
  const width = frame.viewport.width;
  const middle = top + frame.headerHeight / 2;
  const bottom = top + frame.headerHeight;
  const { labelSize, family } = theme.font;

  ctx.save();
  ctx.beginPath();
  ctx.rect(x, top, width, frame.headerHeight);
  ctx.clip();

  for (const band of header.bands) {
    // The first band opens off-screen left, where a divider would read as a
    // stray line rather than a boundary.
    if (band.x > 0) {
      strokeLine(ctx, x + band.x, top, x + band.x, middle, theme.colors.gridLineStrong);
    }
    if (band.width < MIN_BAND_LABEL_WIDTH) continue;
    ctx.font = fontShorthand(600, labelSize, family);
    ctx.fillStyle = theme.colors.text;
    ctx.fillText(
      truncate(ctx, band.label, band.width - BAND_PADDING_X * 2),
      x + band.x + BAND_PADDING_X,
      (top + middle) / 2,
    );
  }

  for (const tick of header.scale.ticks) {
    strokeLine(
      ctx,
      x + tick.x,
      middle,
      x + tick.x,
      bottom,
      tick.major ? theme.colors.gridLineStrong : theme.colors.gridLine,
    );
    ctx.font = fontShorthand(400, labelSize, family);
    ctx.fillStyle = tick.major ? theme.colors.text : theme.colors.textMuted;
    ctx.fillText(tick.label, x + tick.x + TICK_PADDING_X, (middle + bottom) / 2);
  }

  ctx.restore();
  strokeLine(ctx, x, middle, x + width, middle, theme.colors.gridLine);
}

function drawGutter<T, G>(
  ctx: CanvasRenderingContext2D,
  theme: GanttTheme,
  plan: GanttExportPlan<T, G>,
): void {
  const { frame, rows } = plan;
  const x = frame.padding;
  const top = frame.plotY;
  const width = frame.gutterWidth;
  const { size, labelSize, family } = theme.font;

  ctx.save();
  ctx.beginPath();
  ctx.rect(x, top, width, frame.viewport.height);
  ctx.clip();

  for (const row of rows) {
    const y = top + row.y;
    ctx.fillStyle = row.odd ? theme.colors.rowOdd : theme.colors.rowEven;
    ctx.fillRect(x, y, width, row.height);
    strokeLine(ctx, x, y + row.height, x + width, y + row.height, theme.colors.gridLine);

    const centre = y + row.height / 2;
    let textX = x + GUTTER_PADDING_X + row.depth * GUTTER_INDENT_PX;

    // The collapse control's box is reserved on every row, so labels at the same
    // depth line up whether or not the group has children.
    if (row.hasChildren) {
      ctx.font = fontShorthand(400, 10, family);
      ctx.fillStyle = theme.colors.textMuted;
      ctx.fillText(row.collapsed ? "▸" : "▾", textX + 3, centre);
    }
    textX += GUTTER_TOGGLE_WIDTH + GUTTER_TOGGLE_GAP;

    let available = x + width - GUTTER_PADDING_X - textX;
    if (row.row.laneCount > 1) {
      const lanes = String(row.row.laneCount);
      ctx.font = fontShorthand(400, labelSize, family);
      ctx.fillStyle = theme.colors.textMuted;
      ctx.textAlign = "right";
      ctx.fillText(lanes, x + width - GUTTER_PADDING_X, centre);
      ctx.textAlign = "left";
      available -= ctx.measureText(lanes).width + GUTTER_TOGGLE_GAP;
    }

    ctx.font = fontShorthand(400, size, family);
    ctx.fillStyle = theme.colors.text;
    ctx.fillText(truncate(ctx, row.label, available), textX, centre);
  }

  ctx.restore();
}

/** A 1px line on the device-pixel grid, whatever the ratio. */
function strokeLine(
  ctx: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  stroke: string,
): void {
  ctx.beginPath();
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 1;
  ctx.moveTo(Math.round(x1) + 0.5, Math.round(y1) + 0.5);
  ctx.lineTo(Math.round(x2) + 0.5, Math.round(y2) + 0.5);
  ctx.stroke();
}

/**
 * Clip text to `maxWidth`, ending in an ellipsis — what `text-overflow` does for
 * the DOM chrome and what canvas will not do on its own.
 */
function truncate(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (maxWidth <= 0) return "";
  if (ctx.measureText(text).width <= maxWidth) return text;

  let low = 0;
  let high = text.length;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if (ctx.measureText(`${text.slice(0, mid)}…`).width <= maxWidth) low = mid;
    else high = mid - 1;
  }
  return low > 0 ? `${text.slice(0, low)}…` : "";
}
