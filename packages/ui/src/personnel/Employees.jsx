import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FileDown, LayoutGrid, List, Plus, Trash2, Upload, UserMinus, UserPlus, UserRound, Users } from 'lucide-react';

import { SkeletonCard, EmptyState } from '@ui/components/ui/Primitives';
import DocumentListShell from '@ui/components/list/DocumentListShell';
import { exportFormatFromKey, exportMenuItem, runListExport } from '@ui/components/list/exportMenu';
import Drawer from '@ui/components/ui/Drawer';
import { confirmDialog, notify } from '@ui/components/ui/notify';
import { DOC_WHO_CAN_SEE, docWhoLabel } from './documentClassification';
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
  listEmployees,
  listNotes,
  listDocuments,
  uploadDocument,
  getDocument,
  deleteDocument,
  listStructure,
  listTags,
  listContractors,
  getChecklist,
  getEmployeeStatutory,
  revealStatutory,
  saveIdentity,
  getEmploymentHistory,
  getEmploymentEpisodes,
  cancelScheduledChange,
  startChecklist,
  updateChecklistTask,
  rehireEmployee,
  resignEmployee,
  updateEmployee,
} from './api';

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

export const Avatar = ({ person, size = 40 }) =>
  person?.photoUrl ? (
    <img src={person.photoUrl} alt="" className="shrink-0 rounded-full object-cover" style={{ width: size, height: size }} />
  ) : (
    <span
      className="inline-grid shrink-0 place-items-center rounded-full font-semibold"
      style={{ width: size, height: size, fontSize: size * 0.38, backgroundColor: 'rgb(var(--brand-soft))', color: 'rgb(var(--brand-ink))' }}
      aria-hidden="true"
    >
      {initials(person?.name)}
    </span>
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

const IMPORT_COLUMNS = [
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
  const [lists, setLists] = useState({ departments: [], positions: [], roles: [], types: [], workTypes: [], tags: [], areas: [], contractors: [], units: [], grades: [], centres: [], establishments: [] });
  const [openId, setOpenId] = useState(null);
  const [editing, setEditing] = useState(null);
  const fileRef = useRef(null);

  const loadLists = useCallback(async () => {
    const withAttendance = hasApp('attendance');
    const [departments, positions, roles, types, workTypes, tags, areas, contractors, units, grades, centres, establishments] = await Promise.all([
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
    ]);
    setLists({ departments, positions, roles, types, workTypes, tags, areas, contractors, units, grades, centres, establishments });
  }, []);

  const load = useCallback(async () => {
    try {
      /* Everyone, 500 a page, until the server's total is reached (CORE-01: no 500 cap). */
      const first = await listEmployees({ ...filters, status: '', limit: 500, offset: 0 });
      const rows = [...(first?.employees || [])];
      const total = Number(first?.total || rows.length);
      while (rows.length < total) {
        const more = await listEmployees({ ...filters, status: '', limit: 500, offset: rows.length });
        if (!more?.employees?.length) break;
        rows.push(...more.employees);
      }
      setAll(rows);
      setError('');
    } catch (e) {
      setError(String(e?.message || 'Could not load employees.'));
    } finally {
      setLoading(false);
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

  const onImport = async (file) => {
    if (!file) return;
    try {
      const table = parseCsv(await readFileText(file));
      const [head, ...body] = table;
      const keys = (head || []).map((h) => String(h || '').trim());
      const records = body
        .filter((r) => r.some((c) => String(c || '').trim()))
        .map((r) => Object.fromEntries(keys.map((k, i) => [k, String(r[i] ?? '').trim() || null])));
      if (!records.length) return notify.error('That file has no rows under its header.');
      const res = await importEmployees(records);
      if (res.failed) {
        const first = res.results.find((r) => !r.ok);
        notify.error(`${res.imported} imported, ${res.failed} not — row ${first.row}: ${first.error}`);
      } else {
        notify.success(`${res.imported} people imported.`);
      }
      loadLists().catch(() => {});
      load();
    } catch (e) {
      notify.error(String(e?.message || 'Import failed.'));
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
                    <span key={t.id} className="ui-pill" style={{ backgroundColor: `${t.color}22`, color: t.color }}>{t.name}</span>
                  ))}
                </span>
              </span>
            </button>
          ))}
        </div>
      ) : (
          <div className="ui-table-scroll">
            <table className="ui-table ui-table-sticky w-full">
              <thead>
                <tr>
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

const Field = ({ label, value }) => (
  <div>
    <dt className="ui-t-label">{label}</dt>
    <dd className="mt-0.5 text-sm">{value || <span className="ui-muted">Not set</span>}</dd>
  </div>
);

function EmployeeFile({ id, onClose, onEdit, onDeleted }) {
  const [person, setPerson] = useState(null);
  const perms = usePermissions();
  const allowed = (key) => Boolean(perms?.isAdmin || perms?.permissions?.has?.(key));
  const [resigning, setResigning] = useState(false);
  const [tab, setTab] = useState('about');
  const [notes, setNotes] = useState([]);
  const [draft, setDraft] = useState('');

  useEffect(() => {
    if (!id) return undefined;
    let cancelled = false;
    getEmployee(id)
      .then((r) => !cancelled && setPerson({ ...r.employee, scheduledChanges: r.scheduledChanges || [] }))
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
    const ok = await confirmDialog({ title: `Rehire ${person.name} from ${formatDateIn(rejoinDate)}?`, message: `A new stint starts on that date; their first joining date (${person.firstJoiningDate ? formatDateIn(person.firstJoiningDate) : 'on file'}) stays. They become active again and are put back on every reader; fingerprints and faces were deleted when they left, so they enrol again.`, confirmLabel: 'Rehire', tone: 'primary' });
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
              <button type="button" className="ui-btn ui-btn-secondary" onClick={() => setResigning(true)}>Record leaving</button>
            )}
            <button type="button" className="ui-btn ui-btn-primary" onClick={() => onEdit(person)}>Edit</button>
          </>
        ) : null
      }
    >
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
                {(person.tags || []).map((t) => (
                  <span key={t.id} className="ui-pill" style={{ backgroundColor: `${t.color}22`, color: t.color }}>{t.name}</span>
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
              <Field label="Gender" value={person.gender ? person.gender[0] + person.gender.slice(1).toLowerCase() : ''} />
              <Field label="Marital status" value={person.maritalStatus ? person.maritalStatus[0] + person.maritalStatus.slice(1).toLowerCase() : ''} />
              <Field label="Address" value={address} />
              <Field
                label="Emergency contact"
                value={[person.emergencyContactName, person.emergencyContactRelation, person.emergencyContactPhone].filter(Boolean).join(' · ')}
              />
            </dl>
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
              <Field label={person.currentEpisodeSeq > 1 ? `Joined (stint ${person.currentEpisodeSeq})` : 'Joined'} value={person.dateOfJoining} />
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
              <Field label="Probation ends" value={person.probationEndDate} />
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
          {tab === 'checklist' ? <EmployeeChecklist person={person} /> : null}
        </div>
      )}
    </Drawer>
  );
}

