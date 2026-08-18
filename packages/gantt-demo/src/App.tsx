import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  GanttHistory,
  applyChanges,
  type GanttEngine,
  type GanttId,
  type GanttRow,
  type GanttTimeMarker,
  type TaskChange,
  type GanttEngineOptions,
  type DeepPartial,
  type ViewportState,
} from "@gantt-chart/core";
import { defaultItemRenderer, type GanttItemRenderer } from "@gantt-chart/echarts";
import {
  GanttChart,
  darkTheme,
  lightTheme,
  type GanttDragEndEvent,
  type GanttExportApi,
  type GanttExportScope,
} from "@gantt-chart/react";
import "@gantt-chart/react/styles.css";
import { LinkedCharts } from "./LinkedCharts";
import { Stat, Toggle } from "./controls";
import {
  generate,
  statusColor,
  type DemoGroup,
  type DemoGroupData,
  type DemoTask,
  type DemoTaskData,
} from "./data";
import { useFrameStats } from "./useFrameStats";
import "./app.css";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

const SIZES = [1_000, 10_000, 100_000, 250_000];
const SNAPS: { label: string; value: number }[] = [
  { label: "off", value: 0 },
  { label: "1h", value: HOUR },
  { label: "1d", value: DAY },
];
/** Dwell on a bar before its tooltip opens. The chart's own default is 1s. */
const TOOLTIP_DELAYS: { label: string; value: number }[] = [
  { label: "none", value: 0 },
  { label: "0.3s", value: 300 },
  { label: "1s", value: 1000 },
  { label: "2s", value: 2000 },
];

/** Tasks generated per row — drives how much there is to stack. */
const PER_ROW = [25, 50, 100, 200, 500, 1000, 2000];
/**
 * Floor for "Fit Y". Below a couple of pixels a row is a line rather than a
 * chart, and 250 000 tasks would ask for a fraction of one anyway.
 */
const MIN_ROW_PX = 2;

/** Every nth row ships switched off, so the demo starts with some to look at. */
const DISABLE_EVERY = 5;

/** Metrics are compared by value on the way into the engine; keep them stable. */
const round1 = (value: number): number => Math.round(value * 10) / 10;

/** Engine ceiling on lanes per row; extra tasks pack into the last lane. */
const MAX_LANES: { label: string; value: number }[] = [
  { label: "1", value: 1 },
  { label: "2", value: 2 },
  { label: "4", value: 4 },
  { label: "8", value: 8 },
  { label: "unlimited", value: 64 },
];

/**
 * How the y-axis list is structured and ordered.
 *
 * Only ever a different `groups` array — the tasks never move, so switching costs
 * one pass over the dataset and nothing per frame. That is the whole contract:
 * `groups` *is* the y axis.
 */
type RowMode = "projects" | "teams" | "start";

const ROW_MODES: { value: RowMode; label: string; title: string }[] = [
  {
    value: "projects",
    label: "Projects",
    title: "One flat row per project, in the order the generator made them",
  },
  {
    value: "teams",
    label: "Teams → projects",
    title: "The generator's own tree: two levels, so collapse and roll-up have something to do",
  },
  {
    value: "start",
    label: "By start date",
    title: "Flat projects, earliest first — row order is the app's choice, not the engine's",
  },
];

/**
 * Which items are on the y axis.
 *
 * Unlike {@link RowMode} this cannot be done with `groups` alone: the engine
 * synthesizes a row for any `task.groupId` it was not given, so dropping a group
 * on its own brings it straight back as an unlabelled row at the end. Trimming
 * the y axis means trimming the *tasks* as well, which is what `chartTasks`
 * below does — and why "All" is the one setting that costs nothing.
 *
 * Applied after {@link RowMode} has ordered the list, so "First 10" of
 * "By start date" is the ten earliest projects rather than the ten the generator
 * happened to make first.
 */
type RowFilter = "all" | "first10" | "first50" | "earlyStart";

/** Cut-off for the `earlyStart` filter, measured into the generated timeline. */
const EARLY_START_DAYS = 30;

const ROW_FILTERS: { value: RowFilter; label: string; title: string }[] = [
  { value: "all", label: "All", title: "Every project in the dataset" },
  { value: "first10", label: "First 10", title: "The first ten rows, as ordered above" },
  { value: "first50", label: "First 50", title: "The first fifty rows, as ordered above" },
  {
    value: "earlyStart",
    label: "Early starters",
    title:
      `Only projects beginning in the first ${EARLY_START_DAYS} days of the timeline` +
      " — a filter the data decides rather than a count",
  },
];

