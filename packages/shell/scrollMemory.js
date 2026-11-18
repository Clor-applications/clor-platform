/*
 * Round 57 filtermemory A: coming back to a list finds the same filters,
 * search and scroll place as before. Filters and search already ride in the
 * address; this keeps the scroll place, per screen and its own state, for
 * half an hour, and puts the page back there once the list has drawn.
 */
const memo = new Map();
const KEEP_MS = 30 * 60 * 1000;
const MAX = 40;

export const placeKey = (key, params) => `${key || ''}|${JSON.stringify(params || {})}`;

/** Note where this screen is scrolled to, as it is left. */
export function rememberPlace(key, params, y = typeof window !== 'undefined' ? window.scrollY : 0, now = Date.now()) {
  if (!key) return;
  const k = placeKey(key, params);
  memo.delete(k);
  memo.set(k, { y: Math.max(0, Math.round(Number(y) || 0)), at: now });
  while (memo.size > MAX) memo.delete(memo.keys().next().value);
}

/** Where a screen was left, if recently and lower than its top. */
export function placeFor(key, params, now = Date.now()) {
  const m = memo.get(placeKey(key, params));
  return m && now - m.at < KEEP_MS && m.y > 0 ? m.y : null;
}

export function forgetPlaces() { memo.clear(); }

let cancelRestore = null;

/**
 * Scroll back to `y` once the list is tall enough: the rows arrive after the
 * screen opens, so try each frame for up to three seconds. Any wheel, touch
 * or key press from the reader stops it, so it never fights them.
 */
export function restorePlace(y) {
  if (typeof window === 'undefined') return;
  if (cancelRestore) cancelRestore();
  if (!y) { window.scrollTo(0, 0); return; }
  let frames = 0;
  let steady = 0;
  let stopped = false;
  const events = ['wheel', 'touchstart', 'keydown', 'mousedown'];
  const stop = () => {
    stopped = true;
    for (const ev of events) window.removeEventListener(ev, stop, true);
    if (cancelRestore === stop) cancelRestore = null;
  };
  cancelRestore = stop;
  for (const ev of events) window.addEventListener(ev, stop, { capture: true, passive: true });
  const step = () => {
    if (stopped) return;
    window.scrollTo(0, y);
    steady = Math.abs((window.scrollY || 0) - y) < 2 ? steady + 1 : 0;
    frames += 1;
    if (steady >= 10 || frames > 180) { stop(); return; }
    window.requestAnimationFrame(step);
  };
  window.scrollTo(0, 0);
  window.requestAnimationFrame(step);
}
