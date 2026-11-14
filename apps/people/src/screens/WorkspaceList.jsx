import React, { useMemo, useState } from 'react';
import { Download, Plus } from '@ui/components/ui/lineIcons';
import ListHeader, { ListEmpty as EmptyState } from '@ui/components/list/ListHeader';
import DataTable from '@ui/components/ui/DataTable';
import Drawer from '@ui/components/ui/Drawer';
import ErrorState from '@ui/components/ui/ErrorState';
import SearchField from '@ui/components/ui/SearchField';
import SuggestInput from '@ui/components/ui/SuggestInput';
import DatePicker, { formatDate } from '@ui/components/ui/DatePicker';
import PopupSelect from '@ui/components/pickers/PopupSelect';
import useRequest from '@ui/components/ui/useRequest';
import { confirmDialog, notify } from '@ui/components/ui/notify';
import { runListExport } from '@ui/components/list/exportMenu';
import { usePermissions } from '@ui/permissions/usePermissions';
import { listAllEmployees } from '@ui/personnel/api';
import { deleteRecord, listRecords, saveRecord } from '../api/workspace';
import { can } from '../workforce/shared';
import { WORKSPACE_CONFIG, statusLabel, statusName } from './workspaceConfig';
import { todayIst } from '@ui/utils/dates';
import { assetTypes, eventOrder, isPast, isUpcoming } from './registerFigures';
import { AnnouncementFeed, AnnouncementSide, AssetPill, EventList, PlanCards, RegisterFigures, StatusPill } from './RegisterViews';
import { assetColumns, enrolmentColumns } from './registerColumns';
import { SymbolPicker, symbolOf } from './symbols';
import AudiencePicker, { audienceWords, useAudienceLists } from './AudiencePicker';

/**
 * One register (assets, benefits, announcements, events, HR cases): the header with the one primary action, the
 * figures, the status tabs and search, then the register's own layout (RegisterViews: asset table, benefit plan cards
 * over the enrolments, the announcement feed, the dated event list; HR cases keep the plain table), and a drawer to
 * add or edit with PopupSelect and DatePicker, errors kept in the form.
 */
const SHEET = 'w-[min(40rem,96vw)] ui-drawer-sheet';
const day = (v) => (v ? formatDate(String(v).slice(0, 10)) : '');
/* Without an employee, a record is company-wide: a benefit plan, an asset nobody holds. */
const NOBODY = { assets: 'Not assigned', benefits: 'Company plan' };
/* Codes and contact details are one record's own, never suggested to another. */
const NO_SUGGEST = new Set(['assetTag', 'serialNumber', 'email', 'phone']);
/* Events split by time, not by status: what is still to come, what is over, what was called off. */
const EVENT_TABS = ['upcoming', 'past'];

