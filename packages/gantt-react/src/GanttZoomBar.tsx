import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { LineChart } from 'echarts/charts';
import { DataZoomSliderComponent, GridComponent } from 'echarts/components';
import { init, use } from 'echarts/core';
import { CanvasRenderer, SVGRenderer } from 'echarts/renderers';
import { shallowEqual, type GanttEngine, type GanttTheme } from '@gantt-chart/core';
import {
  buildRowZoomOption,
  buildTimeZoomOption,
  rowZoomLaneHeight,
  rowZoomScrollTop,
  rowZoomWindow,
  taskDensity,
  timeZoomRange,
  timeZoomWindow,
  type GanttZoomOption,
  type GanttZoomWindow,
} from '@gantt-chart/echarts';
import { useEngineState } from './useEngineState';
import { useElementSize } from './useResizeObserver';

/**
 * Zoom bars for both axes, each an ECharts `dataZoom` slider.
 *
 * A slider lives on its own chart rather than on the plot: the plot's series is
 * `coordinateSystem: 'none'` and has no axis for a dataZoom to bind to, and a
 * slider sharing the plot's canvas would lay ECharts' pointer handling over the
 * plot's own drag, marquee and wheel gestures.
 *
 * The engine is still the only thing that moves the camera, and the sliders are
 * wired so it stays that way — see {@link ZoomSlider}. The mapping between a
 * slider window and the viewport lives in `@gantt-chart/echarts`, in pure
 * functions; what is left here is the chart's lifecycle and the two directions
 * of the sync.
 */

/*
 * The slider and the axis it needs, and nothing else ECharts has to offer.
 *
 * Registered at module scope, as the plot's own series is: it therefore costs an
 * app the slider, grid and line components whether or not it turns a zoom bar on.
 * Deferring it would mean a dynamic import — the registration has to happen
 * before the first `setOption`, and importing inside an effect still bundles the
 * modules — which is not worth an async hole in the first frame.
 */
use([LineChart, DataZoomSliderComponent, GridComponent, CanvasRenderer, SVGRenderer]);

/** The bits of an ECharts instance a slider chart is driven through. */
interface ZoomChart {
  setOption(option: unknown, opts?: unknown): void;
  getOption(): { dataZoom?: { start?: number; end?: number }[] } | undefined;
  on(event: string, handler: (params: unknown) => void): void;
  resize(opts?: unknown): void;
  dispose(): void;
}

/**
 * Window differences under this many percent are not written to the slider.
 *
 * The window the engine settled on and the one the slider already shows are
 * normally the same number arrived at from two directions, so without a
 * tolerance every viewport change would `setOption` for nothing.
 */
const WINDOW_EPSILON = 0.01;

interface ZoomSliderProps {
  /** Everything but the window: axes, styling, and the overview series. */
  option: GanttZoomOption;
  /** The window the engine is actually showing, written back when it drifts. */
  window: GanttZoomWindow;
  /** The slider moved. The engine still has the last word on what that means. */
  onWindow: (window: GanttZoomWindow) => void;
  renderer: 'canvas' | 'svg';
  className: string;
  style: CSSProperties;
  label: string;
}

/**
 * One slider-only chart, kept in sync with the engine in both directions.
 *
 * Slider → engine: every `datazoom` event is handed to `onWindow`, which maps it
 * onto the viewport. The engine clamps as it sees fit, so what comes out is not
 * always what went in.
 *
 * Engine → slider: whenever the engine's window differs from the one on screen,
 * it is written back with `setOption` — which, unlike `dispatchAction`, fires no
 * `datazoom` event and so cannot feed its own output back in.
 *
 * That write-back is suspended while the slider is being dragged. It is the only
 * moment the two can legitimately disagree — the engine has clamped, but the
 * pointer is still holding a handle out past the limit — and correcting it
 * mid-gesture would mean pulling the handle out from under the pointer on every
 * frame. The gesture ends, and the engine's answer is put back on screen.
 */
