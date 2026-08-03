import type { GanttEngine } from './GanttEngine';
import type { Unsubscribe } from './util/emitter';

/**
 * A plugin receives the live engine and returns an optional teardown.
 *
 * Plugins are how optional behaviour (dependency links, resize handles,
 * baselines, custom overlays…) stays out of the core: they subscribe to the
 * event bus, read derived state through the engine's public getters, and
 * contribute extra render layers via {@link GanttEngine.overlays}.
 */
export interface GanttPlugin<T = unknown, G = unknown> {
  readonly name: string;
  setup(engine: GanttEngine<T, G>): Unsubscribe | void;
}

/**
 * An extra render layer. The adapter calls every registered overlay each frame
 * with the current visible window and appends whatever elements it returns.
 * The return type is deliberately `unknown` so the core stays renderer-neutral;
 * the ECharts adapter narrows it to its own element type.
 */
export type OverlayRenderer<T = unknown, G = unknown> = (
  context: OverlayContext<T, G>,
) => unknown[] | null | undefined;

export interface OverlayContext<T = unknown, G = unknown> {
  engine: GanttEngine<T, G>;
  /** Time → plot pixel. */
  timeToPx(time: number): number;
  /** Content pixel → plot pixel. */
  contentToPx(y: number): number;
  width: number;
  height: number;
}

export class OverlayRegistry<T = unknown, G = unknown> {
  private readonly renderers = new Map<string, OverlayRenderer<T, G>>();
  private order: string[] = [];

  register(id: string, renderer: OverlayRenderer<T, G>): Unsubscribe {
    if (!this.renderers.has(id)) this.order.push(id);
    this.renderers.set(id, renderer);
    return () => this.unregister(id);
  }

  unregister(id: string): void {
    if (!this.renderers.delete(id)) return;
    this.order = this.order.filter((entry) => entry !== id);
  }

  list(): OverlayRenderer<T, G>[] {
    return this.order.map((id) => this.renderers.get(id)!).filter(Boolean);
  }

  get size(): number {
    return this.renderers.size;
  }

  clear(): void {
    this.renderers.clear();
    this.order = [];
  }
}
