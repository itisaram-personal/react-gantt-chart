import type { GanttEngine } from '@gantt-chart/core';
import { GanttEChartsAdapter, type EChartsLike, type GanttAdapterOptions } from './adapter';

/** The one function this package needs from the `echarts` module. */
export interface EChartsModuleLike {
  init(
    dom: HTMLElement | null,
    theme?: string | object | null,
    opts?: Record<string, unknown>,
  ): EChartsLike;
}

export interface CreateGanttChartInput<T = unknown, G = unknown> extends GanttAdapterOptions<T, G> {
  engine: GanttEngine<T, G>;
  container: HTMLElement;
  /** The `echarts` module — injected so this package need not import it. */
  echarts: EChartsModuleLike;
  renderer?: 'canvas' | 'svg';
  /** Defaults to the container's current size. */
  width?: number;
  height?: number;
  devicePixelRatio?: number;
}

/**
 * Initialise a chart on a container and attach an adapter to it.
 *
 * A convenience for plain-DOM consumers; the React package does the same three
 * steps inside an effect.
 */
export function createGanttChart<T, G>(input: CreateGanttChartInput<T, G>): {
  chart: EChartsLike;
  adapter: GanttEChartsAdapter<T, G>;
  dispose(): void;
} {
  const { engine, container, echarts, renderer = 'canvas', width, height, devicePixelRatio, ...rest } = input;

  const chart = echarts.init(container, null, {
    renderer,
    width: width ?? container.clientWidth ?? undefined,
    height: height ?? container.clientHeight ?? undefined,
    ...(devicePixelRatio ? { devicePixelRatio } : null),
  });

  const adapter = new GanttEChartsAdapter<T, G>(engine, rest);
  adapter.attach(chart, container);

  return {
    chart,
    adapter,
    dispose(): void {
      adapter.dispose();
      chart.dispose?.();
    },
  };
}
