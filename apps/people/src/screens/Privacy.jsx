import React, { useRef, useState } from 'react';
import { Download, Plus } from 'lucide-react';
import { EmptyState, PageHeader } from '@ui/components/ui/Primitives';
import DataTable from '@ui/components/ui/DataTable';
import Drawer from '@ui/components/ui/Drawer';
import ErrorState from '@ui/components/ui/ErrorState';
import DatePicker, { formatDate } from '@ui/components/ui/DatePicker';
import PopupSelect from '@ui/components/pickers/PopupSelect';
import useRequest from '@ui/components/ui/useRequest';
import { useTabIndicator } from '@ui/components/ui/RecordTabs';
import { confirmDialog, notify } from '@ui/components/ui/notify';
import { usePermissions } from '@ui/permissions/usePermissions';
import { downloadCsv } from '@ui/utils/csv';
import { apiFetch } from '@platform/http';
import { orgId } from '@platform/context';
import { orgUsers } from '../api/desk';

/**
 * Privacy (PRV-03, 06, 07): who viewed what; how long each kind of data is
 * kept, with the legal minimum and a legal hold; the deletion review, where
 * nothing is erased without a person; and auditor access to named evidence,
 * time-limited, every open on the report. Four tabs, each a Workforce list,
 * each change made in a drawer.
 */
const base = () => `/orgs/${encodeURIComponent(orgId())}/people/privacy`;
const opts = { skipWarehouseHeader: true };
const VIEWS = [['access', 'Who viewed what'], ['retention', 'Retention'], ['review', 'Deletion review'], ['auditors', 'Auditor access']];
const todayIst = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
const istDay = (v) => new Date(new Date(v).getTime() + 330 * 60_000).toISOString().slice(0, 10);
const day = (v) => (v ? formatDate(String(v).length > 10 ? istDay(v) : String(v)) : '');
const when = (v) => (v ? `${day(v)}, ${new Date(v).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })}` : '');
const SHEET = 'w-[min(36rem,96vw)] ui-drawer-sheet';
const formError = (error) => (error ? <div className="sm:col-span-2"><ErrorState error={error?.status ? error : null} compact title={error?.status ? undefined : error.message} body={error?.status && error.status < 500 ? error.message : undefined} /></div> : null);

export default function Privacy() {
  const perms = usePermissions();
  const allowed = (key) => Boolean(perms?.isAdmin || perms?.permissions?.has?.(key));
  const [view, setView] = useState('access');
  const [giving, setGiving] = useState(false);
  const tabsRef = useRef(null);
  const tabIndicator = useTabIndicator(tabsRef, view);
  const [auditorsKey, setAuditorsKey] = useState(0);
  return (
    <div className="space-y-6">
      <PageHeader title="Privacy"
        actions={view === 'auditors' && allowed('PEOPLE::Privacy::EDIT') ? <button type="button" className="ui-btn ui-btn-primary" onClick={() => setGiving(true)}><Plus size={16} aria-hidden="true" /> Give auditor access</button> : null} />
      <div ref={tabsRef} role="tablist" aria-label="Privacy" className={`ui-record-tablist ${tabIndicator ? 'has-indicator' : ''}`}>
        {VIEWS.map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={view === k} className={`ui-tab ${view === k ? 'is-active' : ''}`} onClick={() => setView(k)}>{l}</button>)}
        {tabIndicator}
      </div>
      {view === 'access' ? <AccessReport /> : null}
      {view === 'retention' ? <Retention canEdit={allowed('PEOPLE::Privacy::EDIT')} /> : null}
      {view === 'review' ? <DeletionReview canKeep={allowed('PEOPLE::Privacy::EDIT')} canErase={allowed('PEOPLE::Privacy::DELETE')} /> : null}
      {view === 'auditors' ? <Auditors key={auditorsKey} canEdit={allowed('PEOPLE::Privacy::EDIT')} /> : null}
      {giving ? <GiveAccess onClose={() => setGiving(false)} onDone={() => { setGiving(false); setAuditorsKey((k) => k + 1); setView('auditors'); }} /> : null}
    </div>
  );
}