// ---------------------------------------------------------------------------

/* The fields whose change is recorded in employment history (server: TRACKED in services/people/employmentHistory.ts). */
/* The job fields a change may be dated for, as the record names them (server: SCHEDULABLE_FIELDS). */
const SCHEDULED_LABELS = { departmentId: 'Department', businessUnitId: 'Business unit', areaId: 'Location', branchId: 'Branch', establishmentId: 'Establishment', jobPositionId: 'Designation', jobRoleId: 'Job role', reportingManagerId: 'Reports to', dottedManagerId: 'Also reports to', employeeTypeId: 'Employee type', workTypeId: 'Work type', contractorId: 'Contractor', gradeId: 'Grade', costCenterId: 'Cost centre', status: 'Status' };
const HISTORY_FIELDS = ['businessUnitId', 'gradeId', 'costCenterId', 'departmentId', 'areaId', 'establishmentId', 'jobPositionId', 'jobRoleId', 'reportingManagerId', 'dottedManagerId', 'employeeTypeId', 'workTypeId', 'contractorId'];
const HISTORY_SOURCE = { FORM: 'Employee form', TRANSFER: 'Transfer', RESIGNATION: 'Resignation', REHIRE: 'Rehire', IMPORT: 'Import' };
const HISTORY_TONE = { JOINED: 'pos', LEFT: 'neg', REHIRED: 'pos', TRANSFERRED: 'warn', CHANGED: 'neutral' };

/**
 * Employment history: every change to where and how someone works, newest
 * first, each with the date it counts from, before and after, who recorded it
 * and what it means for payroll.
 */