/** Which demo is on screen. */
type View = "playground" | "linked";

interface ViewProps {
  dark: boolean;
  setDark: (dark: boolean) => void;
  /** The view switch, rendered into each view's own title bar. */
  tabs: ReactNode;
}

/**
 * The demo proper: one chart, and a control for everything the engine can be
 * told to do.
 */
function Playground({ dark, setDark, tabs }: ViewProps): JSX.Element {
  const [taskCount, setTaskCount] = useState(10_000);
  const [tasksPerRow, setTasksPerRow] = useState(100);
  const [rowMode, setRowMode] = useState<RowMode>("projects");
  const [rowFilter, setRowFilter] = useState<RowFilter>("all");
  const [maxLanes, setMaxLanes] = useState(64);
  const [stacking, setStacking] = useState(true);
  const [uniformRows, setUniformRows] = useState(true);
  const [rollup, setRollup] = useState(true);
  const [snapMs, setSnapMs] = useState(0);
  const [tooltipDelay, setTooltipDelay] = useState(1000);
  const [showDependencies, setShowDependencies] = useState(true);
  const [colorByStatus, setColorByStatus] = useState(true);
  const [enableSelection, setEnableSelection] = useState(true);
  /** Do the faded rows refuse input, or are they only marked? */
  const [blockDisabledRows, setBlockDisabledRows] = useState(true);
  const [marqueeSelection, setMarqueeSelection] = useState(false);
  const [showMarkers, setShowMarkers] = useState(true);
  const [selection, setSelection] = useState<GanttId[]>([]);

  const dataset = useMemo(
    () =>
      generate({
        taskCount,
        tasksPerProject: tasksPerRow,
        withDependencies: false,
      }),
    [taskCount, tasksPerRow],
  );
  const [tasks, setTasks] = useState<DemoTask[]>(dataset.tasks);
  useEffect(() => setTasks(dataset.tasks), [dataset]);

  /**
   * The y-axis list: the rows {@link RowFilter} kept, structured and ordered by
   * {@link RowMode}, plus the set of group ids that survived so the tasks can be
   * trimmed to match.
   *
   * Two of the three modes are one flat row per distinct `task.groupId` — the
   * list the engine would synthesize on its own if `groups` were omitted, spelled
   * out here so that every {@link DISABLE_EVERY}th row can carry
   * `disabled: true`. Such a row keeps its bars — faded, still exported, still hit
   * by "Fit" and the zoom bars — and ignores every interaction with them: no
   * hover, click, marquee, drag, or drop onto it. That last part is the
   * "Block off rows" toggle (`interaction.disabledRows`), not the state itself.
   *
   * `disabled` only *seeds* the state, and only for groups the engine has not seen
   * before, so the gutter's power button and "Enable rows" win from then on — and
   * survive both an edit to the tasks and a switch of mode, since a group id keeps
   * whatever the user last did to it.
   *
   * Built from `dataset.tasks` rather than `tasks`: rows come and go with the
   * dataset, not with an edit, and rebuilding this over 250 000 tasks on every
   * drag would be the most expensive thing in the app.
   */
  const axis = useMemo<{ groups: DemoGroup[]; kept: Set<GanttId> | null }>(() => {
    // One pass for the project list, for the ordering, and for the earliest
    // start each project has — which is both the sort key and the filter.
    const order: GanttId[] = [];
    const startOf = new Map<GanttId, number>();
    let earliest = Infinity;
    for (const task of dataset.tasks) {
      const known = startOf.get(task.groupId);
      if (known === undefined) {
        order.push(task.groupId);
        startOf.set(task.groupId, task.start);
      } else if (task.start < known) {
        startOf.set(task.groupId, task.start);
      }
      if (task.start < earliest) earliest = task.start;
    }

    if (rowMode === "start") {
      // Stable, so projects starting on the same day keep their generated order.
      order.sort((a, b) => (startOf.get(a) as number) - (startOf.get(b) as number));
    }

    const cutoff = earliest + EARLY_START_DAYS * DAY;
    const chosen =
      rowFilter === "first10"
        ? order.slice(0, 10)
        : rowFilter === "first50"
          ? order.slice(0, 50)
          : rowFilter === "earlyStart"
            ? order.filter((id) => (startOf.get(id) as number) < cutoff)
            : order;

    // Null means "all of them", which is what lets `chartTasks` do no work.
    const kept = chosen.length === order.length ? null : new Set(chosen);

    if (rowMode !== "teams") {
      return {
        kept,
        groups: chosen.map<DemoGroup>((id, index) => ({
          id,
          label: String(id),
          disabled: index % DISABLE_EVERY === DISABLE_EVERY - 1,
          data: { kind: "project" },
        })),
      };
    }

    /*
     * The generator's real tree, which the flat modes throw away: teams as roots,
     * projects beneath them, and only the projects carrying tasks. A team whose
     * every project the filter removed is dropped as well, rather than left as an
     * empty row — the engine has no reason to guess that for us.
     */
    const projects = dataset.groups.filter(
      (group) => group.data?.kind === "project" && (kept === null || kept.has(group.id)),
    );
    const parents = new Set(projects.map((group) => group.parentId as GanttId));

    return {
      kept,
      groups: [
        ...dataset.groups.filter((group) => group.data?.kind === "team" && parents.has(group.id)),
        ...projects.map((group, index) => ({
          ...group,
          disabled: index % DISABLE_EVERY === DISABLE_EVERY - 1,
        })),
      ],
    };
  }, [dataset, rowMode, rowFilter]);

  const groups = axis.groups;

  /**
   * The tasks the chart is actually given — those on a row the y axis kept.
   *
   * `axis.kept === null` short-circuits to the same array, which matters: this
   * runs again on every committed drag, and an unconditional pass over 250 000
   * tasks would be the most expensive thing in the app. A filtered y axis opts
   * into that cost, and only while it is filtered.
   */
  const chartTasks = useMemo(() => {
    const kept = axis.kept;
    return kept === null ? tasks : tasks.filter((task) => kept.has(task.groupId));
  }, [tasks, axis.kept]);

  /**
   * Frame roughly six weeks around today. The engine's own default is to fit the
   * whole domain, which here is 18 months — correct, but every bar would be a
   * sliver. "Fit" in the toolbar goes back to that view.
   */
  const [engine, setEngine] = useState<GanttEngine<DemoTaskData, DemoGroupData> | null>(null);
  useEffect(() => {
    if (!engine) return;
    const start = Date.now() - 7 * DAY;
    engine.viewport.setTimeRange(start, start + 45 * DAY);
  }, [engine, dataset]);

  const history = useMemo(() => new GanttHistory({ limit: 200 }), []);
  const [historyDepth, setHistoryDepth] = useState({ undo: 0, redo: 0 });
  const stats = useFrameStats(engine as GanttEngine<unknown, unknown> | null);

  /**
   * How long the y-axis list is, and how many of its rows are off right now: the
   * seeded ones, plus every toggle from the gutter's power button or the
   * right-click menu since.
   *
   * Counted from the rows rather than accumulated. `onRowDisabledChange` fires
   * once per row that changes — a toggle, or each row `enableAllRows` switches
   * back on — but never for the seed, so a running total would start wrong.
   *
   * The total is not `groups.length`: with the nested y axis a collapsed team
   * takes its projects out of the list, so only the layout knows how many rows
   * there actually are. Hence the recount on every collapse as well.
   */
  const [rowCounts, setRowCounts] = useState({ total: 0, disabled: 0 });
  const countRows = useCallback(() => {
    if (!engine) return;
    const rows = engine.getLayout().rows;
    let disabled = 0;
    for (const row of rows) if (row.disabled) disabled++;
    setRowCounts({ total: rows.length, disabled });
  }, [engine]);
  useEffect(() => {
    countRows();
  }, [countRows, groups]);

  /**
   * A handful of vertical lines, dated against midnight today so they sit in the
   * generated data's range.
   *
   * The red "now" line is one of them rather than a prop of its own: the chart
   * draws no today line by itself, which is what lets this one be styled,
   * labelled and moved like any other marker — an app that wants it to track the
   * clock re-dates it on whatever interval suits it.
   *
   * Memoized on the theme alone: a fresh array every render would re-render the
   * plot for markers that never moved.
   */
  const markers = useMemo<GanttTimeMarker[]>(() => {
    const today = new Date(new Date().setHours(0, 0, 0, 0)).getTime();
    const palette = dark ? darkTheme : lightTheme;
    return [
      { id: "kickoff", time: today - 60 * DAY, label: "Kick-off", color: "#0ea5e9" },
      { id: "freeze", time: today - 7 * DAY, label: "Code freeze", dashed: true },
      { id: "today", time: Date.now(), label: "Now", color: palette.colors.todayLine },
      { id: "release", time: today + 21 * DAY, label: "Release 2.0", color: "#16a34a" },
    ];
  }, [dark]);

  const options: DeepPartial<GanttEngineOptions> = useMemo(
    () => ({
      metrics: { uniformRowHeight: uniformRows },
      stacking: { enabled: stacking, rollupCollapsed: rollup, maxLanes },
      interaction: {
        snapMs,
        // The fade is the state; this is what it costs the row.
        disabledRows: blockDisabledRows ? "block" : "interactive",
        // Ctrl is the band in *add* mode, so a ctrl-drag extends the selection
        // from anywhere in the plot — empty space, a bar, even a bar already
        // selected. Mapping it to `pan` is what stops that, since a modifier
        // only reaches over a bar when the map says it draws a band.
        backgroundDrag: { alt: "pan", plain: "pan", ctrl: "marquee", shift: "marquee" },
      },
    }),
    [stacking, uniformRows, rollup, maxLanes, snapMs, blockDisabledRows],
  );

  /** Colour by status instead of by group — the same hook a consumer would use. */
  const itemRenderer = useMemo<GanttItemRenderer<DemoTaskData, DemoGroupData> | undefined>(() => {
    if (!colorByStatus) return undefined;
    return (context) =>
      defaultItemRenderer({
        ...context,
        task: {
          ...context.task,
          data: {
            ...(context.task.data as DemoTaskData),
            color: statusColor((context.task.data as DemoTaskData).status, context.theme.dark),
          },
        },
      });
  }, [colorByStatus]);

  /**
   * Items for the gutter's ⋯ button — app-specific row actions the library
   * cannot guess, which is the point of the prop. Passing it replaces the
   * built-in set (collapse, select, zoom) rather than extending it.
   *
   * Note what this does *not* do: no counting, filtering or measuring. The
   * factory runs for every visible row on every gutter render, so the work that
   * needs the row's tasks happens inside `onSelect`, where it runs once per
   * click. `row` itself is free — it already carries depth, lanes and group data.
   */
  const rowMenuItems = useCallback(
    (row: GanttRow<DemoGroupData>, chart: GanttEngine<DemoTaskData, DemoGroupData>) => {
      const idsInRow = (): GanttId[] =>
        tasks.filter((task) => task.groupId === row.group.id).map((task) => task.id);

      return [
        ...(row.hasChildren
          ? [
              {
                id: "toggle",
                label: row.collapsed ? "Expand group" : "Collapse group",
                onSelect: () => chart.toggleCollapse(row.group.id),
              },
              { id: "sep-1", separator: true },
            ]
          : []),
        {
          id: "select",
          label: "Select this row's tasks",
          onSelect: () => chart.selection.set(idsInRow()),
        },
        {
          id: "zoom",
          label: "Zoom to this row",
          onSelect: () => {
            const own = tasks.filter((task) => task.groupId === row.group.id);
            if (own.length === 0) return;
            let start = Infinity;
            let end = -Infinity;
            for (const task of own) {
              if (task.start < start) start = task.start;
              if (task.end > end) end = task.end;
            }
            chart.viewport.setTimeRange(start, end);
            chart.viewport.scrollRowIntoView(row.index, 8);
          },
        },
        { id: "sep-2", separator: true },
        {
          // A data edit, to show the menu reaching past the viewport. Visible
          // straight away with "Colour by status" on.
          id: "done",
          label: "Mark this row done",
          onSelect: () => {
            const own = new Set(idsInRow());
            setTasks((current) =>
              current.map((task) =>
                own.has(task.id) && task.data
                  ? {
                      ...task,
                      data: {
                        ...task.data,
                        status: "done" as const,
                        progress: 1,
                      },
                    }
                  : task,
              ),
            );
          },
        },
        {
          id: "log",
          label: `Log row (${row.laneCount} ${row.laneCount === 1 ? "lane" : "lanes"})`,
          onSelect: () => console.log("[demo] row", row.group.id, row),
        },
      ];
    },
    [tasks],
  );

  /**
   * PNG export.
   *
   * "PNG" saves what is on screen; "PNG all" saves every row and the whole time
   * domain, which is where the canvas size limit bites — a few thousand rows do
   * not fit in one image, and the exporter says so rather than cropping. The
   * message goes to the footer so the failure is visible without the console.
   */
  const exporter = useRef<GanttExportApi>(null);
  const [exportNote, setExportNote] = useState<string | null>(null);

  const exportPng = useCallback(async (scope: GanttExportScope) => {
    const api = exporter.current;
    if (!api) return;
    setExportNote(`exporting ${scope}…`);
    try {
      const started = performance.now();
      await api.download({ scope, filename: `gantt-${scope}.png` });
      setExportNote(`${scope} PNG saved in ${Math.round(performance.now() - started)} ms`);
    } catch (error) {
      setExportNote(error instanceof Error ? error.message : String(error));
    }
  }, []);

  /**
   * Where the last gesture put things.
   *
   * `onDragEnd` reports the drop itself — the tasks that moved, the time under
   * the pointer, the row and group they landed on — while `onTasksChange` below
   * carries the edit. Two handlers because they answer different questions: one
   * is the gesture, the other is the data.
   */
  const [lastDrop, setLastDrop] = useState<string | null>(null);
  const describeDrop = useCallback((event: GanttDragEndEvent<DemoTaskData, DemoGroupData>) => {
    if (event.cancelled || event.tasks.length === 0) {
      setLastDrop(event.cancelled ? "cancelled" : null);
      return;
    }
    const first = event.tasks[0];
    const what =
      event.tasks.length === 1
        ? (first.data?.label ?? String(first.id))
        : `${event.tasks.length} tasks`;
    const when = new Intl.DateTimeFormat("en-GB", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(event.time);
    setLastDrop(`${what} → ${event.group?.label ?? "—"} @ ${when}`);
  }, []);

  /**
   * Apply an edit to the whole dataset, not to the part of it on screen.
   *
   * The array the chart hands over is `chartTasks` with the changes applied — so
   * when the y axis is filtered it holds only the rows that survived the filter,
   * and storing it would delete every task the filter is hiding. The `changes` are
   * the durable half of the payload, so all three of these replay them onto the
   * full list instead. `applyChanges` returns the same array when nothing matches,
   * so this is no more work than trusting the argument was.
   */
  const applyAndRecord = useCallback(
    (_next: DemoTask[], changes: TaskChange[]) => {
      setTasks((current) => applyChanges(current, changes) as DemoTask[]);
      history.push(changes, "move");
      setHistoryDepth({ undo: history.depth, redo: 0 });
    },
    [history],
  );

  const undo = useCallback(() => {
    const entry = history.undo();
    if (!entry) return;
    setTasks((current) => applyChanges(current, entry.changes) as DemoTask[]);
    setHistoryDepth({ undo: history.depth, redo: 1 });
  }, [history]);

  const redo = useCallback(() => {
    const entry = history.redo();
    if (!entry) return;
    setTasks((current) => applyChanges(current, entry.changes) as DemoTask[]);
    setHistoryDepth({ undo: history.depth, redo: 0 });
  }, [history]);

  /**
   * Pan from outside the chart.
   *
   * `panByPx` moves the window a fraction of its own width — positive is
   * forward in time. It clamps to the data domain, so holding a button never
   * runs off the end of the chart.
   */
  const pan = useCallback(
    (fraction: number) => engine?.viewport.panByPx(engine.viewport.state.width * fraction),
    [engine],
  );

  /**
   * Zoom all the way out on the row axis, and back.
   *
   * There is no single call for it because row height is a *metric*, not
   * viewport state. Scaling `laneHeight` and `minRowHeight` by one factor
   * scales `totalHeight` by exactly that factor, so a single pass lands on the
   * plot height — this is what the row zoom bar's handles do, with the window
   * fixed at "everything". The paddings are percentages, so they follow on
   * their own and are not touched here. Rows bottom out at {@link MIN_ROW_PX},
   * so a dataset with more rows than the plot has pixels gets as far as it can
   * and no further.
   *
   * The metrics from before the fit are kept so the button can undo itself.
   * Without that the demo would be stuck at hairline rows until a reload.
   */
  const rowMetrics = useRef<DeepPartial<GanttEngineOptions>["metrics"] | null>(null);
  const [rowsFitted, setRowsFitted] = useState(false);

  const fitRows = useCallback(() => {
    if (!engine) return;

    if (rowMetrics.current) {
      engine.setOptions({ metrics: rowMetrics.current });
      rowMetrics.current = null;
      setRowsFitted(false);
      return;
    }

    const { height } = engine.viewport.state;
    const total = engine.totalHeight;
    if (height <= 0 || total <= height) return;

    const { laneHeight, minRowHeight } = engine.getOptions().metrics;
    const scale = height / total;
    rowMetrics.current = { laneHeight, minRowHeight };
    engine.setOptions({
      metrics: {
        laneHeight: Math.max(MIN_ROW_PX, round1(laneHeight * scale)),
        minRowHeight: Math.max(MIN_ROW_PX, round1(minRowHeight * scale)),
      },
    });
    engine.viewport.scrollTo(0);
    setRowsFitted(true);
  }, [engine]);

  return (
    <div className={`app${dark ? " app--dark" : ""}`}>
      <header className="app__bar">
        <div className="app__title">
          <strong>Gantt</strong>
          <span className="app__muted">ECharts custom series · virtualized engine</span>
        </div>

        {tabs}
        <label className="app__field">
          Tasks
          <select value={taskCount} onChange={(event) => setTaskCount(Number(event.target.value))}>
            {SIZES.map((size) => (
              <option key={size} value={size}>
                {size.toLocaleString()}
              </option>
            ))}
          </select>
        </label>

        <label className="app__field" title="Tasks generated per row — how much there is to stack">
          Per row
          <select
            value={tasksPerRow}
            onChange={(event) => setTasksPerRow(Number(event.target.value))}
          >
            {PER_ROW.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </label>

        <label className="app__field" title="How the y-axis list is structured and ordered">
          Y axis
          <select
            value={rowMode}
            onChange={(event) => setRowMode(event.target.value as RowMode)}
            title={ROW_MODES.find((mode) => mode.value === rowMode)?.title}
          >
            {ROW_MODES.map((mode) => (
              <option key={mode.value} value={mode.value} title={mode.title}>
                {mode.label}
              </option>
            ))}
          </select>
        </label>

        <label className="app__field" title="Which items the y-axis list holds">
          Rows
          <select
            value={rowFilter}
            onChange={(event) => setRowFilter(event.target.value as RowFilter)}
            title={ROW_FILTERS.find((filter) => filter.value === rowFilter)?.title}
          >
            {ROW_FILTERS.map((filter) => (
              <option key={filter.value} value={filter.value} title={filter.title}>
                {filter.label}
              </option>
            ))}
          </select>
        </label>

        <label
          className="app__field"
          title="Lane ceiling per row — extra tasks pack into the last lane"
        >
          Max lanes
          <select value={maxLanes} onChange={(event) => setMaxLanes(Number(event.target.value))}>
            {MAX_LANES.map((option) => (
              <option key={option.label} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className="app__field">
          Snap
          <select value={snapMs} onChange={(event) => setSnapMs(Number(event.target.value))}>
            {SNAPS.map((snap) => (
              <option key={snap.label} value={snap.value}>
                {snap.label}
              </option>
            ))}
          </select>
        </label>

        <label
          className="app__field"
          title="How long the pointer must rest on a bar before its tooltip opens"
        >
          Tooltip delay
          <select
            value={tooltipDelay}
            onChange={(event) => setTooltipDelay(Number(event.target.value))}
          >
            {TOOLTIP_DELAYS.map((delay) => (
              <option key={delay.label} value={delay.value}>
                {delay.label}
              </option>
            ))}
          </select>
        </label>

        <Toggle label="Dark" checked={dark} onChange={setDark} />
        <Toggle label="Stacking" checked={stacking} onChange={setStacking} />
        <Toggle
          label="Equal rows"
          checked={uniformRows}
          onChange={setUniformRows}
          title="Same height for every row; only overlapping bars shrink to fit"
        />
        <Toggle
          label="Roll up"
          checked={rollup}
          onChange={setRollup}
          title="Show hidden children on their collapsed ancestor"
        />
        <Toggle label="Links" checked={showDependencies} onChange={setShowDependencies} />
        <Toggle label="Colour by status" checked={colorByStatus} onChange={setColorByStatus} />
        <Toggle
          label="Selection"
          checked={enableSelection}
          onChange={setEnableSelection}
          title="Off closes every route into a selection — click, marquee, ctrl+A, arrows"
        />
        <Toggle
          label="Drag to select"
          checked={marqueeSelection}
          onChange={setMarqueeSelection}
          title="Drag a box anywhere — background or bar — to select; trades away drag-to-move"
        />
        <Toggle
          label="Markers"
          checked={showMarkers}
          onChange={setShowMarkers}
          title="Vertical lines at fixed dates — kick-off, code freeze, today, release"
        />
        <Toggle
          label="Block off rows"
          checked={blockDisabledRows}
          onChange={setBlockDisabledRows}
          title="Off: a disabled row is only faded, and every gesture works on it as usual"
        />

        <TimeRangePicker engine={engine} />

        <div className="app__buttons">
          <button type="button" onClick={() => pan(-0.25)} title="Back a quarter of a screen">
            ◀
          </button>
          <button type="button" onClick={() => pan(0.25)} title="Forward a quarter of a screen">
            ▶
          </button>
          <button
            type="button"
            onClick={() => engine?.viewport.fitTime()}
            title="Zoom out to the whole time domain"
          >
            Fit X
          </button>
          <button
            type="button"
            onClick={fitRows}
            title={
              rowsFitted
                ? "Restore the row height this started at"
                : "Shrink rows until every one of them fits the plot"
            }
          >
            {rowsFitted ? "Reset Y" : "Fit Y"}
          </button>
          {/*
            Both recount: a bulk collapse changes the length of the y-axis list,
            and unlike a single toggle it emits no per-row event to follow.
          */}
          <button
            type="button"
            onClick={() => {
              engine?.collapseAll();
              countRows();
            }}
          >
            Collapse
          </button>
          <button
            type="button"
            onClick={() => {
              engine?.expandAll();
              countRows();
            }}
          >
            Expand
          </button>
          <button
            type="button"
            onClick={() => {
              engine?.enableAllRows();
              countRows();
            }}
            disabled={rowCounts.disabled === 0}
            title="Switch every disabled row back on"
          >
            Enable rows
          </button>
          <button type="button" onClick={undo} disabled={historyDepth.undo === 0}>
            Undo
          </button>
          <button type="button" onClick={redo} disabled={historyDepth.redo === 0}>
            Redo
          </button>
          <button
            type="button"
            onClick={() => void exportPng("viewport")}
            title="Save the visible chart as a PNG"
          >
            PNG
          </button>
          <button
            type="button"
            onClick={() => void exportPng("full")}
            title="Save every row and the whole time domain as one PNG"
          >
            PNG all
          </button>
        </div>
      </header>

      <div className="app__chart">
        <GanttChart<DemoTaskData, DemoGroupData>
          tasks={chartTasks}
          groups={groups}
          options={options}
          theme={dark ? "dark" : "light"}
          locale="en-GB"
          itemRenderer={itemRenderer}
          dependencies={showDependencies ? dataset.dependencies : undefined}
          onTasksChange={applyAndRecord}
          onDragEnd={describeDrop}
          onSelectionChange={setSelection}
          markers={showMarkers ? markers : undefined}
          onRowDisabledChange={countRows}
          onRowToggle={countRows}
          rowMenuItems={rowMenuItems}
          engineRef={setEngine}
          exportRef={exporter}
          headerCorner={<span>{rowCounts.total.toLocaleString()} rows</span>}
          enableSelection={enableSelection}
          enableMarqueeSelection={marqueeSelection}
          tooltipOpenDelay={tooltipDelay}
          showTimeZoomBar={true}
          showRowZoomBar={true}
          showScrollbar={false}
        />
      </div>

      <footer className="app__stats">
        {/* On the chart, then in the dataset — the two differ once "Rows" filters. */}
        <Stat
          label="tasks"
          value={
            chartTasks.length === tasks.length
              ? tasks.length.toLocaleString()
              : `${chartTasks.length.toLocaleString()} / ${tasks.length.toLocaleString()}`
          }
        />
        <Stat label="generated" value={`${dataset.generatedIn.toFixed(0)} ms`} />
        <Stat label="fps" value={String(stats.fps)} />
        <Stat label="bars drawn" value={stats.visibleItems.toLocaleString()} />
        <Stat label="candidates" value={stats.candidates.toLocaleString()} />
        <Stat label="rows drawn" value={String(stats.rows)} />
        <Stat label="selected" value={selection.length.toLocaleString()} />
        <Stat label="rows off" value={rowCounts.disabled.toLocaleString()} />
        {stats.truncated ? (
          <span className="app__warn">frame truncated by maxVisibleItems</span>
        ) : null}
        {lastDrop ? <span className="app__muted">drop: {lastDrop}</span> : null}
        {exportNote ? <span className="app__muted">{exportNote}</span> : null}
        <span className="app__hint">
          drag <em>selected</em> bars to move them · drag edges to resize · drag anything else to
          pan · ctrl+drag extends the selection · shift+drag marquees · wheel scrolls · ctrl+wheel
          zooms · right-click for menu · hover a row label for ⋯ and the power button · faded rows
          are disabled, and ignore input unless "Block off rows" is off
        </span>
      </footer>
    </div>
  );
}

/**
 * Zoom the x-axis from a pair of date inputs.
 *
 * Two directions to keep straight. Picking a date calls
 * `viewport.setTimeRange`, which is the only way to move the camera. Panning or
 * zooming by any other means — wheel, drag, the zoom bar, the toolbar buttons —
 * emits `viewport:change`, and the inputs follow it. Without that second half
 * the picker would drift out of step the moment anyone touched the chart.
 *
 * `setTimeRange` clamps to `minTimeSpan`/`maxTimeSpan` and to the data domain,
 * so a date outside the data snaps back and the input redraws with what was
 * actually applied — no validation needed here. Widen `options.timeDomain` to
 * allow picking past the end of the data.
 */
function TimeRangePicker({
  engine,
}: {
  engine: GanttEngine<DemoTaskData, DemoGroupData> | null;
}): JSX.Element {
  const [range, setRange] = useState({ start: "", end: "" });

  useEffect(() => {
    if (!engine) return;
    const sync = (viewport: ViewportState): void =>
      setRange({
        start: toDateInput(viewport.timeStart),
        // The window's end is exclusive: a view ending at midnight does not
        // show that day, so the input names the last day actually on screen.
        end: toDateInput(viewport.timeEnd - 1),
      });
    sync(engine.viewport.state);
    return engine.on("viewport:change", sync);
  }, [engine]);

  const apply = (next: { start: string; end: string }): void => {
    setRange(next);
    const from = fromDateInput(next.start);
    const to = fromDateInput(next.end);
    if (from === null || to === null || !engine) return;
    // Both ends inclusive: picking the same day twice frames that whole day.
    engine.viewport.setTimeRange(Math.min(from, to), Math.max(from, to) + DAY);
  };

  return (
    <label className="app__field" title="Zoom the time axis to a date range">
      Window
      <input
        type="date"
        value={range.start}
        onChange={(event) => apply({ ...range, start: event.target.value })}
      />
      <span className="app__muted">→</span>
      <input
        type="date"
        value={range.end}
        onChange={(event) => apply({ ...range, end: event.target.value })}
      />
    </label>
  );
}

/**
 * Epoch ms → the `yyyy-mm-dd` a date input wants, in *local* time.
 *
 * `toISOString` would be one line and wrong: it converts to UTC first, so
 * anywhere east of Greenwich the picker would show the previous day.
 */
function toDateInput(time: number): string {
  const date = new Date(time);
  const pad = (value: number): string => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** `yyyy-mm-dd` → local midnight, or null while the input is empty or partial. */
function fromDateInput(value: string): number | null {
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return null;
  // Deliberately not `new Date(value)`: that parses a bare date as UTC.
  const time = new Date(year, month - 1, day).getTime();
  return Number.isFinite(time) ? time : null;
}

/**
 * Owns only what the two views have to agree on.
 *
 * `dark` is lifted so switching views does not throw the theme away; everything
 * else each view keeps to itself, and unmounting a view disposes its engines
 * with it.
 */
export function App(): JSX.Element {
  const [view, setView] = useState<View>("playground");
  const [dark, setDark] = useState(true);

  const tabs = <ViewTabs view={view} onView={setView} />;
  const props = { dark, setDark, tabs };

  return view === "playground" ? <Playground {...props} /> : <LinkedCharts {...props} />;
}

const VIEWS: { value: View; label: string; title: string }[] = [
  { value: "playground", label: "Playground", title: "One chart, and every option it has" },
  {
    value: "linked",
    label: "Linked charts",
    title: "Three charts sharing one camera, zoom bars included",
  },
];

function ViewTabs({ view, onView }: { view: View; onView: (view: View) => void }): JSX.Element {
  return (
    <div className="app__tabs" role="tablist" aria-label="Demo">
      {VIEWS.map((entry) => (
        <button
          key={entry.value}
          type="button"
          role="tab"
          aria-selected={view === entry.value}
          className={`app__tab${view === entry.value ? " app__tab--on" : ""}`}
          title={entry.title}
          onClick={() => onView(entry.value)}
        >
          {entry.label}
        </button>
      ))}
    </div>
  );
}
