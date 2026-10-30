import React, { useMemo, useRef, useState } from 'react';
import { Lock, Plus, X } from '@ui/components/ui/lineIcons';
import { EmptyState, PageHeader, SkeletonCard } from '@ui/components/ui/Primitives';
import DataTable from '@ui/components/ui/DataTable';
import Drawer from '@ui/components/ui/Drawer';
import ErrorState from '@ui/components/ui/ErrorState';
import DatePicker, { formatDate } from '@ui/components/ui/DatePicker';
import PopupSelect from '@ui/components/pickers/PopupSelect';
import useRequest from '@ui/components/ui/useRequest';
import { useTabIndicator } from '@ui/components/ui/RecordTabs';
import { notify } from '@ui/components/ui/notify';
import { usePermissions } from '@ui/permissions/usePermissions';
import { apiFetch } from '@platform/http';
import { orgId } from '@platform/context';
import { listEmployees } from '@ui/personnel/api';
import SuggestInput from '@ui/components/ui/SuggestInput';
import { runListExport } from '@ui/components/list/exportMenu';
import { orgUsers } from '../api/desk';

/**
 * Private cases (PRIV-01..06). Only the cases you are named on are listed —
 * nobody else learns one exists. Each opens to the account, the legal clock,
 * the members (and who was left out by the conflict check), the evidence,
 * and for the presiding officer every open of the case. Laid out as every
 * Workforce list; anything the committee must write down is asked in a
 * drawer, never a browser prompt.
 */

const base = () => `/orgs/${encodeURIComponent(orgId())}/people/private-cases`;
const opts = { skipWarehouseHeader: true };
const STATUS = { RECEIVED: ['Received', 'ui-pill-info'], INQUIRY: ['Inquiry', 'ui-pill-warn'], REPORT_DUE: ['Report due', 'ui-pill-warn'], ACTION_DUE: ['Action due', 'ui-pill-warn'], CLOSED: ['Closed', 'ui-pill-neutral'] };
const NEXT = { RECEIVED: ['START_INQUIRY', 'Start the inquiry'], INQUIRY: ['CLOSE_INQUIRY', 'Close the inquiry'], REPORT_DUE: ['REPORT', 'Report given'], ACTION_DUE: ['CLOSE', 'Action taken: close'] };
const ROLES = [['PRESIDING', 'Presiding'], ['MEMBER', 'Member'], ['EXTERNAL', 'External'], ['OFFICER', 'Grievance officer']];
const GENDERS = [['', 'Not said'], ['FEMALE', 'Woman'], ['MALE', 'Man'], ['OTHER', 'Other']];
const day = (v) => (v ? formatDate(String(v).slice(0, 10)) : '');
const when = (d) => (d ? `${formatDate(new Date(new Date(d).getTime() + 330 * 60_000).toISOString().slice(0, 10))}, ${new Date(d).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}` : '');
const roleWord = (r) => ROLES.find(([k]) => k === r)?.[1]?.toLowerCase() || String(r || '').toLowerCase();
const nextDate = (c) => c.overdue || (c.status === 'REPORT_DUE' ? `Report by ${day(c.reportDue)}` : c.status === 'ACTION_DUE' ? `Act by ${day(c.actionDue)}` : c.status === 'CLOSED' ? '' : `Inquiry by ${day(c.inquiryDue)}`);

