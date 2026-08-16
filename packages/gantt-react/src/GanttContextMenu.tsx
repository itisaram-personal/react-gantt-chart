import { useEffect, useRef } from 'react';
import type { ContextMenuState, GanttEngine, GanttRow, GanttTheme, Point } from '@gantt-chart/core';
import { useEngineState } from './useEngineState';

export interface GanttMenuItem {
  id: string;
  label?: string;
  disabled?: boolean;
  separator?: boolean;
  onSelect?: () => void;
}

export interface GanttContextMenuProps<T, G> {
  engine: GanttEngine<T, G>;
  theme: GanttTheme;
  /** Replace the default items. Return an empty array to suppress the menu. */
  items?: (state: ContextMenuState<T, G>, engine: GanttEngine<T, G>) => GanttMenuItem[];
  /**
   * Items for a `row-options` menu — the one the row gutter's "more options"
   * button opens. Kept separate from {@link items} so a row's own actions need
   * not be teased back out of a general context-menu state, and so the button
   * and a right-click can offer different things.
   */
  rowItems?: (row: GanttRow<G>, engine: GanttEngine<T, G>) => GanttMenuItem[];
}

/**
 * Context menu for tasks, rows and the background.
 *
 * The engine decides *what* the menu is about (target, position, a snapshot of
 * the selection at open time); this component only draws it. Actions therefore
 * operate on the selection the user saw, not on whatever it became afterwards.
 */
export function GanttContextMenu<T, G>({
  engine,
  theme,
  items,
  rowItems,
}: GanttContextMenuProps<T, G>): JSX.Element | null {
  const menu = useEngineState(engine, (state) => state.contextMenu);
  const ref = useRef<HTMLDivElement>(null);
  const point = useRef({ x: 0, y: 0 });

  /*
   * `ContextMenuState.position` is in plot pixels — the right coordinate space
   * for the engine, the wrong one for a fixed-position element that may have
   * been opened over the row gutter instead. Recording the native event in the
   * capture phase gives one client-space position for every opener, whatever
   * part of the widget it came from.
   */
  useEffect(() => {
    const record = (event: MouseEvent): void => {
      point.current = { x: event.clientX, y: event.clientY };
    };
    document.addEventListener('contextmenu', record, true);
    return () => document.removeEventListener('contextmenu', record, true);
  }, []);

  useEffect(() => {
    if (!menu) return;
    const close = (event: Event): void => {
      if (ref.current && event.target instanceof Node && ref.current.contains(event.target)) return;
      /*
       * A press on the control that opens a menu is that control's business.
       * Closing here would beat its click handler to it, so a second click on
       * the same button would close and immediately reopen instead of toggling.
       */
      if (event.target instanceof Element && event.target.closest('[data-gantt-menu-opener]')) return;
      engine.contextMenu.close();
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') engine.contextMenu.close();
    };

    const onBlur = (): void => engine.contextMenu.close();

    // `capture` so the menu closes before another handler acts on the click.
    document.addEventListener('pointerdown', close, true);
    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('blur', onBlur);
    return () => {
      document.removeEventListener('pointerdown', close, true);
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('blur', onBlur);
    };
  }, [engine, menu]);

  if (!menu) return null;

  const entries =
    menu.kind === 'row-options' && menu.row
      ? (rowItems ?? defaultRowItems)(menu.row, engine)
      : items
        ? items(menu, engine)
        : defaultItems(menu, engine);
  if (entries.length === 0) return null;

  const { left, top } = place(menu, point.current, entries.length);

  return (
    <div
      ref={ref}
      className="gantt-menu"
      role="menu"
      style={{
        left,
        top,
        background: theme.dark ? theme.colors.rowOdd : theme.colors.background,
        color: theme.colors.text,
        borderColor: theme.colors.border,
        font: `${theme.font.size}px ${theme.font.family}`,
      }}
    >
      {entries.map((item, index) =>
        item.separator ? (
          <div key={item.id || `sep-${index}`} className="gantt-menu__separator" role="separator" />
        ) : (
          <button
            key={item.id}
            type="button"
            role="menuitem"
            className="gantt-menu__item"
            disabled={item.disabled}
            onClick={() => {
              item.onSelect?.();
              engine.contextMenu.close();
            }}
          >
            {item.label}
          </button>
        ),
      )}
    </div>
  );
}

/**
 * Where to draw the menu, in client pixels.
 *
 * Two openers, two rules. A right-click has a pointer position and the menu
 * hangs off it, top-left first. A button has a box instead: the menu drops below
 * it, right-aligned so it grows back over the gutter rather than out across the
 * plot, and flips above when the bottom of the window is closer than its own
 * height. Either way the result is clamped into view, without measuring — these
 * are the menu's maximum dimensions.
 */
function place(
  menu: ContextMenuState<unknown, unknown>,
  point: Point,
  itemCount: number,
): { left: number; top: number } {
  const estimated = { width: 200, height: 44 + itemCount * 30 };
  const anchor = menu.anchor;
  const room = typeof window === 'undefined' ? null : { width: window.innerWidth, height: window.innerHeight };

  let left = anchor ? anchor.x + anchor.width - estimated.width : point.x;
  let top = anchor ? anchor.y + anchor.height + 2 : point.y;

  if (anchor && room && top + estimated.height > room.height - 4) {
    top = anchor.y - estimated.height - 2;
  }
  if (room) {
    left = Math.max(4, Math.min(left, room.width - estimated.width - 4));
    top = Math.max(4, Math.min(top, room.height - estimated.height - 4));
  }
  return { left, top };
}

