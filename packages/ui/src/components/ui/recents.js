/**
 * Round 55 picks (owner, 18 Nov 2026): the search box opens with the last five
 * searches (recentsearch A), and the menu keeps the last five people opened
 * (recentrecords A). Both live in this browser only, never on the server, and
 * never in Books (its own palette and menu are left as they are).
 *
 * Every read and write is wrapped: a private window or blocked storage simply
 * means no recents, not a broken search box.
 */

export const RECENT_LIMIT = 5;
const SEARCH_KEY = 'clor.recent.searches';
const PEOPLE_KEY = 'clor.recent.people';
export const RECENT_PEOPLE_EVENT = 'clor:recent-people';

const isBooks = () => typeof document !== 'undefined' && document.documentElement?.dataset?.palette === 'indigo';

const read = (key) => {
  try {
    const v = JSON.parse(window.localStorage.getItem(key) || '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
};

const write = (key, list) => {
  try {
    window.localStorage.setItem(key, JSON.stringify(list));
  } catch {
    /* storage blocked: recents are a convenience, nothing to do */
  }
};

/** The last five searches, newest first. */
export function recentSearches() {
  if (isBooks()) return [];
  return read(SEARCH_KEY).filter((s) => typeof s === 'string' && s.trim()).slice(0, RECENT_LIMIT);
}

/** Remember a search that led somewhere. Same words in another case count once. */
export function rememberSearch(q) {
  const s = String(q || '').trim();
  if (!s || s.length < 2 || isBooks()) return;
  const rest = read(SEARCH_KEY).filter((x) => typeof x === 'string' && x.toLowerCase() !== s.toLowerCase());
  write(SEARCH_KEY, [s, ...rest].slice(0, RECENT_LIMIT));
}

export function forgetSearches() {
  write(SEARCH_KEY, []);
}

/** The last five people opened, newest first: `{ id, name }` only. */
export function recentPeople() {
  if (isBooks()) return [];
  return read(PEOPLE_KEY).filter((p) => p && p.id && p.name).slice(0, RECENT_LIMIT);
}

/** Remember a person whose record was opened. Only the id and the name are kept. */
export function rememberPerson(person) {
  if (!person || !person.id || isBooks()) return;
  const name = String(person.name || '').trim();
  if (!name) return;
  const id = String(person.id);
  const rest = read(PEOPLE_KEY).filter((p) => p && String(p.id) !== id);
  write(PEOPLE_KEY, [{ id, name }, ...rest].slice(0, RECENT_LIMIT));
  try {
    window.dispatchEvent(new Event(RECENT_PEOPLE_EVENT));
  } catch {
    /* no window events: the menu catches up on its next draw */
  }
}

export function forgetPeople() {
  write(PEOPLE_KEY, []);
}
