import type { ReactNode } from 'react';
import { shallowEqual, type GanttEngine, type GanttTask, type GanttTheme } from '@gantt-chart/core';
import { useEngineState } from './useEngineState';

export interface GanttTooltipContext<T, G> {
  task: GanttTask<T>;
  engine: GanttEngine<T, G>;
  locale?: string;
}

export interface GanttTooltipProps<T, G> {
  engine: GanttEngine<T, G>;
  theme: GanttTheme;
  locale?: string;
  /** Return `null` to suppress the tooltip for a task. */
  render?: (context: GanttTooltipContext<T, G>) => ReactNode | null;
  /** Offset from the bar, px. */
  offset?: number;
}

/**
 * Hover tooltip, positioned from the engine's own geometry.
 *
 * Nothing is rendered while nothing is hovered, so the common case costs one
 * subscription and no DOM.
 */
export function GanttTooltip<T, G>({
  engine,
  theme,
  locale,
  render,
  offset = 12,
}: GanttTooltipProps<T, G>): JSX.Element | null {
  const { hoveredTaskId, dragging } = useEngineState(
    engine,
    (state) => ({
      hoveredTaskId: state.hoveredTaskId,
      // A tooltip following a dragged bar is noise.
      dragging: state.drag !== null && state.drag.active,
      viewport: state.viewport,
    }),
    shallowEqual,
  );

  if (hoveredTaskId === null || dragging) return null;

  const task = engine.getTask(hoveredTaskId);
  if (!task) return null;
  const rect = engine.getTaskRect(hoveredTaskId);
  if (!rect) return null;

  const content = render ? render({ task, engine, locale }) : defaultContent(task, locale);
  if (content === null || content === undefined) return null;

  const viewport = engine.viewport.state;
  // Flip to the left of the bar when there is no room on the right.
  const preferredLeft = rect.x + rect.width + offset;
  const flip = preferredLeft > viewport.width * 0.75;

  return (
    <div
      className="gantt-tooltip"
      role="tooltip"
      style={{
        left: flip ? undefined : preferredLeft,
        right: flip ? Math.max(0, viewport.width - rect.x + offset) : undefined,
        top: Math.max(0, Math.min(rect.y - 4, viewport.height - 60)),
        background: theme.dark ? theme.colors.rowOdd : theme.colors.background,
        color: theme.colors.text,
        borderColor: theme.colors.border,
        font: `${theme.font.size}px ${theme.font.family}`,
      }}
    >
      {content}
    </div>
  );
}

function defaultContent(task: GanttTask<unknown>, locale?: string): ReactNode {
  const meta = (task.data ?? {}) as { label?: string; name?: string; progress?: number };
  const label = meta.label ?? meta.name ?? String(task.id);
  const milestone = task.start === task.end;

  return (
    <>
      <div className="gantt-tooltip__title">{label}</div>
      <div className="gantt-tooltip__row">
        {milestone
          ? formatInstant(task.start, locale)
          : `${formatInstant(task.start, locale)} → ${formatInstant(task.end, locale)}`}
      </div>
      {!milestone ? <div className="gantt-tooltip__row">{formatDuration(task.end - task.start)}</div> : null}
      {typeof meta.progress === 'number' ? (
        <div className="gantt-tooltip__row">{Math.round(meta.progress * 100)}% complete</div>
      ) : null}
    </>
  );
}

function formatInstant(time: number, locale?: string): string {
  const date = new Date(time);
  const options: Intl.DateTimeFormatOptions =
    date.getHours() === 0 && date.getMinutes() === 0
      ? { dateStyle: 'medium' }
      : { dateStyle: 'medium', timeStyle: 'short' };
  return new Intl.DateTimeFormat(locale, options).format(date);
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

function formatDuration(ms: number): string {
  if (ms >= DAY) {
    const days = ms / DAY;
    return `${trim(days)} day${days === 1 ? '' : 's'}`;
  }
  if (ms >= HOUR) {
    const hours = ms / HOUR;
    return `${trim(hours)} hour${hours === 1 ? '' : 's'}`;
  }
  const minutes = Math.max(1, Math.round(ms / MINUTE));
  return `${minutes} min`;
}

function trim(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}
