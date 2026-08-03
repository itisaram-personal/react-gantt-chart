/**
 * `@gantt-chart/themes` — the themes shipped with the library.
 *
 * The {@link GanttTheme} *contract* lives in `@gantt-chart/core` so the render
 * context can be typed without core depending on this package; concrete values
 * live here.
 */

export { lightTheme } from './light';
export { darkTheme } from './dark';
export { lightPalette, darkPalette } from './palette';
export { defaultMetrics, defaultFont } from './shared';
export { createTheme, resolveTheme, themes, themeCssVariables } from './createTheme';
export type { ThemeOverrides, ThemeName } from './createTheme';

export type { GanttTheme, GanttThemeColors, GanttThemeMetrics, GanttThemeFont } from '@gantt-chart/core';
