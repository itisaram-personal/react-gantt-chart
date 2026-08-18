import { useMemo, useState, type ReactNode } from "react";
import { shallowEqual, type GanttEngine } from "@gantt-chart/core";
import { GanttChart, useEngineState, useGanttSync } from "@gantt-chart/react";
import { generate, type DemoGroupData, type DemoTaskData } from "./data";
import { Stat, Toggle } from "./controls";

/**
 * Three charts locked to one camera.
 *
 * The point of the view is what the three datasets do *not* have in common: a
 * different number of rows each, and three different time domains. The time axis
 * is shared as absolute dates, so the same week sits under the same column in
 * all three even though that is a different offset on each zoom bar; the row
 * axis is shared as lane height plus scroll fraction, so every chart sits the
 * same fraction of the way down its own list however long that list is.
 *
 * Nothing here reaches for a zoom bar. `useGanttSync` links the *viewports*, and
 * a zoom bar is a view of a viewport — so the bars come along with the wheel,
 * the drag-pan, the time header and the toolbar buttons below.
 */

const DAY = 86_400_000;
/** Midnight today, so every crew is generated against one calendar. */
const BASE = new Date(new Date().setHours(0, 0, 0, 0)).getTime();

interface Crew {
  id: string;
  label: string;
  hint: string;
  taskCount: number;
  tasksPerProject: number;
  seed: number;
  origin: number;
  timelineDays: number;
}

/*
 * Deliberately mismatched: 5, 34 and 68 rows, over calendars of roughly six
 * weeks, four months and eight months that overlap around today. (A project's tasks are laid
 * three days apart, so the calendar a crew spans is set by `tasksPerProject` as
 * much as by `timelineDays`.)
 *
 * Narrowest first, because the group adopts the first chart's window when it
 * forms: a window every chart can show means the demo opens in step. Zooming out
 * past Infra's six weeks is then the case worth watching — it clamps to its own
 * domain and stays there, and because a follower's own clamping is not taken for
 * a fresh gesture, it does not drag the other two back with it.
 */
export const CREWS: Crew[] = [
  {
    id: "infra",
    label: "Infra",
    hint: "5 rows, ~6 weeks",
    taskCount: 48,
    tasksPerProject: 12,
    seed: 42,
    origin: BASE - 45 * DAY,
    timelineDays: 20,
  },
  {
    id: "platform",
    label: "Platform",
    hint: "34 rows, ~4 months",
    taskCount: 600,
    tasksPerProject: 20,
    seed: 7,
    origin: BASE - 90 * DAY,
    timelineDays: 60,
  },
  {
    id: "mobile",
    label: "Mobile",
    hint: "68 rows, ~8 months",
    taskCount: 1_500,
    tasksPerProject: 25,
    seed: 21,
    origin: BASE - 150 * DAY,
    timelineDays: 180,
  },
];

type Engine = GanttEngine<DemoTaskData, DemoGroupData>;

/** Rows are rescaled across the group, so all three have to start equal. */
const START_LANE_HEIGHT = 22;
const OPTIONS = { metrics: { laneHeight: START_LANE_HEIGHT }, stacking: { maxLanes: 4 } };

