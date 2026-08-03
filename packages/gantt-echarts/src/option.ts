import {
  computeRowBands,
  RenderContextBuilder,
  type GanttEngine,
  type GanttTheme,
  type OverlayContext,
} from '@gantt-chart/core';
import type { GanttElement } from './elements';
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
  /** Epoch ms for the "now" marker. `null` hides it. */
  now?: number | null;
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
const Z_OVERLAY = 3;
const Z_INTERACTION = 4;

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
          ...nowElements(input.now ?? null, viewport, theme),
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

function nowElements(
  now: number | null,
  viewport: { timeStart: number; timeEnd: number; width: number; height: number },
  theme: GanttTheme,
): GanttElement[] {
  if (now === null || now < viewport.timeStart || now > viewport.timeEnd) return [];
  const span = viewport.timeEnd - viewport.timeStart;
  if (span <= 0) return [];
  const x = ((now - viewport.timeStart) / span) * viewport.width;
  return [
    {
      type: 'line',
      shape: { x1: x, y1: 0, x2: x, y2: viewport.height },
      style: { stroke: theme.colors.todayLine, lineWidth: 1.5 },
      silent: true,
      z2: 1,
    },
  ];
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
    // Where the primary bar started, so the gesture reads as a move rather than
    // a teleport. `getTaskRect` reads unmodified data, which is exactly the
    // ghost position — the moved copy is drawn by the item series.
    const origin = engine.getTaskRect(drag.originTaskId);
    if (origin) {
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
