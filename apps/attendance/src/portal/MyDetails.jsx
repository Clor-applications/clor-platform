import React, { useCallback, useEffect, useState } from 'react';
import { confirmDialog } from '@ui/components/ui/notify';

import { SignedOut, acceptItem, answerMyRequest, askDetailsChange, getMyDetails, getPolicies, getPolicy, shrinkPhoto, withdrawMyRequest } from './portalApi';

/**
 * People self-service in the employee app (server: routes/peoplePortal.ts):
 * my job in plain words, my personal details and a way to ask for a change,
 * my requests to HR with HR's answer, and the company policies with Accept
 * where HR asked for it. Contact details save at once (by the company
 * setting); everything else, and a new photo, goes to HR.
 */

/* "30 Sep 2026", as the rest of CLOR writes dates (the browser's en-IN gives "Sept"). */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const longDate = (d) => { const [y, m, dd] = String(d || '').slice(0, 10).split('-'); return y && m && dd ? `${Number(dd)} ${MONTHS[Number(m) - 1]} ${y}` : ''; };
const shortDate = (v) => (v ? longDate(new Date(new Date(v).getTime() + 330 * 60_000).toISOString()) : '');
const errText = (e, fallback) => (e instanceof SignedOut ? '' : String(e?.message || fallback));

const GENDER = [['', 'Not said'], ['MALE', 'Male'], ['FEMALE', 'Female'], ['NON_BINARY', 'Non-binary'], ['OTHER', 'Other'], ['PREFER_NOT_TO_SAY', 'Prefer not to say']];
const MARITAL = [['', 'Not said'], ['SINGLE', 'Single'], ['MARRIED', 'Married'], ['DIVORCED', 'Divorced'], ['WIDOWED', 'Widowed']];
const WORDS = { gender: Object.fromEntries(GENDER), maritalStatus: Object.fromEntries(MARITAL) };
/** The order the details are shown and asked in. */
const ORDER = ['firstName', 'lastName', 'phone', 'personalEmail', 'emergencyContactName', 'emergencyContactPhone', 'emergencyContactRelation', 'addressLine', 'city', 'state', 'pincode', 'country', 'dateOfBirth', 'gender', 'maritalStatus', 'guardianName'];
const shown = (k, v) => (v == null || v === '' ? '—' : k === 'dateOfBirth' ? longDate(v) : WORDS[k]?.[v] || v);

const REQ_PILL = { WAITING: 'ui-pill-warn', MORE_INFO: 'ui-pill-warn', REJECTED: 'ui-pill-neg', APPROVED: 'ui-pill-pos' };

/** One row of a two-column list: the label, then the value. */
const Row = ({ label, children }) => (
  <div className="flex items-baseline justify-between gap-3 py-2 text-sm">
    <dt className="ui-muted shrink-0">{label}</dt>
    <dd className="min-w-0 text-right">{children}</dd>
  </div>
);

export function MyDetails({ guard }) {
  const [d, setD] = useState(null);
  const [failed, setFailed] = useState('');
  const load = useCallback(() => {
    guard(getMyDetails())
      .then((r) => { setD(r); setFailed(''); })
      .catch((e) => setFailed(errText(e, 'Could not load your details.')));
  }, [guard]);
  useEffect(() => { load(); }, [load]);
  if (failed) return <section className="ui-card p-5 text-sm" role="alert">{failed} <button type="button" className="ui-link" onClick={load}>Try again</button></section>;
  if (!d) return null;
  return (
    <>
      <MyJob terms={d.terms} />
      <PersonalDetails d={d} guard={guard} reload={load} />
      <MyRequests requests={d.requests} guard={guard} reload={load} />
    </>
  );
}

/** E13: type, hours, work mode, manager and the dates that matter, in words. */
function MyJob({ terms: t }) {
  if (!t) return null;
  const type = [t.employmentType, t.hours].filter(Boolean).join(' · ');
  return (
    <section className="ui-card p-5" aria-labelledby="job-h">
      <h2 id="job-h" className="ui-t-sec mb-1">My job</h2>
      <dl className="divide-y" style={{ borderColor: 'rgb(var(--border))' }}>
        {t.designation ? <Row label="Job title">{t.designation}</Row> : null}
        {t.department ? <Row label="Department">{t.department}</Row> : null}
        {type ? <Row label="Employment">{type}</Row> : null}
        {t.workMode ? <Row label="Work mode">{t.workMode}</Row> : null}
        {t.manager ? <Row label="Manager">{t.manager}</Row> : null}
        {t.joinedOn ? <Row label="Joined">{longDate(t.joinedOn)}</Row> : null}
        {t.confirmedOn ? <Row label="Confirmed">{longDate(t.confirmedOn)}</Row> : t.probationEndsOn ? <Row label="Probation ends">{longDate(t.probationEndsOn)}</Row> : null}
        {t.contractEndsOn ? <Row label="Contract ends">{longDate(t.contractEndsOn)}</Row> : null}
        {t.lastDay ? <Row label="Last working day">{longDate(t.lastDay)}</Row> : null}
      </dl>
    </section>
  );
}

