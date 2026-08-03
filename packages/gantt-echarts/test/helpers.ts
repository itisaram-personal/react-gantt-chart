import { GanttEngine, type GanttGroup, type GanttTask } from '@gantt-chart/core';
import { lightTheme } from '@gantt-chart/themes';

export const DAY = 86_400_000;
export const HOUR = 3_600_000;

/** 2026-03-02 00:00 local — a Monday, so week boundaries are easy to reason about. */
export const T0 = new Date(2026, 2, 2).getTime();

export interface TaskMeta {
  label?: string;
  color?: string;
  progress?: number;
}

export interface FixtureOptions {
  groups?: number;
  tasksPerGroup?: number;
  width?: number;
  height?: number;
  /** Adds a `start === end` task per group. */
  milestones?: boolean;
  nested?: boolean;
}

export interface Fixture {
  engine: GanttEngine<TaskMeta, unknown>;
  tasks: GanttTask<TaskMeta>[];
  groups: GanttGroup[];
  theme: typeof lightTheme;
}

/**
 * A small, fully deterministic dataset: `n` tasks per group laid out one per day
 * so every assertion about geometry can be written in days rather than pixels.
 */
export function fixture(options: FixtureOptions = {}): Fixture {
  const {
    groups: groupCount = 3,
    tasksPerGroup = 4,
    width = 800,
    height = 400,
    milestones = false,
    nested = false,
  } = options;

  const groups: GanttGroup[] = [];
  for (let g = 0; g < groupCount; g++) {
    groups.push({
      id: `g${g}`,
      label: `Group ${g}`,
      ...(nested && g > 0 ? { parentId: 'g0' } : null),
    });
  }

  const tasks: GanttTask<TaskMeta>[] = [];
  for (let g = 0; g < groupCount; g++) {
    for (let t = 0; t < tasksPerGroup; t++) {
      tasks.push({
        id: `g${g}-t${t}`,
        groupId: `g${g}`,
        start: T0 + t * 2 * DAY,
        end: T0 + (t * 2 + 1) * DAY,
        data: { label: `Task ${g}.${t}` },
      });
    }
    if (milestones) {
      tasks.push({
        id: `g${g}-m`,
        groupId: `g${g}`,
        start: T0 + 3 * DAY,
        end: T0 + 3 * DAY,
        data: { label: `Milestone ${g}` },
      });
    }
  }

  const engine = new GanttEngine<TaskMeta, unknown>({
    tasks,
    groups,
    size: { width, height },
    warn: false,
    // An explicit domain, wider than the data, keeps the visible window exactly
    // 10 days regardless of how many tasks a case generates — the viewport would
    // otherwise be clamped to the data extent — and leaves room to pan.
    options: { timeDomain: [T0 - 10 * DAY, T0 + 30 * DAY] },
  });
  engine.viewport.setTimeRange(T0, T0 + 10 * DAY);

  return { engine, tasks, groups, theme: lightTheme };
}

/** Flatten a nested element tree into a list, for counting by type. */
export function flatten(element: unknown): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  const walk = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    const record = node as Record<string, unknown>;
    out.push(record);
    const children = record.children;
    if (Array.isArray(children)) for (const child of children) walk(child);
  };
  walk(element);
  return out;
}

export function ofType(elements: Record<string, unknown>[], type: string): Record<string, unknown>[] {
  return elements.filter((element) => element.type === type);
}
