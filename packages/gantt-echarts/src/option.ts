import {
  computeRowBands,
  RenderContextBuilder,
  type GanttEngine,
  type GanttTheme,
  type GanttTimeMarker,
  type OverlayContext,
  type ViewportState,
} from '@gantt-chart/core';
import { fontShorthand, type GanttElement } from './elements';
import { defaultItemRenderer, type GanttItemRenderer } from './itemRenderer';
import { computeTimeTicks, type TimeTickScale } from './timeScale';

/**
 * A custom series as this adapter builds it.
 *
 * `coordinateSystem: 'none'` is the whole trick: the engine has already resolved
 * every bar to plot pixels, so the chart is asked for nothing but element
 * management (diffing, batching, progressive rendering) and the canvas it owns
 * *is* the plot area. No axis, no dataZoom, and therefore no second source of
 * truth for pan/zoom to disagree with.
 */
export interface GanttCustomSeries {
  id: string;
  type: 'custom';
  coordinateSystem: 'none';
  data: number[];
  renderItem: (params: { dataIndex: number }, api: unknown) => GanttElement | null;
  z: number;
  silent: boolean;
  animation: boolean;
  emphasis: { disabled: true };
  progressive?: number;
  progressiveThreshold?: number;
}

export interface GanttOption {
  animation: false;
  backgroundColor: string;
  /**
   * No `grid`, no axes: the canvas is the plot area, and every coordinate in the
   * option is already a plot pixel.
   */
  series: GanttCustomSeries[];
}

export interface GanttOptionInput<T = unknown, G = unknown> {
  engine: GanttEngine<T, G>;
  theme: GanttTheme;
  itemRenderer?: GanttItemRenderer<T, G>;
  /** Pre-computed ticks; computed from the viewport when omitted. */
  ticks?: TimeTickScale;
  tickTargetPx?: number;
  locale?: string;
  weekStartsOn?: 0 | 1;
  /**
   * Vertical lines at fixed instants — releases, freezes, sprint boundaries, and
   * a "today" line if the chart wants one.
   */
  markers?: readonly GanttTimeMarker[];
  showRowBands?: boolean;
  showGrid?: boolean;
  /** Bars beyond this count are rendered in progressive chunks. */
  progressiveThreshold?: number;
  progressiveChunkSize?: number;
  /**
   * Datasets smaller than this render in a single pass, with progressive
   * chunking switched off entirely.
   *
   * Chunking only pays for itself when a frame is big enough that splitting it
   * beats the cost of painting across several frames. Below that it is a
   * liability: the frame lands in visible pieces, and because a chunked frame is
   * not committed all at once, a fast pan can show a half-drawn plot. Small and
   * medium datasets are far quicker to just draw.
   */
  progressiveMinTasks?: number;
}

const Z_BACKGROUND = 1;
const Z_ITEMS = 2;
/** Marker chips clear the bars; their lines stay in the background with the grid. */
const Z_MARKER_LABEL = 3;
const Z_OVERLAY = 4;
const Z_INTERACTION = 5;

/**
 * Builds the whole chart option for the current frame.
 *
 * Pure with respect to the engine: it reads derived state and returns an option
 * object. The adapter decides *when* to call it.
 */
