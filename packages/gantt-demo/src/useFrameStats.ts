import { useEffect, useState } from 'react';
import type { GanttEngine } from '@gantt-chart/core';

export interface FrameStats {
  fps: number;
  /** Bars handed to the renderer in the last sampled frame. */
  visibleItems: number;
  /** Bars that intersected the viewport before the safety cap. */
  candidates: number;
  truncated: boolean;
  rows: number;
}

const SAMPLE_MS = 500;

/**
 * Samples the engine once per animation frame.
 *
 * Reading `getVisible()` is free here: the engine memoizes the frame, so this
 * observes the same object the renderer used rather than recomputing it.
 */
export function useFrameStats(engine: GanttEngine<unknown, unknown> | null): FrameStats {
  const [stats, setStats] = useState<FrameStats>({
    fps: 0,
    visibleItems: 0,
    candidates: 0,
    truncated: false,
    rows: 0,
  });

  useEffect(() => {
    if (!engine) return;
    let handle = 0;
    let frames = 0;
    let windowStart = performance.now();

    const sample = (fps: number): void => {
      const visible = engine.getVisible();
      setStats({
        fps,
        visibleItems: visible.items.length,
        candidates: visible.candidateCount,
        truncated: visible.truncated,
        rows: visible.rows.length,
      });
    };

    // Report the first frame straight away; waiting a whole window would show
    // zeros for half a second on every dataset change.
    sample(0);

    const tick = (): void => {
      frames++;
      const now = performance.now();
      if (now - windowStart >= SAMPLE_MS) {
        sample(Math.round((frames * 1000) / (now - windowStart)));
        frames = 0;
        windowStart = now;
      }
      handle = requestAnimationFrame(tick);
    };

    handle = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(handle);
  }, [engine]);

  return stats;
}