function EmploymentHistory({ employeeId }) {
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
  if (!events.length) return <p className="ui-muted text-sm">No history yet. Changes to department, location, designation, manager, type and leaving are recorded here from now on.</p>;
  return (
    <>
    {episodes.length > 1 ? (
      <ol className="space-y-1 mb-3" aria-label="Stints">
        {episodes.map((st) => (
          <li key={st.seq} className="text-sm flex flex-wrap items-center gap-2">
            <span className={`ui-pill ${st.current ? 'ui-pill-pos' : 'ui-pill-neutral'}`}>Stint {st.seq}</span>
            <span className="tabular-nums">{formatDateIn(st.startDate)} – {st.endDate ? formatDateIn(st.endDate) : 'now'}</span>
            {st.endType ? <span className="ui-caption">{st.endType.replaceAll('_', ' ').toLowerCase()}{st.endReason ? ` · ${st.endReason}` : ''}</span> : null}
          </li>
        ))}
      </ol>
    ) : null}
    <ol className="space-y-3" aria-label="Employment history">
      {events.map((e) => (
        <li key={e.id} className="ui-card p-3 space-y-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="flex items-center gap-2">
              <span className={`ui-pill ui-pill-${HISTORY_TONE[e.kind] || 'neutral'}`}>{e.title}</span>
              <span className="text-sm font-medium tabular-nums">from {e.effectiveDate}</span>
            </span>
            <span className="ui-caption">{[HISTORY_SOURCE[e.source] || e.source, e.by].filter(Boolean).join(' · ')}</span>
          </div>
          {e.field ? (
            <p className="text-sm">
              <span className="ui-muted">{e.from || 'None'}</span> → <strong>{e.to || 'None'}</strong>
            </p>
          ) : null}
          {e.note ? <p className="text-sm">{e.note}</p> : null}
          {e.payrollImpact ? <p className="ui-caption">Impact: {e.payrollImpact}</p> : null}
        </li>
      ))}
    </ol>
    </>
  );
}

/**
 * Joining and leaving checklists: what is done and what is due, ticked here.
 * Started when someone joins or leaves; by hand for anyone added before.
 */
