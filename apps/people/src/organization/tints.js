/*
 * One colour per department or branch, the same on every screen that draws it (review of #123, 4 Nov 2026: Sales was
 * teal on the overview, marigold on the chart and green on the structure page). Picked from the name, so it never
 * depends on what else is listed or in what order. Four families only: marigold is kept for what waits on you.
 */
export const ORG_TINTS = ['sky', 'mint', 'lilac', 'peach'];

export function tintOf(name = '') {
  const key = String(name || '').trim().toLowerCase();
  if (!key) return null;
  return ORG_TINTS[[...key].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % ORG_TINTS.length];
}
