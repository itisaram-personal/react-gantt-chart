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
| `enableSelection` | master switch for selecting bars (default on); `false` closes every route into a selection |
| `enableMarqueeSelection` | master switch for the rubber band; on trades drag-to-move for it, `false` drops the box for every modifier |
| `tooltip` | custom body, or `false` to disable |
| `tooltipInteractive` | let the pointer into the tooltip (default); `false` for a label that never takes a click |
| `tooltipOpenDelay` | dwell on a bar before its tooltip opens, ms (default `1000`); `0` opens on contact |
| `contextMenuItems` | replace the default right-click menu |
| `rowMenuItems` | items for the gutter's per-row ⋯ button; `[]` drops it for that row |
| `renderRow` | replace gutter row rendering |
| `headerCorner` | content for the corner above the gutter |
| `markers` | vertical lines at fixed instants (see below) |
| `renderer` | `'canvas'` (default) or `'svg'` |
| `engineRef` | the engine, for toolbars, exports and undo |
| `exportRef` | a PNG exporter for this chart (see below) |
| `exportOptions` | defaults for every export call |
| `showHeader` / `showRowGutter` / `showRowMenu` / `showRowEnableToggle` / `showScrollbar` / `showGrid` / `showRowBands` | drop chrome |
| `enableRowToggle` | `false` leaves the gutter's disabled sign as a read-only marker |

Callbacks: `onSelectionChange`, `onTaskClick`, `onTaskDoubleClick`, `onRowToggle`,
`onRowDisabledChange`, `onViewportChange`, and `onDragEnd` (below).

## Time markers

`markers` draws vertical lines across the plot. A "today" line is one of these
rather than a feature of its own — the chart draws none by itself:

```tsx
const markers = useMemo<GanttTimeMarker[]>(
  () => [
    { id: 'freeze', time: freezeAt, label: 'Code freeze', dashed: true },
    { id: 'release', time: releaseAt, label: 'Release 2.0', color: '#16a34a' },
    { id: 'quarter', time: q3Start },  // a bare line, no chip
    { id: 'today', time: Date.now(), color: theme.colors.todayLine },
  ],
  [freezeAt, releaseAt, q3Start, theme],
);

<GanttChart tasks={tasks} groups={groups} markers={markers} />
```

| field | |
| --- | --- |
| `time` | where the line goes, epoch ms |
| `label` | drawn as a chip at the top of the line; omit for a bare line |
| `color` | line and chip colour; defaults to the theme's `markerLine` |
| `lineWidth` | px, default `1.5` |
| `dashed` | dashed rather than solid |
| `id` | your own identity; not needed to draw one |

Lines are drawn *under* the bars, so they read as a reference rather than as
something over the work; the chips are drawn above them, where
they can be read. Chips are placed left to right and one that would collide with
the previous chip is dropped — a cluster stays legible as lines. A chip that
would run off the right edge flips to the left of its line.

There is no `now` prop: the today line is yours, which is what lets it be
coloured, labelled, positioned and *timed* like any other marker. Colour it
`theme.colors.todayLine` for the familiar red, and re-date it on whatever
interval you want it to move — a chart nobody watches for an hour need not tick
at all, and one that should can `setInterval` its way there. Markers later in the
list paint over earlier ones, so put it where you want it in the stack.

Markers are chrome, not data: they take no part in layout, stacking or
hit-testing, take no pointer input, and never move a task. Ones outside the
visible window cost a comparison and draw nothing, so a year of sprint
boundaries can be passed and left to the viewport to filter. Pass a stable
reference (`useMemo`) — a new array identity re-renders the plot — and note that
PNG exports carry the same markers the screen does.

## Tooltips

The tooltip waits for the pointer to rest on a bar before it opens — one second
by default, so sweeping across a row raises nothing:

```tsx
<GanttChart tasks={tasks} groups={groups} tooltipOpenDelay={300} />
```

The dwell is per bar and starts over on each one. Leaving before it is up opens
nothing; moving to a second bar takes the first one's tooltip down at once
rather than leaving it over the wrong task while the new wait runs. `0` opens on
contact, and `tooltip={false}` drops the tooltip altogether.

The box opens beside the pointer — a long bar can be wider than the window, so
its own ends are no guide to where the cursor is — and stays put once open
instead of following the pointer around the bar. It flips to whichever side has
room and is clamped to the plot.

## Selection

Two props cover the common cases; `options.interaction` is still there for
anything finer.

```tsx
<GanttChart tasks={tasks} groups={groups} enableSelection={false} />
```

`enableSelection={false}` closes every route into a selection: clicking a bar,
ctrl/shift-clicking, the rubber band, ctrl+A, the arrow keys and the menu items
that select. Bars still hover, click (`onTaskClick` keeps firing), drag and
resize — they just never light up. Switching it off clears whatever was selected,
since no gesture would be left to clear it. `engine.selection.set(...)` still
works: an API call is your decision, not user input to be filtered.

```tsx
<GanttChart tasks={tasks} groups={groups} enableMarqueeSelection />
```

