import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft } from 'lucide-react';

import LoadFailed from '../components/LoadFailed';
import { SignedOut, getDesk, getDeskCase, raiseDesk, reopenDesk, replyDesk } from './portalApi';

/**
 * Ask HR as a conversation (DESK-01..04, server: peoplePortal /desk): my
 * questions, each opening to its thread with HR (internal notes never come
 * here), a reply box while it is open, and Reopen within seven days of an
 * answer. A question where HR wrote last is badged. `preset` opens a new
 * question already filled (the Pay card asks this way).
 */
const STATUS = {
  OPEN: ['Waiting for HR', 'ui-pill-neutral'],
  REOPENED: ['Reopened, waiting for HR', 'ui-pill-neutral'],
  WAITING_EMPLOYEE: ['HR is waiting for you', 'ui-pill-warn'],
  RESOLVED: ['Answered', 'ui-pill-pos'],
  MOVED: ['Moved', 'ui-pill-neutral'],
};
const REOPEN_DAYS = 7;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const when = (v) => {
  if (!v) return '';
  const [y, m, d] = new Date(new Date(v).getTime() + 330 * 60_000).toISOString().slice(0, 10).split('-');
  return `${Number(d)} ${MONTHS[Number(m) - 1]} ${y}`;
};
const errText = (e, fallback) => (e instanceof SignedOut ? '' : String(e?.message || fallback));
const EMPTY = { category: '', subject: '', description: '' };

