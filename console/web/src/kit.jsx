import React, { createContext, useCallback, useContext, useEffect, useId, useRef, useState } from 'react';
import { AlertTriangle, Check, X } from 'lucide-react';

import { api } from './api';

/** "3 hours ago", in plain words; the exact time is the title. */
export function ago(value) {
  if (!value) return '';
  const ms = Date.now() - new Date(value).getTime();
  if (Number.isNaN(ms)) return '';
  const mins = Math.round(ms / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 36) return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;
  const days = Math.round(hours / 24);
  return `${days} days ago`;
}
export const exact = (value) => (value ? new Date(value).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');

export function When({ at }) {
  return at ? <time dateTime={new Date(at).toISOString()} title={exact(at)}>{ago(at)}</time> : null;
}

/* A status is a colour and a word, never a colour alone. */
export function Pill({ tone = 'none', children }) {
  return <span className={`con-pill con-pill--${tone}`}>{children}</span>;
}

export function PageHead({ title, children }) {
  return (
    <header className="con-head">
      <h1 className="con-title">{title}</h1>
      <div className="con-head-actions">{children}</div>
    </header>
  );
}

export function Notice({ tone = 'warn', children }) {
  return (
    <p className={`con-notice con-notice--${tone}`} role={tone === 'bad' ? 'alert' : 'status'}>
      {tone === 'ok' ? <Check size={16} aria-hidden="true" /> : <AlertTriangle size={16} aria-hidden="true" />}
      <span>{children}</span>
    </p>
  );
}

export const Loading = () => <p className="con-quiet" role="status">Loading…</p>;

/** Loads on mount and on `reload()`. Keeps the last answer on screen while it loads again. */
export function useLoad(load, deps = []) {
  const [state, setState] = useState({ data: null, error: null, loading: true });
  const run = useCallback(() => {
    setState((s) => ({ ...s, loading: true }));
    return load().then(
      (data) => setState({ data, error: null, loading: false }),
      (error) => setState((s) => ({ data: s.data, error, loading: false })),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => {
    run();
  }, [run]);
  return { ...state, reload: run };
}

export function Dialog({ title, onClose, children, footer }) {
  const ref = useRef(null);
  const id = useId();
  useEffect(() => {
    const el = ref.current;
    if (!el || el.open) return;
    el.showModal();
    /* showModal puts focus on the first control, the close button. The field is where typing starts. */
    el.querySelector('input, textarea, select')?.focus();
  }, []);
  return (
    <dialog ref={ref} className="con-dialog" aria-labelledby={id} onCancel={(e) => { e.preventDefault(); onClose(); }}>
      <div className="con-dialog-head">
        <h2 id={id} className="con-h2">{title}</h2>
        <button type="button" className="ui-btn ui-btn-ghost ui-btn-sm" onClick={onClose} aria-label="Close"><X size={16} aria-hidden="true" /></button>
      </div>
      <div className="con-dialog-body">{children}</div>
      {footer ? <div className="con-dialog-foot">{footer}</div> : null}
    </dialog>
  );
}

/*
 * Every change asks for an authenticator code no older than five minutes.
 * `guard(run)` tries the change; if the API asks for a code it opens the code
 * box, and once the code is accepted runs the change again.
 */
const GuardContext = createContext(null);
export const useGuard = () => useContext(GuardContext).guard;
/** Asks for a code now; resolves once one is accepted. For steps that leave the page (connecting GitHub). */
export const useAskCode = () => useContext(GuardContext).askCode;

export function GuardProvider({ children }) {
  const [waiting, setWaiting] = useState(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const guard = useCallback(
    (run) =>
      run().catch((e) => {
        /* Signed in with CLOR and about to change something on GitHub: that needs their own GitHub account connected. */
        if (e.code === 'CONNECT_GITHUB') throw Object.assign(new Error('Connect your GitHub account first (Your sign-in, in the menu). A change on GitHub is made in your own name.'), { code: e.code });
        if (e.code !== 'STEP_UP') throw e;
        return new Promise((resolve, reject) => setWaiting({ run, resolve, reject }));
      }),
    [],
  );
  const askCode = useCallback(() => new Promise((resolve, reject) => setWaiting({ run: async () => {}, resolve, reject })), []);
  const close = () => {
    waiting?.reject(Object.assign(new Error('No code was entered, so nothing was changed.'), { cancelled: true }));
    setWaiting(null);
    setCode('');
    setError('');
  };
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api.stepUp(code);
      const w = waiting;
      setWaiting(null);
      setCode('');
      w.run().then(w.resolve, w.reject);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <GuardContext.Provider value={{ guard, askCode }}>
      {children}
      {waiting ? (
        <Dialog title="Enter your authenticator code" onClose={close}>
          <form onSubmit={submit} className="con-form">
            <label className="con-label" htmlFor="con-code">Six-digit code</label>
            <input id="con-code" className="con-input con-input--code" inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} required autoFocus value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} aria-describedby={error ? 'con-code-error' : undefined} aria-invalid={error ? 'true' : undefined} />
            {error ? <p id="con-code-error" className="con-error" role="alert">{error}</p> : null}
            <div className="con-dialog-foot">
              <button type="button" className="ui-btn ui-btn-secondary" onClick={close}>Cancel</button>
              <button type="submit" className="ui-btn con-btn-primary" disabled={busy || code.length !== 6}>Continue</button>
            </div>
          </form>
        </Dialog>
      ) : null}
    </GuardContext.Provider>
  );
}

/** A change that needs a reason: says what will happen, asks why, then does it. */
export function ReasonDialog({ title, lede, label = 'Reason', confirm, danger = false, onClose, onConfirm }) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await onConfirm(reason.trim());
      onClose();
    } catch (err) {
      if (!err.cancelled) setError(err.message);
      setBusy(false);
    }
  };
  return (
    <Dialog title={title} onClose={onClose}>
      <form onSubmit={submit} className="con-form">
        {lede ? <p className="con-lede">{lede}</p> : null}
        <label className="con-label" htmlFor="con-reason">{label}</label>
        <textarea id="con-reason" className="con-input" rows={3} required minLength={3} maxLength={500} autoFocus value={reason} onChange={(e) => setReason(e.target.value)} />
        {error ? <p className="con-error" role="alert">{error}</p> : null}
        <div className="con-dialog-foot">
          <button type="button" className="ui-btn ui-btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" className={`ui-btn ${danger ? 'ui-btn-danger' : 'con-btn-primary'}`} disabled={busy || reason.trim().length < 3}>{confirm}</button>
        </div>
      </form>
    </Dialog>
  );
}

