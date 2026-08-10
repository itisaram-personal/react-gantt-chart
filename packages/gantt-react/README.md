# @gantt-chart/react

React components and hooks for the Gantt chart.

```bash
npm install @gantt-chart/react
```

```tsx
import { GanttChart } from '@gantt-chart/react';
import '@gantt-chart/react/styles.css';

<div style={{ height: 500 }}>
  <GanttChart tasks={tasks} groups={groups} theme="dark" onTasksChange={setTasks} />
</div>
```

The chart fills its parent, so give that parent a height.

## Controlled or not

With `onTasksChange`, the component is controlled: every committed drag or resize
calls back with a new array plus the `TaskChange[]` that produced it, and your data
is never mutated. Without it, the engine keeps its own edited copy — fine for a
read-mostly view or a quick prototype.

`onChanges` fires either way, which is where an undo stack belongs:

```tsx
const history = useMemo(() => new GanttHistory(), []);

<GanttChart
  tasks={tasks}
  groups={groups}
  engineRef={engineRef}
  onTasksChange={(next, changes) => { setTasks(next); history.push(changes); }}
/>;

const undo = () => {
  const entry = history.undo();
  if (entry) setTasks(engineRef.current!.applyChanges(entry.changes));
};
```

## Props worth knowing

| prop | what it does |
| --- | --- |
| `options` | engine config: `metrics`, `stacking`, `virtualization`, `interaction`, zoom limits |
| `theme` | `'light'`, `'dark'`, or a theme object |
| `itemRenderer` | draw bars yourself |
| `dependencies` | arrow links; installs the dependency plugin for you |
| `plugins` | your own engine plugins |
| `tooltip` | custom body, or `false` to disable |
| `tooltipInteractive` | let the pointer into the tooltip (default); `false` for a label that never takes a click |
| `contextMenuItems` | replace the default right-click menu |
| `rowMenuItems` | items for the gutter's per-row ⋯ button; `[]` drops it for that row |
| `renderRow` | replace gutter row rendering |
| `headerCorner` | content for the corner above the gutter |
| `now` | epoch ms for the marker; `null` hides it, omit for the live clock |
| `renderer` | `'canvas'` (default) or `'svg'` |
| `engineRef` | the engine, for toolbars, exports and undo |
| `exportRef` | a PNG exporter for this chart (see below) |
| `exportOptions` | defaults for every export call |
| `showHeader` / `showRowGutter` / `showRowMenu` / `showRowEnableToggle` / `showScrollbar` / `showGrid` / `showRowBands` | drop chrome |

Callbacks: `onSelectionChange`, `onTaskClick`, `onTaskDoubleClick`, `onRowToggle`,
`onRowDisabledChange`, `onViewportChange`, and `onDragEnd` (below).

## When a drag ends

`onChanges` says what to write. `onDragEnd` says what the *gesture* did — the
tasks it moved, where the pointer let go, and the row and group they landed on:

```tsx
<GanttChart
  tasks={tasks}
  groups={groups}
  onDragEnd={(event) => {
    if (event.cancelled) return;
    console.log(
      event.tasks.map((task) => task.id),  // moved, still holding their old values
      new Date(event.time),                // time under the pointer at the drop
      event.group?.id,                     // group they landed in, and `event.row`
      event.changes,                       // the edits: new start/end/groupId + `previous`
    );
  }}
/>
```

It fires before the changes are applied — and before `onChanges` and
`onTasksChange` — so `event.tasks` still holds the values the drag started from;
the new ones are in `event.changes[i]`, in the same order. A cancelled gesture is
reported too, with `cancelled: true` and nothing in `changes`. Resizes come
through the same handler, with `mode` naming the handle that was dragged.

## Row options

Each gutter row carries a ⋯ button, revealed when the row is hovered or the button
is focused, which opens a menu for that row. Left alone it offers collapse/expand,
select the row's tasks and zoom to the row's own time span. `rowMenuItems` replaces
that with your own actions:

```tsx
<GanttChart
  tasks={tasks}
  groups={groups}
  rowMenuItems={(row, engine) => [
    { id: 'rename', label: 'Rename…', onSelect: () => rename(row.group.id) },
    { id: 'sep', separator: true },
    { id: 'zoom', label: 'Zoom to row', onSelect: () => engine.viewport.scrollRowIntoView(row.index) },
  ]}
/>
```

