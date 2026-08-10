import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  GanttHistory,
  type GanttEngine,
  type GanttId,
  type GanttRow,
  type TaskChange,
  type GanttEngineOptions,
  type DeepPartial,
  type ViewportState,
} from "@gantt-chart/core";
import { defaultItemRenderer, type GanttItemRenderer } from "@gantt-chart/echarts";
import {
  GanttChart,
  type GanttDragEndEvent,
  type GanttExportApi,
  type GanttExportScope,
} from "@gantt-chart/react";
import "@gantt-chart/react/styles.css";
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

export function App(): JSX.Element {
  const [taskCount, setTaskCount] = useState(10_000);
  const [tasksPerRow, setTasksPerRow] = useState(100);
  const [maxLanes, setMaxLanes] = useState(64);
  const [dark, setDark] = useState(true);
  const [stacking, setStacking] = useState(true);
  const [uniformRows, setUniformRows] = useState(true);
  const [rollup, setRollup] = useState(true);
  const [snapMs, setSnapMs] = useState(0);
  const [showDependencies, setShowDependencies] = useState(true);
  const [colorByStatus, setColorByStatus] = useState(true);
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
   * One flat row per distinct `task.groupId` — not the generator's group list,
   * which still carries the unused team/project tree.
   *
   * The engine would synthesize exactly this list on its own if `groups` were
   * omitted; it is spelled out here only so every {@link DISABLE_EVERY}th row
   * can carry `disabled: true`. Such a row keeps its bars — faded, still
   * exported, still hit by "Fit" and the zoom bars — but ignores every
   * interaction with them: no hover, click, marquee, drag, or drop onto it.
   *
   * The flag only *seeds* the state, and only for groups the engine has not
   * seen before, so the gutter's power button and "Enable rows" below win from
   * then on and survive an edit to the tasks.
   *
   * Built from `dataset.tasks` rather than `tasks`: rows come and go with the
   * dataset, not with an edit, and rebuilding this over 250 000 tasks on every
   * drag would be the most expensive thing in the app.
   */
  const groups = useMemo<DemoGroup[]>(() => {
    const seen = new Set<GanttId>();
    const list: DemoGroup[] = [];
    for (const task of dataset.tasks) {
      if (seen.has(task.groupId)) continue;
      seen.add(task.groupId);
      list.push({
        id: task.groupId,
        label: String(task.groupId),
        disabled: list.length % DISABLE_EVERY === DISABLE_EVERY - 1,
        data: { kind: "project" },
      });
    }
    return list;
  }, [dataset]);

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
   * How many rows are off right now: the seeded ones, plus every toggle from
   * the gutter's power button or the right-click menu since.
   *
   * Counted from the rows rather than accumulated. `onRowDisabledChange` fires
   * once per row a *user* toggles — never for the seed, and not for
   * `enableAllRows` either, which clears the lot in one go — so a running total
   * would start wrong and drift.
   */
  const [disabledRows, setDisabledRows] = useState(0);
  const countDisabledRows = useCallback(() => {
    if (!engine) return;
    let count = 0;
    for (const row of engine.getLayout().rows) if (row.disabled) count++;
    setDisabledRows(count);
  }, [engine]);
  useEffect(() => {
    countDisabledRows();
  }, [countDisabledRows, groups]);

  const options: DeepPartial<GanttEngineOptions> = useMemo(
    () => ({
      metrics: { uniformRowHeight: uniformRows },
      stacking: { enabled: stacking, rollupCollapsed: rollup, maxLanes },
      interaction: {
        snapMs,
        backgroundDrag: { alt: "pan", plain: "pan", ctrl: "marquee", shift: "marquee" },
      },
    }),
    [stacking, uniformRows, rollup, maxLanes, snapMs],
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

  const applyAndRecord = useCallback(
    (next: DemoTask[], changes: TaskChange[]) => {
      setTasks(next);
      history.push(changes, "move");
      setHistoryDepth({ undo: history.depth, redo: 0 });
    },
    [history],
  );

  const undo = useCallback(() => {
    const entry = history.undo();
    if (!entry || !engine) return;
    setTasks(engine.applyChanges(entry.changes) as DemoTask[]);
    setHistoryDepth({ undo: history.depth, redo: 1 });
  }, [engine, history]);

  const redo = useCallback(() => {
    const entry = history.redo();
    if (!entry || !engine) return;
    setTasks(engine.applyChanges(entry.changes) as DemoTask[]);
    setHistoryDepth({ undo: history.depth, redo: 0 });
  }, [engine, history]);

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
          <button type="button" onClick={() => engine?.collapseAll()}>
            Collapse
          </button>
          <button type="button" onClick={() => engine?.expandAll()}>
            Expand
          </button>
          <button
            type="button"
            onClick={() => {
              engine?.enableAllRows();
              countDisabledRows();
            }}
            disabled={disabledRows === 0}
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
          tasks={tasks}
          groups={groups}
          options={options}
          theme={dark ? "dark" : "light"}
          locale="en-GB"
          itemRenderer={itemRenderer}
          dependencies={showDependencies ? dataset.dependencies : undefined}
          onTasksChange={applyAndRecord}
          onDragEnd={describeDrop}
          onSelectionChange={setSelection}
          onRowDisabledChange={countDisabledRows}
          rowMenuItems={rowMenuItems}
          engineRef={setEngine}
          exportRef={exporter}
          headerCorner={<span>{groups.length.toLocaleString()} rows</span>}
          showTimeZoomBar={true}
          showRowZoomBar={true}
          showScrollbar={false}
        />
      </div>

      <footer className="app__stats">
        <Stat label="tasks" value={tasks.length.toLocaleString()} />
        <Stat label="generated" value={`${dataset.generatedIn.toFixed(0)} ms`} />
        <Stat label="fps" value={String(stats.fps)} />
        <Stat label="bars drawn" value={stats.visibleItems.toLocaleString()} />
        <Stat label="candidates" value={stats.candidates.toLocaleString()} />
        <Stat label="rows drawn" value={String(stats.rows)} />
        <Stat label="selected" value={selection.length.toLocaleString()} />
        <Stat label="rows off" value={disabledRows.toLocaleString()} />
        {stats.truncated ? (
          <span className="app__warn">frame truncated by maxVisibleItems</span>
        ) : null}
        {lastDrop ? <span className="app__muted">drop: {lastDrop}</span> : null}
        {exportNote ? <span className="app__muted">{exportNote}</span> : null}
        <span className="app__hint">
          drag bars · drag edges to resize · drag empty space to pan · shift+drag marquees · wheel
          scrolls · ctrl+wheel zooms · right-click for menu · hover a row label for ⋯ and the power
          button · faded rows are disabled and ignore input
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

function Toggle({
  label,
  checked,
  onChange,
  title,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  title?: string;
}): JSX.Element {
  return (
    <label className="app__toggle" title={title}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      {label}
    </label>
  );
}

function Stat({ label, value }: { label: string; value: string }): JSX.Element {
  return (
    <span className="app__stat">
      <span className="app__muted">{label}</span>
      <strong>{value}</strong>
    </span>
  );
}
