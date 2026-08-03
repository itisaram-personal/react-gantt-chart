import type { GanttId, TaskChange } from './types';

export interface HistoryEntry {
  label: string;
  changes: readonly TaskChange[];
}

export interface HistoryOptions {
  /** Entries kept before the oldest is discarded. */
  limit?: number;
}

/**
 * Undo/redo stack for task edits.
 *
 * Stores {@link TaskChange} lists, each of which already carries its own
 * `previous` snapshot, so inverting an entry is a pure transformation — the
 * history never needs a copy of the whole dataset.
 */
export class GanttHistory {
  private readonly undoStack: HistoryEntry[] = [];
  private readonly redoStack: HistoryEntry[] = [];
  private readonly limit: number;

  constructor(options: HistoryOptions = {}) {
    this.limit = Math.max(1, options.limit ?? 100);
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  get depth(): number {
    return this.undoStack.length;
  }

  /** Record an applied change set. Clears the redo branch. */
  push(changes: readonly TaskChange[], label = 'edit'): void {
    if (changes.length === 0) return;
    this.undoStack.push({ label, changes: changes.slice() });
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack.length = 0;
  }

  /** Returns the change set that reverts the last entry, or null. */
  undo(): HistoryEntry | null {
    const entry = this.undoStack.pop();
    if (!entry) return null;
    this.redoStack.push(entry);
    return { label: entry.label, changes: entry.changes.map(invert) };
  }

  /** Returns the change set that re-applies the last undone entry, or null. */
  redo(): HistoryEntry | null {
    const entry = this.redoStack.pop();
    if (!entry) return null;
    this.undoStack.push(entry);
    return entry;
  }

  clear(): void {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
  }
}

function invert(change: TaskChange): TaskChange {
  return {
    id: change.id,
    start: change.previous.start,
    end: change.previous.end,
    groupId: change.previous.groupId,
    previous: { start: change.start, end: change.end, groupId: change.groupId },
  };
}

/** Apply a change set to a task array, returning a new array. */
export function applyChanges<T>(
  tasks: readonly import('./types').GanttTask<T>[],
  changes: readonly TaskChange[],
): import('./types').GanttTask<T>[] {
  if (changes.length === 0) return tasks as import('./types').GanttTask<T>[];
  const byId = new Map<GanttId, TaskChange>();
  for (const change of changes) byId.set(change.id, change);

  return tasks.map((task) => {
    const change = byId.get(task.id);
    if (!change) return task;
    return { ...task, start: change.start, end: change.end, groupId: change.groupId };
  });
}