function ZoomSlider({
  option,
  window: engineWindow,
  onWindow,
  renderer,
  className,
  style,
  label,
}: ZoomSliderProps): JSX.Element {
  const [containerRef, size] = useElementSize<HTMLDivElement>();
  const chartRef = useRef<ZoomChart | null>(null);
  /** The window last known to be on screen, so redundant writes are skipped. */
  const shown = useRef<GanttZoomWindow | null>(null);
  const dragging = useRef(false);

  // Read by handlers that outlive the render that created them.
  const latest = useRef({ onWindow, window: engineWindow });
  latest.current = { onWindow, window: engineWindow };

  const write = useRef<(next: GanttZoomWindow) => void>(() => {});
  write.current = (next: GanttZoomWindow): void => {
    const chart = chartRef.current;
    if (!chart) return;
    const current = shown.current;
    if (
      current &&
      Math.abs(current.start - next.start) < WINDOW_EPSILON &&
      Math.abs(current.end - next.end) < WINDOW_EPSILON
    ) {
      return;
    }
    shown.current = next;
    chart.setOption({ dataZoom: [{ start: next.start, end: next.end }] });
  };

  useLayoutEffect(() => {
    const element = containerRef.current;
    if (!element) return;

    const chart = init(element, null, {
      renderer,
      width: element.clientWidth || 1,
      height: element.clientHeight || 1,
    }) as unknown as ZoomChart;

    chart.on('datazoom', (params) => {
      const next = eventWindow(params, chart);
      if (!next) return;
      shown.current = next;
      latest.current.onWindow(next);
    });

    chartRef.current = chart;
    return () => {
      chart.dispose();
      chartRef.current = null;
      shown.current = null;
    };
    // `renderer` is structural: changing it rebuilds the chart.
  }, [renderer, containerRef]);

  // Ordered after the effect above so the first option reaches a live chart.
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    chart.setOption(option);
    shown.current = { start: option.dataZoom[0].start, end: option.dataZoom[0].end };
    // The option carries the window it was built with, which may already be
    // stale; the effect below re-asserts the live one.
  }, [option]);

  useEffect(() => {
    if (!dragging.current) write.current(engineWindow);
  }, [option, engineWindow.start, engineWindow.end]);

  useEffect(() => {
    if (size.width > 0 && size.height > 0) {
      chartRef.current?.resize({ width: size.width, height: size.height });
    }
  }, [size.width, size.height]);

  /*
   * Brackets the drag for the write-back above. `pointerup` is watched on the
   * document rather than here, because a drag very often ends with the pointer
   * outside the strip it started in — which also means the listener can outlive
   * the gesture, so `endGesture` is held for unmount to call.
   */
  const endGesture = useRef<(() => void) | null>(null);
  useEffect(() => () => endGesture.current?.(), []);

  const beginGesture = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (dragging.current) return;
    dragging.current = true;

    const target = event.currentTarget.ownerDocument ?? document;
    const end = (): void => {
      dragging.current = false;
      endGesture.current = null;
      target.removeEventListener('pointerup', end);
      target.removeEventListener('pointercancel', end);
      // Whatever the engine made of the gesture is what should be on screen.
      write.current(latest.current.window);
    };

    endGesture.current = end;
    target.addEventListener('pointerup', end);
    target.addEventListener('pointercancel', end);
  };

  return (
    <div
      ref={containerRef}
      className={className}
      style={style}
      role="group"
      aria-label={label}
      onPointerDown={beginGesture}
    />
  );
}

/**
 * The window a `datazoom` event reports.
 *
 * The slider sends its own `start`/`end` percentages, so normally the payload is
 * the whole answer. The fallback covers the payload shapes it does not
 * necessarily control: a batched event when several dataZooms move together, and
 * one carrying values rather than percentages.
 */
function eventWindow(params: unknown, chart: ZoomChart): GanttZoomWindow | null {
  type Reported = { start?: number; end?: number };
  const payload = params as (Reported & { batch?: Reported[] }) | null;
  const source = payload?.batch?.[0] ?? payload;
  if (typeof source?.start === 'number' && typeof source?.end === 'number') {
    return { start: source.start, end: source.end };
  }

  const settled = chart.getOption()?.dataZoom?.[0];
  if (typeof settled?.start === 'number' && typeof settled?.end === 'number') {
    return { start: settled.start, end: settled.end };
  }
  return null;
}

/* ------------------------------------------------------------------ x axis */

export interface GanttTimeZoomBarProps<T, G> {
  engine: GanttEngine<T, G>;
  theme: GanttTheme;
  /** Bar height in px. */
  height?: number;
  /** Draw a task-density overview behind the window. */
  overview?: boolean;
  renderer?: 'canvas' | 'svg';
}

/**
 * Horizontal `dataZoom` slider over the whole time domain.
 *
 * The window is the visible time range, so dragging its body pans and dragging a
 * handle zooms. `setTimeRange` already clamps to the domain and to
 * `min`/`maxTimeSpan`, so nothing here needs to re-check those bounds.
 */
