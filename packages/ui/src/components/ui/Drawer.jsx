import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from '@ui/components/ui/lineIcons';

import { OverlayLayerContext } from './overlayLayer';
import { confirmDialog } from './notify';
import useSheetDrag from './useSheetDrag';
import { RowMenu } from './RowMenu';

/* Safari shows :active on a touch only when the page listens for touches: the press feedback needs it. */
if (typeof document !== 'undefined') document.addEventListener('touchstart', () => {}, { passive: true });

/* An Escape that belongs to a popup inside the drawer (a date grid, a list of options, a menu) closes that popup, not the drawer. */
const INNER_POPUP = '.ui-datepicker-pop, [role="listbox"], [role="menu"], [aria-expanded="true"]';
/* A popup portalled out of the drawer (the sheet's ⋮ menu, a popover): its Escape is its own, wherever it lives. */
const PORTALLED_POPUP = '.ui-popover, [role="menu"]';

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
 * People on a phone (design audit, 4 Nov 2026, blocker 7): under 640px, where the sheet shape, its grabber and drag
 * and DataTable's cards all start, a drawer is a bottom sheet and its actions sit
 * in a sticky footer under the content, in thumb reach; the primary and the action beside it share the width, and
 * `more` (the rest: Withdraw, Change…) goes behind a ⋮. Sky palette only, so other apps keep their drawers. At
 * desktop width `more` renders as plain buttons before `actions`, as before.
 */
const PHONE = '(max-width: 639px)';
const isPeoplePhone = () => typeof window !== 'undefined'
  && document.documentElement.dataset.palette === 'sky'
  && Boolean(window.matchMedia?.(PHONE)?.matches);
function usePeoplePhone() {
  const [phone, setPhone] = useState(isPeoplePhone);
  useEffect(() => {
    const mq = window.matchMedia?.(PHONE);
    if (!mq?.addEventListener) return undefined;
    const on = () => setPhone(isPeoplePhone());
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return phone;
}

/*
 * People design spec v1 (§5, §5.1): `footer` holds sticky actions (Cancel ·
 * Save); `dirty` means unsaved edits — the scrim then does not close it, and
 * Escape or × asks before discarding. Focus goes back to whatever opened it.
 */
export default function Drawer({ open, onClose, title, description = '', actions = null, more = null, footer = null, dirty = false, children, widthClass = 'ui-form-drawer' }) {
  const phone = usePeoplePhone();
  const moreItems = (more || []).filter(Boolean);
  const sheetActions = phone && (actions || moreItems.length);
  /* Slid in over 200ms and vanished in one frame; it leaves the way it came,
     toward the edge it lives on. Same machinery as Modal. */
  const [closing, setClosing] = useState(false);
  const panelRef = useRef(null);
  const dirtyRef = useRef(dirty);
  useEffect(() => { dirtyRef.current = dirty; }, [dirty]);
  const beginClose = useCallback(async () => {
    if (dirtyRef.current && !(await confirmDialog({ title: 'Discard your changes?', message: 'What you entered here has not been saved.', confirmLabel: 'Discard', tone: 'danger' }))) return;
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
    const t = setTimeout(() => onClose?.(), 140);
    return () => clearTimeout(t);
  }, [closing, onClose]);
  /* Reset while rendering the reopen, not in an effect after it — an effect
     here sets state during the commit and costs a second render. */
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open && closing) setClosing(false);
  }
  const scrimRef = useRef(null);
  const returnFocusRef = useRef(null);
  /* On a phone a sheet can be dragged down to put it away; it is already off screen when it closes, so no exit animation follows. */
  const drag = useSheetDrag({ panelRef, scrimRef, dirtyRef, onDismiss: () => onClose?.(), onAskToClose: beginClose });

  useEffect(() => {
    if (!open) return undefined;
    returnFocusRef.current = document.activeElement;

    const onKey = (e) => {
      if (e.key === 'Escape') {
        if (e.target?.closest?.(INNER_POPUP) && panelRef.current?.contains(e.target)) return;
        if (e.target?.closest?.(PORTALLED_POPUP) && !panelRef.current?.contains(e.target)) return;
        e.stopPropagation();
        beginClose();
        return;
      }
      if (e.key !== 'Tab') return;
      // Keep Tab inside the drawer; the form behind it is still focusable and
      // tabbing into it would edit a document the user cannot currently see.
      const panel = panelRef.current;
      if (!panel) return;
      const focusables = panel.querySelectorAll(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      if (!focusables.length) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    /* `onClose` is commonly declared inline by the screen that owns the
       drawer. Including it here made this effect run after every controlled
       input change and focused the panel again, stealing focus from the field
       after the first character. Opening is the only event that should move
       focus into the drawer. */
    window.addEventListener('keydown', onKey, true);
    const wants = panelRef.current?.querySelector('[data-autofocus]');
    (wants || panelRef.current)?.focus();
    return () => {
      window.removeEventListener('keydown', onKey, true);
      const back = returnFocusRef.current;
      if (back && typeof back.focus === 'function' && document.contains(back)) back.focus();
    };
  }, [open, beginClose]);

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
        className={`ui-surface h-full ${widthClass}${phone && !/ui-drawer-sheet/.test(widthClass) ? ' ui-drawer-sheet' : ''} max-w-full flex flex-col ${closing ? 'ui-out-edge' : 'ui-in-right'}`}
        onAnimationEnd={(e) => {
          if (closing && e.target === e.currentTarget) onClose?.();
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
          <div className="min-w-0 flex-1 basis-48">
            <h2 className="ui-t-sec truncate">{title}</h2>
            {description ? <p className="text-sm ui-muted mt-0.5">{description}</p> : null}
          </div>
          <div className="ml-auto flex max-w-full flex-wrap items-center gap-2">
            {sheetActions ? null : <>
              {moreItems.map((m) => <button key={m.key} type="button" className={m.className || 'ui-btn ui-btn-secondary'} disabled={m.disabled} onClick={m.onSelect}>{m.label}</button>)}
              {actions}
            </>}
            <button type="button" onClick={beginClose} className="ui-icon-btn shrink-0" aria-label="Close">
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-5">{children}</div>
        {sheetActions ? (
          <div className="ui-sheet-actions shrink-0">
            {moreItems.length ? <RowMenu label="More actions" items={moreItems} /> : null}
            {actions}
          </div>
        ) : null}
        {footer ? <div className="ui-drawer-footer shrink-0">{footer}</div> : null}
      </div>
    </div>
    </OverlayLayerContext.Provider>,
    document.body
  );
}