export function buildGanttOption<T, G>(input: GanttOptionInput<T, G>): GanttOption {
  const {
    engine,
    theme,
    itemRenderer = defaultItemRenderer as GanttItemRenderer<T, G>,
    showRowBands = true,
    showGrid = true,
    progressiveThreshold = 3000,
    progressiveChunkSize = 1000,
    progressiveMinTasks = 50_000,
  } = input;

  const window = engine.getVisible();
  const layout = engine.getLayout();
  const viewport = engine.viewport.state;
  const state = engine.store.getState();

  const ticks =
    input.ticks ??
    computeTimeTicks({
      timeStart: viewport.timeStart,
      timeEnd: viewport.timeEnd,
      width: viewport.width,
      targetPx: input.tickTargetPx,
      locale: input.locale,
      weekStartsOn: input.weekStartsOn,
    });

  const builder = new RenderContextBuilder<T, G>({
    window,
    viewport,
    theme,
    minItemWidth: engine.getOptions().metrics.minItemWidth,
    laneHeight: engine.getOptions().metrics.laneHeight,
    primaryTaskId: state.drag?.originTaskId ?? null,
  });

  const items = window.items;
  const markers = input.markers;

  /*
   * Gated on the *dataset* size, not on how many bars this frame happens to
   * hold: whether chunking is worth it is a property of the data you are asked
   * to draw, and keying it on the frame would flip the mode mid-pan as bars come
   * in and out of view. `progressive: 0` is ECharts' own off switch.
   */
  const chunked = engine.getDataModel().tasks.length >= progressiveMinTasks;

  const series: GanttCustomSeries[] = [
    {
      id: 'gantt-background',
      type: 'custom',
      coordinateSystem: 'none',
      data: [0],
      z: Z_BACKGROUND,
      silent: true,
      animation: false,
      emphasis: { disabled: true },
      renderItem: () => ({
        type: 'group',
        silent: true,
        children: [
          ...(showRowBands ? rowBandElements(engine, theme) : []),
          ...(showGrid ? gridElements(ticks, viewport.height, theme) : []),
          // Under the bars: a marker is a reference the chart is read against,
          // not something drawn over the work.
          ...markerLineElements(markers, viewport, theme),
        ],
      }),
    },
    {
      id: 'gantt-items',
      type: 'custom',
      coordinateSystem: 'none',
      // One datum per visible bar; ECharts diffs elements between frames.
      data: items.map((_, index) => index),
      z: Z_ITEMS,
      silent: true,
      animation: false,
      emphasis: { disabled: true },
      progressive: chunked ? progressiveChunkSize : 0,
      progressiveThreshold,
      renderItem: (params) => {
        const item = items[params.dataIndex];
        if (!item) return null;
        const row = layout.rows[item.rowIndex];
        if (!row) return null;
        return itemRenderer(builder.build(item, row, row.group));
      },
    },
  ];

  const markerLabels = markerLabelElements(markers, viewport, theme);
  if (markerLabels.length > 0) {
    series.push({
      id: 'gantt-marker-labels',
      type: 'custom',
      coordinateSystem: 'none',
      data: [0],
      z: Z_MARKER_LABEL,
      silent: true,
      animation: false,
      emphasis: { disabled: true },
      renderItem: () => ({ type: 'group', silent: true, children: markerLabels }),
    });
  }

  const overlays = overlayElements(engine, viewport.width, viewport.height);
  if (overlays.length > 0) {
    series.push({
      id: 'gantt-overlay',
      type: 'custom',
      coordinateSystem: 'none',
      data: [0],
      z: Z_OVERLAY,
      silent: true,
      animation: false,
      emphasis: { disabled: true },
      renderItem: () => ({ type: 'group', silent: true, children: overlays }),
    });
  }

  const interaction = interactionElements(engine, theme);
  if (interaction.length > 0) {
    series.push({
      id: 'gantt-interaction',
      type: 'custom',
      coordinateSystem: 'none',
      data: [0],
      z: Z_INTERACTION,
      silent: true,
      animation: false,
      emphasis: { disabled: true },
      renderItem: () => ({ type: 'group', silent: true, children: interaction }),
    });
  }

  return {
    animation: false,
    backgroundColor: theme.colors.background,
    series,
  };
}

