import React, { useCallback, useEffect, useRef, useState } from 'react';

import SuggestInput from '../components/ui/SuggestInput';
import { dayWords, rupees } from './words';

/**
 * Jobs and referrals for someone who works here (server: services/people/talent/referrals.ts),
 * shared by the employee app (Me → Jobs) and People's own web (Refer someone).
 *
 * Phone first: one column; a job opens in place with what it is and what the bonus is; Refer
 * someone opens a short form right there (name, phone or e-mail, how you know them, a note, a
 * résumé if you have one); Share my link sends the job on WhatsApp with a link tagged to you.
 * My referrals says where each friend is in plain words, and my bonus. The one primary button is
 * the Send inside the form that is open; everything in the list is secondary.
 *
 * `api`: { load, refer, link, apply } returning promises; `run` wraps each call (the employee
 * app's sign-out guard); `wrap` renders each block (a card in the app, plain on the web page).
 */
const STATUS_PILL = {
  Received: 'ui-pill-neutral',
  'In process': 'ui-pill-info',
  Interviewing: 'ui-pill-info',
  Offered: 'ui-pill-warn',
  Joined: 'ui-pill-pos',
  'Moved to this job': 'ui-pill-pos',
  'Not taken forward': 'ui-pill-neutral',
};
const BONUS_PILL = { WAITING: 'ui-pill-info', DUE: 'ui-pill-warn', SENT: 'ui-pill-info', PAID: 'ui-pill-pos', FORFEITED: 'ui-pill-neutral', NONE: 'ui-pill-neutral' };
const RELATIONS = ['Friend', 'Former colleague', 'Relative', 'Neighbour', 'Studied together', 'Through a customer'];
const RESUME_ACCEPT = '.pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const readFile = (file) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve({ name: file.name, mime: file.type, data: r.result });
  r.onerror = () => reject(new Error('Could not read the file.'));
  r.readAsDataURL(file);
});
/* A signed-out error is the caller's to handle (the employee app goes back to sign-in): nothing is said here. */
const errText = (e, fallback) => (e?.signedOut ? '' : String(e?.message || fallback));
const Plain = ({ children }) => <>{children}</>;

const asIs = (p) => p;

