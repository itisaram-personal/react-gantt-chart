import { describe, expect, it } from 'vitest';
import { GanttEngine } from '../src/GanttEngine';
import { normalize } from '../src/data/dataModel';
import { computeLayout } from '../src/engine/layout';
import { resolveRows } from '../src/engine/rows';
import { defaultOptions } from '../src/defaults';
import { generate } from './helpers';

/**
 * Budgets are deliberately loose — they are regression guards, not benchmarks.
 * The point is that each stage stays in its intended complexity class: layout
 * is O(n log n) once per data change, and a frame is O(visible), not O(n).
 */
const TASK_COUNT = 100_000;

describe('100K items', () => {
  const { tasks, groups } = generate({
    groupCount: 500,
    tasksPerGroup: TASK_COUNT / 500,
    seed: 2024,
    domain: [0, 5_000_000],
    maxDuration: 20_000,
  });

  it(
    'normalizes and lays out 100K tasks in one pass',
    () => {
      // Timed against the raw pipeline rather than the engine: the engine
      // computes its layout eagerly on construction and would then serve a
      // cache hit, which measures nothing.
      const startNormalize = performance.now();
      const { model } = normalize(tasks, groups, 1);
      const normalizeMs = performance.now() - startNormalize;

      const startLayout = performance.now();
      const rowModel = resolveRows(model, new Set(), true);
      const layout = computeLayout(model, rowModel, defaultOptions, 1);
      const layoutMs = performance.now() - startLayout;

      expect(layout.rankToTask.length).toBe(TASK_COUNT);
      expect(layout.rows.length).toBe(500);
      expect(layout.totalHeight).toBeGreaterThan(0);

      console.log(`normalize(100K): ${normalizeMs.toFixed(1)}ms, layout+stack(100K): ${layoutMs.toFixed(1)}ms`);
      expect(normalizeMs + layoutMs).toBeLessThan(5000);
    },
    30_000,
  );

  it(
    'builds a frame in time proportional to what is on screen, not to the dataset',
    () => {
      const engine = new GanttEngine({
        tasks,
        groups,
        size: { width: 1200, height: 800 },
        options: { minTimeSpan: 1 },
      });
      engine.getLayout();
      // A window wide enough to put a realistic number of bars on screen.
      engine.viewport.setTimeRange(1_000_000, 2_000_000);

      // Warm up, then measure a pan-like sequence of distinct frames.
      engine.getVisible();
      const frames = 60;
      const started = performance.now();
      for (let i = 0; i < frames; i++) {
        engine.viewport.panByPx(7);
        engine.getVisible();
      }
      const perFrame = (performance.now() - started) / frames;

      const window = engine.getVisible();
      console.log(
        `frame: ${perFrame.toFixed(2)}ms for ${window.items.length} of ${TASK_COUNT} bars`,
      );

      expect(window.items.length).toBeLessThan(TASK_COUNT / 10);
      expect(perFrame).toBeLessThan(16);
    },
    30_000,
  );

  it(
    'answers hit tests without scanning the dataset',
    () => {
      const engine = new GanttEngine({
        tasks,
        groups,
        size: { width: 1200, height: 800 },
        options: { minTimeSpan: 1 },
      });
      engine.viewport.setTimeRange(0, 200_000);

      const started = performance.now();
      let hits = 0;
      for (let i = 0; i < 2000; i++) {
        const result = engine.hitTest({ x: (i * 13) % 1200, y: (i * 7) % 800 });
        if (result.task) hits++;
      }
      const elapsed = performance.now() - started;

      console.log(`hitTest x2000: ${elapsed.toFixed(1)}ms (${hits} hits)`);
      expect(elapsed).toBeLessThan(500);
    },
    30_000,
  );

  it(
    'keeps selection operations off the hot path',
    () => {
      const engine = new GanttEngine({
        tasks,
        groups,
        size: { width: 1200, height: 800 },
        options: { minTimeSpan: 1 },
      });

      const started = performance.now();
      engine.selection.selectAll();
      const elapsed = performance.now() - started;

      expect(engine.selection.selected.size).toBe(TASK_COUNT);
      console.log(`selectAll(100K): ${elapsed.toFixed(1)}ms`);
      expect(elapsed).toBeLessThan(2000);
    },
    30_000,
  );

  it(
    'stacks a single row of 20K mutually overlapping tasks',
    () => {
      // The pathological case for lane allocation: every task overlaps every
      // other, so a linear lane scan would be O(n^2).
      const dense = Array.from({ length: 20_000 }, (_, i) => ({
        id: i,
        groupId: 'dense',
        start: i,
        end: 1_000_000,
      }));

      const started = performance.now();
      const engine = new GanttEngine({ tasks: dense, options: { minTimeSpan: 1, stacking: { maxLanes: 32_000 } } });
      const layout = engine.getLayout();
      const elapsed = performance.now() - started;

      expect(layout.rows[0].laneCount).toBe(20_000);
      console.log(`dense stacking(20K in one row): ${elapsed.toFixed(1)}ms`);
      expect(elapsed).toBeLessThan(5000);
    },
    30_000,
  );
});
