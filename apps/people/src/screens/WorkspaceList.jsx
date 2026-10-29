import React, { useMemo, useRef, useState } from 'react';
import { Download, Plus } from '@ui/components/ui/lineIcons';
import { EmptyState, PageHeader } from '@ui/components/ui/Primitives';
import DataTable from '@ui/components/ui/DataTable';
import Drawer from '@ui/components/ui/Drawer';
import ErrorState from '@ui/components/ui/ErrorState';
import SearchField from '@ui/components/ui/SearchField';
import SuggestInput from '@ui/components/ui/SuggestInput';
import DatePicker, { formatDate } from '@ui/components/ui/DatePicker';
import PopupSelect from '@ui/components/pickers/PopupSelect';
import useRequest from '@ui/components/ui/useRequest';
import { useTabIndicator } from '@ui/components/ui/RecordTabs';
import { confirmDialog, notify } from '@ui/components/ui/notify';
import { runListExport } from '@ui/components/list/exportMenu';
import { usePermissions } from '@ui/permissions/usePermissions';
import { listAllEmployees } from '@ui/personnel/api';
import { deleteRecord, hireCandidate, listRecords, saveRecord } from '../api/workspace';
import { nextEmployeeCode } from '../workforce/api';
import OfferDrawer from '../workforce/OfferDrawer';
import { can } from '../workforce/shared';
import { WORKSPACE_CONFIG, statusLabel } from './workspaceConfig';
import { SymbolPicker, symbolOf } from './symbols';

/**
 * One register (assets, benefits, jobs, candidates, goals, training,
 * announcements, events): laid out as every Workforce list — header with the
 * one primary action, status tabs, search, the shared table, a drawer to add
 * or edit with PopupSelect and DatePicker, errors kept in the form.
 */
const POSITIVE = ['COMPLETED', 'PUBLISHED', 'ACTIVE', 'HIRED', 'RESOLVED', 'ASSIGNED', 'OPEN'];
const SHEET = 'w-[min(40rem,96vw)] ui-drawer-sheet';
const day = (v) => (v ? formatDate(String(v).slice(0, 10)) : '');
/* Without an employee, a record is company-wide: a benefit plan, an asset nobody holds. */
const NOBODY = { assets: 'Not assigned', benefits: 'Company plan' };
/* Codes and contact details are one record's own, never suggested to another. */
const NO_SUGGEST = new Set(['assetTag', 'serialNumber', 'email', 'phone', 'certificateUrl']);
const todayIst = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);

