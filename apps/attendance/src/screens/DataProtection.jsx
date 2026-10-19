import React, { useCallback, useEffect, useState } from 'react';
import { Plus, ShieldCheck, X } from 'lucide-react';

import { PageHeader, SkeletonCard, StatTile } from '@ui/components/ui/Primitives';
import Drawer from '@ui/components/ui/Drawer';
import { confirmDialog, notify } from '@ui/components/ui/notify';
import { getDataProtection, listBreaches, listEmployees, notifyBreach, recordBreach, saveDataProtection, updateBreach } from '../api/attendance';
import LoadFailed from '../components/LoadFailed';

/**
 * How this company meets the Digital Personal Data Protection Act, 2023 and
 * the DPDP Rules, 2025 for attendance. The company is the Data Fiduciary;
 * CLOR is its Data Processor. Everything on this page is real state: the
 * contact, whether CLOR keeps fingerprint copies, who has read the notice,
 * requests waiting, people under 18, the breach register.
 */
const ANNOUNCE_KEY = 'clor.dpdp.announcement.2026-10-19';
const CATEGORIES = ['identity', 'attendance', 'location', 'selfie', 'biometric', 'payroll', 'bank', 'contact'];
const fmt = (d) => (d ? new Date(d).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—');

function Announcement() {
  const [hidden, setHidden] = useState(() => {
    try {
      return localStorage.getItem(ANNOUNCE_KEY) === 'seen';
    } catch {
      return false;
    }
  });
  if (hidden) return null;
  const hide = () => {
    try {
      localStorage.setItem(ANNOUNCE_KEY, 'seen');
    } catch {
      /* private window: shown again next time */
    }
    setHidden(true);
  };
  return (
    <section className="ui-card p-4 text-sm" aria-labelledby="dpdp-new-h" style={{ borderColor: 'rgb(var(--accent))' }}>
      <div className="flex items-start justify-between gap-3">
        <h2 id="dpdp-new-h" className="ui-t-sec flex items-center gap-2"><ShieldCheck size={16} aria-hidden="true" /> What changed for data protection (19 October 2026)</h2>
        <button type="button" className="ui-icon-btn" aria-label="Hide this" onClick={hide}><X size={16} aria-hidden="true" /></button>
      </div>
      <ul className="mt-2 list-disc space-y-1 ps-5">
        <li><strong>Fingerprint and face copies are off by default.</strong> Readers still recognise people. CLOR keeps a copy, to put someone enrolled at one gate on the others, only if you switch it on below and confirm employees were told and agreed. Copies are encrypted. Copies kept before today are not used, and are deleted on 18 November 2026 unless you switch copying on.</li>
        <li><strong>Nobody under 18</strong> has their location read for phone punches or a fingerprint copy kept. Add dates of birth so CLOR can tell.</li>
        <li><strong>Employees see a privacy notice</strong> in the portal, built from your settings, and are asked to read each new version. Set your privacy contact below.</li>
        <li><strong>People can use their rights in the portal:</strong> download their data, correct it, ask for erasure, withdraw consent, name a nominee and raise a grievance. Each request shows an answer-by date 30 days out.</li>
        <li><strong>Breach register:</strong> record a breach, tell the affected people by e-mail, and track the Data Protection Board’s 72-hour report.</li>
        <li><strong>Retention:</strong> phone-punch locations go after 13 months (the punch stays), originals of what readers sent after 13 months, selfies as set. Logs are kept at least a year.</li>
      </ul>
    </section>
  );
}

export default function DataProtection({ openScreen }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [breaches, setBreaches] = useState([]);
  const [form, setForm] = useState(null);
  const [attest, setAttest] = useState(false);
  const [busy, setBusy] = useState('');
  const [recording, setRecording] = useState(false);
  const load = useCallback(() => {
    getDataProtection()
      .then((d) => { setData(d); setError(''); setForm({ privacyContactName: d.settings.privacyContactName || '', privacyContactEmail: d.settings.privacyContactEmail || '', privacyContactPhone: d.settings.privacyContactPhone || '' }); })
      .catch((e) => setError(String(e?.message || 'Could not load data protection.')));
    listBreaches().then(setBreaches).catch(() => setBreaches([]));
  }, []);
  useEffect(() => { load(); }, [load]);

  const save = async (body, done) => {
    setBusy(Object.keys(body)[0]);
    try {
      const r = await saveDataProtection(body);
      notify.success(done(r));
      setAttest(false);
      load();
    } catch (e) {
      notify.error(String(e?.message || 'Not saved.'));
    } finally {
      setBusy('');
    }
  };
  const copyOff = async () => {
    const n = data.status.templatesStored;
    if (!(await confirmDialog({ title: 'Stop keeping fingerprint and face copies?', message: `CLOR deletes ${n ? `the ${n} cop${n === 1 ? 'y' : 'ies'} it holds` : 'any copies it holds'} now. The readers keep their own; someone enrolled at one reader will need enrolling at the others.`, confirmLabel: 'Stop and delete' }))) return;
    save({ biometricCopy: false }, (r) => `Copying off. ${r.templatesDeleted} cop${r.templatesDeleted === 1 ? 'y' : 'ies'} deleted.`);
  };

  if (!data) return <div className="space-y-3"><PageHeader entity="privacy" title="Data protection" /><div className="px-5 lg:px-7 pb-8 max-w-3xl"><LoadFailed message={error} onRetry={load} />{error ? null : <SkeletonCard lines={8} />}</div></div>;
  const s = data.status;
  return (
    <div className="space-y-3">
      <PageHeader
        entity="privacy"
        title="Data protection"
        description="How this company meets the DPDP Act for attendance. You are the Data Fiduciary; CLOR processes the data for you."
        actions={s.requestsWaiting && openScreen ? <button type="button" className="ui-btn ui-btn-secondary" onClick={() => openScreen('dataRequests')}>Answer data requests</button> : null}
      />
      <div className="px-5 lg:px-7 pb-8 space-y-6 max-w-3xl">
      <Announcement />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile label="Read the current notice" value={`${s.noticeReadCurrent} / ${s.employees}`} hint={s.noticeRead > s.noticeReadCurrent ? `${s.noticeRead - s.noticeReadCurrent} read an older one` : null} />
        <StatTile label="Requests waiting" value={s.requestsWaiting} tone={s.requestsOverdue ? 'neg' : s.requestsWaiting ? 'warn' : 'neutral'} hint={s.requestsOverdue ? `${s.requestsOverdue} past the answer-by date` : null} />
        <StatTile label="Open breaches" value={s.breachesOpen} tone={s.breachesOpen ? 'warn' : 'neutral'} />
        <StatTile label="Under 18" value={s.minors.length} hint={s.noBirthDate ? `${s.noBirthDate} without a date of birth` : null} />
      </div>

      <section className="ui-card space-y-3 p-4" aria-labelledby="contact-h">
        <h2 id="contact-h" className="ui-t-sec">Privacy contact</h2>
        <p className="ui-caption">Who employees reach about their data and grievances. It is printed in their privacy notice (the DPDP Rules ask for a published contact).</p>
        <div className="grid gap-3 md:grid-cols-3">
          <label className="block"><span className="ui-label">Name or role</span><input className="ui-input w-full" maxLength={120} value={form.privacyContactName} onChange={(e) => setForm({ ...form, privacyContactName: e.target.value })} placeholder="e.g. HR Manager" /></label>
          <label className="block"><span className="ui-label">E-mail</span><input type="email" className="ui-input w-full" maxLength={200} value={form.privacyContactEmail} onChange={(e) => setForm({ ...form, privacyContactEmail: e.target.value })} placeholder="privacy@yourcompany.in" /></label>
          <label className="block"><span className="ui-label">Phone</span><input className="ui-input w-full" maxLength={40} value={form.privacyContactPhone} onChange={(e) => setForm({ ...form, privacyContactPhone: e.target.value })} /></label>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="ui-btn ui-btn-primary ui-btn-sm" disabled={Boolean(busy)} onClick={() => save({ ...form, publishNotice: true }, () => 'Saved. Employees will be asked to read the updated notice.')}>Save and publish the notice</button>
          {data.settings.privacyNoticeAt ? <span className="ui-caption self-center">Last published {fmt(data.settings.privacyNoticeAt)}</span> : <span className="ui-caption self-center">Not published yet</span>}
        </div>
      </section>

      <section className="ui-card space-y-3 p-4" aria-labelledby="bio-h">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="bio-h" className="ui-t-sec">Fingerprint and face copies</h2>
          <span className={`ui-pill ${data.settings.biometricCopy ? 'ui-pill-pos' : 'ui-pill-neutral'}`}>{data.settings.biometricCopy ? 'CLOR keeps copies' : 'CLOR keeps none'}</span>
        </div>
        <p className="text-sm">Readers hold fingerprints and faces to recognise people. With copying on, CLOR keeps an encrypted copy so a person enrolled at one reader is put on the company’s other readers. It is biometric data, so it is off unless you switch it on, never kept for anyone under 18 or anyone who withdrew, and deleted when they leave.</p>
        {data.settings.biometricCopy ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="ui-caption">On since {fmt(data.settings.biometricCopyAt)} · {s.templatesStored} cop{s.templatesStored === 1 ? 'y' : 'ies'} held · {s.optedOut} withdrew</span>
            <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" disabled={Boolean(busy)} onClick={copyOff}>Stop and delete copies</button>
          </div>
        ) : (
          <div className="space-y-2">
            {data.status.biometricGraceUntil ? <p className="text-sm" role="status">{s.templatesStored} cop{s.templatesStored === 1 ? 'y' : 'ies'} kept before this rule {s.templatesStored === 1 ? 'is' : 'are'} not used, and will be deleted on {data.status.biometricGraceUntil} unless you switch copying on. <button type="button" className="ui-link" onClick={copyOff}>Delete now</button></p> : null}
            <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="ui-checkbox mt-0.5" checked={attest} onChange={(e) => setAttest(e.target.checked)} /> <span>Employees were told that CLOR keeps an encrypted copy of their fingerprints and face to put them on all our readers, and they agreed. Each of them can withdraw in the portal.</span></label>
            <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" disabled={!attest || Boolean(busy)} onClick={() => save({ biometricCopy: true, attest: true }, () => 'Copying on. Your confirmation is recorded in the audit log.')}>Switch copying on</button>
          </div>
        )}
      </section>

      {s.minors.length ? (
        <section className="ui-card space-y-2 p-4" aria-labelledby="minor-h">
          <h2 id="minor-h" className="ui-t-sec">Under 18</h2>
          <p className="ui-caption">The DPDP Act forbids tracking children. For these people the phone never reads a location, and CLOR keeps no fingerprint copy.</p>
          <ul className="text-sm">{s.minors.map((m) => <li key={m.id}>{m.name}{m.mobilePunch ? <span className="ui-caption"> · phone punching switched on, but refused while under 18</span> : null}</li>)}</ul>
        </section>
      ) : null}

      <section className="ui-card space-y-3 p-4" aria-labelledby="breach-h">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="breach-h" className="ui-t-sec">Breach register</h2>
          <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={() => setRecording(true)}><Plus size={14} aria-hidden="true" /> Record a breach</button>
        </div>
        <p className="ui-caption">If personal data is lost, stolen, or seen by someone who should not: record it here at once. Tell the Data Protection Board without delay and send it the full report within 72 hours of becoming aware, and tell each affected person.</p>
        {breaches.length ? (
          <ul className="divide-y">
            {breaches.map((b) => <BreachRow key={b.id} b={b} onChanged={load} />)}
          </ul>
        ) : <p className="ui-caption">Nothing recorded.</p>}
      </section>

      <section className="ui-card space-y-2 p-4" aria-labelledby="ret-h">
        <h2 id="ret-h" className="ui-t-sec">How long data is kept</h2>
        <table className="ui-table w-full text-sm">
          <tbody>
            <tr><td>Selfies from phone punches</td><td className="text-end">{data.retention.selfieDays} days</td></tr>
            <tr><td>Location of a phone punch (the punch stays)</td><td className="text-end">{Math.round(data.retention.locationDays / 30.4)} months</td></tr>
            <tr><td>Originals of what readers sent</td><td className="text-end">{Math.round(data.retention.readerEventDays / 30.4)} months</td></tr>
            <tr><td>Fingerprint and face copies</td><td className="text-end">until the person leaves or withdraws</td></tr>
            <tr><td>Punches, days, leave</td><td className="text-end">as labour and wage laws require of you</td></tr>
            <tr><td>Logs of processing</td><td className="text-end">at least 1 year</td></tr>
          </tbody>
        </table>
      </section>

      <section className="ui-card space-y-2 p-4" aria-labelledby="notice-h">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="notice-h" className="ui-t-sec">The employee privacy notice</h2>
          <span className="ui-caption">Version {data.notice.version}</span>
        </div>
        <p className="ui-caption">What employees see in the portal. It changes with your settings; each change asks them to read it again.</p>
        <div className="space-y-3 text-sm">
          {data.notice.sections.map((x) => (
            <div key={x.id}>
              <h3 className="font-medium">{x.title}</h3>
              <ul className="list-disc space-y-0.5 ps-5">{x.items.map((t) => <li key={t}>{t}</li>)}</ul>
            </div>
          ))}
        </div>
      </section>

      <section className="ui-card space-y-2 p-4 text-sm" aria-labelledby="clor-h">
        <h2 id="clor-h" className="ui-t-sec">What CLOR does as your Data Processor</h2>
        <ul className="list-disc space-y-1 ps-5">
          <li>Processes your employees’ data only to run attendance for you, never for anything else, and never sells it or uses it for advertising.</li>
          <li>Stores it in India (Google Cloud, Mumbai). Each company’s data is kept apart, and every request is checked against the company it belongs to.</li>
          <li>Encrypts reader and integration credentials and fingerprint copies; every change is in the audit trail; logs are kept at least a year.</li>
          <li>Tells you without delay of any breach affecting your data, with what you need to tell the Board and your employees.</li>
          <li>When you leave CLOR, ask us for an export of your records and for the rest to be deleted, apart from what the law makes us keep.</li>
        </ul>
      </section>

      {recording ? <BreachForm onClose={() => setRecording(false)} onSaved={() => { setRecording(false); load(); }} /> : null}
      </div>
    </div>
  );
}

