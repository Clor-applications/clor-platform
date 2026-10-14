import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Download, LayoutGrid, List, Plus, Search, Trash2, Upload, UserRound } from 'lucide-react';

import { SkeletonCard, EmptyState } from '@ui/components/ui/Primitives';
import { PageHeader } from '@ui/components/ui/Primitives';
import Drawer from '@ui/components/ui/Drawer';
import { confirmDialog, notify } from '@ui/components/ui/notify';
import { downloadCsv, downloadCsvTemplate, parseCsv, readFileText } from '@ui/utils/csv';
import {
  addNote,
  createEmployee,
  deleteEmployee,
  deleteNote,
  getEmployee,
  importEmployees,
  listEmployees,
  listNotes,
  listStructure,
  listTags,
  updateEmployee,
} from '../api/people';

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

export default function Employees() {
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [view, setView] = useState(() => {
    try {
      return localStorage.getItem('people.view') || 'cards';
    } catch {
      return 'cards';
    }
  });
  const [filters, setFilters] = useState({ q: '', status: 'ACTIVE', departmentId: '', jobPositionId: '', employeeTypeId: '', tagId: '' });
  const [lists, setLists] = useState({ departments: [], positions: [], roles: [], types: [], workTypes: [], tags: [] });
  const [openId, setOpenId] = useState(null);
  const [editing, setEditing] = useState(null);
  const fileRef = useRef(null);

  const loadLists = useCallback(async () => {
    const [departments, positions, roles, types, workTypes, tags] = await Promise.all([
      listStructure('departments'),
      listStructure('job-positions'),
      listStructure('job-roles'),
      listStructure('employee-types'),
      listStructure('work-types'),
      listTags(),
    ]);
    setLists({ departments, positions, roles, types, workTypes, tags });
  }, []);

  const load = useCallback(async () => {
    try {
      const res = await listEmployees({ ...filters, limit: 500 });
      setRows(res?.employees || []);
      setTotal(res?.total || 0);
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
      className="ui-select ui-select-sm"
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

  if (loading) return <SkeletonCard lines={6} />;

  return (
    <div className="space-y-4">
      <PageHeader
        entity="people"
        title="Employees"
        description={`${total} ${total === 1 ? 'person' : 'people'}`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex rounded-lg border" style={{ borderColor: 'rgb(var(--border))' }} role="group" aria-label="View">
              <button type="button" className="ui-icon-btn" aria-pressed={view === 'cards'} aria-label="Cards" onClick={() => setViewMode('cards')}>
                <LayoutGrid size={16} />
              </button>
              <button type="button" className="ui-icon-btn" aria-pressed={view === 'list'} aria-label="List" onClick={() => setViewMode('list')}>
                <List size={16} />
              </button>
            </div>
            <button type="button" className="ui-btn ui-btn-secondary" onClick={() => downloadCsv({ fileName: 'Employees', columns: EXPORT_COLUMNS, rows })}>
              <Download size={16} aria-hidden="true" /> Export
            </button>
            <button type="button" className="ui-btn ui-btn-secondary" onClick={() => fileRef.current?.click()}>
              <Upload size={16} aria-hidden="true" /> Import
            </button>
            <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => onImport(e.target.files?.[0])} />
            <button type="button" className="ui-btn ui-btn-primary" onClick={() => setEditing({ status: 'ACTIVE', tagIds: [] })}>
              <Plus size={16} aria-hidden="true" /> New employee
            </button>
          </div>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <label className="relative block w-full sm:w-72">
          <Search size={15} className="ui-subtle absolute start-3 top-1/2 -translate-y-1/2" aria-hidden="true" />
          <input
            className="ui-input w-full ps-9"
            placeholder="Search name, ID, email, phone"
            aria-label="Search employees"
            value={filters.q}
            onChange={(e) => setFilters((f) => ({ ...f, q: e.target.value }))}
          />
        </label>
        {filterSelect('status', 'Status', STATUSES)}
        {filterSelect('departmentId', 'Department', lists.departments)}
        {filterSelect('jobPositionId', 'Position', lists.positions)}
        {filterSelect('employeeTypeId', 'Type', lists.types)}
        {lists.tags.length ? filterSelect('tagId', 'Tag', lists.tags) : null}
        <button
          type="button"
          className="ui-link text-sm"
          onClick={() => downloadCsvTemplate({ fileName: 'Employees import template', columns: IMPORT_COLUMNS, sample: { name: 'Asha Rao', code: 'E-001', department: 'Finance', jobPosition: 'Accountant', dateOfJoining: '2026-04-01', gender: 'FEMALE' } })}
        >
          Import template
        </button>
      </div>

      {error ? (
        <div className="ui-card p-3 text-sm" role="alert" style={{ borderColor: 'rgb(var(--neg))', color: 'rgb(var(--neg))' }}>{error}</div>
      ) : null}

      {rows.length === 0 ? (
        <EmptyState
          title="Nobody here yet"
          description="Add people one at a time, or import a spreadsheet using the template."
          action={
            <button type="button" className="ui-btn ui-btn-primary" onClick={() => setEditing({ status: 'ACTIVE', tagIds: [] })}>
              <Plus size={16} aria-hidden="true" /> New employee
            </button>
          }
        />
      ) : view === 'cards' ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
          {rows.map((p) => (
            <button key={p.id} type="button" className="ui-card flex items-start gap-3 p-4 text-left ui-hover-sunken" onClick={() => setOpenId(p.id)}>
              <Avatar person={p} size={44} />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{p.name}</span>
                <span className="block truncate ui-caption">{[p.designation, p.department].filter(Boolean).join(' · ') || '—'}</span>
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
        <div className="ui-card overflow-hidden">
          <div className="overflow-x-auto ui-table-scroll">
            <table className="ui-table w-full">
              <thead>
                <tr>
                  <th scope="col" className="ui-th">Employee</th>
                  <th scope="col" className="ui-th">ID</th>
                  <th scope="col" className="ui-th">Department</th>
                  <th scope="col" className="ui-th">Position</th>
                  <th scope="col" className="ui-th">Reports to</th>
                  <th scope="col" className="ui-th ui-col-h-center">Joined</th>
                  <th scope="col" className="ui-th ui-col-h-center">Status</th>
                </tr>
              </thead>
              <tbody>
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
                    <td className="ui-col-h-center">{p.dateOfJoining || '—'}</td>
                    <td className="ui-col-h-center"><span className={`ui-pill ${statusOf(p.status).pill}`}>{statusOf(p.status).label}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
          people={rows}
          onClose={() => setEditing(null)}
          onSaved={(saved) => {
            setEditing(null);
            load();
            if (saved?.id) setOpenId(saved.id);
          }}
        />
      ) : null}
    </div>
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
  const [tab, setTab] = useState('about');
  const [notes, setNotes] = useState([]);
  const [draft, setDraft] = useState('');

  useEffect(() => {
    if (!id) return undefined;
    let cancelled = false;
    getEmployee(id)
      .then((r) => !cancelled && setPerson(r.employee))
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
            <button type="button" className="ui-btn ui-btn-primary" onClick={() => onEdit(person)}>Edit</button>
          </>
        ) : null
      }
    >
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
              ['notes', 'Notes'],
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
            <dl className="grid gap-4 sm:grid-cols-2">
              <Field label="Employee ID" value={person.code} />
              <Field label="Department" value={person.department} />
              <Field label="Job position" value={person.designation} />
              <Field label="Reports to" value={person.reportingManagerName} />
              <Field label="Work email" value={person.workEmail} />
              <Field label="Work phone" value={person.workPhone} />
              <Field label="Work location" value={person.workLocation} />
              <Field label="Joined" value={person.dateOfJoining} />
              <Field label="Probation ends" value={person.probationEndDate} />
              <Field label="Contract ends" value={person.contractEndDate} />
              <Field label="Left" value={person.dateOfLeaving} />
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
        </div>
      )}
    </Drawer>
  );
}

// ---------------------------------------------------------------------------

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

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    const keys = [
      'name', 'firstName', 'lastName', 'code', 'email', 'phone', 'status', 'dateOfJoining', 'dateOfLeaving', 'gender', 'dateOfBirth',
      'maritalStatus', 'personalEmail', 'photoUrl', 'addressLine', 'city', 'state', 'country', 'pincode', 'emergencyContactName',
      'emergencyContactPhone', 'emergencyContactRelation', 'departmentId', 'jobPositionId', 'jobRoleId', 'employeeTypeId', 'workTypeId',
      'reportingManagerId', 'workEmail', 'workPhone', 'workLocation', 'probationEndDate', 'contractEndDate', 'tagIds',
    ];
    const body = Object.fromEntries(keys.filter((k) => form[k] !== undefined).map((k) => [k, form[k] === '' ? null : form[k]]));
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

        <section className="grid gap-4 sm:grid-cols-2">
          <h3 className="ui-t-sec sm:col-span-2">Personal</h3>
          {input('firstName', 'First name', { autoFocus: true })}
          {input('lastName', 'Last name')}
          {input('email', 'Personal email', { type: 'email' })}
          {input('phone', 'Phone', { type: 'tel' })}
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

        <section className="grid gap-4 sm:grid-cols-2">
          <h3 className="ui-t-sec sm:col-span-2">Work</h3>
          {input('code', 'Employee ID')}
          {select('status', 'Status', STATUSES, {}, { required: true })}
          {select('departmentId', 'Department', lists.departments)}
          {select('jobPositionId', 'Job position', positions)}
          {select('jobRoleId', 'Job role', roles)}
          {select('employeeTypeId', 'Employee type', lists.types)}
          {select('workTypeId', 'Work type', lists.workTypes)}
          {select('reportingManagerId', 'Reports to', people.filter((p) => p.id !== form.id && p.status !== 'LEFT'))}
          {input('workEmail', 'Work email', { type: 'email' })}
          {input('workPhone', 'Work phone', { type: 'tel' })}
          {input('workLocation', 'Work location')}
          {input('dateOfJoining', 'Date of joining', { type: 'date' })}
          {input('probationEndDate', 'Probation ends', { type: 'date' })}
          {input('contractEndDate', 'Contract ends', { type: 'date' })}
          {form.status === 'LEFT' || form.dateOfLeaving ? input('dateOfLeaving', 'Date of leaving', { type: 'date' }) : null}
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