export default function PrivateCases() {
  const perms = usePermissions();
  const allowed = (key) => Boolean(perms?.isAdmin || perms?.permissions?.has?.(key));
  const req = useRequest(() => apiFetch(base(), opts).then((r) => ({ cases: r?.cases || [], annualReport: Boolean(r?.annualReport) })), []);
  const [open, setOpen] = useState(null);
  const [intake, setIntake] = useState(false);
  const [committee, setCommittee] = useState(false);
  const [report, setReport] = useState(false);
  const cases = req.data?.cases || [];
  const columns = [
    { key: 'reference', label: 'Case', always: true, render: (c) => <span className="font-medium tabular-nums">{c.reference}</span> },
    { key: 'kind', label: 'Kind', render: (c) => (c.kind === 'POSH' ? 'POSH' : 'Grievance') },
    { key: 'received', label: 'Received', render: (c) => <span className="tabular-nums whitespace-nowrap">{day(c.receivedOn)}</span> },
    { key: 'next', label: 'Next date', render: (c) => <span className={`tabular-nums whitespace-nowrap ${c.overdue ? 'ui-text-neg font-medium' : ''}`}>{nextDate(c) || '—'}</span> },
    { key: 'role', label: 'Your role', render: (c) => roleWord(c.myRole).replace(/^./, (x) => x.toUpperCase()) },
    { key: 'status', label: 'Status', render: (c) => <span className={`ui-pill ${STATUS[c.status]?.[1] || ''}`}>{STATUS[c.status]?.[0] || c.status}</span> },
  ];
  return (
    <div className="space-y-6">
      <PageHeader breadcrumb={[{ label: 'People' }, { label: 'Confidential cases' }]} title="Confidential cases"
        actions={<>
          {req.data?.annualReport ? <button type="button" className="ui-btn ui-btn-secondary" onClick={() => setReport(true)}>POSH annual report</button> : null}
          {allowed('PEOPLE::Private Cases::EDIT') ? <button type="button" className="ui-btn ui-btn-secondary" onClick={() => setCommittee(true)}>Committees</button> : null}
          {allowed('PEOPLE::Private Cases::CREATE') ? <button type="button" className="ui-btn ui-btn-primary" onClick={() => setIntake(true)}><Plus size={16} aria-hidden="true" /> Take in a case</button> : null}
        </>} />
      {req.error && !req.data ? <ErrorState error={req.error} onRetry={req.reload} /> : (
        <DataTable label="Private cases" columns={columns} rows={cases} loading={req.loading} refreshing={req.refreshing}
          total={cases.length} pageSize={Math.max(25, cases.length)} noun="cases" onRowClick={(c) => setOpen(c.id)}
          card={(c) => <span className="min-w-0 flex-1"><span className="flex items-center justify-between gap-2"><span className="truncate font-medium tabular-nums">{c.reference}</span><span className={`ui-pill ${STATUS[c.status]?.[1] || ''}`}>{STATUS[c.status]?.[0] || c.status}</span></span><span className={`block truncate ui-caption ${c.overdue ? 'ui-text-neg' : ''}`}>{[c.kind === 'POSH' ? 'POSH' : 'Grievance', nextDate(c)].filter(Boolean).join(' · ')}</span></span>}
          empty={<EmptyState icon={Lock} title="No cases for you" description="Cases you are named on appear here, and only those." />} />
      )}
      {open ? <CaseDrawer id={open} onClose={() => setOpen(null)} onChanged={req.reload} /> : null}
      {intake ? <IntakeDrawer onClose={() => setIntake(false)} onDone={() => { setIntake(false); req.reload(); }} /> : null}
      {committee ? <CommitteeDrawer onClose={() => setCommittee(false)} /> : null}
      {report ? <AnnualReportDrawer onClose={() => setReport(false)} /> : null}
    </div>
  );
}

/* One thing the committee must write down (a name, a reason, the action taken), asked in a drawer. */
function AskDrawer({ title, label, initial = '', multiline = false, submitLabel = 'Save', onClose, onSubmit }) {
  const [text, setText] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [missing, setMissing] = useState(false);
  /* A ref, not the busy state: Enter twice lands before React re-renders,
     and a second submit would upload the same sealed evidence twice. */
  const inFlight = useRef(false);
  const submit = async () => {
    if (inFlight.current) return;
    if (!text.trim()) { setMissing(true); return; }
    inFlight.current = true;
    setBusy(true);
    try { await onSubmit(text.trim()); } finally { inFlight.current = false; setBusy(false); }
  };
  const Field = multiline ? 'textarea' : 'input';
  return (
    <Drawer open onClose={onClose} widthClass="w-[min(36rem,96vw)] ui-drawer-sheet" title={title} dirty={text.trim() !== initial.trim()}
      footer={<><button type="button" className="ui-btn ui-btn-secondary" onClick={onClose}>Cancel</button><button type="button" className="ui-btn ui-btn-primary" disabled={busy} onClick={submit}>{busy ? 'Saving…' : submitLabel}</button></>}>
      <form onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <label className="block"><span className="ui-label">{label} *</span>
          <Field className="ui-input w-full" rows={multiline ? 4 : undefined} maxLength={2000} value={text} autoFocus aria-invalid={missing || undefined} onChange={(e) => { setText(e.target.value); setMissing(false); }} />
          {missing ? <span className="ui-field-error">This is needed.</span> : null}
        </label>
      </form>
    </Drawer>
  );
}

