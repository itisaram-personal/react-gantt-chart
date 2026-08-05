# @gantt-chart/react

React components and hooks for the Gantt chart.

```bash
npm install @gantt-chart/react @gantt-chart/echarts @gantt-chart/core @gantt-chart/themes echarts react react-dom
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
| `contextMenuItems` | replace the default right-click menu |
| `rowMenuItems` | items for the gutter's per-row ⋯ button; `[]` drops it for that row |
| `renderRow` | replace gutter row rendering |
| `headerCorner` | content for the corner above the gutter |
| `now` | epoch ms for the marker; `null` hides it, omit for the live clock |
| `renderer` | `'canvas'` (default) or `'svg'` |
| `engineRef` | the engine, for toolbars, exports and undo |
| `showHeader` / `showRowGutter` / `showRowMenu` / `showScrollbar` / `showGrid` / `showRowBands` | drop chrome |

Callbacks: `onSelectionChange`, `onTaskClick`, `onTaskDoubleClick`, `onRowToggle`,
`onViewportChange`.

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
`useEngineVersion`, `useElementSize`, `useNativeWheel`.

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
