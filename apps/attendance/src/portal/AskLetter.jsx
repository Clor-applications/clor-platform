import React, { useCallback, useEffect, useState } from 'react';

import LoadFailed from '@ui/components/ui/LoadFailed';
import { confirmDialog } from '@ui/components/ui/notify';
import { SignedOut, askLetter, getMyLetters, withdrawMyRequest } from './portalApi';

/**
 * Ask HR for a letter, or a copy of a document on my file, from the employee
 * app's Me tab (People plan 8 Nov 2026, step 6). A letter HR approves lands
 * in My documents; a copy, HR shares. The leaving letters show once I am
 * leaving. Follow each ask and withdraw it while it waits.
 */
const STATUS = {
  WAITING: ['Waiting for HR', 'ui-pill-warn'],
  MORE_INFO: ['HR asks for more', 'ui-pill-warn'],
  APPROVED: ['Approved', 'ui-pill-pos'],
  REJECTED: ['Not approved', 'ui-pill-neg'],
  WITHDRAWN: ['Withdrawn', 'ui-pill-neutral'],
};
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const when = (v) => {
  if (!v) return '';
  const [y, m, d] = new Date(new Date(v).getTime() + 330 * 60_000).toISOString().slice(0, 10).split('-');
  return `${Number(d)} ${MONTHS[Number(m) - 1]} ${y}`;
};
const errText = (e, fallback) => (e instanceof SignedOut ? '' : String(e?.message || fallback));
const COPY = 'COPY';

export default function AskLetter({ guard, onIssued }) {
  const [data, setData] = useState(null);
  const [failed, setFailed] = useState('');
  const [kind, setKind] = useState('');
  const [what, setWhat] = useState('');
  const [why, setWhy] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null);
  const load = useCallback(() => {
    guard(getMyLetters())
      .then((d) => { setData({ kinds: d?.kinds || [], requests: d?.requests || [] }); setFailed(''); })
      .catch((e) => setFailed(errText(e, 'Could not load your letters.')));
  }, [guard]);
  useEffect(() => { load(); }, [load]);

  const send = async (e) => {
    e.preventDefault();
    if (!kind) return;
    setBusy(true);
    setNote(null);
    try {
      const r = await guard(askLetter({ kind, what: kind === COPY ? what : undefined, note: why || undefined }));
      setKind(''); setWhat(''); setWhy('');
      setNote({ ok: true, text: r?.request?.status === 'APPROVED' ? 'Approved. It is in My documents.' : 'Sent to HR. You will see it here when they decide.' });
      if (r?.request?.status === 'APPROVED') onIssued?.();
      load();
    } catch (err) {
      const text = errText(err, 'Not sent.');
      if (text) setNote({ ok: false, text });
    } finally {
      setBusy(false);
    }
  };
  const withdraw = async (r) => {
    if (!(await confirmDialog({ title: 'Withdraw this ask?', message: r.title, confirmLabel: 'Withdraw' }))) return;
    try {
      await guard(withdrawMyRequest(r.id));
      setNote({ ok: true, text: 'Withdrawn.' });
      load();
    } catch (err) {
      const text = errText(err, 'Not withdrawn.');
      if (text) setNote({ ok: false, text });
    }
  };

  if (failed) return <LoadFailed message={failed} onRetry={load} />;
  if (!data) return null;
  return (
    <section className="ui-card space-y-3 p-5" aria-labelledby="ask-letter-h">
      <h2 id="ask-letter-h" className="ui-t-sec">Letters</h2>
      {note ? <p className="text-sm" role={note.ok ? 'status' : 'alert'} style={note.ok ? undefined : { color: 'rgb(var(--neg))' }}>{note.text}</p> : null}
      <form onSubmit={send} className="space-y-3" aria-label="Ask for a letter">
        <label className="block">
          <span className="ui-label">Ask for</span>
          <select className="ui-select w-full" value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="">Choose a letter</option>
            {data.kinds.map((k) => <option key={k.kind} value={k.kind}>{k.label}</option>)}
            <option value={COPY}>A copy of a document on my file</option>
          </select>
        </label>
        {kind === COPY ? (
          <label className="block"><span className="ui-label">Which document</span><input className="ui-input w-full" required maxLength={200} value={what} onChange={(e) => setWhat(e.target.value)} placeholder="My signed appointment letter" /></label>
        ) : null}
        {kind ? <label className="block"><span className="ui-label">What it is for</span><input className="ui-input w-full" maxLength={500} value={why} onChange={(e) => setWhy(e.target.value)} placeholder="For my bank" /></label> : null}
        {kind ? <button type="submit" className="ui-btn ui-btn-secondary w-full" disabled={busy || (kind === COPY && !what.trim())} aria-busy={busy || undefined}>Send to HR</button> : null}
      </form>
      {data.requests.length ? (
        <ul className="divide-y" style={{ borderColor: 'rgb(var(--border))' }} aria-label="My letter requests">
          {data.requests.map((r) => {
            const [label, pill] = STATUS[r.status] || [r.status, 'ui-pill-neutral'];
            const open = r.status === 'WAITING' || r.status === 'MORE_INFO';
            return (
              <li key={r.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                <span className="min-w-0">
                  <span className="block truncate font-medium">{r.title.replace(/^[^:]*:\s*/, '').replace(/^./, (c) => c.toUpperCase())}</span>
                  <span className="ui-caption">Asked {when(r.createdAt)}{r.issued ? ' · in My documents' : r.status === 'APPROVED' ? ' · HR is preparing it' : ''}</span>
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  <span className={`ui-pill ${pill}`}>{label}</span>
                  {open ? <button type="button" className="ui-btn ui-btn-ghost ui-btn-sm" onClick={() => withdraw(r)}>Withdraw</button> : null}
                </span>
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}