export function GanttTimeZoomBar<T, G>({
  engine,
  theme,
  height = 32,
  overview = true,
  renderer = 'canvas',
}: GanttTimeZoomBarProps<T, G>): JSX.Element | null {
  const { viewport, dataRevision } = useEngineState(
    engine,
    (state) => ({ viewport: state.viewport, dataRevision: state.dataRevision }),
    shallowEqual,
  );

  const [domainStart, domainEnd] = engine.getDomain();

  const density = useMemo(
    () => (overview ? taskDensity(engine) : null),
    // Recomputed only when the dataset itself changes, not on pan or zoom.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [engine, overview, dataRevision],
  );

  const window = timeZoomWindow([domainStart, domainEnd], viewport);

  const option = useMemo(
    () => buildTimeZoomOption({ domain: [domainStart, domainEnd], window, theme, density }),
    // Structure only: the live window is synced separately, so rebuilding the
    // option on every pan would be pure waste.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [domainStart, domainEnd, theme, density],
  );

  if (domainEnd - domainStart <= 0) return null;

  return (
    <ZoomSlider
      option={option}
      window={window}
      onWindow={(next) => {
        const range = timeZoomRange([domainStart, domainEnd], next);
        engine.viewport.setTimeRange(range.start, range.end);
      }}
      renderer={renderer}
      className="gantt-zoom gantt-zoom--horizontal"
      style={{ height, borderTopColor: theme.colors.border }}
      label="Time range"
    />
  );
}

/* ------------------------------------------------------------------ y axis */

export interface GanttRowZoomBarProps<T, G> {
  engine: GanttEngine<T, G>;
  theme: GanttTheme;
  /** Bar width in px. */
  width?: number;
  minLaneHeight?: number;
  maxLaneHeight?: number;
  renderer?: 'canvas' | 'svg';
}

/**
 * Vertical `dataZoom` slider over the rows.
 *
 * Dragging a handle is a genuine vertical zoom: the window says how much content
 * should be on screen, and `metrics.laneHeight` is rescaled so that exactly that
 * much fills the plot — so rows get taller as the window narrows. Drawing a band
 * anywhere on the track is the same move in one gesture, landing on a stretch of
 * rows however far from the current window it starts; the strip along the edge
 * of the track drags the window as it is, which scrolls.
 *
 * The window is a *fraction* of total content height rather than a pixel offset.
 * Rescaling lane heights changes `totalHeight`, so a pixel anchor would slide out
 * from under the drag; a fraction is very nearly invariant under the rescale,
 * which keeps the grabbed edge under the pointer. `rowZoomLaneHeight` is the
 * whole of that maths.
 */
export function GanttRowZoomBar<T, G>({
  engine,
  theme,
  width = 24,
  minLaneHeight = 6,
  maxLaneHeight = 120,
  renderer = 'canvas',
}: GanttRowZoomBarProps<T, G>): JSX.Element | null {
  const { viewport } = useEngineState(
    engine,
    (state) => ({ viewport: state.viewport, layoutRevision: state.layoutRevision }),
    shallowEqual,
  );

  const totalHeight = engine.totalHeight;
  const window = rowZoomWindow({
    scrollTop: viewport.scrollTop,
    height: viewport.height,
    totalHeight,
  });

  const option = useMemo(
    () => buildRowZoomOption({ window, theme }),
    // As on the time bar: structure only, and here that is only the styling —
    // the axis is in fractions, so neither scrolling nor rescaling touches it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [theme],
  );

  if (totalHeight <= 0 || viewport.height <= 0) return null;

  return (
    <ZoomSlider
      option={option}
      window={window}
      onWindow={(next) => {
        const laneHeight = rowZoomLaneHeight({
          window: next,
          height: viewport.height,
          laneHeight: engine.getOptions().metrics.laneHeight,
          totalHeight,
          minLaneHeight,
          maxLaneHeight,
        });
        if (laneHeight !== null) engine.setOptions({ metrics: { laneHeight } });
        // Re-read: a rescale above moved every row.
        engine.viewport.scrollTo(rowZoomScrollTop(next, engine.totalHeight));
      }}
      renderer={renderer}
      className="gantt-zoom gantt-zoom--vertical"
      style={{ width, borderLeftColor: theme.colors.border }}
      label="Row range"
    />
  );
}
