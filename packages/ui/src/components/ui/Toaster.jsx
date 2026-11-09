import React, { useEffect, useRef, useState } from 'react';
import { X } from '@ui/components/ui/lineIcons';
import { Toaster as SonnerToaster, toast as sonnerToast } from 'sonner';

import { EXPLORE_READ_ONLY_TEXT, subscribeConfirms, subscribeToasts } from './notify';

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
  /* An authenticator code asked for by @platform/http (step-up). */
  const [codeAsk, setCodeAsk] = useState(null);
  const [code, setCode] = useState('');

  useEffect(() => {
    window.__clorStepUpHost = (Number(window.__clorStepUpHost) || 0) + 1;
    const onAsk = (e) => {
      /* Two Toasters can be mounted (shell and an app); one answers. */
      if (e.detail.taken) return;
      e.detail.taken = true;
      setCode('');
      setCodeAsk(e.detail);
    };
    window.addEventListener('clor:step-up', onAsk);
    return () => {
      window.__clorStepUpHost = Math.max(0, (Number(window.__clorStepUpHost) || 1) - 1);
      window.removeEventListener('clor:step-up', onAsk);
    };
  }, []);
  const answer = (value) => {
    codeAsk?.resolve(value);
    setCodeAsk(null);
  };

  useEffect(() => {
    const offToasts = subscribeToasts((t) => {
      /* An error lingers: it usually carries an instruction, and four seconds
         is not long enough to read one and act on it. */
      const opts = { duration: t.kind === 'error' ? 7000 : 4000 };
      /* Explore: the shell and the screen that tried may both say the sample refused a change; one toast. */
      if (t.message === EXPLORE_READ_ONLY_TEXT) opts.id = 'explore-read-only';
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

      {/* --- authenticator code (step-up) --- */}
      {codeAsk ? (
        <div className="fixed inset-0 flex items-center justify-center p-4" style={{ zIndex: 'var(--z-toast)' }} role="dialog" aria-modal="true" aria-labelledby="code-title">
          <div className="absolute inset-0" style={{ backgroundColor: 'rgb(0 0 0 / 0.45)' }} onClick={() => answer(null)} aria-hidden="true" />
          <form
            className="ui-card ui-in-pop relative w-full max-w-sm p-5"
            style={{ boxShadow: 'var(--shadow-pop)' }}
            onSubmit={(e) => {
              e.preventDefault();
              answer(code.trim() || null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') answer(null);
            }}
          >
            <h2 id="code-title" className="ui-t-sec">Authenticator code</h2>
            <p className="ui-muted mt-2 text-sm leading-relaxed">{codeAsk.message}</p>
            <input
              autoFocus
              className="ui-input ui-num mt-3 w-full text-center tracking-widest"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={9}
              aria-label="Code from your authenticator app"
              placeholder="123456"
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
            <p className="ui-caption mt-2">Lost your phone? A recovery code works once instead.</p>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => answer(null)} className="ui-btn ui-btn-secondary">Cancel</button>
              <button type="submit" className="ui-btn ui-btn-primary" disabled={!code.trim()}>Continue</button>
            </div>
          </form>
        </div>
      ) : null}
    </>
  );
}
