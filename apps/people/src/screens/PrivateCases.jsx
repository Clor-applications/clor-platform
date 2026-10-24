import React, { useCallback, useEffect, useState } from 'react';
import { Lock } from 'lucide-react';
import { EmptyState, PageHeader, SkeletonCard } from '@ui/components/ui/Primitives';
import Drawer from '@ui/components/ui/Drawer';
import { notify } from '@ui/components/ui/notify';
import { usePermissions } from '@ui/permissions/usePermissions';
import { apiFetch } from '@platform/http';
import { orgId } from '@platform/context';
import { listEmployees } from '@ui/personnel/api';
import { orgUsers } from '../api/desk';

/**
 * Private cases (PRIV-01..06). Only the cases you are named on are listed —
 * nobody else learns one exists. Each opens to the account, the legal clock,
 * the members (and who was left out by the conflict check), the evidence,
 * and for the presiding officer every open of the case.
 */

const base = () => `/orgs/${encodeURIComponent(orgId())}/people/private-cases`;
const opts = { skipWarehouseHeader: true };
const STATUS = { RECEIVED: ['Received', 'ui-pill-info'], INQUIRY: ['Inquiry', 'ui-pill-warn'], REPORT_DUE: ['Report due', 'ui-pill-warn'], ACTION_DUE: ['Action due', 'ui-pill-warn'], CLOSED: ['Closed', 'ui-pill-neutral'] };
const NEXT = { RECEIVED: ['START_INQUIRY', 'Start the inquiry'], INQUIRY: ['CLOSE_INQUIRY', 'Close the inquiry'], REPORT_DUE: ['REPORT', 'Report given'], ACTION_DUE: ['CLOSE', 'Action taken: close'] };
const when = (d) => (d ? new Date(d).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '');