function CaseDrawer({ id, onClose, onChanged }) {
  const req = useRequest(() => apiFetch(`${base()}/${encodeURIComponent(id)}`, opts).then((r) => r.case), [id]);
  const c = req.data;
  const [ask, setAsk] = useState(null);
  const fileRef = useRef(null);
  /* One step at a time: a double click on "Start the inquiry" must not
     advance the case twice. */
  const [moving, setMoving] = useState(false);
  const stepping = useRef(false);
  const step = async (s, extra = {}) => {
    if (stepping.current) return;
    stepping.current = true;
    setMoving(true);
    try {
      await apiFetch(`${base()}/${encodeURIComponent(id)}/advance`, { ...opts, method: 'POST', body: { step: s, ...extra } });
      req.reload();
      onChanged();
      setAsk(null);
    } catch (e) {
      notify.error(String(e?.message || 'Not done.'));
    } finally {
      stepping.current = false;
      setMoving(false);
    }
  };
  const openEvidence = async (ev) => {
    try {
      const r = await apiFetch(`${base()}/${encodeURIComponent(id)}/evidence/${encodeURIComponent(ev.id)}`, opts);
      const a = document.createElement('a');
      a.href = r.evidence.dataUrl;
      a.download = r.evidence.title;
      a.click();
      req.reload();
    } catch (e) {
      notify.error(String(e?.message || 'Could not open.'));
    }
  };
  const addEvidence = async (file, title) => {
    try {
      const data = await new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = () => reject(new Error('Could not read the file.')); r.readAsDataURL(file); });
      await apiFetch(`${base()}/${encodeURIComponent(id)}/evidence`, { ...opts, method: 'POST', body: { title, data, mime: file.type } });
      notify.success('Added, sealed.');
      setAsk(null);
      req.reload();
    } catch (e) {
      notify.error(String(e?.message || 'Not added.'));
    }
  };
  const next = c ? NEXT[c.status] : null;
  const canMove = c ? c.myRole === 'PRESIDING' || c.myRole === 'OFFICER' : false;
  return (
    <Drawer open onClose={onClose} title={c ? `${c.reference} · ${c.kind === 'POSH' ? 'POSH complaint' : 'Grievance'}` : 'Private case'} widthClass="w-[min(44rem,96vw)] ui-drawer-sheet"
      footer={c && canMove && next ? (
        <button type="button" className="ui-btn ui-btn-primary" disabled={moving} onClick={() => (next[0] === 'CLOSE' ? setAsk({ kind: 'close' }) : step(next[0]))}>{next[1]}</button>
      ) : null}>
      {req.error ? <ErrorState error={req.error} compact onRetry={req.reload} /> : !c ? <SkeletonCard lines={6} /> : (
        <div className="space-y-5 text-sm">
          <p className="ui-caption">You are {roleWord(c.myRole)} on this case. What you read here is recorded.</p>
          <dl className="ui-field-grid">
            <div><dt className="ui-label">Complainant</dt><dd>{c.complainant}{c.onBehalf ? <span className="ui-caption"> · taken in on their behalf</span> : null}</dd></div>
            <div><dt className="ui-label">Respondents</dt><dd>{c.respondents.length ? c.respondents.join(', ') : 'Not named'}</dd></div>
          </dl>
          <section className="space-y-1"><h3 className="ui-label">Account</h3><p className="whitespace-pre-wrap">{c.summary}</p></section>
          <section className="space-y-1">
            <h3 className="ui-label">Clock</h3>
            <ul className="space-y-0.5 tabular-nums">
              <li>Happened {day(c.clock.incidentOn)}; received {day(c.clock.receivedOn)}; filing window to {day(c.clock.extendedTo || c.clock.filingDeadline)}{c.clock.lateFiling ? <span className="ui-text-neg"> · received after the window</span> : ''}{c.clock.extensionReason ? <span className="ui-caption"> · extended: {c.clock.extensionReason}</span> : ''}</li>
              <li>Inquiry by {day(c.clock.inquiryDue)}{c.clock.inquiryClosedOn ? ` · closed ${day(c.clock.inquiryClosedOn)}` : ''}</li>
              {c.clock.reportDue ? <li>Report by {day(c.clock.reportDue)}{c.clock.reportOn ? ` · given ${day(c.clock.reportOn)}` : ''}</li> : null}
              {c.clock.actionDue ? <li>Action by {day(c.clock.actionDue)}{c.clock.actionOn ? ` · taken ${day(c.clock.actionOn)}` : ''}</li> : null}
              {c.clock.overdue ? <li className="ui-text-neg font-medium">{c.clock.overdue}</li> : null}
            </ul>
            {canMove && c.clock.lateFiling && !c.clock.extendedTo ? <button type="button" className="ui-link" onClick={() => setAsk({ kind: 'extend' })}>Extend the filing window</button> : null}
          </section>
          <section className="space-y-1">
            <h3 className="ui-label">Members</h3>
            <p>{c.members.map((m) => `${m.name} (${roleWord(m.role)})`).join(', ')}</p>
            {c.excluded.length ? <p className="ui-caption">Left out by the conflict check: {c.excluded.map((x) => `${x.name}, ${x.why}`).join('; ')}</p> : null}
          </section>
          <section className="space-y-1">
            <div className="flex items-center justify-between">
              <h3 className="ui-label">Evidence</h3>
              <button type="button" className="ui-link" onClick={() => fileRef.current?.click()}>Add</button>
              <input ref={fileRef} type="file" className="hidden" accept=".pdf,.jpg,.jpeg,.png,.webp,.txt,.doc,.docx" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) setAsk({ kind: 'evidence', file: f }); }} />
            </div>
            {c.evidence.length ? <ul className="divide-y border-t">{c.evidence.map((e) => <li key={e.id} className="py-2 flex items-center justify-between gap-2"><span>{e.title}</span><button type="button" className="ui-link" onClick={() => openEvidence(e)}>Open</button></li>)}</ul> : <p className="ui-muted">None yet.</p>}
          </section>
          {c.access ? (
            <section className="space-y-1">
              <h3 className="ui-label">Who opened this case</h3>
              <ul className="ui-caption space-y-0.5 max-h-48 overflow-y-auto">{c.access.map((a, i) => <li key={i} className="tabular-nums">{a.who} · {a.what === 'EVIDENCE' ? 'opened evidence' : 'opened the case'} · {when(a.at)}</li>)}</ul>
            </section>
          ) : null}
        </div>
      )}
      {ask?.kind === 'close' ? <AskDrawer title="Close the case" label="Action taken" multiline submitLabel="Close the case" onClose={() => setAsk(null)} onSubmit={(o) => step('CLOSE', { outcome: o })} /> : null}
      {ask?.kind === 'extend' ? <AskDrawer title="Extend the filing window" label="Why it is extended by three months" multiline submitLabel="Extend" onClose={() => setAsk(null)} onSubmit={(r) => step('EXTEND', { reason: r })} /> : null}
      {ask?.kind === 'evidence' ? <AskDrawer title="Add evidence" label="Name" initial={ask.file.name.replace(/\.[^.]+$/, '')} submitLabel="Add, sealed" onClose={() => setAsk(null)} onSubmit={(t) => addEvidence(ask.file, t)} /> : null}
    </Drawer>
  );
}