function BreachRow({ b, onChanged }) {
  const [busy, setBusy] = useState(false);
  const run = async (fn, ok) => {
    setBusy(true);
    try {
      const r = await fn();
      notify.success(ok(r));
      onChanged();
    } catch (e) {
      notify.error(String(e?.message || 'Not done.'));
    } finally {
      setBusy(false);
    }
  };
  const tell = async () => {
    if (!(await confirmDialog({ title: `E-mail the ${b.affected} affected people?`, message: 'Each gets what happened, when, what it may mean, what was done, what they can do, and your privacy contact.', confirmLabel: 'Send' }))) return;
    run(() => notifyBreach(b.id), (r) => `Sent to ${r.sent}.${r.noEmail.length ? ` ${r.noEmail.length} have no e-mail address: tell them another way (${r.noEmail.slice(0, 5).map((x) => x.name).join(', ')}${r.noEmail.length > 5 ? '…' : ''}).` : ''}`);
  };
  const now = () => new Date().toISOString();
  return (
    <li className="space-y-1 py-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{b.title}</span>
        <span className={`ui-pill ${b.status === 'CLOSED' ? 'ui-pill-neutral' : 'ui-pill-warn'}`}>{b.status === 'CLOSED' ? 'Closed' : 'Open'}</span>
        {b.boardReportLate ? <span className="ui-pill ui-pill-neg">Board report overdue</span> : null}
      </div>
      <p className="ui-caption">Found {fmt(b.discoveredAt)} · {b.affected} people · {b.categories}</p>
      <p className="ui-caption">
        Board: {b.boardIntimatedAt ? `told ${fmt(b.boardIntimatedAt)}` : 'not told yet'} · report {b.boardReportAt ? `sent ${fmt(b.boardReportAt)}` : `due by ${fmt(b.boardReportDue)}`}{b.boardReference ? ` · ref ${b.boardReference}` : ''} · People: {b.peopleNotifiedAt ? `${b.notifiedCount} e-mailed ${fmt(b.peopleNotifiedAt)}` : 'not told yet'}
      </p>
      {b.status === 'OPEN' ? (
        <div className="flex flex-wrap gap-2">
          <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" disabled={busy || !b.affected} onClick={tell}>Tell affected people</button>
          {!b.boardIntimatedAt ? <button type="button" className="ui-btn ui-btn-ghost ui-btn-sm" disabled={busy} onClick={() => run(() => updateBreach(b.id, { boardIntimatedAt: now() }), () => 'Board intimation noted.')}>Board told now</button> : null}
          {!b.boardReportAt ? <button type="button" className="ui-btn ui-btn-ghost ui-btn-sm" disabled={busy} onClick={() => { const ref = window.prompt('Board reference, if any') || null; run(() => updateBreach(b.id, { boardReportAt: now(), boardReference: ref }), () => 'Board report noted.'); }}>Report sent now</button> : null}
          <button type="button" className="ui-btn ui-btn-ghost ui-btn-sm" disabled={busy} onClick={() => run(() => updateBreach(b.id, { status: 'CLOSED' }), () => 'Closed.')}>Close</button>
        </div>
      ) : null}
    </li>
  );
}