function PersonalDetails({ d, guard, reload }) {
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({});
  const [photo, setPhoto] = useState(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null);
  const atOnce = new Set(d.savesAtOnce || []);
  const open = () => { setForm({ ...d.fields }); setPhoto(null); setNote(null); setEditing(true); };
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const choosePhoto = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try { setPhoto(await shrinkPhoto(file)); } catch (err) { setNote({ ok: false, text: err.message }); }
  };
  const save = async (e) => {
    e.preventDefault();
    setBusy(true);
    setNote(null);
    const body = Object.fromEntries(ORDER.filter((k) => (form[k] ?? '') !== (d.fields[k] ?? '')).map((k) => [k, form[k] ?? '']));
    if (photo) body.photoUrl = photo;
    try {
      const r = await guard(askDetailsChange(body));
      const name = (k) => (k === 'photoUrl' ? 'photo' : (d.labels[k] || k).toLowerCase());
      const parts = [];
      if (r.saved?.length) parts.push(`Saved: ${r.saved.map(name).join(', ')}.`);
      if (r.requested?.length) parts.push(`Sent to HR: ${r.requested.map(name).join(', ')}. You will see the answer under My requests.`);
      setNote({ ok: true, text: parts.join(' ') || 'Nothing changed.' });
      setEditing(false);
      reload();
    } catch (err) {
      const text = errText(err, 'Not sent.');
      if (text) setNote({ ok: false, text });
    } finally {
      setBusy(false);
    }
  };
  const rule = atOnce.size === ORDER.length
    ? 'Your changes save at once.'
    : atOnce.size
      ? `Phone, personal email and emergency contact save at once. Other changes, and a new photo, go to HR, who decide within ${d.hrDecidesWithinDays} working days.`
      : `Every change goes to HR, who decide within ${d.hrDecidesWithinDays} working days.`;
  const field = (k) => {
    const label = d.labels[k] || k;
    if (k === 'gender' || k === 'maritalStatus') {
      return (
        <label key={k} className="block"><span className="ui-label">{label}</span>
          <select className="ui-select w-full" value={form[k] ?? ''} onChange={set(k)}>{(k === 'gender' ? GENDER : MARITAL).map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select>
        </label>
      );
    }
    return (
      <label key={k} className="block"><span className="ui-label">{label}</span>
        <input className="ui-input w-full" type={k === 'dateOfBirth' ? 'date' : k === 'personalEmail' ? 'email' : k.toLowerCase().includes('phone') ? 'tel' : 'text'} value={form[k] ?? ''} maxLength={200} onChange={set(k)} />
      </label>
    );
  };
  return (
    <section className="ui-card space-y-3 p-5" aria-labelledby="details-h">
      <div className="flex items-center justify-between gap-2">
        <h2 id="details-h" className="ui-t-sec">My details</h2>
        {!editing ? <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={open}>{atOnce.size ? 'Change details' : 'Ask HR to change'}</button> : null}
      </div>
      <p className="ui-caption">{rule}</p>
      {note ? <p className="text-sm" role={note.ok ? 'status' : 'alert'}>{note.text}</p> : null}
      {editing ? (
        <form onSubmit={save} className="space-y-3">
          {ORDER.map(field)}
          <label className="block"><span className="ui-label">New photo</span>
            <input type="file" accept="image/jpeg,image/png,image/webp" className="ui-input w-full" onChange={choosePhoto} />
            {photo ? <span className="ui-caption block">New photo chosen. HR will check it before it shows.</span> : null}
          </label>
          <div className="flex gap-2">
            <button type="submit" className="ui-btn ui-btn-primary" disabled={busy}>{busy ? 'Sending…' : 'Save changes'}</button>
            <button type="button" className="ui-btn" onClick={() => setEditing(false)}>Cancel</button>
          </div>
        </form>
      ) : (
        <dl className="divide-y" style={{ borderColor: 'rgb(var(--border))' }}>
          {/* What is on file; Change details shows every field, so nothing missing is hidden from the person. */}
          {ORDER.filter((k) => d.fields[k] != null && d.fields[k] !== '').map((k) => <Row key={k} label={d.labels[k] || k}>{shown(k, d.fields[k])}</Row>)}
        </dl>
      )}
    </section>
  );
}

