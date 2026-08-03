import type { GanttEngine, GanttTheme } from '@gantt-chart/core';
import { computeTimeHeader } from '@gantt-chart/echarts';
import { shallowEqual } from '@gantt-chart/core';
import { useEngineState } from './useEngineState';

export interface GanttTimeHeaderProps<T, G> {
  engine: GanttEngine<T, G>;
  theme: GanttTheme;
  locale?: string;
  weekStartsOn?: 0 | 1;
}

/** Labels narrower than this have nowhere to sit without colliding. */
const MIN_BAND_LABEL_WIDTH = 44;

/**
 * The two-tier time header.
 *
 * Ticks come from the same pure function the canvas grid uses, so the labels and
 * the grid lines cannot drift apart. It is real DOM rather than chart axis
 * labels, which makes it selectable, styleable and scrollable with the rest of
 * the page.
 */
export function GanttTimeHeader<T, G>({
  engine,
  theme,
  locale,
  weekStartsOn,
}: GanttTimeHeaderProps<T, G>): JSX.Element {
  const viewport = useEngineState(engine, (state) => state.viewport, shallowEqual);
  const { scale, bands } = computeTimeHeader({
    timeStart: viewport.timeStart,
    timeEnd: viewport.timeEnd,
    width: viewport.width,
    locale,
    weekStartsOn,
  });

  return (
    <div className="gantt-header" style={{ height: theme.metrics.headerHeight }}>
      <div className="gantt-header__bands">
        {bands.map((band) => (
          <div
            key={band.time}
            className="gantt-header__band"
            style={{ left: band.x, width: band.width }}
            title={band.label}
          >
            {band.width >= MIN_BAND_LABEL_WIDTH ? <span>{band.label}</span> : null}
          </div>
        ))}
      </div>
      <div className="gantt-header__ticks">
        {scale.ticks.map((tick) => (
          <div
            key={tick.time}
            className={`gantt-header__tick${tick.major ? ' is-major' : ''}`}
            style={{ left: tick.x }}
          >
            {tick.label}
          </div>
        ))}
      </div>
    </div>
  );
}
