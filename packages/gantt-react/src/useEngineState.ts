import { useEffect, useRef, useState } from 'react';
import type { GanttEngine, GanttState } from '@gantt-chart/core';

/**
 * Subscribe to a slice of engine state.
 *
 * Deliberately built on `useState` + `useEffect` rather than
 * `useSyncExternalStore`: the package supports React 17, where that hook does
 * not exist. The store is the single writer for everything rendered here, and
 * the selector is re-run once immediately after subscribing, so a change landing
 * between render and effect is not missed.
 */
export function useEngineState<T, G, R>(
  engine: GanttEngine<T, G>,
  selector: (state: GanttState<T, G>) => R,
  isEqual: (a: R, b: R) => boolean = Object.is,
): R {
  const [value, setValue] = useState<R>(() => selector(engine.store.getState()));

  const selectorRef = useRef(selector);
  selectorRef.current = selector;
  const equalRef = useRef(isEqual);
  equalRef.current = isEqual;
  const valueRef = useRef(value);
  valueRef.current = value;

  useEffect(() => {
    const check = (): void => {
      const next = selectorRef.current(engine.store.getState());
      if (equalRef.current(next, valueRef.current)) return;
      valueRef.current = next;
      setValue(next);
    };
    check();
    return engine.store.subscribe(check);
  }, [engine]);

  return value;
}

/** Re-render whenever anything in the store changes. */
export function useEngineVersion<T, G>(engine: GanttEngine<T, G>): number {
  return useEngineState(engine, () => engine.store.version);
}
