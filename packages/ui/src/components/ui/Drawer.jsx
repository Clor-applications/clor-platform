import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, X } from '@ui/components/ui/lineIcons';

import { OverlayLayerContext } from './overlayLayer';
import { confirmDialog } from './notify';
import useSheetDrag from './useSheetDrag';
import { openingFocus } from '@ui/picks/round61';
import { useLayer } from './layerStack';

/* Safari shows :active on a touch only when the page listens for touches: the press feedback needs it. */
if (typeof document !== 'undefined') document.addEventListener('touchstart', () => {}, { passive: true });


/**
 * A panel that slides in from the right, over whatever is behind it.
 *
 * For settings reached from inside a document. Preferences and custom fields
 * were rendered *inline* in the invoice form — the settings screen appeared
 * stacked in the middle of a half-typed invoice, so the page was two screens
 * at once and neither had the width it needed. A drawer keeps the invoice
 * where it was, visible behind the scrim, and gives the settings a column of
 * their own to be read in.
 *
 * Right-hand side and about two-fifths of the viewport, because the thing
 * being configured is on the left and should stay in view while it is.
 *
 * Portalled to the body: the form it opens from sits inside a scroll container
 * with its own stacking context, and a fixed panel inside one of those is
 * clipped by it.
 */
/*
 * People design spec v1 (§5, §5.1): `footer` holds sticky actions (Cancel ·
 * Save); `dirty` means unsaved edits — the scrim then does not close it, and
 * Escape or × asks before discarding. Focus goes back to whatever opened it.
 */
export default function Drawer({ open, onClose, title, description = '', actions = null, footer = null, dirty = false, busy = false, children, widthClass = 'ui-form-drawer' }) {
  /* Slid in over 200ms and vanished in one frame; it leaves the way it came,
     toward the edge it lives on. Same machinery as Modal. */
  const [closing, setClosing] = useState(false);
  const panelRef = useRef(null);
  const dirtyRef = useRef(dirty);
  useEffect(() => { dirtyRef.current = dirty; }, [dirty]);
  /* Owner's round 14 pick: outside Books a panel closes from a Back arrow at the top left. */
  const backClose = typeof document !== 'undefined' && document.documentElement.dataset.palette !== 'indigo';
  /* `busy`: a request sent from the drawer is still running; it stays until that answers. */
  const busyRef = useRef(busy);
  useEffect(() => { busyRef.current = busy; }, [busy]);
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);
  /* The exit timer and `animationend` both arrive; the caller hears one close per opening. */
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
  /* A timer under `animationend`, for the reason spelled out in Modal: the
     event is absent whenever the animation is skipped, and a drawer that
     cannot be dismissed is worse than one that closes a frame early. */
  useEffect(() => {
    if (!closing) return undefined;
    /* A sheet that was dragged holds its own inline animation and place; closing hands it back to the exit animation. */
    const panel = panelRef.current;
    if (panel) { panel.style.animation = ''; panel.style.transform = ''; }
    const t = setTimeout(finishClose, 140);
    return () => clearTimeout(t);
  }, [closing, finishClose]);
  /* Reset while rendering the reopen, not in an effect after it — an effect
     here sets state during the commit and costs a second render. */
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open && closing) setClosing(false);
  }
  useEffect(() => {
    if (open) closedRef.current = false;
  }, [open]);
  const scrimRef = useRef(null);
  const returnFocusRef = useRef(null);
  /* On a phone a sheet can be dragged down to put it away; it is already off screen when it closes, so no exit animation follows. */
  const drag = useSheetDrag({ panelRef, scrimRef, dirtyRef, onDismiss: finishClose, onAskToClose: beginClose });

  useEffect(() => {
    if (!open) return undefined;
    returnFocusRef.current = document.activeElement;

    /* `onClose` is commonly declared inline by the screen that owns the
       drawer. Including it here made this effect run after every controlled
       input change and focused the panel again, stealing focus from the field
       after the first character. Opening is the only event that should move
       focus into the drawer. */
    /* Round 61 "focusfirst" A: whatever asks with data-autofocus, else the first empty field (not on a touch phone), else the panel. */
    const wants = openingFocus(panelRef.current);
    (wants || panelRef.current)?.focus();
    return () => {
      const back = returnFocusRef.current;
      if (back && typeof back.focus === 'function' && document.contains(back)) back.focus();
    };
  }, [open, beginClose]);

  /* Escape and the Tab trap: the shared layer stack, so a dialog or confirm opened from this drawer closes alone. */
  useLayer(open, { kind: 'dialog', onEscape: () => beginClose(), trap: () => panelRef.current });

  if (!open) return null;

  return createPortal(
    <OverlayLayerContext.Provider value="drawer">
    <div
      ref={scrimRef}
      className={`ui-scrim fixed inset-0 flex justify-end ${closing ? 'ui-out-fade' : ''}`}
      /* Starts under the platform bar, which outranks every app layer by
         design: from the very top, the drawer's title and Save sat under it. */
      style={{ zIndex: 'var(--z-drawer)', top: 'var(--platform-bar, 0px)' }}
      onMouseDown={(e) => {
        // The scrim closes; a click inside the panel does not reach here. Not with unsaved edits (spec v1 §5.1).
        if (e.target === e.currentTarget && !dirtyRef.current) beginClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={`ui-surface h-full ${widthClass} max-w-full flex flex-col ${closing ? 'ui-out-edge' : 'ui-in-right'}`}
        onAnimationEnd={(e) => {
          if (closing && e.target === e.currentTarget) finishClose();
        }}
        /* A floating surface takes the token shadow, which dark mode redefines (DESIGN.md: no Tailwind shadow utilities). */
        style={{ borderInlineStart: '1px solid rgb(var(--border))', boxShadow: 'var(--shadow-pop)' }}
      >
        {/* At phone width the actions drop under the title instead of squeezing it to a word a line. */}
        <div
          className="ui-sheet-head relative flex flex-wrap items-start justify-between gap-3 px-5 py-4 shrink-0"
          style={{ borderBottom: '1px solid rgb(var(--border))' }}
          {...drag}
        >
          <span className="ui-sheet-grabber" aria-hidden="true" />
          {backClose ? (
            <button type="button" onClick={beginClose} className="ui-icon-btn ui-sheet-back shrink-0" aria-label="Close" disabled={busy}>
              <ArrowLeft size={18} aria-hidden="true" />
            </button>
          ) : null}
          <div className="min-w-0 flex-1 basis-48">
            <h2 className="ui-t-sec truncate">{title}</h2>
            {description ? <p className="text-sm ui-muted mt-0.5">{description}</p> : null}
          </div>
          <div className="ml-auto flex max-w-full flex-wrap items-center gap-2">
            {actions}
            {backClose ? null : (
              <button type="button" onClick={beginClose} className="ui-icon-btn shrink-0" aria-label="Close" disabled={busy}>
                <X size={18} />
              </button>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-5">{children}</div>
        {footer ? <div className="ui-drawer-footer shrink-0">{footer}</div> : null}
      </div>
    </div>
    </OverlayLayerContext.Provider>,
    document.body
  );
}
