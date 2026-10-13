import { useEffect, useRef } from 'react';

/**
 * Ask the server when the browser cannot answer.
 *
 * The pickers filter the local book, which is the right thing to do and is
 * instant — right up to the point where the book is a page of a much larger
 * list. The masters endpoints cap at 200 rows by default and 500 at most, so
 * on a book with four thousand items the customer you are looking for may
 * simply not be in the browser, and no amount of client-side ranking will
 * conjure it.
 *
 * Above the threshold, typing sends the query to the server. What comes back
 * is mirrored into the local book by the caller's existing effect, so ids stay
 * in one space and everything downstream — the ranking, the recents, the
 * keyboard — carries on working against local rows. Nothing about the picker
 * changes shape; the set it is searching just stops being truncated.
 *
 * Below the threshold nothing fires at all. A shop with ninety customers has
 * all ninety in hand, and a network round trip per keystroke would make a
 * fast list slow.
 *
 * @param reload    (search) => Promise, from useServerMasters
 * @param query     what the user has typed
 * @param localSize how many rows are already in the browser
 * @param enabled   false where there is no server session
 */
const DEBOUNCE_MS = 250;
/** The masters endpoints' own default page size. */
const LARGE_ENOUGH_TO_BE_TRUNCATED = 200;
/** One letter matches everything; the round trip buys nothing. */
const MIN_QUERY = 2;

export function useRemoteSearch(reload, query, { localSize = 0, enabled = true } = {}) {
  const lastSent = useRef('');

  useEffect(() => {
    if (!enabled || typeof reload !== 'function') return undefined;
    if (localSize < LARGE_ENOUGH_TO_BE_TRUNCATED) return undefined;

    const q = String(query || '').trim();
    if (q.length < MIN_QUERY) return undefined;
    if (q === lastSent.current) return undefined;

    // One request per pause in typing, not one per keystroke.
    const timer = setTimeout(() => {
      lastSent.current = q;
      // A failed search is not an error worth showing: the local list is still
      // there and still filtered, so the picker degrades to what it did before.
      Promise.resolve(reload(q)).catch(() => {});
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [enabled, localSize, query, reload]);
}

export default useRemoteSearch;
