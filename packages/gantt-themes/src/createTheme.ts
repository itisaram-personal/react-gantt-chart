import type { GanttTheme } from '@gantt-chart/core';
import { darkTheme } from './dark';
import { lightTheme } from './light';

export interface ThemeOverrides {
  name?: string;
  dark?: boolean;
  colors?: Partial<GanttTheme['colors']>;
  metrics?: Partial<GanttTheme['metrics']>;
  font?: Partial<GanttTheme['font']>;
  palette?: readonly string[];
}

/**
 * Derive a theme from a base one.
 *
 * Sections merge one level deep, which is all the theme contract is: flat
 * records of colours, metrics and font fields.
 */
export function createTheme(base: GanttTheme, overrides: ThemeOverrides = {}): GanttTheme {
  return {
    name: overrides.name ?? `${base.name}-custom`,
    dark: overrides.dark ?? base.dark,
    colors: { ...base.colors, ...overrides.colors },
    metrics: { ...base.metrics, ...overrides.metrics },
    palette: overrides.palette ?? base.palette,
    font: { ...base.font, ...overrides.font },
  };
}

export const themes: Record<string, GanttTheme> = {
  light: lightTheme,
  dark: darkTheme,
};

export type ThemeName = keyof typeof themes & string;

/** Resolve a theme name or a theme object. Unknown names fall back to light. */
export function resolveTheme(theme: GanttTheme | ThemeName | string | undefined): GanttTheme {
  if (!theme) return lightTheme;
  if (typeof theme !== 'string') return theme;
  return themes[theme] ?? lightTheme;
}

/**
 * Theme as CSS custom properties, for the parts of the widget that are real DOM
 * (row gutter, header, menus) rather than canvas.
 */
export function themeCssVariables(theme: GanttTheme): Record<string, string> {
  const vars: Record<string, string> = {
    '--gantt-font-family': theme.font.family,
    '--gantt-font-size': `${theme.font.size}px`,
    '--gantt-label-size': `${theme.font.labelSize}px`,
    '--gantt-font-weight': String(theme.font.weight),
    '--gantt-axis-width': `${theme.metrics.axisWidth}px`,
    '--gantt-header-height': `${theme.metrics.headerHeight}px`,
    '--gantt-item-radius': `${theme.metrics.itemRadius}px`,
  };
  for (const [key, value] of Object.entries(theme.colors)) {
    vars[`--gantt-${kebab(key)}`] = value;
  }
  return vars;
}

function kebab(key: string): string {
  return key.replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`);
}
