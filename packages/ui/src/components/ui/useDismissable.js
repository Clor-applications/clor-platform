import { useEffect, useRef } from 'react';

/**
 * A menu that closes when you are done with it.
 *
 * An open panel that ignores a click on the page is the single most common
 * small bug in this product's chrome: six of them shipped — the app switcher,
 * both overview period pickers, both overview "more" menus, the recurring and
 * cash-book row menus — and every one had to be dismissed by clicking its own
 * trigger a second time. Nobody does that. They click somewhere else, nothing
 * happens, and the menu sits over the row they were trying to read.
 *
 * The portalled `Popover` has always handled this, which is why the pickers
 * are fine; the panels that are a plain `absolute` div next to their trigger
 * never did, and three separate hand-rolled versions of the same listener had
 * grown in the places somebody noticed. This is that listener, once.
 *
 *   const menuRef = useDismissable(open, () => setOpen(false));
 *   <div className="relative" ref={menuRef}>
 *     <button aria-expanded={open} onClick={() => setOpen(v => !v)}>…</button>
 *     {open ? <div className="absolute …">…</div> : null}
 *   </div>
 *
 * The ref goes on the element that wraps BOTH the trigger and the panel. That
 * is what makes clicking the trigger again a toggle rather than a
 * close-and-reopen: the trigger is inside, so this stays out of it and the
 * button's own handler decides.
 *
 * `pointerdown`, not `click`, and in the capture phase: the menu is gone
 * before the click lands, so one click on a button elsewhere both dismisses
 * this and presses that — instead of being spent on the dismissal.
 */
export function useDismissable(open, onClose, providedRef) {
  /* A caller that already has a ref on that element — because it measures it,
     or portals from it — passes it in and gets it back. Two refs on one node
     is a second thing to keep in step, and the one that matters is whichever
     the markup happens to use. */
  const ownRef = useRef(null);
  const ref = providedRef || ownRef;

  /*
   * The close handler, kept in a ref rather than in the effect's deps.
   *
   * Every caller passes an inline arrow, so it is a new function on every
   * render of the screen behind the menu. In the deps, the listener would be
   * torn down and rebuilt on each of those renders — which is how the same
   * mistake in Popover once made every dropdown search box accept exactly one
   * character before throwing focus back at its trigger.
   */
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return undefined;

    const onDown = (e) => {
      if (ref.current?.contains(e.target)) return;
      /* A portalled panel opened FROM this menu — a Popover, a date picker —
         is visually inside it and is not in the DOM anywhere near it. Closing
         on a click into one would shut the menu that owns it. */
      if (e.target?.closest?.('.ui-popover, [role="dialog"], [data-layout-pop]')) return;
      onCloseRef.current?.();
    };

    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      /* Stopped, so one Escape closes one thing. Without this, a menu inside a
         dialog takes the dialog down with it. */
      e.stopPropagation();
      onCloseRef.current?.();
      /* The keyboard goes back to the control that opened the menu, not to
         the top of the document. Every trigger here carries aria-expanded,
         which is exactly what makes it findable. */
      const trigger = ref.current?.querySelector('[aria-expanded]');
      if (trigger && typeof trigger.focus === 'function') trigger.focus({ preventScroll: true });
    };

    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey, true);
    };
  }, [open, ref]);

  return ref;
}

export default useDismissable;
