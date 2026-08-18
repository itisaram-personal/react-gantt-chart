import type { GanttEngine } from '../GanttEngine';
import type { Unsubscribe } from '../util/emitter';

/**
 * Locks several engines to one camera.
 *
 * Zoom bars are views of a viewport, not a state of their own — so linking the
 * bars of several charts is linking the viewports behind them, and every other
 * way of moving a chart (wheel, drag-pan, the time header, `fitTime`) comes
 * along for free.
 *
 * Nothing here is a leader: whichever engine moves is the source for that move,
 * and the rest follow. Followers are moved through the same `viewport` API a
 * gesture would use, so each still clamps to its own domain, its own
 * `min`/`maxTimeSpan` and its own content height — a chart is never pushed
 * somewhere it would refuse to go on its own.
 */

/*
 * Charts in one group routinely carry different task payloads, so the group is
 * typed by what it does rather than by what it holds.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyEngine = GanttEngine<any, any>;

/** Lane-height differences under this are not worth invalidating a layout for. */
const LANE_HEIGHT_EPSILON = 0.001;

/**
 * What moved, and therefore what is worth copying.
 *
 * `options:change` fires for every option an app touches — a snap size, a
 * tooltip delay — and only one of them, `metrics.laneHeight`, is part of a zoom
 * bar's window. Treating those as a camera move would let an unrelated
 * `setOptions` on one chart shove the group's time axis back to that chart's
 * window, undoing wherever another chart had clamped to.
 */
type Move = 'viewport' | 'options' | 'all';

export interface GanttSyncOptions {
  /**
   * Link the time axis — the horizontal zoom bar. Default true.
   *
   * Shared as an absolute time range, not as a position on the bar: charts with
   * different domains then show the same *dates*, which is the point of putting
   * them side by side, even though that sits at different offsets on each bar.
   */
  time?: boolean;
  /**
   * Link the row axis — the vertical zoom bar. Default true.
   *
   * Shared as `metrics.laneHeight` plus the scroll *fraction*, which is what the
   * vertical bar's window is made of. Rows therefore stay the same size across
   * the group, and every chart sits the same fraction of the way down its own
   * list — which is neither the same row number nor the same amount of list on
   * screen once the charts hold different numbers of rows. A short list may be
   * entirely visible while a long one shows a sliver of itself.
   */
  rows?: boolean;
  /**
   * Bring the group into step immediately, from the first engine. Default true.
   *
   * Off when the charts are already where they should be and the first one's
   * window is not the one to keep.
   */
  adopt?: boolean;
}

/**
 * Keep the viewports of two or more engines in step. Returns the teardown.
 *
 * ```ts
 * const stop = syncGanttViewports([left, middle, right]);
 * ```
 *
 * Engines may be added to or removed from a group only by tearing the group
 * down and syncing again — which is what the React hook does on a change of
 * membership.
 */
export function syncGanttViewports(
  engines: readonly AnyEngine[],
  options: GanttSyncOptions = {},
): Unsubscribe {
  const { time = true, rows = true, adopt = true } = options;
  const group = Array.from(new Set(engines));
  if (group.length < 2 || (!time && !rows)) return () => {};

  /*
   * Set while the group is being moved, and read on the way in.
   *
   * Following a move emits from every follower, and a clamped follower emits a
   * window that is not the one it was handed — without this that would be taken
   * for a fresh gesture and pushed back over the source. Every propagation is
   * synchronous, so a plain flag brackets it exactly.
   */
  let applying = false;

  const propagate = (source: AnyEngine, move: Move): void => {
    if (applying) return;
    applying = true;
    try {
      for (const target of group) {
        if (target === source) continue;
        if (time && move !== 'options') applyTime(target, source);
        if (rows) {
          // A rescale moves every row under the window, so the scroll that
          // follows it is not optional — hence no `else`.
          if (move !== 'viewport') applyLaneHeight(target, source);
          applyScroll(target, source);
        }
      }
    } finally {
      applying = false;
    }
  };

  const teardowns: Unsubscribe[] = [];
  for (const engine of group) {
    teardowns.push(engine.on('viewport:change', () => propagate(engine, 'viewport')));
    // Row zooming rescales lane heights, and a rescale that leaves `scrollTop`
    // at 0 moves no viewport at all — so the option is a second way in.
    if (rows) teardowns.push(engine.on('options:change', () => propagate(engine, 'options')));
  }

  if (adopt) propagate(group[0], 'all');

  return () => {
    for (const teardown of teardowns) teardown();
    teardowns.length = 0;
  };
}

function applyTime(target: AnyEngine, source: AnyEngine): void {
  const { timeStart, timeEnd } = source.viewport.state;
  if (timeEnd <= timeStart) return;
  target.viewport.setTimeRange(timeStart, timeEnd);
}

function applyLaneHeight(target: AnyEngine, source: AnyEngine): void {
  const laneHeight = source.getOptions().metrics.laneHeight;
  if (Math.abs(target.getOptions().metrics.laneHeight - laneHeight) > LANE_HEIGHT_EPSILON) {
    target.setOptions({ metrics: { laneHeight } });
  }
}

function applyScroll(target: AnyEngine, source: AnyEngine): void {
  const sourceHeight = source.totalHeight;
  if (sourceHeight <= 0) return;
  const fraction = source.viewport.state.scrollTop / sourceHeight;
  // `totalHeight` is re-read here, after any rescale above moved every row.
  target.viewport.scrollTo(fraction * target.totalHeight);
}
