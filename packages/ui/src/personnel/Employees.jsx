import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FileDown, LayoutGrid, List, MoreHorizontal, Plus, Trash2, Upload, UserMinus, UserPlus, UserRound, Users } from '@ui/components/ui/lineIcons';

import { SkeletonCard, EmptyState } from '@ui/components/ui/Primitives';
import DocumentListShell from '@ui/components/list/DocumentListShell';
import { exportFormatFromKey, exportMenuItem, runListExport } from '@ui/components/list/exportMenu';
import Drawer from '@ui/components/ui/Drawer';
import Popover from '@ui/components/ui/Popover';
import PopupSelect from '@ui/components/pickers/PopupSelect';
import DatePicker from '@ui/components/ui/DatePicker';
import { confirmDialog, notify } from '@ui/components/ui/notify';
import { DOC_WHO_CAN_SEE, docWhoLabel } from './documentClassification';
import JoiningStatutory from './JoiningStatutory';
import { downloadCsvTemplate, parseCsv, readFileText } from '@ui/utils/csv';
import { formatDateIn } from '@ui/utils/dates';
import { hasApp } from '@platform/context';
import { usePermissions } from '@ui/permissions/usePermissions';
import {
  CHECKLIST_OWNER,
  LEAVING_TYPES,
  addNote,
  createEmployee,
  deleteEmployee,
  deleteNote,
  getEmployee,
  importEmployees,
  undoImport,
  listEmployees,
  bulkUpdateEmployees,
  listSavedViews,
  saveSavedView,
  deleteSavedView,
  listNotes,
  listDocuments,
  uploadDocument,
  getDocument,
  getLetterTemplates,
  issueLetter,
  listDocumentVersions,
  replaceDocument,
  requestLetter,
  serviceCertificateDue,
  deleteDocument,
  listStructure,
  listTags,
  listContractors,
  checkInvite,
  createInvite,
  getChangeImpact,
  getCustomValues,
  saveCustomValues,
  getJourney,
  getWhy,
  getSalaryQuestion,
  raiseFromWhy,
  listEmployeeInvites,
  getChecklist,
  getEmployeeStatutory,
  revealStatutory,
  saveIdentity,
  getEmploymentHistory,
  decideProbation,
  getEmploymentEpisodes,
  cancelScheduledChange,
  startChecklist,
  updateChecklistTask,
  rehireEmployee,
  resignEmployee,
  updateEmployee,
} from './api';
import { TaskDrawer } from '../lifecycle/shared';

/**
 * The staff directory, after Horilla's employee view: cards or a list, a
 * search, filters by department, position, type, status and tag, and a file
 * per person (About, Work, Notes) that opens beside the list.
 */

const STATUSES = [
  { id: 'ACTIVE', label: 'Active', pill: 'ui-pill-pos' },
  { id: 'ON_NOTICE', label: 'On notice', pill: 'ui-pill-warn' },
  { id: 'SUSPENDED', label: 'Suspended', pill: 'ui-pill-neg' },
  { id: 'LEFT', label: 'Left', pill: 'ui-pill-neutral' },
];
const statusOf = (id) => STATUSES.find((s) => s.id === id) || STATUSES[0];
const TABS = [
  { value: 'ACTIVE', label: 'Active', tone: 'paid' },
  { value: 'ON_NOTICE', label: 'On notice', tone: 'partial' },
  { value: 'SUSPENDED', label: 'Suspended', tone: 'overdue' },
  { value: 'LEFT', label: 'Left', tone: 'cancelled' },
  { value: '', label: 'All', tone: 'all' },
];
const daysAgo = (n) => new Date(Date.now() + 330 * 60_000 - n * 86_400_000).toISOString().slice(0, 10);

const initials = (name) =>
  String(name || '?')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('');

/* "2 Nov 2026" from an ISO day. */
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const formatDateShort = (d) => { const [y, m, dd] = String(d).slice(0, 10).split('-'); return y && m && dd ? `${Number(dd)} ${MONTHS_SHORT[Number(m) - 1]} ${y}` : String(d); };

export const Avatar = ({ person, size = 40 }) =>
  person?.photoUrl ? (
    <img src={person.photoUrl} alt="" className="shrink-0 rounded-full object-cover" style={{ width: size, height: size }} />
  ) : (
    <span
      className="ui-avatar-initials inline-grid shrink-0 place-items-center rounded-full font-semibold"
      style={{ width: size, height: size, fontSize: Math.max(12, size * 0.38), backgroundColor: 'rgb(var(--brand-soft))', color: 'rgb(var(--brand-ink))' }}
      aria-hidden="true"
      /* Drawn, not text: the initials are a picture of the person, so they never become part of a button's name. */
      data-initials={initials(person?.name)}
      /* A wash picked from the name; only palettes that opt in draw it (People's Sky). */
      data-hue={[...String(person?.name || '')].reduce((n, c) => (n * 31 + c.charCodeAt(0)) % 9973, 0) % 5}
    />
  );

const EXPORT_COLUMNS = [
  { key: 'code', label: 'Employee ID' },
  { key: 'name', label: 'Name' },
  { key: 'email', label: 'Email' },
  { key: 'workEmail', label: 'Work email' },
  { key: 'phone', label: 'Phone' },
  { key: 'department', label: 'Department' },
  { key: 'designation', label: 'Job position' },
  { key: 'reportingManagerName', label: 'Reports to' },
  { key: 'dateOfJoining', label: 'Joined' },
  { key: 'status', label: 'Status', value: (r) => statusOf(r.status).label },
];

export const IMPORT_COLUMNS = [
  { key: 'name', label: 'name' },
  { key: 'code', label: 'code' },
  { key: 'email', label: 'email' },
  { key: 'workEmail', label: 'workEmail' },
  { key: 'phone', label: 'phone' },
  { key: 'department', label: 'department' },
  { key: 'jobPosition', label: 'jobPosition' },
  { key: 'employeeType', label: 'employeeType' },
  { key: 'workType', label: 'workType' },
  { key: 'dateOfJoining', label: 'dateOfJoining' },
  { key: 'dateOfBirth', label: 'dateOfBirth' },
  { key: 'gender', label: 'gender' },
];

