import { useEffect, useRef } from 'react';
import { syncGanttViewports, type GanttEngine, type GanttSyncOptions } from '@gantt-chart/core';

/*
 * Charts in one group routinely carry different task payloads — that is usually
 * the reason they are side by side — so the group is typed by what it does.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyEngine = GanttEngine<any, any>;

/**
 * Lock several charts to one camera: both zoom bars, and every other way of
 * moving a chart, stay in step across the group.
 *
 * Engines arrive from `<GanttChart engineRef={...}>`, and that has to be a
 * *state* setter rather than a ref object: a ref filled during commit re-renders
 * nothing, so the hook would never see the members arrive. `useState`'s setter
 * is identity-stable, which is what `engineRef` wants — an inline arrow would
 * re-run the chart's own effect on every render, handing the hook a null and the
 * engine back each time.
 *
 * ```tsx
 * const [top, setTop] = useState<GanttEngine | null>(null);
 * const [middle, setMiddle] = useState<GanttEngine | null>(null);
 * const [bottom, setBottom] = useState<GanttEngine | null>(null);
 *
 * useGanttSync([top, middle, bottom]);
 *
 * return (
 *   <>
 *     <GanttChart tasks={a} engineRef={setTop} showTimeZoomBar showRowZoomBar />
 *     <GanttChart tasks={b} engineRef={setMiddle} showTimeZoomBar showRowZoomBar />
 *     <GanttChart tasks={c} engineRef={setBottom} showTimeZoomBar showRowZoomBar />
 *   </>
 * );
 * ```
 *
 * Nulls are expected and skipped, so the group works from the first mounted
 * chart and syncs the rest as they arrive; a group of fewer than two is a no-op.
 * Charts do not have to hold the same tasks, the same number of rows, or even
 * the same time domain — see {@link GanttSyncOptions} for what each axis shares.
 */
export function useGanttSync(
  engines: readonly (AnyEngine | null | undefined)[],
  options: GanttSyncOptions = {},
): void {
  const { time = true, rows = true, adopt = true } = options;

  /*
   * Callers pass an array literal, so the list is a fresh object every render
   * and cannot be an effect dependency as it stands. Membership is compared by
   * identity instead and the previous array kept when it has not changed, which
   * gives the effect something stable to depend on — a group is torn down and
   * re-synced when a chart mounts or unmounts, and not for a re-render.
   *
   * Writing the ref during render is safe here because the write is idempotent:
   * a double-render under StrictMode arrives at the same array.
   */
  const members = useRef<AnyEngine[]>([]);
  const live = engines.filter((engine): engine is AnyEngine => !!engine);
  if (
    live.length !== members.current.length ||
    live.some((engine, index) => engine !== members.current[index])
  ) {
    members.current = live;
  }
  const group = members.current;

  useEffect(
    () => syncGanttViewports(group, { time, rows, adopt }),
    [group, time, rows, adopt],
  );
}
