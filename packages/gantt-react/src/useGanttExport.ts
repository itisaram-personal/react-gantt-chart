import { useMemo, useRef } from "react";
import { CustomChart } from "echarts/charts";
import { init, use } from "echarts/core";
import { CanvasRenderer } from "echarts/renderers";
import type { GanttEngine, GanttTheme } from "@gantt-chart/core";
import {
  downloadGanttPng,
  ganttToPngBlob,
  ganttToPngDataURL,
  renderGanttToCanvas,
  type EChartsModuleLike,
  type GanttExportOptions,
  type GanttExportResult,
  type GanttItemRenderer,
} from "@gantt-chart/echarts";

// An export renders its own throw-away chart, so it needs the series and the
// canvas renderer registered even in an app that only ever mounted an SVG plot.
use([CustomChart, CanvasRenderer]);

/**
 * The one call the exporter needs from ECharts.
 *
 * Cast at this single boundary, like the plot does: `@gantt-chart/echarts`
 * describes the instance structurally rather than importing ECharts' types.
 */
const echartsModule = { init } as unknown as EChartsModuleLike;

export interface UseGanttExportInput<T = unknown, G = unknown> {
  engine: GanttEngine<T, G>;
  theme: GanttTheme;
  itemRenderer?: GanttItemRenderer<T, G>;
  locale?: string;
  weekStartsOn?: 0 | 1;
  /** Epoch ms for the "now" marker. `null` hides it; omit for the clock. */
  now?: number | null;
  /** Applied to every call, and overridable per call. */
  defaults?: GanttExportOptions;
}

export interface GanttDownloadOptions extends GanttExportOptions {
  /** Defaults to `gantt.png`. */
  filename?: string;
}

/**
 * PNG export, bound to one chart.
 *
 * Every method renders on the spot from current engine state; nothing is
 * retained between calls.
 */
export interface GanttExportApi {
  /** The image, plus what actually went into it (size, ratio, bars, rows). */
  toCanvas(options?: GanttExportOptions): GanttExportResult;
  toDataURL(options?: GanttExportOptions): string;
  toBlob(options?: GanttExportOptions): Promise<Blob>;
  /** Save it as a file. */
  download(options?: GanttDownloadOptions): Promise<void>;
}

/**
 * A PNG exporter for an engine.
 *
 * The returned object is stable for the life of the component — safe to hand to
 * a memoized toolbar — and reads the latest theme, renderer and locale through a
 * ref, so an export always matches what is currently on screen rather than what
 * was on screen when the hook first ran.
 */
export function useGanttExport<T = unknown, G = unknown>(
  input: UseGanttExportInput<T, G>,
): GanttExportApi {
  const latest = useRef(input);
  latest.current = input;

  return useMemo<GanttExportApi>(() => {
    const build = (options?: GanttExportOptions) => {
      const current = latest.current;
      return {
        engine: current.engine,
        theme: current.theme,
        echarts: echartsModule,
        itemRenderer: current.itemRenderer,
        locale: current.locale,
        weekStartsOn: current.weekStartsOn,
        now: current.now,
        ...current.defaults,
        ...options,
      };
    };

    return {
      toCanvas: (options) => renderGanttToCanvas(build(options)),
      toDataURL: (options) => ganttToPngDataURL(build(options)),
      toBlob: (options) => ganttToPngBlob(build(options)),
      download: (options) => downloadGanttPng({ ...build(options), filename: options?.filename }),
    };
  }, []);
}