function AccessReport() {
  const [from, setFrom] = useState(`${todayIst().slice(0, 8)}01`);
  const [to, setTo] = useState(todayIst());
  const [what, setWhat] = useState('all');
  const req = useRequest(() => apiFetch(`${base()}/access?from=${from}&to=${to}${what !== 'all' ? `&what=${what}` : ''}`, opts), [from, to, what]);
  const data = req.data;
  const exportCsv = () => downloadCsv({
    fileName: `access-${from}-to-${to}`,
    columns: [{ key: 'at', label: 'When', value: (r) => when(r.at) }, { key: 'user', label: 'Who' }, { key: 'label', label: 'What' }, { key: 'employee', label: 'Person' }, { key: 'detail', label: 'Detail' }],
    rows: data?.views || [],
  });
  const columns = [
    { key: 'at', label: 'When', render: (v) => <span className="tabular-nums whitespace-nowrap">{when(v.at)}</span> },
    { key: 'user', label: 'Who', render: (v) => v.user },
    { key: 'label', label: 'What', render: (v) => v.label },
    { key: 'employee', label: 'Person', render: (v) => v.employee || '—' },
    { key: 'detail', label: 'Detail', render: (v) => v.detail || '—' },
  ];
  return (
    <section className="space-y-4" aria-label="Who viewed what">
      {req.error && !data ? <ErrorState error={req.error} onRetry={req.reload} /> : (
        <DataTable label="Views" columns={columns} rows={data?.views || []} loading={req.loading} refreshing={req.refreshing}
          total={data?.views?.length || 0} pageSize={Math.max(25, data?.views?.length || 0)} noun="views"
          card={(v) => <span className="min-w-0 flex-1"><span className="block truncate"><span className="font-medium">{v.user}</span> · {v.label}</span><span className="block truncate ui-caption tabular-nums">{[when(v.at), v.employee].filter(Boolean).join(' · ')}</span></span>}
          empty={<EmptyState title="No views in this period" description="Opening statutory details, confidential files or auditor evidence shows here." />}
          toolbar={<>
            <div className="w-full sm:w-40"><DatePicker id="acc-from" value={from} max={to} onChange={(v) => setFrom(v || from)} label="From" /></div>
            <div className="w-full sm:w-40"><DatePicker id="acc-to" value={to} min={from} onChange={(v) => setTo(v || to)} label="To" /></div>
            <div className="w-full sm:w-56"><PopupSelect showValueSubtext={false} ariaLabel="What" value={what} onChange={(v) => setWhat(v || 'all')} options={[{ value: 'all', label: 'Everything' }, ...Object.entries(data?.kinds || {}).map(([value, label]) => ({ value, label }))]} /></div>
            <button type="button" className="ui-btn ui-btn-secondary sm:ms-auto" onClick={exportCsv} disabled={!data?.views?.length}><Download size={16} aria-hidden="true" /> Export</button>
          </>} />
      )}
      {data?.privateCaseOpens?.length ? (
        <section className="space-y-2" aria-label="Private cases">
          <h3 className="ui-t-sec">Private cases <span className="ui-caption">counts only</span></h3>
          <ul className="divide-y border-t text-sm">
            {data.privateCaseOpens.map((c) => <li key={`${c.userId}-${c.what}`} className="flex justify-between gap-3 py-2"><span>{c.user} · {c.what === 'EVIDENCE' ? 'opened evidence' : 'opened a case'}</span><span className="tabular-nums">{c.count}</span></li>)}
          </ul>
        </section>
      ) : null}
    </section>
  );
}