function BreachForm({ onClose, onSaved }) {
  const [people, setPeople] = useState([]);
  const [f, setF] = useState({ title: '', description: '', discoveredAt: new Date().toISOString().slice(0, 16), categories: [], employeeIds: [], everyone: false, consequences: '', mitigation: '', stepsForPeople: '' });
  useEffect(() => { listEmployees().then(setPeople).catch(() => setPeople([])); }, []);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const submit = async (e) => {
    e.preventDefault();
    try {
      await recordBreach({ ...f, discoveredAt: new Date(f.discoveredAt).toISOString(), employeeIds: f.everyone ? people.map((p) => p.id) : f.employeeIds });
      notify.success('Recorded. Tell the Board and the affected people next.');
      onSaved();
    } catch (err) {
      notify.error(String(err?.message || 'Not recorded.'));
    }
  };
  return (
    <Drawer open onClose={onClose} title="Record a breach" widthClass="w-[min(42rem,96vw)]" actions={<><button type="button" className="ui-btn ui-btn-secondary" onClick={onClose}>Cancel</button><button type="submit" form="breach-form" className="ui-btn ui-btn-primary">Record</button></>}>
      <form id="breach-form" onSubmit={submit} className="grid gap-3">
        <label className="block"><span className="ui-label">What happened, in a line *</span><input className="ui-input w-full" required maxLength={160} value={f.title} onChange={set('title')} /></label>
        <label className="block"><span className="ui-label">Details *</span><textarea className="ui-input w-full" rows={3} required value={f.description} onChange={set('description')} /></label>
        <label className="block"><span className="ui-label">When you became aware *</span><input type="datetime-local" className="ui-input w-full" required value={f.discoveredAt} onChange={set('discoveredAt')} /></label>
        <fieldset><legend className="ui-label">Data involved *</legend>
          <div className="flex flex-wrap gap-3 text-sm">{CATEGORIES.map((c) => <label key={c} className="flex items-center gap-1.5"><input type="checkbox" checked={f.categories.includes(c)} onChange={(e) => setF({ ...f, categories: e.target.checked ? [...f.categories, c] : f.categories.filter((x) => x !== c) })} /> {c}</label>)}</div>
        </fieldset>
        <fieldset><legend className="ui-label">Who is affected</legend>
          <label className="flex items-center gap-1.5 text-sm"><input type="checkbox" checked={f.everyone} onChange={(e) => setF({ ...f, everyone: e.target.checked })} /> Everyone ({people.length})</label>
          {!f.everyone ? (
            <select multiple className="ui-select mt-1 h-40 w-full" value={f.employeeIds} onChange={(e) => setF({ ...f, employeeIds: [...e.target.selectedOptions].map((o) => o.value) })} aria-label="Affected employees">
              {people.map((p) => <option key={p.id} value={p.id}>{p.name}{p.code ? ` · ${p.code}` : ''}</option>)}
            </select>
          ) : null}
        </fieldset>
        <label className="block"><span className="ui-label">What it may mean for them *</span><textarea className="ui-input w-full" rows={2} required value={f.consequences} onChange={set('consequences')} /></label>
        <label className="block"><span className="ui-label">What has been done *</span><textarea className="ui-input w-full" rows={2} required value={f.mitigation} onChange={set('mitigation')} /></label>
        <label className="block"><span className="ui-label">What they can do *</span><textarea className="ui-input w-full" rows={2} required value={f.stepsForPeople} onChange={set('stepsForPeople')} /></label>
      </form>
    </Drawer>
  );
}
