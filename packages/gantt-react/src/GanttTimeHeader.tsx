import type { MouseEvent as ReactMouseEvent } from 'react';
import type { GanttEngine, GanttTheme } from '@gantt-chart/core';
import { computeTimeHeader, labelZoomAction, labelZoomRung } from '@gantt-chart/echarts';
import { shallowEqual } from '@gantt-chart/core';
import { useEngineState } from './useEngineState';

export interface GanttTimeHeaderProps<T, G> {
  engine: GanttEngine<T, G>;
  theme: GanttTheme;
  locale?: string;
  weekStartsOn?: 0 | 1;
  /**
   * Clicking a label zooms to the period it names; ctrl/cmd-click zooms out
   * again. On by default. Pass `false` for a header that is purely a scale.
   */
  interactiveLabels?: boolean;
}

/** Labels narrower than this have nowhere to sit without colliding. */
const MIN_BAND_LABEL_WIDTH = 44;

/**
 * The two-tier time header.
 *
 * Ticks come from the same pure function the canvas grid uses, so the labels and
 * the grid lines cannot drift apart. It is real DOM rather than chart axis
 * labels, which makes it selectable, styleable and scrollable with the rest of
 * the page — and, when `interactiveLabels` is on, focusable and clickable.
 */
export function GanttTimeHeader<T, G>({
  engine,
  theme,
  locale,
  weekStartsOn,
  interactiveLabels = true,
}: GanttTimeHeaderProps<T, G>): JSX.Element {
  const viewport = useEngineState(engine, (state) => state.viewport, shallowEqual);
  const { scale, bands } = computeTimeHeader({
    timeStart: viewport.timeStart,
    timeEnd: viewport.timeEnd,
    width: viewport.width,
    locale,
    weekStartsOn,
  });

  /**
   * Apply a label click.
   *
   * The engine stays the only thing that moves the camera: this resolves the
   * gesture to a range and hands it over, leaving domain and min/max-span
   * clamping where it already lives.
   */
  const zoom = (time: number, event: ReactMouseEvent): void => {
    const action = labelZoomAction({
      timeStart: viewport.timeStart,
      timeEnd: viewport.timeEnd,
      time,
      // Cmd on macOS, ctrl elsewhere — the same pair the plot's wheel uses.
      direction: event.ctrlKey || event.metaKey ? 'out' : 'in',
      weekStartsOn,
    });
    if (!action) return;
    if (action.kind === 'fit') engine.viewport.fitTime();
    else engine.viewport.setTimeRange(action.start, action.end);
  };

  // Named in the tooltip so the gesture is discoverable rather than a secret.
  const rung = labelZoomRung(viewport.timeEnd - viewport.timeStart);
  const hint = (label: string): string =>
    interactiveLabels ? `${label} — click to zoom to ${rung}, ctrl-click to zoom out` : label;

  return (
    <div className="gantt-header" style={{ height: theme.metrics.headerHeight }}>
      <div className="gantt-header__bands">
        {bands.map((band) =>
          interactiveLabels ? (
            <button
              key={band.time}
              type="button"
              className="gantt-header__band is-interactive"
              style={{ left: band.x, width: band.width }}
              title={hint(band.label)}
              onClick={(event) => zoom(band.time, event)}
            >
              {band.width >= MIN_BAND_LABEL_WIDTH ? <span>{band.label}</span> : null}
            </button>
          ) : (
            <div
              key={band.time}
              className="gantt-header__band"
              style={{ left: band.x, width: band.width }}
              title={band.label}
            >
              {band.width >= MIN_BAND_LABEL_WIDTH ? <span>{band.label}</span> : null}
            </div>
          ),
        )}
      </div>
      <div className="gantt-header__ticks">
        {scale.ticks.map((tick) =>
          interactiveLabels ? (
            <button
              key={tick.time}
              type="button"
              className={`gantt-header__tick is-interactive${tick.major ? ' is-major' : ''}`}
              style={{ left: tick.x }}
              title={hint(tick.label)}
              onClick={(event) => zoom(tick.time, event)}
            >
              {tick.label}
            </button>
          ) : (
            <div
              key={tick.time}
              className={`gantt-header__tick${tick.major ? ' is-major' : ''}`}
              style={{ left: tick.x }}
            >
              {tick.label}
            </div>
          ),
        )}
      </div>
    </div>
  );
}
