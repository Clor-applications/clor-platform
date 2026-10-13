import { useEffect, useState } from 'react';

/**
 * Which columns a list shows.
 *
 * This used to also own named saved views — an arrangement stored under a name
 * with the filters that were on screen when you saved it. That was a bigger
 * idea than the job: what people wanted was to turn a column off. The naming,
 * storing, editing and applying are gone; the column set remains.
 *
 * Persistence is localStorage, keyed per company and list, because which
 * columns you work with is personal and losing it on every refresh would make
 * the control pointless.
 */

const load = (key, fallback) => {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
};

export function useGridView({ storageKey, columns }) {
  const hiddenKey = `${storageKey}:hiddenCols`;

  const [hidden, setHidden] = useState(() => {
    const v = load(hiddenKey, null);
    if (Array.isArray(v)) return v.filter((k) => typeof k === 'string');
    /*
     * First visit on this grid: start from the columns marked `off`.
     *
     * A default has to be a default, not a stored choice — writing it into
     * storage on load would freeze today's default for a user forever, and a
     * column added later would arrive hidden for everybody who had ever
     * opened the screen.
     */
    return (columns || []).filter((c) => c.off && !c.always).map((c) => c.key);
  });

  useEffect(() => {
    try {
      localStorage.setItem(hiddenKey, JSON.stringify(hidden));
    } catch {
      /* storage full or blocked — the session still works, it just forgets */
    }
  }, [hiddenKey, hidden]);

  const isVisible = (key) => {
    const col = columns.find((c) => c.key === key);
    if (col?.always) return true;
    return !hidden.includes(key);
  };

  const toggleColumn = (key) => {
    const col = columns.find((c) => c.key === key);
    if (col?.always) return; // identity and actions columns cannot be hidden
    setHidden((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  };

  /** Back to every column on — the state the list starts in. */
  const resetColumns = () => setHidden([]);

  return { columns, isVisible, toggleColumn, resetColumns, hidden };
}
