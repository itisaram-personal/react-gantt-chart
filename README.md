# react-gantt-chart

A high-performance Gantt chart for React, built on an ECharts custom series.

Handles 100 000+ bars because the work is proportional to what is on screen, not
to the size of the dataset: normalization writes hot fields into typed arrays,
stacking and layout run once in data space, and each frame is selected by binary
search over row and time indexes.

```
@gantt-chart/core     framework- and renderer-agnostic engine
@gantt-chart/themes   light and dark themes
@gantt-chart/echarts  the ECharts renderer + input handling
@gantt-chart/react    components and hooks
@gantt-chart/demo     the 100K-item demo app
```

## Quick start

```bash
npm install @gantt-chart/react @gantt-chart/echarts @gantt-chart/core @gantt-chart/themes echarts
```

```tsx
import { GanttChart } from '@gantt-chart/react';
import '@gantt-chart/react/styles.css';

const groups = [
  { id: 'team', label: 'Platform' },
  { id: 'api', label: 'API', parentId: 'team' },
];

const tasks = [
  { id: '1', groupId: 'api', start: Date.parse('2026-03-02'), end: Date.parse('2026-03-09'),
    data: { label: 'Schema migration', progress: 0.4 } },
  { id: '2', groupId: 'api', start: Date.parse('2026-03-06'), end: Date.parse('2026-03-14'),
    data: { label: 'Rollout' } },
];

export function Schedule() {
  const [rows, setRows] = useState(tasks);
  return (
    <div style={{ height: 480 }}>
      <GanttChart tasks={rows} groups={groups} theme="dark" onTasksChange={setRows} />
    </div>
  );
}
```

`onTasksChange` makes the chart controlled: it hands back a new task array for
every committed drag or resize and never mutates your data. Omit it and the
engine keeps its own edited copy instead.

## How it is put together

```
tasks/groups ─► normalize ─► rows ─► layout + stacking ─► virtualize ─► render context
                (typed        (collapse   (lanes, row      (frame:      (per-bar
                 arrays)       aware)      geometry)        binary       geometry +
                                                            search)      state)
```

Each stage is memoized on its inputs, so:

| interaction | what re-runs |
| --- | --- |
| pan / zoom / scroll | the virtualizer only |
| select / hover | frame assembly only |
| collapse a group | rows, layout, stacking |
| replace data | everything |

Two decisions shape the whole design:

**The engine owns the viewport.** There is no ECharts axis or `dataZoom`
component, and the custom series uses `coordinateSystem: 'none'` — every bar
arrives already resolved to plot pixels. One owner for pan/zoom means no feedback
loop between the chart library and the engine, and the canvas *is* the plot area,
so a client coordinate becomes a plot coordinate with one subtraction.

**Chrome is DOM, bars are canvas.** The row gutter, the two-tier time header, the
tooltip and the context menu are ordinary elements driven by the same store, so a
row label can carry a real collapse button, a title and focus behaviour. Only the
bars — the part that can number in the thousands — go through the canvas.

## What you get

- **Stacking** — overlapping tasks in a row are packed into lanes, computed in
  data space so zooming never reshuffles them. Pin a task with `lane`, exempt it
  with `floating`.
- **Group tree** — nest groups via `parentId`, collapse at any depth, with
  optional roll-up of hidden descendants onto the nearest visible ancestor.
- **Selection** — click, ctrl-click, shift-range over *visual* order, marquee,
  select-all/invert, keyboard navigation.
- **Background gesture** — a drag on empty space marquee-selects or pans,
  per modifier. `interaction.backgroundDrag` maps `plain`/`ctrl`/`shift`/`alt`
  to `'marquee' | 'pan' | 'none'`; the default pans on a plain drag and marquees
  on shift or ctrl. Set `plain: 'marquee'` for drag-to-select instead, and
  `alt: 'marquee'` to regain remove-mode marquee.
- **Drag & resize** — move a selection horizontally, or freely when it is
  confined to one row; resize from edge handles; optional snapping. Gestures
  propose `TaskChange[]`; nothing mutates until you accept it.
- **Undo/redo** — `GanttHistory` inverts change sets, so history costs nothing
  per task.
- **PNG export** — `exportRef.current.download()` for what is on screen, or
  `{ scope: 'full' }` for every row and the whole time domain in one image. The
  plot is re-rendered offscreen and the header and gutter are drawn onto it, so
  the file looks like the widget — and the live chart never moves.
- **Plugins & overlays** — contribute extra render layers. Dependency arrows ship
  as one (`dependenciesPlugin`) and are indexed so per-frame cost tracks what is
  visible, not the size of the graph.
- **Theming** — light and dark, `createTheme` to derive, and every colour also
  exposed as a CSS custom property for the DOM chrome.

## Performance

From `packages/gantt-core/test/performance.test.ts` (100 000 tasks, one run on a
developer laptop):

| operation | time |
| --- | --- |
| normalize 100K | ~64 ms |
| layout + stacking 100K | ~36 ms |
| build one frame (682 of 100 000 bars) | ~0.08 ms |
| 2 000 hit tests | ~4 ms |
| `selectAll()` over 100K | ~14 ms |
| stack 20K mutually overlapping tasks in one row | ~12 ms |

The frame cost is the number that matters: it is set by the viewport, so panning
a 100 000-task chart costs the same as panning a 1 000-task one.

## Repository

```bash
npm install
npm test              # 219 tests across the packages
npm run typecheck     # every package
npm run build         # core → themes → echarts → react
npm run dev           # the demo app on http://localhost:5174
```

The demo resolves the packages to *source*, so editing the engine hot-reloads
without a build. Tests do the same through vitest aliases.

Docs per package: [core](packages/gantt-core/README.md) ·
[themes](packages/gantt-themes/README.md) ·
[echarts](packages/gantt-echarts/README.md) ·
[react](packages/gantt-react/README.md)

## Licence

MIT