export default function WorkspaceList({ kind, params }) {
  const cfg = WORKSPACE_CONFIG[kind];
  const noun = cfg.noun || cfg.title.toLowerCase();
  const name = (s) => statusName(cfg, s);
  const today = todayIst();
  /* Offer only what the server will let this person do: the register's own
     grant (PEOPLE::<resource>::CREATE/EDIT/DELETE, as the server checks it). */
  const perms = usePermissions();
  const allowed = (action) => can(perms, `PEOPLE::${cfg.resource}::${action}`);
  const canCreate = allowed('CREATE');
  const canEdit = allowed('EDIT');
  const canDelete = allowed('DELETE');
  const req = useRequest(() => Promise.all([
    listRecords(kind),
    cfg.employee || cfg.people ? listAllEmployees().then((r) => r?.employees || []) : Promise.resolve([]),
  ]), [kind]);
  const [rows, employees] = req.data || [[], []];
  /* A side-panel line can open the list on one status (?status=REPAIR). */
  const [status, setStatus] = useState(() => params?.status || (kind === 'events' ? 'upcoming' : 'ALL'));
  const [q, setQ] = useState('');
  const [type, setType] = useState('');
  const [editing, setEditing] = useState(null);
  const people = useMemo(() => new Map(employees.map((e) => [e.id, e])), [employees]);
  const names = useMemo(() => new Map(employees.map((e) => [e.id, e.name])), [employees]);
  const working = useMemo(() => employees.filter((e) => e.status !== 'LEFT'), [employees]);
  /* An audience saved without its words (made through the API, or before the lists loaded) is named from its ids (#80 QA: "—" for Sales). */
  const hasAudience = cfg.fields.some((f) => f.type === 'audience');
  const audienceLists = useAudienceLists({ enabled: hasAudience });
  const detailValue = (row, key) => {
    const f = cfg.fields.find((x) => x.key === key);
    const v = row.details?.[key];
    if (f?.type === 'date') return day(v);
    if (f?.type === 'select') return v ? statusLabel(v) : '';
    /* Written before the audience was a choice: words only, read by everyone. */
    if (f?.type === 'audience') {
      const kind = row.details?.audienceKind;
      if (!kind || kind === 'ALL') return 'Everyone';
      return String(v || '') || audienceWords(kind, row.details.audienceIds || [], audienceLists.data?.[kind] || []).replace(/^Everyone$/, '');
    }
    return String(v ?? '');
  };
  const inTab = (r, t) => (t === 'ALL' ? true : t === 'upcoming' ? isUpcoming(r, today) : t === 'past' ? isPast(r, today) : r.status === t);
  const types = useMemo(() => (kind === 'assets' ? assetTypes(rows) : []), [kind, rows]);
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = rows
      .filter((r) => inTab(r, status))
      .filter((r) => !type || String(r.details?.category || '').trim() === type)
      .filter((r) => !needle || [r.title, names.get(r.employeeId), name(r.status), ...Object.values(r.details || {})].some((v) => String(v || '').toLowerCase().includes(needle)));
    return kind === 'events' ? eventOrder(list, today) : list;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- inTab and name read only kind, cfg and today
  }, [rows, status, q, type, names, kind, today]);
  const counts = Object.fromEntries(cfg.statuses.map((s) => [s, rows.filter((r) => r.status === s).length]));
  const tabs = kind === 'events'
    ? [{ key: 'upcoming', label: 'Upcoming', count: rows.filter((r) => isUpcoming(r, today)).length }, { key: 'past', label: 'Past', count: rows.filter((r) => isPast(r, today)).length }, ...(counts.CANCELLED || status === 'CANCELLED' ? [{ key: 'CANCELLED', label: name('CANCELLED'), count: counts.CANCELLED }] : []), { key: 'ALL', label: 'All', count: rows.length }]
    : [{ key: 'ALL', label: 'All', count: rows.length }, ...cfg.statuses.map((s) => ({ key: s, label: name(s), count: counts[s] }))];
  const blank = (preset = {}) => ({ title: '', status: cfg.statuses[0], employeeId: '', dueDate: '', ...preset, details: { ...Object.fromEntries(cfg.fields.flatMap((f) => (f.type === 'audience' ? [[f.key, 'Everyone'], ['audienceKind', 'ALL'], ['audienceIds', []]] : [[f.key, f.type === 'number' ? '0' : f.type === 'select' ? f.options?.[0] || '' : '']]))), ...(preset.details || {}) } });
  const open = (r) => setEditing({ ...r, details: { ...r.details } });
  const remove = async (row) => {
    if (!(await confirmDialog({ title: `Delete ${row.title}?`, message: 'Only closed, cancelled, archived or draft records can be deleted. Close an active one first.', confirmLabel: 'Delete' }))) return;
    try { await deleteRecord(kind, row.id); notify.success('Deleted.'); req.reload(); } catch (e) { notify.error(String(e?.message || 'Not deleted.')); }
  };
  const exportRows = () => runListExport({
    format: 'csv', title: cfg.title, fileName: cfg.title, label: cfg.title,
    rows: shown.map((r) => ({ ...r, ...r.details, statusName: name(r.status), employeeName: names.get(r.employeeId) || '' })),
    columns: [{ key: 'title', label: 'Name' }, { key: 'statusName', label: 'Status' }, ...(cfg.employee ? [{ key: 'employeeName', label: 'Employee' }] : []), { key: 'dueDate', label: 'Due date' }, ...cfg.fields.map((f) => ({ key: f.key, label: f.label }))],
  });
  const plainColumns = [
    { key: 'title', label: 'Name', always: true, render: (r) => <span className="font-medium">{symbolOf(r.details?.symbol) ? <span className="mr-1.5" aria-hidden="true">{symbolOf(r.details.symbol).emoji}</span> : null}{r.title}</span> },
    ...(cfg.employee ? [{ key: 'employee', label: 'Employee', render: (r) => names.get(r.employeeId) || <span className="ui-muted">{NOBODY[kind] || 'Nobody'}</span> }] : []),
    ...cfg.columns.map((key) => ({ key, label: cfg.fields.find((f) => f.key === key)?.label || key, render: (r) => <span className="block max-w-[28rem] line-clamp-2" title={detailValue(r, key)}>{detailValue(r, key) || '—'}</span> })),
    { key: 'status', label: 'Status', render: (r) => <StatusPill cfg={cfg} status={r.status} /> },
    /* A column of dashes is noise: Due date shows once any record in this list has one (owner, 29 Oct 2026). */
    ...(rows.some((r) => r.dueDate) ? [{ key: 'due', label: 'Due date', render: (r) => <span className="tabular-nums whitespace-nowrap">{day(r.dueDate) || '—'}</span> }] : []),
  ];
  const columns = kind === 'assets' ? assetColumns({ cfg, people, today }) : kind === 'benefits' ? enrolmentColumns({ cfg, people, today }) : plainColumns;
  const rowActions = (r) => [
    canEdit ? { key: 'edit', label: 'Edit', onSelect: () => open(r) } : null,
    canDelete ? { key: 'delete', label: 'Delete', onSelect: () => remove(r) } : null,
  ];
  const addLabel = cfg.addLabel || `New ${cfg.singular}`;
  const empty = q || type || status !== 'ALL'
    ? <EmptyState kind="filtered" title={`No ${noun} match`} description={kind === 'events' && !q && status !== 'ALL' ? 'No events here. Try another tab.' : 'Nothing here matches the search or the tab.'} />
    : <EmptyState title={`No ${noun} yet`} description={`The first ${cfg.singular} starts the list.`} routes={canCreate ? [{ label: addLabel, onSelect: () => setEditing(blank()) }] : undefined} />;
  const failed = req.error && !req.data;
  const table = (list, extra = {}) => (
    <DataTable
      label={cfg.title} columns={status === 'ALL' || extra.keepStatus ? columns : columns.filter((c) => c.key !== 'status')} rows={list} loading={req.loading} refreshing={req.refreshing}
      total={list.length} pageSize={Math.max(25, list.length)} noun={extra.noun || noun}
      onRowClick={open} rowActions={rowActions}
      card={(r) => <span className="min-w-0 flex-1"><span className="flex items-center justify-between gap-2"><span className="truncate font-medium">{symbolOf(r.details?.symbol) ? <span className="mr-1.5" aria-hidden="true">{symbolOf(r.details.symbol).emoji}</span> : null}{kind === 'benefits' ? names.get(r.employeeId) || r.title : r.title}</span>{kind === 'assets' ? <AssetPill cfg={cfg} row={r} holder={people.get(r.employeeId)} today={today} /> : <StatusPill cfg={cfg} status={r.status} />}</span><span className="block truncate ui-caption">{kind === 'assets' ? [r.details?.assetTag, r.details?.category, names.get(r.employeeId) || NOBODY.assets].filter(Boolean).join(' · ') : kind === 'benefits' ? [r.title, r.details?.coverage, day(r.details?.startDate)].filter(Boolean).join(' · ') : [cfg.employee ? names.get(r.employeeId) || NOBODY[kind] || 'Nobody' : null, ...cfg.columns.map((k) => detailValue(r, k))].filter(Boolean).join(' · ')}</span></span>}
      empty={extra.empty || empty} />
  );
  let body;
  if (failed) body = <ErrorState error={req.error} onRetry={req.reload} />;
  else if (kind === 'announcements') {
    const audienceOf = (r) => detailValue(r, 'audience');
    body = (
      <div className="rg-feed-wrap">
        <AnnouncementFeed cfg={cfg} rows={shown} working={working} today={today} audienceOf={audienceOf} onOpen={open} menuOf={rowActions} loading={req.loading} empty={empty} />
        <AnnouncementSide rows={rows} working={working} audienceOf={audienceOf} onOpen={open} canEdit={canEdit} />
      </div>
    );
  } else if (kind === 'events') body = <EventList cfg={cfg} rows={shown} today={today} onOpen={open} menuOf={rowActions} loading={req.loading} empty={empty} />;
  else if (kind === 'benefits') {
    const plans = shown.filter((r) => !r.employeeId);
    const enrolments = shown.filter((r) => r.employeeId);
    body = (
      <>
        <PlanCards cfg={cfg} plans={plans} rows={rows} working={working} today={today} onManage={open}
          onEnrol={canCreate ? (plan) => setEditing(blank({ title: plan.title, status: 'ACTIVE', details: { provider: plan.details?.provider || '', endDate: plan.details?.endDate || '' } })) : null} />
        {plans.length && !enrolments.length && !req.loading ? null : (
          <section className="rg-section" aria-labelledby="rg-enrolments">
            {plans.length ? <h2 id="rg-enrolments" className="rg-h2">Enrolments</h2> : null}
            {table(enrolments, { keepStatus: true, noun: 'enrolments', empty: plans.length ? <EmptyState kind="filtered" title="No enrolments here" description="Use Enrol on a plan to add someone." /> : empty })}
          </section>
        )}
      </>
    );
  } else body = table(shown, { keepStatus: kind === 'assets' });

  return (
    <div className="space-y-6">
      <ListHeader
        title={cfg.title}
        description={cfg.description}
        secondary={<button type="button" className="ui-btn ui-btn-secondary" onClick={exportRows} disabled={!shown.length}><Download size={16} aria-hidden="true" /> Export</button>}
        primary={canCreate ? { label: addLabel, icon: Plus, onClick: () => setEditing(blank()), disabled: Boolean(failed) } : null}
        strip={failed ? null : <RegisterFigures kind={kind} cfg={cfg} rows={rows} people={people} working={working} today={today} onTab={setStatus} />}
        toolbar={<>
          <SearchField value={q} onSearch={setQ} placeholder={cfg.search || `Search ${noun}`} label={`Search ${noun}`} className="w-full sm:w-80" />
          {types.length > 1 ? <div className="w-full sm:w-48"><PopupSelect showValueSubtext={false} ariaLabel="Asset type" placeholder="Every type" value={type} onChange={(v) => setType(v || '')} options={[{ value: '', label: 'Every type' }, ...types.map((t) => ({ value: t, label: t }))]} /></div> : null}
        </>}
        tabs={tabs}
        tab={EVENT_TABS.includes(status) || status === 'ALL' || cfg.statuses.includes(status) ? status : 'ALL'}
        onTab={setStatus}
      />
      {body}
      {editing ? <RecordDrawer kind={kind} cfg={cfg} rows={rows} value={editing} employees={employees} onClose={() => setEditing(null)} onDone={() => { setEditing(null); req.reload(); }} /> : null}
    </div>
  );
}

