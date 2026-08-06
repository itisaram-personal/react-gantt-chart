import type { GanttGroup, GanttTask } from "@gantt-chart/core";
import type { GanttDependency } from "@gantt-chart/echarts";

export interface DemoTaskData {
  label: string;
  progress: number;
  status: "planned" | "active" | "blocked" | "done";
  color?: string;
}

export interface DemoGroupData {
  kind: "team" | "project";
}

export type DemoTask = GanttTask<DemoTaskData>;
export type DemoGroup = GanttGroup<DemoGroupData>;

export interface DemoDataset {
  tasks: DemoTask[];
  groups: DemoGroup[];
  dependencies: GanttDependency[];
  generatedIn: number;
}

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** Deterministic PRNG, so a reload reproduces the same dataset exactly. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const STATUSES: DemoTaskData["status"][] = ["planned", "active", "blocked", "done"];

export interface GenerateOptions {
  /** Total number of tasks to produce. */
  taskCount: number;
  /** Tasks per project row, which also sets how much stacking there is. */
  tasksPerProject?: number;
  seed?: number;
  /** Anchor for the timeline; defaults to 90 days ago at midnight. */
  origin?: number;
  /** Calendar span the project start dates are scattered across. */
  timelineDays?: number;
  withDependencies?: boolean;
}

/**
 * Builds a realistic project dataset: teams containing projects, projects
 * containing overlapping tasks, plus milestones and finish-to-start links.
 *
 * Deliberately generated rather than fetched — the point of the demo is what
 * happens at 100 000 bars, and no fixture file that size would be reviewable.
 */
export function generate(options: GenerateOptions): DemoDataset {
  const started = performance.now();
  const { taskCount, tasksPerProject = 12, seed = 7, withDependencies = true } = options;
  const random = mulberry32(seed);

  const origin = options.origin ?? new Date(new Date().setHours(0, 0, 0, 0)).getTime() - 90 * DAY;
  const projectCount = Math.max(1, Math.ceil(taskCount / tasksPerProject));
  // Roughly eight projects per team keeps the tree shallow enough to scan.
  const teamCount = Math.max(1, Math.ceil(projectCount / 8));

  const groups: DemoGroup[] = [];
  for (let team = 0; team < teamCount; team++) {
    groups.push({ id: `team-${team}`, label: `Team ${team + 1}`, data: { kind: "team" } });
  }
  for (let project = 0; project < projectCount; project++) {
    groups.push({
      id: `project-${project}`,
      label: `Project ${project + 1}`,
      parentId: `team-${Math.floor(project / 8)}`,
      data: { kind: "project" },
    });
  }

  // One start offset per project, drawn up front so every task in a project
  // agrees on where its project begins.
  const timelineDays = options.timelineDays ?? 120;
  const projectOffsets = new Float64Array(projectCount);
  for (let project = 0; project < projectCount; project++) {
    projectOffsets[project] = Math.floor(random() * timelineDays) * DAY;
  }

  const tasks: DemoTask[] = [];
  const dependencies: GanttDependency[] = [];

  for (let index = 0; index < taskCount; index++) {
    const project = Math.floor(index / tasksPerProject);
    const withinProject = index % tasksPerProject;
    const groupId = `project-${project}`;

    // Projects are scattered across one fixed calendar window rather than laid
    // end to end: growing the dataset then adds *rows*, which is what the
    // virtualizer is for, instead of stretching the timeline into empty space.
    const projectStart = origin + projectOffsets[project];
    // Tasks are spread over weeks rather than hours, so a project spans a
    // realistic stretch of the calendar and neighbouring tasks overlap enough
    // to need two or three stacking lanes.
    const start = projectStart + withinProject * 3 * DAY + Math.floor(random() * 12) * HOUR;
    const isMilestone = withinProject > 0 && withinProject % 51 === 0;
    const duration = isMilestone ? 0 : (6 + Math.floor(random() * 90)) * HOUR;

    const status = STATUSES[Math.floor(random() * STATUSES.length)];
    tasks.push({
      id: `t${index}`,
      groupId,
      start,
      end: start + duration,
      data: {
        label: isMilestone
          ? `Milestone ${project + 1}.${withinProject}`
          : `Task ${project + 1}.${withinProject + 1}`,
        progress:
          status === "done" ? 1 : status === "planned" ? 0 : Math.round(random() * 90) / 100,
        status,
      },
    });

    if (withDependencies && withinProject > 0 && withinProject % 4 === 0) {
      dependencies.push({ from: `t${index - 1}`, to: `t${index}` });
    }
  }

  return { tasks, groups, dependencies, generatedIn: performance.now() - started };
}

/** Colour a bar by status rather than by group. */
export function statusColor(status: DemoTaskData["status"], dark: boolean): string {
  switch (status) {
    case "done":
      return dark ? "#4ade80" : "#0e9f6e";
    case "active":
      return dark ? "#7aa2f7" : "#3b6fe0";
    case "blocked":
      return dark ? "#f87171" : "#dc2626";
    default:
      return dark ? "#64748b" : "#94a3b8";
  }
}
