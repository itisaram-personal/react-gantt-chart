import { describe, expect, it } from 'vitest';
import { categorical, type GanttTheme } from '@gantt-chart/core';
import {
  createTheme,
  darkTheme,
  lightTheme,
  resolveTheme,
  themeCssVariables,
  themes,
} from '../src/index';

const shipped: GanttTheme[] = [lightTheme, darkTheme];

describe('shipped themes', () => {
  it('define every colour the contract requires', () => {
    // The contract is structural, so a missing key would only surface at runtime
    // as `undefined` reaching a canvas fill.
    const keys = Object.keys(lightTheme.colors) as (keyof GanttTheme['colors'])[];
    expect(keys.length).toBeGreaterThan(20);
    for (const theme of shipped) {
      for (const key of keys) {
        expect(typeof theme.colors[key], `${theme.name}.${key}`).toBe('string');
        expect(theme.colors[key], `${theme.name}.${key}`).not.toBe('');
      }
    }
  });

  it('uses parseable colour values', () => {
    const valid = /^(#[0-9a-f]{3,8}|rgba?\([^)]+\))$/i;
    for (const theme of shipped) {
      for (const [key, value] of Object.entries(theme.colors)) {
        expect(valid.test(value), `${theme.name}.${key} = ${value}`).toBe(true);
      }
      for (const value of theme.palette) {
        expect(valid.test(value), `${theme.name}.palette ${value}`).toBe(true);
      }
    }
  });

  it('flags dark themes so renderers can pick label colours', () => {
    expect(lightTheme.dark).toBe(false);
    expect(darkTheme.dark).toBe(true);
  });

  it('ships positive metrics and a font stack', () => {
    for (const theme of shipped) {
      for (const [key, value] of Object.entries(theme.metrics)) {
        expect(value, `${theme.name}.${key}`).toBeGreaterThan(0);
      }
      expect(theme.font.family).toContain('sans-serif');
      expect(theme.font.size).toBeGreaterThan(0);
    }
  });

  it('registers both themes for lookup by name', () => {
    expect(themes.light).toBe(lightTheme);
    expect(themes.dark).toBe(darkTheme);
    expect(resolveTheme('dark')).toBe(darkTheme);
    expect(resolveTheme(darkTheme)).toBe(darkTheme);
    // An unknown name is a typo, not a reason to render nothing.
    expect(resolveTheme('solarized')).toBe(lightTheme);
    expect(resolveTheme(undefined)).toBe(lightTheme);
  });
});

describe('createTheme', () => {
  it('merges sections one level deep and leaves the base untouched', () => {
    const custom = createTheme(lightTheme, {
      name: 'brand',
      colors: { taskFill: '#123456' },
      metrics: { axisWidth: 320 },
      font: { size: 14 },
    });

    expect(custom.name).toBe('brand');
    expect(custom.colors.taskFill).toBe('#123456');
    // Untouched keys still come from the base.
    expect(custom.colors.background).toBe(lightTheme.colors.background);
    expect(custom.metrics.axisWidth).toBe(320);
    expect(custom.metrics.itemRadius).toBe(lightTheme.metrics.itemRadius);
    expect(custom.font.size).toBe(14);
    expect(custom.font.family).toBe(lightTheme.font.family);

    expect(lightTheme.colors.taskFill).not.toBe('#123456');
    expect(lightTheme.metrics.axisWidth).not.toBe(320);
  });

  it('inherits the base dark flag unless overridden', () => {
    expect(createTheme(darkTheme, {}).dark).toBe(true);
    expect(createTheme(darkTheme, { dark: false }).dark).toBe(false);
  });

  it('accepts a replacement palette', () => {
    const custom = createTheme(lightTheme, { palette: ['#000000', '#ffffff'] });
    expect(custom.palette).toEqual(['#000000', '#ffffff']);
    expect(['#000000', '#ffffff']).toContain(categorical(custom, 'task-a'));
  });
});

describe('categorical picks against the shipped palettes', () => {
  it('is stable per key and spreads across the palette', () => {
    for (const theme of shipped) {
      expect(categorical(theme, 'alpha')).toBe(categorical(theme, 'alpha'));

      const used = new Set<string>();
      for (let i = 0; i < 200; i++) used.add(categorical(theme, `key-${i}`));
      // Not a distribution test — just proof the hash is not collapsing.
      expect(used.size).toBeGreaterThan(theme.palette.length / 2);
      for (const colour of used) expect(theme.palette).toContain(colour);
    }
  });
});

describe('themeCssVariables', () => {
  it('exposes every colour plus layout metrics as custom properties', () => {
    const vars = themeCssVariables(darkTheme);
    expect(vars['--gantt-background']).toBe(darkTheme.colors.background);
    expect(vars['--gantt-row-odd']).toBe(darkTheme.colors.rowOdd);
    expect(vars['--gantt-grid-line-strong']).toBe(darkTheme.colors.gridLineStrong);
    expect(vars['--gantt-axis-width']).toBe(`${darkTheme.metrics.axisWidth}px`);
    expect(vars['--gantt-font-family']).toBe(darkTheme.font.family);

    for (const name of Object.keys(vars)) expect(name.startsWith('--gantt-')).toBe(true);
    expect(Object.keys(vars).length).toBe(Object.keys(darkTheme.colors).length + 7);
  });
});
