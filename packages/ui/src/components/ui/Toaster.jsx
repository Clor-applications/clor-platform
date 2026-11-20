import React, { useEffect, useRef, useState } from 'react';
import { Toaster as SonnerToaster, toast as sonnerToast } from 'sonner';

import { EXPLORE_READ_ONLY_TEXT, subscribeConfirms, subscribeToasts } from './notify';
import { useLayer } from './layerStack';

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
 * delete anything. Both prompts sit on the shared layer stack: Tab stays
 * inside, Escape closes only them (never the dialog that opened them), and
 * focus goes back where it was. A confirm given an `action` stays open while
 * it runs and cannot be cancelled half way; the code prompt stays open,
 * saying it is checking, until the server answers.
 */

const restoreFocus = (el) => {
  if (el && typeof el.focus === 'function' && document.contains(el)) el.focus();
};

export default function Toaster() {

  const books = typeof document !== 'undefined' && document.documentElement.dataset.palette === 'indigo';
  const [confirm, setConfirm] = useState(null);
  /* The confirm's own request (an `action` passed to confirmDialog) is running. */
  const [confirmBusy, setConfirmBusy] = useState(false);
  const [confirmError, setConfirmError] = useState('');
  const cancelRef = useRef(null);
  const confirmPanelRef = useRef(null);
  /* An authenticator code asked for by @platform/http (step-up). */
  const [codeAsk, setCodeAsk] = useState(null);
  const [code, setCode] = useState('');
  /* Sent, and the server has not answered yet. */
  const [checking, setChecking] = useState(false);
  const codePanelRef = useRef(null);
  const codeInputRef = useRef(null);

  useEffect(() => {
    window.__clorStepUpHost = (Number(window.__clorStepUpHost) || 0) + 1;
    const onAsk = (e) => {
      /* Two Toasters can be mounted (shell and an app); one answers. */
      if (e.detail.taken) return;
      e.detail.taken = true;
      /* How the server answered the code (from @platform/http): a wrong one is asked for again in the
         same dialog; anything else closes it. Set here, on the event, not on the state. */
      const asked = e.detail;
      asked.settle = (outcome) => {
        setChecking(false);
        if (outcome === 'again') return;
        setCodeAsk((cur) => (cur === asked ? null : cur));
      };
      setCode('');
      setChecking(false);
      setCodeAsk(e.detail);
    };
    window.addEventListener('clor:step-up', onAsk);
    return () => {
      window.__clorStepUpHost = Math.max(0, (Number(window.__clorStepUpHost) || 1) - 1);
      window.removeEventListener('clor:step-up', onAsk);
    };
  }, []);

  const answer = (value) => {
    if (!codeAsk) return;
    if (!value) {
      codeAsk.resolve(null);
      setCodeAsk(null);
      return;
    }
    /* Kept open, checking, until the server answers (settle, set when the ask arrived). */
    setChecking(true);
    codeAsk.resolve(value);
  };

  useEffect(() => {
    const offToasts = subscribeToasts((t) => {
      /* An error lingers: it usually carries an instruction, and four seconds
         is not long enough to read one and act on it. */
      const opts = { duration: t.kind === 'error' ? 7000 : 4000 };
      /* A toast can carry one action, such as Undo. */
      if (t.action) opts.action = t.action;
      /* Explore: the shell and the screen that tried may both say the sample refused a change; one toast. */
      if (t.message === EXPLORE_READ_ONLY_TEXT) opts.id = 'explore-read-only';
      if (t.kind === 'success') sonnerToast.success(t.message, opts);
      else if (t.kind === 'error') sonnerToast.error(t.message, opts);
      else sonnerToast(t.message, opts);
    });
    const offConfirms = subscribeConfirms((req) => {
      setConfirmBusy(false);
      setConfirmError('');
      setConfirm(req);
    });
    return () => {
      offToasts();
      offConfirms();
    };
  }, []);

  /* Focus goes to Cancel (or Stay) on open, and back to whatever had it on close. */
  useEffect(() => {
    if (!confirm) return undefined;
    const back = document.activeElement;
    cancelRef.current?.focus();
    return () => restoreFocus(back);
  }, [confirm]);
  useEffect(() => {
    if (!codeAsk) return undefined;
    const back = document.activeElement;
    codeInputRef.current?.focus();
    return () => restoreFocus(back);
  }, [codeAsk]);

  const settle = async (ok) => {
    if (!confirm || confirmBusy) return;
    if (ok && typeof confirm.action === 'function') {
      setConfirmBusy(true);
      setConfirmError('');
      try {
        await confirm.action();
      } catch (err) {
        /* Stays open with the reason, so it can be tried again or cancelled. */
        setConfirmBusy(false);
        setConfirmError(err?.message || 'That did not go through. Try again.');
        return;
      }
      setConfirmBusy(false);
    }
    confirm.resolve(ok);
    setConfirm(null);
  };

  /* A code asked for by a confirmed action opens over the confirm, so it is pushed after it. */
  useLayer(Boolean(confirm), { kind: 'dialog', onEscape: () => settle(false), trap: () => confirmPanelRef.current });
  useLayer(Boolean(codeAsk), {
    kind: 'dialog',
    onEscape: () => {
      if (!checking) answer(null);
    },
    trap: () => codePanelRef.current,
  });

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
        /*
         * Round 29 pick "toaststack" A: outside Books, several quick messages
         * (approving five requests) stand open one above the other, newest
         * in front, three at most, so each one is read. Books keeps its
         * collapsed pile of five.
         */
        visibleToasts={books ? 5 : 3}
        expand={!books}
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
        /* Every toast can be put away by hand, not only by waiting or swiping. */
        closeButton
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
          <div
            ref={confirmPanelRef}
            tabIndex={-1}
            aria-busy={confirmBusy || undefined}
            className="ui-card ui-confirm ui-in-pop relative w-full max-w-sm p-5"
            style={{ boxShadow: 'var(--shadow-pop)' }}
          >
            <h2 id="confirm-title" className="ui-t-sec">{confirm.title}</h2>
            {confirm.message ? <p className="ui-muted mt-2 text-sm leading-relaxed">{confirm.message}</p> : null}
            {confirmError ? <p className="ui-field-error mt-2" role="alert">{confirmError}</p> : null}
            <div className="ui-confirm-actions mt-5 flex justify-end gap-2">
              {confirm.stayFirst ? (
                <>
                  {/* Staying is the main button; leaving is the quiet one beside it. Focus starts on Stay. */}
                  <button type="button" onClick={() => settle(true)} className="ui-btn ui-btn-secondary" disabled={confirmBusy}>
                    {confirm.confirmLabel}
                  </button>
                  <button ref={cancelRef} type="button" onClick={() => settle(false)} className="ui-btn ui-btn-primary" disabled={confirmBusy}>
                    {confirm.cancelLabel || 'Cancel'}
                  </button>
                </>
              ) : (
                <>
                  <button ref={cancelRef} type="button" onClick={() => settle(false)} className="ui-btn ui-btn-secondary" disabled={confirmBusy}>
                    {confirm.cancelLabel || 'Cancel'}
                  </button>
                  <button
                    type="button"
                    onClick={() => settle(true)}
                    disabled={confirmBusy}
                    aria-busy={confirmBusy || undefined}
                    className={`ui-btn ${confirm.tone === 'danger' ? 'ui-btn-danger' : 'ui-btn-primary'}`}
                  >
                    {confirmBusy ? 'Working…' : confirm.confirmLabel}
                  </button>
                </>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {/* --- authenticator code (step-up) --- */}
      {codeAsk ? (
        <div className="fixed inset-0 flex items-center justify-center p-4" style={{ zIndex: 'var(--z-toast)' }} role="dialog" aria-modal="true" aria-labelledby="code-title">
          <div
            className="absolute inset-0"
            style={{ backgroundColor: 'rgb(0 0 0 / 0.45)' }}
            onClick={() => {
              if (!checking) answer(null);
            }}
            aria-hidden="true"
          />
          <form
            ref={codePanelRef}
            tabIndex={-1}
            aria-busy={checking || undefined}
            className="ui-card ui-confirm ui-in-pop relative w-full max-w-sm p-5"
            style={{ boxShadow: 'var(--shadow-pop)' }}
            onSubmit={(e) => {
              e.preventDefault();
              if (!checking && code.trim()) answer(code.trim());
            }}
          >
            <h2 id="code-title" className="ui-t-sec">Enter your authenticator code</h2>
            <p className="ui-muted mt-2 text-sm leading-relaxed">{codeAsk.message}</p>
            <input
              ref={codeInputRef}
              className="ui-input ui-num mt-3 w-full text-center tracking-widest"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={9}
              aria-label="Code from your authenticator app"
              placeholder="123456"
              value={code}
              readOnly={checking}
              onChange={(e) => setCode(e.target.value)}
            />
            <p className="ui-caption mt-2">Lost your phone? A recovery code works once instead.</p>
            <div className="ui-confirm-actions mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => answer(null)} className="ui-btn ui-btn-secondary" disabled={checking}>Cancel</button>
              <button type="submit" className="ui-btn ui-btn-primary" disabled={checking || !code.trim()} aria-busy={checking || undefined}>
                {checking ? 'Checking…' : 'Confirm code'}
              </button>
            </div>
          </form>
        </div>
      ) : null}
    </>
  );
}
