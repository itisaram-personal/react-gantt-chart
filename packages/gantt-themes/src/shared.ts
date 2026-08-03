import type { GanttThemeFont, GanttThemeMetrics } from '@gantt-chart/core';

/** Metrics shared by the shipped themes; override per theme as needed. */
export const defaultMetrics: GanttThemeMetrics = {
  itemRadius: 3,
  itemStrokeWidth: 1,
  selectedStrokeWidth: 2,
  /** Width of the row/label gutter to the left of the plot area. */
  axisWidth: 240,
  /** Height of the two-tier time header. */
  headerHeight: 52,
  resizeHandleWidth: 6,
  milestoneSize: 12,
};

export const defaultFont: GanttThemeFont = {
  family:
    'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  size: 12,
  labelSize: 11,
  weight: 500,
};
