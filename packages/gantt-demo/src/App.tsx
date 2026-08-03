import { useCallback, useEffect, useMemo, useState } from "react";
import {
  GanttHistory,
  type GanttEngine,
  type GanttId,
  type TaskChange,
} from "@gantt-chart/core";
import {
  defaultItemRenderer,
  type GanttItemRenderer,
} from "@gantt-chart/echarts";
import { GanttChart } from "@gantt-chart/react";
import "@gantt-chart/react/styles.css";
import {
  generate,
  statusColor,
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
const PER_ROW = [100, 200, 500, 1000, 2000];
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
  const [rollup, setRollup] = useState(true);
  const [snapMs, setSnapMs] = useState(0);
  const [showDependencies, setShowDependencies] = useState(true);
  const [colorByStatus, setColorByStatus] = useState(true);
  const [selection, setSelection] = useState<GanttId[]>([]);

  const dataset = useMemo(
    () => generate({ taskCount, tasksPerProject: tasksPerRow }),
    [taskCount, tasksPerRow],
  );
  const [tasks, setTasks] = useState<DemoTask[]>(dataset.tasks);
  useEffect(() => setTasks(dataset.tasks), [dataset]);

  /**
   * Frame roughly six weeks around today. The engine's own default is to fit the
   * whole domain, which here is 18 months — correct, but every bar would be a
   * sliver. "Fit" in the toolbar goes back to that view.
   */
  const [engine, setEngine] = useState<GanttEngine<
    DemoTaskData,
    DemoGroupData
  > | null>(null);
  useEffect(() => {
    if (!engine) return;
    const start = Date.now() - 7 * DAY;
    engine.viewport.setTimeRange(start, start + 45 * DAY);
  }, [engine, dataset]);

  const history = useMemo(() => new GanttHistory({ limit: 200 }), []);
  const [historyDepth, setHistoryDepth] = useState({ undo: 0, redo: 0 });
  const stats = useFrameStats(engine as GanttEngine<unknown, unknown> | null);

  const options = useMemo(
    () => ({
      stacking: { enabled: stacking, rollupCollapsed: rollup, maxLanes },
      interaction: { snapMs },
    }),
    [stacking, rollup, maxLanes, snapMs],
  );

  /** Colour by status instead of by group — the same hook a consumer would use. */
  const itemRenderer = useMemo<
    GanttItemRenderer<DemoTaskData, DemoGroupData> | undefined
  >(() => {
    if (!colorByStatus) return undefined;
    return (context) =>
      defaultItemRenderer({
        ...context,
        task: {
          ...context.task,
          data: {
            ...(context.task.data as DemoTaskData),
            color: statusColor(
              (context.task.data as DemoTaskData).status,
              context.theme.dark,
            ),
          },
        },
      });
  }, [colorByStatus]);

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

  return (
    <div className={`app${dark ? " app--dark" : ""}`}>
      <header className="app__bar">
        <div className="app__title">
          <strong>Gantt</strong>
          <span className="app__muted">
            ECharts custom series · virtualized engine
          </span>
        </div>

        <label className="app__field">
          Tasks
          <select
            value={taskCount}
            onChange={(event) => setTaskCount(Number(event.target.value))}
          >
            {SIZES.map((size) => (
              <option key={size} value={size}>
                {size.toLocaleString()}
              </option>
            ))}
          </select>
        </label>

        <label
          className="app__field"
          title="Tasks generated per row — how much there is to stack"
        >
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
          <select
            value={maxLanes}
            onChange={(event) => setMaxLanes(Number(event.target.value))}
          >
            {MAX_LANES.map((option) => (
              <option key={option.label} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className="app__field">
          Snap
          <select
            value={snapMs}
            onChange={(event) => setSnapMs(Number(event.target.value))}
          >
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
          label="Roll up"
          checked={rollup}
          onChange={setRollup}
          title="Show hidden children on their collapsed ancestor"
        />
        <Toggle
          label="Links"
          checked={showDependencies}
          onChange={setShowDependencies}
        />
        <Toggle
          label="Colour by status"
          checked={colorByStatus}
          onChange={setColorByStatus}
        />

        <div className="app__buttons">
          <button type="button" onClick={() => engine?.viewport.fitTime()}>
            Fit
          </button>
          <button type="button" onClick={() => engine?.collapseAll()}>
            Collapse
          </button>
          <button type="button" onClick={() => engine?.expandAll()}>
            Expand
          </button>
          <button
            type="button"
            onClick={undo}
            disabled={historyDepth.undo === 0}
          >
            Undo
          </button>
          <button
            type="button"
            onClick={redo}
            disabled={historyDepth.redo === 0}
          >
            Redo
          </button>
        </div>
      </header>

      <div className="app__chart">
        <GanttChart<DemoTaskData, DemoGroupData>
          tasks={tasks}
          groups={dataset.groups}
          options={options}
          theme={dark ? "dark" : "light"}
          locale="en-GB"
          itemRenderer={itemRenderer}
          dependencies={showDependencies ? dataset.dependencies : undefined}
          onTasksChange={applyAndRecord}
          onSelectionChange={setSelection}
          engineRef={setEngine}
          headerCorner={
            <span>{dataset.groups.length.toLocaleString()} rows</span>
          }
          showTimeZoomBar={true}
          showRowZoomBar={true}
          showScrollbar={false}
        />
      </div>

      <footer className="app__stats">
        <Stat label="tasks" value={tasks.length.toLocaleString()} />
        <Stat
          label="generated"
          value={`${dataset.generatedIn.toFixed(0)} ms`}
        />
        <Stat label="fps" value={String(stats.fps)} />
        <Stat label="bars drawn" value={stats.visibleItems.toLocaleString()} />
        <Stat label="candidates" value={stats.candidates.toLocaleString()} />
        <Stat label="rows drawn" value={String(stats.rows)} />
        <Stat label="selected" value={selection.length.toLocaleString()} />
        {stats.truncated ? (
          <span className="app__warn">frame truncated by maxVisibleItems</span>
        ) : null}
        <span className="app__hint">
          drag bars · drag edges to resize · marquee on empty space · wheel
          scrolls · ctrl+wheel zooms · right-click for menu
        </span>
      </footer>
    </div>
  );
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