export default function PrivateCases() {
  const perms = usePermissions();
  const allowed = (key) => Boolean(perms?.isAdmin || perms?.permissions?.has?.(key));
  const [cases, setCases] = useState(null);
  const [open, setOpen] = useState(null);
  const [intake, setIntake] = useState(false);
  const [committee, setCommittee] = useState(null);
  const load = useCallback(() => apiFetch(base(), opts).then((r) => setCases(r?.cases || [])).catch((e) => notify.error(String(e?.message || 'Could not load.'))), []);
  useEffect(() => { load(); }, [load]);
  return (
    <div className="space-y-4">
      <PageHeader title="Private cases" description="POSH complaints and grievances. Only the people named on a case see it — not company admins unless they are named. Every open is recorded."
        actions={allowed('PEOPLE::Private Cases::CREATE') ? (
          <span className="flex gap-2">
            {allowed('PEOPLE::Private Cases::EDIT') ? <button type="button" className="ui-btn ui-btn-secondary" onClick={() => setCommittee('POSH_IC')}>Committees</button> : null}
            <button type="button" className="ui-btn ui-btn-primary" onClick={() => setIntake(true)}>Take in a case</button>
          </span>
        ) : null} />
      {!cases ? <SkeletonCard lines={4} /> : !cases.length ? <EmptyState icon={Lock} title="No cases for you" description="Cases you are named on appear here. If you are on the Internal Committee or the grievance committee, new cases come to you." /> : (
        <table className="w-full text-sm">
          <thead><tr className="ui-caption text-left"><th className="py-1.5 font-medium">Case</th><th className="py-1.5 font-medium">Kind</th><th className="py-1.5 font-medium">Received</th><th className="py-1.5 font-medium">Next date</th><th className="py-1.5 font-medium">Your role</th><th className="py-1.5 font-medium">Status</th></tr></thead>
          <tbody className="divide-y">
            {cases.map((c) => (
              <tr key={c.id} className="cursor-pointer" onClick={() => setOpen(c.id)}>
                <td className="py-2 pr-2 font-medium tabular-nums">{c.reference}</td>
                <td className="py-2 pr-2">{c.kind === 'POSH' ? 'POSH' : 'Grievance'}</td>
                <td className="py-2 pr-2 tabular-nums">{c.receivedOn}</td>
                <td className={`py-2 pr-2 tabular-nums ${c.overdue ? 'text-[rgb(var(--neg))] font-medium' : ''}`}>{c.overdue || (c.status === 'REPORT_DUE' ? `report by ${c.reportDue}` : c.status === 'ACTION_DUE' ? `act by ${c.actionDue}` : c.status === 'CLOSED' ? '—' : `inquiry by ${c.inquiryDue}`)}</td>
                <td className="py-2 pr-2">{String(c.myRole || '').toLowerCase()}</td>
                <td className="py-2"><span className={`ui-pill ${STATUS[c.status]?.[1] || ''}`}>{STATUS[c.status]?.[0] || c.status}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {open ? <CaseDrawer id={open} onClose={() => setOpen(null)} onChanged={load} /> : null}
      {intake ? <IntakeDrawer onClose={() => setIntake(false)} onDone={() => { setIntake(false); load(); }} /> : null}
      {committee ? <CommitteeDrawer kind={committee} onKind={setCommittee} onClose={() => setCommittee(null)} /> : null}
    </div>
  );
}

function CaseDrawer({ id, onClose, onChanged }) {
  const [c, setC] = useState(null);
  const reload = useCallback(() => apiFetch(`${base()}/${encodeURIComponent(id)}`, opts).then((r) => setC(r.case)).catch((e) => { notify.error(String(e?.message || 'Could not open.')); onClose(); }), [id, onClose]);
  useEffect(() => { reload(); }, [reload]);
  if (!c) return <Drawer open onClose={onClose} title="Private case"><SkeletonCard lines={6} /></Drawer>;
  const step = async (s, extra = {}) => {
    try {
      const r = await apiFetch(`${base()}/${encodeURIComponent(id)}/advance`, { ...opts, method: 'POST', body: { step: s, ...extra } });
      setC(r.case);
      onChanged();
    } catch (e) {
      notify.error(String(e?.message || 'Not done.'));
    }
  };
  const next = NEXT[c.status];
  const canMove = c.myRole === 'PRESIDING' || c.myRole === 'OFFICER';
  const openEvidence = async (ev) => {
    try {
      const r = await apiFetch(`${base()}/${encodeURIComponent(id)}/evidence/${encodeURIComponent(ev.id)}`, opts);
      const a = document.createElement('a');
      a.href = r.evidence.dataUrl;
      a.download = r.evidence.title;
      a.click();
      reload();
    } catch (e) {
      notify.error(String(e?.message || 'Could not open.'));
    }
  };
  const addEvidence = async (file) => {
    if (!file) return;
    const title = window.prompt('Name this evidence', file.name.replace(/\.[^.]+$/, ''));
    if (!title) return;
    try {
      const data = await new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = () => reject(new Error('Could not read the file.')); r.readAsDataURL(file); });
      await apiFetch(`${base()}/${encodeURIComponent(id)}/evidence`, { ...opts, method: 'POST', body: { title, data, mime: file.type } });
      notify.success('Added, sealed.');
      reload();
    } catch (e) {
      notify.error(String(e?.message || 'Not added.'));
    }
  };
  return (
    <Drawer open onClose={onClose} title={`${c.reference} · ${c.kind === 'POSH' ? 'POSH complaint' : 'Grievance'}`} description={`You are ${String(c.myRole).toLowerCase()} on this case. What you read here is recorded.`} widthClass="w-[min(44rem,96vw)]"
      actions={canMove && next ? (
        <button type="button" className="ui-btn ui-btn-primary" onClick={() => (next[0] === 'CLOSE' ? (() => { const o = window.prompt('Record the action taken'); if (o) step('CLOSE', { outcome: o }); })() : step(next[0]))}>{next[1]}</button>
      ) : null}>
      <div className="space-y-5 text-sm">
        <dl className="grid gap-3 sm:grid-cols-2">
          <div><dt className="ui-t-label">Complainant</dt><dd>{c.complainant}{c.onBehalf ? <span className="ui-caption"> · taken in on their behalf</span> : null}</dd></div>
          <div><dt className="ui-t-label">Respondents</dt><dd>{c.respondents.length ? c.respondents.join(', ') : 'Not named'}</dd></div>
        </dl>
        <section><h3 className="ui-t-label">Account</h3><p className="whitespace-pre-wrap mt-1">{c.summary}</p></section>
        <section className="space-y-1">
          <h3 className="ui-t-label">Clock</h3>
          <ul className="space-y-0.5 tabular-nums">
            <li>Happened {c.clock.incidentOn}; received {c.clock.receivedOn}; filing window to {c.clock.extendedTo || c.clock.filingDeadline}{c.clock.lateFiling ? <span className="text-[rgb(var(--neg))]"> · received after the window</span> : ''}{c.clock.extensionReason ? <span className="ui-caption"> · extended: {c.clock.extensionReason}</span> : ''}</li>
            <li>Inquiry by {c.clock.inquiryDue}{c.clock.inquiryClosedOn ? ` · closed ${c.clock.inquiryClosedOn}` : ''}</li>
            {c.clock.reportDue ? <li>Report by {c.clock.reportDue}{c.clock.reportOn ? ` · given ${c.clock.reportOn}` : ''}</li> : null}
            {c.clock.actionDue ? <li>Action by {c.clock.actionDue}{c.clock.actionOn ? ` · taken ${c.clock.actionOn}` : ''}</li> : null}
            {c.clock.overdue ? <li className="text-[rgb(var(--neg))] font-medium">{c.clock.overdue}</li> : null}
          </ul>
          {canMove && c.clock.lateFiling && !c.clock.extendedTo ? <button type="button" className="ui-link" onClick={() => { const r = window.prompt('Why is the filing window extended by three months?'); if (r) step('EXTEND', { reason: r }); }}>Extend the filing window</button> : null}
        </section>
        <section>
          <h3 className="ui-t-label">Members</h3>
          <p className="mt-1">{c.members.map((m) => `${m.name} (${m.role.toLowerCase()})`).join(', ')}</p>
          {c.excluded.length ? <p className="ui-caption">Left out by the conflict check: {c.excluded.map((x) => `${x.name} — ${x.why}`).join('; ')}</p> : null}
        </section>
        <section className="space-y-1">
          <div className="flex items-center justify-between"><h3 className="ui-t-label">Evidence</h3><label className="ui-link cursor-pointer">Add<input type="file" className="hidden" accept=".pdf,.jpg,.jpeg,.png,.webp,.txt,.doc,.docx" onChange={(e) => { addEvidence(e.target.files?.[0]); e.target.value = ''; }} /></label></div>
          {c.evidence.length ? <ul className="divide-y">{c.evidence.map((e) => <li key={e.id} className="py-1.5 flex items-center justify-between gap-2"><span>{e.title}</span><button type="button" className="ui-link" onClick={() => openEvidence(e)}>Open</button></li>)}</ul> : <p className="ui-muted">None yet.</p>}
        </section>
        {c.access ? (
          <section className="space-y-1">
            <h3 className="ui-t-label">Who opened this case</h3>
            <ul className="ui-caption space-y-0.5 max-h-48 overflow-y-auto">{c.access.map((a, i) => <li key={i}>{a.who} · {a.what === 'EVIDENCE' ? 'opened evidence' : 'opened the case'} · {when(a.at)}</li>)}</ul>
          </section>
        ) : null}
      </div>
    </Drawer>
  );
}

function IntakeDrawer({ onClose, onDone }) {
  const [people, setPeople] = useState([]);
  const [form, setForm] = useState({ kind: 'POSH', complainantEmployeeId: '', respondentEmployeeIds: [], incidentOn: '', summary: '' });
  const [saving, setSaving] = useState(false);
  useEffect(() => { listEmployees({ limit: 500 }).then((r) => setPeople((r?.employees || []).filter((p) => p.status !== 'LEFT'))).catch(() => setPeople([])); }, []);
  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const r = await apiFetch(base(), { ...opts, method: 'POST', body: form });
      notify.success(`${r.case.reference} has gone to the committee.`);
      onDone();
    } catch (err) {
      notify.error(String(err?.message || 'Not taken in.'));
    } finally {
      setSaving(false);
    }
  };
  return (
    <Drawer open onClose={onClose} title="Take in a case" description="For someone who came to you. It goes to the committee you choose; you will not see it afterwards unless you are on it."
      actions={<><button type="button" className="ui-btn ui-btn-secondary" onClick={onClose}>Cancel</button><button type="submit" form="intake-form" className="ui-btn ui-btn-primary" disabled={saving}>{saving ? 'Sending…' : 'Send to the committee'}</button></>}>
      <form id="intake-form" onSubmit={save} className="grid gap-4">
        <label className="block"><span className="ui-label">Goes to</span>
          <select className="ui-select w-full" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}><option value="POSH">The Internal Committee (sexual harassment)</option><option value="GRIEVANCE">The grievance committee</option></select>
        </label>
        <label className="block"><span className="ui-label">On behalf of</span>
          <select className="ui-select w-full" value={form.complainantEmployeeId} onChange={(e) => setForm({ ...form, complainantEmployeeId: e.target.value })}><option value="">— Not named —</option>{people.map((p) => <option key={p.id} value={p.id}>{p.name}{p.code ? ` · ${p.code}` : ''}</option>)}</select>
        </label>
        <fieldset><legend className="ui-label">About (respondents)</legend>
          <select multiple className="ui-select w-full" style={{ height: '7rem' }} value={form.respondentEmployeeIds} onChange={(e) => setForm({ ...form, respondentEmployeeIds: [...e.target.selectedOptions].map((o) => o.value) })} aria-label="Respondents">{people.map((p) => <option key={p.id} value={p.id}>{p.name}{p.code ? ` · ${p.code}` : ''}</option>)}</select>
        </fieldset>
        <label className="block"><span className="ui-label">When it happened *</span><input type="date" className="ui-input w-full sm:w-48" required value={form.incidentOn} onChange={(e) => setForm({ ...form, incidentOn: e.target.value })} /></label>
        <label className="block"><span className="ui-label">What happened *</span><textarea className="ui-input w-full" rows={6} required minLength={10} value={form.summary} onChange={(e) => setForm({ ...form, summary: e.target.value })} /><span className="ui-caption">Sealed when saved; only the committee reads it.</span></label>
      </form>
    </Drawer>
  );
}