export default function WorkspaceList({ kind, openScreen, params }) {
  const cfg = WORKSPACE_CONFIG[kind];
  const noun = cfg.noun || cfg.title.toLowerCase();
  /* Offer only what the server will let this person do: the register's own
     grant (PEOPLE::<resource>::CREATE/EDIT/DELETE, as the server checks it),
     an offer letter needs Documents, and hiring makes an employee. */
  const perms = usePermissions();
  const allowed = (action) => can(perms, `PEOPLE::${cfg.resource}::${action}`);
  const canCreate = allowed('CREATE');
  const canEdit = allowed('EDIT');
  const canDelete = allowed('DELETE');
  const canOffer = can(perms, 'PEOPLE::Documents::CREATE');
  const canHire = canCreate && can(perms, 'PEOPLE::Employees::CREATE');
  const req = useRequest(() => Promise.all([
    listRecords(kind),
    cfg.employee ? listAllEmployees().then((r) => r?.employees || []) : Promise.resolve([]),
    kind === 'candidates' ? listRecords('recruitment') : Promise.resolve([]),
  ]), [kind]);
  const [rows, employees, jobs] = req.data || [[], [], []];
  /* A side-panel line can open the list on one status (?status=REPAIR). */
  const [status, setStatus] = useState(() => params?.status || 'ALL');
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState(null);
  const [hiring, setHiring] = useState(null);
  const [offering, setOffering] = useState(null);
  const tabsRef = useRef(null);
  const tabIndicator = useTabIndicator(tabsRef, status);
  const names = useMemo(() => new Map(employees.map((e) => [e.id, e.name])), [employees]);
  const detailValue = (row, key) => {
    const f = cfg.fields.find((x) => x.key === key);
    const v = row.details?.[key];
    if (key === 'jobId') return jobs.find((j) => j.id === v)?.title || '';
    if (f?.type === 'date') return day(v);
    if (f?.type === 'select') return v ? statusLabel(v) : '';
    return String(v ?? '');
  };
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows
      .filter((r) => status === 'ALL' || r.status === status)
      .filter((r) => !needle || [r.title, names.get(r.employeeId), statusLabel(r.status), ...Object.values(r.details || {})].some((v) => String(v || '').toLowerCase().includes(needle)));
  }, [rows, status, q, names]);
  const counts = Object.fromEntries(cfg.statuses.map((s) => [s, rows.filter((r) => r.status === s).length]));
  const blank = () => ({ title: '', status: cfg.statuses[0], employeeId: '', dueDate: '', details: Object.fromEntries(cfg.fields.map((f) => [f.key, f.type === 'number' ? (f.key === 'openings' ? '1' : '0') : f.type === 'select' ? f.options?.[0] || '' : ''])) });
  const remove = async (row) => {
    if (!(await confirmDialog({ title: `Delete ${row.title}?`, message: 'Only closed, cancelled, archived or draft records can be deleted. Close an active one first.', confirmLabel: 'Delete' }))) return;
    try { await deleteRecord(kind, row.id); notify.success('Deleted.'); req.reload(); } catch (e) { notify.error(String(e?.message || 'Not deleted.')); }
  };
  const exportRows = () => runListExport({
    format: 'csv', title: cfg.title, fileName: cfg.title, label: cfg.title,
    rows: shown.map((r) => ({ ...r, ...r.details, statusName: statusLabel(r.status), employeeName: names.get(r.employeeId) || '' })),
    columns: [{ key: 'title', label: 'Name' }, { key: 'statusName', label: 'Status' }, ...(cfg.employee ? [{ key: 'employeeName', label: 'Employee' }] : []), { key: 'dueDate', label: 'Due date' }, ...cfg.fields.map((f) => ({ key: f.key, label: f.label }))],
  });
  const columns = [
    { key: 'title', label: kind === 'candidates' ? 'Candidate' : 'Name', always: true, render: (r) => <span className="font-medium">{symbolOf(r.details?.symbol) ? <span className="mr-1.5" aria-hidden="true">{symbolOf(r.details.symbol).emoji}</span> : null}{r.title}</span> },
    ...(cfg.employee ? [{ key: 'employee', label: 'Employee', render: (r) => names.get(r.employeeId) || <span className="ui-muted">{NOBODY[kind] || 'Nobody'}</span> }] : []),
    ...cfg.columns.map((key) => ({ key, label: cfg.fields.find((f) => f.key === key)?.label || key, render: (r) => <span className="block max-w-[28rem] line-clamp-2" title={detailValue(r, key)}>{detailValue(r, key) || '—'}</span> })),
    { key: 'status', label: 'Status', render: (r) => <span className={`ui-pill ${POSITIVE.includes(r.status) ? 'ui-pill-pos' : 'ui-pill-neutral'}`}>{statusLabel(r.status)}</span> },
    /* A column of dashes is noise: Due date shows once any record in this list has one (owner, 29 Oct 2026). */
    ...(rows.some((r) => r.dueDate) ? [{ key: 'due', label: 'Due date', render: (r) => <span className="tabular-nums whitespace-nowrap">{day(r.dueDate) || '—'}</span> }] : []),
  ];
  const rowActions = (r) => [
    canEdit ? { key: 'edit', label: 'Edit', onSelect: () => setEditing({ ...r, details: { ...r.details } }) } : null,
    canOffer && kind === 'candidates' && !r.employeeId && ['APPLIED', 'SHORTLISTED', 'INTERVIEW', 'OFFERED'].includes(r.status) ? { key: 'offer', label: r.status === 'OFFERED' ? 'Send a new offer' : 'Send an offer', onSelect: () => setOffering(r) } : null,
    canHire && kind === 'candidates' && !r.employeeId && ['OFFERED', 'HIRED'].includes(r.status) ? { key: 'hire', label: r.details?.offerAcceptedOn ? 'Hire (offer accepted)' : 'Hire', onSelect: () => setHiring(r) } : null,
    canDelete ? { key: 'delete', label: 'Delete', onSelect: () => remove(r) } : null,
  ];

  return (
    <div className="space-y-6">
      <PageHeader breadcrumb={[{ label: 'People' }, { label: cfg.title }]} title={cfg.title}
        actions={<>
          <button type="button" className="ui-btn ui-btn-secondary" onClick={exportRows} disabled={!shown.length}><Download size={16} aria-hidden="true" /> Export</button>
          {canCreate ? <button type="button" className="ui-btn ui-btn-primary" onClick={() => setEditing(blank())} disabled={Boolean(req.error && !req.data)}><Plus size={16} aria-hidden="true" /> New {cfg.singular}</button> : null}
        </>} />
      {req.error && !req.data ? <ErrorState error={req.error} onRetry={req.reload} /> : (
        <DataTable
          tabs={(
            <div ref={tabsRef} role="tablist" aria-label={cfg.title} className={`ui-record-tablist ${tabIndicator ? 'has-indicator' : ''}`}>
              {[['ALL', 'All', rows.length], ...cfg.statuses.map((s) => [s, statusLabel(s), counts[s]])].map(([k, l, n]) => (
                <button key={k} type="button" role="tab" aria-selected={status === k} className={`ui-tab ${status === k ? 'is-active' : ''}`} onClick={() => setStatus(k)}>{l}{n ? <span className="ui-tab-count tabular-nums">{n}</span> : null}</button>
              ))}
              {tabIndicator}
            </div>
          )}
          label={cfg.title} columns={status === 'ALL' ? columns : columns.filter((c) => c.key !== 'status')} rows={shown} loading={req.loading} refreshing={req.refreshing}
          total={shown.length} pageSize={Math.max(25, shown.length)} noun={noun}
          onRowClick={(r) => setEditing({ ...r, details: { ...r.details } })} rowActions={rowActions}
          card={(r) => <span className="min-w-0 flex-1"><span className="flex items-center justify-between gap-2"><span className="truncate font-medium">{symbolOf(r.details?.symbol) ? <span className="mr-1.5" aria-hidden="true">{symbolOf(r.details.symbol).emoji}</span> : null}{r.title}</span><span className={`ui-pill ${POSITIVE.includes(r.status) ? 'ui-pill-pos' : 'ui-pill-neutral'}`}>{statusLabel(r.status)}</span></span><span className="block truncate ui-caption">{[cfg.employee ? names.get(r.employeeId) || NOBODY[kind] || 'Nobody' : null, ...cfg.columns.map((k) => detailValue(r, k))].filter(Boolean).join(' · ')}</span></span>}
          empty={q || status !== 'ALL'
            ? <EmptyState kind="filtered" title={`No ${noun} match`} description="Nothing here matches the search or the tab." />
            : <EmptyState title={`No ${noun} yet`} description={cfg.description} routes={canCreate ? [{ label: `New ${cfg.singular}`, onSelect: () => setEditing(blank()) }] : undefined} />}
          toolbar={<SearchField value={q} onSearch={setQ} placeholder={`Search ${noun}`} label={`Search ${noun}`} className="w-full sm:w-80" />} />
      )}
      {editing ? <RecordDrawer kind={kind} cfg={cfg} rows={rows} value={editing} employees={employees} jobs={jobs} onClose={() => setEditing(null)} onDone={() => { setEditing(null); req.reload(); }} /> : null}
      {hiring ? <HireDrawer row={hiring} onClose={() => setHiring(null)} onDone={() => { setHiring(null); req.reload(); openScreen?.('joiners'); }} /> : null}
      {offering ? <OfferDrawer candidate={offering} onClose={() => setOffering(null)} onSent={() => { setOffering(null); req.reload(); }} /> : null}
    </div>
  );
}

