// @vitest-environment jsdom
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { act } from 'react-dom/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import { GanttEngine } from '@gantt-chart/core';
import { installLayout } from '../../gantt-react/test/dom';
import { CREWS, LinkedCharts } from '../src/LinkedCharts';
import { generate } from '../src/data';

/**
 * The linked view, driven through its own DOM.
 *
 * Nothing here reaches for an engine: the demo's captions print what each chart
 * is showing, so reading the three of them back is both the assertion and the
 * thing a visitor is being asked to look at.
 */

const DAY = 86_400_000;

let root: Root | null = null;
let container: HTMLElement | null = null;

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = null;
  container = null;
});

function mount(): HTMLElement {
  installLayout(1000, 300);
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

  container = document.createElement('div');
  document.body.appendChild(container);
  act(() => {
    root = createRoot(container!);
    root.render(
      createElement(LinkedCharts, { dark: true, setDark: () => {}, tabs: null, renderer: 'svg' }),
    );
  });
  return container;
}

/** The "dates" readout of each chart, top to bottom. */
function ranges(host: HTMLElement): string[] {
  return Array.from(host.querySelectorAll('.app__linked-caption')).map((caption) => {
    const value = caption.querySelectorAll('.app__stat strong')[0];
    return value?.textContent ?? '';
  });
}

/** The "rows" readout of each chart, top to bottom. */
function rowWindows(host: HTMLElement): string[] {
  return Array.from(host.querySelectorAll('.app__linked-caption')).map((caption) => {
    const value = caption.querySelectorAll('.app__stat strong')[1];
    return value?.textContent ?? '';
  });
}

function click(host: HTMLElement, label: string): void {
  const button = Array.from(host.querySelectorAll('button')).find(
    (candidate) => candidate.textContent?.trim() === label,
  );
  if (!button) throw new Error(`no button labelled "${label}"`);
  act(() => button.click());
}

function toggle(host: HTMLElement, label: string): void {
  const field = Array.from(host.querySelectorAll('.app__toggle')).find((candidate) =>
    candidate.textContent?.includes(label),
  );
  const input = field?.querySelector('input');
  if (!input) throw new Error(`no toggle labelled "${label}"`);
  act(() => input.click());
}

describe('the linked-charts demo', () => {
  it('is built from three genuinely mismatched datasets', () => {
    // What the captions claim, checked against what the generator produces —
    // the demo makes its point only if the three really do differ.
    const measured = CREWS.map((crew) => {
      const data = generate({
        taskCount: crew.taskCount,
        tasksPerProject: crew.tasksPerProject,
        seed: crew.seed,
        origin: crew.origin,
        timelineDays: crew.timelineDays,
        withDependencies: false,
      });
      const engine = new GanttEngine({ tasks: data.tasks, groups: data.groups, warn: false });
      const [start, end] = engine.getDomain();
      return { rows: data.groups.length, days: (end - start) / DAY };
    });

    expect(measured.map((crew) => crew.rows)).toEqual([5, 34, 68]);

    // Narrowest first, so the window the group adopts is one all three can show.
    expect(measured[0].days).toBeLessThan(measured[1].days);
    expect(measured[1].days).toBeLessThan(measured[2].days);

    // Roughly six weeks, four months and eight months — what the captions claim.
    const [infra, platform, mobile] = measured;
    expect(infra.days).toBeGreaterThan(35);
    expect(infra.days).toBeLessThan(50);
    expect(platform.days).toBeGreaterThan(100);
    expect(platform.days).toBeLessThan(140);
    expect(mobile.days).toBeGreaterThan(210);
    expect(mobile.days).toBeLessThan(270);
  });

  it('opens with all three charts on the same dates', () => {
    const host = mount();
    const [first, second, third] = ranges(host);

    expect(first).not.toBe('');
    expect(second).toBe(first);
    expect(third).toBe(first);
  });

  it('moves the group from a chart nobody touched a zoom bar on', () => {
    const host = mount();
    const before = ranges(host);

    // The widest chart's whole calendar is more than the narrower two can show,
    // so they follow as far as their own domains allow and clamp there.
    click(host, 'All of Mobile');
    const after = ranges(host);
    expect(after[2]).not.toBe(before[2]);
    expect(after[0]).not.toBe(after[2]);

    // A fortnight is inside every domain, so a move on a *third* chart puts all
    // three back on exactly the same dates — the clamping above left no residue.
    click(host, 'Last fortnight');
    const back = ranges(host);
    expect(back[1]).toBe(back[0]);
    expect(back[2]).toBe(back[0]);
  });

  it('shares the row axis as a fraction of each list, not as a row number', () => {
    const host = mount();

    // All three start at the top of their own list. The lists are different
    // lengths, which is the point: a fraction is what can be shared at all.
    expect(rowWindows(host)).toEqual(['from 0% of 5', 'from 0% of 34', 'from 0% of 68']);

    click(host, 'Reset rows');
    expect(rowWindows(host)).toEqual(['from 0% of 5', 'from 0% of 34', 'from 0% of 68']);
  });

  it('lets go of the group when unlinked', () => {
    const host = mount();

    toggle(host, 'Linked');
    click(host, 'All of Mobile');

    const after = ranges(host);
    expect(after[0]).not.toBe(after[2]);

    // Re-linking forms the group again, from the first chart's window.
    toggle(host, 'Linked');
    const relinked = ranges(host);
    expect(relinked[1]).toBe(relinked[0]);
    expect(relinked[2]).toBe(relinked[0]);
  });
});