function rowBandElements<T, G>(engine: GanttEngine<T, G>, theme: GanttTheme): GanttElement[] {
  const viewport = engine.viewport.state;
  const state = engine.store.getState();
  const bands = computeRowBands(engine.getVisible(), viewport, state.hoveredRowIndex);
  const out: GanttElement[] = [];

  for (const band of bands) {
    const fill = band.hovered ? theme.colors.rowHover : band.odd ? theme.colors.rowOdd : theme.colors.rowEven;
    out.push({
      type: 'rect',
      shape: { x: 0, y: band.y, width: viewport.width, height: band.height },
      style: { fill },
      silent: true,
    });
    // Row separator, drawn on the bottom edge so it never overlaps a bar.
    out.push({
      type: 'line',
      shape: { x1: 0, y1: band.y + band.height, x2: viewport.width, y2: band.y + band.height },
      style: { stroke: theme.colors.gridLine, lineWidth: 1 },
      silent: true,
    });
  }
  return out;
}

function gridElements(ticks: TimeTickScale, height: number, theme: GanttTheme): GanttElement[] {
  const out: GanttElement[] = [];
  for (const tick of ticks.ticks) {
    const x = Math.round(tick.x) + 0.5; // Crisp 1px line on a device-pixel grid.
    out.push({
      type: 'line',
      shape: { x1: x, y1: 0, x2: x, y2: height },
      style: {
        stroke: tick.major ? theme.colors.gridLineStrong : theme.colors.gridLine,
        lineWidth: 1,
      },
      silent: true,
    });
  }
  return out;
}

/** Marker line width when the marker does not ask for one. */
const MARKER_LINE_WIDTH = 1.5;
const MARKER_LABEL_PADDING_X = 5;
const MARKER_LABEL_PADDING_Y = 2;
const MARKER_LABEL_TOP = 3;
/** Gap a chip keeps from the one before it, px. */
const MARKER_LABEL_GAP = 4;
/** Chip text is trimmed to this before it is measured. */
const MARKER_LABEL_MAX_CHARS = 40;

/**
 * Marker `x` in plot pixels, or null when it is outside the visible window.
 *
 * The bounds test is the whole reason a chart can be handed thousands of
 * markers: everything off screen costs one comparison and no element.
 */
function markerX(time: number, viewport: ViewportState): number | null {
  const span = viewport.timeEnd - viewport.timeStart;
  if (span <= 0 || time < viewport.timeStart || time > viewport.timeEnd) return null;
  return ((time - viewport.timeStart) / span) * viewport.width;
}

function markerLineElements(
  markers: readonly GanttTimeMarker[] | undefined,
  viewport: ViewportState,
  theme: GanttTheme,
): GanttElement[] {
  if (!markers || markers.length === 0) return [];
  const out: GanttElement[] = [];

  for (const marker of markers) {
    const x = markerX(marker.time, viewport);
    if (x === null) continue;
    out.push({
      type: 'line',
      shape: { x1: x, y1: 0, x2: x, y2: viewport.height },
      style: {
        stroke: marker.color ?? theme.colors.markerLine,
        lineWidth: marker.lineWidth ?? MARKER_LINE_WIDTH,
        ...(marker.dashed ? { lineDash: [5, 4] } : null),
      },
      silent: true,
      z2: 1,
    });
  }
  return out;
}

/**
 * The chips that name the marker lines.
 *
 * Drawn in their own series *above* the bars, unlike the lines: a label under a
 * task bar is a label nobody can read, and the first row is exactly where the
 * chips sit.
 *
 * Placement is one left-to-right pass. A chip starts at its line and flips to
 * the other side when it would leave the plot; one that would still land on the
 * chip before it is dropped, since two overlapping labels are less use than one
 * label and a bare line. That makes the pass order-dependent, so markers are
 * sorted by time first — the caller's array order is theirs, not a drawing
 * instruction.
 */
