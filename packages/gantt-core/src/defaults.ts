import type { DeepPartial, GanttEngineOptions } from "./types";

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;
export const WEEK = 7 * DAY;
export const YEAR = 365 * DAY;

export const defaultOptions: GanttEngineOptions = {
  metrics: {
    laneHeight: 26,
    // Proportional rather than fixed: at the default row height these come to
    // 4.1px and 3.1px — where the pixel defaults used to be — and they hold
    // that proportion when rows are scaled to fit.
    rowPaddingY: "12%",
    itemPaddingY: "12%",
    minRowHeight: 34,
    minItemWidth: 2,
    uniformRowHeight: true,
  },
  stacking: {
    enabled: true,
    minGap: 0,
    maxLanes: 64,
    rollupCollapsed: true,
  },
  virtualization: {
    overscanPx: 240,
    overscanRows: 2,
    maxVisibleItems: 4000,
  },
  interaction: {
    selection: true,
    multiSelect: true,
    drag: true,
    resize: true,
    snapMs: 0,
    marquee: true,
    marqueeOnTasks: false,
    // A drag picks up a bar only once it is selected; on an unselected one it
    // falls through to `backgroundDrag` below.
    dragSelectedOnly: true,
    // A disabled row ignores input. Set 'interactive' to keep the fade and let
    // every gesture through.
    disabledRows: "block",
    // Plain drag pans, like a map; hold a modifier to rubber-band instead.
    // Note that alt panning gives up remove-mode marquee, which is only
    // reachable through an alt drag — set `alt: 'marquee'` to get it back.
    backgroundDrag: {
      plain: "pan",
      ctrl: "marquee",
      shift: "marquee",
      alt: "pan",
    },
    wheel: {
      plain: "scroll",
      ctrl: "zoom",
      shift: "pan",
      alt: "none",
    },
  },
  minTimeSpan: MINUTE,
  maxTimeSpan: 50 * YEAR,
};

/** Merge a partial config over the defaults, one level into each section. */
export function resolveOptions(
  partial: DeepPartial<GanttEngineOptions> | undefined,
  base: GanttEngineOptions = defaultOptions,
): GanttEngineOptions {
  if (!partial) return base;
  return {
    ...base,
    ...(partial as Partial<GanttEngineOptions>),
    metrics: { ...base.metrics, ...partial.metrics },
    stacking: { ...base.stacking, ...partial.stacking },
    virtualization: { ...base.virtualization, ...partial.virtualization },
    interaction: {
      ...base.interaction,
      ...partial.interaction,
      backgroundDrag: {
        ...base.interaction.backgroundDrag,
        ...partial.interaction?.backgroundDrag,
      },
      wheel: { ...base.interaction.wheel, ...partial.interaction?.wheel },
    },
  };
}

/** Option changes that force a stacking/layout recomputation. */
export function affectsLayout(previous: GanttEngineOptions, next: GanttEngineOptions): boolean {
  const a = previous.metrics;
  const b = next.metrics;
  if (
    a.laneHeight !== b.laneHeight ||
    a.rowPaddingY !== b.rowPaddingY ||
    a.minRowHeight !== b.minRowHeight ||
    a.itemPaddingY !== b.itemPaddingY ||
    a.uniformRowHeight !== b.uniformRowHeight
  ) {
    return true;
  }
  const s = previous.stacking;
  const t = next.stacking;
  return (
    s.enabled !== t.enabled ||
    s.minGap !== t.minGap ||
    s.maxLanes !== t.maxLanes ||
    s.rollupCollapsed !== t.rollupCollapsed
  );
}
