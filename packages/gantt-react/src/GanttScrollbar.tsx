import { useRef } from 'react';
import { shallowEqual, type GanttEngine, type GanttTheme } from '@gantt-chart/core';
import { useEngineState } from './useEngineState';

export interface GanttScrollbarProps<T, G> {
  engine: GanttEngine<T, G>;
  theme: GanttTheme;
  width?: number;
}

const MIN_THUMB_PX = 24;

/**
 * Vertical scrollbar for the plot.
 *
 * The plot is a canvas with no scrollable overflow, so the scrollbar is drawn
 * from the engine's own scroll state rather than delegated to the browser. That
 * keeps one source of truth: wheel, keyboard, drag-to-pan and this thumb all
 * write through `viewport.scrollTo`.
 */
export function GanttScrollbar<T, G>({ engine, theme, width = 10 }: GanttScrollbarProps<T, G>): JSX.Element | null {
  const { viewport } = useEngineState(
    engine,
    (state) => ({ viewport: state.viewport, layoutRevision: state.layoutRevision }),
    shallowEqual,
  );

  const totalHeight = engine.totalHeight;
  const trackHeight = viewport.height;
  const dragOrigin = useRef<{ y: number; scrollTop: number } | null>(null);

  if (totalHeight <= trackHeight || trackHeight <= 0) return null;

  const thumbHeight = Math.max(MIN_THUMB_PX, (trackHeight / totalHeight) * trackHeight);
  const maxScroll = totalHeight - trackHeight;
  const maxThumbTop = trackHeight - thumbHeight;
  const thumbTop = maxScroll > 0 ? (viewport.scrollTop / maxScroll) * maxThumbTop : 0;

  return (
    <div
      className="gantt-scrollbar"
      style={{ width, background: theme.colors.scrollbarTrack }}
      onPointerDown={(event) => {
        // A click on the track pages towards the pointer.
        if (event.target !== event.currentTarget) return;
        const offset = event.clientY - event.currentTarget.getBoundingClientRect().top;
        engine.viewport.scrollBy(offset < thumbTop ? -trackHeight * 0.9 : trackHeight * 0.9);
      }}
    >
      <div
        className="gantt-scrollbar__thumb"
        style={{ top: thumbTop, height: thumbHeight, background: theme.colors.scrollbarThumb }}
        role="scrollbar"
        aria-orientation="vertical"
        aria-valuenow={Math.round(viewport.scrollTop)}
        aria-valuemin={0}
        aria-valuemax={Math.round(maxScroll)}
        tabIndex={-1}
        onPointerDown={(event) => {
          event.preventDefault();
          event.currentTarget.setPointerCapture(event.pointerId);
          dragOrigin.current = { y: event.clientY, scrollTop: viewport.scrollTop };
        }}
        onPointerMove={(event) => {
          const origin = dragOrigin.current;
          if (!origin || maxThumbTop <= 0) return;
          const delta = event.clientY - origin.y;
          engine.viewport.scrollTo(origin.scrollTop + (delta / maxThumbTop) * maxScroll);
        }}
        onPointerUp={(event) => {
          dragOrigin.current = null;
          event.currentTarget.releasePointerCapture(event.pointerId);
        }}
        onPointerCancel={() => {
          dragOrigin.current = null;
        }}
      />
    </div>
  );
}
