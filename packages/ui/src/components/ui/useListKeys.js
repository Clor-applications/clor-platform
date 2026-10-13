import { useEffect } from 'react';

/**
 * Walk a list from the keyboard.
 *
 * Every other part of the product answers to the keys — a voucher, a line grid,
 * the search — and the lists did not. To open the third invoice you had to
 * leave the keyboard, find it with a mouse and come back, which is the one
 * thing a person keying documents all day should never have to do.
 *
 * A row is not a control, so it cannot simply be given a tab stop each: forty
 * of those between the toolbar and the pagination is forty presses to cross a
 * page. This is the pattern a grid is supposed to use — one tab stop for the
 * whole table, and the arrows move within it.
 *
 *   ↑ ↓        the row above or below
 *   Home End   the first or last row
 *   Enter      open the row, exactly as clicking it does
 *
 * Keystrokes inside a cell's own control are left alone: a checkbox still takes
 * Space, the row menu still takes Enter, and a filter field still takes
 * everything.
 */

const rowsOf = (table) =>
  [...table.querySelectorAll('tbody tr')].filter(
    /* An empty-state row, a skeleton row and a "nothing matches" row are all
       announcements rather than records — arrowing onto one lands nowhere. */
    (tr) => tr.querySelector('td') && !tr.hasAttribute('aria-hidden') && tr.offsetParent !== null
  );

export function useListKeys(dep) {
  useEffect(() => {
    const root = document.getElementById('main-content');
    if (!root) return undefined;

    let frame = 0;

    /** One tab stop for the table, not one per row. */
    const mark = () => {
      frame = 0;
      for (const table of root.querySelectorAll('.ui-table-scroll table')) {
        const rows = rowsOf(table);
        rows.forEach((tr, i) => {
          tr.tabIndex = i === 0 ? 0 : -1;
        });
      }
    };

    const focusRow = (row) => {
      if (!row) return;
      const table = row.closest('table');
      if (table) for (const tr of rowsOf(table)) tr.tabIndex = -1;
      row.tabIndex = 0;
      row.focus();
      row.scrollIntoView({ block: 'nearest' });
    };

    const onKey = (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return;

      const target = e.target;
      if (!(target instanceof HTMLElement)) return;

      /* A control inside the row owns its own keys. */
      const inControl = target.closest(
        'input, select, textarea, button, a, [role="dialog"], [role="listbox"], [role="menu"]'
      );
      if (inControl) return;

      const row = target.closest('tbody tr');
      const table = target.closest('.ui-table-scroll table');
      if (!row || !table) return;

      const rows = rowsOf(table);
      const at = rows.indexOf(row);
      if (at < 0) return;

      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        focusRow(rows[Math.min(rows.length - 1, Math.max(0, at + (e.key === 'ArrowDown' ? 1 : -1)))]);
        return;
      }

      if (e.key === 'Home' || e.key === 'End') {
        e.preventDefault();
        focusRow(e.key === 'Home' ? rows[0] : rows[rows.length - 1]);
        return;
      }

      if (e.key === 'Enter') {
        /* Whatever clicking it does. A list that opens a drawer opens the
           drawer; one that starts an edit starts the edit. */
        e.preventDefault();
        row.click();
      }
    };

    const schedule = () => {
      if (frame) return;
      frame = requestAnimationFrame(mark);
    };

    schedule();
    const observer = new ResizeObserver(schedule);
    observer.observe(root);
    root.addEventListener('keydown', onKey);

    return () => {
      if (frame) cancelAnimationFrame(frame);
      observer.disconnect();
      root.removeEventListener('keydown', onKey);
    };
  }, [dep]);
}

export default useListKeys;