function IntakeDrawer({ onClose, onDone }) {
  const people = useRequest(() => listEmployees({ limit: 500, status: 'CURRENT' }).then((r) => (r?.employees || []).filter((p) => p.status !== 'LEFT')), []);
  const [form, setForm] = useState({ kind: 'POSH', complainantEmployeeId: '', respondentEmployeeIds: [], incidentOn: '', summary: '' });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const list = people.data || [];
  const nameOf = (id) => { const p = list.find((x) => x.id === id); return p ? (p.code ? `${p.name} (${p.code})` : p.name) : id; };
  const dirty = Boolean(form.complainantEmployeeId || form.respondentEmployeeIds.length || form.incidentOn || form.summary);
  const save = async () => {
    const problem = !form.incidentOn ? 'Choose when it happened.' : form.summary.trim().length < 10 ? 'Say what happened.' : null;
    if (problem) { setError({ message: problem }); return; }
    setSaving(true);
    setError(null);
    try {
      const r = await apiFetch(base(), { ...opts, method: 'POST', body: { ...form, summary: form.summary.trim() } });
      notify.success(`${r.case.reference} has gone to the committee.`);
      onDone();
    } catch (err) { setError(err); } finally { setSaving(false); }
  };
  return (
    <Drawer open onClose={onClose} widthClass="w-[min(36rem,96vw)] ui-drawer-sheet" title="Take in a case" dirty={dirty}
      footer={<><button type="button" className="ui-btn ui-btn-secondary" onClick={onClose}>Cancel</button><button type="button" className="ui-btn ui-btn-primary" disabled={saving} onClick={save}>{saving ? 'Sending…' : 'Send to the committee'}</button></>}>
      <form className="ui-form-grid" onSubmit={(e) => { e.preventDefault(); save(); }}>
        {error ? <div className="sm:col-span-2"><ErrorState error={error?.status ? error : null} compact title={error?.status ? undefined : error.message} body={error?.status && error.status < 500 ? error.message : undefined} /></div> : null}
        <div className="sm:col-span-2"><PopupSelect showValueSubtext={false} label="Goes to" value={form.kind} onChange={(v) => setForm({ ...form, kind: v || 'POSH' })} options={[{ value: 'POSH', label: 'The Internal Committee (sexual harassment)' }, { value: 'GRIEVANCE', label: 'The grievance committee' }]} /></div>
        <div className="sm:col-span-2"><PopupSelect showValueSubtext={false} label="On behalf of" value={form.complainantEmployeeId} placeholder="Not named" alwaysSearch onChange={(v) => setForm({ ...form, complainantEmployeeId: v || '' })} options={[{ value: '', label: 'Not named' }, ...list.map((p) => ({ value: p.id, label: nameOf(p.id) }))]} /></div>
        <div className="sm:col-span-2">
          <PopupSelect showValueSubtext={false} label="About" value="" placeholder={form.respondentEmployeeIds.length ? 'Add another person…' : 'Add a person…'} alwaysSearch
            onChange={(v) => { if (v && !form.respondentEmployeeIds.includes(v)) setForm({ ...form, respondentEmployeeIds: [...form.respondentEmployeeIds, v] }); }}
            options={list.filter((p) => !form.respondentEmployeeIds.includes(p.id)).map((p) => ({ value: p.id, label: nameOf(p.id) }))} />
          {form.respondentEmployeeIds.length ? (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {form.respondentEmployeeIds.map((id) => <span key={id} className="ui-pill ui-pill-info inline-flex items-center gap-1">{nameOf(id)}<button type="button" className="ui-icon-btn !h-4 !w-4" aria-label={`Remove ${nameOf(id)}`} onClick={() => setForm({ ...form, respondentEmployeeIds: form.respondentEmployeeIds.filter((x) => x !== id) })}><X size={12} aria-hidden="true" /></button></span>)}
            </div>
          ) : null}
        </div>
        <div><label className="ui-label" htmlFor="case-when">When it happened *</label><DatePicker id="case-when" value={form.incidentOn} max={new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10)} onChange={(v) => setForm({ ...form, incidentOn: v || '' })} /></div>
        <label className="block sm:col-span-2"><span className="ui-label">What happened *</span><textarea className="ui-input w-full" rows={6} value={form.summary} onChange={(e) => setForm({ ...form, summary: e.target.value })} aria-describedby="case-sealed" /><span id="case-sealed" className="ui-caption">Sealed when saved; only the committee reads it.</span></label>
      </form>
    </Drawer>
  );
}

