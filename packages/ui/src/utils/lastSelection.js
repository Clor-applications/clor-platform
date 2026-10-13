/**
 * The choice this operator made last time, on this machine.
 *
 * Repetitive work is the whole job in accounting: forty invoices out of the
 * same warehouse, on the same branch, in an afternoon. Asking again on the
 * forty-first is a keystroke that carries no information.
 *
 * Distinct from `useRecentPicks`, which ranks a list. This remembers a single
 * answer so the next document can open with it already filled in.
 *
 * Local to the browser and advisory only: a document always saves what is on
 * the form, never what is remembered here, so a stale value can shape a
 * default but can never post a figure.
 */

const KEY = 'lastSelection:v1';

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

/** @param what e.g. 'branch' · @param scope the company it belongs to */
export const getLastSelection = (what, scope = '') => {
  const v = readAll()[`${what}:${scope}`];
  return v === undefined || v === null ? '' : String(v);
};

export const setLastSelection = (what, scope, value) => {
  const key = `${what}:${scope}`;
  const next = String(value ?? '').trim();
  try {
    const all = readAll();
    // An empty choice is a choice — "all branches" has to be remembered too,
    // or the next document quietly re-narrows itself.
    all[key] = next;
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    // Private mode, quota, disabled storage — defaults simply stop persisting.
  }
};

export default getLastSelection;