function Retention({ canEdit }) {
  const req = useRequest(() => apiFetch(`${base()}/retention`, opts).then((r) => r?.schedule || []), []);
  const [editing, setEditing] = useState(null);
  const rows = req.data || [];
  const lift = async (r) => {
    if (!(await confirmDialog({ title: `Lift the hold on ${r.label.toLowerCase()}?`, message: 'The deletion review can then erase what is past its time again.', confirmLabel: 'Lift hold' }))) return;
    try {
      await apiFetch(`${base()}/retention/${r.dataType}`, { ...opts, method: 'PUT', body: { legalHold: false } });
      notify.success('Hold lifted.');
      req.reload();
    } catch (e) { notify.error(String(e?.message || 'Not changed.')); }
  };
  const columns = [
    { key: 'label', label: 'Data', always: true, render: (r) => <span className="min-w-0"><span className="block font-medium">{r.label}</span><span className="block ui-caption">{r.basis}{r.erasable ? '' : ' Never erased by a request.'}</span></span> },
    { key: 'keep', label: 'Keep', align: 'right', render: (r) => <span className="tabular-nums whitespace-nowrap">{r.keepYears} years<span className="block ui-caption">at least {r.minYears}</span></span> },
    { key: 'after', label: 'Counted from', render: (r) => r.after },
    { key: 'hold', label: 'Legal hold', render: (r) => (r.legalHold ? <span><span className="ui-pill ui-pill-warn">On hold</span>{r.holdReason ? <span className="block ui-caption">{r.holdReason}</span> : null}</span> : <span className="ui-muted">None</span>) },
  ];
  const rowActions = (r) => (canEdit ? [
    { key: 'edit', label: 'Change how long', onSelect: () => setEditing({ row: r, mode: 'years' }) },
    r.legalHold ? { key: 'lift', label: 'Lift hold', onSelect: () => lift(r) } : { key: 'hold', label: 'Put on hold', onSelect: () => setEditing({ row: r, mode: 'hold' }) },
  ] : []);
  return (
    <section aria-label="Retention">
      {req.error && !req.data ? <ErrorState error={req.error} onRetry={req.reload} /> : (
        <DataTable label="Retention" columns={columns} rows={rows} rowKey={(r) => r.dataType} loading={req.loading} refreshing={req.refreshing}
          total={rows.length} pageSize={Math.max(25, rows.length)} noun="kinds of data" rowActions={canEdit ? rowActions : null}
          onRowClick={canEdit ? (r) => setEditing({ row: r, mode: 'years' }) : null}
          card={(r) => <span className="min-w-0 flex-1"><span className="flex items-center justify-between gap-2"><span className="truncate font-medium">{r.label}</span><span className="tabular-nums ui-caption">{r.keepYears} years</span></span><span className="block truncate ui-caption">{r.legalHold ? 'On hold' : r.after}</span></span>}
          empty={<EmptyState title="No retention schedule" />} />
      )}
      {editing ? <RetentionDrawer {...editing} onClose={() => setEditing(null)} onDone={() => { setEditing(null); req.reload(); }} /> : null}
    </section>
  );
}

function RetentionDrawer({ row, mode, onClose, onDone }) {
  const [years, setYears] = useState(String(row.keepYears));
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const dirty = mode === 'years' ? years !== String(row.keepYears) : Boolean(reason.trim());
  const save = async () => {
    const n = Number(years);
    if (mode === 'years' && !(n >= row.minYears && n <= 30)) { setError({ message: `Keep it ${row.minYears} to 30 years.` }); return; }
    if (mode === 'hold' && !reason.trim()) { setError({ message: 'Say why it is on hold.' }); return; }
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`${base()}/retention/${row.dataType}`, { ...opts, method: 'PUT', body: mode === 'years' ? { keepYears: n } : { legalHold: true, holdReason: reason.trim() } });
      notify.success(mode === 'years' ? `${row.label}: kept ${n} years.` : 'On hold.');
      onDone();
    } catch (e) { setError(e); } finally { setBusy(false); }
  };
  return (
    <Drawer open onClose={onClose} widthClass={SHEET} title={mode === 'years' ? row.label : `Hold: ${row.label}`} dirty={dirty}
      footer={<><button type="button" className="ui-btn ui-btn-secondary" onClick={onClose}>Cancel</button><button type="button" className="ui-btn ui-btn-primary" disabled={busy || !dirty} onClick={save}>{busy ? 'Saving…' : mode === 'years' ? 'Save' : 'Put on hold'}</button></>}>
      <form className="ui-form-grid" onSubmit={(e) => { e.preventDefault(); save(); }}>
        {formError(error)}
        {mode === 'years' ? (
          <label className="block"><span className="ui-label">Keep (years) *</span><input className="ui-input w-full tabular-nums" inputMode="numeric" value={years} autoFocus onChange={(e) => setYears(e.target.value.replace(/\D/g, '').slice(0, 2))} aria-describedby="keep-min" /><span id="keep-min" className="ui-caption">The law asks for at least {row.minYears}.</span></label>
        ) : (
          <label className="block sm:col-span-2"><span className="ui-label">Why *</span><input className="ui-input w-full" maxLength={300} value={reason} autoFocus onChange={(e) => setReason(e.target.value)} placeholder="Labour court case, inspection notice" aria-describedby="hold-help" /><span id="hold-help" className="ui-caption">Nothing of this kind is erased while the hold stands.</span></label>
        )}
      </form>
    </Drawer>
  );
}