function CommitteeDrawer({ onClose }) {
  const [kind, setKind] = useState('POSH_IC');
  const tabsRef = useRef(null);
  const tabIndicator = useTabIndicator(tabsRef, kind);
  const users = useRequest(() => orgUsers(), []);
  const req = useRequest(() => apiFetch(`${base()}/committee/${kind}`, opts).then((r) => r.committee), [kind]);
  const [edits, setEdits] = useState({});
  const members = edits[kind] ?? req.data?.members ?? [];
  const initial = useMemo(() => JSON.stringify(req.data?.members || []), [req.data]);
  const dirty = Boolean(edits[kind]) && JSON.stringify(edits[kind]) !== initial;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const setMembers = (fn) => setEdits((e) => ({ ...e, [kind]: fn(e[kind] ?? req.data?.members ?? []) }));
  const set = (i, patch) => setMembers((m) => m.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const list = users.data || [];
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await apiFetch(`${base()}/committee/${kind}`, { ...opts, method: 'PUT', body: { members } });
      notify.success(r.committee.warnings.length ? 'Saved, with warnings.' : 'Saved.');
      setEdits((e) => { const n = { ...e }; delete n[kind]; return n; });
      req.reload();
    } catch (e) { setError(e); } finally { setBusy(false); }
  };
  return (
    <Drawer open onClose={onClose} title="Committees" widthClass="w-[min(48rem,96vw)] ui-drawer-sheet" dirty={dirty}
      footer={<><button type="button" className="ui-btn ui-btn-secondary" onClick={onClose}>Close</button><button type="button" className="ui-btn ui-btn-primary" disabled={busy || !dirty} onClick={save}>{busy ? 'Saving…' : 'Save'}</button></>}>
      <div className="space-y-4 text-sm">
        <div ref={tabsRef} role="tablist" aria-label="Committee" className={`ui-record-tablist ${tabIndicator ? 'has-indicator' : ''}`}>
          {[['POSH_IC', 'Internal Committee (POSH)'], ['GRIEVANCE', 'Grievance committee']].map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={kind === k} disabled={dirty && kind !== k} className={`ui-tab ${kind === k ? 'is-active' : ''}`} onClick={() => setKind(k)}>{l}</button>)}
          {tabIndicator}
        </div>
        {error ? <ErrorState error={error} compact /> : null}
        {req.error ? <ErrorState error={req.error} compact onRetry={req.reload} /> : !req.data ? <SkeletonCard lines={4} /> : (
          <>
            {req.data.warnings.length ? (
              <ul className="ui-attention" aria-label="Warnings">{req.data.warnings.map((w) => <li key={w}><span className="ui-attention-dot is-warn" aria-hidden="true" /><span>{w}</span></li>)}</ul>
            ) : <p className="ui-caption">The set-up meets the rule as CLOR knows it. Confirm with your adviser.</p>}
            {members.length ? (
              <ul className="divide-y border-t">
                {members.map((m, i) => (
                  <li key={m.userId} className="grid gap-2 py-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1.3fr)_auto] sm:items-end">
                    <div><PopupSelect showValueSubtext={false} label="Member" value={m.userId} alwaysSearch={list.length > 8} onChange={(v) => v && set(i, { userId: v })} options={list.filter((u) => u.id === m.userId || !members.some((o) => o.userId === u.id)).map((u) => ({ value: u.id, label: u.fullName || u.email }))} /></div>
                    <div><PopupSelect showValueSubtext={false} label="Role" value={m.role} onChange={(v) => v && set(i, { role: v })} options={ROLES.map(([value, label]) => ({ value, label }))} /></div>
                    <div><PopupSelect showValueSubtext={false} label="Gender" value={m.gender || ''} placeholder="Not said" onChange={(v) => set(i, { gender: v || '' })} options={GENDERS.map(([value, label]) => ({ value, label }))} /></div>
                    <div><label className="ui-label" htmlFor={`term-${i}`}>Term ends</label><DatePicker id={`term-${i}`} value={m.termEnd || ''} onChange={(v) => set(i, { termEnd: v || '' })} /></div>
                    <button type="button" className="ui-btn ui-btn-ghost" onClick={() => setMembers((x) => x.filter((_, j) => j !== i))}>Remove</button>
                  </li>
                ))}
              </ul>
            ) : <p className="ui-muted">No members yet.</p>}
            {/* Rows are keyed by member, so a person sits on the committee once:
                each picker offers only people not already on it. */}
            {list.length ? (list.some((u) => !members.some((m) => m.userId === u.id)) ? <button type="button" className="ui-btn ui-btn-secondary" onClick={() => setMembers((x) => [...x, { userId: list.find((u) => !x.some((m) => m.userId === u.id)).id, role: 'MEMBER', gender: '' }])}><Plus size={16} aria-hidden="true" /> Add a member</button> : null) : <p className="ui-muted">Listing users needs the Users grant.</p>}
          </>
        )}
      </div>
    </Drawer>
  );
}