function CommitteeDrawer({ kind, onKind, onClose }) {
  const [data, setData] = useState(null);
  const [users, setUsers] = useState([]);
  const [members, setMembers] = useState([]);
  useEffect(() => {
    orgUsers().then(setUsers);
    apiFetch(`${base()}/committee/${kind}`, opts).then((r) => { setData(r.committee); setMembers(r.committee.members); }).catch((e) => notify.error(String(e?.message || 'Could not load.')));
  }, [kind]);
  const save = async () => {
    try {
      const r = await apiFetch(`${base()}/committee/${kind}`, { ...opts, method: 'PUT', body: { members } });
      setData(r.committee);
      setMembers(r.committee.members);
      notify.success(r.committee.warnings.length ? 'Saved, with warnings.' : 'Saved.');
    } catch (e) {
      notify.error(String(e?.message || 'Not saved.'));
    }
  };
  const set = (i, patch) => setMembers((m) => m.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  return (
    <Drawer open onClose={onClose} title={kind === 'POSH_IC' ? 'Internal Committee (POSH)' : 'Grievance committee'} description="The members hear new cases. A member who is a respondent, or manages one, is left out of that case." widthClass="w-[min(44rem,96vw)]"
      actions={<><button type="button" className="ui-btn ui-btn-secondary" onClick={() => onKind(kind === 'POSH_IC' ? 'GRIEVANCE' : 'POSH_IC')}>{kind === 'POSH_IC' ? 'Grievance committee' : 'Internal Committee'}</button><button type="button" className="ui-btn ui-btn-primary" onClick={save}>Save</button></>}>
      {!data ? <SkeletonCard lines={4} /> : (
        <div className="space-y-3 text-sm">
          {data.warnings.length ? <ul className="space-y-0.5 text-[rgb(var(--neg))]" aria-label="Warnings">{data.warnings.map((w) => <li key={w}>{w}</li>)}</ul> : <p className="ui-caption">The set-up meets the rule as CLOR knows it. Confirm with your adviser.</p>}
          <ul className="space-y-2">
            {members.map((m, i) => (
              <li key={i} className="flex flex-wrap items-center gap-2">
                <select className="ui-select" value={m.userId} onChange={(e) => set(i, { userId: e.target.value })} aria-label="Member">{users.map((u) => <option key={u.id} value={u.id}>{u.fullName || u.email}</option>)}</select>
                <select className="ui-select" value={m.role} onChange={(e) => set(i, { role: e.target.value })} aria-label="Role"><option value="PRESIDING">Presiding</option><option value="MEMBER">Member</option><option value="EXTERNAL">External</option><option value="OFFICER">Grievance officer</option></select>
                <select className="ui-select" value={m.gender || ''} onChange={(e) => set(i, { gender: e.target.value })} aria-label="Gender"><option value="">—</option><option value="FEMALE">Woman</option><option value="MALE">Man</option><option value="OTHER">Other</option></select>
                <input type="date" className="ui-input" style={{ width: 'auto' }} value={m.termEnd || ''} onChange={(e) => set(i, { termEnd: e.target.value })} aria-label="Term ends" title="Term ends" />
                <button type="button" className="ui-link" onClick={() => setMembers((x) => x.filter((_, j) => j !== i))}>Remove</button>
              </li>
            ))}
          </ul>
          {users.length ? <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={() => setMembers((x) => [...x, { userId: users[0].id, role: 'MEMBER', gender: '' }])}>Add a member</button> : <p className="ui-muted">Listing users needs the Users grant.</p>}
        </div>
      )}
    </Drawer>
  );
}
