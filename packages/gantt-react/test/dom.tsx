import { createElement, createRef, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import type { GanttEngine, GanttGroup, GanttTask } from '@gantt-chart/core';
import { GanttChart, type GanttChartProps } from '../src/GanttChart';

export const HOUR = 3_600_000;
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

  /*
   * zrender measures label widths through a 2d context even when rendering SVG.
   * jsdom has no canvas implementation, so without a stub every frame logs a
   * "not implemented" warning; an approximate width is all the measurement is
   * used for here.
   */
  const canvas = HTMLCanvasElement.prototype as unknown as { getContext: unknown; __stubbed?: boolean };
  if (!canvas.__stubbed) {
    canvas.__stubbed = true;
    canvas.getContext = (): unknown => ({
      font: '',
      measureText: (text: string) => ({ width: text.length * 6 }),
      fillText: () => {},
      save: () => {},
      restore: () => {},
      setTransform: () => {},
      clearRect: () => {},
    });
  }

  /*
   * jsdom implements no pointer capture, and the zoom bars capture so a drag
   * survives the pointer leaving the handle. No-ops are enough: the tests
   * dispatch every move at the element that took the capture anyway.
   */
  const element = HTMLElement.prototype as unknown as Record<string, unknown>;
  if (typeof element.setPointerCapture !== 'function') {
    element.setPointerCapture = function setPointerCapture(): void {};
    element.releasePointerCapture = function releasePointerCapture(): void {};
    element.hasPointerCapture = function hasPointerCapture(): boolean {
      return true;
    };
  }

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

export interface FixtureOptions {
  groups?: number;
  tasksPerGroup?: number;
  nested?: boolean;
  /**
   * Items per row — how many stacking lanes each group is forced to occupy.
   *
   * Tasks are dealt round-robin into this many lanes. Those sharing a lane are
   * spaced two days apart, while the ones sharing a *column* overlap, so the
   * allocator has to give each its own lane. The default of 1 lays every task
   * out end to end in a single lane.
   */
  lanesPerGroup?: number;
}

/**
 * Three groups of four one-day tasks, two days apart.
 *
 * Pass `lanesPerGroup` to make the tasks overlap and stack instead — see
 * {@link FixtureOptions.lanesPerGroup}.
 */
export function fixtureData(options: FixtureOptions = {}): Fixture {
  const { groups: groupCount = 3, tasksPerGroup = 4, nested = false, lanesPerGroup = 1 } = options;
  const lanes = Math.max(1, lanesPerGroup);
  const groups: GanttGroup[] = [];
  const tasks: Fixture['tasks'] = [];

  for (let g = 0; g < groupCount; g++) {
    groups.push({
      id: `g${g}`,
      label: `Group ${g}`,
      ...(nested && g > 0 ? { parentId: 'g0' } : null),
    });
    for (let t = 0; t < tasksPerGroup; t++) {
      // Column = position along the timeline, lane = row within the stack.
      const column = Math.floor(t / lanes);
      const lane = t % lanes;
      const columnStart = T0 + column * 2 * DAY;
      tasks.push({
        id: `g${g}-t${t}`,
        groupId: `g${g}`,
        // Staggered by an hour so starts stay distinct, but every task in a
        // column ends together — mutual overlap, hence one lane each.
        start: columnStart + lane * HOUR,
        end: columnStart + DAY,
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

/**
 * Drive the engine directly from a test.
 *
 * Engine mutations notify store subscribers, which sets React state — so they
 * have to happen inside `act` just like an event dispatch does.
 */
export function run(fn: () => void): void {
  act(() => {
    fn();
  });
}

/**
 * Let real timers run for `ms`, with any React state they schedule applied.
 *
 * Real rather than faked: the chart renders off an animation frame, and faking
 * timers stops that as well as the one under test.
 */
export async function wait(ms: number): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
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

/**
 * Press, move and release on one element — the gesture the zoom bars expect.
 *
 * `installLayout` reports every box as 800×400 at the origin, so a client
 * coordinate here is also an offset into the track.
 */
export function drag(
  target: EventTarget,
  from: { clientX?: number; clientY?: number },
  to: { clientX?: number; clientY?: number },
): void {
  const at = (point: { clientX?: number; clientY?: number }): MouseEventInit => ({
    clientX: point.clientX ?? 0,
    clientY: point.clientY ?? 0,
  });
  dispatch(target, 'pointerdown', at(from));
  dispatch(target, 'pointermove', at(to));
  dispatch(target, 'pointerup', at(to));
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
