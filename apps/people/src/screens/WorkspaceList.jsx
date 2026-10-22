import React, { useCallback, useEffect, useId, useMemo, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { ColumnHeader, useColumnFilters } from '@ui/components/ColumnFilters';
import { useListSearch } from '@ui/components/ListToolbar';
import DocumentListShell from '@ui/components/list/DocumentListShell';
import { Pagination, usePaged, useResetPage } from '@ui/components/list/ListPageParts';
import { exportFormatFromKey, exportMenuItem, runListExport } from '@ui/components/list/exportMenu';
import { EmptyState, SkeletonCard } from '@ui/components/ui/Primitives';
import Drawer from '@ui/components/ui/Drawer';
import { confirmDialog, notify } from '@ui/components/ui/notify';
import { listEmployees } from '@ui/personnel/api';
import { deleteRecord, listRecords, saveRecord } from '../api/workspace';
import { WORKSPACE_CONFIG, statusLabel } from './workspaceConfig';

export default function WorkspaceList({ kind }) {
  const cfg = WORKSPACE_CONFIG[kind];
  const formId = useId();
  const [rows, setRows] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(null);
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(25);
  const load = useCallback(async () => {
    try {
      const [records, people, vacancies] = await Promise.all([listRecords(kind), cfg.employee ? listEmployees() : null, kind === 'candidates' ? listRecords('recruitment') : null]);
      setRows(records); setEmployees(people?.employees || []); setJobs(vacancies || []); setError('');
    } catch (e) { setError(e.message || 'Could not load this module.'); }
    finally { setLoading(false); }
  }, [kind, cfg.employee]);
  useEffect(() => { load(); }, [load]);
  const names = useMemo(() => new Map(employees.map((e) => [e.id, e.name])), [employees]);
  const all = useMemo(() => rows.map((r) => ({ ...r, employeeName: names.get(r.employeeId) || '', statusName: statusLabel(r.status), searchText: Object.values(r.details).join(' ') })), [rows, names]);
  const inTab = useMemo(() => all.filter((r) => !status || r.status === status), [all, status]);
  const search = useListSearch(inTab, ['title', 'employeeName', 'statusName', 'searchText']);
  const columns = useColumnFilters();
  const shown = columns.applyFilters(search.filtered, { title: (r) => r.title, employee: (r) => r.employeeName, dueDate: (r) => r.dueDate || '', status: (r) => r.statusName, ...Object.fromEntries(cfg.columns.map((key) => [key, (r) => String(r.details[key] ?? '')])) });
  useResetPage(setPage, [status, search.query, columns.filters, perPage]);
  const { pageRows, safePage, pageCount } = usePaged(shown, perPage, page);
  const open = (row) => { setEditing(row); setFormError(''); };
  const newRow = () => open({ title: '', status: cfg.statuses[0], employeeId: '', dueDate: '', details: Object.fromEntries(cfg.fields.map((f) => [f.key, f.type === 'number' ? (f.key === 'openings' ? 1 : 0) : f.options?.[0] || ''])) });
  const save = async (e) => {
    e.preventDefault(); setSaving(true); setFormError('');
    try { await saveRecord(kind, editing); setEditing(null); notify.success(`${cfg.singular} saved.`); await load(); }
    catch (err) { setFormError(err.message || 'Could not save.'); }
    finally { setSaving(false); }
  };
  const remove = async (row) => {
    if (!(await confirmDialog({ title: `Delete ${row.title}?`, message: 'Only closed, cancelled, archived, or draft records can be deleted. Active records should be closed first.', confirmLabel: 'Delete' }))) return;
    try { await deleteRecord(kind, row.id); notify.success('Record deleted.'); await load(); } catch (e) { notify.error(e.message); }
  };
  if (loading) return <SkeletonCard lines={6} />;
  const tabs = [{ value: '', label: 'All', tone: 'all' }, ...cfg.statuses.map((s) => ({ value: s, label: statusLabel(s), tone: ['COMPLETED', 'PUBLISHED', 'ACTIVE', 'HIRED', 'RESOLVED'].includes(s) ? 'paid' : 'draft' }))];
  const counts = Object.fromEntries(tabs.map((t) => [t.value, t.value ? rows.filter((r) => r.status === t.value).length : rows.length]));
  const detailValue = (row, key) => key === 'jobId' ? jobs.find((j) => j.id === row.details.jobId)?.title || '—' : String(row.details[key] ?? '') || '—';
  return <DocumentListShell title={cfg.title} entity="people" description={cfg.description} tight phoneCompact
    search={{ value: search.query, onChange: search.setQuery, placeholder: `Search ${(cfg.noun || cfg.title.toLowerCase())}…` }}
    primary={<button type="button" className="ui-btn ui-btn-primary" onClick={newRow} disabled={Boolean(error)}><Plus size={16} /> New {cfg.singular}</button>}
    tabs={tabs} statusValue={status} statusCounts={counts} onStatusChange={setStatus}
    moreItems={[exportMenuItem(`Export ${(cfg.noun || cfg.title.toLowerCase())}`)]} onMoreSelect={(key) => {
      const format = exportFormatFromKey(key);
      if (format) runListExport({ format, title: cfg.title, fileName: cfg.title, label: cfg.title, rows: shown.map((r) => ({ ...r, ...r.details })), columns: [{ key: 'title', label: 'Name' }, { key: 'statusName', label: 'Status' }, ...(cfg.employee ? [{ key: 'employeeName', label: 'Employee' }] : []), { key: 'dueDate', label: 'Due date' }, ...cfg.fields.map((f) => ({ key: f.key, label: f.label }))] });
    }}>
    {error ? <div className="p-4" role="alert"><p>{error}</p><button className="ui-btn mt-3" onClick={load}>Retry</button></div> : <>
      <div className="ui-table-scroll"><table className="ui-table ui-table-sticky w-full"><thead><tr>
        <ColumnHeader label="Name" col="title" state={columns} />
        {cfg.employee && <ColumnHeader label="Employee" col="employee" state={columns} />}
        {cfg.columns.map((key) => <ColumnHeader key={key} label={cfg.fields.find((f) => f.key === key)?.label || key} col={key} state={columns} />)}
        <ColumnHeader label="Status" col="status" state={columns} />
        <ColumnHeader label="Due date" col="dueDate" state={columns} />
        <th scope="col">Updated</th><th scope="col"><span className="sr-only">Actions</span></th>
      </tr></thead><tbody className="ui-rows">{pageRows.map((r) => <tr key={r.id}>
        <td className="ui-col-entity"><button className="ui-link text-left" onClick={() => open({ ...r, details: { ...r.details } })}>{r.title}</button></td>
        {cfg.employee && <td>{r.employeeName || 'Company plan'}</td>}
        {cfg.columns.map((key) => <td key={key} className="max-w-60 truncate" title={detailValue(r, key)}>{detailValue(r, key)}</td>)}
        <td><span className="ui-pill ui-pill-neutral">{r.statusName}</span></td><td>{r.dueDate || '—'}</td><td>{r.updatedAt.slice(0, 10)}</td>
        <td><button className="ui-icon-btn" aria-label={`Delete ${r.title}`} onClick={() => remove(r)}><Trash2 size={16} /></button></td>
      </tr>)}{!shown.length && <tr><td colSpan={(cfg.employee ? 6 : 5) + cfg.columns.length}><EmptyState title={rows.length ? 'No matching records' : `No ${(cfg.noun || cfg.title.toLowerCase())} yet`} description={rows.length ? 'Change the search or filters to see more records.' : cfg.description} routes={!rows.length ? [{ label: `New ${cfg.singular}`, onSelect: newRow }] : undefined} /></td></tr>}</tbody></table></div>
      <Pagination total={shown.length} page={safePage} perPage={perPage} pageCount={pageCount} onPage={setPage} onPerPage={setPerPage} />
    </>}
    <Drawer open={Boolean(editing)} onClose={() => { if (!saving) setEditing(null); }} title={`${editing?.id ? 'Edit' : 'New'} ${cfg.singular}`} widthClass="w-[min(40rem,96vw)]" actions={<><button type="button" className="ui-btn" disabled={saving} onClick={() => setEditing(null)}>Cancel</button><button type="submit" form={formId} className="ui-btn ui-btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button></>}>
      {editing && <form id={formId} className="space-y-4" onSubmit={save}>
        <label className="block"><span className="ui-label">{kind === 'candidates' ? 'Candidate name' : 'Name'} *</span><input className="ui-input w-full" required maxLength={200} value={editing.title} onChange={(e) => setEditing({ ...editing, title: e.target.value })} /></label>
        <label className="block"><span className="ui-label">Status</span><select className="ui-select w-full" value={editing.status} onChange={(e) => setEditing({ ...editing, status: e.target.value })}>{cfg.statuses.map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}</select></label>
        {cfg.employee && <label className="block"><span className="ui-label">Employee{cfg.requiredEmployee ? ' *' : ''}</span><select className="ui-select w-full" required={cfg.requiredEmployee} value={editing.employeeId || ''} onChange={(e) => setEditing({ ...editing, employeeId: e.target.value })}><option value="">{cfg.requiredEmployee ? 'Select employee' : 'No employee / company plan'}</option>{employees.map((p) => <option key={p.id} value={p.id}>{p.name}{p.code ? ` (${p.code})` : ''}</option>)}</select></label>}
        <label className="block"><span className="ui-label">Due date</span><input className="ui-input w-full" type="date" value={editing.dueDate || ''} onChange={(e) => setEditing({ ...editing, dueDate: e.target.value })} /></label>
        {cfg.fields.map((f) => { const change = (e) => setEditing({ ...editing, details: { ...editing.details, [f.key]: e.target.value } }); const common = { required: f.required, value: editing.details[f.key] ?? '', onChange: change }; return <label className="block" key={f.key}><span className="ui-label">{f.label}{f.required ? ' *' : ''}</span>{f.type === 'textarea' ? <textarea className="ui-input w-full min-h-28" rows={4} maxLength={10000} {...common} /> : ['select', 'job'].includes(f.type) ? <select className="ui-select w-full" {...common}>{f.type === 'job' ? <><option value="">Select job</option>{jobs.map((j) => <option key={j.id} value={j.id}>{j.title}</option>)}</> : f.options.map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}</select> : <input className="ui-input w-full" type={f.type} min={f.type === 'number' ? (f.key === 'openings' ? 1 : 0) : undefined} max={f.key === 'progress' ? 100 : undefined} step={f.key === 'hours' ? '0.25' : undefined} maxLength={2000} {...common} />}</label>; })}
        {formError && <p role="alert" className="text-sm" style={{ color: 'rgb(var(--neg))' }}>{formError}</p>}

      </form>}
    </Drawer>
  </DocumentListShell>;
}
