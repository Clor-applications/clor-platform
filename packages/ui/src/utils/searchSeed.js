/**
 * Handing a search term from the palette to the screen it opens.
 *
 * Picking INV-D00018 out of the palette and landing on a list of eighty-eight
 * invoices is not finding it. The screen has to arrive already filtered to the
 * thing that was chosen.
 *
 * Deliberately a one-shot: the seed is consumed by the first list that asks
 * for it and is gone. A seed that lingered would re-filter the list every time
 * the user navigated back to it, which reads as a filter they cannot clear.
 */

let pending = null;

export const setSearchSeed = (screenKey, text) => {
  const key = String(screenKey || '').trim();
  const value = String(text || '').trim();
  pending = key && value ? { key, value } : null;
};

/** Returns the seed for this screen once, then forgets it. */
export const consumeSearchSeed = (screenKey) => {
  if (!pending) return '';
  if (pending.key !== String(screenKey || '').trim()) return '';
  const { value } = pending;
  pending = null;
  return value;
};
