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
  /**
   * A built-in zrender element, or the name of your own shape.
   *
   * ECharts special-cases `path`, `image`, `text` and `group`; every other name
   * is looked up in the registry that `graphic.registerShape` writes to, and a
   * name that is not there throws when the frame renders. So a custom shape needs
   * registering once, before the first render:
   *
   * ```ts
   * import { graphic } from 'echarts/core';
   *
   * const Chevron = graphic.extendShape({
   *   shape: { x: 0, y: 0, width: 0, height: 0, notch: 6 },
   *   buildPath(path, shape) {
   *     const { x, y, width, height, notch } = shape;
   *     path.moveTo(x, y);
   *     path.lineTo(x + width - notch, y);
   *     path.lineTo(x + width, y + height / 2);
   *     path.lineTo(x + width - notch, y + height);
   *     path.lineTo(x, y + height);
   *     path.closePath();
   *   },
   * });
   * graphic.registerShape('gantt-chevron', Chevron);
   * ```
   *
   * An item renderer then returns `{ type: 'gantt-chevron', shape: {…} }`, and
   * whatever `shape` holds is what `buildPath` is handed. Keep `silent: true` as
   * the built-in elements do — the adapter hit-tests against the engine, not
   * against the scene graph, so a shape that takes pointer events only gets in
   * the way of drag, resize and marquee.
   *
   * The union is open on purpose, and lists the built-ins only so they autocomplete.
   */
  type:
    | 'group'
    | 'rect'
    | 'line'
    | 'polygon'
    | 'polyline'
    | 'circle'
    | 'text'
    | 'path'
    | 'image'
    // eslint-disable-next-line @typescript-eslint/ban-types
    | (string & {});
  /**
   * Geometry, per element type (`{x, y, width, height, r}` for a rect, …), or
   * whatever a registered shape's `buildPath` reads.
   */
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
  /** Text elements: the box drawn behind the text. */
  backgroundColor?: string;
  /** Inset between that box and the text — one value, or `[top, right, bottom, left]`. */
  padding?: number | number[];
  borderRadius?: number;
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
