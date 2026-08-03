import { nextPowerOfTwo } from './search';

/**
 * Interval-partitioning lane allocator backed by a min segment tree over the
 * per-lane "last occupied time".
 *
 * Tasks must be offered in ascending start order. For each task the allocator
 * returns the *lowest-indexed* free lane, which is the optimal colouring for
 * interval graphs (first-fit by left endpoint) and — unlike the common
 * "earliest-freeing lane" heap variant — keeps the layout visually stable when
 * the data changes slightly.
 *
 * `allocate` is O(log lanes), so a row with 100 000 mutually overlapping tasks
 * still stacks in O(n log n) rather than the O(n·lanes) of a linear scan.
 */
export class LaneAllocator {
  private capacity: number;
  /** Min-of-subtree tree; leaves live at [capacity, 2*capacity). */
  private tree: Float64Array;
  /** Highest lane index ever handed out during the current run, plus one. */
  private used = 0;

  constructor(initialCapacity = 16) {
    this.capacity = nextPowerOfTwo(Math.max(1, initialCapacity));
    this.tree = new Float64Array(this.capacity * 2).fill(-Infinity);
  }

  /** Lanes handed out since the last {@link reset}. */
  get laneCount(): number {
    return this.used;
  }

  /**
   * Claim the lowest lane whose last occupied time is `<= key`.
   *
   * @param key    Query time — normally `task.start - minGap`.
   * @param end    Time the claimed lane stays busy until.
   * @param maxLanes Ceiling; tasks that would exceed it are packed into the
   *                 last lane and overlap visually.
   */
  allocate(key: number, end: number, maxLanes: number): number {
    if (this.tree[1] > key) {
      // Every existing lane is busy. Grow unless we have hit the ceiling.
      if (this.capacity >= maxLanes) {
        const lane = maxLanes - 1;
        this.setLane(lane, Math.max(end, this.leafValue(lane)));
        return lane;
      }
      this.grow(Math.min(this.capacity * 2, nextPowerOfTwo(maxLanes)));
    }

    // Descend to the leftmost leaf that satisfies the predicate.
    let node = 1;
    while (node < this.capacity) {
      node = this.tree[node * 2] <= key ? node * 2 : node * 2 + 1;
    }
    const lane = node - this.capacity;

    if (lane >= maxLanes) {
      const clamped = maxLanes - 1;
      this.setLane(clamped, Math.max(end, this.leafValue(clamped)));
      return clamped;
    }

    this.setLane(lane, end);
    if (lane + 1 > this.used) this.used = lane + 1;
    return lane;
  }

  /** Pin a task to an explicit lane (used for `task.lane`). */
  occupy(lane: number, end: number, maxLanes: number): number {
    const target = Math.min(Math.max(0, lane | 0), maxLanes - 1);
    if (target >= this.capacity) this.grow(nextPowerOfTwo(target + 1));
    this.setLane(target, Math.max(end, this.leafValue(target)));
    if (target + 1 > this.used) this.used = target + 1;
    return target;
  }

  /** Clear only the lanes touched since the last reset. */
  reset(): void {
    if (this.used === 0) return;
    let lo = this.capacity;
    let hi = this.capacity + this.used - 1;
    this.tree.fill(-Infinity, lo, hi + 1);
    while (lo > 1) {
      lo >>= 1;
      hi >>= 1;
      for (let i = lo; i <= hi; i++) {
        const left = this.tree[i * 2];
        const right = this.tree[i * 2 + 1];
        this.tree[i] = left < right ? left : right;
      }
    }
    this.used = 0;
  }

  private leafValue(lane: number): number {
    return this.tree[this.capacity + lane];
  }

  private setLane(lane: number, value: number): void {
    let node = this.capacity + lane;
    this.tree[node] = value;
    node >>= 1;
    while (node >= 1) {
      const left = this.tree[node * 2];
      const right = this.tree[node * 2 + 1];
      const min = left < right ? left : right;
      if (this.tree[node] === min) break;
      this.tree[node] = min;
      node >>= 1;
    }
  }

  private grow(capacity: number): void {
    const next = Math.max(nextPowerOfTwo(capacity), this.capacity * 2);
    const tree = new Float64Array(next * 2).fill(-Infinity);
    // Copy the old leaves, then rebuild the internal nodes bottom-up.
    tree.set(this.tree.subarray(this.capacity, this.capacity * 2), next);
    for (let i = next - 1; i >= 1; i--) {
      const left = tree[i * 2];
      const right = tree[i * 2 + 1];
      tree[i] = left < right ? left : right;
    }
    this.capacity = next;
    this.tree = tree;
  }
}

/**
 * Zero-length tasks (milestones) are widened by this amount for stacking so
 * that two milestones at the same instant land in different lanes. It is far
 * below the resolution of any realistic time axis, so it never shifts a bar.
 */
export const MILESTONE_EPSILON = 1e-6;