export default function Employees({ description = '' } = {}) {
  const [all, setAll] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [view, setView] = useState(() => {
    try {
      return localStorage.getItem('people.view') || 'cards';
    } catch {
      return 'cards';
    }
  });
  /* Status is a tab, counted on the client; the rest are asked of the server. */
  const [status, setStatus] = useState('ACTIVE');
  const [filters, setFilters] = useState({ q: '', departmentId: '', jobPositionId: '', employeeTypeId: '', tagId: '' });
  const [lists, setLists] = useState({ departments: [], positions: [], roles: [], types: [], workTypes: [], tags: [], areas: [], contractors: [], units: [], grades: [], centres: [], establishments: [], teams: [], seats: [] });
  const [openId, setOpenId] = useState(null);
  const [editing, setEditing] = useState(null);
  const fileRef = useRef(null);
  const perms = usePermissions();
  const canEdit = Boolean(perms?.isAdmin || perms?.permissions?.has?.('PEOPLE::Employees::EDIT'));
  /* CORE-01: bulk select in the list view, and saved views (own or shared). */
  const [selected, setSelected] = useState(() => new Set());
  const [bulk, setBulk] = useState(null);
  const [views, setViews] = useState([]);
  const [viewId, setViewId] = useState('');
  const [savingView, setSavingView] = useState(null);
  const loadViews = useCallback(() => listSavedViews('employees').then(setViews).catch(() => setViews([])), []);
  useEffect(() => { loadViews(); }, [loadViews]);

  const loadLists = useCallback(async () => {
    const withAttendance = hasApp('attendance');
    const [departments, positions, roles, types, workTypes, tags, areas, contractors, units, grades, centres, establishments, teams, seats] = await Promise.all([
      listStructure('departments'),
      listStructure('job-positions'),
      listStructure('job-roles'),
      listStructure('employee-types'),
      listStructure('work-types'),
      listTags(),
      listStructure('areas').catch(() => []),
      withAttendance ? listContractors() : [],
      listStructure('business-units').catch(() => []),
      listStructure('grades').catch(() => []),
      listStructure('cost-centres').catch(() => []),
      listStructure('establishments').catch(() => []),
      listStructure('teams').catch(() => []),
      listStructure('seats').catch(() => []),
    ]);
    setLists({ departments, positions, roles, types, workTypes, tags, areas, contractors, units, grades, centres, establishments, teams, seats });
  }, []);

  /* Each load takes a number; an answer for an older filter that arrives late is dropped, so it cannot replace the newer list. */
  const loadSeq = useRef(0);
  const load = useCallback(async () => {
    const seq = ++loadSeq.current;
    try {
      /* Everyone, 500 a page, until the server's total is reached (CORE-01: no 500 cap). */
      const first = await listEmployees({ ...filters, status: '', limit: 500, offset: 0 });
      const rows = [...(first?.employees || [])];
      const total = Number(first?.total || rows.length);
      while (rows.length < total) {
        if (seq !== loadSeq.current) return;
        const more = await listEmployees({ ...filters, status: '', limit: 500, offset: rows.length });
        if (!more?.employees?.length) break;
        rows.push(...more.employees);
      }
      if (seq !== loadSeq.current) return;
      setAll(rows);
      setError('');
    } catch (e) {
      if (seq !== loadSeq.current) return;
      setError(String(e?.message || 'Could not load employees.'));
    } finally {
      if (seq === loadSeq.current) setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    loadLists().catch(() => {});
  }, [loadLists]);
  useEffect(() => {
    const t = setTimeout(load, 200);
    return () => clearTimeout(t);
  }, [load]);

  const setViewMode = (v) => {
    setView(v);
    try {
      localStorage.setItem('people.view', v);
    } catch {
      /* the choice just will not stick */
    }
  };

  /* Import (CORE-07): the file is read here; mapping, preview and undo happen in the import drawer. */
  const [importing, setImporting] = useState(null);
  const onImport = async (file) => {
    if (!file) return;
    try {
      /* parseCsv returns { headers, rows } with rows keyed by header; the drawer maps columns, so rows go back to arrays. */
      const parsed = parseCsv(await readFileText(file));
      const keys = (parsed.headers || []).map((h) => String(h || '').trim());
      const rows = (parsed.rows || []).map((o) => keys.map((h) => o[h] ?? '')).filter((r) => r.some((c) => String(c || '').trim()));
      if (!rows.length) return notify.error('That file has no rows under its header.');
      setImporting({ name: file.name, headers: keys, rows });
    } catch (e) {
      notify.error(String(e?.message || 'Could not read the file.'));
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const filterSelect = (key, label, options) => (
    <select
      className="ui-select ui-ctl-compact"
      style={{ width: 'auto', minWidth: '9rem' }}
      aria-label={label}
      value={filters[key]}
      onChange={(e) => setFilters((f) => ({ ...f, [key]: e.target.value }))}
    >
      <option value="">{label}: all</option>
      {options.map((o) => (
        <option key={o.id} value={o.id}>{o.name || o.label}</option>
      ))}
    </select>
  );

  const counts = useMemo(() => {
    const c = { '': all.length };
    for (const p of all) c[p.status] = (c[p.status] || 0) + 1;
    return c;
  }, [all]);
  const rows = useMemo(() => all.filter((p) => !status || p.status === status), [all, status]);
  const toggle = (id) => setSelected((cur) => { const next = new Set(cur); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const allChosen = rows.length > 0 && rows.every((p) => selected.has(p.id));
  const chooseAll = () => setSelected(allChosen ? new Set() : new Set(rows.map((p) => p.id)));
  const applyView = (id) => {
    setViewId(id);
    const v = views.find((x) => x.id === id);
    if (!v) return;
    const f = v.filters || {};
    setFilters({ q: f.q || '', departmentId: f.departmentId || '', jobPositionId: f.jobPositionId || '', employeeTypeId: f.employeeTypeId || '', tagId: f.tagId || '' });
    setStatus(f.status ?? 'ACTIVE');
  };
  const removeView = async () => {
    const v = views.find((x) => x.id === viewId);
    if (!v || !(await confirmDialog({ title: `Delete the view "${v.name}"?`, confirmLabel: 'Delete', tone: 'danger' }))) return;
    try {
      await deleteSavedView(v.id);
      setViewId('');
      loadViews();
    } catch (e) {
      notify.error(String(e?.message || 'Not deleted.'));
    }
  };
  const figures = useMemo(() => {
    const here = all.filter((p) => p.status !== 'LEFT');
    return {
      headcount: here.length,
      joined: here.filter((p) => p.dateOfJoining && String(p.dateOfJoining).slice(0, 10) >= daysAgo(30)).length,
      notice: counts.ON_NOTICE || 0,
      unplaced: here.filter((p) => !p.department).length,
    };
  }, [all, counts]);
  const importTemplate = () =>
    downloadCsvTemplate({ fileName: 'Employees import template', columns: IMPORT_COLUMNS, sample: { name: 'Asha Rao', code: 'E-001', department: 'Finance', jobPosition: 'Accountant', dateOfJoining: '2026-04-01', gender: 'FEMALE' } });

  if (loading) return <SkeletonCard lines={6} />;

  return (
    <DocumentListShell
      entity="people"
      title="Employees"
      description={description}
      compact
      tight
      denseCards
      surface={view === 'cards' ? 'plain' : 'card'}
      search={{ value: filters.q, onChange: (q) => setFilters((f) => ({ ...f, q })), placeholder: 'Search name, ID, email, phone…', label: 'Search employees' }}
      headerExtras={
        <div className="inline-flex rounded-lg border" style={{ borderColor: 'rgb(var(--border))' }} role="group" aria-label="View">
          <button type="button" className="ui-icon-btn" aria-pressed={view === 'cards'} aria-label="Cards" onClick={() => setViewMode('cards')}>
            <LayoutGrid size={16} />
          </button>
          <button type="button" className="ui-icon-btn" aria-pressed={view === 'list'} aria-label="List" onClick={() => setViewMode('list')}>
            <List size={16} />
          </button>
        </div>
      }
      moreItems={[
        exportMenuItem('Export employees'),
        { key: 'import', label: 'Import from a spreadsheet', Icon: Upload },
        { key: 'template', label: 'Download the import template', Icon: FileDown },
      ]}
      onMoreSelect={(k) => {
        if (k === 'import') return fileRef.current?.click();
        if (k === 'template') return importTemplate();
        const format = exportFormatFromKey(k);
        if (format) runListExport({ format, title: 'Employees', fileName: 'Employees', label: 'person/people', columns: EXPORT_COLUMNS, rows });
      }}
      primary={
        <>
          <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => onImport(e.target.files?.[0])} />
          <button type="button" className="ui-btn ui-btn-primary" onClick={() => setEditing({ status: 'ACTIVE', tagIds: [] })}>
            <Plus size={16} aria-hidden="true" /> New employee
          </button>
        </>
      }
      cards={[
        { label: 'Headcount', value: figures.headcount, count: true, tone: 'sent', Icon: Users },
        { label: 'Joined in 30 days', value: figures.joined, count: true, tone: 'paid', Icon: UserPlus },
        { label: 'On notice', value: figures.notice, count: true, tone: 'partial', Icon: UserMinus, onSelect: () => setStatus('ON_NOTICE') },
        { label: 'No department', value: figures.unplaced, count: true, tone: 'outstanding', Icon: UserRound },
      ]}
      tabs={TABS}
      statusValue={status}
      statusCounts={counts}
      onStatusChange={setStatus}
      tabsLabel="Employee status"
      tabsExtras={
        <>
          {filterSelect('departmentId', 'Department', lists.departments)}
          {filterSelect('jobPositionId', 'Position', lists.positions)}
          {filterSelect('employeeTypeId', 'Type', lists.types)}
          {lists.tags.length ? filterSelect('tagId', 'Tag', lists.tags) : null}
          <select className="ui-select ui-ctl-compact" style={{ width: 'auto', minWidth: '9rem' }} aria-label="Saved views" value={viewId}
            onChange={(e) => (e.target.value === '__save' ? setSavingView({ name: '', shared: false }) : applyView(e.target.value))}>
            <option value="">Views</option>
            {views.map((v) => <option key={v.id} value={v.id}>{v.name}{v.shared ? (v.mine ? ' (shared by you)' : ' (shared)') : ''}</option>)}
            <option value="__save">Save these filters as a view…</option>
          </select>
          {viewId && views.find((v) => v.id === viewId)?.mine ? <button type="button" className="ui-link text-sm" onClick={removeView}>Delete view</button> : null}
        </>
      }
    >
      {error ? (
        <div className="ui-card p-3 text-sm" role="alert" style={{ borderColor: 'rgb(var(--neg))', color: 'rgb(var(--neg))' }}>{error}</div>
      ) : null}

      {rows.length === 0 ? (
        all.length ? (
          <EmptyState kind="filtered" totalCount={all.length} title="Nobody matches" description="Nobody in this tab matches the search or the filters." />
        ) : (
          <EmptyState
            icon={Users}
            title="Nobody here yet"
            description="Add people one at a time, or import a spreadsheet using the template."
            routes={[
              { label: 'New employee', description: 'One person, with their department and joining date.', onSelect: () => setEditing({ status: 'ACTIVE', tagIds: [] }) },
              { label: 'Import a spreadsheet', description: 'Fill in the template, then import it here.', onSelect: () => fileRef.current?.click() },
            ]}
          />
        )
      ) : view === 'cards' ? (
        <div className="grid gap-3 px-3 pb-6 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
          {rows.map((p) => (
            <button key={p.id} type="button" className="ui-card flex items-start gap-3 p-4 text-left ui-hover-sunken" onClick={() => setOpenId(p.id)}>
              <Avatar person={p} size={44} />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{p.name}</span>
                <span className="block truncate ui-caption">{[p.designation, p.department].filter(Boolean).join(' · ') || 'No department or position'}</span>
                <span className="mt-1.5 flex flex-wrap items-center gap-1">
                  <span className={`ui-pill ${statusOf(p.status).pill}`}>{statusOf(p.status).label}</span>
                  {p.code ? <span className="ui-pill ui-pill-neutral">{p.code}</span> : null}
                  {(p.tags || []).slice(0, 2).map((t) => (
                    <span key={t.id} className="ui-pill" style={{ backgroundColor: `${t.color}22`, color: `color-mix(in srgb, ${t.color} 55%, rgb(var(--fg)))` }}>{t.name}</span>
                  ))}
                </span>
              </span>
            </button>
          ))}
        </div>
      ) : (
          <div className="ui-table-scroll">
            {canEdit && selected.size ? (
              <div className="flex flex-wrap items-center gap-3 px-3 py-2 text-sm" role="status">
                <span className="tabular-nums">{selected.size} chosen</span>
                <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={() => setBulk({ field: 'departmentId', value: '', reason: '' })}>Change…</button>
                <button type="button" className="ui-link" onClick={() => setSelected(new Set())}>Clear</button>
              </div>
            ) : null}
            <table className="ui-table ui-table-sticky w-full">
              <thead>
                <tr>
                  {canEdit ? <th scope="col" className="w-8"><input type="checkbox" className="ui-checkbox" aria-label="Choose everyone shown" checked={allChosen} onChange={chooseAll} /></th> : null}
                  <th scope="col" className="ui-col-grow">Employee</th>
                  <th scope="col">ID</th>
                  <th scope="col">Department</th>
                  <th scope="col">Position</th>
                  <th scope="col">Reports to</th>
                  <th scope="col" className="ui-col-h-center">Joined</th>
                  <th scope="col" className="ui-col-h-center">Status</th>
                </tr>
              </thead>
              <tbody className="ui-rows">
                {rows.map((p) => (
                  <tr key={p.id} className="ui-row-click" onClick={() => setOpenId(p.id)}>
                    {canEdit ? <td className="w-8" onClick={(e) => e.stopPropagation()}><input type="checkbox" className="ui-checkbox" aria-label={`Choose ${p.name}`} checked={selected.has(p.id)} onChange={() => toggle(p.id)} /></td> : null}
                    <td className="ui-col-entity">
                      <span className="flex items-center gap-2">
                        <Avatar person={p} size={28} />
                        <span className="truncate">{p.name}</span>
                      </span>
                    </td>
                    <td className="ui-col-meta">{p.code || '—'}</td>
                    <td className="ui-col-meta">{p.department || '—'}</td>
                    <td className="ui-col-meta">{p.designation || '—'}</td>
                    <td className="ui-col-meta">{p.reportingManagerName || '—'}</td>
                    <td className="ui-col-h-center">{p.dateOfJoining ? formatDateIn(p.dateOfJoining) : '—'}</td>
                    <td className="ui-col-h-center"><span className={`ui-pill ${statusOf(p.status).pill}`}>{statusOf(p.status).label}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
      )}

      <EmployeeFile
        key={openId || 'closed'}
        id={openId}
        onClose={() => setOpenId(null)}
        onEdit={(e) => {
          setOpenId(null);
          setEditing({ ...e, tagIds: (e.tags || []).map((t) => t.id) });
        }}
        onDeleted={() => {
          setOpenId(null);
          load();
        }}
      />

      {bulk ? <BulkDrawer count={selected.size} lists={lists} people={all} value={bulk} onChange={setBulk} onClose={() => setBulk(null)}
        onSend={async () => {
          try {
            const r = await bulkUpdateEmployees({ ids: [...selected], set: { [bulk.field]: bulk.value === '__clear' ? null : bulk.value }, reason: bulk.reason });
            notify.success(`${r.changed} changed${r.unchanged ? `, ${r.unchanged} already so` : ''}${r.skipped.length ? `, ${r.skipped.length} skipped (${r.skipped.slice(0, 3).map((x) => `${x.name} ${x.why}`).join('; ')})` : ''}.`);
            setBulk(null);
            setSelected(new Set());
            load();
          } catch (e) {
            notify.error(String(e?.message || 'Not changed.'));
          }
        }} /> : null}
      {savingView ? (
        <Drawer open onClose={() => setSavingView(null)} title="Save as a view" description="The search, the filters and the status tab, under a name."
          actions={<button type="button" className="ui-btn ui-btn-primary" disabled={!savingView.name.trim()} onClick={async () => {
            try {
              const v = await saveSavedView({ screen: 'employees', name: savingView.name, shared: savingView.shared, filters: { ...filters, status } });
              setSavingView(null);
              await loadViews();
              setViewId(v.id);
            } catch (e) {
              notify.error(String(e?.message || 'Not saved.'));
            }
          }}>Save view</button>}>
          <div className="space-y-3">
            <label className="block"><span className="ui-label">Name *</span><input className="ui-input w-full" maxLength={80} value={savingView.name} onChange={(e) => setSavingView({ ...savingView, name: e.target.value })} placeholder="Sales on notice" /></label>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="ui-checkbox" checked={savingView.shared} onChange={(e) => setSavingView({ ...savingView, shared: e.target.checked })} />Share with everyone who can see the directory</label>
          </div>
        </Drawer>
      ) : null}

      {importing ? <ImportDrawer file={importing} onClose={() => setImporting(null)} onDone={() => { setImporting(null); loadLists().catch(() => {}); load(); }} /> : null}

      {editing ? (
        <EmployeeForm
          initial={editing}
          lists={lists}
          people={all}
          onClose={() => setEditing(null)}
          onSaved={(saved) => {
            setEditing(null);
            load();
            if (saved?.id) setOpenId(saved.id);
          }}
        />
      ) : null}
    </DocumentListShell>
  );
}

// ---------------------------------------------------------------------------

/* `row` is the record page's label-beside-value row; without it, the drawer's label-above-value. */
const Field = ({ label, value, row = false }) => (
  <div className={row ? 'ui-field-row' : undefined}>
    <dt className={row ? 'ui-caption' : 'ui-t-label'}>{label}</dt>
    <dd className={row ? 'text-sm' : 'mt-0.5 text-sm'}>{value || <span className="ui-muted">{row ? 'Not provided' : 'Not set'}</span>}</dd>
  </div>
);

function EmployeeFile({ id, onClose, onEdit, onDeleted }) {
  const [person, setPerson] = useState(null);
  const perms = usePermissions();
  const allowed = (key) => Boolean(perms?.isAdmin || perms?.permissions?.has?.(key));
  const [resigning, setResigning] = useState(false);
  const [inviting, setInviting] = useState(false);
  const [inviteSeq, setInviteSeq] = useState(0);
  const [tab, setTab] = useState('about');
  const [notes, setNotes] = useState([]);
  const [draft, setDraft] = useState('');

  useEffect(() => {
    if (!id) return undefined;
    let cancelled = false;
    getEmployee(id)
      .then((r) => !cancelled && setPerson({ ...r.employee, scheduledChanges: r.scheduledChanges || [], permits: r.permits || [] }))
      .catch((e) => notify.error(String(e?.message || 'Could not open that file.')));
    return () => {
      cancelled = true;
    };
  }, [id]);

  useEffect(() => {
    if (!id || tab !== 'notes') return;
    listNotes(id).then(setNotes).catch(() => setNotes([]));
  }, [id, tab]);

  const remove = async () => {
    const ok = await confirmDialog({
      title: `Delete ${person.name}?`,
      message: 'Only a file payroll has never used can be deleted. Anyone else is marked as having left.',
      confirmLabel: 'Yes, delete',
    });
    if (!ok) return;
    try {
      await deleteEmployee(person.id);
      notify.success(`${person.name} deleted.`);
      onDeleted();
    } catch (e) {
      notify.error(String(e?.message || 'Could not delete.'));
    }
  };

  const [rejoinDate, setRejoinDate] = useState('');
  const [extendTo, setExtendTo] = useState('');
  /* Probation (LIFE-03): confirm, or extend to a later date; with a rule it becomes a request. */
  const probation = async (outcome) => {
    const ok = await confirmDialog({ title: outcome === 'CONFIRM' ? `Confirm ${person.name} after probation?` : `Extend ${person.name}'s probation to ${formatDateIn(extendTo)}?`, message: outcome === 'CONFIRM' ? 'The confirmation date goes on their record and history, and they are told.' : 'The new end date goes on their record and history, and they are told.', confirmLabel: outcome === 'CONFIRM' ? 'Confirm' : 'Extend', tone: 'primary' });
    if (!ok) return;
    try {
      const r = await decideProbation(person.id, outcome === 'CONFIRM' ? { outcome } : { outcome, newEndDate: extendTo });
      if (r.request) notify.success(`Sent for approval: ${r.request.title}.`);
      else {
        notify.success(outcome === 'CONFIRM' ? `${person.name} confirmed.` : `Probation now ends ${formatDateIn(extendTo)}.`);
        setPerson((x) => ({ ...x, ...(r.applied || {}) }));
      }
      setExtendTo('');
    } catch (e) {
      notify.error(String(e?.message || 'Not saved.'));
    }
  };
  const withdrawChange = async (c) => {
    if (!(await confirmDialog({ title: `Withdraw the change on ${formatDateIn(c.effectiveOn)}?`, message: `${SCHEDULED_LABELS[c.field] || c.field} stays ${c.fromLabel || 'as it is'}.`, confirmLabel: 'Withdraw' }))) return;
    try {
      await cancelScheduledChange(person.id, c.id);
      setPerson((x) => ({ ...x, scheduledChanges: (x.scheduledChanges || []).filter((y) => y.id !== c.id) }));
      notify.success('Withdrawn.');
    } catch (e) {
      notify.error(String(e?.message || 'Not withdrawn.'));
    }
  };
  const rehire = async () => {
    if (!rejoinDate) return notify.error('Give the rejoin date first.');
    if (person.dateOfLeaving && rejoinDate <= person.dateOfLeaving) return notify.error(`The rejoin date must be after their last day, ${person.dateOfLeaving}.`);
    const ok = await confirmDialog({ title: `Rehire ${person.name} from ${formatDateIn(rejoinDate)}?`, message: `A new period of employment starts on that date; their first joining date (${person.firstJoiningDate ? formatDateIn(person.firstJoiningDate) : 'on file'}) stays. They become active again and are put back on every reader; fingerprints and faces were deleted when they left, so they enrol again.`, confirmLabel: 'Rehire', tone: 'primary' });
    if (!ok) return;
    try {
      const r = await rehireEmployee(person.id, { rejoinDate });
      notify.success(r.readers ? `${person.name} is back, and on ${r.readers} reader${r.readers === 1 ? '' : 's'}.` : `${person.name} is back.`);
      setPerson((x) => ({ ...x, ...r.employee }));
      onDeleted();
    } catch (e) {
      notify.error(String(e?.message || 'Not rehired.'));
    }
  };

  const post = async (e) => {
    e.preventDefault();
    if (!draft.trim()) return;
    try {
      await addNote(id, draft.trim());
      setDraft('');
      setNotes(await listNotes(id));
    } catch (err) {
      notify.error(String(err?.message || 'Note not saved.'));
    }
  };

  const address = person ? [person.addressLine, person.city, person.state, person.pincode, person.country].filter(Boolean).join(', ') : '';

  return (
    <Drawer
      open={Boolean(id)}
      onClose={onClose}
      title={person?.name || 'Employee'}
      description={person ? [person.code, person.designation, person.department].filter(Boolean).join(' · ') : ''}
      widthClass="w-[min(44rem,96vw)]"
      actions={
        person ? (
          <>
            <button type="button" className="ui-btn ui-btn-secondary" onClick={remove}>
              <Trash2 size={16} aria-hidden="true" /> Delete
            </button>
            {person.status === 'LEFT' ? (
              <>
                <label className="flex items-center gap-1.5 text-sm">Rejoin on
                  <input type="date" className="ui-input" style={{ width: 'auto' }} value={rejoinDate} min={person.dateOfLeaving || undefined} onChange={(e) => setRejoinDate(e.target.value)} aria-label="Rejoin date" />
                </label>
                <button type="button" className="ui-btn ui-btn-secondary" onClick={rehire}>Rehire</button>
              </>
            ) : (
              <>
                {allowed('PEOPLE::Lifecycle::CREATE') ? (
                  <button type="button" className="ui-btn ui-btn-secondary" onClick={() => setInviting(true)}>Invite to fill in</button>
                ) : null}
                <button type="button" className="ui-btn ui-btn-secondary" onClick={() => setResigning(true)}>Record leaving</button>
              </>
            )}
            <button type="button" className="ui-btn ui-btn-primary" onClick={() => onEdit(person)}>Edit</button>
          </>
        ) : null
      }
    >
      {inviting && person ? (
        <InviteForm
          person={person}
          onClose={() => setInviting(false)}
          onDone={() => {
            setInviting(false);
            setInviteSeq((n) => n + 1);
          }}
        />
      ) : null}
      {resigning && person ? (
        <ResignForm
          person={person}
          onClose={() => setResigning(false)}
          onDone={(p) => {
            setResigning(false);
            setPerson((x) => ({ ...x, ...p }));
            onDeleted();
          }}
        />
      ) : null}
      {!person ? (
        <SkeletonCard lines={6} />
      ) : (
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <Avatar person={person} size={56} />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className={`ui-pill ${statusOf(person.status).pill}`}>{statusOf(person.status).label}</span>
                {/* A lapsed or soon-to-lapse permit is said on the record (LIFE-08); other apps are not stopped by it. */}
                {(person.permits || []).filter((p) => p.daysLeft <= 30).map((p) => (
                  <span key={p.id} className={`ui-pill ${p.expired ? 'ui-pill-neg' : 'ui-pill-warn'}`} title={p.restrictsWork ? `Until renewed, may not: ${p.restrictsWork}` : undefined}>
                    {p.expired ? `${p.title} expired ${p.expiresOn}` : `${p.title} expires in ${p.daysLeft} day${p.daysLeft === 1 ? '' : 's'}`}
                  </span>
                ))}
                {(person.tags || []).map((t) => (
                  <span key={t.id} className="ui-pill" style={{ backgroundColor: `${t.color}22`, color: `color-mix(in srgb, ${t.color} 55%, rgb(var(--fg)))` }}>{t.name}</span>
                ))}
              </div>
              <div className="ui-caption mt-1">{person.workEmail || person.email || ''}</div>
            </div>
          </div>

          <div className="flex gap-1 border-b" style={{ borderColor: 'rgb(var(--border))' }} role="tablist">
            {[
              ['about', 'About'],
              ['work', 'Work'],
              ['history', 'History'],
              ['journey', 'Journey'],
              ['checklist', 'Checklist'],
              /* A tab shows only to someone who may read what is on it (CORE-05). */
              ...(allowed('PEOPLE::Employee Notes::VIEW') ? [['notes', 'Notes']] : []),
              ...(allowed('PEOPLE::Documents::VIEW') ? [['documents', 'Documents']] : []),
            ].map(([k, label]) => (
              <button
                key={k}
                type="button"
                role="tab"
                aria-selected={tab === k}
                className="px-3 py-2 text-sm"
                style={tab === k ? { boxShadow: 'inset 0 -2px 0 rgb(var(--brand))', fontWeight: 600 } : undefined}
                onClick={() => setTab(k)}
              >
                {label}
              </button>
            ))}
          </div>

          {tab === 'about' ? (
            <dl className="grid gap-4 sm:grid-cols-2">
              <Field label="Personal email" value={person.email || person.personalEmail} />
              <Field label="Phone" value={person.phone} />
              <Field label="Date of birth" value={person.dateOfBirth} />
              <Field label="Gender" value={GENDER_WORDS[person.gender] || (person.gender ? person.gender[0] + person.gender.slice(1).toLowerCase() : '')} />
              <Field label="Marital status" value={person.maritalStatus ? person.maritalStatus[0] + person.maritalStatus.slice(1).toLowerCase() : ''} />
              <Field label="Address" value={address} />
              <Field
                label="Emergency contact"
                value={[person.emergencyContactName, person.emergencyContactRelation, person.emergencyContactPhone].filter(Boolean).join(' · ')}
              />
            </dl>
          ) : null}
          {tab === 'about' ? <CustomFields employeeId={person.id} /> : null}
          {tab === 'about' && allowed('PEOPLE::Lifecycle::VIEW') ? (
            <JoiningDetails key={inviteSeq} person={person} onChecked={(p) => setPerson((x) => ({ ...x, ...p }))} />
          ) : null}

          {tab === 'work' ? (
            <>
            <dl className="grid gap-4 sm:grid-cols-2">
              <Field label="Employee ID" value={person.code} />
              <Field label="Business unit" value={person.businessUnitName} />
              <Field label="Department" value={person.department} />
              <Field label="Designation" value={person.designation} />
              <Field label="Grade" value={person.gradeName} />
              <Field label="Establishment" value={person.establishment ? `${person.establishment}${person.workState ? ` (${person.workState})` : ''}` : null} />
              <Field label="Team" value={person.teamName} />
              <Field label="Seat" value={person.seatName} />
              <Field label="Location" value={person.areaName} />
              <Field label="Cost centre" value={person.costCenterName} />
              <Field label="Reports to" value={person.reportingManagerName} />
              <Field label="Also reports to" value={person.dottedManagerName} />
              <Field label="Work email" value={person.workEmail} />
              <Field label="Work phone" value={person.workPhone} />
              <Field label="Work location" value={person.workLocation} />
              {hasApp('attendance') ? (
                <>
                  <Field label="Contractor" value={person.contractorName} />
                  <Field label="Reader ID" value={person.devicePin || (person.code ? `${person.code} (employee code)` : null)} />
                  <Field label="Card" value={person.cardNumber} />
                  <Field label="Reader PIN" value={person.hasDevicePassword ? 'Set' : null} />
                  <Field label="On the readers as" value={person.devicePrivilege === 14 ? 'Reader administrator' : 'User'} />
                  <Field label="Attendance expected" value={person.attendanceRequired === false ? 'No — door-only' : 'Yes'} />
                  <Field label="Father’s / husband’s name" value={person.guardianName} />
                </>
              ) : null}
              <Field label={person.currentEpisodeSeq > 1 ? 'Rejoined' : 'Joined'} value={person.dateOfJoining} />
              {person.currentEpisodeSeq > 1 && person.firstJoiningDate ? <Field label="First joined" value={person.firstJoiningDate} /> : null}
              {person.scheduledChanges?.length ? (
                <div className="sm:col-span-2">
                  <dt className="ui-t-label">Changes on</dt>
                  <dd className="mt-1 space-y-1">
                    {person.scheduledChanges.map((c) => (
                      <div key={c.id} className="text-sm flex flex-wrap items-center gap-2">
                        <span className="tabular-nums">{formatDateIn(c.effectiveOn)}</span>
                        <span>{SCHEDULED_LABELS[c.field] || c.field}: <span className="ui-muted">{c.fromLabel || 'None'}</span> → <strong>{c.toLabel || 'None'}</strong></span>
                        {c.reason ? <span className="ui-caption">{c.reason}</span> : null}
                        <button type="button" className="ui-link" onClick={() => withdrawChange(c)}>Withdraw</button>
                      </div>
                    ))}
                  </dd>
                </div>
              ) : null}
              <Field label={person.confirmedOn ? 'Confirmed on' : 'Probation ends'} value={person.confirmedOn || person.probationEndDate} />
              {person.probationEndDate && !person.confirmedOn && person.status !== 'LEFT' && allowed('PEOPLE::Lifecycle::APPROVE') ? (
                <div className="sm:col-span-2 flex flex-wrap items-center gap-2">
                  <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={() => probation('CONFIRM')}>Confirm after probation</button>
                  <label className="flex items-center gap-1.5 text-sm">Extend to
                    <input type="date" className="ui-input" style={{ width: 'auto' }} value={extendTo} min={person.probationEndDate} onChange={(e) => setExtendTo(e.target.value)} aria-label="New probation end date" />
                  </label>
                  <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" disabled={!extendTo} onClick={() => probation('EXTEND')}>Extend</button>
                </div>
              ) : null}
              <Field label="Contract ends" value={person.contractEndDate} />
              <Field label="Left" value={person.dateOfLeaving ? `${person.dateOfLeaving}${person.leavingType ? ` · ${LEAVING_TYPES[person.leavingType] || person.leavingType}` : ''}${person.leavingReason ? ` — ${person.leavingReason}` : ''}` : null} />
              <div className="sm:col-span-2">
                <dt className="ui-t-label">Direct reports</dt>
                <dd className="mt-1 flex flex-wrap gap-2">
                  {(person.directReports || []).length ? (
                    person.directReports.map((r) => (
                      <span key={r.id} className="inline-flex items-center gap-1.5 text-sm">
                        <Avatar person={r} size={22} /> {r.name}
                      </span>
                    ))
                  ) : (
                    <span className="ui-muted text-sm">None</span>
                  )}
                </dd>
              </div>
            </dl>
            <StatutoryDetails employeeId={id} />
            </>
          ) : null}

          {tab === 'notes' ? (
            <div className="space-y-3">
              <form onSubmit={post} className="flex gap-2">
                <input className="ui-input flex-1" placeholder="Add a note to this file" value={draft} onChange={(e) => setDraft(e.target.value)} aria-label="New note" />
                <button type="submit" className="ui-btn ui-btn-primary" disabled={!draft.trim()}>Add</button>
              </form>
              {notes.length ? (
                <ul className="space-y-2">
                  {notes.map((n) => (
                    <li key={n.id} className="ui-card p-3 text-sm">
                      <div className="whitespace-pre-wrap">{n.body}</div>
                      <div className="mt-1 flex items-center justify-between ui-caption">
                        <span>{new Date(n.createdAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</span>
                        <button
                          type="button"
                          className="ui-link"
                          onClick={async () => {
                            await deleteNote(n.id).catch((e) => notify.error(String(e?.message || 'Could not delete.')));
                            setNotes(await listNotes(id));
                          }}
                        >
                          Delete
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="ui-muted text-sm">No notes yet.</p>
              )}
            </div>
          ) : null}
          {tab === 'documents' ? <EmployeeDocuments employeeId={id} /> : null}
          {tab === 'history' ? <EmploymentHistory employeeId={id} /> : null}
          {tab === 'journey' ? <Journey employeeId={id} /> : null}
          {tab === 'checklist' ? <EmployeeChecklist person={person} /> : null}
        </div>
      )}
    </Drawer>
  );
}

// ---------------------------------------------------------------------------

/* The fields whose change is recorded in employment history (server: TRACKED in services/people/employmentHistory.ts). */
/* The job fields a change may be dated for, as the record names them (server: SCHEDULABLE_FIELDS). */
export const SCHEDULED_LABELS = { departmentId: 'Department', businessUnitId: 'Business unit', areaId: 'Location', branchId: 'Branch', establishmentId: 'Work site', teamId: 'Team', seatId: 'Position', jobPositionId: 'Designation', jobRoleId: 'Job role', reportingManagerId: 'Manager', dottedManagerId: 'Secondary manager', employeeTypeId: 'Employment type', workTypeId: 'Work mode', contractorId: 'Contractor', gradeId: 'Grade', costCenterId: 'Cost centre', status: 'Status' };
/* How each line of the impact list lands: a review task on the record, an app told through an event, or a note. */
const IMPACT_TARGET = { TASK: 'review task for HR', TOLD: 'told automatically', INFO: 'for information' };
const HISTORY_FIELDS = ['businessUnitId', 'gradeId', 'costCenterId', 'departmentId', 'areaId', 'establishmentId', 'teamId', 'seatId', 'jobPositionId', 'jobRoleId', 'reportingManagerId', 'dottedManagerId', 'employeeTypeId', 'workTypeId', 'contractorId'];
const HISTORY_SOURCE = { FORM: 'Employee form', TRANSFER: 'Transfer', RESIGNATION: 'Resignation', REHIRE: 'Rehire', IMPORT: 'Import' };
const HISTORY_TONE = { JOINED: 'pos', LEFT: 'neg', REHIRED: 'pos', TRANSFERRED: 'warn', CHANGED: 'neutral' };

/**
 * Employment history: every change to where and how someone works, newest
 * first, each with the date it counts from, before and after, who recorded it
 * and what it means for payroll.
 */
export function EmploymentHistory({ employeeId }) {
  const [events, setEvents] = useState(null);
  const [episodes, setEpisodes] = useState([]);
  useEffect(() => {
    let live = true;
    getEmploymentHistory(employeeId).then((e) => live && setEvents(e)).catch(() => live && setEvents([]));
    getEmploymentEpisodes(employeeId).then((e) => live && setEpisodes(e)).catch(() => live && setEpisodes([]));
    return () => {
      live = false;
    };
  }, [employeeId]);
  if (!events) return <SkeletonCard lines={4} />;
  if (!events.length) return <p className="ui-muted text-sm">No changes recorded yet.</p>;
  return (
    <>
    {episodes.length > 1 ? (
      <ol className="space-y-1 mb-3" aria-label="Employment periods">
        {episodes.map((st) => (
          <li key={st.seq} className="text-sm flex flex-wrap items-center gap-2">
            <span className={`ui-pill ${st.current ? 'ui-pill-pos' : 'ui-pill-neutral'}`}>Period {st.seq}</span>
            <span className="tabular-nums">{formatDateIn(st.startDate)} – {st.endDate ? formatDateIn(st.endDate) : 'now'}</span>
            {st.endType ? <span className="ui-caption">{st.endType.replaceAll('_', ' ').toLowerCase()}{st.endReason ? ` · ${st.endReason}` : ''}</span> : null}
          </li>
        ))}
      </ol>
    ) : null}
    <ol className="ui-history-list" aria-label="Employment history">
      {events.map((e) => (
        <li key={e.id}>
          <span className="ui-history-when">
            <span className="tabular-nums font-medium">{formatDateShort(e.effectiveDate)}</span>
            <span className="ui-caption">effective</span>
          </span>
          <span className="min-w-0">
            <span className="block text-sm font-medium">{e.title}</span>
            {e.field ? <span className="block text-sm"><span className="ui-muted">{e.from || 'None'}</span> <span aria-hidden="true">→</span><span className="sr-only">to</span> {e.to || 'None'}</span> : null}
            {e.note ? <span className="block text-sm ui-muted">{e.note}</span> : null}
            {e.payrollImpact ? <span className="block ui-caption">{e.payrollImpact}</span> : null}
          </span>
          <span className="ui-history-recorded">
            Recorded {e.at ? new Date(e.at).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : ''}
            <span className="block">{[e.by, HISTORY_SOURCE[e.source] || e.source].filter(Boolean).join(' · ')}</span>
          </span>
        </li>
      ))}
    </ol>
    </>
  );
}

export const GENDER_WORDS = { MALE: 'Male', FEMALE: 'Female', NON_BINARY: 'Non-binary', OTHER: 'Other', PREFER_NOT_TO_SAY: 'Prefer not to say' };
const JOURNEY_TONE = { APPROVED: 'pos', SCHEDULED: 'info', SELF: 'info', CHANGE: 'neutral', HISTORY: 'neutral' };
const JOURNEY_KIND = { APPROVED: 'Approved', SCHEDULED: 'Scheduled', SELF: 'Self-service', CHANGE: 'Change', HISTORY: 'History' };
const whenAt = (d) => new Date(d).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });

/**
 * The journey (CORE-06): every change in order, grouped by stint, each with
 * a Why? that opens what changed, when, who asked, who approved, which rule
 * version, the evidence, and what it set off — or says what is not known.
 */
export function Journey({ employeeId }) {
  const [data, setData] = useState(null);
  const [why, setWhy] = useState(null);
  useEffect(() => {
    let live = true;
    getJourney(employeeId).then((d) => live && setData(d)).catch(() => live && setData({ episodes: [], entries: [] }));
    return () => { live = false; };
  }, [employeeId]);
  if (!data) return <SkeletonCard lines={4} />;
  if (!data.entries.length) return <p className="ui-muted text-sm">Nothing yet. Every change from now on is listed here with its reasons.</p>;
  const stints = [...new Set(data.entries.map((e) => e.stint))].sort((a, b) => b - a);
  const open = async (e) => {
    try {
      setWhy({ loading: true, entry: e });
      setWhy({ entry: e, why: await getWhy(employeeId, e.key) });
    } catch (err) {
      setWhy(null);
      notify.error(String(err?.message || 'Could not load.'));
    }
  };
  return (
    <div className="space-y-5">
      <PayQuestion employeeId={employeeId} />
      {stints.map((seq) => {
        const st = data.episodes.find((x) => x.seq === seq);
        return (
          <section key={seq} aria-label={`Employment period ${seq}`} className="space-y-2">
            {data.episodes.length > 1 || st ? <h3 className="text-sm font-semibold">Employment period {seq}{st ? <span className="ui-caption font-normal"> · {formatDateIn(st.startDate)} – {st.endDate ? formatDateIn(st.endDate) : 'now'}</span> : null}</h3> : null}
            <ol className="divide-y">
              {data.entries.filter((e) => e.stint === seq).map((e) => (
                <li key={e.key} className="py-2.5 flex flex-wrap items-start gap-2">
                  <span className={`ui-pill ui-pill-${JOURNEY_TONE[e.kind] || 'neutral'}`}>{JOURNEY_KIND[e.kind] || e.kind}</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{e.summary}</p>
                    <p className="ui-caption">{whenAt(e.at)} · {e.how}{e.by ? ` · ${e.by}` : ''}{e.reason ? ` · ${e.reason}` : ''}</p>
                    {e.changes.length ? (
                      <ul className="ui-caption mt-0.5">
                        {e.changes.slice(0, 4).map((c) => <li key={c.key}>{c.field}: {c.redacted ? 'changed (not shown)' : `${c.before || '—'} → ${c.after || '—'}`}</li>)}
                        {e.changes.length > 4 ? <li>and {e.changes.length - 4} more</li> : null}
                      </ul>
                    ) : null}
                  </div>
                  <button type="button" className="ui-link text-sm" onClick={() => open(e)}>Why?</button>
                </li>
              ))}
            </ol>
          </section>
        );
      })}
      {why ? (
        <Drawer open onClose={() => setWhy(null)} widthClass="w-[min(36rem,96vw)]" title={why.entry.summary} description={`${whenAt(why.entry.at)} · ${why.entry.how}`}
          actions={why.why ? <button type="button" className="ui-btn ui-btn-secondary" onClick={() => setWhy({ ...why, raising: { kind: 'CORRECTION', note: '' } })}>Raise a correction</button> : null}>
          {!why.why ? <SkeletonCard lines={5} /> : <WhyPanel why={why.why} />}
          {why.raising ? (
            <form className="mt-5 space-y-2 border-t border-[rgb(var(--border))] pt-4" onSubmit={async (ev) => {
              ev.preventDefault();
              try {
                await raiseFromWhy(employeeId, why.entry.key, why.raising);
                notify.success('Sent to the help desk with this change attached.');
                setWhy({ ...why, raising: null });
              } catch (err) {
                notify.error(String(err?.message || 'Not sent.'));
              }
            }}>
              <div role="radiogroup" aria-label="Kind" className="flex gap-1">
                {[['CORRECTION', 'Something is wrong'], ['QUESTION', 'A question']].map(([k, l]) => <button key={k} type="button" role="radio" aria-checked={why.raising.kind === k} className={`ui-pill ${why.raising.kind === k ? 'ui-pill-info' : ''}`} onClick={() => setWhy({ ...why, raising: { ...why.raising, kind: k } })}>{l}</button>)}
              </div>
              <label className="block"><span className="ui-label">What should it say</span><textarea className="ui-input w-full" rows={3} maxLength={3000} value={why.raising.note} onChange={(ev) => setWhy({ ...why, raising: { ...why.raising, note: ev.target.value } })} /></label>
              <div className="flex justify-end gap-2"><button type="button" className="ui-btn ui-btn-secondary" onClick={() => setWhy({ ...why, raising: null })}>Cancel</button><button type="submit" className="ui-btn ui-btn-primary">Send to the help desk</button></div>
            </form>
          ) : null}
        </Drawer>
      ) : null}
    </div>
  );
}

const BULK_FIELDS = [
  ['departmentId', 'Department', 'departments'], ['jobPositionId', 'Designation', 'positions'], ['employeeTypeId', 'Employment type', 'types'],
  ['workTypeId', 'Work mode', 'workTypes'], ['establishmentId', 'Work site', 'establishments'], ['teamId', 'Team', 'teams'],
  ['gradeId', 'Grade', 'grades'], ['costCenterId', 'Cost centre', 'centres'], ['businessUnitId', 'Business unit', 'units'], ['reportingManagerId', 'Manager', null],
];

/** Change one detail for everyone chosen (CORE-01). Each person gets their own change record; the batch shares one. */
function BulkDrawer({ count, lists, people, value, onChange, onClose, onSend }) {
  const [busy, setBusy] = useState(false);
  const field = BULK_FIELDS.find(([k]) => k === value.field) || BULK_FIELDS[0];
  const options = field[2] ? lists[field[2]] || [] : people.filter((p) => p.status !== 'LEFT');
  return (
    <Drawer open onClose={onClose} title={`Change ${count} ${count === 1 ? 'person' : 'people'}`} description="Each person's history records the change and the reason. Where a job-change approval rule is in force, job details change one person at a time."
      actions={<button type="button" className="ui-btn ui-btn-primary" disabled={busy || !value.value} onClick={async () => { setBusy(true); try { await onSend(); } finally { setBusy(false); } }}>{busy ? 'Changing…' : `Change ${count}`}</button>}>
      <div className="space-y-3">
        <label className="block"><span className="ui-label">What</span>
          <select className="ui-select w-full" value={value.field} onChange={(e) => onChange({ ...value, field: e.target.value, value: '' })}>
            {BULK_FIELDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </label>
        <label className="block"><span className="ui-label">To</span>
          <select className="ui-select w-full" value={value.value} onChange={(e) => onChange({ ...value, value: e.target.value })}>
            <option value="" disabled>Choose…</option>
            <option value="__clear">None (clear it for everyone chosen)</option>
            {options.map((o) => <option key={o.id} value={o.id}>{o.name || o.label}{o.code ? ` (${o.code})` : ''}</option>)}
          </select>
        </label>
        <label className="block"><span className="ui-label">Reason</span><input className="ui-input w-full" maxLength={500} value={value.reason} onChange={(e) => onChange({ ...value, reason: e.target.value })} placeholder="Ops folded into Sales" /></label>
      </div>
    </Drawer>
  );
}

/**
 * A question about pay (TRACE-04): what Payroll and Attendance are willing to
 * show, side by side, and what they cannot show yet. People never works out
 * pay; a correction goes to Payroll's queue.
 */
function PayQuestion({ employeeId }) {
  const [month, setMonth] = useState(null);
  const [data, setData] = useState(null);
  const ask = async (m) => {
    setMonth(m);
    setData(null);
    try {
      setData(await getSalaryQuestion(employeeId, m));
    } catch (err) {
      notify.error(String(err?.message || 'Could not load.'));
      setMonth(null);
    }
  };
  const lastMonth = () => { const d = new Date(Date.now() + 330 * 60_000); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - 1); return d.toISOString().slice(0, 7); };
  if (!month) return <button type="button" className="ui-link text-sm" onClick={() => ask(lastMonth())}>A question about pay?</button>;
  return (
    <section aria-label="A question about pay" className="space-y-2 border-b border-[rgb(var(--border))] pb-4">
      <div className="flex flex-wrap items-end gap-2">
        <label className="block"><span className="ui-label">Month</span><input type="month" className="ui-input" value={month} onChange={(e) => e.target.value && ask(e.target.value)} /></label>
        <button type="button" className="ui-link text-sm ml-auto" onClick={() => setMonth(null)}>Close</button>
      </div>
      {!data ? <SkeletonCard lines={3} /> : (
        <div className="space-y-2 text-sm">
          {data.payslip ? (
            <table className="w-full">
              <tbody className="divide-y">
                {data.payslip.lines.map((l) => <tr key={l.code}><td className="py-1">{l.label}{l.basis ? <span className="ui-caption"> · {l.basis}</span> : null}</td><td className="py-1 text-right tabular-nums">{l.kind === 'DEDUCTION' ? '−' : ''}{Number(l.amount).toLocaleString('en-IN')}</td></tr>)}
                <tr><td className="py-1 font-medium">Net</td><td className="py-1 text-right tabular-nums font-medium">{Number(data.payslip.net).toLocaleString('en-IN')}</td></tr>
              </tbody>
            </table>
          ) : null}
          {data.payslip ? <p className="ui-caption">Rules: {data.payslip.ruleSet}, version {data.payslip.ruleVersion}.</p> : null}
          {data.days ? <p>{data.days.payableDays} payable days, {data.days.lopDays} loss-of-pay{data.days.absences.length ? `: ${data.days.absences.map((a) => `${formatDateIn(a.date)} (${a.reason})`).join(', ')}` : ''}.</p> : null}
          {data.missing.length ? <ul className="ui-muted list-disc pl-4 space-y-0.5">{data.missing.map((m) => <li key={m.evidence}>{m.evidence}: {m.why}</li>)}</ul> : null}
          <p className="ui-caption">{data.correction.note}</p>
        </div>
      )}
    </section>
  );
}

/** The seven things a reader asks, each either answered or said to be unknown (TRACE-01, 02). */
const Row = ({ label, children }) => (
  <div><dt className="ui-t-label">{label}</dt><dd className="mt-0.5 text-sm">{children}</dd></div>
);
function WhyPanel({ why }) {
  return (
    <dl className="space-y-4">
      <Row label="What changed">
        <ul>{why.what.map((c, i) => <li key={i}>{c.field}: {c.redacted ? <span className="ui-muted">changed (not shown)</span> : <><span className="ui-muted">{c.before || '—'}</span> → <strong>{c.after || '—'}</strong></>}</li>)}</ul>
      </Row>
      <Row label="When">{why.recordedAt ? `${formatDateIn(why.when)} (recorded ${whenAt(why.recordedAt)})` : whenAt(why.when)}</Row>
      <Row label="Who asked">{why.askedBy || <span className="ui-muted">Not known</span>}</Row>
      <Row label="Who approved">{why.approvedBy?.length ? why.approvedBy.join('; ') : <span className="ui-muted">Not known</span>}</Row>
      <Row label="Rule">{why.rule ? `${why.rule.name}, version ${why.rule.version}` : <span className="ui-muted">No rule recorded</span>}{why.request ? <span className="ui-caption block">Request: {why.request.title} · {why.request.status.toLowerCase()}</span> : null}</Row>
      {why.reason ? <Row label="Reason given">{why.reason}</Row> : null}
      <Row label="Evidence">{why.evidence?.length ? <ul>{why.evidence.map((e) => <li key={e.id}>{e.title}{e.version ? <span className="ui-caption"> · version {e.version} when decided</span> : null}</li>)}</ul> : <span className="ui-muted">None attached</span>}</Row>
      {why.decision ? (
        <Row label="Policies it rested on">
          {why.decision.policies.length ? <ul>{why.decision.policies.map((p) => <li key={p.versionId}>{p.title}, version {p.version}<span className="ui-caption"> · in force from {formatDateIn(p.effectiveFrom)}</span></li>)}</ul> : <span className="ui-muted">No policy applied to the person that day</span>}
          <span className="ui-caption block">As they stood when it was decided, {whenAt(why.decision.decidedAt)}.</span>
        </Row>
      ) : null}
      <Row label="What it set off">
        {why.downstream.events.length || why.downstream.tasks.length ? (
          <ul>
            {why.downstream.events.map((e) => <li key={e.id} className="font-mono text-xs">{e.name}{e.delivered ? ' · delivered' : ' · queued'}</li>)}
            {why.downstream.tasks.map((t) => <li key={t.id}>Task: {t.title}{t.dueDate ? ` (due ${t.dueDate})` : ''}{t.doneAt ? ' · done' : ''}</li>)}
          </ul>
        ) : <span className="ui-muted">Nothing recorded</span>}
      </Row>
      {why.impact ? <Row label="Impact">{why.impact}</Row> : null}
      {why.unknown?.length ? (
        <Row label="Not known">
          <ul className="ui-muted">{why.unknown.map((u) => <li key={u}>{u}</li>)}</ul>
        </Row>
      ) : null}
    </dl>
  );
}

/**
 * Joining and leaving checklists: what is done and what is due, ticked here.
 * Started when someone joins or leaves; by hand for anyone added before.
 */
export function EmployeeChecklist({ person }) {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState('');
  /* A step that needs a note, or CLOR's own reader removal, opens to be closed with a note (Joining & Leaving). */
  const [noting, setNoting] = useState(null);
  useEffect(() => {
    let live = true;
    getChecklist(person.id).then((d) => live && setData(d)).catch(() => live && setData({ joining: { tasks: [] }, leaving: { tasks: [] } }));
    return () => {
      live = false;
    };
  }, [person.id]);
  const tick = async (t) => {
    if (!t.done && (t.needsNote || t.system)) { setNoting(t); return; }
    setBusy(t.id);
    try {
      setData(await updateChecklistTask(t.id, { done: !t.done }));
    } catch (e) {
      notify.error(String(e?.message || 'Not saved.'));
    } finally {
      setBusy('');
    }
  };
  const start = async (kind) => {
    try {
      setData(await startChecklist(person.id, kind));
    } catch (e) {
      notify.error(String(e?.message || 'Not started.'));
    }
  };
  if (!data) return <SkeletonCard lines={4} />;
  const section = (kind, title, list) => (
    <section key={kind} className="space-y-2" aria-label={title}>
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">{title}</h3>
        {list.total ? <span className="ui-caption tabular-nums">{list.done} of {list.total} done</span> : null}
      </div>
      {list.total ? (
        <>
          <div className="ui-meter" data-tone="progress" aria-hidden="true"><span style={{ width: `${Math.round((list.done / list.total) * 100)}%` }} /></div>
          <ul className="divide-y">
            {list.tasks.map((t) => (
              <li key={t.id} className="flex items-start gap-3 py-2">
                <input type="checkbox" className="mt-1" checked={t.done} disabled={busy === t.id || (t.system && (t.done || t.systemState !== 'FAILED'))} onChange={() => tick(t)} aria-label={t.title} />
                <div className="min-w-0 flex-1">
                  <p className={`text-sm ${t.done ? 'line-through ui-muted' : ''}`}>{t.title}</p>
                  <p className="ui-caption">
                    {t.ownerName ? `${t.ownerName} (${CHECKLIST_OWNER[t.owner] || t.owner})` : CHECKLIST_OWNER[t.owner] || t.owner}
                    {t.dueDate ? <span className={t.overdue ? 'ui-text-neg font-medium' : ''}> · {t.overdue ? 'was due' : 'due'} {formatDateShort(t.dueDate)}</span> : null}
                    {t.done && t.doneBy ? ` · done by ${t.doneBy}` : ''}
                  </p>
                  {t.note ? <p className="ui-caption">{t.note}</p> : null}
                  {t.needsNote && !t.done ? <p className="ui-caption">Closes with a note.</p> : null}
                </div>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="ui-muted text-sm">
          Not started.{' '}
          <button type="button" className="ui-link" onClick={() => start(kind)}>Start the {kind === 'JOINING' ? 'joining' : 'leaving'} checklist</button>
        </p>
      )}
    </section>
  );
  return (
    <div className="space-y-5">
      {section('JOINING', 'Joining', data.joining)}
      {person.status === 'LEFT' || data.leaving.total ? section('LEAVING', 'Leaving', data.leaving) : null}
      {data.changes?.total ? section('CHANGE', 'Changes to review', data.changes) : null}
      {data.probation?.total ? section('PROBATION', 'Probation', data.probation) : null}
      {data.renewals?.total ? section('RENEWAL', 'Renewals', data.renewals) : null}
      {noting ? <TaskDrawer task={{ ...noting, late: noting.overdue, employee: { id: person.id, name: person.name } }} canAssign={false} onClose={() => setNoting(null)} onSaved={() => { setNoting(null); getChecklist(person.id).then(setData).catch(() => undefined); }} /> : null}
    </div>
  );
}

/**
 * Statutory and bank details, from Payroll's profile, masked (PE-05). Only for
 * someone who may see payroll profiles; nothing is changed here.
 */
/** `embedded`: inside a record section that already carries the heading, in the record's row style. */
export function StatutoryDetails({ employeeId, embedded = false }) {
  const [d, setD] = useState(null);
  const [shown, setShown] = useState({});
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  /* One hide-again timer per field: a second Show restarts that field's minute, and leaving the page cancels them all. */
  const hideTimers = useRef({});
  const clearHideTimers = () => {
    Object.values(hideTimers.current).forEach(clearTimeout);
    hideTimers.current = {};
  };
  const load = useCallback(() => getEmployeeStatutory(employeeId).then(setD).catch(() => setD({ visible: false })), [employeeId]);
  useEffect(() => {
    let live = true;
    /* Another person's record: never show the last person's details or revealed values while this one loads. */
    setD(null);
    setShown({});
    setEditing(null);
    clearHideTimers();
    getEmployeeStatutory(employeeId).then((x) => live && setD(x)).catch(() => live && setD({ visible: false }));
    return () => {
      live = false;
    };
  }, [employeeId]);
  useEffect(() => clearHideTimers, []);
  if (!d?.visible) return null;
  /* A full value shows for a minute and is logged on the server; the client asks for the authenticator code when the server wants one. */
  const show = async (field) => {
    try {
      const value = await revealStatutory(employeeId, field);
      setShown((x) => ({ ...x, [field]: value || '—' }));
      clearTimeout(hideTimers.current[field]);
      hideTimers.current[field] = setTimeout(() => {
        delete hideTimers.current[field];
        setShown((x) => { const next = { ...x }; delete next[field]; return next; });
      }, 60_000);
    } catch (e) {
      notify.error(String(e?.message || 'Not shown.'));
    }
  };
  const Masked = ({ label, field, value }) => (
    <div className={embedded ? 'ui-field-row' : undefined}>
      <dt className={embedded ? 'ui-caption' : 'ui-t-label'}>{label}</dt>
      <dd className={`${embedded ? '' : 'mt-1 '}text-sm flex items-center gap-2`}>
        <span className="tabular-nums">{shown[field] ?? (value || <span className="ui-muted">{embedded ? 'Not provided' : 'Not set'}</span>)}</span>
        {value && !shown[field] ? <button type="button" className="ui-link" onClick={() => show(field)}>Show</button> : null}
      </dd>
    </div>
  );
  const saveIdentityForm = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await saveIdentity(employeeId, editing);
      notify.success('Saved.');
      setEditing(null);
      load();
    } catch (err) {
      notify.error(String(err?.message || 'Not saved.'));
    } finally {
      setSaving(false);
    }
  };
  const id = d.identity || {};
  return (
    <section className={embedded ? 'space-y-3' : 'mt-5 space-y-3'} aria-label="Statutory details">
      <div className="flex items-center justify-between gap-2">
        {embedded
          ? <span />
          : <h3 className="text-sm font-semibold">Statutory details <span className="ui-caption font-normal">masked; a full value needs your authenticator code and is logged</span></h3>}
        {d.canEdit && !editing ? <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={() => setEditing({ aadhaarLast4: '', passportNumber: '', passportExpiry: id.passportExpiry || '', workPermitNumber: '', workPermitExpiry: id.workPermitExpiry || '', statutoryCategory: id.statutoryCategory || '', categoryFrom: id.categoryFrom || '' })}>Edit identifiers</button> : null}
      </div>
      {editing ? (
        <form onSubmit={saveIdentityForm} className="ui-form-grid">
          <label className="block"><span className="ui-label">Aadhaar, last 4 digits</span><input className="ui-input w-full" value={editing.aadhaarLast4} maxLength={4} inputMode="numeric" placeholder={id.aadhaarLast4 ? '••••' : ''} onChange={(e) => setEditing({ ...editing, aadhaarLast4: e.target.value })} /></label>
          <div><PopupSelect showValueSubtext={false} label="Statutory category" value={editing.statutoryCategory} placeholder="Not set" onChange={(v) => setEditing({ ...editing, statutoryCategory: v || '' })}
            options={[{ value: '', label: 'Not set' }, ...[['WORKER', 'Worker'], ['SUPERVISOR', 'Supervisor'], ['MANAGER', 'Manager'], ['APPRENTICE', 'Apprentice'], ['CONTRACT', 'Contract']].map(([value, label]) => ({ value, label }))]} /></div>
          <label className="block"><span className="ui-label">Passport number</span><input className="ui-input w-full" value={editing.passportNumber} placeholder={id.passportNumber ? '••••' : ''} onChange={(e) => setEditing({ ...editing, passportNumber: e.target.value.toUpperCase() })} /></label>
          <div><label className="ui-label" htmlFor="sd-passport-exp">Passport expiry</label><DatePicker id="sd-passport-exp" value={editing.passportExpiry || ''} onChange={(v) => setEditing({ ...editing, passportExpiry: v || '' })} /></div>
          <label className="block"><span className="ui-label">Work permit number</span><input className="ui-input w-full" value={editing.workPermitNumber} placeholder={id.workPermitNumber ? '••••' : ''} onChange={(e) => setEditing({ ...editing, workPermitNumber: e.target.value.toUpperCase() })} /></label>
          <div><label className="ui-label" htmlFor="sd-permit-exp">Work permit expiry</label><DatePicker id="sd-permit-exp" value={editing.workPermitExpiry || ''} onChange={(v) => setEditing({ ...editing, workPermitExpiry: v || '' })} /></div>
          <div><label className="ui-label" htmlFor="sd-cat-from">Category from</label><DatePicker id="sd-cat-from" value={editing.categoryFrom || ''} onChange={(v) => setEditing({ ...editing, categoryFrom: v || '' })} /></div>
          <div className="sm:col-span-2 flex justify-end gap-2">
            <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={() => setEditing(null)}>Cancel</button>
            <button type="submit" className="ui-btn ui-btn-primary ui-btn-sm" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
          </div>
        </form>
      ) : null}
      <dl className={embedded ? 'ui-field-grid' : 'grid gap-4 sm:grid-cols-2'}>
        <Field row={embedded} label="Aadhaar" value={id.aadhaarLast4} />
        <Masked label="Passport" field="passportNumber" value={id.passportNumber} />
        <Field row={embedded} label="Passport expiry" value={id.passportExpiry} />
        <Masked label="Work permit" field="workPermitNumber" value={id.workPermitNumber} />
        <Field row={embedded} label="Work permit expiry" value={id.workPermitExpiry} />
        <Field row={embedded} label="Statutory category" value={id.statutoryCategory ? `${id.statutoryCategory.charAt(0)}${id.statutoryCategory.slice(1).toLowerCase()}${id.categoryFrom ? ` from ${id.categoryFrom}` : ''}` : null} />
      </dl>
      <h4 className="text-sm font-semibold mt-2">From Payroll</h4>
      {d.inPayroll === false ? (
        <p className="ui-muted text-sm">Not set up in Payroll yet.</p>
      ) : (
        <dl className={embedded ? 'ui-field-grid' : 'grid gap-4 sm:grid-cols-2'}>
          <Masked label="PAN" field="pan" value={d.pan} />
          <Masked label="UAN" field="uan" value={d.uan} />
          <Masked label="ESIC number" field="esic" value={d.esic} />
          <Masked label="Bank account" field="account" value={[d.bank, d.account].filter(Boolean).join(' ')} />
          <Field row={embedded} label="IFSC" value={d.ifsc} />
          <Field row={embedded} label="Covered by" value={[d.pf && 'PF', d.esi && 'ESI', d.pt && `PT (${d.pt})`].filter(Boolean).join(' · ')} />
        </dl>
      )}
    </section>
  );
}

/** The company's own fields on this person (CORE-08): only the ones this user may see; edited in place where they may. */
/** `embedded`: inside a record section that already says "More details"; the Save button stays. */
export function CustomFields({ employeeId, embedded = false }) {
  const [fields, setFields] = useState(null);
  const [edits, setEdits] = useState({});
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    /* Another person's record: unsaved edits belong to the last one, so they go. */
    setFields(null);
    setEdits({});
    getCustomValues(employeeId).then((f) => live && setFields(f)).catch(() => live && setFields([]));
    return () => { live = false; };
  }, [employeeId]);
  if (!fields?.length) return embedded && fields ? <p className="ui-muted text-sm">No custom fields.</p> : null;
  const dirty = Object.keys(edits).length > 0;
  const save = async () => {
    setBusy(true);
    try {
      const r = await saveCustomValues(employeeId, edits);
      setFields(r.fields);
      setEdits({});
      notify.success(r.changed.length ? 'Saved.' : 'Nothing changed.');
    } catch (err) {
      notify.error(String(err?.message || 'Not saved.'));
    } finally {
      setBusy(false);
    }
  };
  const control = (f) => {
    const v = edits[f.key] !== undefined ? edits[f.key] : f.value;
    const set = (val) => setEdits({ ...edits, [f.key]: val });
    if (!f.canEdit) return <span>{f.type === 'BOOLEAN' ? (f.value === true ? 'Yes' : f.value === false ? 'No' : '—') : f.value ?? <span className="ui-muted">Not set</span>}</span>;
    if (f.type === 'CHOICE') return <PopupSelect showValueSubtext={false} ariaLabel={f.label} value={v ?? ''} placeholder="Not set" onChange={(x) => set(x || '')} options={[{ value: '', label: 'Not set' }, ...f.options.map((o) => ({ value: o, label: o }))]} />;
    if (f.type === 'BOOLEAN') return <PopupSelect showValueSubtext={false} ariaLabel={f.label} value={v === true ? 'yes' : v === false ? 'no' : ''} placeholder="Not set" onChange={(x) => set(!x ? null : x === 'yes')} options={[{ value: '', label: 'Not set' }, { value: 'yes', label: 'Yes' }, { value: 'no', label: 'No' }]} />;
    if (f.type === 'DATE') return <DatePicker id={`cf-${f.key}`} value={v ?? ''} onChange={(x) => set(x || '')} />;
    if (f.type === 'FILE') return <input className="ui-input w-full" value={v ?? ''} placeholder="Document id from the Documents tab" onChange={(e) => set(e.target.value)} aria-label={f.label} />;
    return <input className="ui-input w-full" type={f.type === 'NUMBER' ? 'number' : f.type === 'DATE' ? 'date' : 'text'} value={v ?? ''} onChange={(e) => set(e.target.value)} aria-label={f.label} />;
  };
  return (
    <section className="space-y-2" aria-label="More details">
      <div className="flex items-center justify-between gap-2">
        {embedded ? <span /> : <h3 className="text-sm font-semibold">More details</h3>}
        {dirty ? <button type="button" className="ui-btn ui-btn-primary ui-btn-sm" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</button> : null}
      </div>
      <dl className={embedded ? 'ui-field-grid' : 'grid gap-3 sm:grid-cols-2'}>
        {fields.map((f) => (
          <div key={f.key} className={embedded ? 'ui-field-row' : undefined}>
            <dt className={embedded ? 'ui-caption' : 'ui-t-label'}>{f.label}{f.required ? ' *' : ''}</dt>
            <dd className="mt-0.5 text-sm">{control(f)}{f.help ? <span className="ui-caption block">{f.help}</span> : null}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/**
 * Import drawer (CORE-07): map the file's columns to fields, preview every
 * row (errors and matches named), choose add-only or update-by-code, then
 * commit — and undo the whole batch within a day.
 */
export const IMPORT_FIELDS = [...IMPORT_COLUMNS, { key: 'businessUnit', label: 'businessUnit' }, { key: 'grade', label: 'grade' }, { key: 'costCentre', label: 'costCentre' }, { key: 'hours', label: 'hours' }, { key: 'probationEndDate', label: 'probationEndDate' }, { key: 'contractEndDate', label: 'contractEndDate' }, { key: 'managerCode', label: 'managerCode' }, { key: 'workSite', label: 'workSite' }];
export const guessField = (header) => {
  const h = String(header || '').toLowerCase().replace(/[^a-z]/g, '');
  const aliases = { employeeid: 'code', empcode: 'code', id: 'code', fullname: 'name', employeename: 'name', mobile: 'phone', phonenumber: 'phone', emailid: 'email', personalemail: 'email', designation: 'jobPosition', position: 'jobPosition', dept: 'department', doj: 'dateOfJoining', joiningdate: 'dateOfJoining', dateofjoining: 'dateOfJoining', dob: 'dateOfBirth', dateofbirth: 'dateOfBirth', type: 'employeeType', employmenttype: 'employeeType', worktype: 'workType', workmode: 'workType', costcenter: 'costCentre', costcentre: 'costCentre', workinghours: 'hours', fulltimeparttime: 'hours', probationends: 'probationEndDate', probationenddate: 'probationEndDate', probationend: 'probationEndDate', contractends: 'contractEndDate', contractenddate: 'contractEndDate', contractend: 'contractEndDate', internshipends: 'contractEndDate', manager: 'managerCode', managerid: 'managerCode', managercode: 'managerCode', reportsto: 'managerCode', managerempid: 'managerCode', worksite: 'workSite', establishment: 'workSite', site: 'workSite', branch: 'workSite' };
  if (aliases[h]) return aliases[h];
  const hit = IMPORT_FIELDS.find((f) => f.key.toLowerCase() === h);
  return hit ? hit.key : '';
};
export function ImportDrawer({ file, onClose, onDone }) {
  const [mapping, setMapping] = useState(() => file.headers.map(guessField));
  const [mode, setMode] = useState('create');
  const [preview, setPreview] = useState(null);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const records = () => file.rows.map((r) => Object.fromEntries(mapping.map((k, i) => (k ? [k, String(r[i] ?? '').trim() || null] : null)).filter(Boolean)));
  const run = async (dryRun) => {
    setBusy(true);
    try {
      const res = await importEmployees(records(), dryRun, mode);
      if (dryRun) setPreview(res);
      else {
        setResult(res);
        notify.success(res.failed ? `${res.imported} ${mode === 'update' ? 'taken' : 'imported'}, ${res.failed} rows not.` : `${res.imported} people ${mode === 'update' ? 'taken' : 'imported'}.`);
      }
    } catch (e) {
      notify.error(String(e?.message || 'Import failed.'));
    } finally {
      setBusy(false);
    }
  };
  const undo = async () => {
    if (!(await confirmDialog({ title: 'Undo this import?', message: 'The people it added are removed with their events; the people it changed go back to what they were.', confirmLabel: 'Undo' }))) return;
    setBusy(true);
    try {
      const r = await undoImport(result.batchId);
      notify.success(`Undone: ${r.removed} removed, ${r.restored} put back${r.kept ? `, ${r.kept} kept (already in payroll)` : ''}.`);
      onDone();
    } catch (e) {
      notify.error(String(e?.message || 'Not undone.'));
    } finally {
      setBusy(false);
    }
  };
  const mapped = mapping.filter(Boolean).length;
  return (
    <Drawer open onClose={result ? onDone : onClose} title={`Import ${file.name}`} description={`${file.rows.length} rows. Match each column to a field, preview, then import. An import can be undone within 24 hours.`} widthClass="w-[min(44rem,96vw)]"
      actions={result ? (
        <>
          {result.batchId ? <button type="button" className="ui-btn ui-btn-secondary" disabled={busy} onClick={undo}>Undo this import</button> : null}
          <button type="button" className="ui-btn ui-btn-primary" onClick={onDone}>Done</button>
        </>
      ) : (
        <>
          <button type="button" className="ui-btn ui-btn-secondary" onClick={onClose}>Cancel</button>
          <button type="button" className="ui-btn ui-btn-secondary" disabled={busy || !mapped} onClick={() => run(true)}>Preview</button>
          <button type="button" className="ui-btn ui-btn-primary" disabled={busy || !preview || !preview.imported} onClick={() => run(false)}>{busy ? 'Working…' : `Import ${preview ? preview.imported : ''}`}</button>
        </>
      )}>
      <div className="space-y-4">
        {!result ? (
          <>
            <section className="space-y-2" aria-label="Columns">
              <h3 className="ui-t-sec">Columns</h3>
              <div className="grid gap-2 sm:grid-cols-2">
                {file.headers.map((h, i) => (
                  <label key={`${h}-${i}`} className="flex items-center gap-2 text-sm">
                    <span className="min-w-0 flex-1 truncate font-mono text-xs" title={h}>{h || `column ${i + 1}`}</span>
                    <select className="ui-select" style={{ width: '11rem' }} value={mapping[i]} onChange={(e) => { const m = [...mapping]; m[i] = e.target.value; setMapping(m); setPreview(null); }} aria-label={`Field for ${h}`}>
                      <option value="">— skip —</option>
                      {IMPORT_FIELDS.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
                    </select>
                  </label>
                ))}
              </div>
            </section>
            <label className="flex items-center gap-2 text-sm">
              <span className="ui-label">If an employee ID is already here</span>
              <select className="ui-select" style={{ width: 'auto' }} value={mode} onChange={(e) => { setMode(e.target.value); setPreview(null); }} aria-label="Mode">
                <option value="create">Stop that row (add new people only)</option>
                <option value="update">Update that person with the columns given</option>
              </select>
            </label>
            {preview ? (
              <section className="space-y-1" aria-label="Preview">
                <h3 className="ui-t-sec">Preview</h3>
                <p className="text-sm">{preview.imported} rows ready{preview.results.some((r) => r.action === 'UPDATE') ? ` (${preview.results.filter((r) => r.action === 'UPDATE').length} update someone already here)` : ''}; {preview.failed} with a problem; {preview.results.filter((r) => r.warning).length} look like someone already here.</p>
                <ul className="divide-y text-sm max-h-72 overflow-y-auto">
                  {preview.results.filter((r) => !r.ok || r.warning).map((r) => (
                    <li key={r.row} className="py-1.5 flex gap-2"><span className="tabular-nums ui-muted w-16 shrink-0">Row {r.row}</span><span className={r.ok ? '' : 'text-[rgb(var(--neg))]'}>{r.ok ? r.warning : r.error}</span></li>
                  ))}
                </ul>
              </section>
            ) : null}
          </>
        ) : (
          <section className="space-y-2" aria-label="Result">
            <p className="text-sm font-medium">{result.imported} {mode === 'update' ? 'taken' : 'imported'}, {result.failed} not.</p>
            {result.failed ? <ul className="divide-y text-sm max-h-72 overflow-y-auto">{result.results.filter((r) => !r.ok).map((r) => <li key={r.row} className="py-1.5"><span className="tabular-nums ui-muted">Row {r.row}</span> · {r.error}</li>)}</ul> : null}
            {result.batchId ? <p className="ui-caption">This import can be undone until {new Date(result.undoUntil).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}.</p> : null}
          </section>
        )}
      </div>
    </Drawer>
  );
}

/* What a joiner may fill in before day one (LIFE-01), as the server names it. */
const JOINER_FIELDS = [
  ['personalEmail', 'Personal email'], ['phone', 'Phone'], ['dateOfBirth', 'Date of birth'], ['gender', 'Gender'], ['maritalStatus', 'Marital status'],
  ['addressLine', 'Address'], ['city', 'City'], ['state', 'State'], ['pincode', 'PIN code'], ['country', 'Country'],
  ['emergencyContactName', 'Emergency contact'], ['emergencyContactPhone', 'Emergency contact phone'], ['emergencyContactRelation', 'Relation'], ['guardianName', 'Father’s / guardian’s name'],
];
const INVITE_STATUS = { SENT: 'Sent, not opened', STARTED: 'Opened, not sent back', RETURNED: 'Sent back — check it', CHECKED: 'Checked', EXPIRED: 'Ran out' };

/** Invite someone about to join to fill in their own details (LIFE-01). By phone, HR is handed the link to send. */
export function InviteForm({ person, onClose, onDone }) {
  const [form, setForm] = useState({ channel: person.email || person.personalEmail ? 'EMAIL' : 'SMS', sentTo: person.email || person.personalEmail || person.phone || '', message: '' });
  const [saving, setSaving] = useState(false);
  const [link, setLink] = useState('');
  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const r = await createInvite(person.id, form);
      if (r.link) {
        setLink(r.link);
        notify.success('Invite ready. Send the link by SMS or WhatsApp; it works once and runs out in 14 days.');
      } else {
        notify.success(`Invite e-mailed to ${form.sentTo}. It works once and runs out in 14 days.`);
        onDone();
      }
    } catch (err) {
      notify.error(String(err?.message || 'Not sent.'));
    } finally {
      setSaving(false);
    }
  };
  return (
    <Drawer
      open
      onClose={link ? onDone : onClose}
      widthClass="w-[min(36rem,96vw)]"
      title={`Invite ${person.name} to fill in their details`}
      description="They see only their own name and joining date, fill in personal details, upload documents and sign the declaration. What they send waits here until you check it."
      actions={
        link ? (
          <button type="button" className="ui-btn ui-btn-primary" onClick={onDone}>Done</button>
        ) : (
          <>
            <button type="button" className="ui-btn ui-btn-secondary" onClick={onClose}>Cancel</button>
            <button type="submit" form="invite-form" className="ui-btn ui-btn-primary" disabled={saving}>{saving ? 'Sending…' : form.channel === 'EMAIL' ? 'Send invite' : 'Make the link'}</button>
          </>
        )
      }
    >
      {link ? (
        <div className="grid gap-3">
          <p className="text-sm">Send this link to {form.sentTo}. It works once and runs out in 14 days.</p>
          <input className="ui-input w-full font-mono text-xs" readOnly value={link} onFocus={(e) => e.target.select()} aria-label="Invite link" />
          <button type="button" className="ui-btn ui-btn-secondary" onClick={() => navigator.clipboard?.writeText(link).then(() => notify.success('Copied.'))}>Copy link</button>
        </div>
      ) : (
        <form id="invite-form" onSubmit={save} className="grid gap-4">
          <div><PopupSelect showValueSubtext={false} label="Send by" value={form.channel} onChange={(v) => setForm({ ...form, channel: v || 'EMAIL', sentTo: v === 'SMS' ? person.phone || '' : person.email || person.personalEmail || '' })}
            options={[{ value: 'EMAIL', label: 'Email' }, { value: 'SMS', label: 'Phone (you share the link)' }]} /></div>
          <label className="block">
            <span className="ui-label">{form.channel === 'EMAIL' ? 'Personal email *' : 'Phone *'}</span>
            <input className="ui-input w-full" type={form.channel === 'EMAIL' ? 'email' : 'tel'} required value={form.sentTo} onChange={(e) => setForm({ ...form, sentTo: e.target.value })} />
          </label>
          <label className="block">
            <span className="ui-label">Note to them (optional)</span>
            <textarea className="ui-input w-full" rows={3} maxLength={2000} placeholder="What to bring on day one, which policies to read…" value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} />
          </label>
        </form>
      )}
    </Drawer>
  );
}

/** The invite on file and, once sent back, what the joiner typed beside what the record says — checked onto the record in one go. */
export function JoiningDetails({ person, onChecked }) {
  const [invites, setInvites] = useState(null);
  const [edits, setEdits] = useState({});
  const [busy, setBusy] = useState(false);
  const perms = usePermissions();
  const allowed = (key) => Boolean(perms?.isAdmin || perms?.permissions?.has?.(key));
  useEffect(() => {
    let live = true;
    listEmployeeInvites(person.id).then((list) => live && setInvites(list)).catch(() => live && setInvites([]));
    return () => { live = false; };
  }, [person.id]);
  if (!invites?.length) return null;
  const latest = invites[0];
  const check = async () => {
    setBusy(true);
    try {
      const r = await checkInvite(latest.id, { fields: edits });
      notify.success(`${r.applied.length} detail${r.applied.length === 1 ? '' : 's'} saved on the record.`);
      setInvites((list) => list.map((i) => (i.id === latest.id ? r.invite : i)));
      onChecked(Object.fromEntries(JOINER_FIELDS.map(([k]) => [k, edits[k] !== undefined ? edits[k] : latest.submitted?.fields?.[k]]).filter(([, v]) => v !== undefined)));
    } catch (err) {
      notify.error(String(err?.message || 'Not saved.'));
    } finally {
      setBusy(false);
    }
  };
  const sent = latest.submitted?.fields || {};
  return (
    <section className="space-y-2" aria-label="Joining details">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">Before day one</h3>
        <span className="ui-caption">{INVITE_STATUS[latest.status] || latest.status} · {latest.channel === 'EMAIL' ? 'e-mailed to' : 'link for'} {latest.sentTo} · {latest.status === 'SENT' || latest.status === 'STARTED' ? `runs out ${String(latest.expiresAt).slice(0, 10)}` : String(latest.returnedAt || latest.checkedAt || latest.createdAt).slice(0, 10)}</span>
      </div>
      {latest.status === 'RETURNED' ? (
        <>
          <p className="ui-caption">Sent, not checked. What they typed is on the right; correct anything before you save it to the record. {latest.submitted?.declarations?.policiesRead ? 'They confirmed reading the policies.' : 'They did not tick the policies box.'}{latest.submitted?.documentIds?.length ? ` ${latest.submitted.documentIds.length} document${latest.submitted.documentIds.length === 1 ? '' : 's'} added under Documents.` : ''}</p>
          <table className="w-full text-sm">
            <thead><tr className="ui-caption text-left"><th className="py-1 font-medium">Detail</th><th className="py-1 font-medium">On the record</th><th className="py-1 font-medium">They sent</th></tr></thead>
            <tbody className="divide-y">
              {JOINER_FIELDS.filter(([k]) => sent[k] !== undefined).map(([k, label]) => (
                <tr key={k}>
                  <td className="py-1.5 pr-2 ui-muted">{label}</td>
                  <td className="py-1.5 pr-2">{person[k] || <span className="ui-muted">—</span>}</td>
                  <td className="py-1.5"><input className="ui-input w-full" value={edits[k] !== undefined ? edits[k] : sent[k] || ''} onChange={(e) => setEdits({ ...edits, [k]: e.target.value })} aria-label={label} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          {allowed('PEOPLE::Lifecycle::EDIT') ? (
            <div className="flex justify-end"><button type="button" className="ui-btn ui-btn-primary ui-btn-sm" disabled={busy} onClick={check}>{busy ? 'Saving…' : 'Check and save to the record'}</button></div>
          ) : null}
        </>
      ) : null}
      {latest.statutory ? <JoiningStatutory key={latest.id} invite={latest} canView={allowed('PEOPLE::Statutory Details::VIEW')} canApprove={allowed('PEOPLE::Statutory Details::EDIT')} /> : null}
    </section>
  );
}

/** Someone leaving: last day, why. They come off every reader at once. */
export function ResignForm({ person, onClose, onDone }) {
  /* Someone on a contract usually leaves when it ends: that date and reason come pre-filled. */
  const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
  const contractEnd = person.contractEndDate ? String(person.contractEndDate).slice(0, 10) : '';
  /* On notice already: the form changes what is on record (another last day, another reason). */
  const onNotice = person.status === 'ON_NOTICE' && person.dateOfLeaving;
  /* Someone not yet joined who will not come: the offer is withdrawn, closed on their joining date with no settlement. */
  const notYetJoined = person.dateOfJoining && String(person.dateOfJoining).slice(0, 10) > today;
  const [form, setForm] = useState(onNotice
    ? { lastDay: String(person.dateOfLeaving).slice(0, 10), leavingType: person.leavingType || 'RESIGNED', reason: person.leavingReason || '' }
    : notYetJoined ? { lastDay: String(person.dateOfJoining).slice(0, 10), leavingType: 'NOT_JOINED', reason: '' }
    : { lastDay: contractEnd || today, leavingType: contractEnd ? 'CONTRACT_ENDED' : 'RESIGNED', reason: '' });
  /* Notice (W15): the type's notice in days, when the resignation came, and what is short; Payroll recovers or waives from it. */
  const [noticeDays, setNoticeDays] = useState(null);
  const [resignedOn, setResignedOn] = useState(person.resignedOn ? String(person.resignedOn).slice(0, 10) : today);
  const [noticeWaived, setNoticeWaived] = useState(Boolean(person.noticeWaived));
  useEffect(() => {
    if (!person.employeeTypeId) return;
    listStructure('employee-types').then((types) => setNoticeDays((types || []).find((t) => t.id === person.employeeTypeId)?.noticeDays ?? null)).catch(() => setNoticeDays(null));
  }, [person.employeeTypeId]);
  const resigning = form.leavingType === 'RESIGNED';
  const served = resigning && resignedOn && form.lastDay ? Math.max(0, Math.round((Date.parse(`${form.lastDay}T00:00:00Z`) - Date.parse(`${resignedOn}T00:00:00Z`)) / 86_400_000) + 1) : null;
  const short = noticeDays != null && served != null && !noticeWaived ? Math.max(0, noticeDays - served) : null;
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const save = async (e) => {
    e?.preventDefault();
    if (!form.lastDay) { setError('Choose the last working day.'); return; }
    setSaving(true);
    setError('');
    try {
      const r = await resignEmployee(person.id, { ...form, reason: form.reason || null, ...(resigning ? { resignedOn: resignedOn || null, noticeWaived } : {}) });
      /* Said as it is: a later last day puts them on notice, still paid and on the readers until then. */
      notify.success(form.leavingType === 'NOT_JOINED' ? `${person.name}'s offer is withdrawn.` : form.leavingType === 'DUPLICATE' ? 'Duplicate record closed.' : form.lastDay >= today
        ? `${person.name} is on notice until ${formatDateShort(form.lastDay)}, and stays on payroll and the readers until then.`
        : r.readers ? `${person.name} recorded as left and removed from ${r.readers} reader${r.readers === 1 ? '' : 's'}.` : `${person.name} recorded as left.`);
      onDone(r.employee);
    } catch (err) {
      setError(String(err?.message || 'Not saved.'));
    } finally {
      setSaving(false);
    }
  };
  return (
    <Drawer
      open
      onClose={onClose}
      widthClass="w-[min(36rem,96vw)]"
      title={`${person.name} is leaving`}
      dirty={Boolean(form.reason)}
      footer={
        <>
          <button type="button" className="ui-btn ui-btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" form="resign-form" className="ui-btn ui-btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Record leaving'}</button>
        </>
      }
    >
      <form id="resign-form" onSubmit={save} className="grid gap-4">
        {error ? <p className="ui-field-error" role="alert">{error}</p> : null}
        <div><PopupSelect showValueSubtext={false} label="Why" value={form.leavingType} onChange={(v) => setForm({ ...form, leavingType: v || 'RESIGNED' })} options={Object.entries(LEAVING_TYPES).map(([value, label]) => ({ value, label }))} /></div>
        {form.leavingType === 'NOT_JOINED' ? null : <div><label className="ui-label" htmlFor="resign-last-day">Last working day *</label><DatePicker id="resign-last-day" value={form.lastDay} min={person.dateOfJoining ? String(person.dateOfJoining).slice(0, 10) : undefined} onChange={(v) => setForm({ ...form, lastDay: v || '' })} /></div>}
        {resigning ? (
          <>
            <div><label className="ui-label" htmlFor="resign-received">Resignation received on</label><DatePicker id="resign-received" value={resignedOn} max={form.lastDay || undefined} onChange={(v) => setResignedOn(v || '')} /></div>
            {noticeDays != null ? (
              <div className="grid gap-2">
                <p className="text-sm">Notice {noticeDays} {noticeDays === 1 ? 'day' : 'days'}{served != null ? <>, served <span className="tabular-nums">{served}</span></> : null}{short ? <>, <strong className="tabular-nums">{short} short</strong></> : null}</p>
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="ui-checkbox" checked={noticeWaived} onChange={(e) => setNoticeWaived(e.target.checked)} /> Notice waived</label>
              </div>
            ) : null}
          </>
        ) : null}
        <label className="block"><span className="ui-label">Note</span><textarea className="ui-input w-full" rows={2} maxLength={500} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} /></label>
      </form>
    </Drawer>
  );
}

/** A square photo, scaled down to 160px and stored as a small JPEG data URL. */
export const shrinkPhoto = (file) =>
  new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const size = 160;
      const c = document.createElement('canvas');
      c.width = size;
      c.height = size;
      const s = Math.min(img.width, img.height);
      c.getContext('2d').drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, size, size);
      resolve(c.toDataURL('image/jpeg', 0.85));
      URL.revokeObjectURL(img.src);
    };
    img.onerror = () => reject(new Error('That file is not an image.'));
    img.src = URL.createObjectURL(file);
  });

function EmployeeForm({ initial, lists, people, onClose, onSaved }) {
  const [form, setForm] = useState(() => ({ ...initial }));
  const [saving, setSaving] = useState(false);
  /* The same person twice (CORE-02): the server names who already has this email, phone or ID; saving anyway needs a reason. */
  const [dupes, setDupes] = useState(null);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e?.target ? e.target.value : e }));
  const positions = useMemo(
    () => (form?.departmentId ? lists.positions.filter((p) => !p.departmentId || p.departmentId === form.departmentId) : lists.positions),
    [lists.positions, form?.departmentId]
  );
  const roles = useMemo(
    () => (form?.jobPositionId ? lists.roles.filter((r) => !r.jobPositionId || r.jobPositionId === form.jobPositionId) : lists.roles),
    [lists.roles, form?.jobPositionId]
  );

  /* A change to where or how someone works goes into their employment history: from when, and why. */
  const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
  const moved = Boolean(form.id) && HISTORY_FIELDS.some((k) => (form[k] || '') !== (initial[k] || ''));
  /* What else the change affects (LIFE-04): the state's rules, and which apps are told. Asked as the fields change, before anything is saved. */
  const [impact, setImpact] = useState([]);
  const impactKey = ['establishmentId', 'departmentId', 'reportingManagerId'].filter((k) => (form[k] || '') !== (initial[k] || '')).map((k) => `${k}=${form[k] || ''}`).join('&');
  useEffect(() => {
    if (!form.id || !impactKey) { setImpact([]); return undefined; }
    let live = true;
    const fields = Object.fromEntries(impactKey.split('&').map((pair) => pair.split('=')));
    getChangeImpact(form.id, fields).then((list) => live && setImpact(list)).catch(() => live && setImpact([]));
    return () => { live = false; };
  }, [form.id, impactKey]);

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    const keys = [
      'name', 'firstName', 'lastName', 'code', 'email', 'phone', 'status', 'dateOfJoining', 'dateOfLeaving', 'gender', 'dateOfBirth',
      'maritalStatus', 'personalEmail', 'photoUrl', 'addressLine', 'city', 'state', 'country', 'pincode', 'emergencyContactName',
      'emergencyContactPhone', 'emergencyContactRelation', 'departmentId', 'jobPositionId', 'jobRoleId', 'employeeTypeId', 'workTypeId',
      'reportingManagerId', 'dottedManagerId', 'workEmail', 'workPhone', 'workLocation', 'devicePin', 'probationEndDate', 'contractEndDate', 'tagIds',
      'areaId', 'establishmentId', 'teamId', 'seatId', 'contractorId', 'businessUnitId', 'gradeId', 'costCenterId', 'cardNumber', 'devicePrivilege', 'attendanceRequired', 'guardianName',
    ];
    const body = Object.fromEntries(keys.filter((k) => form[k] !== undefined).map((k) => [k, form[k] === '' ? null : form[k]]));
    /* The reader PIN is write-only: sent only when typed. */
    if (form.devicePassword) body.devicePassword = form.devicePassword;
    if (moved) {
      body.effectiveFrom = form.effectiveFrom || today;
      if (form.changeNote) body.changeNote = form.changeNote;
    }
    if (dupes?.reason) body.duplicateReason = dupes.reason;
    try {
      const res = form.id ? await updateEmployee(form.id, body) : await createEmployee(body);
      notify.success(`${res.employee?.name || 'Employee'} saved.`);
      onSaved(res.employee);
    } catch (err) {
      if (err?.code === 'DUPLICATE' && Array.isArray(err?.data?.duplicates)) {
        setDupes({ list: err.data.duplicates, reason: dupes?.reason || '' });
        return;
      }
      notify.error(String(err?.message || 'Not saved.'));
    } finally {
      setSaving(false);
    }
  };

  const input = (k, label, props = {}) => (
    <label className="block">
      <span className="ui-label">{label}</span>
      <input className="ui-input w-full" value={form[k] || ''} onChange={set(k)} {...props} />
    </label>
  );
  const select = (k, label, options, props = {}, { required = false } = {}) => (
    <label className="block">
      <span className="ui-label">{label}</span>
      <select className="ui-select w-full" value={form[k] || ''} onChange={set(k)} {...props}>
        {required ? null : <option value="">— None —</option>}
        {options.map((o) => (
          <option key={o.id} value={o.id}>{o.name || o.label}</option>
        ))}
      </select>
    </label>
  );

  return (
    <Drawer
      open
      onClose={onClose}
      title={form.id ? `Edit ${form.name}` : 'New employee'}
      widthClass="w-[min(44rem,96vw)]"
      actions={
        <>
          <button type="button" className="ui-btn ui-btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" form="employee-form" className="ui-btn ui-btn-primary" disabled={saving || !(form.name || form.firstName)}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </>
      }
    >
      <form id="employee-form" onSubmit={save} className="space-y-6">
        {dupes ? (
          <section className="ui-card p-3 space-y-2" aria-label="Possibly the same person" style={{ borderColor: 'rgb(var(--neg))' }}>
            <p className="text-sm font-medium">Someone here already has this {dupes.list[0]?.field}.</p>
            <ul className="text-sm">
              {dupes.list.map((d) => (
                <li key={d.id}>{d.name}{d.code ? ` · ${d.code}` : ''} <span className="ui-caption">— same {d.field}</span></li>
              ))}
            </ul>
            <p className="ui-caption">If this is the same person, cancel and open their record. If it is a different person, say why and save again; the reason goes on the change log.</p>
            <input className="ui-input w-full" value={dupes.reason} maxLength={500} placeholder="Why this is a different person" onChange={(e) => setDupes({ ...dupes, reason: e.target.value })} aria-label="Why this is a different person" />
          </section>
        ) : null}
        {moved ? (
          <section className="ui-card p-3 space-y-2" aria-label="Employment change">
            <p className="text-sm font-medium">This changes where or how {form.name || 'they'} work. It goes into their employment history. A date in the future waits on the record and takes effect that day.</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="ui-label">Counts from</span>
                <input type="date" className="ui-input w-full" value={form.effectiveFrom || today} onChange={set('effectiveFrom')} />
              </label>
              <label className="block">
                <span className="ui-label">Reason (optional)</span>
                <input className="ui-input w-full" value={form.changeNote || ''} onChange={set('changeNote')} maxLength={500} placeholder="Promotion, reorganisation…" />
              </label>
            </div>
            {impact.length ? (
              <div className="space-y-1" aria-label="What else this affects">
                <p className="ui-label">What else this affects</p>
                <ul className="space-y-1">
                  {impact.map((i) => (
                    <li key={i.key} className="text-sm">
                      <span className="font-medium">{i.title}</span>
                      <span className="ui-caption"> · {IMPACT_TARGET[i.target] || i.target}</span>
                      <p className="ui-caption">{i.detail}</p>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </section>
        ) : null}
        <section className="flex items-center gap-3">
          <Avatar person={form} size={56} />
          <label className="ui-btn ui-btn-secondary cursor-pointer">
            <UserRound size={16} aria-hidden="true" /> Photo
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                try {
                  const url = await shrinkPhoto(f);
                  setForm((x) => ({ ...x, photoUrl: url }));
                } catch (err) {
                  notify.error(String(err?.message || 'Could not use that photo.'));
                }
              }}
            />
          </label>
          {form.photoUrl ? (
            <button type="button" className="ui-link text-sm" onClick={() => setForm((x) => ({ ...x, photoUrl: null }))}>Remove photo</button>
          ) : null}
        </section>

        {/* What HR fills in for every new person comes first; personal details last. */}
        <section className="grid gap-4 sm:grid-cols-2">
          <h3 className="ui-t-sec sm:col-span-2">Basics</h3>
          {input('firstName', 'First name', { autoFocus: true })}
          {input('lastName', 'Last name')}
          {input('code', 'Employee ID')}
          {input('phone', 'Phone', { type: 'tel' })}
          {input('dateOfJoining', 'Date of joining', { type: 'date' })}
          {select('status', 'Status', STATUSES, {}, { required: true })}
        </section>

        <section className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <h3 className="ui-t-sec">Where They Work</h3>
            <p className="ui-caption">The lists come from Settings → Company.</p>
          </div>
          {lists.units.length ? select('businessUnitId', 'Business unit', lists.units) : null}
          {select('departmentId', 'Department', lists.departments)}
          {select('jobPositionId', 'Designation', positions)}
          {lists.grades.length ? select('gradeId', 'Grade', lists.grades) : null}
          {lists.establishments.length ? select('establishmentId', 'Establishment (work state)', lists.establishments.map((x) => ({ ...x, name: x.state ? `${x.name} (${x.state})` : x.name }))) : null}
          {lists.teams?.length ? select('teamId', 'Team', lists.teams) : null}
          {lists.seats?.length ? select('seatId', 'Seat', lists.seats.filter((x) => !form.teamId || !x.teamId || x.teamId === form.teamId)) : null}
          {lists.areas.length ? select('areaId', 'Location', lists.areas) : null}
          {lists.centres.length ? select('costCenterId', 'Cost centre', lists.centres) : null}
          {select('reportingManagerId', 'Reports to', people.filter((p) => p.id !== form.id && p.status !== 'LEFT'))}
          {select('dottedManagerId', 'Also reports to (dotted line)', people.filter((p) => p.id !== form.id && p.status !== 'LEFT'))}
        </section>

        <section className="grid gap-4 sm:grid-cols-2">
          <h3 className="ui-t-sec sm:col-span-2">Employment</h3>
          {select('employeeTypeId', 'Employment type', lists.types)}
          {select('workTypeId', 'Work mode', lists.workTypes)}
          {select('jobRoleId', 'Job role', roles)}
          {input('workEmail', 'Work email', { type: 'email' })}
          {input('workPhone', 'Work phone', { type: 'tel' })}
          {input('workLocation', 'Work location')}
          {input('probationEndDate', 'Probation ends', { type: 'date' })}
          {input('contractEndDate', 'Contract ends', { type: 'date' })}
          {form.status === 'LEFT' || form.dateOfLeaving ? input('dateOfLeaving', 'Date of leaving', { type: 'date' }) : null}
        </section>

        {hasApp('attendance') ? (
          <section className="grid gap-4 sm:grid-cols-2">
            <h3 className="ui-t-sec sm:col-span-2">Attendance and Readers</h3>
            {select('contractorId', 'Contractor', lists.contractors)}
            {input('devicePin', 'Reader ID', { placeholder: form.code ? `Blank = employee code (${form.code})` : 'ID on the biometric reader' })}
            {input('cardNumber', 'Card number')}
            <label className="block">
              <span className="ui-label">Reader PIN</span>
              <input
                className="ui-input w-full"
                type="password"
                inputMode="numeric"
                autoComplete="new-password"
                maxLength={20}
                value={form.devicePassword || ''}
                onChange={set('devicePassword')}
                placeholder={form.hasDevicePassword ? 'Set — leave blank to keep' : 'Optional, instead of a finger'}
              />
            </label>
            <label className="block">
              <span className="ui-label">On the readers as</span>
              <select className="ui-select w-full" value={String(form.devicePrivilege ?? 0)} onChange={(e) => setForm((f) => ({ ...f, devicePrivilege: Number(e.target.value) }))}>
                <option value="0">User</option>
                <option value="14">Reader administrator</option>
              </select>
            </label>
            {input('guardianName', 'Father’s / husband’s name', { placeholder: 'For the muster roll' })}
            <label className="flex items-center gap-2 self-end pb-2 text-sm">
              <input type="checkbox" className="ui-checkbox" checked={form.attendanceRequired !== false} onChange={(e) => setForm((f) => ({ ...f, attendanceRequired: e.target.checked }))} />
              Attendance expected <span className="ui-caption">— untick for door-only staff (guards, drivers)</span>
            </label>
          </section>
        ) : null}

        <section className="grid gap-4 sm:grid-cols-2">
          <h3 className="ui-t-sec sm:col-span-2">Personal Details</h3>
          {input('email', 'Personal email', { type: 'email' })}
          {input('dateOfBirth', 'Date of birth', { type: 'date' })}
          {select('gender', 'Gender', [{ id: 'MALE', label: 'Male' }, { id: 'FEMALE', label: 'Female' }, { id: 'NON_BINARY', label: 'Non-binary' }, { id: 'OTHER', label: 'Other' }, { id: 'PREFER_NOT_TO_SAY', label: 'Prefer not to say' }])}
          {select('maritalStatus', 'Marital status', [
            { id: 'SINGLE', label: 'Single' },
            { id: 'MARRIED', label: 'Married' },
            { id: 'DIVORCED', label: 'Divorced' },
            { id: 'WIDOWED', label: 'Widowed' },
          ])}
          <div className="sm:col-span-2">{input('addressLine', 'Address')}</div>
          {input('city', 'City')}
          {input('state', 'State')}
          {input('pincode', 'PIN code')}
          {input('country', 'Country')}
          {input('emergencyContactName', 'Emergency contact')}
          {input('emergencyContactRelation', 'Relation')}
          {input('emergencyContactPhone', 'Emergency phone', { type: 'tel' })}
        </section>


        {lists.tags.length ? (
          <section>
            <h3 className="ui-t-sec mb-2">Tags</h3>
            <div className="flex flex-wrap gap-2">
              {lists.tags.map((t) => {
                const on = (form.tagIds || []).includes(t.id);
                return (
                  <button
                    key={t.id}
                    type="button"
                    aria-pressed={on}
                    className="ui-pill"
                    style={on ? { backgroundColor: t.color, color: '#fff' } : { backgroundColor: `${t.color}22`, color: `color-mix(in srgb, ${t.color} 55%, rgb(var(--fg)))` }}
                    onClick={() =>
                      setForm((x) => ({ ...x, tagIds: on ? x.tagIds.filter((i) => i !== t.id) : [...(x.tagIds || []), t.id] }))
                    }
                  >
                    {t.name}
                  </button>
                );
              })}
            </div>
          </section>
        ) : null}
      </form>
    </Drawer>
  );
}

const DOC_KINDS = [
  ['ID_PROOF', 'ID proof'],
  ['ADDRESS_PROOF', 'Address proof'],
  ['EDUCATION', 'Education'],
  ['CONTRACT', 'Contract / offer'],
  ['PAYSLIP', 'Payslip'],
  ['WORK_PERMIT', 'Work permit / licence'],
  ['CERTIFICATE', 'Certificate'],
  ['LETTER', 'Letter issued'],
  ['OTHER', 'Other'],
];
/* A permit or certificate also says what the person may not do while it is lapsed (LIFE-08). */
const PERMIT_KINDS = ['WORK_PERMIT', 'CERTIFICATE'];
const kb = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/**
 * Files on the employee's record — ID proof, contract, certificates — read
 * into the browser and sent as a data URL (≤ 5 MB). The person sees what HR
 * marks visible, in the portal under Me.
 */
export function EmployeeDocuments({ employeeId }) {
  const [docs, setDocs] = useState(null);
  const [form, setForm] = useState({ kind: 'ID_PROOF', title: '', expiresOn: '', classification: 'EMPLOYEE_VISIBLE' });
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);
  const input = useRef(null);
  const load = useCallback(() => listDocuments(employeeId).then(setDocs).catch(() => setDocs([])), [employeeId]);
  useEffect(() => { load(); }, [load]);

  const upload = async (e) => {
    e.preventDefault();
    if (!file) return false;
    if (file.size > 5 * 1024 * 1024) { notify.error('Files up to 5 MB.'); return false; }
    setBusy(true);
    try {
      const dataUrl = await new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = () => reject(new Error('Could not read the file.')); r.readAsDataURL(file); });
      await uploadDocument(employeeId, { ...form, title: form.title.trim() || file.name.replace(/\.[^.]+$/, ''), expiresOn: form.expiresOn || null, data: dataUrl, mime: file.type });
      setFile(null);
      setForm({ kind: 'ID_PROOF', title: '', expiresOn: '', classification: 'EMPLOYEE_VISIBLE', restrictsWork: '' });
      if (input.current) input.current.value = '';
      notify.success('Uploaded.');
      load();
      return true;
    } catch (err) {
      notify.error(String(err?.message || 'Not uploaded.'));
    } finally {
      setBusy(false);
    }
  };
  const open = async (d) => {
    try {
      const full = await getDocument(d.id);
      const a = document.createElement('a');
      a.href = full.dataUrl;
      a.download = `${d.title}.${(d.mime.split('/')[1] || 'bin').replace('vnd.openxmlformats-officedocument.wordprocessingml.document', 'docx').replace('vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'xlsx').replace('jpeg', 'jpg')}`;
      a.click();
    } catch (err) {
      notify.error(String(err?.message || 'Could not open.'));
    }
  };
  /* A look without a download: images and PDFs open in a panel; other kinds say so and offer the download. */
  const [viewing, setViewing] = useState(null);
  const preview = async (d) => {
    const canShow = /^image\//.test(d.mime) || d.mime === 'application/pdf';
    setViewing({ doc: d, url: null, canShow, error: null });
    if (!canShow) return;
    try {
      const full = await getDocument(d.id);
      const blob = await (await fetch(full.dataUrl)).blob();
      setViewing((v) => (v?.doc.id === d.id ? { ...v, url: URL.createObjectURL(blob) } : v));
    } catch (err) {
      setViewing((v) => (v?.doc.id === d.id ? { ...v, error: String(err?.message || 'Could not open it.') } : v));
    }
  };
  const closePreview = () => { if (viewing?.url) URL.revokeObjectURL(viewing.url); setViewing(null); };
  const remove = async (d) => {
    if (!(await confirmDialog({ title: `Remove ${d.title}?`, message: 'The file is deleted from the record.', confirmLabel: 'Remove' }))) return;
    await deleteDocument(d.id).catch((e) => notify.error(String(e?.message || 'Could not remove.')));
    load();
  };
  /* India's date, as the server counts expiry: the browser's UTC date would call a document expired 5½ hours late. */
  const [today] = useState(() => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10));
  /* Replacing keeps the earlier file (DOC-02): a hidden picker per row, then the earlier versions on demand. */
  const replaceInput = useRef(null);
  const [replacing, setReplacing] = useState(null);
  const [versions, setVersions] = useState({});
  const pickReplacement = (d) => {
    setReplacing(d);
    replaceInput.current?.click();
  };
  const replaceWith = async (e) => {
    const f = e.target.files?.[0];
    const d = replacing;
    e.target.value = '';
    if (!f || !d) return;
    setBusy(true);
    try {
      const dataUrl = await new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = () => reject(new Error('Could not read the file.')); r.readAsDataURL(f); });
      await replaceDocument(d.id, { data: dataUrl, mime: f.type });
      notify.success(`${d.title} replaced; the earlier version is kept.`);
      setVersions({});
      load();
    } catch (err) {
      notify.error(String(err?.message || 'Not replaced.'));
    } finally {
      setBusy(false);
      setReplacing(null);
    }
  };
  const showVersions = async (d) => {
    if (versions[d.id]) return setVersions((v) => ({ ...v, [d.id]: null }));
    try {
      const list = await listDocumentVersions(d.id);
      setVersions((v) => ({ ...v, [d.id]: list }));
    } catch (err) {
      notify.error(String(err?.message || 'Could not load versions.'));
    }
  };

  const [uploading, setUploading] = useState(false);
  const [lettering, setLettering] = useState(false);
  const [menu, setMenu] = useState(null);
  const menuBtn = useRef({});
  const kindWord = (k) => DOC_KINDS.find(([x]) => x === k)?.[1] || k;
  const added = (d) => formatDateShort(String(d.createdAt).slice(0, 10));
  const closeUpload = () => { setUploading(false); setFile(null); setForm({ kind: 'ID_PROOF', title: '', expiresOn: '', classification: 'EMPLOYEE_VISIBLE' }); };
  const permit = PERMIT_KINDS.includes(form.kind);

  return (
    <div className="space-y-3">
      <input ref={replaceInput} type="file" accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx,.xlsx,.txt" className="hidden" onChange={replaceWith} aria-label="Replacement file" />
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="ui-t-sec">Documents{docs?.length ? <span className="ui-section-count tabular-nums">{docs.length}</span> : null}</h2>
        <span className="ml-auto flex gap-2">
          <button type="button" className="ui-btn ui-btn-secondary" onClick={() => setLettering(true)}>Issue a letter</button>
          <button type="button" className="ui-btn ui-btn-secondary" onClick={() => setUploading(true)}><Upload size={16} aria-hidden="true" /> Upload</button>
        </span>
      </div>
      {!docs ? <SkeletonCard lines={3} /> : !docs.length ? (
        <EmptyState icon={FileDown} title="No documents yet" action={<button type="button" className="ui-btn ui-btn-secondary" onClick={() => setUploading(true)}><Upload size={16} aria-hidden="true" /> Upload</button>} />
      ) : (
        <ul className="ui-doc-list" aria-label="Documents">
          {docs.map((d) => {
            const expired = d.expiresOn && d.expiresOn < today;
            return (
              <li key={d.id}>
                <div className="ui-doc-row">
                  <span className="min-w-0">
                    <button type="button" className="ui-doc-title" onClick={() => preview(d)}>{d.title}</button>
                    <span className="ui-doc-meta">{[kindWord(d.kind), kb(d.size), `added ${added(d)}`, d.version > 1 ? `version ${d.version}` : null, d.classification !== 'EMPLOYEE_VISIBLE' ? docWhoLabel(d) : null].filter(Boolean).join(' · ')}</span>
                    {d.restrictsWork && expired ? <span className="ui-doc-meta ui-text-neg">Until renewed: {d.restrictsWork}</span> : null}
                  </span>
                  <span className="ui-doc-expiry">
                    {d.expiresOn ? <>{expired ? <span className="ui-pill ui-pill-neg">Expired</span> : null}<span className="tabular-nums">{expired ? '' : 'Valid until '}{formatDateShort(d.expiresOn)}</span></> : null}
                  </span>
                  <span className="flex items-center gap-1">
                    <button type="button" className="ui-icon-btn" aria-label={`Download ${d.title}`} onClick={() => open(d)}><FileDown size={16} aria-hidden="true" /></button>
                    <button ref={(el) => { menuBtn.current[d.id] = el; }} type="button" className="ui-icon-btn" aria-label={`More for ${d.title}`} aria-haspopup="menu" aria-expanded={menu === d.id} onClick={() => setMenu(menu === d.id ? null : d.id)}><MoreHorizontal size={16} aria-hidden="true" /></button>
                    {menu === d.id ? (
                      <Popover anchorRef={{ current: menuBtn.current[d.id] }} onClose={() => setMenu(null)} minWidth={200}>
                        <div role="menu" className="ui-menu">
                          {d.kind !== 'LETTER' ? <button type="button" role="menuitem" data-autofocus="" className="ui-menu-item" disabled={busy} onClick={() => { setMenu(null); pickReplacement(d); }}>Replace with a new version</button> : null}
                          {d.version > 1 ? <button type="button" role="menuitem" className="ui-menu-item" onClick={() => { setMenu(null); showVersions(d); }}>{versions[d.id] ? 'Hide earlier versions' : 'Earlier versions'}</button> : null}
                          <button type="button" role="menuitem" data-autofocus={d.kind === 'LETTER' ? '' : undefined} className="ui-menu-item is-danger" onClick={() => { setMenu(null); remove(d); }}>Remove</button>
                        </div>
                      </Popover>
                    ) : null}
                  </span>
                </div>
                {versions[d.id] ? (
                  <ul className="ui-doc-versions" aria-label="Earlier versions">
                    {versions[d.id].filter((v) => v.id !== d.id).map((v) => (
                      <li key={v.id}><span className="tabular-nums">Version {v.version}</span><span className="ui-muted">{kb(v.size)} · {formatDateShort(String(v.createdAt).slice(0, 10))}</span><button type="button" className="ui-link" onClick={() => open(v)}>Download</button></li>
                    ))}
                  </ul>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {uploading ? (
        <Drawer open onClose={closeUpload} widthClass="w-[min(36rem,96vw)]" title="Upload a document" dirty={Boolean(file || form.title)}
          footer={<><button type="button" className="ui-btn ui-btn-secondary" onClick={closeUpload}>Cancel</button><button type="submit" form="doc-upload" className="ui-btn ui-btn-primary" disabled={!file || busy || (permit && !form.expiresOn)}>{busy ? 'Uploading…' : 'Upload'}</button></>}>
          <form id="doc-upload" className="grid gap-4" onSubmit={async (e) => { if (await upload(e)) setUploading(false); }}>
            <label className="ui-dropzone" onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files?.[0]; if (f) setFile(f); }}>
              <Upload size={18} aria-hidden="true" />
              <span className="text-sm font-medium">{file ? file.name : 'Choose a file'}</span>
              <span className="ui-caption">{file ? kb(file.size) : 'or drop it here · PDF, image or Word, up to 5 MB'}</span>
              <input ref={input} type="file" accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx,.xlsx,.txt" className="sr-only" onChange={(e) => setFile(e.target.files?.[0] || null)} aria-label="File" />
            </label>
            <div><PopupSelect showValueSubtext={false} label="Type" value={form.kind} onChange={(v) => setForm({ ...form, kind: v || 'ID_PROOF' })} options={DOC_KINDS.filter(([k]) => k !== 'LETTER').map(([value, label]) => ({ value, label }))} /></div>
            <label className="block"><span className="ui-label">Title</span><input className="ui-input w-full" value={form.title} placeholder={file ? file.name.replace(/\.[^.]+$/, '') : ''} onChange={(e) => setForm({ ...form, title: e.target.value })} maxLength={160} /></label>
            <div><label className="ui-label" htmlFor="doc-valid">{permit ? 'Valid until *' : 'Valid until'}</label><DatePicker id="doc-valid" value={form.expiresOn} onChange={(v) => setForm({ ...form, expiresOn: v || '' })} /></div>
            {permit ? <label className="block"><span className="ui-label">Work they may not do once it lapses</span><input className="ui-input w-full" value={form.restrictsWork || ''} onChange={(e) => setForm({ ...form, restrictsWork: e.target.value })} maxLength={500} /></label> : null}
            <div><PopupSelect showValueSubtext={false} label="Who can see" value={form.classification} onChange={(v) => setForm({ ...form, classification: v || 'EMPLOYEE_VISIBLE' })} options={DOC_WHO_CAN_SEE.map(([value, label]) => ({ value, label }))} /></div>
          </form>
        </Drawer>
      ) : null}
      {viewing ? (
        <Drawer open onClose={closePreview} widthClass="w-[min(56rem,96vw)]" title={viewing.doc.title}
          footer={<><button type="button" className="ui-btn ui-btn-secondary" onClick={closePreview}>Close</button><button type="button" className="ui-btn ui-btn-primary" onClick={() => open(viewing.doc)}><FileDown size={16} aria-hidden="true" /> Download</button></>}>
          {!viewing.canShow ? <EmptyState icon={FileDown} title="No preview for this kind of file" description="Download it to open." />
            : viewing.error ? <p className="ui-field-error" role="alert">{viewing.error}</p>
              : !viewing.url ? <SkeletonCard lines={6} />
                : /^image\//.test(viewing.doc.mime) ? <img src={viewing.url} alt={viewing.doc.title} className="ui-doc-preview" />
                  : <iframe src={viewing.url} title={viewing.doc.title} className="ui-doc-preview ui-doc-preview-pdf" />}
        </Drawer>
      ) : null}
      {lettering ? <IssueLetter employeeId={employeeId} onClose={() => setLettering(false)} onIssued={() => { setLettering(false); load(); }} /> : null}
    </div>
  );
}

/**
 * Issue a letter onto the record (DOC-04): pick the kind, fill in what the
 * template asks for, and a PDF lands under Documents naming the template
 * version. A service certificate shows when it is due (DOC-07).
 */
function IssueLetter({ employeeId, onClose, onIssued }) {
  const openForm = true;
  const [templates, setTemplates] = useState(null);
  const [kind, setKind] = useState('APPOINTMENT');
  const [extra, setExtra] = useState({});
  const [due, setDue] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!openForm || templates) return;
    getLetterTemplates().then(setTemplates).catch((e) => notify.error(String(e?.message || 'Could not load letters.')));
  }, [openForm, templates]);
  useEffect(() => {
    if (!openForm || kind !== 'SERVICE_CERT') { setDue(null); return; }
    serviceCertificateDue(employeeId).then(setDue).catch(() => setDue(null));
  }, [openForm, kind, employeeId]);
  const t = templates?.templates.find((x) => x.kind === kind);
  const issue = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await issueLetter(employeeId, { kind, extra });
      notify.success(`${r.document.title} is on the record (template v${r.document.templateVersion}).`);
      setExtra({});
      onIssued();
    } catch (err) {
      notify.error(String(err?.message || 'Not issued.'));
    } finally {
      setBusy(false);
    }
  };
  const asked = async () => {
    try {
      const r = await requestLetter(employeeId, { kind });
      notify.success(`Noted. Due ${r.dueOn}${r.source ? ` (${r.dueDays} days by law)` : ''}; the task is on the record.`);
    } catch (err) {
      notify.error(String(err?.message || 'Not noted.'));
    }
  };
  return (
    <Drawer open onClose={onClose} widthClass="w-[min(36rem,96vw)]" title="Issue a letter"
      footer={<><button type="button" className="ui-btn ui-btn-secondary" onClick={onClose}>Cancel</button><button type="submit" form="issue-letter" className="ui-btn ui-btn-primary" disabled={busy || !t}>{busy ? 'Issuing…' : 'Issue as PDF'}</button></>}>
      <form id="issue-letter" onSubmit={issue} className="grid gap-4">
        <div><PopupSelect showValueSubtext={false} label="Letter" value={kind} onChange={(v) => { setKind(v || 'APPOINTMENT'); setExtra({}); }} options={(templates?.kinds || [{ kind: 'APPOINTMENT', label: 'Appointment letter' }]).map((k) => ({ value: k.kind, label: k.label }))} /></div>
        {due ? <p className="text-sm">{due.note}{due.dueOn ? ` Due ${formatDateShort(due.dueOn)} if asked today.` : ''} <button type="button" className="ui-link" onClick={asked}>Record the request</button></p> : null}
        {(t?.extra || []).map((k) => (
          <label key={k} className="block">
            <span className="ui-label">{k.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase())}</span>
            <input className="ui-input w-full" value={extra[k] || ''} onChange={(e) => setExtra({ ...extra, [k]: e.target.value })} maxLength={1000} />
          </label>
        ))}
      </form>
    </Drawer>
  );
}