function RecordDrawer({ kind, cfg, rows, value, employees, jobs, onClose, onDone }) {
  const initial = useMemo(() => value, [value]);
  const [form, setForm] = useState(value);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);
  const setDetail = (k, v) => setForm((f) => ({ ...f, details: { ...f.details, [k]: v } }));
  const save = async () => {
    const missing = !form.title.trim() ? (kind === 'candidates' ? 'the candidate’s name' : 'a name')
      : cfg.requiredEmployee && !form.employeeId ? 'the employee'
        : cfg.fields.find((f) => f.required && !String(form.details[f.key] ?? '').trim())?.label?.toLowerCase();
    if (missing) { setError({ message: `Add ${missing}.` }); return; }
    setBusy(true);
    setError(null);
    try {
      const details = Object.fromEntries(cfg.fields.map((f) => [f.key, f.type === 'number' ? Number(form.details[f.key] || 0) : form.details[f.key] ?? '']));
      await saveRecord(kind, { ...form, title: form.title.trim(), details });
      notify.success(`${cfg.singular.replace(/^./, (c) => c.toUpperCase())} saved.`);
      onDone();
    } catch (e) { setError(e); } finally { setBusy(false); }
  };
  /* What other records of this register already say in a field, most used first. */
  const used = (key) => {
    const n = new Map();
    for (const r of rows) { const v = String(r.details?.[key] ?? '').trim(); if (v) n.set(v, (n.get(v) || 0) + 1); }
    return [...n].sort((a, b) => b[1] - a[1]).map(([v]) => v);
  };
  const fieldOf = (f) => {
    const v = form.details[f.key] ?? '';
    const id = `ws-${f.key}`;
    const label = `${f.label}${f.required ? ' *' : ''}`;
    if (f.type === 'symbol') return <SymbolPicker key={f.key} id={id} label={label} value={v} onChange={(k) => setDetail(f.key, k)} />;
    if (f.type === 'textarea') return <label key={f.key} className="block sm:col-span-2"><span className="ui-label">{label}</span><textarea id={id} className="ui-input w-full" rows={4} maxLength={10000} value={v} onChange={(e) => setDetail(f.key, e.target.value)} /></label>;
    if (f.type === 'date') return <div key={f.key}><label className="ui-label" htmlFor={id}>{label}</label><DatePicker id={id} value={v} onChange={(d) => setDetail(f.key, d || '')} /></div>;
    if (f.type === 'select') return <div key={f.key}><PopupSelect showValueSubtext={false} label={label} value={v} onChange={(s) => setDetail(f.key, s || '')} options={f.options.map((s) => ({ value: s, label: statusLabel(s) }))} /></div>;
    if (f.type === 'job') return <div key={f.key} className="sm:col-span-2"><PopupSelect showValueSubtext={false} label={label} value={v} placeholder="Choose a job…" alwaysSearch={jobs.length > 8} onChange={(s) => setDetail(f.key, s || '')} options={jobs.map((j) => ({ value: j.id, label: j.title }))} /></div>;
    if (f.type === 'number') return <label key={f.key} className="block"><span className="ui-label">{label}</span><input id={id} className="ui-input w-full tabular-nums" inputMode="decimal" value={v} onChange={(e) => setDetail(f.key, e.target.value.replace(/[^\d.]/g, ''))} /></label>;
    if (f.type === 'text' && !NO_SUGGEST.has(f.key)) return <label key={f.key} className="block"><span className="ui-label">{label}</span><SuggestInput id={id} maxLength={2000} value={v} onChange={(t) => setDetail(f.key, t)} suggestions={used(f.key)} /></label>;
    return <label key={f.key} className="block"><span className="ui-label">{label}</span><input id={id} className="ui-input w-full" type={f.type === 'email' ? 'email' : f.type === 'tel' ? 'tel' : f.type === 'url' ? 'url' : 'text'} inputMode={f.type === 'email' ? 'email' : f.type === 'tel' ? 'tel' : undefined} maxLength={2000} value={v} onChange={(e) => setDetail(f.key, e.target.value)} /></label>;
  };
  return (
    <Drawer open onClose={onClose} widthClass={SHEET} title={`${value.id ? 'Edit' : 'New'} ${cfg.singular}`} dirty={dirty}
      footer={<><button type="button" className="ui-btn ui-btn-secondary" onClick={onClose}>Cancel</button><button type="button" className="ui-btn ui-btn-primary" disabled={busy || !dirty} onClick={save}>{busy ? 'Saving…' : 'Save'}</button></>}>
      <form className="ui-form-grid" onSubmit={(e) => { e.preventDefault(); save(); }}>
        {error ? <div className="sm:col-span-2"><ErrorState error={error?.status ? error : null} compact title={error?.status ? undefined : error.message} body={error?.status && error.status < 500 ? error.message : undefined} /></div> : null}
        <label className="block sm:col-span-2"><span className="ui-label">{kind === 'candidates' ? 'Candidate name' : 'Name'} *</span><input className="ui-input w-full" maxLength={200} value={form.title} autoFocus onChange={(e) => setForm({ ...form, title: e.target.value })} /></label>
        <div><PopupSelect showValueSubtext={false} label="Status" value={form.status} onChange={(s) => setForm({ ...form, status: s || form.status })} options={cfg.statuses.map((s) => ({ value: s, label: statusLabel(s) }))} /></div>
        <div><label className="ui-label" htmlFor="ws-due">Due date</label><DatePicker id="ws-due" value={form.dueDate || ''} onChange={(d) => setForm({ ...form, dueDate: d || '' })} /></div>
        {cfg.employee ? (
          <div className="sm:col-span-2"><PopupSelect showValueSubtext={false} label={`Employee${cfg.requiredEmployee ? ' *' : ''}`} value={form.employeeId || ''} placeholder={cfg.requiredEmployee ? 'Choose…' : NOBODY[kind] || 'Nobody'} alwaysSearch
            onChange={(v) => setForm({ ...form, employeeId: v || '' })}
            options={[...(cfg.requiredEmployee ? [] : [{ value: '', label: NOBODY[kind] || 'Nobody' }]), ...employees.filter((p) => p.status !== 'LEFT' || p.id === form.employeeId).map((p) => ({ value: p.id, label: p.code ? `${p.name} (${p.code})` : p.name }))]} /></div>
        ) : null}
        {cfg.fields.map(fieldOf)}
      </form>
    </Drawer>
  );
}

