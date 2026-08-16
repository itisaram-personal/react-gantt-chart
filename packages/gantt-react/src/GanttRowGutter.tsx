import { useRef, type MouseEvent, type ReactNode } from 'react';
import {
  computeAxisRows,
  shallowEqual,
  type AxisRowDescriptor,
  type GanttEngine,
  type GanttRow,
  type GanttTheme,
} from '@gantt-chart/core';
import type { GanttMenuItem } from './GanttContextMenu';
import { useEngineState } from './useEngineState';
import { useNativeWheel } from './useNativeWheel';

export interface GanttRowGutterProps<T, G> {
  engine: GanttEngine<T, G>;
  theme: GanttTheme;
  width: number;
  /** Replace the default label rendering. */
  renderRow?: (row: AxisRowDescriptor<G>) => ReactNode;
  /**
   * Show the per-row "more options" button. It appears on row hover and on
   * keyboard focus, and opens a `row-options` menu for that row. Default true.
   */
  showRowMenu?: boolean;
  /**
   * Show the per-row enable/disable button, drawn straight after the label. A
   * disabled row keeps its bars on screen but ignores every interaction with
   * them — see {@link GanttRow.disabled}. Default true.
   */
  showRowEnableToggle?: boolean;
  /**
   * Items for that menu. Called once per *visible* row during render purely to
   * decide whether the button is worth showing — return an empty array to leave
   * a row without one — so keep it cheap and free of side effects.
   */
  rowMenuItems?: (row: GanttRow<G>, engine: GanttEngine<T, G>) => GanttMenuItem[];
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
  showRowMenu = true,
  showRowEnableToggle = true,
  rowMenuItems,
}: GanttRowGutterProps<T, G>): JSX.Element {
  const { viewport, hoveredRowIndex, menuRowIndex } = useEngineState(
    engine,
    (state) => ({
      viewport: state.viewport,
      hoveredRowIndex: state.hoveredRowIndex,
      // Any layout change (data, collapse, metrics) reshapes the row list.
      layoutRevision: state.layoutRevision,
      // Disabling a row is deliberately *not* a layout change, so the set is
      // watched on its own to repaint the rows it affects.
      disabled: state.disabled,
      // Which row's options menu is open, so its button stays visible and
      // reports the right `aria-expanded` while the menu is up.
      menuRowIndex:
        state.contextMenu?.kind === 'row-options' ? (state.contextMenu.row?.index ?? null) : null,
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
            hoveredRowIndex === row.row.index && !row.disabled ? 'is-hovered' : '',
            row.disabled ? 'is-disabled' : '',
          ]
            .filter(Boolean)
            .join(' ')}
          style={{ top: row.y, height: row.height }}
          onPointerEnter={() => engine.setHovered(null, row.row.index)}
          onDoubleClick={() => {
            if (row.disabled) return;
            engine.events.emit('row:dblclick', { row: row.row, position: { x: 0, y: row.y } });
          }}
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
              {showRowEnableToggle ? <RowEnableButton engine={engine} row={row} /> : null}
              {/*
                Only asked of a caller-supplied factory: the built-in items are
                never empty, so the default path must not pay for a per-row,
                per-frame call that walks the row's tasks.
              */}
              {showRowMenu && (!rowMenuItems || rowMenuItems(row.row, engine).length > 0) ? (
                <RowMenuButton
                  engine={engine}
                  row={row}
                  open={menuRowIndex === row.row.index}
                />
              ) : null}
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

/**
 * The per-row enable/disable button.
 *
 * Sits directly after the label, and behaves like the options button next to
 * it: revealed on row hover or focus so an untouched gutter stays quiet. The
 * exception is a row that is already off, where the button is the only way back
 * and therefore always visible.
 */
function RowEnableButton<T, G>({
  engine,
  row,
}: {
  engine: GanttEngine<T, G>;
  row: AxisRowDescriptor<G>;
}): JSX.Element {
  const off = row.disabled;
  return (
    <button
      type="button"
      className={`gantt-gutter__power${off ? ' is-off' : ''}`}
      aria-label={off ? `Enable ${row.label}` : `Disable ${row.label}`}
      aria-pressed={!off}
      title={off ? 'Row disabled — interactions ignored' : 'Disable row'}
      onClick={(event) => {
        event.stopPropagation();
        engine.toggleRowDisabled(row.row.group.id);
      }}
      // The row's own double-click means something else entirely.
      onDoubleClick={(event) => event.stopPropagation()}
    >
      {/*
        A forbidden sign in both states — drawn rather than typed, because no
        font ships the glyph reliably. Which state it means is carried by
        colour: muted while the row is on (the action available), accented once
        it is off (the state it is in).
      */}
      <svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true" focusable="false">
        <circle cx="8" cy="8" r="5.6" fill="none" stroke="currentColor" strokeWidth="1.7" />
        <path
          d="M4 4l8 8"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
        />
      </svg>
    </button>
  );
}

/**
 * The per-row "more options" button.
 *
 * Two details earn it a component of its own. It opens the menu with the
 * button's own client rect as the anchor, because a click carries no meaningful
 * plot position the way a right-click does — that rect is what the menu hangs
 * itself off. And it is marked as a menu opener so the menu's outside-click
 * handler leaves its own button alone, which is what makes a second click close
 * the menu rather than close-then-reopen it.
 */
function RowMenuButton<T, G>({
  engine,
  row,
  open,
}: {
  engine: GanttEngine<T, G>;
  row: AxisRowDescriptor<G>;
  open: boolean;
}): JSX.Element {
  const toggle = (event: MouseEvent<HTMLButtonElement>): void => {
    event.stopPropagation();
    if (open) {
      engine.contextMenu.close();
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    engine.contextMenu.open({
      kind: 'row-options',
      // Plot-space position, like every other opener; the anchor is what the
      // menu actually positions from.
      position: { x: 0, y: row.y },
      row: row.row,
      anchor: { x: rect.left, y: rect.top, width: rect.width, height: rect.height },
    });
  };

  return (
    <button
      type="button"
      className={`gantt-gutter__menu${open ? ' is-open' : ''}`}
      data-gantt-menu-opener=""
      aria-label={`More options for ${row.label}`}
      aria-haspopup="menu"
      aria-expanded={open}
      onClick={toggle}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      <span aria-hidden="true">⋯</span>
    </button>
  );
}
