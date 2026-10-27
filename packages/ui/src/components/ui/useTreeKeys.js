import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * The keyboard for an outline drawn as a tree (WAI-ARIA Tree View pattern):
 * one tab stop for the whole tree, then
 *
 *   ↓ ↑          next and previous row that is showing
 *   →            open a closed row; on an open one, go to its first child
 *   ←            close an open row; on a closed one, go to its parent
 *   Home / End   first and last row
 *   Enter        open the row's record, where it has one
 *   a–z          next row starting with that letter
 *
 * Rows are `[role="treeitem"]` elements with `data-id`, an optional
 * `data-label` (for the letter jump), `data-opens` when Enter opens something,
 * and `data-parent` where the parent is not the row's DOM ancestor (a flat
 * outline). `aria-expanded` says whether a row has children and is open.
 */
export function useTreeKeys({ onExpand, onCollapse, onOpen }) {
  const ref = useRef(null);
  const [active, setActive] = useState(null);

  const rows = () => [...(ref.current?.querySelectorAll('[role="treeitem"]') || [])];
  const go = (el) => {
    if (!el) return;
    setActive(el.dataset.id);
    el.focus({ preventScroll: false });
  };

  /* Exactly one row is reachable with Tab: the last one used, or the first. */
  useEffect(() => {
    const list = rows();
    if (!list.length) return;
    const current = list.find((x) => x.dataset.id === active) || list[0];
    for (const x of list) x.tabIndex = x === current ? 0 : -1;
  });

  const onKeyDown = useCallback((e) => {
    const el = e.target.closest?.('[role="treeitem"]');
    if (!el || e.target !== el || !ref.current?.contains(el)) return;
    const list = rows();
    const i = list.indexOf(el);
    const id = el.dataset.id;
    const expanded = el.getAttribute('aria-expanded');
    const parentOf = () => (el.dataset.parent ? list.find((x) => x.dataset.id === el.dataset.parent) : el.parentElement?.closest('[role="treeitem"]'));
    switch (e.key) {
      case 'ArrowDown': go(list[i + 1]); break;
      case 'ArrowUp': go(list[i - 1]); break;
      case 'Home': go(list[0]); break;
      case 'End': go(list[list.length - 1]); break;
      case 'ArrowRight':
        if (expanded === 'false') onExpand?.(id);
        else if (expanded === 'true') go(el.querySelector('[role="group"] [role="treeitem"]') || list[i + 1]);
        break;
      case 'ArrowLeft':
        if (expanded === 'true') onCollapse?.(id);
        else go(parentOf());
        break;
      case 'Enter':
        if (!el.dataset.opens) return;
        onOpen?.(id);
        break;
      default: {
        if (e.key.length !== 1 || !/\S/.test(e.key) || e.ctrlKey || e.metaKey || e.altKey) return;
        const c = e.key.toLowerCase();
        go([...list.slice(i + 1), ...list.slice(0, i + 1)].find((x) => (x.dataset.label || '').toLowerCase().startsWith(c)));
      }
    }
    e.preventDefault();
  }, [onExpand, onCollapse, onOpen]);

  /* A row focused by the pointer becomes the tab stop. */
  const onFocus = useCallback((e) => {
    const el = e.target.closest?.('[role="treeitem"]');
    if (el && e.target === el) setActive(el.dataset.id);
  }, []);

  return { ref, onKeyDown, onFocus };
}
