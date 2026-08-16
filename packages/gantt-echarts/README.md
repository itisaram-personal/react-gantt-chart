# @gantt-chart/echarts

The ECharts renderer for the Gantt engine, plus the input handling that drives it.

```bash
npm install @gantt-chart/echarts
```

## The approach

One `custom` series with `coordinateSystem: 'none'`. The engine has already
resolved every bar to plot pixels, so ECharts is asked for exactly what it is good
at — batching, diffing and painting thousands of elements — and nothing else:

- **no axis, no `dataZoom` on the plot**, therefore no second owner of pan/zoom to
  disagree with the engine, and no feedback loop to debounce;
- **the canvas is the plot area**, so a client coordinate becomes a plot
  coordinate with one bounding-box subtraction;
- **input is handled on the container**, not through ECharts' event system,
  because the engine can already answer "what is under this pixel" in
  microseconds — which is what makes drag, resize and marquee feel native.

Five series are emitted, in paint order: `gantt-background` (row bands, grid
lines, marker lines), `gantt-items` (one datum per visible bar),
`gantt-marker-labels` (the chips naming the markers, above the bars where they
can be read), `gantt-overlay` (plugin layers) and `gantt-interaction` (marquee,
drag ghost). All but the first two only appear on frames that need them.

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
| click a bar | select it (on release for an unselected bar, on press for one already selected, so the same gesture can drag it) |
| ctrl / shift click | toggle, or range over visual order |
| drag a **selected** bar | move the selection; free x/y within one row, x-only across rows |
| drag an unselected bar | the background gesture — a plain drag pans, ctrl/shift rubber-bands |
| drag a bar edge | resize that bar, selected or not |
| ctrl / shift drag | marquee select from anywhere, bars included — ctrl adds to the selection |
| drag empty space | marquee select (ctrl adds, alt removes) |
| middle-drag | pan |
| wheel | scroll · ctrl zooms at the pointer · shift pans (all remappable) |
| right-click | open the context menu on task, row or background |
| keys | arrows, page/home/end, `+`/`-`, ctrl+A, Escape |

A bar has to be selected before a drag will move it, so a stray drag scrolls the
chart rather than rescheduling work nobody aimed at — the release of that same
press is what selects it, and the cursor says which of the two you will get
(`pointer` over an unselected bar, `grab` over a selected one). Set
`interaction.dragSelectedOnly: false` for the pick-up-anything behaviour, where
the press selects the bar and carries it in one gesture.

A *modified* drag follows `interaction.backgroundDrag` wherever it starts: with
the default map, ctrl and shift draw a rubber band from over a bar as readily as
from empty space — ctrl in add mode, so ctrl-dragging extends the selection
instead of moving what is already in it. An unmodified press on a bar is left to
`marqueeOnTasks`, so a `plain: 'marquee'` map does not quietly cost a chart its
drag-to-move.

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

Returning `null` skips a bar. `state` also carries `disabled` — true when the
bar's row has been switched off, which the default renderer draws as a faded bar
— and `inert`, true when that row also refuses input (`interaction.disabledRows`,
`'block'` by default), which is what the adapter enforces by ignoring pointer
input over the row and the default renderer honours by dropping the hover stroke.
Draw the look off `disabled`; draw affordances off `inert`.

## Time scale

`computeTimeTicks`, `computeTimeBands` and `computeTimeHeader` are pure functions
of `(timeStart, timeEnd, width)` that walk the *calendar* rather than adding fixed
milliseconds — day boundaries stay at local midnight across a DST change, and
month bands keep their real lengths. Both the canvas grid and the React header use
them, which is why grid lines and labels cannot drift apart.

## Zoom sliders

`buildTimeZoomOption` and `buildRowZoomOption` return the option for a real
ECharts `dataZoom` slider — one horizontal over the time domain, one vertical over
the rows. Each is meant for its *own* chart, sized to the strip it sits in, not for
the plot: the plot's series has no axis for a dataZoom to bind to, and a slider
sharing the plot's canvas would lay ECharts' pointer handling over the plot's own
drag, marquee and wheel gestures.

The engine still owns the camera, so a slider is wired as a controller and a view
of it. Both directions are pure functions here:

| direction | time | rows |
| --- | --- | --- |
| engine → slider | `timeZoomWindow` | `rowZoomWindow` |
| slider → engine | `timeZoomRange` | `rowZoomScrollTop`, `rowZoomLaneHeight` |

Windows are percentages of the axis, which is what `dataZoom` speaks. `taskDensity`
summarises task starts into buckets for the overview the time slider paints behind
its window, in one O(n) pass.

Two things worth knowing if you wire these up yourself. Write the engine's window
back with `setOption` rather than `dispatchAction`, since the latter fires the
`datazoom` event you are listening to and feeds its own output back in. And suspend
that write-back while a slider is being dragged: it is the one moment the two can
legitimately disagree — the engine has clamped, the pointer has not — and
correcting it mid-gesture pulls the handle out from under the pointer.

The row slider's axis is in *fractions* of the content, not pixels, because
dragging its handles rescales the rows and so changes the content height; an axis
in pixels would have to be rewritten mid-drag, and rewriting the option is also
what moves the window. `@gantt-chart/react` does all of this in `GanttZoomBar`.

## PNG export

```ts
import { downloadGanttPng, renderGanttToCanvas } from '@gantt-chart/echarts';
import * as echarts from 'echarts';

// What is on screen.
await downloadGanttPng({ engine, theme, echarts, filename: 'schedule.png' });

// Every row and the whole time domain, 2 400 px wide, at 1×.
const { canvas, width, height, bars } = renderGanttToCanvas({
  engine,
  theme,
  echarts,
  scope: 'full',
  width: 2400,
  pixelRatio: 1,
});
```

`ganttToPngDataURL` and `ganttToPngBlob` are the other two endings; all four take
the same input.

The plot is *re-rendered* into a throw-away instance and read back through
zrender's painter (`getZr().painter.getRenderedCanvas()` — the internal call
ECharts' own `getDataURL` is built on), then the header and gutter are drawn onto
the result from the same `computeTimeHeader` / `computeAxisRows` models the React
chrome uses. Three things follow from re-rendering rather than screenshotting:

- the image is independent of the on-screen size, of the device pixel ratio, and
  of the live renderer being `svg`;
- marquee, drag ghost and hover highlight are left out, while selection — state a
  reader set on purpose — is kept;
- **the engine is not moved.** A `full` export needs a different viewport than the
  one on screen and gets a substituted one, so there is no pan-and-restore, no
  store write and no `viewport:change` for the application to see.

| option | default |
| --- | --- |
| `scope` | `'viewport'`; `'full'` for every row and the whole domain |
| `width` / `height` | the live plot size (`full` height is what every row needs) |
| `timeRange` | whatever `scope` chose |
| `pixelRatio` | `2`, reduced if the canvas would exceed the limits |
| `background` | the theme's; `'transparent'` leaves it unpainted |
| `showHeader` / `showRowGutter` / `gutterWidth` / `showGrid` / `showRowBands` | as the widget draws them |
| `padding` | `0` |
| `maxItems` | `50 000`; `truncated` reports when it bites |
| `maxDimension` / `maxPixels` | `16 384` px per side, `32 000 000` px total |

Content is never cropped to make an export fit: the pixel ratio gives way first,
and an image that will not fit even at 1× throws rather than silently losing rows.
`planGanttExport` returns everything an export is made of without painting
anything, which is the seam for a different painter (or a test).

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
