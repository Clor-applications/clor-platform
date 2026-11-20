/*
 * The router's decisions, kept apart from React so they can be tested alone.
 */

/**
 * Where a Back or Forward step leaves the reader.
 * - The entry remembers a scroll position: go back to it.
 * - Only the hash changed on the same page (a "#section" link, the skip link):
 *   leave the scroll alone, the browser has already put the section on screen.
 * - Another page with nothing remembered: its top.
 * Returns a y position, or null for "do not scroll".
 */
export function scrollOnPop(fromPath, toPath, state) {
  if (typeof state?.scrollY === 'number') return state.scrollY;
  if (fromPath === toPath) return null;
  return 0;
}

/*
 * Leave guards: a page with unsaved work (a half-filled form) registers one,
 * and an in-site link asks before leaving it.
 */
const guards = new Set();

/** Register a guard; returns the function that removes it. */
export function addLeaveGuard(guard) {
  guards.add(guard);
  return () => guards.delete(guard);
}

/** Whether any page holds unsaved work right now. */
export const hasUnsaved = () => [...guards].some((g) => g.dirty());

/** Whether a move may go ahead: nothing unsaved, or the reader agrees to lose it. */
export function mayLeave(confirm) {
  const held = [...guards].find((g) => g.dirty());
  if (!held) return true;
  return Boolean(confirm(held.message?.() || 'Leave this page? What you have typed will be lost.'));
}