`enableMarqueeSelection` turns the left-drag into a rubber band that selects
every bar it covers, started from anywhere in the plot — empty background *or* a
bar. Moving and resizing bars by dragging is switched off in exchange, since one
gesture cannot do both; a click on a bar still selects it and fires
`onTaskClick`. Ctrl/meta adds to the selection, alt removes from it, as with the
background marquee. `enableSelection={false}` outranks it.

It is the master switch for the band, so `enableMarqueeSelection={false}` is not
merely "a plain drag pans": no box is drawn by any modifier, where ctrl and
shift otherwise would. Leave the prop unset to keep whatever `options.interaction`
says — which, left alone, is the default of ctrl/shift rubber-banding.

Turning the props off hands back the rest of what they took — drag, resize and
the plain background gesture — using your own `options.interaction` if you set
one, and the library default if you did not.

## Moving a bar

A drag picks up a bar only once it is **selected**. On an unselected one the
press runs the background gesture instead — a plain drag pans, ctrl/shift
rubber-bands — so a stray drag scrolls the chart rather than rescheduling work
nobody aimed at. Selecting takes one click first, which is exactly what the
release of that same press does when it never travelled far enough to be a drag,
and the cursor says which of the two you will get: `pointer` over an unselected
bar, `grab` over a selected one. Resize handles are unaffected.

```tsx
<GanttChart
  tasks={tasks}
  groups={groups}
  options={{ interaction: { dragSelectedOnly: false } }}
/>
```

`dragSelectedOnly: false` restores the pick-up-anything behaviour, where the
press selects the bar and carries it in one gesture.

Modifiers outrank the bar either way: a drag held with a modifier that
`options.interaction.backgroundDrag` maps to `'marquee'` draws the band wherever
it starts, over a bar as readily as over empty space. With the default map that
makes **ctrl-drag extend the selection** — it adds every bar the box covers,
rather than moving the ones already selected — and shift-drag replaces it.

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

Right after each row's label sits a forbidden-sign button that switches the row
off; once the row is off it stays visible and accented, so there is always a way
back. A disabled row keeps its bars — faded, so it still reads as data — and by
default ignores every interaction with them: selection, clicks, double-clicks,
drag, resize and marquee, and no drag from elsewhere can drop a task onto it.
They do still raise their tooltip on hover, since reading a bar changes nothing;
what they drop is the hover emphasis and the cursor, which would offer input the
row will not take. Its own controls keep working, so it can still be collapsed,
right-clicked and switched back on.

```tsx
<GanttChart
  tasks={tasks}
  // `disabled` seeds the state, the same way `collapsed` does.
  groups={[{ id: 'team-a', label: 'Team A', disabled: true }]}
  onRowDisabledChange={(row, disabled) => persist(row.group.id, disabled)}
/>
```

`onRowDisabledChange(row, disabled)` is the handler for every change: the gutter
button, the context menu, `engine.setRowDisabled`, and once per row a bulk
`engine.enableAllRows()` switches back on — top to bottom. It does *not* fire for
the `group.disabled` seed, which is your own state arriving rather than a change
to report back, so persist from the handler and seed from what you persisted.

From the engine: `engine.setRowDisabled(id, true)`, `engine.toggleRowDisabled(id)`,
`engine.isRowDisabled(id)`, `engine.setDisabledRows(ids)` (switch off exactly
these, on everything else), `engine.enableAllRows()`, and the `row:disable`
event, which is what the prop is wired to.
`showRowEnableToggle={false}` drops the button without giving up the API, and
`enableRowToggle={false}` keeps the sign but not the control — a row that is off
still shows it in the gutter, a row that is on shows nothing, and neither takes a
click. That is the shape for a chart whose rows are switched somewhere else (a
toolbar, a saved view, the server) but should still say which ones are off:

```tsx
<GanttChart
  tasks={tasks}
  groups={groups}
  enableRowToggle={false}
  // The menus keep their own "Disable row" item. Both callbacks *replace* the
  // built-in list rather than filter it, so a chart that is read-only
  // throughout spells out what it still offers.
  contextMenuItems={(menu, engine) => [
    { id: 'fit', label: 'Fit to timeline', onSelect: () => engine.viewport.fitTime() },
  ]}
  rowMenuItems={() => []}
/>
```

Whether a disabled row blocks interaction at all is yours to set:

```tsx
<GanttChart
  tasks={tasks}
  groups={groups}
  // 'block' (default) — the row ignores input.
  // 'interactive'     — the row is only faded; every gesture works on it.
  options={{ interaction: { disabledRows: 'interactive' } }}
  // Your own rule, with the row and the task to hand.
  onTaskClick={(task) => (isClosed(task.groupId) ? warn() : open(task))}
/>
```

Use `'interactive'` when "disabled" is your app's concept — a closed sprint, an
inactive resource — and the chart is only asked to *show* it. It is chart-wide;
a chart that needs a mix keeps `'interactive'` and filters in its own handlers.
Switching back to `'block'` drops any selection, hover or gesture then sitting on
a disabled row, exactly as disabling one does.

The rule is about *input*, not data: `selection.set`, `applyChanges` and every
other explicit call still reach a disabled row, whichever mode is set. Custom
item renderers get `state.disabled` (the state, for the look) and `state.inert`
(does it refuse input, for affordances); `renderRow` gets both off `row`.

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
