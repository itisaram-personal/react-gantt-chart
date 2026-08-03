import type { GanttEngine, GanttId, GanttPlugin, GanttTheme, Unsubscribe } from '@gantt-chart/core';
import type { GanttElement } from '../elements';

export type DependencyKind = 'finish-start' | 'start-start' | 'finish-finish' | 'start-finish';

export interface GanttDependency {
  from: GanttId;
  to: GanttId;
  /** Defaults to `finish-start`. */
  kind?: DependencyKind;
  color?: string;
}

export interface DependencyPluginOptions {
  dependencies?: readonly GanttDependency[];
  theme?: GanttTheme;
  color?: string;
  lineWidth?: number;
  arrowSize?: number;
  /**
   * Links drawn per frame. Beyond this the overlay stops: a screen with 5 000
   * arrows on it conveys nothing, and drawing them would cost more than the
   * bars.
   */
  maxLinks?: number;
}

export interface DependencyPlugin<T = unknown, G = unknown> extends GanttPlugin<T, G> {
  setDependencies(dependencies: readonly GanttDependency[]): void;
  setTheme(theme: GanttTheme): void;
}

const HORIZONTAL_STUB = 10;

/**
 * Draws dependency arrows between bars.
 *
 * Only links touching a *visible* bar are considered, and the lookup from task
 * to link is indexed once when the dependency list is set — so the per-frame
 * cost tracks what is on screen, not the size of the dependency graph.
 */
export function dependenciesPlugin<T = unknown, G = unknown>(
  options: DependencyPluginOptions = {},
): DependencyPlugin<T, G> {
  let dependencies: readonly GanttDependency[] = options.dependencies ?? [];
  let theme = options.theme;
  let byTask = indexByTask(dependencies);
  let engineRef: GanttEngine<T, G> | null = null;

  const lineWidth = options.lineWidth ?? 1;
  const arrowSize = options.arrowSize ?? 5;
  const maxLinks = options.maxLinks ?? 2000;

  const render = (engine: GanttEngine<T, G>): GanttElement[] => {
    if (dependencies.length === 0) return [];
    const stroke = options.color ?? theme?.colors.dependencyLine ?? '#94a3b8';

    const visible = engine.getVisible();
    const seen = new Set<number>();
    const out: GanttElement[] = [];

    for (const item of visible.items) {
      const links = byTask.get(item.task.id);
      if (!links) continue;

      for (const linkIndex of links) {
        if (seen.has(linkIndex)) continue;
        seen.add(linkIndex);
        if (out.length >= maxLinks) return out;

        const link = dependencies[linkIndex];
        const from = engine.getTaskRect(link.from);
        const to = engine.getTaskRect(link.to);
        // A missing rect means the task is filtered out or behind a collapsed
        // group — there is nothing to point at.
        if (!from || !to) continue;

        out.push(linkElement(from, to, link.kind ?? 'finish-start', link.color ?? stroke, lineWidth, arrowSize));
      }
    }
    return out;
  };

  return {
    name: 'dependencies',
    setup(engine): Unsubscribe {
      engineRef = engine;
      const unregister = engine.overlays.register('dependencies', (context) => render(context.engine));
      return () => {
        unregister();
        engineRef = null;
      };
    },
    setDependencies(next): void {
      dependencies = next;
      byTask = indexByTask(next);
      // Overlays are pulled during the next frame; nudge one so the change shows
      // even when nothing else in the store moved.
      engineRef?.store.setState((state) => ({ layoutRevision: state.layoutRevision + 1 }));
    },
    setTheme(next): void {
      theme = next;
      engineRef?.store.setState((state) => ({ layoutRevision: state.layoutRevision + 1 }));
    },
  };
}

function indexByTask(dependencies: readonly GanttDependency[]): Map<GanttId, number[]> {
  const index = new Map<GanttId, number[]>();
  for (let i = 0; i < dependencies.length; i++) {
    push(index, dependencies[i].from, i);
    push(index, dependencies[i].to, i);
  }
  return index;
}

function push(index: Map<GanttId, number[]>, id: GanttId, value: number): void {
  const existing = index.get(id);
  if (existing) existing.push(value);
  else index.set(id, [value]);
}

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** An orthogonal 3-segment connector plus an arrow head, as one group. */
function linkElement(
  from: Box,
  to: Box,
  kind: DependencyKind,
  stroke: string,
  lineWidth: number,
  arrowSize: number,
): GanttElement {
  const fromRight = kind === 'finish-start' || kind === 'finish-finish';
  const toRight = kind === 'finish-finish' || kind === 'start-finish';

  const x0 = fromRight ? from.x + from.width : from.x;
  const y0 = from.y + from.height / 2;
  const x1 = toRight ? to.x + to.width : to.x;
  const y1 = to.y + to.height / 2;

  const stubOut = fromRight ? HORIZONTAL_STUB : -HORIZONTAL_STUB;
  const stubIn = toRight ? HORIZONTAL_STUB : -HORIZONTAL_STUB;
  const midX = (x0 + stubOut + (x1 - stubIn)) / 2;

  const points: [number, number][] = [
    [x0, y0],
    [x0 + stubOut, y0],
    [midX, y0],
    [midX, y1],
    [x1 - stubIn, y1],
    [x1, y1],
  ];

  // Arrow head points *into* the target edge.
  const direction = toRight ? -1 : 1;
  const head: [number, number][] = [
    [x1, y1],
    [x1 - direction * arrowSize, y1 - arrowSize * 0.6],
    [x1 - direction * arrowSize, y1 + arrowSize * 0.6],
  ];

  return {
    type: 'group',
    silent: true,
    children: [
      { type: 'polyline', shape: { points }, style: { stroke, lineWidth, fill: 'none' }, silent: true },
      { type: 'polygon', shape: { points: head }, style: { fill: stroke }, silent: true },
    ],
  };
}
