import React, { useCallback, useEffect, useState } from 'react';

import LoadFailed from '../components/LoadFailed';
import FormFields from '@ui/requests/FormFields';
import { missingIn, openFile } from '@ui/requests/formFiles';
import { confirmDialog } from '@ui/components/ui/notify';
import { SignedOut, askFormRequest, getFormFile, getForms, replyFormRequest, withdrawFormRequest } from './portalApi';

/**
 * Requests HR set up, in the employee app (People, FEATURE-UI-AUDIT gap 25),
 * on the Me tab: ask for one (an ID card, a salary certificate, an asset),
 * follow it, answer when HR asks for more, withdraw it while it waits.
 * Hidden when HR has set none up and I have asked for nothing.
 */
const STATUS = {
  WAITING: ['Waiting for approval', 'ui-pill-warn'],
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
const newKey = () => (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);

export default function MyForms({ guard }) {
  const [data, setData] = useState(null);
  const [failed, setFailed] = useState('');
  const [asking, setAsking] = useState(null);
  const [openId, setOpenId] = useState(null);
  const [note, setNote] = useState(null);
  const load = useCallback(() => {
    guard(getForms())
      .then((d) => { setData({ forms: d?.forms || [], requests: d?.requests || [] }); setFailed(''); })
      .catch((e) => setFailed(errText(e, 'Could not load your requests.')));
  }, [guard]);
  useEffect(() => { load(); }, [load]);

  if (failed) return <LoadFailed message={failed} onRetry={load} />;
  if (!data || (!data.forms.length && !data.requests.length)) return null;
  return (
    <section className="ui-card space-y-3 p-5" aria-labelledby="my-forms-h">
      <h2 id="my-forms-h" className="ui-t-sec">Requests to HR</h2>
      {note ? <p className="text-sm" role={note.ok ? 'status' : 'alert'} style={note.ok ? undefined : { color: 'rgb(var(--neg))' }}>{note.text}</p> : null}
      {asking ? (
        <Ask form={asking} guard={guard} onCancel={() => setAsking(null)} onSent={(text) => { setAsking(null); setNote({ ok: true, text }); load(); }} />
      ) : data.forms.length ? (
        <div className="flex flex-wrap gap-2" aria-label="Ask for">
          {data.forms.map((f) => <button key={f.id} type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={() => { setNote(null); setAsking(f); }}>{f.name}</button>)}
        </div>
      ) : null}
      {data.requests.length ? (
        <ul className="divide-y" style={{ borderColor: 'rgb(var(--border))' }} aria-label="My requests to HR">
          {data.requests.map((r) => (
            <Row key={r.id} r={r} open={openId === r.id} onToggle={() => setOpenId(openId === r.id ? null : r.id)} guard={guard} onDone={(text, ok = true) => { setNote({ ok, text }); load(); }} />
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function Ask({ form, guard, onCancel, onSent }) {
  const [answers, setAnswers] = useState({});
  const [files, setFiles] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [key] = useState(newKey);
  const missing = missingIn(form.fields, answers, files);
  const send = async (e) => {
    e.preventDefault();
    if (missing) { setError(missing); return; }
    setBusy(true);
    setError('');
    try {
      await guard(askFormRequest(form.id, { answers, files: Object.fromEntries(Object.entries(files).filter(([, v]) => v)), idempotencyKey: key }));
      onSent(`Sent. HR decides within ${form.slaDays} working days; the answer shows here.`);
    } catch (err) {
      const t = errText(err, 'Not sent.');
      if (t) setError(t);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={send} className="space-y-3" aria-label={form.name}>
      <h3 className="font-semibold">{form.name}</h3>
      {form.description ? <p className="text-sm ui-muted">{form.description}</p> : null}
      <FormFields fields={form.fields} answers={answers} files={files} onAnswer={(k, v) => setAnswers((a) => ({ ...a, [k]: v }))} onFile={(k, v) => setFiles((f) => ({ ...f, [k]: v }))} idPrefix="app-ask" />
      {error ? <p className="text-sm" role="alert" style={{ color: 'rgb(var(--neg))' }}>{error}</p> : null}
      <div className="flex gap-2">
        <button type="submit" className="ui-btn ui-btn-primary flex-1" disabled={busy}>{busy ? 'Sending…' : 'Send to HR'}</button>
        <button type="button" className="ui-btn ui-btn-secondary" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

function Row({ r, open, onToggle, guard, onDone }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState('');
  const [words, pill] = STATUS[r.status] || [r.status, 'ui-pill-neutral'];
  const act = async (what) => {
    if (what === 'withdraw' && !(await confirmDialog({ title: 'Withdraw this request?', message: 'HR will no longer decide it. You can ask again later.', confirmLabel: 'Withdraw' }))) return;
    setBusy(what);
    try {
      if (what === 'reply') await guard(replyFormRequest(r.id, text.trim()));
      else await guard(withdrawFormRequest(r.id));
      setText('');
      onDone(what === 'reply' ? 'Answer sent.' : 'Withdrawn.');
    } catch (e) {
      const t = errText(e, 'Not done.');
      if (t) onDone(t, false);
    } finally {
      setBusy('');
    }
  };
  return (
    <li className="py-3 text-sm">
      <button type="button" className="flex w-full items-start justify-between gap-2 text-left" aria-expanded={open} onClick={onToggle}>
        <span className="min-w-0">
          <span className="block font-medium">{r.formName}</span>
          <span className="ui-caption">{when(r.askedAt)}</span>
        </span>
        <span className={`ui-pill shrink-0 ${pill}`}>{words}</span>
      </button>
      {open ? (
        <div className="mt-2 space-y-2">
          <dl className="space-y-1">
            {r.lines.map((l) => <div key={l.label}><dt className="ui-caption">{l.label}</dt><dd>{l.value}</dd></div>)}
          </dl>
          {r.files.map((f) => <button key={f.fileId} type="button" className="ui-link text-xs" onClick={() => guard(getFormFile(f.fileId)).then(openFile).catch(() => undefined)}>{f.name}</button>)}
          {r.said ? <p><span className="ui-caption">{r.status === 'MORE_INFO' ? 'HR asks: ' : 'HR: '}</span>{r.said}</p> : null}
          {(r.replies || []).map((x) => <p key={x.at}><span className="ui-caption">You: </span>{x.note}</p>)}
          {r.status === 'MORE_INFO' ? (
            <div className="space-y-2">
              <textarea className="ui-input w-full" rows={2} maxLength={1000} aria-label="Your answer" placeholder="Your answer" value={text} onChange={(e) => setText(e.target.value)} />
              <button type="button" className="ui-btn ui-btn-primary w-full" disabled={!text.trim() || Boolean(busy)} onClick={() => act('reply')}>{busy === 'reply' ? 'Sending…' : 'Send answer'}</button>
            </div>
          ) : null}
          {['WAITING', 'MORE_INFO'].includes(r.status) ? <button type="button" className="ui-link text-xs" disabled={Boolean(busy)} onClick={() => act('withdraw')}>Withdraw</button> : null}
        </div>
      ) : null}
    </li>
  );
}
