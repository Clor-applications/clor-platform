import { useEffect } from 'react';

/**
 * Round 26 pick: move down a list with the keyboard the Gmail way. J moves to
 * the next row, K to the one before, Enter opens it (the row's open button has
 * the focus), and A approves the row when it has a tick button. Keys are left
 * alone while typing in a field, with Ctrl/Alt/Cmd held, or in Books.
 *
 * `ref` is a box around a DataTable; rows are found by their `.ui-row-open`
 * button (or `.ui-card-open` on phones).
 */
const TYPING = 'input, textarea, select, [contenteditable=""], [contenteditable="true"]';

export function rowsIn(box) {
  if (!box) return [];
  const all = [...box.querySelectorAll('.ui-row-open, .ui-card-open')];
  const seen = all.filter((b) => b.getClientRects().length > 0);
  /* The table and the phone cards are both in the page, one hidden by width; with no layout (tests) use the table rows. */
  return seen.length ? seen : all.filter((b) => b.classList.contains('ui-row-open'));
}

export default function useJkList(ref, { enabled = true } = {}) {
  useEffect(() => {
    if (!enabled) return undefined;
    const onKey = (e) => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
      if (document.documentElement.dataset.palette === 'indigo') return;
      const t = e.target;
      if (t && t.closest && t.closest(TYPING)) return;
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
      const key = String(e.key || '').toLowerCase();
      if (key !== 'j' && key !== 'k' && key !== 'a') return;
      const box = ref.current;
      const rows = rowsIn(box);
      if (!rows.length) return;
      const at = rows.findIndex((b) => b === document.activeElement || b.closest('tr, li, .ui-card')?.contains(document.activeElement));
      if (key === 'a') {
        if (at < 0) return;
        const row = rows[at].closest('tr') || rows[at].parentElement;
        const yes = row && row.querySelector('.ui-decide-btn.is-yes:not([disabled])');
        if (!yes) return;
        e.preventDefault();
        yes.click();
        return;
      }
      e.preventDefault();
      const next = key === 'j' ? (at < 0 ? 0 : Math.min(rows.length - 1, at + 1)) : (at < 0 ? 0 : Math.max(0, at - 1));
      rows[next].focus();
      if (rows[next].scrollIntoView) rows[next].scrollIntoView({ block: 'nearest' });
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [ref, enabled]);
}