function RecordDrawer({ kind, cfg, rows, value, employees, onClose, onDone }) {
  const initial = useMemo(() => value, [value]);
  const [form, setForm] = useState(value);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);
  const setDetail = (k, v) => setForm((f) => ({ ...f, details: { ...f.details, [k]: v } }));
  const save = async () => {
    const missing = !form.title.trim() ? 'a name'
      : cfg.requiredEmployee && !form.employeeId ? 'the employee'
        : cfg.fields.find((f) => f.required && !String(form.details[f.key] ?? '').trim())?.label?.toLowerCase();
    if (missing) { setError({ message: `Add ${missing}.` }); return; }
    setBusy(true);
    setError(null);
    try {
      const details = Object.fromEntries(cfg.fields.flatMap((f) => (f.type === 'audience'
        ? [[f.key, form.details[f.key] || 'Everyone'], ['audienceKind', form.details.audienceKind || 'ALL'], ['audienceIds', form.details.audienceKind && form.details.audienceKind !== 'ALL' ? form.details.audienceIds || [] : []]]
        : [[f.key, f.type === 'number' ? Number(form.details[f.key] || 0) : form.details[f.key] ?? '']])));
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
    if (f.type === 'audience') return <AudiencePicker key={f.key} kind={form.details.audienceKind || 'ALL'} ids={form.details.audienceIds || []} onChange={(patch) => setForm((x) => ({ ...x, details: { ...x.details, ...patch } }))} />;
    if (f.type === 'symbol') return <SymbolPicker key={f.key} id={id} label={label} value={v} onChange={(k) => setDetail(f.key, k)} />;
    if (f.type === 'textarea') return <label key={f.key} className="block sm:col-span-2"><span className="ui-label">{label}</span><textarea id={id} className="ui-input w-full" rows={4} maxLength={10000} value={v} onChange={(e) => setDetail(f.key, e.target.value)} /></label>;
    if (f.type === 'date') return <div key={f.key}><label className="ui-label" htmlFor={id}>{label}</label><DatePicker id={id} value={v} onChange={(d) => setDetail(f.key, d || '')} /></div>;
    if (f.type === 'select') return <div key={f.key}><PopupSelect showValueSubtext={false} label={label} value={v} onChange={(s) => setDetail(f.key, s || '')} options={f.options.map((s) => ({ value: s, label: statusLabel(s) }))} /></div>;
    if (f.type === 'number') return <label key={f.key} className="block"><span className="ui-label">{label}</span><input id={id} className="ui-input w-full tabular-nums" inputMode="decimal" value={v} onChange={(e) => setDetail(f.key, e.target.value.replace(/[^\d.]/g, ''))} /></label>;
    if (f.type === 'text' && !NO_SUGGEST.has(f.key)) return <label key={f.key} className="block"><span className="ui-label">{label}</span><SuggestInput id={id} maxLength={2000} value={v} onChange={(t) => setDetail(f.key, t)} suggestions={used(f.key)} /></label>;
    return <label key={f.key} className="block"><span className="ui-label">{label}</span><input id={id} className="ui-input w-full" type={f.type === 'email' ? 'email' : f.type === 'tel' ? 'tel' : f.type === 'url' ? 'url' : 'text'} inputMode={f.type === 'email' ? 'email' : f.type === 'tel' ? 'tel' : undefined} maxLength={2000} value={v} onChange={(e) => setDetail(f.key, e.target.value)} /></label>;
  };
  return (
    <Drawer open onClose={onClose} widthClass={SHEET} title={`${value.id ? 'Edit' : 'New'} ${cfg.singular}`} dirty={dirty}
      footer={<><button type="button" className="ui-btn ui-btn-secondary" onClick={onClose}>Cancel</button><button type="button" className="ui-btn ui-btn-primary" disabled={busy || !dirty} onClick={save}>{busy ? 'Saving…' : 'Save'}</button></>}>
      <form className="ui-form-grid" onSubmit={(e) => { e.preventDefault(); save(); }}>
        {error ? <div className="sm:col-span-2"><ErrorState error={error?.status ? error : null} compact title={error?.status ? undefined : error.message} body={error?.status && error.status < 500 ? error.message : undefined} /></div> : null}
        <label className="block sm:col-span-2"><span className="ui-label">Name *</span><input className="ui-input w-full" maxLength={200} value={form.title} autoFocus onChange={(e) => setForm({ ...form, title: e.target.value })} /></label>
        <div><PopupSelect showValueSubtext={false} label="Status" value={form.status} onChange={(s) => setForm({ ...form, status: s || form.status })} options={cfg.statuses.map((s) => ({ value: s, label: statusName(cfg, s) }))} /></div>
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
