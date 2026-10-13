import { useCallback, useMemo, useState } from 'react';

/**
 * What this operator picks, on this machine.
 *
 * A shop invoices the same fifteen customers all week and the picker made
 * them scroll an alphabetical list of nine hundred every time. The sheet asks
 * for recently and frequently used at the top; this is both, since neither
 * alone is right — recency alone loses the regular you happened not to bill
 * yesterday, frequency alone freezes the list against a new account.
 *
 * Local to the browser on purpose. It is a convenience, not a record: it must
 * never be something the books depend on, and it must never travel to another
 * user as if it were their habit.
 */

const KEY = 'pickerRecents:v1';
const MAX_PER_KIND = 40;
/** Above this the score is dominated by history and a new pick can't surface. */
const MAX_COUNT = 25;

const readAll = () => {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    // A corrupt or unavailable store is not worth failing a form over.
    return {};
  }
};

const writeAll = (next) => {
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Private mode, quota, disabled storage — the picker still works.
  }
};

/**
 * @param kind  which list this is — 'customer', 'item', 'vendor', 'account'
 * @param scope the company the picks belong to, so two books never blend
 */
export function useRecentPicks(kind, scope = '') {
  const bucket = `${String(kind || '')}:${String(scope || '')}`;
  const [entries, setEntries] = useState(() => readAll()[bucket] || {});

  const remember = useCallback(
    (id) => {
      const key = String(id ?? '').trim();
      if (!key) return;
      const all = readAll();
      const mine = { ...(all[bucket] || {}) };
      const prev = mine[key] || { n: 0, at: 0 };
      mine[key] = { n: Math.min(MAX_COUNT, Number(prev.n || 0) + 1), at: Date.now() };

      // Trim by recency, so the list cannot grow without bound on a machine
      // that has been in use for two years.
      const trimmed = Object.entries(mine)
        .sort((a, b) => Number(b[1]?.at || 0) - Number(a[1]?.at || 0))
        .slice(0, MAX_PER_KIND);

      const next = Object.fromEntries(trimmed);
      writeAll({ ...all, [bucket]: next });
      setEntries(next);
    },
    [bucket]
  );

  /**
   * Sort `rows` so the habitual ones lead, keeping the caller's order for
   * everything with no history. Only applied to an unfiltered list — once
   * somebody is typing, what they typed decides the order, not what they
   * picked last Tuesday.
   */
  const promote = useCallback(
    (rows, idOf = (r) => r?.id) => {
      const list = Array.isArray(rows) ? rows : [];
      if (!list.length) return list;
      const scoreOf = (r) => {
        const e = entries[String(idOf(r) ?? '')];
        if (!e) return 0;
        // Frequency, with recency as the tie-break: five picks beats two, and
        // two picks today beats two picks last month.
        const days = Math.max(0, (Date.now() - Number(e.at || 0)) / 86400000);
        return Number(e.n || 0) * 10 + Math.max(0, 30 - days) / 30;
      };
      return list
        .map((row, index) => ({ row, index, score: scoreOf(row) }))
        .sort((a, b) => (b.score !== a.score ? b.score - a.score : a.index - b.index))
        .map((x) => x.row);
    },
    [entries]
  );

  const hasHistory = useMemo(() => Object.keys(entries).length > 0, [entries]);
  const isRecent = useCallback((id) => Boolean(entries[String(id ?? '')]), [entries]);

  /**
   * How many of the promoted rows are actually habitual, so the list can say
   * "Recently used" over them and "All" over the rest.
   *
   * Capped: a heading over eleven of twelve rows is a heading that tells you
   * nothing, and the point of the section is that the top of the list is
   * short enough to read without scrolling.
   */
  const recentCount = useCallback(
    (rows, idOf = (r) => r?.id) => {
      const list = Array.isArray(rows) ? rows : [];
      let n = 0;
      while (n < list.length && n < 5 && entries[String(idOf(list[n]) ?? '')]) n += 1;
      // A heading over the whole list is noise, not structure.
      return n >= list.length ? 0 : n;
    },
    [entries]
  );

  return { remember, promote, hasHistory, isRecent, recentCount };
}

export default useRecentPicks;