function markerLabelElements(
  markers: readonly GanttTimeMarker[] | undefined,
  viewport: ViewportState,
  theme: GanttTheme,
): GanttElement[] {
  if (!markers || markers.length === 0) return [];

  const labelled: { marker: GanttTimeMarker; x: number }[] = [];
  for (const marker of markers) {
    if (!marker.label) continue;
    const x = markerX(marker.time, viewport);
    if (x !== null) labelled.push({ marker, x });
  }
  if (labelled.length === 0) return [];
  labelled.sort((a, b) => a.x - b.x);

  const fontSize = theme.font.labelSize;
  const out: GanttElement[] = [];
  let occupiedTo = -Infinity;

  for (const { marker, x } of labelled) {
    const text =
      marker.label!.length > MARKER_LABEL_MAX_CHARS
        ? `${marker.label!.slice(0, MARKER_LABEL_MAX_CHARS - 1)}…`
        : marker.label!;
    // Canvas metrics are not available here (the option is built without a
    // renderer, and is reused for export), so the chip is measured from the
    // font size. Only chip *placement* depends on it — the text itself is laid
    // out by zrender, so an imperfect estimate costs a little spacing, never a
    // clipped label.
    const width = text.length * fontSize * 0.62 + MARKER_LABEL_PADDING_X * 2;
    const overflowsRight = x + width > viewport.width;
    const left = overflowsRight ? x - width : x;
    if (left < occupiedTo) continue;
    occupiedTo = left + width + MARKER_LABEL_GAP;

    out.push({
      type: 'text',
      style: {
        text,
        // The padded box is what `x`/`y` anchor, so this is the chip's corner.
        x: left,
        y: MARKER_LABEL_TOP,
        fill: theme.colors.textInverse,
        font: fontShorthand(theme.font.weight, fontSize, theme.font.family),
        textAlign: 'left',
        textVerticalAlign: 'top',
        backgroundColor: marker.color ?? theme.colors.markerLine,
        padding: [MARKER_LABEL_PADDING_Y, MARKER_LABEL_PADDING_X],
        borderRadius: 3,
      },
      silent: true,
    });
  }
  return out;
}

function overlayElements<T, G>(engine: GanttEngine<T, G>, width: number, height: number): GanttElement[] {
  const renderers = engine.overlays.list();
  if (renderers.length === 0) return [];

  const context: OverlayContext<T, G> = {
    engine,
    timeToPx: (time) => engine.viewport.timeToPx(time),
    contentToPx: (y) => engine.viewport.contentToPx(y),
    width,
    height,
  };

  const out: GanttElement[] = [];
  for (const renderer of renderers) {
    const produced = renderer(context);
    if (produced) out.push(...(produced as GanttElement[]));
  }
  return out;
}

function interactionElements<T, G>(engine: GanttEngine<T, G>, theme: GanttTheme): GanttElement[] {
  const state = engine.store.getState();
  const out: GanttElement[] = [];

  const drag = state.drag;
  if (drag && drag.active) {
    // Where every dragged bar started, so the gesture reads as a move rather
    // than a teleport — a multi-task drag leaves the whole selection behind,
    // not just the bar under the pointer. `getTaskRect` reads unmodified data,
    // which is exactly the ghost position; the moved copies are drawn by the
    // item series.
    const viewport = engine.viewport.state;
    for (const taskId of drag.taskIds) {
      const origin = engine.getTaskRect(taskId);
      // A selection can reach far outside the frame (scrolled-away rows, bars
      // panned off the time window); their ghosts would paint nothing.
      if (!origin) continue;
      if (origin.x + origin.width < 0 || origin.x > viewport.width) continue;
      if (origin.y + origin.height < 0 || origin.y > viewport.height) continue;

      out.push({
        type: 'rect',
        shape: { ...origin, r: theme.metrics.itemRadius },
        style: {
          fill: theme.colors.dragGhost,
          stroke: theme.colors.dragPreviewStroke,
          lineWidth: 1,
          lineDash: [4, 3],
        },
        silent: true,
      });
    }
  }

  const marquee = state.marquee;
  if (marquee && marquee.width > 0 && marquee.height > 0) {
    out.push({
      type: 'rect',
      shape: { ...marquee },
      style: {
        fill: theme.colors.marqueeFill,
        stroke: theme.colors.marqueeStroke,
        lineWidth: 1,
        lineDash: [4, 3],
      },
      silent: true,
    });
  }

  return out;
}