/**
 * The POSH annual report (Act s.21, Rule 14; People audit gap 12): the
 * counts for a calendar year from the cases, never a name or a reference;
 * the presiding officer adds the workshops held and the action taken, then
 * downloads it to sign and file with the District Officer by 31 January.
 */
const yearIst = () => Number(new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 4));
function AnnualReportDrawer({ onClose }) {
  const [thisYear] = useState(yearIst);
  const [year, setYear] = useState(String(thisYear - 1));
  const [workshops, setWorkshops] = useState('');
  const [action, setAction] = useState('');
  const req = useRequest(() => apiFetch(`${base()}/report/${year}`, opts).then((r) => r?.report), [year]);
  const r = req.data;
  const rows = r ? [
    ['Complaints pending at the start of the year', r.pendingAtStart],
    ['Complaints received in the year', r.received],
    ['Complaints disposed of in the year', r.disposed],
    ['Complaints pending at the end of the year', r.pendingAtEnd],
    ['Pending for more than 90 days', r.pendingOver90Days],
    ['Workshops and awareness programmes held', workshops.trim() || 'To be filled in'],
    ['Nature of action taken', action.trim() || 'To be filled in'],
    ['Internal Committee', `${r.committee.members} member${r.committee.members === 1 ? '' : 's'}, ${r.committee.women} women, ${r.committee.external} external${r.committee.presiding ? `; presiding: ${r.committee.presiding}` : ''}`],
  ] : [];
  const download = (format) => runListExport({
    format, title: `POSH annual report ${year}`, subtitle: [r?.company, 'Internal Committee, under the Sexual Harassment of Women at Workplace Act 2013, s.21'].filter(Boolean).join(' · '),
    fileName: `posh-annual-report-${year}`, label: 'lines', columns: [{ key: 'item', label: 'Item' }, { key: 'value', label: 'For the year' }],
    rows: rows.map(([item, value]) => ({ item, value: String(value) })),
    footNote: `For the District Officer by ${day(r?.dueOn)}. Signed by the presiding officer.`,
  });
  return (
    <Drawer open onClose={onClose} widthClass="w-[min(36rem,96vw)] ui-drawer-sheet" title="POSH annual report"
      footer={<>
        <button type="button" className="ui-btn ui-btn-secondary" disabled={!r} onClick={() => download('xlsx')}>Excel</button>
        <button type="button" className="ui-btn ui-btn-primary" disabled={!r} onClick={() => download('pdf')}>Download PDF</button>
      </>}>
      <div className="grid gap-4">
        <div className="w-full sm:w-72"><PopupSelect showValueSubtext={false} label="Year" value={year} onChange={(v) => v && setYear(v)} options={[thisYear, thisYear - 1, thisYear - 2, thisYear - 3].map((y) => ({ value: String(y), label: `January–December ${y}` }))} /></div>
        {req.error && !r ? <ErrorState error={req.error} compact body={req.error?.message} /> : !r ? <SkeletonCard lines={6} /> : (
          <>
            <dl className="divide-y border-y text-sm">
              {rows.slice(0, 5).map(([label, n]) => <div key={label} className="flex items-center justify-between gap-3 py-2"><dt>{label}</dt><dd className="tabular-nums">{n}</dd></div>)}
              <div className="flex items-start justify-between gap-3 py-2"><dt>Internal Committee</dt><dd className="text-right">{rows[7][1]}</dd></div>
            </dl>
            <label className="block"><span className="ui-label">Workshops and awareness programmes held</span><SuggestInput maxLength={300} placeholder="2 sessions: March and September" value={workshops} onChange={setWorkshops} suggestions={[]} /></label>
            <label className="block"><span className="ui-label">Nature of action taken</span><textarea className="ui-input w-full" rows={3} maxLength={1000} value={action} onChange={(e) => setAction(e.target.value)} /></label>
            <p className="ui-caption">Counts only: no names or case numbers. File it with the District Officer by {day(r.dueOn)}.</p>
          </>
        )}
      </div>
    </Drawer>
  );
}
