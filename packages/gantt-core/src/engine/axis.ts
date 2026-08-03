import type { GanttRow, ViewportState, VisibleWindow } from '../types';

/** A y-axis entry positioned in plot pixels, ready to be rendered as a real element. */
export interface AxisRowDescriptor<G = unknown> {
  row: GanttRow<G>;
  /** Top edge in plot pixels; may be negative for a partially scrolled row. */
  y: number;
  height: number;
  /** Indentation step for the group tree. */
  depth: number;
  hasChildren: boolean;
  collapsed: boolean;
  label: string;
  /** Alternating band index, stable under scrolling. */
  odd: boolean;
  /** False when the row is only partly inside the plot area. */
  fullyVisible: boolean;
}

/**
 * Axis engine.
 *
 * Turns the virtualized row window into positioned descriptors. The view layer
 * renders these as ordinary interactive elements (DOM nodes in the React
 * package) rather than as chart axis labels, which is what makes click,
 * double-click, hover and context menu on a label behave like a real control.
 */
export function computeAxisRows<G>(
  window: VisibleWindow<unknown, G>,
  viewport: ViewportState,
): AxisRowDescriptor<G>[] {
  const out: AxisRowDescriptor<G>[] = [];
  for (let i = 0; i < window.rows.length; i++) {
    const row = window.rows[i];
    const y = row.y - viewport.scrollTop;
    out.push({
      row,
      y,
      height: row.height,
      depth: row.depth,
      hasChildren: row.hasChildren,
      collapsed: row.collapsed,
      label: row.group.label ?? String(row.group.id),
      odd: row.index % 2 === 1,
      fullyVisible: y >= 0 && y + row.height <= viewport.height,
    });
  }
  return out;
}

/** Row background bands for the plot area, in plot pixels. */
export interface RowBand<G = unknown> {
  row: GanttRow<G>;
  y: number;
  height: number;
  odd: boolean;
  hovered: boolean;
}

export function computeRowBands<G>(
  window: VisibleWindow<unknown, G>,
  viewport: ViewportState,
  hoveredRowIndex: number | null,
): RowBand<G>[] {
  const out: RowBand<G>[] = [];
  for (let i = 0; i < window.rows.length; i++) {
    const row = window.rows[i];
    out.push({
      row,
      y: row.y - viewport.scrollTop,
      height: row.height,
      odd: row.index % 2 === 1,
      hovered: hoveredRowIndex === row.index,
    });
  }
  return out;
}
