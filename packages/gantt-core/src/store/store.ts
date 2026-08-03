import type { Unsubscribe } from '../util/emitter';

export type StoreListener<S> = (state: S, previous: S) => void;

export function shallowEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  const ka = Object.keys(a as object);
  const kb = Object.keys(b as object);
  if (ka.length !== kb.length) return false;
  for (const key of ka) {
    if (!Object.is((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key])) return false;
  }
  return true;
}

/**
 * Immutable snapshot store.
 *
 * Every mutation produces a new top-level object, which lets consumers (React's
 * `useSyncExternalStore`, the renderer's dirty checks) compare by reference.
 * Patches that change nothing are dropped before any listener runs, so an
 * interaction that re-asserts the current state costs zero renders.
 */
export class Store<S extends object> {
  private state: S;
  private notifiedState: S;
  private readonly listeners = new Set<StoreListener<S>>();
  private depth = 0;
  private dirty = false;
  private ver = 0;

  constructor(initial: S) {
    this.state = initial;
    this.notifiedState = initial;
  }

  /** Monotonic counter bumped on every accepted mutation. */
  get version(): number {
    return this.ver;
  }

  getState(): S {
    return this.state;
  }

  setState(patch: Partial<S> | ((state: S) => Partial<S> | null | undefined)): boolean {
    const resolved = typeof patch === 'function' ? patch(this.state) : patch;
    if (!resolved) return false;

    let changed = false;
    for (const key of Object.keys(resolved) as (keyof S)[]) {
      if (!Object.is(this.state[key], resolved[key])) {
        changed = true;
        break;
      }
    }
    if (!changed) return false;

    this.state = { ...this.state, ...resolved };
    this.ver++;
    this.dirty = true;
    if (this.depth === 0) this.flush();
    return true;
  }

  /** Coalesce several mutations into a single notification. */
  batch<R>(fn: () => R): R {
    this.depth++;
    try {
      return fn();
    } finally {
      this.depth--;
      if (this.depth === 0) this.flush();
    }
  }

  subscribe(listener: StoreListener<S>): Unsubscribe {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Subscribe to a derived slice. The listener only runs when the selected
   * value changes according to `equals` (reference equality by default).
   */
  subscribeSelector<R>(
    selector: (state: S) => R,
    listener: (value: R, previous: R) => void,
    equals: (a: R, b: R) => boolean = Object.is,
  ): Unsubscribe {
    let current = selector(this.state);
    return this.subscribe((state) => {
      const next = selector(state);
      if (equals(next, current)) return;
      const previous = current;
      current = next;
      listener(next, previous);
    });
  }

  destroy(): void {
    this.listeners.clear();
  }

  private flush(): void {
    if (!this.dirty) return;
    this.dirty = false;
    const previous = this.notifiedState;
    this.notifiedState = this.state;
    for (const listener of Array.from(this.listeners)) listener(this.state, previous);
  }
}