export function LinkedCharts({
  dark,
  setDark,
  tabs,
  renderer = "canvas",
}: {
  dark: boolean;
  setDark: (dark: boolean) => void;
  tabs: ReactNode;
  /** Canvas in a browser; the suite mounts this with `svg`, as jsdom has no 2d context. */
  renderer?: "canvas" | "svg";
}): JSX.Element {
  const [linked, setLinked] = useState(true);
  const [time, setTime] = useState(true);
  const [rows, setRows] = useState(true);

  /*
   * State, not refs: `engineRef` is filled during commit, and a ref filled then
   * re-renders nothing — the hook would never see the charts arrive. A `useState`
   * setter is identity-stable, which is what `engineRef` wants.
   */
  const [infra, setInfra] = useState<Engine | null>(null);
  const [platform, setPlatform] = useState<Engine | null>(null);
  const [mobile, setMobile] = useState<Engine | null>(null);
  // In CREWS order: the first is the window the group adopts as it forms.
  const engines = [infra, platform, mobile];

  // Unlinking is a change of membership rather than an option: a group of none
  // has nothing to sync, and the hook is still called in the same order.
  useGanttSync(linked ? engines : [], { time, rows });

  const datasets = useMemo(
    () =>
      CREWS.map((crew) =>
        generate({
          taskCount: crew.taskCount,
          tasksPerProject: crew.tasksPerProject,
          seed: crew.seed,
          origin: crew.origin,
          timelineDays: crew.timelineDays,
          withDependencies: false,
        }),
      ),
    [],
  );

  const setters = [setInfra, setPlatform, setMobile];

  return (
    <div className={`app${dark ? " app--dark" : ""}`}>
      <header className="app__bar">
        <div className="app__title">
          <strong>Gantt</strong>
          <span className="app__muted">three charts, one camera</span>
        </div>

        {tabs}

        <Toggle
          label="Linked"
          checked={linked}
          onChange={setLinked}
          title="Lock all three viewports together, and with them both zoom bars"
        />
        <Toggle
          label="Time axis"
          checked={time}
          onChange={setTime}
          disabled={!linked}
          title="Share the visible date range"
        />
        <Toggle
          label="Row axis"
          checked={rows}
          onChange={setRows}
          disabled={!linked}
          title="Share row height and the scroll fraction"
        />
        <Toggle label="Dark" checked={dark} onChange={setDark} />

        <div className="app__buttons">
          {/*
            Each button moves a *different* chart, because there is no leader:
            whichever one is told to move is the source, and the group follows.
          */}
          <button
            type="button"
            onClick={() => platform?.viewport.setTimeRange(BASE - 14 * DAY, BASE)}
            title="Zoom the middle chart to a fortnight — a window inside every domain, so all three land on it exactly"
          >
            Last fortnight
          </button>
          <button
            type="button"
            onClick={() => mobile?.viewport.fitTime()}
            title="Zoom the bottom chart out to its whole calendar — wider than the other two can show, so each follows as far as its own domain allows and clamps there"
          >
            All of Mobile
          </button>
          <button
            type="button"
            // Every engine, not just one: linked the group would follow the
            // first, but this has to work with the link switched off too.
            onClick={() => {
              for (const engine of engines) {
                engine?.setOptions({ metrics: { laneHeight: START_LANE_HEIGHT } });
                engine?.viewport.scrollTo(0);
              }
            }}
            title="Back to the row height and scroll position this started at"
          >
            Reset rows
          </button>
        </div>

        <span className="app__hint">
          move any chart — wheel, drag, either zoom bar — and the other two follow
        </span>
      </header>

      <div className="app__linked">
        {CREWS.map((crew, index) => (
          <section key={crew.id} className="app__linked-chart">
            <div className="app__linked-caption">
              <strong>{crew.label}</strong>
              <span className="app__muted">{crew.hint}</span>
              {engines[index] ? <Window engine={engines[index]!} /> : null}
            </div>
            <div className="app__linked-plot">
              <GanttChart<DemoTaskData, DemoGroupData>
                tasks={datasets[index].tasks}
                groups={datasets[index].groups}
                options={OPTIONS}
                theme={dark ? "dark" : "light"}
                locale="en-GB"
                renderer={renderer}
                engineRef={setters[index]}
                showTimeZoomBar={true}
                showRowZoomBar={true}
                showScrollbar={false}
                headerCorner={<span>{crew.label}</span>}
              />
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

const DATE = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "2-digit" });

/**
 * What one chart is currently showing, on both axes.
 *
 * Its own component subscribed to its own engine: a readout held in the parent
 * would re-render all three charts on every frame of a pan, which is the cost
 * the engine's store exists to avoid.
 *
 * The row axis is printed as the *fraction scrolled past*, because a fraction is
 * what the vertical bar shares: charts of 5, 34 and 68 rows agree on how far
 * down their own list they are, never on a row number. How much of a list that
 * leaves on screen is each chart's own business — the short one fits entirely,
 * the long one shows a sliver — which is why the row count is printed beside it.
 */
function Window({ engine }: { engine: Engine }): JSX.Element {
  const { viewport } = useEngineState(
    engine,
    (state) => ({ viewport: state.viewport, layoutRevision: state.layoutRevision }),
    shallowEqual,
  );

  const total = engine.totalHeight;
  const top = total > 0 ? Math.round((viewport.scrollTop / total) * 100) : 0;

  return (
    <>
      <Stat
        label="dates"
        value={`${DATE.format(viewport.timeStart)} to ${DATE.format(viewport.timeEnd)}`}
      />
      <Stat label="rows" value={`from ${top}% of ${engine.getLayout().rows.length}`} />
    </>
  );
}