function DeletionReview({ canKeep, canErase }) {
  const [status, setStatus] = useState('PENDING');
  const tabsRef = useRef(null);
  const tabIndicator = useTabIndicator(tabsRef, status);
  const req = useRequest(() => apiFetch(`${base()}/deletion-review?status=${status}`, opts), [status]);
  const data = req.data;
  const [open, setOpen] = useState(null);
  const columns = [
    { key: 'label', label: 'Former employee', always: true, render: (r) => <span className="font-medium">{r.label}</span> },
    { key: 'due', label: 'Past retention since', render: (r) => <span className="tabular-nums whitespace-nowrap">{day(r.dueSince)}</span> },
    { key: 'decision', label: 'Decision', render: (r) => (r.status === 'PENDING' ? <span className="ui-muted">Waiting</span> : <span>{r.status === 'APPROVED' ? 'Erased' : 'Kept'}{r.decidedAt ? ` on ${day(r.decidedAt)}` : ''}{r.note ? <span className="block ui-caption">{r.note}</span> : null}</span>) },
  ];
  return (
    <section className="space-y-4" aria-label="Deletion review">
      <div ref={tabsRef} role="tablist" aria-label="Decision" className={`ui-record-tablist ${tabIndicator ? 'has-indicator' : ''}`}>
        {[['PENDING', 'Waiting'], ['APPROVED', 'Erased'], ['KEPT', 'Kept']].map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={status === k} className={`ui-tab ${status === k ? 'is-active' : ''}`} onClick={() => setStatus(k)}>{l}</button>)}
        {tabIndicator}
      </div>
      {data?.hold ? <ul className="ui-attention" aria-label="Needs attention"><li><span className="ui-attention-dot is-warn" aria-hidden="true" /><span>On hold: {data.hold}. Nothing is erased until the hold is lifted under Retention.</span></li></ul> : null}
      {req.error && !data ? <ErrorState error={req.error} onRetry={req.reload} /> : (
        <DataTable label="Deletion review" columns={columns} rows={data?.rows || []} loading={req.loading} refreshing={req.refreshing}
          total={data?.rows?.length || 0} pageSize={Math.max(25, data?.rows?.length || 0)} noun="people"
          onRowClick={status === 'PENDING' && (canKeep || canErase) ? (r) => setOpen(r) : null}
          card={(r) => <span className="min-w-0 flex-1"><span className="block truncate font-medium">{r.label}</span><span className="block truncate ui-caption tabular-nums">Past retention since {day(r.dueSince)}</span></span>}
          empty={<EmptyState title={status === 'PENDING' ? 'Nothing past its time' : status === 'APPROVED' ? 'Nothing erased' : 'Nothing kept'} description={status === 'PENDING' ? 'Former employees whose records are past retention wait here for a decision.' : 'Decisions made show here.'} />} />
      )}
      {open ? <ReviewDrawer row={open} hold={data?.hold} canKeep={canKeep} canErase={canErase} onClose={() => setOpen(null)} onDone={() => { setOpen(null); req.reload(); }} /> : null}
    </section>
  );
}

