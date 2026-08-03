/**
 * A structural description of a zrender element.
 *
 * The adapter deliberately does not import ECharts' own element types: `echarts`
 * is a peer dependency and this package must stay importable (and testable)
 * without it. The shape below is the subset of the custom-series element
 * contract the renderers use, and is cast at the single boundary where it is
 * handed to ECharts.
 */
export interface GanttElement {
  type: 'group' | 'rect' | 'line' | 'polygon' | 'polyline' | 'circle' | 'text' | 'path' | 'image';
  /** Geometry, per element type (`{x, y, width, height, r}` for a rect, …). */
  shape?: Record<string, unknown>;
  style?: GanttElementStyle;
  children?: GanttElement[];
  x?: number;
  y?: number;
  rotation?: number;
  scaleX?: number;
  scaleY?: number;
  /** Elements that never take part in hit-testing; the adapter hit-tests itself. */
  silent?: boolean;
  /** Paint order inside one series. */
  z2?: number;
  cursor?: string;
  invisible?: boolean;
  ignore?: boolean;
  clipPath?: GanttElement;
  /** Consumer payload, echoed back by ECharts on element events. */
  info?: unknown;
}

export interface GanttElementStyle {
  fill?: string;
  stroke?: string;
  lineWidth?: number;
  lineDash?: number[] | 'solid' | 'dashed' | 'dotted';
  opacity?: number;
  shadowBlur?: number;
  shadowColor?: string;
  shadowOffsetX?: number;
  shadowOffsetY?: number;
  /** Text elements. */
  text?: string;
  x?: number;
  y?: number;
  font?: string;
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: number | string;
  textAlign?: 'left' | 'center' | 'right';
  textVerticalAlign?: 'top' | 'middle' | 'bottom';
  width?: number;
  overflow?: 'none' | 'truncate' | 'break' | 'breakAll';
  ellipsis?: string;
  lineHeight?: number;
}

/** CSS-style shorthand for a zrender `style.font`. */
export function fontShorthand(weight: number | string, size: number, family: string): string {
  return `${weight} ${size}px ${family}`;
}

/** Drop empty children so a group is never emitted for nothing. */
export function group(children: (GanttElement | null | undefined | false)[], extra: Partial<GanttElement> = {}): GanttElement | null {
  const kept = children.filter((child): child is GanttElement => Boolean(child));
  if (kept.length === 0) return null;
  return { type: 'group', children: kept, ...extra };
}
