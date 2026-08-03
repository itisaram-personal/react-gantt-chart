# @gantt-chart/themes

Light and dark themes for the Gantt chart.

The `GanttTheme` *contract* lives in `@gantt-chart/core`, so the render context can
be strongly typed without core depending on this package. Concrete values live
here.

```bash
npm install @gantt-chart/themes
```

```ts
import { createTheme, darkTheme, lightTheme, resolveTheme, themeCssVariables } from '@gantt-chart/themes';

const brand = createTheme(lightTheme, {
  name: 'brand',
  colors: { taskFill: '#5b21b6', accent: '#5b21b6' },
  metrics: { axisWidth: 320 },
  palette: ['#5b21b6', '#0e7490', '#b45309'],
});
```

`createTheme` merges one level into each section and never mutates the base.
`resolveTheme('dark' | 'light' | theme)` accepts either a name or an object, which
is what the React package's `theme` prop takes.

## What a theme covers

- **colors** — backgrounds and alternating row bands, grid lines, text, bars,
  milestones, selection, hover, drag ghost, marquee, today line, dependency lines,
  scrollbar.
- **metrics** — corner radius, stroke widths, the row gutter width, header height,
  resize handle width, milestone size.
- **palette** — categorical colours. `categorical(theme, key)` from core picks a
  stable one per key, which is how bars get a per-group colour by default.
- **font** — family, base and label sizes, weight.

Both shipped palettes are tuned per background: the dark palette is lighter and
slightly less saturated so bars keep their separation against a dark row.

## CSS custom properties

The row gutter, header, tooltip and menus are real DOM, and take their colours
from custom properties rather than inline styles — a theme switch repaints them
without React re-rendering:

```ts
themeCssVariables(darkTheme);
// { '--gantt-background': '#0f1420', '--gantt-row-odd': '#141a28',
//   '--gantt-grid-line-strong': '#2a3348', '--gantt-axis-width': '240px', … }
```

`GanttChart` applies these to its root element for you.
