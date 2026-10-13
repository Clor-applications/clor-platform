/**
 * What the cursor can be put on, in the order a form is read.
 *
 * Two keyboard paths needed this list — Enter and Tab advancing through a
 * document, and a picker handing focus on to the next field — and both used to
 * decide "is this on screen?" with `offsetParent !== null`. That is a layout
 * probe, and it answers null for more than the hidden: an element inside a
 * fixed-position ancestor reports null while being perfectly visible, and an
 * environment with no layout engine at all answers null for everything. When
 * it answered null for the wrong element, the field after it silently became
 * the field after that, and Tab appeared to skip a control.
 *
 * What actually needs excluding is what is not rendered or cannot be typed
 * into, and the DOM says that plainly: `disabled` and `hidden` are in the
 * selector and the attribute check, and `checkVisibility()` covers the rest
 * where the engine offers it. Where it does not, the DOM is trusted rather
 * than a layout number that is known to lie.
 */
const SELECTOR =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

const isReachable = (el) => {
  if (el.hasAttribute('hidden')) return false;
  if (el.closest('[aria-hidden="true"]')) return false;
  // Chrome and Safari have this; where it is missing there is no layout to
  // ask anyway, so absence is not evidence of being hidden.
  if (typeof el.checkVisibility === 'function') return el.checkVisibility();
  return true;
};

/** Every focusable inside `root`, document order, hidden ones dropped. */
export const focusablesIn = (root, { selector = SELECTOR } = {}) =>
  root ? Array.from(root.querySelectorAll(selector)).filter(isReachable) : [];

/**
 * The control after `el` within `root` — or `el` itself when it is the last,
 * so a caller can always focus the result.
 */
export const nextFocusableAfter = (root, el, step = 1) => {
  const list = focusablesIn(root);
  // The element we are stepping from must be in the list even if it is in the
  // middle of being hidden, or there is nothing to step from.
  const at = list.indexOf(el);
  if (at === -1) return el;
  return list[at + step] || el;
};

export default focusablesIn;