/** A useful default set, derived from what the menu was opened on. */
function defaultItems<T, G>(
  menu: ContextMenuState<T, G>,
  engine: GanttEngine<T, G>,
): GanttMenuItem[] {
  const items: GanttMenuItem[] = [];
  const selectionCount = menu.selection.length;

  if (menu.task) {
    items.push({
      id: 'zoom-task',
      label: 'Zoom to task',
      onSelect: () => engine.viewport.scrollTaskIntoView(menu.task!.id),
    });
  }

  if (menu.row?.hasChildren) {
    items.push({
      id: 'toggle-row',
      label: menu.row.collapsed ? 'Expand group' : 'Collapse group',
      onSelect: () => engine.toggleCollapse(menu.row!.group.id),
    });
  }

  if (menu.row) {
    items.push({
      id: 'toggle-row-disabled',
      label: menu.row.disabled ? 'Enable row' : 'Disable row',
      onSelect: () => engine.toggleRowDisabled(menu.row!.group.id),
    });
  }

  if (items.length > 0) items.push({ id: 'sep-1', separator: true });

  // A chart with selection switched off gets no selection items at all: the
  // engine would refuse them anyway, and offering them is a false promise.
  if (engine.getOptions().interaction.selection) {
    items.push(
      { id: 'select-all', label: 'Select all', onSelect: () => engine.selection.selectAll() },
      {
        id: 'clear-selection',
        label: selectionCount > 0 ? `Clear selection (${selectionCount})` : 'Clear selection',
        disabled: selectionCount === 0,
        onSelect: () => engine.selection.clear(),
      },
      { id: 'sep-2', separator: true },
    );
  }

  items.push(
    { id: 'fit', label: 'Fit to timeline', onSelect: () => engine.viewport.fitTime() },
    { id: 'expand-all', label: 'Expand all groups', onSelect: () => engine.expandAll() },
    { id: 'collapse-all', label: 'Collapse all groups', onSelect: () => engine.collapseAll() },
  );

  return items;
}

/**
 * Defaults for the row gutter's "more options" button.
 *
 * Everything here is scoped to the one row the button belongs to — the global
 * actions stay on the right-click menu. `Zoom to row` reads the row's own time
 * span rather than calling `fitTime`, which would frame the whole dataset.
 */
function defaultRowItems<T, G>(row: GanttRow<G>, engine: GanttEngine<T, G>): GanttMenuItem[] {
  const items: GanttMenuItem[] = [];

  if (row.hasChildren) {
    items.push({
      id: 'toggle-row',
      label: row.collapsed ? 'Expand group' : 'Collapse group',
      onSelect: () => engine.toggleCollapse(row.group.id),
    });
  }

  items.push({
    id: 'toggle-row-disabled',
    label: row.disabled ? 'Enable row' : 'Disable row',
    onSelect: () => engine.toggleRowDisabled(row.group.id),
  });

  const tasks = engine.getTasks();
  const indices = taskIndicesInRow(engine, row);
  const empty = indices.length === 0;

  items.push(
    {
      id: 'select-row',
      label: empty ? 'Select tasks in row' : `Select ${indices.length} task${indices.length === 1 ? '' : 's'}`,
      // Selecting into an inert row would hand back exactly the interaction the
      // row opted out of, and a chart with selection off has none to give. A
      // disabled row that still takes input is offered like any other.
      disabled: empty || row.inert || !engine.getOptions().interaction.selection,
      onSelect: () => engine.selection.set(indices.map((index) => tasks[index].id)),
    },
    {
      id: 'zoom-row',
      label: 'Zoom to row',
      disabled: empty,
      onSelect: () => {
        let start = Infinity;
        let end = -Infinity;
        for (const index of indices) {
          const task = tasks[index];
          if (task.start < start) start = task.start;
          if (task.end > end) end = task.end;
        }
        if (start > end) return;
        // A hair of padding, so the outermost bars are not flush to the edges.
        const pad = (end - start) * 0.02;
        engine.viewport.setTimeRange(start - pad, end + pad);
      },
    },
  );

  return items;
}

/**
 * Task indices displayed on a row.
 *
 * Read from the layout's CSR slice rather than by filtering every task, so the
 * cost is the size of the row and not the size of the dataset.
 */
function taskIndicesInRow<T, G>(engine: GanttEngine<T, G>, row: GanttRow<G>): number[] {
  const layout = engine.getLayout();
  // The row is a snapshot from open time; a data change since then can leave its
  // index pointing past the end of the current layout.
  if (row.index < 0 || row.index >= layout.rows.length) return [];

  const out: number[] = [];
  for (let rank = layout.rowOffsets[row.index]; rank < layout.rowOffsets[row.index + 1]; rank++) {
    out.push(layout.rankToTask[rank]);
  }
  return out;
}
