import React, { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { Toaster as SonnerToaster, toast as sonnerToast } from 'sonner';

import { subscribeConfirms, subscribeToasts } from './notify';

/**
 * The one place notifications become pixels: a toast stack bottom-right and
 * a styled confirm dialog. Mounted once at the app root.
 *
 * Toasts: role="status" polite live region, auto-dismiss (errors linger
 * longer because they carry instructions), manual dismiss always available.
 * Newest at the bottom, nearest the corner they appear from.
 *
 * Confirm: replaces window.confirm. Escape cancels, the danger action is a
 * real ui-btn-danger, and focus starts on Cancel so a stray Enter cannot
 * delete anything.
 */

export default function Toaster() {

  const [confirm, setConfirm] = useState(null);
  const cancelRef = useRef(null);

  useEffect(() => {
    const offToasts = subscribeToasts((t) => {
      /* An error lingers: it usually carries an instruction, and four seconds
         is not long enough to read one and act on it. */
      const opts = { duration: t.kind === 'error' ? 7000 : 4000 };
      if (t.kind === 'success') sonnerToast.success(t.message, opts);
      else if (t.kind === 'error') sonnerToast.error(t.message, opts);
      else sonnerToast(t.message, opts);
    });
    const offConfirms = subscribeConfirms((req) => setConfirm(req));
    return () => {
      offToasts();
      offConfirms();
    };
  }, []);

  useEffect(() => {
    if (!confirm) return undefined;
    cancelRef.current?.focus();
    const onKey = (e) => {
      if (e.key === 'Escape') {
        confirm.resolve(false);
        setConfirm(null);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [confirm]);

  const settle = (ok) => {
    confirm?.resolve(ok);
    setConfirm(null);
  };

  return (
    <>
      {/*
        Sonner draws the stack. It arrived with swipe-to-dismiss, hover-to-pause
        and a stack that reflows when one is taken from the middle — all of
        which had been hand-built here, the last of it this morning.
        `richColors` is off: the tones come from this product's own tokens so a
        success toast is the same green as a paid pill.
      */}
      <SonnerToaster
        position="bottom-right"
        offset={16}
        gap={8}
        visibleToasts={5}
        /*
         * Sonner injects its own stylesheet with `z-index: 999999999` on
         * `[data-sonner-toaster]`, which is outside this product's layer scale
         * entirely — it would paint over the command palette, and over any
         * tier added later. `style` is a documented Toaster prop and lands as
         * an inline style, which beats the injected rule without `!important`
         * and without reaching into rendered third-party DOM.
         *
         * The tier is the one DESIGN.md already states: a toast outranks the
         * dialog that caused it, and the command palette outranks the toast.
         */
        style={{ zIndex: 'var(--z-toast)' }}
        toastOptions={{
          duration: 4000,
          classNames: {
            toast: 'ui-card ui-sonner',
            title: 'text-sm leading-snug',
            closeButton: 'ui-icon-btn',
          },
        }}
      />

      {/* --- confirm dialog --- */}
      {confirm ? (
        <div
          className="fixed inset-0 flex items-center justify-center p-4"
      style={{ zIndex: 'var(--z-toast)' }}
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-title"
        >
          <div
            className="absolute inset-0"
            style={{ backgroundColor: 'rgb(0 0 0 / 0.45)' }}
            onClick={() => settle(false)}
            aria-hidden="true"
          />
          <div className="ui-card ui-in-pop relative w-full max-w-sm p-5" style={{ boxShadow: 'var(--shadow-pop)' }}>
            <h2 id="confirm-title" className="ui-t-sec">{confirm.title}</h2>
            {confirm.message ? <p className="ui-muted mt-2 text-sm leading-relaxed">{confirm.message}</p> : null}
            <div className="mt-5 flex justify-end gap-2">
              <button ref={cancelRef} type="button" onClick={() => settle(false)} className="ui-btn ui-btn-secondary">
                Cancel
              </button>
              <button
                type="button"
                onClick={() => settle(true)}
                className={`ui-btn ${confirm.tone === 'danger' ? 'ui-btn-danger' : 'ui-btn-primary'}`}
              >
                {confirm.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
