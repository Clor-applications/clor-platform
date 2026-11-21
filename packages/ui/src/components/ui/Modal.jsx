import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { OverlayLayerContext } from './overlayLayer';
import { X } from '@ui/components/ui/lineIcons';
import { confirmDialog } from './notify';
import { openingFocus } from '@ui/picks/round61';
import { useLayer } from './layerStack';

/**
 * The one dialog in the product.
 *
 * A dialog has to announce itself as one, name itself, take the keyboard when
 * it opens and hand it back when it closes. Without that a screen reader
 * treats it as more page, and a keyboard user carries on tabbing through the
 * list behind it while a form sits open in front.
 */
/* Matches --dur-exit in index.css. Stated here because the timer cannot read
   a CSS variable, and drifting apart would show the dialog closing twice. */
const EXIT_MS = 140;

/* `footer`: fixed actions under the scrolling body. `dirty`: unsaved edits — the backdrop then does not close it, and Escape or × asks first (spec v1 §5.1). */
const Modal = ({ children, onClose, title = '', maxWidthClass = 'max-w-4xl', headerActions = null, showCloseIcon = true, footer = null, dirty = false, busy = false }) => {
  /*
   * Closing is a state, not an event.
   *
   * The dialog used to unmount on the click, so it animated in over 200ms and
   * left in a single frame. `closing` runs the exit and the real onClose fires
   * on animationend — or immediately if the browser gives us no animation to
   * wait for, which is what prefers-reduced-motion reduces this to.
   */
  const [closing, setClosing] = useState(false);
  /*
   * The exit runs, then the dialog closes — but never only on `animationend`.
   *
   * That event is the happy path; it does not arrive if the animation is
   * skipped, if the element is display:none by the time it would fire, or in
   * a test environment with no animation engine at all. A dialog that cannot
   * be closed is far worse than one that closes a frame early, so a timer of
   * the same length closes it regardless and whichever lands first wins.
   */
  const dirtyRef = useRef(dirty);
  useEffect(() => { dirtyRef.current = dirty; }, [dirty]);
  /* `busy`: a request the dialog sent is still running. Escape, × and the backdrop wait for it. */
  const busyRef = useRef(busy);
  useEffect(() => { busyRef.current = busy; }, [busy]);
  /* onClose through a ref, so the handlers never have to re-subscribe. */
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/immutability
    onCloseRef.current = onClose;
  }, [onClose]);
  /* The exit timer and `animationend` both arrive; the caller hears one close. */
  const closedRef = useRef(false);
  const finishClose = useCallback(() => {
    if (closedRef.current) return;
    closedRef.current = true;
    onCloseRef.current?.();
  }, []);
  const beginClose = useCallback(async () => {
    if (busyRef.current) return;
    if (dirtyRef.current && !(await confirmDialog({ title: 'Discard your changes?', message: 'What you entered here has not been saved.', confirmLabel: 'Discard', cancelLabel: 'Keep editing', stayFirst: true }))) return;
    setClosing(true);
  }, []);

  /*
   * Once it is closing, it closes — on `animationend` if that arrives, and on
   * a timer of the same length if it does not. The event is the happy path; it
   * is absent when the animation is skipped, when the element is display:none
   * by the time it would fire, and in any environment with no animation
   * engine. A dialog that cannot be dismissed is far worse than one that
   * closes a frame early, so the timer is the floor rather than the plan.
   */
  useEffect(() => {
    if (!closing) return undefined;
    const t = setTimeout(finishClose, EXIT_MS);
    return () => clearTimeout(t);
  }, [closing, finishClose]);
  const panelRef = useRef(null);
  const returnFocusRef = useRef(null);
  const titleId = useId();
  if (!title && import.meta.env?.DEV) console.warn('modal-untitled'); // give it a title that says what the dialog is for


  /**
   * Claim focus once, on open — never again.
   *
   * This used to live in the same effect as the key handler, which depends on
   * onClose. Callers pass an inline arrow, so onClose is a new function on
   * every render, so the effect tore down and re-ran on every render — and
   * each run called panel.focus().
   *
   * The result: typing into any field in any dialog moved focus to the dialog
   * itself after the first character. The first letter landed, the rest went
   * nowhere, and you had to click back into the box for each one. It hit item
   * creation hardest, where a name is the first thing typed.
   *
   * Focus goes to whatever asks for it with data-autofocus, and to the panel
   * only when nothing does.
   */
  useEffect(() => {
    returnFocusRef.current = document.activeElement;
    const panel = panelRef.current;
    /* Round 61 "focusfirst" A: data-autofocus first, else the first empty field (not on a touch phone). */
    const wants = openingFocus(panel);
    (wants && typeof wants.focus === 'function' ? wants : panel)?.focus();
    return () => {
      const back = returnFocusRef.current;
      if (back && typeof back.focus === 'function' && document.contains(back)) back.focus();
    };
  }, []);

  /* Escape and the Tab trap come from the shared layer stack: only the layer
     on top hears them, so a confirm opened from this dialog closes alone. */
  useLayer(true, { kind: 'dialog', onEscape: () => beginClose(), trap: () => panelRef.current });

  return createPortal(
    /* Anything opened from inside this dialog is told so, and rises above it.
       A popover on the page behind never sees this and stays where it is. */
    <OverlayLayerContext.Provider value="modal">
    <div
      className={`ui-scrim fixed inset-0 flex items-center justify-center p-4 ${closing ? 'ui-out-fade' : ''}`}
      style={{ zIndex: 'var(--z-modal)', top: 'var(--platform-bar, 0px)' }}
      onMouseDown={(e) => {
        // Backdrop click closes; clicks inside the panel don't bubble here. Never over unsaved edits.
        if (e.target === e.currentTarget && !dirtyRef.current) beginClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        /*
          A column, not a tall page.
          The dialog scrolled as one piece, so on a laptop the Save button of a
          long form was somewhere below the fold and the title went with it.
          Header and footer are fixed to the panel now and only the middle
          moves — which is what "fits the screen" means for a form that is
          genuinely taller than the screen.
        */
        className={`ui-surface ui-dialog w-full max-h-[90vh] flex flex-col ${maxWidthClass} ${closing ? 'ui-out' : ''}`}
        onAnimationEnd={(e) => {
          /* Only the panel's own exit, never a child's animation bubbling up. */
          if (closing && e.target === e.currentTarget) finishClose();
        }}
      >
        <div className="shrink-0 ui-surface border-b px-6 py-4 flex items-center justify-between gap-3">
          <h2 id={titleId} className="ui-t-sec">
            {title}
          </h2>
          <div className="flex items-center gap-2">
            {headerActions}
            {showCloseIcon ? (
              <button type="button" onClick={beginClose} className="ui-icon-btn" aria-label="Close" disabled={busy}>
                <X size={18} />
              </button>
            ) : null}
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-6">{children}</div>
        {footer ? <div className="ui-drawer-footer shrink-0">{footer}</div> : null}
      </div>
    </div>
    </OverlayLayerContext.Provider>,
    document.body
  );
};

export default Modal;