/* An offered candidate becomes an employee: their joining date and, if the company sets it, their employee ID. */
function HireDrawer({ row, onClose, onDone }) {
  const [dateOfJoining, setDate] = useState(todayIst());
  /* The company's next employee ID, as on the hire form; still editable. */
  const next = useRequest(() => nextEmployeeCode().catch(() => ''), []);
  const [typed, setCode] = useState(null);
  const code = typed ?? next.data ?? '';
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const hire = async () => {
    if (!dateOfJoining) { setError({ message: 'Choose the joining date.' }); return; }
    setBusy(true);
    setError(null);
    try {
      const { employee } = await hireCandidate(row.id, { dateOfJoining, code: code.trim() || null });
      notify.success(`${employee.name} is now an employee. Their joining checklist has started.`);
      onDone();
    } catch (e) { setError(e); } finally { setBusy(false); }
  };
  return (
    <Drawer open onClose={onClose} widthClass="w-[min(36rem,96vw)] ui-drawer-sheet" title={`Hire ${row.title}`}
      footer={<><button type="button" className="ui-btn ui-btn-secondary" onClick={onClose}>Cancel</button><button type="button" className="ui-btn ui-btn-primary" disabled={busy} onClick={hire}>{busy ? 'Hiring…' : 'Hire'}</button></>}>
      <form className="ui-form-grid" onSubmit={(e) => { e.preventDefault(); hire(); }}>
        {error ? <div className="sm:col-span-2"><ErrorState error={error?.status ? error : null} compact title={error?.status ? undefined : error.message} body={error?.status && error.status < 500 ? error.message : undefined} /></div> : null}
        <div><label className="ui-label" htmlFor="hire-date">Joining date *</label><DatePicker id="hire-date" value={dateOfJoining} onChange={(v) => setDate(v || '')} /></div>
        <label className="block"><span className="ui-label">Employee ID</span><input className="ui-input w-full" maxLength={40} value={code} onChange={(e) => setCode(e.target.value)}/></label>
      </form>
    </Drawer>
  );
}
