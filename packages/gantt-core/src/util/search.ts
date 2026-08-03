/**
 * Index of the last element in `arr[lo, hi)` whose value is `<= value`,
 * or `lo - 1` when every element is greater.
 */
export function upperBoundIndex(
  arr: ArrayLike<number>,
  value: number,
  lo: number,
  hi: number,
  read: (i: number) => number = (i) => arr[i] as number,
): number {
  let low = lo;
  let high = hi;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (read(mid) <= value) low = mid + 1;
    else high = mid;
  }
  return low - 1;
}

/**
 * Index of the first element in `arr[lo, hi)` whose value is `>= value`,
 * or `hi` when every element is smaller.
 */
export function lowerBoundIndex(
  arr: ArrayLike<number>,
  value: number,
  lo: number,
  hi: number,
  read: (i: number) => number = (i) => arr[i] as number,
): number {
  let low = lo;
  let high = hi;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (read(mid) < value) low = mid + 1;
    else high = mid;
  }
  return low;
}

export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

export function nextPowerOfTwo(n: number): number {
  if (n <= 1) return 1;
  return 1 << (32 - Math.clz32(n - 1));
}
