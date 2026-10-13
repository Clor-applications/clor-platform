import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { popoverZIndex, useOverlayLayer } from './overlayLayer';

/**
 * A panel anchored to the control that opened it.
 *
 * The difference from Modal is not decoration, it is how much context the
 * choice destroys. A dialog dims the page, traps the keyboard and hides the
 * row you were reading; that is the right price for a form, and far too high
 * for picking one of three warehouses. This hangs off the trigger, leaves the
 * page lit and readable, and gets out of the way on Escape or the next click
 * anywhere else.
 *
 * Placement is measured, not assumed: it opens downward when there is room and
 * flips above the trigger when there is not, so the panel is never half off
 * the bottom of the window — the failure that makes anchored panels worse than
 * the dialog they replaced.
 */
const GAP = 6;
const MARGIN = 8;
/** Enough rows to be worth opening downward for; below this, prefer the roomier side. */
const MIN_USEFUL = 240;

const Popover = ({
  anchorRef,
  onClose,
  children,
  minWidth = 260,
  maxWidth = 420,
  labelledBy,
  onKeyDown,
  /*
   * Whether the panel takes the caret when it opens.
   *
   * A panel with something to type into wants it. A panel that is only a list
   * must NOT: moving focus into a portalled panel puts four things in a race
   * to place the cursor — the trigger's own focus, this effect, the unmount
   * hand-back below, and whatever the caller does after choosing — and the
   * winner varied. That is what made Enter work only sometimes. Such a panel
   * leaves focus on its trigger and drives the highlight through
   * aria-activedescendant, which is the combobox pattern proper.
   */
  autoFocus = true,
}) => {
  /* Above the dialog that opened this, or on the page layer when nothing did. */
  const layer = useOverlayLayer();

  const panelRef = useRef(null);
  const returnFocusRef = useRef(null);
  const claimedFocusRef = useRef(false);
  const [pos, setPos] = useState(null);

  // Measure before paint, so the panel never renders once in the wrong place
  // and then jumps.
  useLayoutEffect(() => {
    const place = () => {
      const anchor = anchorRef?.current;
      const panel = panelRef.current;
      if (!anchor || !panel) return;

      const a = anchor.getBoundingClientRect();
      const w = Math.min(Math.max(a.width, minWidth), maxWidth);

      const roomBelow = window.innerHeight - a.bottom - MARGIN;
      const roomAbove = a.top - MARGIN;
      // A long list would rather be tall than be above the control, and it
      // scrolls anyway — so only flip when below is genuinely cramped and above
      // is better. Comparing the panel's natural height instead would send
      // every list of any length upward, which is not a flip, it is a default.
      const wanted = Math.min(panel.scrollHeight, MIN_USEFUL);
      const below = roomBelow >= wanted || roomBelow >= roomAbove;

      const left = Math.min(Math.max(MARGIN, a.left), Math.max(MARGIN, window.innerWidth - w - MARGIN));
      const maxHeight = Math.max(140, (below ? roomBelow : roomAbove) - GAP);

      /*
       * A panel above the trigger is pinned by its BOTTOM edge, not its top.
       *
       * Its height is not fixed — the list filters as you type — and a panel
       * held by `top` grows and shrinks downward, away from the control it
       * belongs to. Typing one letter into an item field near the foot of the
       * page cut the list from four rows to one and left it stranded 187px
       * above the box, connected to nothing. Held by the bottom it stays put
       * against the field and grows upward, which is what "above" means.
       */
      if (below) setPos({ top: a.bottom + GAP, left, width: w, maxHeight });
      else setPos({ bottom: Math.max(MARGIN, window.innerHeight - a.top + GAP), left, width: w, maxHeight });
    };

    place();
    // Reposition rather than close: a panel that vanishes because the page
    // scrolled a pixel reads as a bug, not as a dismissal.
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);

    /*
     * The panel's own contents change size — a list filters, a message
     * replaces the rows — and that changes which side it should be on, so the
     * placement is re-decided when it does. Pinning by the bottom edge keeps
     * it attached in the meantime; this keeps the CHOICE of side honest.
     */
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(place) : null;
    if (ro && panelRef.current) ro.observe(panelRef.current);

    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [anchorRef, minWidth, maxWidth]);

  /*
   * The close handler, kept in a ref rather than in the effect's deps.
   *
   * Every caller passes an inline arrow — `onClose={() => setOpen(false)}` —
   * so the function is a new value on every render of the page behind the
   * panel. With it in the deps the listener effect tore down and re-ran on
   * each of those renders, and its cleanup restores focus to whatever opened
   * the panel. Typing into a panel's search box re-renders it, so the caret
   * was thrown back onto the trigger after the FIRST letter and every
   * keystroke after it went to the button: searching any dropdown in the
   * product accepted exactly one character.
   */
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    returnFocusRef.current = document.activeElement;

    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onCloseRef.current?.();
      }
    };
    const onDown = (e) => {
      const panel = panelRef.current;
      const anchor = anchorRef?.current;
      if (panel?.contains(e.target)) return;
      // Clicking the trigger again is a toggle, and the trigger's own handler
      // owns that. Closing here too would close and immediately reopen.
      if (anchor?.contains(e.target)) return;
      onCloseRef.current?.();
    };

    /*
     * A panel does not outlive the keyboard's interest in it.
     *
     * Whatever moves focus away — Tab, a click on another control, code that
     * advances to the next field — the panel is no longer the thing being
     * used, and leaving it on screen puts two open menus in front of someone
     * at once. That is how an open warehouse list ended up hanging over an
     * open customer dialog, with Enter landing on whichever of them the
     * browser thought was focused.
     *
     * `relatedTarget` is what is *receiving* focus. When it is null the focus
     * went nowhere in particular — an alt-tab, a click on dead space — and
     * closing on that would fight the pointer handler above, which already
     * owns dismissal by click.
     */
    const onFocusOut = (e) => {
      const next = e.relatedTarget;
      if (!next) return;
      if (panelRef.current?.contains(next)) return;
      if (anchorRef?.current?.contains(next)) return;
      onCloseRef.current?.();
    };

    const panelNow = panelRef.current;
    panelNow?.addEventListener('focusout', onFocusOut);
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('pointerdown', onDown, true);
    return () => {
      panelNow?.removeEventListener('focusout', onFocusOut);
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('pointerdown', onDown, true);
      const back = returnFocusRef.current;
      if (!claimedFocusRef.current) return;
      if (back && typeof back.focus === 'function' && document.contains(back)) back.focus();
    };
    /* Mount and unmount only: see the ref above. */
  }, [anchorRef]);

  // Only once the panel has been placed — until then it is still hidden, and a
  // hidden element cannot take focus, so the keyboard would be left behind on
  // the page underneath. Something inside may want the caret first (a search
  // box usually does); the panel claims it only if nothing else did.
  useEffect(() => {
    if (!autoFocus || !pos || claimedFocusRef.current) return;
    claimedFocusRef.current = true;
    if (panelRef.current?.contains(document.activeElement)) return;
    // Whoever wants the caret says so with data-autofocus, and gets it here —
    // once the panel is placed and its contents can actually take focus.
    //
    // Asking to be focused from inside the panel does not work on its own: that
    // runs while the panel is still unpositioned and hidden, focus() on a
    // hidden element does nothing, and then this effect finds nothing focused
    // and claims the panel. The state picker lost every keystroke that way —
    // it opens a searchable list of thirty-eight states, and typing went
    // nowhere until you clicked the box first.
    const wants = panelRef.current?.querySelector('[data-autofocus]');
    if (wants && typeof wants.focus === 'function') {
      wants.focus({ preventScroll: true });
      return;
    }
    panelRef.current?.focus({ preventScroll: true });
  }, [autoFocus, pos]);

  return createPortal(
    <div
      ref={panelRef}
      role="dialog"
      aria-labelledby={labelledBy}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      className="ui-popover"
      style={
        pos
          ? {
              /* One of the two, never both: `top` holds a panel that opened
                 downward, `bottom` holds one that flipped above. */
              ...(pos.top === undefined ? { bottom: pos.bottom } : { top: pos.top }),
              left: pos.left,
              width: pos.width,
              maxHeight: pos.maxHeight,
              zIndex: popoverZIndex(layer),
            }
          : { top: 0, left: 0, width: minWidth, visibility: 'hidden', zIndex: popoverZIndex(layer) }
      }
    >
      {children}
    </div>,
    document.body
  );
};

export default Popover;
