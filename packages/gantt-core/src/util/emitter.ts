export type Unsubscribe = () => void;

type Listener = (payload: never) => void;

/**
 * Minimal typed event emitter.
 *
 * Listener sets are copied before dispatch so handlers can subscribe or
 * unsubscribe during an emit without corrupting the iteration.
 */
// `any` rather than `unknown`: an event-map *interface* has no index signature,
// so `Record<string, unknown>` would reject every hand-written map.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export class Emitter<M extends Record<string, any>> {
  private readonly listeners = new Map<keyof M, Set<Listener>>();

  on<K extends keyof M>(event: K, listener: (payload: M[K]) => void): Unsubscribe {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(listener as Listener);
    return () => {
      set!.delete(listener as Listener);
      if (set!.size === 0) this.listeners.delete(event);
    };
  }

  once<K extends keyof M>(event: K, listener: (payload: M[K]) => void): Unsubscribe {
    const off = this.on(event, (payload) => {
      off();
      listener(payload);
    });
    return off;
  }

  off<K extends keyof M>(event: K, listener: (payload: M[K]) => void): void {
    const set = this.listeners.get(event);
    if (!set) return;
    set.delete(listener as Listener);
    if (set.size === 0) this.listeners.delete(event);
  }

  emit<K extends keyof M>(event: K, payload: M[K]): void {
    const set = this.listeners.get(event);
    if (!set || set.size === 0) return;
    for (const listener of Array.from(set)) {
      (listener as (p: M[K]) => void)(payload);
    }
  }

  hasListeners<K extends keyof M>(event: K): boolean {
    const set = this.listeners.get(event);
    return !!set && set.size > 0;
  }

  clear(): void {
    this.listeners.clear();
  }
}