function ReviewDrawer({ row, hold, canKeep, canErase, onClose, onDone }) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const decide = async (decision) => {
    if (decision === 'KEEP' && !note.trim()) { setError({ message: 'Say why it is kept.' }); return; }
    if (decision === 'APPROVE' && !(await confirmDialog({ title: `Erase ${row.label}'s personal data?`, message: 'This cannot be undone.', confirmLabel: 'Erase' }))) return;
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`${base()}/deletion-review/${encodeURIComponent(row.id)}`, { ...opts, method: 'POST', body: { decision, note } });
      notify.success(decision === 'APPROVE' ? `${row.label}: personal data erased. Pay and statutory records stay for their legal period.` : 'Kept, with your reason.');
      onDone();
    } catch (e) { setError(e); } finally { setBusy(false); }
  };
  return (
    <Drawer open onClose={onClose} widthClass={SHEET} title={row.label} dirty={Boolean(note.trim())}
      footer={<>
        {canKeep ? <button type="button" className="ui-btn ui-btn-secondary" disabled={busy} onClick={() => decide('KEEP')}>Keep</button> : null}
        {canErase ? <button type="button" className="ui-btn ui-btn-danger" disabled={busy || Boolean(hold)} onClick={() => decide('APPROVE')}>Erase personal data</button> : null}
      </>}>
      <div className="space-y-4 text-sm">
        {error ? <ErrorState error={error?.status ? error : null} compact title={error?.status ? undefined : error.message} body={error?.status && error.status < 500 ? error.message : undefined} /> : null}
        <p className="ui-caption tabular-nums">Past retention since {day(row.dueSince)}.</p>
        <p>Erasing blanks the name, contacts, address, photo, notes and documents. The employee ID, dates of employment, pay, TDS, PF and attendance records stay for their legal period.</p>
        <label className="block"><span className="ui-label">Note{canKeep ? ' (needed to keep)' : ''}</span><input className="ui-input w-full" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} /></label>
      </div>
    </Drawer>
  );
}

function Auditors({ canEdit }) {
  const req = useRequest(() => Promise.all([apiFetch(`${base()}/auditor-grants`, opts).then((r) => r?.grants || []), orgUsers()]), []);
  const [grants, users] = req.data || [[], []];
  const name = (id) => { const u = users.find((x) => x.id === id); return u ? u.fullName || u.email : 'Auditor'; };
  const revoke = async (g) => {
    if (!(await confirmDialog({ title: `End ${name(g.userId)}'s access now?`, message: 'They can no longer open the documents.', confirmLabel: 'End access' }))) return;
    try {
      await apiFetch(`${base()}/auditor-grants/${encodeURIComponent(g.id)}/revoke`, { ...opts, method: 'POST', body: {} });
      notify.success('Access ended.');
      req.reload();
    } catch (e) { notify.error(String(e?.message || 'Not changed.')); }
  };
  const columns = [
    { key: 'who', label: 'Auditor', always: true, render: (g) => <span className="font-medium">{name(g.userId)}</span> },
    { key: 'for', label: 'For', render: (g) => g.purpose },
    { key: 'docs', label: 'Documents', align: 'right', render: (g) => <span className="tabular-nums">{(g.documentIds || []).length}</span> },
    { key: 'until', label: 'Until', render: (g) => <span className="tabular-nums whitespace-nowrap">{day(g.untilAt)}</span> },
    { key: 'state', label: 'State', render: (g) => (g.live ? <span className="ui-pill ui-pill-pos">Open</span> : <span className="ui-muted">{g.revokedAt ? 'Ended early' : 'Ended'}</span>) },
  ];
  return (
    <section aria-label="Auditor access">
      {req.error && !req.data ? <ErrorState error={req.error} onRetry={req.reload} /> : (
        <DataTable label="Auditor access" columns={columns} rows={grants} loading={req.loading} refreshing={req.refreshing}
          total={grants.length} pageSize={Math.max(25, grants.length)} noun="grants"
          rowActions={canEdit ? (g) => [g.live ? { key: 'end', label: 'End now', onSelect: () => revoke(g) } : null] : null}
          card={(g) => <span className="min-w-0 flex-1"><span className="flex items-center justify-between gap-2"><span className="truncate font-medium">{name(g.userId)}</span>{g.live ? <span className="ui-pill ui-pill-pos">Open</span> : null}</span><span className="block truncate ui-caption">{g.purpose} · until {day(g.untilAt)}</span></span>}
          empty={<EmptyState title="No auditor access given" description="An auditor sees only the documents named, until the end date, and every open is recorded." />} />
      )}
    </section>
  );
}