export default function ReferJobs({ api, run = asIs, wrap: Wrap = Plain, headingLevel = 2, openJob = null, hideWhenEmpty = false }) {
  const [data, setData] = useState(null);
  const [failed, setFailed] = useState('');
  const [open, setOpen] = useState(openJob);
  const [mode, setMode] = useState(null);
  const [said, setSaid] = useState(null);
  const load = useCallback(() => {
    run(api.load()).then((d) => { setData(d); setFailed(''); }).catch((e) => setFailed(errText(e, 'Could not load the jobs.')));
  }, [api, run]);
  useEffect(() => { load(); }, [load]);
  const H = `h${headingLevel}`;

  if (failed) return <Wrap><p className="text-sm" role="alert">{failed} <button type="button" className="ui-link" onClick={load}>Try again</button></p></Wrap>;
  if (!data) return <Wrap><p className="text-sm ui-muted" aria-busy="true">Loading jobs…</p></Wrap>;
  if (data.on === false) return null;
  if (data.employee === false) return hideWhenEmpty ? null : <Wrap><p className="text-sm ui-muted">Your sign-in is not linked to an employee record, so there is nothing to refer from. HR links it on your record.</p></Wrap>;
  if (hideWhenEmpty && !data.jobs.length && !data.referrals.length && !data.applications.length) return null;

  const pick = (id, m = null) => { setOpen(id); setMode(m); setSaid(null); };
  const done = (text) => { setSaid({ ok: true, text }); setMode(null); load(); };

  return (
    <>
      <Wrap>
        <section aria-labelledby="jobs-h" className="space-y-3">
          <H id="jobs-h" className="ui-t-sec">Jobs open to refer</H>
          {said ? <p className="text-sm" role={said.ok ? 'status' : 'alert'}>{said.text}</p> : null}
          {!data.jobs.length ? <p className="text-sm ui-muted">No jobs are open for referrals right now. You hear here when one opens.</p> : (
            <ul className="divide-y" style={{ borderColor: 'rgb(var(--border))' }} aria-label="Open jobs">
              {data.jobs.map((j) => (
                <li key={j.id} className="py-3">
                  <button type="button" className="flex w-full items-start justify-between gap-3 text-left" aria-expanded={open === j.id} onClick={() => pick(open === j.id ? null : j.id)}>
                    <span className="min-w-0">
                      <span className="block font-medium">{j.title}</span>
                      <span className="block ui-caption">{[j.department, j.where, j.places > 1 ? `${j.places} places` : null].filter(Boolean).join(' · ') || 'Posted ' + dayWords(j.postedAt)}</span>
                    </span>
                    {j.bonus ? <span className="shrink-0 text-sm tabular-nums">{rupees(j.bonus)}</span> : null}
                  </button>
                  {open === j.id ? (
                    <JobDetail job={j} mode={mode} setMode={setMode} api={api} run={run} onDone={done} />
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>
      </Wrap>
      {data.referrals.length ? (
        <Wrap>
          <section aria-labelledby="myrefs-h" className="space-y-3">
            <H id="myrefs-h" className="ui-t-sec">My referrals</H>
            <ul className="divide-y" style={{ borderColor: 'rgb(var(--border))' }} aria-label="My referrals">
              {data.referrals.map((r) => (
                <li key={r.id} className="py-2.5 space-y-1">
                  <div className="flex items-start justify-between gap-3">
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{r.name}</span>
                      <span className="block truncate ui-caption">{r.job} · referred {dayWords(r.referredAt)}</span>
                    </span>
                    <span className={`ui-pill ${STATUS_PILL[r.status] || 'ui-pill-neutral'} shrink-0`}>{r.status}</span>
                  </div>
                  {r.bonus ? (
                    <div className="flex items-start justify-between gap-3 text-sm">
                      <span className="min-w-0">
                        <span className={`ui-pill ${BONUS_PILL[r.bonus.status] || 'ui-pill-neutral'}`}>{r.bonus.words}{r.bonus.status === 'WAITING' && r.bonus.dueOn ? ` ${dayWords(r.bonus.dueOn)}` : ''}</span>
                        {r.bonus.note ? <span className="block ui-caption">{r.bonus.note}</span> : null}
                      </span>
                      <span className="shrink-0 text-right tabular-nums">Bonus {rupees(r.bonus.amount)}</span>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
        </Wrap>
      ) : null}
      {data.applications.length ? (
        <Wrap>
          <section aria-labelledby="myapps-h" className="space-y-3">
            <H id="myapps-h" className="ui-t-sec">Jobs I applied for</H>
            <ul className="divide-y" style={{ borderColor: 'rgb(var(--border))' }} aria-label="Jobs I applied for">
              {data.applications.map((a) => (
                <li key={a.id} className="flex items-start justify-between gap-3 py-2.5">
                  <span className="min-w-0"><span className="block truncate font-medium">{a.job}</span><span className="block ui-caption">Applied {dayWords(a.appliedAt)}</span></span>
                  <span className={`ui-pill ${STATUS_PILL[a.status] || 'ui-pill-neutral'} shrink-0`}>{a.status}</span>
                </li>
              ))}
            </ul>
          </section>
        </Wrap>
      ) : null}
    </>
  );
}

function JobDetail({ job, mode, setMode, api, run, onDone }) {
  return (
    <div className="mt-3 space-y-3">
      {job.bonus ? <p className="text-sm">Referral bonus <span className="tabular-nums">{rupees(job.bonus)}</span>, paid {job.bonusAfter}.</p> : null}
      {job.description ? <p className="whitespace-pre-wrap text-sm ui-muted">{job.description}</p> : null}
      {mode === 'refer' ? <ReferForm job={job} api={api} run={run} onCancel={() => setMode(null)} onDone={onDone} /> : null}
      {mode === 'apply' ? <ApplyForm job={job} api={api} run={run} onCancel={() => setMode(null)} onDone={onDone} /> : null}
      {mode === null ? (
        <div className="flex flex-wrap gap-2">
          {job.canRefer ? <button type="button" className="ui-btn ui-btn-secondary" onClick={() => setMode('refer')}>Refer someone</button> : null}
          {job.canRefer ? <ShareLink job={job} api={api} run={run} /> : null}
          {job.canApply ? <button type="button" className="ui-btn ui-btn-ghost" onClick={() => setMode('apply')}>Apply myself</button> : null}
          {job.applied ? <span className="ui-pill ui-pill-info self-center">You applied</span> : null}
        </div>
      ) : null}
    </div>
  );
}

function ReferForm({ job, api, run, onCancel, onDone }) {
  const [form, setForm] = useState({ name: '', phone: '', email: '', relation: '', note: '' });
  const [file, setFile] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const pickFile = (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    if (f.size > 2 * 1024 * 1024) { setError('A résumé sent with a referral is up to 2 MB.'); return; }
    setError('');
    setFile(f);
  };
  const send = async (e) => {
    e.preventDefault();
    if (busy) return;
    if (!form.name.trim()) { setError('Give their name.'); return; }
    if (!form.phone.trim() && !form.email.trim()) { setError('Give their phone number or e-mail, so HR can reach them.'); return; }
    setBusy(true);
    setError('');
    try {
      const resume = file ? await readFile(file) : null;
      await run(api.refer({ openingId: job.id, name: form.name.trim(), phone: form.phone.trim() || null, email: form.email.trim() || null, relation: form.relation.trim() || null, note: form.note.trim() || null, resume }));
      onDone(`Thank you. ${form.name.trim()} is with HR for ${job.title}. You see how it goes under My referrals.`);
    } catch (err) {
      const t = errText(err, 'Not sent.');
      if (t) setError(t);
      setBusy(false);
    }
  };
  return (
    <form className="space-y-3" onSubmit={send} aria-label={`Refer someone for ${job.title}`} noValidate>
      {error ? <p className="text-sm" role="alert" style={{ color: 'rgb(var(--neg))' }}>{error}</p> : null}
      {/* The friend's own name and contacts are theirs: nothing is suggested from anyone else's record. */}
      <label className="block"><span className="ui-label">Their name *</span><input className="ui-input w-full" autoFocus maxLength={120} autoComplete="off" value={form.name} onChange={(e) => set({ name: e.target.value })} /></label>
      <label className="block"><span className="ui-label">Phone</span><input className="ui-input w-full tabular-nums" type="tel" inputMode="tel" maxLength={40} autoComplete="off" value={form.phone} onChange={(e) => set({ phone: e.target.value })} /></label>
      <label className="block"><span className="ui-label">E-mail</span><input className="ui-input w-full" type="email" inputMode="email" maxLength={200} autoComplete="off" value={form.email} onChange={(e) => set({ email: e.target.value })} /></label>
      <label className="block"><span className="ui-label">How you know them</span><SuggestInput className="ui-input w-full" maxLength={120} value={form.relation} onChange={(v) => set({ relation: v })} suggestions={RELATIONS} /></label>
      <label className="block"><span className="ui-label">Why they would be good</span><textarea className="ui-input w-full" rows={3} maxLength={2000} value={form.note} onChange={(e) => set({ note: e.target.value })} /></label>
      <div className="flex flex-wrap items-center gap-2">
        <input ref={fileRef} type="file" className="sr-only" accept={RESUME_ACCEPT} onChange={pickFile} aria-label="Résumé file" />
        <button type="button" className="ui-btn ui-btn-secondary" onClick={() => fileRef.current?.click()}>{file ? 'Change résumé' : 'Add résumé'}</button>
        <span className="ui-caption truncate">{file ? file.name : 'PDF or Word, up to 2 MB'}</span>
      </div>
      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" className="ui-btn ui-btn-secondary" onClick={onCancel}>Cancel</button>
        <button type="submit" className="ui-btn ui-btn-primary" disabled={busy}>{busy ? 'Sending…' : 'Send referral'}</button>
      </div>
    </form>
  );
}

function ApplyForm({ job, api, run, onCancel, onDone }) {
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const send = async (e) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await run(api.apply({ openingId: job.id, note: note.trim() || null }));
      onDone(`You applied for ${job.title}. HR has your name and contacts from your record.`);
    } catch (err) {
      const t = errText(err, 'Not sent.');
      if (t) setError(t);
      setBusy(false);
    }
  };
  return (
    <form className="space-y-3" onSubmit={send} aria-label={`Apply for ${job.title}`}>
      {error ? <p className="text-sm" role="alert" style={{ color: 'rgb(var(--neg))' }}>{error}</p> : null}
      <label className="block"><span className="ui-label">Why you want this job</span><textarea className="ui-input w-full" rows={3} maxLength={2000} autoFocus value={note} onChange={(e) => setNote(e.target.value)} /></label>
      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" className="ui-btn ui-btn-secondary" onClick={onCancel}>Cancel</button>
        <button type="submit" className="ui-btn ui-btn-primary" disabled={busy}>{busy ? 'Sending…' : 'Apply'}</button>
      </div>
    </form>
  );
}

/** My link for this job: the phone's share sheet where there is one, else WhatsApp and Copy. */
function ShareLink({ job, api, run }) {
  const [got, setGot] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const fetchLink = async () => {
    setBusy(true);
    setError('');
    try {
      const r = await run(api.link(job.id));
      setGot(r);
      if (typeof navigator !== 'undefined' && navigator.share) {
        try { await navigator.share({ title: job.title, text: r.shareText }); } catch { /* closed the sheet: the buttons stay */ }
      }
    } catch (err) {
      const t = errText(err, 'Could not make your link.');
      if (t) setError(t);
    } finally {
      setBusy(false);
    }
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(got.link); setError('Link copied.'); } catch { setError('Copy did not work: press and hold the link to copy it.'); }
  };
  if (!got) return (
    <>
      <button type="button" className="ui-btn ui-btn-secondary" disabled={busy} onClick={fetchLink}>{busy ? 'Making your link…' : 'Share my link'}</button>
      {error ? <span className="w-full text-sm" role="alert">{error}</span> : null}
    </>
  );
  return (
    <div className="w-full space-y-2">
      <p className="text-sm break-all"><a className="ui-link" href={got.link} target="_blank" rel="noopener noreferrer">{got.link}</a></p>
      <div className="flex flex-wrap gap-2">
        <a className="ui-btn ui-btn-secondary" href={`https://wa.me/?text=${encodeURIComponent(got.shareText)}`} target="_blank" rel="noopener noreferrer">Send on WhatsApp</a>
        <button type="button" className="ui-btn ui-btn-secondary" onClick={copy}>Copy link</button>
      </div>
      {error ? <p className="text-sm" role="status">{error}</p> : <p className="ui-caption">Whoever applies through it is counted as your referral.</p>}
    </div>
  );
}