function EmployeeChecklist({ person }) {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState('');
  useEffect(() => {
    let live = true;
    getChecklist(person.id).then((d) => live && setData(d)).catch(() => live && setData({ joining: { tasks: [] }, leaving: { tasks: [] } }));
    return () => {
      live = false;
    };
  }, [person.id]);
  const tick = async (t) => {
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
          <div className="ui-meter" aria-hidden="true"><span style={{ width: `${Math.round((list.done / list.total) * 100)}%` }} /></div>
          <ul className="divide-y">
            {list.tasks.map((t) => (
              <li key={t.id} className="flex items-start gap-3 py-2">
                <input type="checkbox" className="mt-1" checked={t.done} disabled={busy === t.id} onChange={() => tick(t)} aria-label={t.title} />
                <div className="min-w-0 flex-1">
                  <p className={`text-sm ${t.done ? 'line-through ui-muted' : ''}`}>{t.title}</p>
                  <p className="ui-caption">
                    {CHECKLIST_OWNER[t.owner] || t.owner}
                    {t.dueDate ? <span className={t.overdue ? 'text-[rgb(var(--neg))] font-medium' : ''}> · due {t.dueDate}{t.overdue ? ' (late)' : ''}</span> : null}
                    {t.done && t.doneBy ? ` · done by ${t.doneBy}` : ''}
                  </p>
                  {t.note ? <p className="ui-caption">{t.note}</p> : null}
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
    </div>
  );
}

/**
 * Statutory and bank details, from Payroll's profile, masked (PE-05). Only for
 * someone who may see payroll profiles; nothing is changed here.
 */
function StatutoryDetails({ employeeId }) {
  const [d, setD] = useState(null);
  const [shown, setShown] = useState({});
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);
  const load = useCallback(() => getEmployeeStatutory(employeeId).then(setD).catch(() => setD({ visible: false })), [employeeId]);
  useEffect(() => {
    let live = true;
    getEmployeeStatutory(employeeId).then((x) => live && setD(x)).catch(() => live && setD({ visible: false }));
    return () => {
      live = false;
    };
  }, [employeeId]);
  if (!d?.visible) return null;
  /* A full value shows for a minute and is logged on the server; the client asks for the authenticator code when the server wants one. */
  const show = async (field) => {
    try {
      const value = await revealStatutory(employeeId, field);
      setShown((x) => ({ ...x, [field]: value || '—' }));
      setTimeout(() => setShown((x) => { const next = { ...x }; delete next[field]; return next; }), 60_000);
    } catch (e) {
      notify.error(String(e?.message || 'Not shown.'));
    }
  };
  const Masked = ({ label, field, value }) => (
    <div>
      <dt className="ui-t-label">{label}</dt>
      <dd className="mt-1 text-sm flex items-center gap-2">
        <span className="tabular-nums">{shown[field] ?? (value || 'Not set')}</span>
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
    <section className="mt-5 space-y-3" aria-label="Statutory details">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">Statutory details <span className="ui-caption font-normal">masked; a full value needs your authenticator code and is logged</span></h3>
        {d.canEdit && !editing ? <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={() => setEditing({ aadhaarLast4: '', passportNumber: '', passportExpiry: id.passportExpiry || '', workPermitNumber: '', workPermitExpiry: id.workPermitExpiry || '', statutoryCategory: id.statutoryCategory || '', categoryFrom: id.categoryFrom || '' })}>Edit identifiers</button> : null}
      </div>
      {editing ? (
        <form onSubmit={saveIdentityForm} className="ui-card p-3 grid gap-3 sm:grid-cols-2">
          <label className="block"><span className="ui-label">Aadhaar, last 4 digits</span><input className="ui-input w-full" value={editing.aadhaarLast4} maxLength={4} inputMode="numeric" placeholder={id.aadhaarLast4 ? 'unchanged' : '9012'} onChange={(e) => setEditing({ ...editing, aadhaarLast4: e.target.value })} /></label>
          <label className="block"><span className="ui-label">Statutory category</span>
            <select className="ui-select w-full" value={editing.statutoryCategory} onChange={(e) => setEditing({ ...editing, statutoryCategory: e.target.value })}>
              <option value="">— Not set —</option>
              {[['WORKER', 'Worker'], ['SUPERVISOR', 'Supervisor'], ['MANAGER', 'Manager'], ['APPRENTICE', 'Apprentice'], ['CONTRACT', 'Contract']].map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
          <label className="block"><span className="ui-label">Passport number</span><input className="ui-input w-full" value={editing.passportNumber} placeholder={id.passportNumber ? 'unchanged' : 'A1234567'} onChange={(e) => setEditing({ ...editing, passportNumber: e.target.value.toUpperCase() })} /></label>
          <label className="block"><span className="ui-label">Passport expiry</span><input type="date" className="ui-input w-full" value={editing.passportExpiry} onChange={(e) => setEditing({ ...editing, passportExpiry: e.target.value })} /></label>
          <label className="block"><span className="ui-label">Work permit number</span><input className="ui-input w-full" value={editing.workPermitNumber} placeholder={id.workPermitNumber ? 'unchanged' : ''} onChange={(e) => setEditing({ ...editing, workPermitNumber: e.target.value.toUpperCase() })} /></label>
          <label className="block"><span className="ui-label">Work permit expiry</span><input type="date" className="ui-input w-full" value={editing.workPermitExpiry} onChange={(e) => setEditing({ ...editing, workPermitExpiry: e.target.value })} /></label>
          <label className="block"><span className="ui-label">Category from</span><input type="date" className="ui-input w-full" value={editing.categoryFrom} onChange={(e) => setEditing({ ...editing, categoryFrom: e.target.value })} /></label>
          <div className="sm:col-span-2 flex justify-end gap-2">
            <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={() => setEditing(null)}>Cancel</button>
            <button type="submit" className="ui-btn ui-btn-primary ui-btn-sm" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
          </div>
        </form>
      ) : null}
      <dl className="grid gap-4 sm:grid-cols-2">
        <Field label="Aadhaar" value={id.aadhaarLast4} />
        <Masked label="Passport" field="passportNumber" value={id.passportNumber} />
        <Field label="Passport expiry" value={id.passportExpiry} />
        <Masked label="Work permit" field="workPermitNumber" value={id.workPermitNumber} />
        <Field label="Work permit expiry" value={id.workPermitExpiry} />
        <Field label="Statutory category" value={id.statutoryCategory ? `${id.statutoryCategory.charAt(0)}${id.statutoryCategory.slice(1).toLowerCase()}${id.categoryFrom ? ` from ${id.categoryFrom}` : ''}` : null} />
      </dl>
      <h4 className="text-sm font-semibold mt-2">From Payroll</h4>
      {d.inPayroll === false ? (
        <p className="ui-muted text-sm">Not set up in Payroll yet.</p>
      ) : (
        <dl className="grid gap-4 sm:grid-cols-2">
          <Masked label="PAN" field="pan" value={d.pan} />
          <Masked label="UAN" field="uan" value={d.uan} />
          <Masked label="ESIC number" field="esic" value={d.esic} />
          <Masked label="Bank account" field="account" value={[d.bank, d.account].filter(Boolean).join(' ')} />
          <Field label="IFSC" value={d.ifsc} />
          <Field label="Covered by" value={[d.pf && 'PF', d.esi && 'ESI', d.pt && `PT (${d.pt})`].filter(Boolean).join(' · ')} />
        </dl>
      )}
    </section>
  );
}

/** Someone leaving: last day, why. They come off every reader at once. */
function ResignForm({ person, onClose, onDone }) {
  const [form, setForm] = useState({ lastDay: new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10), leavingType: 'RESIGNED', reason: '' });
  const [saving, setSaving] = useState(false);
  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const r = await resignEmployee(person.id, { ...form, reason: form.reason || null });
      notify.success(r.readers ? `${person.name} recorded as left and removed from ${r.readers} reader${r.readers === 1 ? '' : 's'}.` : `${person.name} recorded as left.`);
      onDone(r.employee);
    } catch (err) {
      notify.error(String(err?.message || 'Not saved.'));
    } finally {
      setSaving(false);
    }
  };
  return (
    <Drawer
      open
      onClose={onClose}
      title={`${person.name} is leaving`}
      description="From the day after the last day they are not expected at work, and they come off every reader now."
      actions={
        <>
          <button type="button" className="ui-btn ui-btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" form="resign-form" className="ui-btn ui-btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Record leaving'}</button>
        </>
      }
    >
      <form id="resign-form" onSubmit={save} className="grid gap-4">
        <label className="block"><span className="ui-label">Last working day *</span><input type="date" className="ui-input w-full" required value={form.lastDay} onChange={(e) => setForm({ ...form, lastDay: e.target.value })} /></label>
        <label className="block">
          <span className="ui-label">Why</span>
          <select className="ui-select w-full" value={form.leavingType} onChange={(e) => setForm({ ...form, leavingType: e.target.value })}>
            {Object.entries(LEAVING_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <label className="block"><span className="ui-label">Note</span><input className="ui-input w-full" maxLength={500} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} /></label>
      </form>
    </Drawer>
  );
}

/** A square photo, scaled down to 160px and stored as a small JPEG data URL. */
const shrinkPhoto = (file) =>
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

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    const keys = [
      'name', 'firstName', 'lastName', 'code', 'email', 'phone', 'status', 'dateOfJoining', 'dateOfLeaving', 'gender', 'dateOfBirth',
      'maritalStatus', 'personalEmail', 'photoUrl', 'addressLine', 'city', 'state', 'country', 'pincode', 'emergencyContactName',
      'emergencyContactPhone', 'emergencyContactRelation', 'departmentId', 'jobPositionId', 'jobRoleId', 'employeeTypeId', 'workTypeId',
      'reportingManagerId', 'dottedManagerId', 'workEmail', 'workPhone', 'workLocation', 'devicePin', 'probationEndDate', 'contractEndDate', 'tagIds',
      'areaId', 'establishmentId', 'contractorId', 'businessUnitId', 'gradeId', 'costCenterId', 'cardNumber', 'devicePrivilege', 'attendanceRequired', 'guardianName',
    ];
    const body = Object.fromEntries(keys.filter((k) => form[k] !== undefined).map((k) => [k, form[k] === '' ? null : form[k]]));
    /* The reader PIN is write-only: sent only when typed. */
    if (form.devicePassword) body.devicePassword = form.devicePassword;
    if (moved) {
      body.effectiveFrom = form.effectiveFrom || today;
      if (form.changeNote) body.changeNote = form.changeNote;
    }
    try {
      const res = form.id ? await updateEmployee(form.id, body) : await createEmployee(body);
      notify.success(`${res.employee?.name || 'Employee'} saved.`);
      onSaved(res.employee);
    } catch (err) {
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
          {lists.areas.length ? select('areaId', 'Location', lists.areas) : null}
          {lists.centres.length ? select('costCenterId', 'Cost centre', lists.centres) : null}
          {select('reportingManagerId', 'Reports to', people.filter((p) => p.id !== form.id && p.status !== 'LEFT'))}
          {select('dottedManagerId', 'Also reports to (dotted line)', people.filter((p) => p.id !== form.id && p.status !== 'LEFT'))}
        </section>

        <section className="grid gap-4 sm:grid-cols-2">
          <h3 className="ui-t-sec sm:col-span-2">Employment</h3>
          {select('employeeTypeId', 'Employee type', lists.types)}
          {select('workTypeId', 'Work type', lists.workTypes)}
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
          {select('gender', 'Gender', [{ id: 'MALE', label: 'Male' }, { id: 'FEMALE', label: 'Female' }, { id: 'OTHER', label: 'Other' }])}
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
                    style={on ? { backgroundColor: t.color, color: '#fff' } : { backgroundColor: `${t.color}22`, color: t.color }}
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
  ['OTHER', 'Other'],
];
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
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) return notify.error('Files up to 5 MB.');
    setBusy(true);
    try {
      const dataUrl = await new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = () => reject(new Error('Could not read the file.')); r.readAsDataURL(file); });
      await uploadDocument(employeeId, { ...form, title: form.title.trim() || file.name.replace(/\.[^.]+$/, ''), expiresOn: form.expiresOn || null, data: dataUrl, mime: file.type });
      setFile(null);
      setForm({ kind: 'ID_PROOF', title: '', expiresOn: '', classification: 'EMPLOYEE_VISIBLE' });
      if (input.current) input.current.value = '';
      notify.success('Added to the file.');
      load();
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
  const remove = async (d) => {
    if (!(await confirmDialog({ title: `Remove ${d.title}?`, message: 'The file is deleted from the record.', confirmLabel: 'Remove' }))) return;
    await deleteDocument(d.id).catch((e) => notify.error(String(e?.message || 'Could not remove.')));
    load();
  };
  const [today] = useState(() => new Date().toISOString().slice(0, 10));

  return (
    <div className="space-y-3">
      <form onSubmit={upload} className="ui-card p-3 space-y-2">
        <div className="flex flex-wrap gap-2">
          <select className="ui-select" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })} aria-label="Kind">
            {DOC_KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
          <input className="ui-input flex-1 min-w-[10rem]" placeholder="Title (blank: the file name)" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} aria-label="Title" />
          <input type="date" className="ui-input" style={{ width: 'auto' }} value={form.expiresOn} onChange={(e) => setForm({ ...form, expiresOn: e.target.value })} aria-label="Valid until" title="Valid until (optional)" />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <input ref={input} type="file" accept=".pdf,.jpg,.jpeg,.png,.webp,.doc,.docx,.xlsx,.txt" className="text-sm" onChange={(e) => setFile(e.target.files?.[0] || null)} aria-label="File" />
          <label className="flex items-center gap-1.5 text-sm">Who can see
            <select className="ui-select" style={{ width: 'auto' }} value={form.classification} onChange={(e) => setForm({ ...form, classification: e.target.value })} aria-label="Who can see">
              {DOC_WHO_CAN_SEE.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </label>
          <button type="submit" className="ui-btn ui-btn-primary ui-btn-sm ml-auto" disabled={!file || busy}>{busy ? 'Uploading…' : 'Add to file'}</button>
        </div>
      </form>
      {!docs ? <p className="ui-caption">Loading…</p> : !docs.length ? <p className="ui-caption">No documents on this file yet.</p> : (
        <ul className="space-y-2">
          {docs.map((d) => (
            <li key={d.id} className="ui-card p-3 text-sm flex flex-wrap items-center gap-2">
              <span className="min-w-0 flex-1">
                <span className="font-medium">{d.title}</span>
                <span className="ui-caption block">{DOC_KINDS.find(([k]) => k === d.kind)?.[1] || d.kind} · {kb(d.size)} · {new Date(d.createdAt).toLocaleDateString('en-IN', { dateStyle: 'medium' })}{d.expiresOn ? ` · valid until ${d.expiresOn}` : ''}{d.classification !== 'EMPLOYEE_VISIBLE' ? ` · ${docWhoLabel(d)}` : ''}</span>
                {d.expiresOn && d.expiresOn < today ? <span className="ui-pill ui-pill-neg mt-1">Expired</span> : null}
              </span>
              <button type="button" className="ui-link" onClick={() => open(d)}>Download</button>
              <button type="button" className="ui-link" onClick={() => remove(d)}>Remove</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
