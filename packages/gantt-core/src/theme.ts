/**
 * Theme contract.
 *
 * The type lives in core so the render context can be strongly typed without
 * core depending on a theme package; concrete themes ship in
 * `@gantt-chart/themes`.
 */
export interface GanttTheme {
  name: string;
  dark: boolean;
  colors: GanttThemeColors;
  metrics: GanttThemeMetrics;
  /** Categorical colours for `theme.categorical(key)`. */
  palette: readonly string[];
  font: GanttThemeFont;
}

export interface GanttThemeColors {
  background: string;
  /** Alternating row background. */
  rowEven: string;
  rowOdd: string;
  rowHover: string;
  rowSelected: string;
  border: string;
  gridLine: string;
  gridLineStrong: string;
  text: string;
  textMuted: string;
  textInverse: string;
  accent: string;
  taskFill: string;
  taskStroke: string;
  taskText: string;
  milestoneFill: string;
  selectionFill: string;
  selectionStroke: string;
  hoverStroke: string;
  dragGhost: string;
  dragPreviewStroke: string;
  marqueeFill: string;
  marqueeStroke: string;
  /**
   * Conventional colour for a *today* {@link GanttTimeMarker}, which the chart
   * no longer draws on its own — pass one and colour it with this to get the
   * familiar red line.
   */
  todayLine: string;
  /** Default colour for every other {@link GanttTimeMarker}; each may override it. */
  markerLine: string;
  dependencyLine: string;
  scrollbarThumb: string;
  scrollbarTrack: string;
}

export interface GanttThemeMetrics {
  itemRadius: number;
  itemStrokeWidth: number;
  selectedStrokeWidth: number;
  axisWidth: number;
  headerHeight: number;
  resizeHandleWidth: number;
  milestoneSize: number;
}

export interface GanttThemeFont {
  family: string;
  size: number;
  labelSize: number;
  weight: number | string;
}

/** Stable colour pick from the palette for any key. */
export function categorical(theme: GanttTheme, key: string | number): string {
  const palette = theme.palette;
  if (palette.length === 0) return theme.colors.taskFill;
  const text = String(key);
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return palette[Math.abs(hash) % palette.length];
}