export default function AskHr({ guard, preset, onPresetUsed, onAvailability }) {
  const [data, setData] = useState(null);
  const [failed, setFailed] = useState('');
  const [openId, setOpenId] = useState(null);
  const [asking, setAsking] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null);
  const ref = useRef(null);
  const load = useCallback(() => {
    guard(getDesk())
      .then((d) => { setData(d); setFailed(''); onAvailability?.(Boolean(d?.available)); })
      .catch((e) => setFailed(errText(e, 'Could not load your questions to HR.')));
  }, [guard, onAvailability]);
  useEffect(() => { load(); }, [load]);

  /* A preset opens the new-question form, filled, and brings it into view. */
  useEffect(() => {
    if (!preset || !data?.available) return;
    const cats = data.categories || [];
    const category = cats.find((c) => c.key === preset.category)?.key || cats[0]?.key || '';
    setOpenId(null);
    setForm({ category, subject: preset.subject || '', description: preset.description || '' });
    setNote(null);
    setAsking(true);
    onPresetUsed?.();
    ref.current?.scrollIntoView?.({ block: 'start' });
  }, [preset, data, onPresetUsed]);

  if (failed) return <LoadFailed message={failed} onRetry={load} />;
  if (!data?.available) return null;
  const cats = data.categories || [];
  const startAsk = () => { setForm({ ...EMPTY, category: cats[0]?.key || '' }); setNote(null); setAsking(true); };
  const send = async (e) => {
    e.preventDefault();
    setBusy(true);
    setNote(null);
    try {
      await guard(raiseDesk({ category: form.category, subject: form.subject, description: form.description }));
      setAsking(false);
      setForm(EMPTY);
      setNote({ ok: true, text: 'Sent. HR answers here.' });
      load();
    } catch (err) {
      const text = errText(err, 'Not sent.');
      if (text) setNote({ ok: false, text });
    } finally {
      setBusy(false);
    }
  };
  const label = (key) => cats.find((c) => c.key === key)?.label || key;

  if (openId) return <div ref={ref}><Thread id={openId} guard={guard} label={label} onBack={() => { setOpenId(null); load(); }} /></div>;
  return (
    <section ref={ref} className="ui-card space-y-3 p-5" aria-labelledby="ask-hr-h">
      <div className="flex items-center justify-between gap-2">
        <h2 id="ask-hr-h" className="ui-t-sec">Ask HR</h2>
        {!asking ? <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={startAsk}>New question</button> : null}
      </div>
      {note ? <p className="text-sm" role={note.ok ? 'status' : 'alert'}>{note.text}</p> : null}
      {asking ? (
        <form onSubmit={send} className="space-y-3">
          <label className="block"><span className="ui-label">About</span>
            <select className="ui-select w-full" value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}>
              {cats.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
            </select>
          </label>
          <label className="block"><span className="ui-label">In a few words *</span><input className="ui-input w-full" required maxLength={200} value={form.subject} onChange={(e) => setForm((f) => ({ ...f, subject: e.target.value }))} placeholder="October salary is short" /></label>
          <label className="block"><span className="ui-label">What happened *</span><textarea className="ui-input w-full" rows={4} required minLength={5} maxLength={5000} value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} /></label>
          <div className="flex gap-2">
            <button type="submit" className="ui-btn ui-btn-primary flex-1" disabled={busy}>{busy ? 'Sending…' : 'Send to HR'}</button>
            <button type="button" className="ui-btn ui-btn-secondary" onClick={() => setAsking(false)}>Cancel</button>
          </div>
        </form>
      ) : null}
      {data.requests.length ? (
        <ul className="divide-y" style={{ borderColor: 'rgb(var(--border))' }}>
          {data.requests.map((r) => {
            const [words, pill] = STATUS[r.status] || [r.status, 'ui-pill-neutral'];
            return (
              <li key={r.id}>
                <button type="button" className="flex w-full items-start justify-between gap-2 py-3 text-left text-sm" onClick={() => setOpenId(r.id)} disabled={r.status === 'MOVED'}>
                  <span className="min-w-0">
                    <span className="block font-medium">{r.subject}</span>
                    <span className="ui-caption">{label(r.category)} · {when(r.createdAt)}</span>
                  </span>
                  <span className="flex shrink-0 flex-col items-end gap-1">
                    {r.hrWroteLast ? <span className="ui-pill ui-pill-warn">HR replied</span> : null}
                    <span className={`ui-pill ${pill}`}>{words}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : !asking ? <p className="ui-caption">Questions about pay, leave or documents go straight to HR, and the answer comes back here.</p> : null}
    </section>
  );
}

function Thread({ id, guard, label, onBack }) {
  const [r, setR] = useState(null);
  const [failed, setFailed] = useState('');
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null);
  const load = useCallback(() => {
    guard(getDeskCase(id))
      .then((d) => { setR(d.request); setFailed(''); })
      .catch((e) => setFailed(errText(e, 'Could not open this question.')));
  }, [id, guard]);
  useEffect(() => { load(); }, [load]);
  const act = async (fn, done) => {
    setBusy(true);
    setNote(null);
    try {
      await guard(fn());
      done?.();
      load();
    } catch (err) {
      const text = errText(err, 'Not done.');
      if (text) setNote({ ok: false, text });
    } finally {
      setBusy(false);
    }
  };
  const resolved = r?.status === 'RESOLVED';
  const canReopen = resolved && r.resolvedAt && Date.now() - new Date(r.resolvedAt).getTime() <= REOPEN_DAYS * 86_400_000;
  return (
    <section className="ui-card space-y-3 p-5" aria-labelledby="thread-h">
      <button type="button" className="ui-btn ui-btn-ghost ui-btn-sm" onClick={onBack}><ChevronLeft size={16} aria-hidden="true" /> All questions</button>
      <LoadFailed message={failed} onRetry={load} />
      {!r && !failed ? <p className="ui-caption">Loading…</p> : null}
      {r ? (
        <>
          <div>
            <h2 id="thread-h" className="ui-t-sec">{r.subject}</h2>
            <p className="ui-caption">{label(r.category)} · asked {when(r.createdAt)}</p>
          </div>
          <ol className="space-y-3 text-sm" aria-label="Messages">
            <li className="space-y-0.5"><p className="ui-caption">You · {when(r.createdAt)}</p><p className="whitespace-pre-wrap">{r.description}</p></li>
            {r.messages.map((m) => (
              <li key={m.id} className="space-y-0.5 rounded-xl p-3" style={m.from === 'HR' ? { backgroundColor: 'rgb(var(--app-bg))' } : undefined}>
                <p className="ui-caption">{m.from === 'HR' ? m.authorName || 'HR' : 'You'} · {when(m.createdAt)}</p>
                <p className="whitespace-pre-wrap">{m.body}</p>
              </li>
            ))}
            {resolved && r.resolution ? (
              <li className="space-y-0.5 rounded-xl p-3" style={{ backgroundColor: 'rgb(var(--app-bg))' }}>
                <p className="ui-caption">HR’s answer · {when(r.resolvedAt)}</p>
                <p className="whitespace-pre-wrap">{r.resolution}</p>
              </li>
            ) : null}
          </ol>
          {note ? <p className="text-sm" role="alert">{note.text}</p> : null}
          {resolved ? (
            canReopen ? (
              <div className="space-y-1">
                <p className="ui-caption">Not settled? Reopen it within {REOPEN_DAYS} days of the answer.</p>
                <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" disabled={busy} onClick={() => act(() => reopenDesk(id))}>Reopen</button>
              </div>
            ) : <p className="ui-caption">Answered more than {REOPEN_DAYS} days ago. Ask a new question if you need more.</p>
          ) : r.status === 'MOVED' ? null : (
            <form onSubmit={(e) => { e.preventDefault(); act(() => replyDesk(id, reply), () => setReply('')); }} className="space-y-2">
              <label className="block"><span className="ui-label">Your reply</span>
                <textarea className="ui-input w-full" rows={3} maxLength={5000} value={reply} onChange={(e) => setReply(e.target.value)} />
              </label>
              <button type="submit" className="ui-btn ui-btn-primary w-full" disabled={busy || !reply.trim()}>{busy ? 'Sending…' : 'Send reply'}</button>
            </form>
          )}
        </>
      ) : null}
    </section>
  );
}
