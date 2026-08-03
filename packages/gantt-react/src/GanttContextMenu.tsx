import { useEffect, useRef } from 'react';
import type { ContextMenuState, GanttEngine, GanttTheme } from '@gantt-chart/core';
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

  const entries = items ? items(menu, engine) : defaultItems(menu, engine);
  if (entries.length === 0) return null;

  // Keep the menu on screen without measuring it: these are its max dimensions.
  const estimated = { width: 200, height: 44 + entries.length * 30 };
  const left =
    typeof window === 'undefined'
      ? point.current.x
      : Math.max(4, Math.min(point.current.x, window.innerWidth - estimated.width - 4));
  const top =
    typeof window === 'undefined'
      ? point.current.y
      : Math.max(4, Math.min(point.current.y, window.innerHeight - estimated.height - 4));

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

  if (items.length > 0) items.push({ id: 'sep-1', separator: true });

  items.push(
    { id: 'select-all', label: 'Select all', onSelect: () => engine.selection.selectAll() },
    {
      id: 'clear-selection',
      label: selectionCount > 0 ? `Clear selection (${selectionCount})` : 'Clear selection',
      disabled: selectionCount === 0,
      onSelect: () => engine.selection.clear(),
    },
    { id: 'sep-2', separator: true },
    { id: 'fit', label: 'Fit to timeline', onSelect: () => engine.viewport.fitTime() },
    { id: 'expand-all', label: 'Expand all groups', onSelect: () => engine.expandAll() },
    { id: 'collapse-all', label: 'Collapse all groups', onSelect: () => engine.collapseAll() },
  );

  return items;
}
