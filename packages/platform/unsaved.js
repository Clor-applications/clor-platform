/**
 * Unsaved edits, across the app (People design spec v1 §5.1 "Navigate away
 * with edits: warn"; Workforce WF-11). A screen marks itself dirty through
 * `useUnsavedChanges`; the shell asks `confirmLeave()` before any navigation
 * that would unmount it (another screen, another app, another company,
 * browser Back). Closing the browser tab is covered by beforeunload.
 */
const dirty = new Set();

export function markUnsaved(id, isDirty) {
  if (isDirty) dirty.add(id);
  else dirty.delete(id);
}

export const hasUnsaved = () => dirty.size > 0;

export const clearUnsaved = () => dirty.clear();

/** Resolves true when it is fine to leave: nothing unsaved, or the person chose to discard. */
export async function confirmLeave(ask) {
  if (!dirty.size) return true;
  const ok = await ask();
  if (ok) dirty.clear();
  return ok;
}
