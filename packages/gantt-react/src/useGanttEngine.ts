import { useEffect, useMemo, useRef } from 'react';
import {
  GanttEngine,
  type DeepPartial,
  type GanttEngineOptions,
  type GanttGroup,
  type GanttPlugin,
  type GanttTask,
} from '@gantt-chart/core';

export interface UseGanttEngineInput<T = unknown, G = unknown> {
  tasks: readonly GanttTask<T>[];
  groups?: readonly GanttGroup<G>[];
  options?: DeepPartial<GanttEngineOptions>;
  plugins?: readonly GanttPlugin<T, G>[];
  /** Initial plot size; the real size arrives from the resize observer. */
  size?: { width: number; height: number };
  warn?: boolean;
}

/**
 * Owns a {@link GanttEngine} for a component's lifetime and keeps it in step
 * with props.
 *
 * The engine is created once and *mutated* on prop changes rather than
 * recreated: rebuilding it would throw away viewport, selection and collapse
 * state on every re-render.
 */
export function useGanttEngine<T = unknown, G = unknown>(
  input: UseGanttEngineInput<T, G>,
): GanttEngine<T, G> {
  const engine = useMemo(
    () =>
      new GanttEngine<T, G>({
        tasks: input.tasks,
        groups: input.groups,
        options: input.options,
        size: input.size,
        warn: input.warn,
      }),
    // Intentionally empty: the engine outlives every prop.
    [],
  );

  // The constructor already normalized the first dataset.
  const primed = useRef(true);
  useEffect(() => {
    if (primed.current) {
      primed.current = false;
      return;
    }
    engine.setData(input.tasks, input.groups);
  }, [engine, input.tasks, input.groups]);

  // Options are compared by value: callers pass literals, and an identity-only
  // check would rebuild the frame on every parent render.
  const optionsKey = JSON.stringify(input.options ?? null);
  useEffect(() => {
    if (input.options) engine.setOptions(input.options);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [engine, optionsKey]);

  const plugins = input.plugins;
  useEffect(() => {
    if (!plugins || plugins.length === 0) return;
    const teardowns = plugins.map((plugin) => engine.use(plugin));
    return () => {
      for (const teardown of teardowns) teardown();
    };
  }, [engine, plugins]);

  useEffect(() => () => engine.dispose(), [engine]);

  return engine;
}
