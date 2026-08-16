import type { GanttRenderContext, GanttTask } from "@gantt-chart/core";
import { fontShorthand, group, type GanttElement } from "./elements";

/**
 * Turns one bar's render context into elements.
 *
 * The engine has already decided the geometry; a renderer only decides
 * appearance. Returning `null` skips the bar entirely.
 */
export type GanttItemRenderer<T = unknown, G = unknown> = (
  context: GanttRenderContext<T, G>,
) => GanttElement | null;

/**
 * Optional fields the default renderer reads off `task.data`.
 *
 * Consumers keep their own shape in `data`; these keys are simply the ones the
 * built-in look understands. Anything else is ignored (and available to a custom
 * renderer).
 */
export interface DefaultTaskMeta {
  label?: string;
  name?: string;
  /** Overrides the palette pick. */
  color?: string;
  /** Overrides the label colour. */
  textColor?: string;
  /** 0…1 — draws a completion fill inside the bar. */
  progress?: number;
}

function meta(task: GanttTask<unknown>): DefaultTaskMeta {
  return (task.data ?? {}) as DefaultTaskMeta;
}

/** Bar label: an explicit label, else a name, else the id. */
export function taskLabel(task: GanttTask<unknown>): string {
  const { label, name } = meta(task);
  return label ?? name ?? String(task.id);
}

/** Bar fill: an explicit colour, else a stable colour per group. */
export function taskColor(context: GanttRenderContext<unknown, unknown>): string {
  return meta(context.task).color ?? context.helpers.color(context.task.groupId);
}

/** Bars narrower than this get no label — the text would be all ellipsis. */
const MIN_LABEL_WIDTH = 30;
const LABEL_PADDING = 6;

/**
 * Bars on a disabled row are faded rather than hidden: the row still shows what
 * it holds, while reading as out of reach — which is exactly what it is.
 */
const DISABLED_OPACITY = 0.4;

/** Bar opacity for the current interaction state. */
function itemOpacity(state: { disabled: boolean; dragging: boolean }): number {
  if (state.disabled) return DISABLED_OPACITY;
  return state.dragging ? 0.72 : 1;
}

/**
 * Whether the bar wears its hover stroke.
 *
 * A bar on an inert row is still hovered — that is what raises its tooltip,
 * since the row remains readable — but the stroke is an offer of input the row
 * will not honour, so it stays off. A disabled row that still takes input
 * (`interaction.disabledRows: 'interactive'`) keeps the stroke: there the offer
 * is good.
 */
function emphasized(state: { hovered: boolean; inert: boolean }): boolean {
  return state.hovered && !state.inert;
}

/**
 * The built-in look: rounded bars, diamond milestones, an optional progress
 * fill, and a label clipped to the on-screen part of the bar.
 */
export function defaultItemRenderer<T, G>(context: GanttRenderContext<T, G>): GanttElement | null {
  if (context.geometry.height <= 0) return null;
  return context.geometry.isMilestone ? renderMilestone(context) : renderBar(context);
}

function renderBar<T, G>(context: GanttRenderContext<T, G>): GanttElement | null {
  const { geometry, state, theme, task } = context;
  const { clipped } = geometry;
  if (clipped.width <= 0) return null;

  const fill = taskColor(context as GanttRenderContext<unknown, unknown>);
  const { progress, textColor } = meta(task);

  const stroke = state.selected
    ? theme.colors.selectionStroke
    : emphasized(state)
      ? theme.colors.hoverStroke
      : theme.colors.taskStroke;
  const lineWidth = state.selected
    ? theme.metrics.selectedStrokeWidth
    : theme.metrics.itemStrokeWidth;

  const bar: GanttElement = {
    type: "rect",
    shape: {
      x: geometry.x,
      y: geometry.y,
      width: geometry.width,
      height: geometry.height,
      r: Math.min(theme.metrics.itemRadius, geometry.height / 2),
    },
    style: {
      fill,
      stroke,
      lineWidth,
      opacity: itemOpacity(state),
    },
    silent: true,
  };

  const progressFill =
    typeof progress === "number" && progress > 0
      ? ({
          type: "rect",
          shape: {
            x: geometry.x,
            y: geometry.y,
            width: geometry.width * Math.min(1, progress),
            height: geometry.height,
            r: Math.min(theme.metrics.itemRadius, geometry.height / 2),
          },
          // A darkened overlay reads as "done" against any palette colour without
          // needing a second colour per series.
          style: {
            fill: theme.dark ? "rgba(255,255,255,0.28)" : "rgba(0,0,0,0.26)",
            // Faded with the bar it sits on, or it would read as full progress.
            opacity: itemOpacity(state),
          },
          silent: true,
        } satisfies GanttElement)
      : null;

  // The label is placed in the *clipped* box, so a bar scrolled half off-screen
  // still shows its text next to the visible edge rather than off-canvas.
  const label =
    clipped.width >= MIN_LABEL_WIDTH && geometry.height >= 10
      ? ({
          type: "text",
          style: {
            text: taskLabel(task),
            x: clipped.x + LABEL_PADDING,
            y: geometry.y + geometry.height / 2,
            fill: textColor ?? theme.colors.taskText,
            opacity: itemOpacity(state),
            font: fontShorthand(theme.font.weight, theme.font.labelSize, theme.font.family),
            textVerticalAlign: "middle",
            textAlign: "left",
            width: Math.max(0, clipped.width - LABEL_PADDING * 2),
            overflow: "truncate",
            ellipsis: "…",
          },
          silent: true,
          z2: 2,
        } satisfies GanttElement)
      : null;

  return group([bar, progressFill, label]);
}

function renderMilestone<T, G>(context: GanttRenderContext<T, G>): GanttElement | null {
  const { geometry, state, theme, task } = context;
  const size = Math.min(theme.metrics.milestoneSize, geometry.height + 4);
  const half = size / 2;
  const cx = geometry.x;
  const cy = geometry.y + geometry.height / 2;

  // Fully outside the plot area (with a half-diamond of tolerance).
  if (cx + half < 0 || cx - half > context.viewport.width) return null;

  const fill = meta(task).color ?? theme.colors.milestoneFill;
  const diamond: GanttElement = {
    type: "polygon",
    shape: {
      points: [
        [cx, cy - half],
        [cx + half, cy],
        [cx, cy + half],
        [cx - half, cy],
      ],
    },
    style: {
      fill,
      stroke: state.selected
        ? theme.colors.selectionStroke
        : emphasized(state)
          ? theme.colors.hoverStroke
          : theme.colors.taskStroke,
      lineWidth: state.selected ? theme.metrics.selectedStrokeWidth : theme.metrics.itemStrokeWidth,
      opacity: itemOpacity(state),
    },
    silent: true,
  };

  const label: GanttElement | null =
    cx + half + 4 < context.viewport.width
      ? {
          type: "text",
          style: {
            text: taskLabel(task),
            x: cx + half + 4,
            y: cy,
            fill: theme.colors.text,
            opacity: itemOpacity(state),
            font: fontShorthand(theme.font.weight, theme.font.labelSize, theme.font.family),
            textVerticalAlign: "middle",
            textAlign: "left",
            width: Math.max(0, context.viewport.width - (cx + half + 8)),
            overflow: "truncate",
            ellipsis: "…",
          },
          silent: true,
          z2: 2,
        }
      : null;

  return group([diamond, label]);
}
