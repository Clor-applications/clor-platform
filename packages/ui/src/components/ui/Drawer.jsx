import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

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
export default function Drawer({ open, onClose, title, description = '', actions = null, children, widthClass = 'ui-form-drawer' }) {
  /* Slid in over 200ms and vanished in one frame; it leaves the way it came,
     toward the edge it lives on. Same machinery as Modal. */
  const [closing, setClosing] = useState(false);
  const beginClose = useCallback(() => setClosing(true), []);
  /* A timer under `animationend`, for the reason spelled out in Modal: the
     event is absent whenever the animation is skipped, and a drawer that
     cannot be dismissed is worse than one that closes a frame early. */
  useEffect(() => {
    if (!closing) return undefined;
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
  const panelRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;

    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setClosing(true);
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
    panelRef.current?.focus();
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open]);

  if (!open) return null;

  return createPortal(
    <div
      className={`ui-scrim fixed inset-0 flex justify-end ${closing ? 'ui-out-fade' : ''}`}
      /* Starts under the platform bar, which outranks every app layer by
         design: from the very top, the drawer's title and Save sat under it. */
      style={{ zIndex: 'var(--z-drawer)', top: 'var(--platform-bar, 0px)' }}
      onMouseDown={(e) => {
        // The scrim closes; a click inside the panel does not reach here.
        if (e.target === e.currentTarget) beginClose();
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
          if (closing && e.target === e.currentTarget) onClose?.();
        }}
        /* A floating surface takes the token shadow, which dark mode redefines (DESIGN.md: no Tailwind shadow utilities). */
        style={{ borderInlineStart: '1px solid rgb(var(--border))', boxShadow: 'var(--shadow-pop)' }}
      >
        <div
          className="flex items-start justify-between gap-3 px-5 py-4 shrink-0"
          style={{ borderBottom: '1px solid rgb(var(--border))' }}
        >
          <div className="min-w-0">
            <h2 className="ui-t-sec truncate">{title}</h2>
            {description ? <p className="text-sm ui-muted mt-0.5">{description}</p> : null}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {actions}
            <button type="button" onClick={beginClose} className="ui-icon-btn shrink-0" aria-label="Close">
              <X size={18} />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-5">{children}</div>
      </div>
    </div>,
    document.body
  );
}
