import { useEffect, useMemo, useRef } from 'react';

/**
 * One stack of everything open on top of the page: dialogs, side panels, the
 * confirm and code prompts, the search palette, popovers and menus.
 *
 * Escape used to be handled in four places that did not agree on who goes
 * first — the drawer on window capture, the dialog on window bubble, the
 * confirm on document, the code prompt on its own form. One key press could
 * close a confirm and the dialog under it, or the code prompt and the form
 * that asked for it (an Ops payment, gone). Here the layer opened last is the
 * only one that hears Escape, and the only one that keeps Tab inside it.
 *
 * Popups that are not on the stack — a date grid, a listbox, a base-ui menu —
 * handle their own Escape at the element and mark it handled
 * (`preventDefault`), or sit under a `[role=menu|listbox]` / `aria-expanded`
 * element the top layer does not own. Either way the layer leaves that key
 * alone, so one Escape closes one thing.
 */

const stack = [];
const FOREIGN_POPUP = '.ui-datepicker-pop, [role="listbox"], [role="menu"], [aria-expanded="true"]';
export const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

const asElement = (t) => (t && typeof t.closest === 'function' ? t : null);

/* A popup layer (popover, menu) is itself the open thing, so Escape is its
   own unless an element claimed it first. A dialog layer leaves alone an
   Escape from an open-looking control inside it: that belongs to a popup of
   its own (a base-ui menu, a select's list) that is not on the stack. */
const leaveToInnerPopup = (layer, target) => layer.kind !== 'popup' && Boolean(target?.closest(FOREIGN_POPUP));

/** Radix captures Escape on document before it can bubble to the shared stack. */
export function dismissTopLayerOnEscape(event) {
  const top = stack[stack.length - 1];
  if (!top || event.defaultPrevented || leaveToInnerPopup(top, asElement(event.target))) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  top.onEscape?.(event);
}

function onKeyDown(e) {
  if (!stack.length || e.defaultPrevented) return;
  const top = stack[stack.length - 1];
  if (e.key === 'Escape') {
    dismissTopLayerOnEscape(e);
    return;
  }

  if (e.key !== 'Tab' || !top.trap) return;
  const panel = top.trap();
  if (!panel) return;
  const focusables = [...panel.querySelectorAll(FOCUSABLE)];
  if (!focusables.length) {
    e.preventDefault();
    panel.focus?.();
    return;
  }
  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  const active = typeof document !== 'undefined' ? document.activeElement : null;
  /* Focus that has wandered out of the top layer (onto a dialog under it, or the page) comes back in. */
  if (!active || !panel.contains(active)) {
    e.preventDefault();
    (e.shiftKey ? last : first).focus();
  } else if (e.shiftKey && active === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && active === last) {
    e.preventDefault();
    first.focus();
  }
}

let installed = false;
function install() {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  /* Bubble phase, on window: an element's own key handler (a date grid, a
     listbox, a search box) runs first and can claim the key. */
  window.addEventListener('keydown', onKeyDown);
}

/**
 * Put a layer on the stack; returns the function that takes it off.
 * `layer`: { kind: 'dialog' | 'popup', onEscape(e), trap?: () => Element }
 */
let nextOrder = 0;
/* Opening order. A hook takes it while rendering, so a dialog and the drawer
   it sits in, mounted in the same commit, still stack parent below child:
   effects run child first, renders run parent first. */
export const takeLayerOrder = () => ++nextOrder;

export function pushLayer(layer) {
  install();
  if (layer.order === undefined) layer.order = takeLayerOrder();
  let i = stack.length;
  while (i > 0 && stack[i - 1].order > layer.order) i -= 1;
  stack.splice(i, 0, layer);
  return () => {
    const i = stack.lastIndexOf(layer);
    if (i >= 0) stack.splice(i, 1);
  };
}

export const isTopLayer = (layer) => stack.length > 0 && stack[stack.length - 1] === layer;
export const openLayerCount = () => stack.length;

/**
 * The hook form. `open` puts the layer on the stack; the handlers are read
 * through a ref, so an inline arrow from the caller does not re-push it on
 * every render (which would also reorder it above layers opened after it).
 */
export function useLayer(open, { kind = 'dialog', onEscape, trap } = {}) {
  const ref = useRef({ onEscape, trap });
  useEffect(() => {
    ref.current = { onEscape, trap };
  });
  /* A fresh place in the order each time it opens; see takeLayerOrder. */
  const order = useMemo(() => (open ? takeLayerOrder() : 0), [open]);
  useEffect(() => {
    if (!open) return undefined;
    return pushLayer({
      kind,
      order,
      onEscape: (e) => ref.current.onEscape?.(e),
      trap: () => ref.current.trap?.(),
    });
  }, [open, kind, order]);
}

export default useLayer;
