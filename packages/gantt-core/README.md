# @gantt-chart/core

The Gantt engine: data normalization, the group tree, stacking, layout,
virtualization, selection, drag, viewport and state. Nothing here touches the DOM,
React or ECharts.

```bash
npm install @gantt-chart/core
```

## Using it directly

```ts
import { GanttEngine } from '@gantt-chart/core';

const engine = new GanttEngine({
  tasks: [{ id: 't1', groupId: 'g1', start: 0, end: 86_400_000 }],
  groups: [{ id: 'g1', label: 'Build' }],
  size: { width: 900, height: 400 },
});

engine.viewport.fitTime();

const frame = engine.getVisible(); // only the bars that intersect the viewport
for (const item of frame.items) {
  // item.start/end/y/height are resolved, including any in-flight drag offset
}
```

## The pipeline

`data → rows → layout(+stacking) → virtualize`, each stage memoized on its
inputs. `getRows()`, `getLayout()` and `getVisible()` are cheap to call repeatedly
— they return the cached result until something they depend on changes.

`LayoutResult` is deliberately array-shaped: `rowY`/`rowHeight` for binary search
over rows, `rankToTask` + `rowOffsets` as a CSR index of displayed tasks in
*visual* order (row, then start time), `taskLane` for stacking, and
`maxEndPrefix` — a running maximum of `end` within each row — which is what lets
the virtualizer stop a backwards scan early instead of walking a whole row.

## Sub-engines

| accessor | what it owns |
| --- | --- |
| `engine.viewport` | time window, scroll, zoom, fit, scroll-into-view |
| `engine.selection` | click semantics, ranges over visual order, marquee, keyboard focus |
| `engine.drag` | gestures, mode derivation, snapping, change proposals |
| `engine.contextMenu` | menu target, position, selection snapshot |
| `engine.overlays` | extra render layers for plugins |
| `engine.store` | immutable snapshot state, subscriptions |
| `engine.events` | typed event bus (`GanttEventMap`) |

## Editing model

Gestures never mutate task data. A drag writes a `DragState` into the store, the
virtualizer applies that offset while building the frame, and on commit the engine
emits `TaskChange[]` — each carrying its own `previous` snapshot. Accept them with
`engine.applyChanges(changes)`, or apply them yourself and re-render.

Because every change carries its own inverse, `GanttHistory` can offer undo/redo
without ever copying the dataset:

```ts
const history = new GanttHistory({ limit: 200 });
engine.on('drag:end', ({ changes, cancelled }) => {
  if (!cancelled && changes.length) {
    engine.applyChanges(changes);
    history.push(changes);
  }
});

const undone = history.undo();
if (undone) engine.applyChanges(undone.changes);
```

## Stacking

Overlap is resolved into lanes by `LaneAllocator`, in data space, so zoom never
reshuffles a row. `minGap` widens the interval used for overlap tests, `maxLanes`
caps a row, `lane` pins a task, and `floating` exempts one from overlap entirely.
Milestones (`start === end`) are widened infinitesimally so two at the same
instant do not share a lane.

## Hit testing

`hitTest(point)` answers what is under a pixel without scanning the dataset:
binary search for the row, then for the last task starting before that time, then
a short backwards scan bounded by `maxEndPrefix`. The same `minItemWidth`
tolerance the renderer uses is applied, so a 1px bar is still clickable.

## Data notes

Bad input is tolerated and reported through `warnings` rather than thrown:
duplicate ids, reversed ranges, non-finite times, missing parents and parent
cycles all have defined behaviour. Tasks referencing an unknown `groupId` get an
implicit group so nothing silently disappears.
