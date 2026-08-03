import { describe, expect, it } from 'vitest';
import { lightTheme } from '@gantt-chart/themes';
import { buildGanttOption } from '../src/option';
import { dependenciesPlugin, type GanttDependency } from '../src/plugins/dependencies';
import type { GanttElement } from '../src/elements';
import { fixture, flatten, ofType } from './helpers';

function overlayElements(engine: Parameters<typeof buildGanttOption>[0]['engine']) {
  const option = buildGanttOption({ engine, theme: lightTheme, now: null });
  const series = option.series.find((entry) => entry.id === 'gantt-overlay');
  if (!series) return [];
  return flatten(series.renderItem({ dataIndex: 0 }, null) as GanttElement);
}

describe('dependenciesPlugin', () => {
  it('draws one connector per link between visible bars', () => {
    const { engine } = fixture({ groups: 2, tasksPerGroup: 3 });
    const dependencies: GanttDependency[] = [
      { from: 'g0-t0', to: 'g0-t1' },
      { from: 'g0-t1', to: 'g1-t2' },
    ];
    engine.use(dependenciesPlugin({ dependencies, theme: lightTheme }));

    const elements = overlayElements(engine);
    expect(ofType(elements, 'polyline')).toHaveLength(2);
    // Every connector gets an arrow head.
    expect(ofType(elements, 'polygon')).toHaveLength(2);
  });

  it('routes finish-to-start from the source right edge to the target left edge', () => {
    const { engine } = fixture({ groups: 1, tasksPerGroup: 2 });
    engine.use(dependenciesPlugin({ dependencies: [{ from: 'g0-t0', to: 'g0-t1' }], theme: lightTheme }));

    const from = engine.getTaskRect('g0-t0')!;
    const to = engine.getTaskRect('g0-t1')!;
    const points = (ofType(overlayElements(engine), 'polyline')[0].shape as {
      points: [number, number][];
    }).points;

    expect(points[0]).toEqual([from.x + from.width, from.y + from.height / 2]);
    expect(points[points.length - 1]).toEqual([to.x, to.y + to.height / 2]);
  });

  it('honours the other dependency kinds', () => {
    const { engine } = fixture({ groups: 1, tasksPerGroup: 2 });
    const from = engine.getTaskRect('g0-t0')!;
    const to = engine.getTaskRect('g0-t1')!;

    const plugin = dependenciesPlugin({ theme: lightTheme });
    engine.use(plugin);

    plugin.setDependencies([{ from: 'g0-t0', to: 'g0-t1', kind: 'start-start' }]);
    let points = (ofType(overlayElements(engine), 'polyline')[0].shape as {
      points: [number, number][];
    }).points;
    expect(points[0][0]).toBe(from.x);
    expect(points[points.length - 1][0]).toBe(to.x);

    plugin.setDependencies([{ from: 'g0-t0', to: 'g0-t1', kind: 'finish-finish' }]);
    points = (ofType(overlayElements(engine), 'polyline')[0].shape as {
      points: [number, number][];
    }).points;
    expect(points[0][0]).toBe(from.x + from.width);
    expect(points[points.length - 1][0]).toBe(to.x + to.width);
  });

  it('skips links whose endpoints are not displayed', () => {
    const { engine } = fixture({ groups: 2, tasksPerGroup: 2, nested: true });
    engine.use(
      dependenciesPlugin({
        dependencies: [{ from: 'g0-t0', to: 'g1-t0' }],
        theme: lightTheme,
      }),
    );
    expect(ofType(overlayElements(engine), 'polyline')).toHaveLength(1);

    // Collapsing g0 rolls g1's tasks onto g0's row, so both rects still exist;
    // turning rollup off removes the target from the layout entirely.
    engine.setOptions({ stacking: { rollupCollapsed: false } });
    engine.setCollapsed('g0', true);
    expect(engine.getTaskRect('g1-t0')).toBeNull();
    expect(ofType(overlayElements(engine), 'polyline')).toHaveLength(0);
  });

  it('draws nothing for an unknown task id', () => {
    const { engine } = fixture({ groups: 1, tasksPerGroup: 1 });
    engine.use(
      dependenciesPlugin({ dependencies: [{ from: 'g0-t0', to: 'ghost' }], theme: lightTheme }),
    );
    expect(ofType(overlayElements(engine), 'polyline')).toHaveLength(0);
  });

  it('deduplicates a link whose both ends are visible', () => {
    const { engine } = fixture({ groups: 1, tasksPerGroup: 2 });
    engine.use(dependenciesPlugin({ dependencies: [{ from: 'g0-t0', to: 'g0-t1' }], theme: lightTheme }));
    // Both endpoints are on screen, so the link is reachable twice.
    expect(ofType(overlayElements(engine), 'polyline')).toHaveLength(1);
  });

  it('caps the number of links drawn in one frame', () => {
    const { engine } = fixture({ groups: 4, tasksPerGroup: 4 });
    const dependencies: GanttDependency[] = [];
    for (let g = 0; g < 4; g++) {
      for (let t = 0; t < 3; t++) dependencies.push({ from: `g${g}-t${t}`, to: `g${g}-t${t + 1}` });
    }
    engine.use(dependenciesPlugin({ dependencies, theme: lightTheme, maxLinks: 5 }));
    expect(ofType(overlayElements(engine), 'polyline').length).toBeLessThanOrEqual(5);
  });

  it('takes its colour from the theme, per-link overrides winning', () => {
    const { engine } = fixture({ groups: 1, tasksPerGroup: 3 });
    engine.use(
      dependenciesPlugin({
        theme: lightTheme,
        dependencies: [
          { from: 'g0-t0', to: 'g0-t1' },
          { from: 'g0-t1', to: 'g0-t2', color: '#ff00ff' },
        ],
      }),
    );

    const strokes = ofType(overlayElements(engine), 'polyline').map(
      (line) => (line.style as Record<string, string>).stroke,
    );
    expect(strokes).toContain(lightTheme.colors.dependencyLine);
    expect(strokes).toContain('#ff00ff');
  });

  it('stops contributing once uninstalled', () => {
    const { engine } = fixture({ groups: 1, tasksPerGroup: 2 });
    const dispose = engine.use(
      dependenciesPlugin({ dependencies: [{ from: 'g0-t0', to: 'g0-t1' }], theme: lightTheme }),
    );
    expect(engine.overlays.size).toBe(1);

    dispose();
    expect(engine.overlays.size).toBe(0);
    expect(overlayElements(engine)).toEqual([]);
  });

  it('refuses a second installation under the same name', () => {
    const { engine } = fixture();
    engine.use(dependenciesPlugin());
    expect(() => engine.use(dependenciesPlugin())).toThrow(/already installed/);
  });
});
