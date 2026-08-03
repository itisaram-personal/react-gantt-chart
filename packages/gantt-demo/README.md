# @gantt-chart/demo

The demo app: a generated project schedule from 1 000 up to 250 000 tasks.

```bash
npm install
npm run dev     # http://localhost:5174
```

Vite resolves the packages to *source*, so editing the engine, the adapter or the
components hot-reloads here with no build step.

## What it exercises

- **Scale** — pick 1K / 10K / 100K / 250K tasks and watch the footer: `bars drawn`
  stays in the dozens or hundreds while `tasks` grows by orders of magnitude. That
  gap is the virtualizer.
- **Stacking** — projects contain overlapping tasks, so rows grow lanes; the badge
  in the gutter shows the lane count per row. Toggle stacking off to compare.
- **Group tree** — teams contain projects; collapse a team and the roll-up toggle
  decides whether its tasks appear on the collapsed row.
- **Controlled editing** — `onTasksChange` holds the data in React state, and every
  drag is recorded into `GanttHistory` for the undo/redo buttons.
- **Custom rendering** — "Colour by status" swaps in an `itemRenderer` that colours
  bars by task status instead of by group.
- **Dependencies** — finish-to-start arrows drawn by the overlay plugin.
- **Themes** — light/dark switching, including the DOM chrome.

Interaction: drag bars, drag their edges to resize, marquee on empty space, wheel
to scroll, ctrl+wheel to zoom at the pointer, middle-drag to pan, right-click for
the menu, arrows/page/home/end and ctrl+A from the keyboard.

The dataset is generated with a seeded PRNG, so a reload reproduces it exactly.
Projects are scattered across one fixed calendar window rather than laid end to
end — growing the dataset adds rows rather than stretching the timeline into empty
space.
