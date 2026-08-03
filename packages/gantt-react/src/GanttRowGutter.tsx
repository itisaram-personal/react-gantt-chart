import { useRef, type ReactNode } from 'react';
import {
  computeAxisRows,
  shallowEqual,
  type AxisRowDescriptor,
  type GanttEngine,
  type GanttTheme,
} from '@gantt-chart/core';
import { useEngineState } from './useEngineState';
import { useNativeWheel } from './useNativeWheel';

export interface GanttRowGutterProps<T, G> {
  engine: GanttEngine<T, G>;
  theme: GanttTheme;
  width: number;
  /** Replace the default label rendering. */
  renderRow?: (row: AxisRowDescriptor<G>) => ReactNode;
}

const INDENT_PX = 14;

/**
 * The left-hand row gutter.
 *
 * Rows are absolutely positioned from the engine's virtualized window, so only
 * what is on screen exists in the DOM — the same reason the canvas stays fast at
 * 100 000 tasks. Rendering them as elements (rather than as chart axis labels)
 * is what lets a label carry a real collapse control, hover state and a title.
 */
export function GanttRowGutter<T, G>({
  engine,
  theme,
  width,
  renderRow,
}: GanttRowGutterProps<T, G>): JSX.Element {
  const { viewport, hoveredRowIndex } = useEngineState(
    engine,
    (state) => ({
      viewport: state.viewport,
      hoveredRowIndex: state.hoveredRowIndex,
      // Any layout change (data, collapse, metrics) reshapes the row list.
      layoutRevision: state.layoutRevision,
    }),
    shallowEqual,
  );

  const rows = computeAxisRows(engine.getVisible(), viewport);
  const containerRef = useRef<HTMLDivElement>(null);

  // The gutter has no scroll of its own; it follows the plot's viewport.
  useNativeWheel(containerRef, (event) => {
    event.preventDefault();
    engine.viewport.scrollBy(event.deltaY);
  });

  return (
    <div
      ref={containerRef}
      className="gantt-gutter"
      style={{ width, borderRightColor: theme.colors.border }}
      onPointerLeave={() => engine.setHovered(null, null)}
    >
      {rows.map((row) => (
        <div
          key={row.row.index}
          className={[
            'gantt-gutter__row',
            row.odd ? 'is-odd' : 'is-even',
            hoveredRowIndex === row.row.index ? 'is-hovered' : '',
          ]
            .filter(Boolean)
            .join(' ')}
          style={{ top: row.y, height: row.height }}
          onPointerEnter={() => engine.setHovered(null, row.row.index)}
          onDoubleClick={() => engine.events.emit('row:dblclick', { row: row.row, position: { x: 0, y: row.y } })}
          onContextMenu={(event) => {
            event.preventDefault();
            // Plot-space position, like every other opener; the menu itself
            // positions from the native event.
            engine.contextMenu.open({ kind: 'axis', position: { x: 0, y: row.y }, row: row.row });
          }}
        >
          {renderRow ? (
            renderRow(row)
          ) : (
            <div className="gantt-gutter__label" style={{ paddingLeft: 8 + row.depth * INDENT_PX }}>
              {row.hasChildren ? (
                <button
                  type="button"
                  className={`gantt-gutter__toggle${row.collapsed ? ' is-collapsed' : ''}`}
                  aria-label={row.collapsed ? `Expand ${row.label}` : `Collapse ${row.label}`}
                  aria-expanded={!row.collapsed}
                  onClick={(event) => {
                    event.stopPropagation();
                    engine.toggleCollapse(row.row.group.id);
                  }}
                >
                  <span aria-hidden="true">▾</span>
                </button>
              ) : (
                <span className="gantt-gutter__toggle-spacer" aria-hidden="true" />
              )}
              <span className="gantt-gutter__text" title={row.label}>
                {row.label}
              </span>
              {row.row.laneCount > 1 ? (
                <span className="gantt-gutter__lanes" title={`${row.row.laneCount} lanes`}>
                  {row.row.laneCount}
                </span>
              ) : null}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
