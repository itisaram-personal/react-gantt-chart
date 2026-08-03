# @gantt-chart/echarts

The ECharts renderer for the Gantt engine, plus the input handling that drives it.

```bash
npm install @gantt-chart/echarts @gantt-chart/core echarts
```

## The approach

One `custom` series with `coordinateSystem: 'none'`. The engine has already
resolved every bar to plot pixels, so ECharts is asked for exactly what it is good
at — batching, diffing and painting thousands of elements — and nothing else:

- **no axis, no `dataZoom`**, therefore no second owner of pan/zoom to disagree
  with the engine, and no feedback loop to debounce;
- **the canvas is the plot area**, so a client coordinate becomes a plot
  coordinate with one bounding-box subtraction;
- **input is handled on the container**, not through ECharts' event system,
  because the engine can already answer "what is under this pixel" in
  microseconds — which is what makes drag, resize and marquee feel native.

Four series are emitted, in paint order: `gantt-background` (row bands, grid
lines, the now marker), `gantt-items` (one datum per visible bar),
`gantt-overlay` (plugin layers) and `gantt-interaction` (marquee, drag ghost). The
last two only appear on frames that need them.

## Attaching to a chart

```ts
import * as echarts from 'echarts';
import { GanttEChartsAdapter } from '@gantt-chart/echarts';
import { lightTheme } from '@gantt-chart/themes';

const chart = echarts.init(container, null, { renderer: 'canvas' });
const adapter = new GanttEChartsAdapter(engine, { theme: lightTheme });
adapter.attach(chart, container);

// on container resize
adapter.resize(width, height);

// teardown
adapter.dispose();
```

Or `createGanttChart({ engine, container, echarts, theme })`, which does the same
three steps. The `echarts` module is injected rather than imported, so this
package stays importable — and unit-testable — without it.

Renders are coalesced into an animation frame and driven by store subscriptions;
`resize` renders synchronously, where a frame of lag would be visible.

## Input

| gesture | result |
| --- | --- |
| click a bar | select (press selects, so the same gesture can drag) |
| ctrl / shift click | toggle, or range over visual order |
| drag a bar | move the selection; free x/y within one row, x-only across rows |
| drag a bar edge | resize that bar |
| drag empty space | marquee select (ctrl adds, alt removes) |
| middle-drag | pan |
| wheel | scroll · ctrl zooms at the pointer · shift pans (all remappable) |
| right-click | open the context menu on task, row or background |
| keys | arrows, page/home/end, `+`/`-`, ctrl+A, Escape |

Wheel behaviour comes from `engine.getOptions().interaction.wheel`, so an app can
remap it without touching the adapter.

## Renderers

`defaultItemRenderer` draws rounded bars, diamond milestones, an optional progress
fill from `task.data.progress`, and a label clipped to the *visible* part of the
bar — so a bar scrolled half off-screen keeps its text next to the visible edge.

Replace it to draw anything:

```ts
const adapter = new GanttEChartsAdapter(engine, {
  theme,
  itemRenderer: ({ geometry, state, theme, task }) => ({
    type: 'rect',
    shape: { ...geometry, r: 2 },
    style: { fill: state.selected ? theme.colors.accent : theme.colors.taskFill },
  }),
});
```

Returning `null` skips a bar.

## Time scale

`computeTimeTicks`, `computeTimeBands` and `computeTimeHeader` are pure functions
of `(timeStart, timeEnd, width)` that walk the *calendar* rather than adding fixed
milliseconds — day boundaries stay at local midnight across a DST change, and
month bands keep their real lengths. Both the canvas grid and the React header use
them, which is why grid lines and labels cannot drift apart.

## Dependency arrows

```ts
import { dependenciesPlugin } from '@gantt-chart/echarts';

const links = dependenciesPlugin({ theme, dependencies: [{ from: 't1', to: 't2' }] });
engine.use(links);
links.setDependencies(next); // re-indexed, redrawn on the next frame
```

Supports `finish-start` (default), `start-start`, `finish-finish` and
`start-finish`. Links are indexed by task when the list is set, and only links
touching a visible bar are considered, so per-frame cost tracks the viewport
rather than the size of the graph. `maxLinks` caps a frame — a screen with 5 000
arrows conveys nothing and would cost more than the bars.
