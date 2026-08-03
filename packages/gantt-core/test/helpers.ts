import type { GanttGroup, GanttTask } from '../src/types';

/** Deterministic PRNG so failures reproduce exactly. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface GeneratedData {
  tasks: GanttTask[];
  groups: GanttGroup[];
}

export interface GenerateOptions {
  groupCount: number;
  tasksPerGroup: number;
  seed?: number;
  /** Time domain the tasks are spread across. */
  domain?: [number, number];
  maxDuration?: number;
}

export function generate(options: GenerateOptions): GeneratedData {
  const { groupCount, tasksPerGroup, seed = 1 } = options;
  const [domainStart, domainEnd] = options.domain ?? [0, 100_000];
  const maxDuration = options.maxDuration ?? 500;
  const random = mulberry32(seed);

  const groups: GanttGroup[] = [];
  for (let g = 0; g < groupCount; g++) {
    groups.push({ id: `g${g}`, label: `Group ${g}` });
  }

  const tasks: GanttTask[] = [];
  const span = domainEnd - domainStart;
  for (let g = 0; g < groupCount; g++) {
    for (let t = 0; t < tasksPerGroup; t++) {
      const start = domainStart + Math.floor(random() * span);
      const duration = 1 + Math.floor(random() * maxDuration);
      tasks.push({
        id: `g${g}-t${t}`,
        groupId: `g${g}`,
        start,
        end: start + duration,
      });
    }
  }
  return { tasks, groups };
}

/** Do two half-open intervals overlap? */
export function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}
