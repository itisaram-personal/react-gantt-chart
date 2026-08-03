import { createElement, createRef, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import type { GanttEngine, GanttGroup, GanttTask } from '@gantt-chart/core';
import { GanttChart, type GanttChartProps } from '../src/GanttChart';

export const DAY = 86_400_000;
/** 2026-03-02 00:00 local — a Monday. */
export const T0 = new Date(2026, 2, 2).getTime();

export const PLOT_WIDTH = 800;
export const PLOT_HEIGHT = 400;

/**
 * jsdom performs no layout, so every element reports a zero-sized box. The
 * widget derives its viewport from measured pixels, so the sizes have to be
 * supplied for anything geometric to be exercised at all.
 */
export function installLayout(width = PLOT_WIDTH, height = PLOT_HEIGHT): void {
  const define = (name: string, value: number): void => {
    Object.defineProperty(HTMLElement.prototype, name, {
      configurable: true,
      get(): number {
        return value;
      },
    });
  };
  define('clientWidth', width);
  define('clientHeight', height);

  HTMLElement.prototype.getBoundingClientRect = function getBoundingClientRect(): DOMRect {
    return {
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: width,
      bottom: height,
      width,
      height,
      toJSON: () => ({}),
    } as DOMRect;
  };
}

export interface Fixture {
  tasks: GanttTask<{ label: string; progress?: number }>[];
  groups: GanttGroup[];
}

/** Three groups of four one-day tasks, two days apart. */
export function fixtureData(options: { groups?: number; tasksPerGroup?: number; nested?: boolean } = {}): Fixture {
  const { groups: groupCount = 3, tasksPerGroup = 4, nested = false } = options;
  const groups: GanttGroup[] = [];
  const tasks: Fixture['tasks'] = [];

  for (let g = 0; g < groupCount; g++) {
    groups.push({
      id: `g${g}`,
      label: `Group ${g}`,
      ...(nested && g > 0 ? { parentId: 'g0' } : null),
    });
    for (let t = 0; t < tasksPerGroup; t++) {
      tasks.push({
        id: `g${g}-t${t}`,
        groupId: `g${g}`,
        start: T0 + t * 2 * DAY,
        end: T0 + (t * 2 + 1) * DAY,
        data: { label: `Task ${g}.${t}` },
      });
    }
  }
  return { tasks, groups };
}

export interface Harness<T, G> {
  container: HTMLElement;
  engine: GanttEngine<T, G>;
  rerender(props: Partial<GanttChartProps<T, G>>): void;
  unmount(): void;
  /** Let the adapter's coalesced animation-frame render run. */
  flush(): Promise<void>;
}

type Props<T, G> = GanttChartProps<T, G>;

/**
 * Mount a `GanttChart` in jsdom.
 *
 * The SVG renderer is used throughout: jsdom has no canvas 2d context, and the
 * SVG output is inspectable, so assertions can look at real rendered bars.
 */
export function renderChart<T = { label: string }, G = unknown>(
  props: Props<T, G>,
): Harness<T, G> {
  installLayout();
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

  const container = document.createElement('div');
  document.body.appendChild(container);

  const engineRef = createRef<GanttEngine<T, G>>();
  let current: Props<T, G> = { renderer: 'svg', ...props };
  let root: Root;

  const element = (): ReactElement =>
    createElement(GanttChart as never, {
      ...current,
      engineRef,
    } as never);

  act(() => {
    root = createRoot(container);
    root.render(element());
  });

  const flush = async (): Promise<void> => {
    // The adapter coalesces renders into an animation frame, which jsdom drives
    // off a timer — one macrotask is enough to let it land.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 32));
    });
  };

  return {
    container,
    get engine(): GanttEngine<T, G> {
      const engine = engineRef.current;
      if (!engine) throw new Error('engine ref was not populated');
      return engine;
    },
    rerender(next): void {
      current = { ...current, ...next };
      act(() => {
        root.render(element());
      });
    },
    unmount(): void {
      act(() => {
        root.unmount();
      });
      container.remove();
    },
    flush,
  };
}

/** Dispatch an event jsdom does not construct natively (pointer events). */
export function dispatch(
  target: EventTarget,
  type: string,
  init: MouseEventInit & { pointerId?: number; deltaX?: number; deltaY?: number; deltaMode?: number } = {},
): void {
  const event =
    type === 'wheel'
      ? new WheelEvent(type, { bubbles: true, cancelable: true, ...init })
      : new MouseEvent(type, { bubbles: true, cancelable: true, ...init });
  Object.assign(event, { pointerId: init.pointerId ?? 1 });
  act(() => {
    target.dispatchEvent(event);
  });
}

export function key(target: EventTarget, k: string, init: KeyboardEventInit = {}): void {
  act(() => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init }));
  });
}

export function plotOf(container: HTMLElement): HTMLElement {
  const plot = container.querySelector<HTMLElement>('.gantt-plot');
  if (!plot) throw new Error('no plot element');
  return plot;
}

export function textsOf(container: HTMLElement, selector: string): string[] {
  return Array.from(container.querySelectorAll(selector)).map((node) => node.textContent?.trim() ?? '');
}
