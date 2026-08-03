import { useMemo, useRef, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { clamp, shallowEqual, type GanttEngine, type GanttTheme } from '@gantt-chart/core';
import { useEngineState } from './useEngineState';

/**
 * Zoom bars for both axes.
 *
 * These are ECharts-`dataZoom`-shaped controls built as ordinary DOM, for the
 * same reason the scrollbar is: the engine is the only thing allowed to move the
 * camera, so a real `dataZoom` component would be a second owner of pan/zoom and
 * the two would fight. Everything here reads the viewport and writes back
 * through `viewport.setTimeRange` / `viewport.scrollTo` / `setOptions`.
 *
 * Both bars share {@link ZoomBar}, which owns the track/window/handle DOM and
 * the pointer maths in *fractions of the track*. Each axis then only has to say
 * what a fraction means.
 */

/** Which part of the window a drag grabbed. */
type Grip = 'start' | 'end' | 'body';

/** Smallest window a handle drag may leave, so it never collapses to nothing. */
const MIN_WINDOW_PX = 16;

interface ZoomBarProps {
  orientation: 'horizontal' | 'vertical';
  /** Window edges as fractions of the track, 0..1. */
  from: number;
  to: number;
  /** Height of a horizontal bar, width of a vertical one. */
  thickness: number;
  theme: GanttTheme;
  label: string;
  /** Overview painted behind the window. Must not take pointer events. */
  children?: ReactNode;
  onGripDown?: (grip: Grip) => void;
  /**
   * Next window, in fractions. Always computed from the window as it was when
   * the drag started, never from the live props — otherwise re-rendering
   * mid-drag would feed the previous result back in and the window would drift.
   */
  onWindow: (from: number, to: number, grip: Grip) => void;
}

function ZoomBar({
  orientation,
  from,
  to,
  thickness,
  theme,
  label,
  children,
  onGripDown,
  onWindow,
}: ZoomBarProps): JSX.Element {
  const horizontal = orientation === 'horizontal';
  const trackRef = useRef<HTMLDivElement | null>(null);
  const drag = useRef<{ grip: Grip; pointer: number; track: number; from: number; to: number } | null>(null);

  const axis = (event: { clientX: number; clientY: number }): number =>
    horizontal ? event.clientX : event.clientY;

  const begin =
    (grip: Grip) =>
    (event: ReactPointerEvent<HTMLElement>): void => {
      const track = trackRef.current;
      if (!track) return;
      // The track's own handler pages the window; a grip drag must not also.
      event.preventDefault();
      event.stopPropagation();
      event.currentTarget.setPointerCapture(event.pointerId);
      const rect = track.getBoundingClientRect();
      drag.current = {
        grip,
        pointer: axis(event),
        track: Math.max(1, horizontal ? rect.width : rect.height),
        from,
        to,
      };
      onGripDown?.(grip);
    };

  const move = (event: ReactPointerEvent<HTMLElement>): void => {
    const origin = drag.current;
    if (!origin) return;
    const delta = (axis(event) - origin.pointer) / origin.track;
    const min = MIN_WINDOW_PX / origin.track;

    if (origin.grip === 'body') {
      const width = origin.to - origin.from;
      const start = clamp(origin.from + delta, 0, Math.max(0, 1 - width));
      onWindow(start, start + width, 'body');
    } else if (origin.grip === 'start') {
      onWindow(clamp(origin.from + delta, 0, Math.max(0, origin.to - min)), origin.to, 'start');
    } else {
      onWindow(origin.from, clamp(origin.to + delta, Math.min(1, origin.from + min), 1), 'end');
    }
  };

  const finish = (event: ReactPointerEvent<HTMLElement>): void => {
    if (!drag.current) return;
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const span = Math.max(0, to - from);
  const windowStyle = horizontal
    ? { left: `${from * 100}%`, width: `${span * 100}%` }
    : { top: `${from * 100}%`, height: `${span * 100}%` };

  return (
    <div
      ref={trackRef}
      className={`gantt-zoom gantt-zoom--${orientation}`}
      style={{
        [horizontal ? 'height' : 'width']: thickness,
        background: theme.colors.scrollbarTrack,
        borderColor: theme.colors.border,
      }}
      onPointerDown={(event) => {
        // A click on bare track centres the window on the pointer.
        if (drag.current) return;
        const rect = event.currentTarget.getBoundingClientRect();
        const length = Math.max(1, horizontal ? rect.width : rect.height);
        const at = (axis(event) - (horizontal ? rect.left : rect.top)) / length;
        const start = clamp(at - span / 2, 0, Math.max(0, 1 - span));
        onWindow(start, start + span, 'body');
      }}
    >
      {children ? <div className="gantt-zoom__overview">{children}</div> : null}

      <div
        className="gantt-zoom__window"
        style={{ ...windowStyle, background: theme.colors.scrollbarThumb, borderColor: theme.colors.accent }}
        role="slider"
        aria-label={label}
        aria-orientation={horizontal ? 'horizontal' : 'vertical'}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(from * 100)}
        tabIndex={-1}
        onPointerDown={begin('body')}
        onPointerMove={move}
        onPointerUp={finish}
        onPointerCancel={finish}
      >
        <div
          className="gantt-zoom__handle gantt-zoom__handle--start"
          style={{ background: theme.colors.accent }}
          onPointerDown={begin('start')}
          onPointerMove={move}
          onPointerUp={finish}
          onPointerCancel={finish}
        />
        <div
          className="gantt-zoom__handle gantt-zoom__handle--end"
          style={{ background: theme.colors.accent }}
          onPointerDown={begin('end')}
          onPointerMove={move}
          onPointerUp={finish}
          onPointerCancel={finish}
        />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ x axis */

export interface GanttTimeZoomBarProps<T, G> {
  engine: GanttEngine<T, G>;
  theme: GanttTheme;
  /** Bar height in px. */
  height?: number;
  /** Draw a task-density histogram behind the window. */
  overview?: boolean;
}

/** How many buckets the density overview is summarised into. */
const DENSITY_BUCKETS = 240;

/**
 * Horizontal zoom bar over the whole time domain.
 *
 * The window is the visible time range, so dragging its body pans and dragging
 * a handle zooms. `setTimeRange` already clamps to the domain and to
 * `min`/`maxTimeSpan`, so nothing here needs to re-check those bounds.
 */
export function GanttTimeZoomBar<T, G>({
  engine,
  theme,
  height = 26,
  overview = true,
}: GanttTimeZoomBarProps<T, G>): JSX.Element | null {
  const { viewport, dataRevision } = useEngineState(
    engine,
    (state) => ({ viewport: state.viewport, dataRevision: state.dataRevision }),
    shallowEqual,
  );

  const [domainStart, domainEnd] = engine.getDomain();
  const domainSpan = domainEnd - domainStart;

  const density = useMemo(
    () => (overview ? timeDensity(engine) : null),
    // Recomputed only when the dataset itself changes, not on pan or zoom.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [engine, overview, dataRevision],
  );

  if (domainSpan <= 0) return null;

  const fraction = (time: number): number => clamp((time - domainStart) / domainSpan, 0, 1);

  return (
    <ZoomBar
      orientation="horizontal"
      from={fraction(viewport.timeStart)}
      to={fraction(viewport.timeEnd)}
      thickness={height}
      theme={theme}
      label="Time range"
      onWindow={(from, to) => {
        engine.viewport.setTimeRange(domainStart + from * domainSpan, domainStart + to * domainSpan);
      }}
    >
      {density ? (
        <div className="gantt-zoom__density">
          {Array.from(density, (value, index) => (
            <span
              key={index}
              className="gantt-zoom__density-bar"
              style={{ height: `${Math.max(value * 100, value > 0 ? 4 : 0)}%`, background: theme.colors.gridLineStrong }}
            />
          ))}
        </div>
      ) : null}
    </ZoomBar>
  );
}

/**
 * Task starts per bucket across the domain, normalised to 0..1.
 *
 * Bucketed by start alone rather than by covered span: this is a legibility aid
 * at 240px wide, and an O(n) pass keeps it affordable at 250K tasks.
 */
function timeDensity<T, G>(engine: GanttEngine<T, G>): Float64Array {
  const buckets = new Float64Array(DENSITY_BUCKETS);
  const [start, end] = engine.getDomain();
  const span = end - start;
  if (span <= 0) return buckets;

  const starts = engine.getDataModel().starts;
  for (let i = 0; i < starts.length; i++) {
    const bucket = Math.floor(((starts[i] - start) / span) * DENSITY_BUCKETS);
    if (bucket >= 0 && bucket < DENSITY_BUCKETS) buckets[bucket]++;
  }

  let peak = 0;
  for (let i = 0; i < DENSITY_BUCKETS; i++) if (buckets[i] > peak) peak = buckets[i];
  if (peak > 0) for (let i = 0; i < DENSITY_BUCKETS; i++) buckets[i] /= peak;
  return buckets;
}

/* ------------------------------------------------------------------ y axis */

export interface GanttRowZoomBarProps<T, G> {
  engine: GanttEngine<T, G>;
  theme: GanttTheme;
  /** Bar width in px. */
  width?: number;
  minLaneHeight?: number;
  maxLaneHeight?: number;
}

/**
 * Vertical zoom bar over the rows.
 *
 * Dragging the body scrolls. Dragging a handle is a genuine vertical zoom: the
 * window says how much content should be on screen, and `metrics.laneHeight` is
 * rescaled so exactly that much fills the plot — so rows get taller as the
 * window narrows.
 *
 * The window is tracked as a *fraction* of total content height rather than a
 * pixel offset. Rescaling lane heights changes `totalHeight`, so a pixel anchor
 * would slide out from under the drag; a fraction is very nearly invariant under
 * the rescale, which keeps the grabbed edge under the pointer.
 */
export function GanttRowZoomBar<T, G>({
  engine,
  theme,
  width = 14,
  minLaneHeight = 6,
  maxLaneHeight = 120,
}: GanttRowZoomBarProps<T, G>): JSX.Element | null {
  const { viewport } = useEngineState(
    engine,
    (state) => ({ viewport: state.viewport, layoutRevision: state.layoutRevision }),
    shallowEqual,
  );

  // Captured on grip-down: the maths must not chase its own output.
  const origin = useRef<{ laneHeight: number; totalHeight: number } | null>(null);
  const totalHeight = engine.totalHeight;

  if (totalHeight <= 0 || viewport.height <= 0) return null;

  const from = clamp(viewport.scrollTop / totalHeight, 0, 1);
  const to = clamp((viewport.scrollTop + viewport.height) / totalHeight, from, 1);

  return (
    <ZoomBar
      orientation="vertical"
      from={from}
      to={to}
      thickness={width}
      theme={theme}
      label="Row range"
      onGripDown={() => {
        origin.current = { laneHeight: engine.getOptions().metrics.laneHeight, totalHeight };
      }}
      onWindow={(nextFrom, nextTo, grip) => {
        if (grip !== 'body') {
          const base = origin.current ?? { laneHeight: engine.getOptions().metrics.laneHeight, totalHeight };
          // Content the window covers, measured at the scale the drag began at.
          const covered = Math.max(1, (nextTo - nextFrom) * base.totalHeight);
          const laneHeight = clamp(
            (base.laneHeight * viewport.height) / covered,
            minLaneHeight,
            maxLaneHeight,
          );
          // Rounded so a pixel-sized wobble does not churn the layout cache.
          engine.setOptions({ metrics: { laneHeight: Math.round(laneHeight * 10) / 10 } });
        }
        // Re-read: the rescale above moved every row.
        engine.viewport.scrollTo(nextFrom * engine.totalHeight);
      }}
    />
  );
}
