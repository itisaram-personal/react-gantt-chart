import { useEffect, useLayoutEffect, useRef } from 'react';
import { CustomChart } from 'echarts/charts';
import { init, use } from 'echarts/core';
import { CanvasRenderer, SVGRenderer } from 'echarts/renderers';
import type { GanttEngine, GanttTheme } from '@gantt-chart/core';
import {
  GanttEChartsAdapter,
  type EChartsLike,
  type GanttItemRenderer,
} from '@gantt-chart/echarts';
import { useElementSize } from './useResizeObserver';

// Only the custom series and the two renderers — the rest of ECharts is never
// pulled into the bundle.
use([CustomChart, CanvasRenderer, SVGRenderer]);

export interface GanttPlotProps<T, G> {
  engine: GanttEngine<T, G>;
  theme: GanttTheme;
  itemRenderer?: GanttItemRenderer<T, G>;
  /** `null` hides the marker; `undefined` follows the clock. */
  now?: number | null;
  locale?: string;
  weekStartsOn?: 0 | 1;
  renderer?: 'canvas' | 'svg';
  showGrid?: boolean;
  showRowBands?: boolean;
  /** Receives the adapter once attached, and `null` on teardown. */
  onAdapter?: (adapter: GanttEChartsAdapter<T, G> | null) => void;
  tabIndex?: number;
  ariaLabel?: string;
}

/**
 * The plot area: an ECharts canvas driven by the adapter.
 *
 * This element *is* the plot area — no axis gutter, no header — which is what
 * lets the adapter treat client coordinates as plot pixels with a single
 * bounding-box subtraction.
 */
export function GanttPlot<T, G>(props: GanttPlotProps<T, G>): JSX.Element {
  const { engine, theme, renderer = 'canvas' } = props;
  const [containerRef, size] = useElementSize<HTMLDivElement>();
  const adapterRef = useRef<GanttEChartsAdapter<T, G> | null>(null);
  const chartRef = useRef<EChartsLike | null>(null);

  // Latest render-affecting props, read by the effects below without
  // re-creating the chart.
  const latest = useRef(props);
  latest.current = props;

  useLayoutEffect(() => {
    const element = containerRef.current;
    if (!element) return;

    const chart = init(element, null, {
      renderer,
      width: element.clientWidth || 1,
      height: element.clientHeight || 1,
    }) as unknown as EChartsLike;

    const adapter = new GanttEChartsAdapter<T, G>(engine, {
      theme: latest.current.theme,
      itemRenderer: latest.current.itemRenderer,
      now: () => (latest.current.now === undefined ? Date.now() : latest.current.now),
      locale: latest.current.locale,
      weekStartsOn: latest.current.weekStartsOn,
      showGrid: latest.current.showGrid,
      showRowBands: latest.current.showRowBands,
    });
    adapter.attach(chart, element);

    chartRef.current = chart;
    adapterRef.current = adapter;
    latest.current.onAdapter?.(adapter);

    return () => {
      latest.current.onAdapter?.(null);
      adapter.dispose();
      (chart as { dispose?: () => void }).dispose?.();
      adapterRef.current = null;
      chartRef.current = null;
    };
    // `renderer` and `engine` are structural: changing either rebuilds the chart.
  }, [engine, renderer, containerRef]);

  useEffect(() => {
    if (size.width > 0 && size.height > 0) adapterRef.current?.resize(size.width, size.height);
  }, [size.width, size.height]);

  useEffect(() => {
    adapterRef.current?.setOptions({
      theme: props.theme,
      itemRenderer: props.itemRenderer,
      now: () => (latest.current.now === undefined ? Date.now() : latest.current.now),
      locale: props.locale,
      weekStartsOn: props.weekStartsOn,
      showGrid: props.showGrid,
      showRowBands: props.showRowBands,
    });
  }, [props.theme, props.itemRenderer, props.now, props.locale, props.weekStartsOn, props.showGrid, props.showRowBands]);

  return (
    <div
      ref={containerRef}
      className="gantt-plot"
      style={{ background: theme.colors.background }}
      tabIndex={props.tabIndex ?? 0}
      role="application"
      aria-label={props.ariaLabel ?? 'Gantt chart'}
    />
  );
}