/** E5: what I asked HR for, where it stands, what HR said; answer them or withdraw. */
function MyRequests({ requests, guard, reload }) {
  const [answer, setAnswer] = useState({});
  const [failed, setFailed] = useState('');
  if (!requests?.length) return null;
  const send = async (r) => {
    setFailed('');
    try {
      await guard(answerMyRequest(r.id, answer[r.id] || ''));
      setAnswer((a) => ({ ...a, [r.id]: '' }));
      reload();
    } catch (e) { setFailed(errText(e, 'Not sent.')); }
  };
  const pull = async (r) => {
    if (!(await confirmDialog({ title: 'Withdraw this request?', message: 'HR will no longer decide it. You can ask again later.', confirmLabel: 'Withdraw' }))) return;
    setFailed('');
    try { await guard(withdrawMyRequest(r.id)); reload(); } catch (e) { setFailed(errText(e, 'Not withdrawn.')); }
  };
  return (
    <section className="ui-card p-5" aria-labelledby="my-asks-h">
      <h2 id="my-asks-h" className="ui-t-sec mb-1">My requests</h2>
      {failed ? <p className="text-sm" role="alert">{failed}</p> : null}
      <ul className="divide-y" style={{ borderColor: 'rgb(var(--border))' }}>
        {requests.map((r) => (
          <li key={r.id} className="space-y-2 py-3 text-sm">
            <div className="flex items-start justify-between gap-2">
              <span className="font-medium">{r.kind === 'LEAVING' ? 'Resignation' : 'Change to my details'}<span className="ui-caption block font-normal">Asked {shortDate(r.createdAt)}</span></span>
              <span className={`ui-pill shrink-0 ${REQ_PILL[r.status] || 'ui-pill-neutral'}`}>{r.statusLabel}</span>
            </div>
            <ul className="ui-caption">
              {r.asked.map((a) => <li key={a.field}>{a.label}: {a.field === 'photoUrl' ? 'new photo' : a.field === 'lastDay' || a.field === 'dateOfBirth' ? longDate(a.value) : shown(a.field, a.value)}</li>)}
            </ul>
            {r.comment ? <p>{r.comment.by ? `${r.comment.by}: ` : 'HR: '}{r.comment.text}</p> : null}
            {r.replies?.map((x, i) => <p key={i} className="ui-caption">You answered: {x.note}</p>)}
            {r.canReply ? (
              <div className="space-y-2">
                <textarea className="ui-input w-full" rows={2} maxLength={1000} aria-label="Your answer" placeholder="Your answer" value={answer[r.id] || ''} onChange={(e) => setAnswer((a) => ({ ...a, [r.id]: e.target.value }))} />
                <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" disabled={!(answer[r.id] || '').trim()} onClick={() => send(r)}>Send answer</button>
              </div>
            ) : null}
            {r.canWithdraw ? <button type="button" className="ui-link text-xs" onClick={() => pull(r)}>Withdraw</button> : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The company policies that apply to me; Read opens the text here, Accept where HR asked for it (E1, E3). */
export function Policies({ guard }) {
  const [rows, setRows] = useState(null);
  const [reading, setReading] = useState({});
  const [failed, setFailed] = useState('');
  const load = useCallback(() => {
    guard(getPolicies()).then((r) => setRows(r?.policies || [])).catch(() => setRows([]));
  }, [guard]);
  useEffect(() => { load(); }, [load]);
  if (!rows?.length) return null;
  const read = async (p) => {
    if (reading[p.versionId]) return setReading((r) => ({ ...r, [p.versionId]: null }));
    try {
      const full = (await guard(getPolicy(p.versionId))).policy;
      setReading((r) => ({ ...r, [p.versionId]: full }));
    } catch (e) { setFailed(errText(e, 'Could not open.')); }
  };
  const accept = async (p) => {
    setFailed('');
    try { await guard(acceptItem(p.acknowledgementId)); load(); } catch (e) { setFailed(errText(e, 'Not accepted.')); }
  };
  return (
    <section className="ui-card p-5" aria-labelledby="policies-h">
      <h2 id="policies-h" className="ui-t-sec mb-1">Company policies</h2>
      {failed ? <p className="text-sm" role="alert">{failed}</p> : null}
      <ul className="divide-y" style={{ borderColor: 'rgb(var(--border))' }}>
        {rows.map((p) => {
          const full = reading[p.versionId];
          const waiting = p.acknowledgementId && !p.acceptedAt;
          return (
            <li key={p.versionId} className="space-y-2 py-3 text-sm">
              <div className="flex items-start justify-between gap-2">
                <span className="min-w-0"><span className="block font-medium">{p.title}</span><span className="ui-caption">{p.categoryLabel} · from {longDate(p.effectiveFrom)}{p.acceptedAt ? ` · accepted ${shortDate(p.acceptedAt)}` : ''}</span></span>
                {waiting ? <span className="ui-pill ui-pill-warn shrink-0">To accept</span> : null}
              </div>
              <div className="flex gap-2">
                <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={() => read(p)}>{full ? 'Close' : 'Read'}</button>
                {waiting ? <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={() => accept(p)}>Accept</button> : null}
              </div>
              {full ? (
                <div className="space-y-2">
                  {full.body ? <p className="whitespace-pre-wrap">{full.body}</p> : null}
                  {full.document ? <a className="ui-link" href={full.document.dataUrl} download={full.document.title}>Download {full.document.title}</a> : null}
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