Returning `[]` leaves that row without a button, which is how only some rows get
one. It is called for every visible row while the gutter renders, so keep it cheap
— do the work that needs the row's tasks inside `onSelect`, where it runs once per
click. `showRowMenu={false}` removes the button everywhere.

Pass `tasks`/`groups`/`options` as stable references (`useMemo`) — a new array
identity means a re-normalize. `options` is compared by value, so an inline
literal is safe there.

## Disabling a row

Right after each row's label sits a power button that switches the row off. A
disabled row keeps its bars — faded, so it still reads as data — but ignores
every interaction with them: selection, clicks, double-clicks, drag, resize,
marquee and hover, and no drag from elsewhere can drop a task onto it. Its own
controls keep working, so it can still be collapsed, right-clicked and switched
back on.

```tsx
<GanttChart
  tasks={tasks}
  // `disabled` seeds the state, the same way `collapsed` does.
  groups={[{ id: 'team-a', label: 'Team A', disabled: true }]}
  onRowDisabledChange={(row, disabled) => persist(row.group.id, disabled)}
/>
```

From the engine: `engine.setRowDisabled(id, true)`, `engine.toggleRowDisabled(id)`,
`engine.isRowDisabled(id)`, `engine.enableAllRows()`, and the `row:disable` event.
`showRowEnableToggle={false}` drops the button without giving up the API.

The rule is about *input*, not data: `selection.set`, `applyChanges` and every
other explicit call still reach a disabled row. Custom item renderers get
`state.disabled` to draw it their own way, and `renderRow` gets `row.disabled`.

## PNG export

```tsx
const exporter = useRef<GanttExportApi>(null);

<GanttChart tasks={tasks} groups={groups} exportRef={exporter} />;

// What is on screen.
await exporter.current?.download({ filename: 'schedule.png' });

// Every row and the whole time domain, 2 400 px wide.
const { canvas, width, height, bars } = exporter.current!.toCanvas({
  scope: 'full',
  width: 2400,
});
```

Four endings — `toCanvas`, `toDataURL`, `toBlob`, `download` — over the same
options. Defaults follow the component's own chrome props, so an export looks like
the widget it came from; `exportOptions` changes those defaults and any call can
override them. The full list is in
[`@gantt-chart/echarts`](../gantt-echarts/README.md#png-export), along with what
the exporter does and does not put in the image.

The plot is re-rendered rather than screenshotted, so a `'full'` export can be a
different size and time window than the live view **without moving it** — no pan
and restore, and no `onViewportChange` while it happens. Interaction state
(marquee, drag ghost, hover) is left out; selection is kept.

`useGanttExport({ engine, theme, … })` is the same exporter for a custom shell,
and returns a stable object safe to hand to a memoized toolbar.

## Composition

`GanttChart` is an assembly, not a monolith. The engine owns state and geometry,
the ECharts adapter paints the plot, and the header, gutter, scrollbar, tooltip and
menu are ordinary DOM subscribed to the same store. Every piece is exported, so an
app that wants different chrome keeps the engine and the plot:

```tsx
const engine = useGanttEngine({ tasks, groups });
const viewport = useEngineState(engine, (state) => state.viewport, shallowEqual);

<>
  <MyToolbar engine={engine} />
  <GanttTimeHeader engine={engine} theme={theme} />
  <div style={{ display: 'flex', flex: 1 }}>
    <GanttRowGutter engine={engine} theme={theme} width={240} />
    <GanttPlot engine={engine} theme={theme} />
  </div>
</>
```

Hooks: `useGanttEngine` (owns the engine and syncs props),
`useEngineState(engine, selector, isEqual?)` (subscribe to a slice),
`useGanttExport` (PNG export), `useEngineVersion`, `useElementSize`,
`useNativeWheel`.

## Notes

- Only the ECharts `custom` series and the two renderers are imported, so the rest
  of ECharts is never pulled into your bundle.
- `useEngineState` is built on `useState`/`useEffect` rather than
  `useSyncExternalStore`, because the package supports React 17. The selector is
  re-run immediately after subscribing, so nothing is missed between render and
  effect.
- Vertical scrolling is drawn from engine state, not browser overflow: wheel,
  keyboard, drag-to-pan and the scrollbar thumb all write through
  `viewport.scrollTo`, so there is one source of truth.
- The stylesheet is plain CSS with theme values as custom properties. Override any
  `.gantt-*` class, or restyle by setting `--gantt-*` yourself.
