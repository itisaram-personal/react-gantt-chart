import type { EChartsLike } from '../src/adapter';

/**
 * The smallest element the adapter can bind to.
 *
 * jsdom is not a dependency of this package, and the adapter only needs five
 * DOM affordances: listener registration, a bounding box, pointer capture, a
 * style object and focus. Faking those lets the gesture state machine be tested
 * against synthesised events in the plain node environment.
 */
export interface FakeElement {
  dispatch(type: string, event: Record<string, unknown>): void;
  /** Types that currently have at least one listener. */
  boundTypes(): string[];
  style: { cursor: string };
  captured: number[];
  released: number[];
  prevented: number;
  focused: number;
  element: HTMLElement;
}

export function fakeElement(origin: { left: number; top: number } = { left: 0, top: 0 }): FakeElement {
  const listeners = new Map<string, ((event: unknown) => void)[]>();
  const state = {
    style: { cursor: '' },
    captured: [] as number[],
    released: [] as number[],
    prevented: 0,
    focused: 0,
  };

  const element = {
    style: state.style,
    addEventListener(type: string, handler: (event: unknown) => void): void {
      const existing = listeners.get(type);
      if (existing) existing.push(handler);
      else listeners.set(type, [handler]);
    },
    removeEventListener(type: string, handler: (event: unknown) => void): void {
      const existing = listeners.get(type);
      if (!existing) return;
      const at = existing.indexOf(handler);
      if (at >= 0) existing.splice(at, 1);
      if (existing.length === 0) listeners.delete(type);
    },
    getBoundingClientRect: () => ({ left: origin.left, top: origin.top, width: 0, height: 0 }),
    setPointerCapture: (id: number) => state.captured.push(id),
    releasePointerCapture: (id: number) => state.released.push(id),
    focus: () => {
      state.focused++;
    },
  };

  return {
    dispatch(type, event): void {
      const handlers = listeners.get(type);
      if (!handlers) return;
      const full = {
        preventDefault: () => {
          state.prevented++;
        },
        stopPropagation: () => {},
        ...event,
      };
      for (const handler of handlers.slice()) handler(full);
    },
    boundTypes: () => Array.from(listeners.keys()),
    get style() {
      return state.style;
    },
    get captured() {
      return state.captured;
    },
    get released() {
      return state.released;
    },
    get prevented() {
      return state.prevented;
    },
    get focused() {
      return state.focused;
    },
    element: element as unknown as HTMLElement,
  };
}

export interface PointerInit {
  button?: number;
  pointerId?: number;
  ctrl?: boolean;
  shift?: boolean;
  meta?: boolean;
  alt?: boolean;
}

/** A pointer/mouse event at plot coordinates (the fake element sits at 0,0). */
export function pointerEvent(x: number, y: number, init: PointerInit = {}): Record<string, unknown> {
  return {
    clientX: x,
    clientY: y,
    button: init.button ?? 0,
    pointerId: init.pointerId ?? 1,
    ctrlKey: init.ctrl ?? false,
    shiftKey: init.shift ?? false,
    metaKey: init.meta ?? false,
    altKey: init.alt ?? false,
  };
}

export interface WheelInit extends PointerInit {
  deltaX?: number;
  deltaY?: number;
  deltaMode?: number;
}

export function wheelEvent(x: number, y: number, init: WheelInit = {}): Record<string, unknown> {
  return {
    ...pointerEvent(x, y, init),
    deltaX: init.deltaX ?? 0,
    deltaY: init.deltaY ?? 0,
    deltaMode: init.deltaMode ?? 0,
  };
}

export function keyEvent(key: string, init: PointerInit = {}): Record<string, unknown> {
  return {
    key,
    ctrlKey: init.ctrl ?? false,
    shiftKey: init.shift ?? false,
    metaKey: init.meta ?? false,
    altKey: init.alt ?? false,
  };
}

export interface FakeChart extends EChartsLike {
  /** Every option handed to `setOption`, oldest first. */
  options: unknown[];
  resizes: { width: number; height: number }[];
}

/** A chart that records what it was told, so renders can be asserted on. */
export function fakeChart(width = 800, height = 400): FakeChart {
  const options: unknown[] = [];
  const resizes: { width: number; height: number }[] = [];
  let size = { width, height };

  return {
    options,
    resizes,
    setOption(option: unknown): void {
      options.push(option);
    },
    getDom: () => null,
    getWidth: () => size.width,
    getHeight: () => size.height,
    resize(opts?: unknown): void {
      const next = (opts ?? {}) as { width?: number; height?: number };
      size = { width: next.width ?? size.width, height: next.height ?? size.height };
      resizes.push(size);
    },
    isDisposed: () => false,
  };
}