function GiveAccess({ onClose, onDone }) {
  const lists = useRequest(() => Promise.all([orgUsers(), apiFetch(`/orgs/${encodeURIComponent(orgId())}/people/documents`, opts).then((r) => r?.documents || []).catch(() => [])]), []);
  const [users, docs] = lists.data || [[], []];
  const [draft, setDraft] = useState({ userId: '', purpose: '', documentIds: [], untilAt: istDay(Date.now() + 14 * 86_400_000) });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const toggleDoc = (id) => setDraft((d) => ({ ...d, documentIds: d.documentIds.includes(id) ? d.documentIds.filter((x) => x !== id) : [...d.documentIds, id] }));
  const save = async () => {
    const problem = !draft.userId ? 'Choose the auditor.' : !draft.purpose.trim() ? 'Say what it is for.' : !draft.untilAt ? 'Choose the end date.' : !draft.documentIds.length ? 'Choose at least one document.' : null;
    if (problem) { setError({ message: problem }); return; }
    setBusy(true);
    setError(null);
    try {
      await apiFetch(`${base()}/auditor-grants`, { ...opts, method: 'POST', body: { ...draft, purpose: draft.purpose.trim(), untilAt: `${draft.untilAt}T23:59:59+05:30` } });
      notify.success('Access given. It ends on its own.');
      onDone();
    } catch (e) { setError(e); } finally { setBusy(false); }
  };
  return (
    <Drawer open onClose={onClose} widthClass={SHEET} title="Give auditor access" dirty={Boolean(draft.userId || draft.purpose || draft.documentIds.length)}
      footer={<><button type="button" className="ui-btn ui-btn-secondary" onClick={onClose}>Cancel</button><button type="button" className="ui-btn ui-btn-primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Give access'}</button></>}>
      <form className="ui-form-grid" onSubmit={(e) => { e.preventDefault(); save(); }}>
        {formError(error)}
        <div className="sm:col-span-2"><PopupSelect showValueSubtext={false} label="Auditor *" value={draft.userId} placeholder={lists.data ? 'A user with the External auditor role' : 'Loading…'} alwaysSearch={users.length > 8} onChange={(v) => setDraft({ ...draft, userId: v || '' })} options={users.map((u) => ({ value: u.id, label: u.fullName || u.email }))} /></div>
        <label className="block sm:col-span-2"><span className="ui-label">For *</span><input className="ui-input w-full" maxLength={300} value={draft.purpose} onChange={(e) => setDraft({ ...draft, purpose: e.target.value })} placeholder="Statutory audit FY 2025-26" /></label>
        <div><label className="ui-label" htmlFor="grant-until">Until *</label><DatePicker id="grant-until" min={todayIst()} max={istDay(Date.now() + 90 * 86_400_000)} value={draft.untilAt} onChange={(v) => setDraft({ ...draft, untilAt: v || '' })} /></div>
        <fieldset className="sm:col-span-2">
          <legend className="ui-label">Documents * <span className="ui-caption tabular-nums">{draft.documentIds.length} chosen</span></legend>
          {docs.length ? (
            <ul className="max-h-72 overflow-y-auto divide-y border-t">
              {docs.map((d) => <li key={d.id}><label className="flex items-center gap-2 py-2 text-sm"><input type="checkbox" className="ui-checkbox" checked={draft.documentIds.includes(d.id)} onChange={() => toggleDoc(d.id)} /><span className="min-w-0 flex-1 truncate">{d.title}</span><span className="ui-caption">{d.kind?.replaceAll('_', ' ').toLowerCase()}</span></label></li>)}
            </ul>
          ) : <p className="text-sm ui-muted">{lists.data ? 'No documents on file.' : 'Loading…'}</p>}
        </fieldset>
      </form>
    </Drawer>
  );
}