/** A change that needs no reason but cannot be undone: says what will happen, then does it. */
export function ConfirmDialog({ title, lede, confirm, cancel = 'Cancel', danger = false, onClose, onConfirm }) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await onConfirm();
      onClose();
    } catch (err) {
      if (!err.cancelled) setError(err.message);
      setBusy(false);
    }
  };
  return (
    <Dialog title={title} onClose={onClose}>
      <form onSubmit={submit} className="con-form">
        {lede ? <p className="con-lede">{lede}</p> : null}
        {error ? <p className="con-error" role="alert">{error}</p> : null}
        <div className="con-dialog-foot">
          <button type="button" className="ui-btn ui-btn-secondary" onClick={onClose}>{cancel}</button>
          <button type="submit" className={`ui-btn ${danger ? 'ui-btn-danger' : 'con-btn-primary'}`} disabled={busy}>{confirm}</button>
        </div>
      </form>
    </Dialog>
  );
}

/** Runs one change through the code guard and reports how it went. */
export function useAction(reload) {
  const guard = useGuard();
  const [state, setState] = useState({ busy: '', error: '', done: '' });
  const run = useCallback(
    async (key, change, done) => {
      setState({ busy: key, error: '', done: '' });
      try {
        await guard(change);
        setState({ busy: '', error: '', done: done || '' });
        await reload?.();
      } catch (e) {
        setState({ busy: '', error: e.cancelled ? '' : e.message, done: '' });
        if (e.cancelled || !reload) return;
        await reload();
      }
    },
    [guard, reload],
  );
  /* For a change made inside a ReasonDialog: the dialog shows the error itself. */
  const through = useCallback(
    async (change, done) => {
      await guard(change);
      setState({ busy: '', error: '', done: done || '' });
      await reload?.();
    },
    [guard, reload],
  );
  return { ...state, run, through };
}
