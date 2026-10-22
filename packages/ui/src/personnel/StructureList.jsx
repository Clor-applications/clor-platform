import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';

import { SkeletonCard, EmptyState } from '@ui/components/ui/Primitives';
import { ColumnHeader, useColumnFilters } from '@ui/components/ColumnFilters';
import { useListSearch } from '@ui/components/ListToolbar';
import DocumentListShell from '@ui/components/list/DocumentListShell';
import { exportFormatFromKey, exportMenuItem, runListExport } from '@ui/components/list/exportMenu';
import Drawer from '@ui/components/ui/Drawer';
import { confirmDialog, notify } from '@ui/components/ui/notify';
import { createStructure, deleteStructure, listStructure, updateStructure } from './api';

/**
 * One screen for the five org-structure lists: departments, job positions,
 * job roles, employee types and work types. Each may hang under another
 * (a sub-department, a position in a department, a role in a position).
 */
const KINDS = {
  departments: {
    title: 'Departments',
    singular: 'department',
    description: 'How the company is divided. A department can sit under another.',
    parent: { key: 'parentId', kind: 'departments', label: 'Under department' },
  },
  'job-positions': {
    title: 'Job Positions',
    singular: 'job position',
    description: 'The designations people hold — Accountant, Store Manager, Driver.',
    parent: { key: 'departmentId', kind: 'departments', label: 'Department' },
  },
  'job-roles': {
    title: 'Job Roles',
    singular: 'job role',
    description: 'Finer roles inside a position — Senior, Trainee, Night shift.',
    parent: { key: 'jobPositionId', kind: 'job-positions', label: 'Job position' },
  },
  'employee-types': {
    title: 'Employee Types',
    singular: 'employee type',
    description: 'Permanent, probation, contract, intern, consultant.',
  },
  'work-types': {
    title: 'Work Types',
    singular: 'work type',
    description: 'Where the work happens — office, remote, hybrid, field.',
  },
  areas: {
    title: 'Areas',
    singular: 'area',
    description: 'Sites and zones people work at — a plant, a branch, a floor. An area can sit inside another.',
    parent: { key: 'parentId', kind: 'areas', label: 'Inside area' },
  },
  'business-units': {
    title: 'Business Units',
    singular: 'business unit',
    description: 'The divisions or domains the company runs as one business — Retail, Manufacturing, Services.',
  },
  grades: {
    title: 'Grades',
    singular: 'grade',
    description: 'Levels or pay bands — L1, L2, M1 — that group designations and salaries.',
  },
  'cost-centres': {
    title: 'Cost Centres',
    singular: 'cost centre',
    description: 'Where a person’s salary cost is booked in the accounts — a plant, a project, a client.',
  },
};

const TABS = [
  { value: 'active', label: 'Active', tone: 'paid' },
  { value: 'inactive', label: 'Inactive', tone: 'cancelled' },
  { value: '', label: 'All', tone: 'all' },
];

/* `title` and `singular` let an app name a list in its own words (Attendance's
   "Designations" for job positions); without them the list keeps its own. */
export default function StructureList({ kind, title = '', singular = '' }) {
  /* Memoised: load() depends on cfg, and a fresh object each render re-ran it without end. */
  const cfg = useMemo(() => ({ ...KINDS[kind], ...(title ? { title } : {}), ...(singular ? { singular } : {}) }), [kind, title, singular]);
  const [tab, setTab] = useState('active');
  const [rows, setRows] = useState([]);
  const [parents, setParents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const [items, parentItems] = await Promise.all([
        listStructure(kind),
        cfg.parent ? listStructure(cfg.parent.kind) : Promise.resolve([]),
      ]);
      setRows(items);
      setParents(parentItems);
      setError('');
    } catch (e) {
      setError(String(e?.message || `Could not load ${cfg.title.toLowerCase()}.`));
    } finally {
      setLoading(false);
    }
  }, [kind, cfg]);

  useEffect(() => {
    setLoading(true);
    load();
  }, [load]);

  const parentName = useMemo(() => new Map(parents.map((p) => [p.id, p.name])), [parents]);

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const body = { name: editing.name, description: editing.description || null, isActive: editing.isActive !== false };
      if (cfg.parent) body[cfg.parent.key] = editing[cfg.parent.key] || null;
      if (editing.id) await updateStructure(kind, editing.id, body);
      else await createStructure(kind, body);
      notify.success(`${editing.name} saved.`);
      setEditing(null);
      load();
    } catch (err) {
      notify.error(String(err?.message || 'Not saved.'));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (row) => {
    const ok = await confirmDialog({
      title: `Delete ${row.name}?`,
      message: `Only a ${cfg.singular} nobody is in can be deleted. One in use can be marked inactive instead.`,
      confirmLabel: 'Yes, delete',
    });
    if (!ok) return;
    try {
      await deleteStructure(kind, row.id);
      notify.success(`${row.name} deleted.`);
      load();
    } catch (err) {
      notify.error(String(err?.message || 'Could not delete it.'));
    }
  };

  const counts = useMemo(() => ({ '': rows.length, active: rows.filter((r) => r.isActive).length, inactive: rows.filter((r) => !r.isActive).length }), [rows]);
  const inTab = useMemo(() => rows.filter((r) => !tab || (tab === 'active') === Boolean(r.isActive)), [rows, tab]);
  const search = useListSearch(inTab, ['name', 'description']);
  const columns = useColumnFilters();
  const shown = columns.applyFilters(search.filtered, {
    name: (r) => r.name,
    parent: (r) => (cfg.parent ? parentName.get(r[cfg.parent.key]) || '' : ''),
  });

  if (loading) return <SkeletonCard lines={5} />;
  const newRow = () => setEditing({ name: '', description: '', isActive: true });

  return (
    <DocumentListShell
      entity="settings"
      title={cfg.title}
      compact
      tight
      search={{ value: search.query, onChange: search.setQuery, placeholder: `Search ${cfg.title.toLowerCase()}…`, label: `Search ${cfg.title.toLowerCase()}` }}
      moreItems={[exportMenuItem(`Export ${cfg.title.toLowerCase()}`)]}
      onMoreSelect={(k) => {
        const format = exportFormatFromKey(k);
        if (!format) return;
        runListExport({
          format,
          title: cfg.title,
          fileName: cfg.title,
          label: `${cfg.singular}/${cfg.title.toLowerCase()}`,
          columns: [
            { key: 'name', label: 'Name' },
            ...(cfg.parent ? [{ key: 'parent', label: cfg.parent.label, value: (r) => parentName.get(r[cfg.parent.key]) || '' }] : []),
            { key: 'employeeCount', label: 'People', value: (r) => r.employeeCount || 0 },
            { key: 'isActive', label: 'Status', value: (r) => (r.isActive ? 'Active' : 'Inactive') },
            { key: 'description', label: 'Description' },
          ],
          rows: shown,
        });
      }}
      primary={
        <button type="button" className="ui-btn ui-btn-primary" onClick={newRow}>
          <Plus size={16} aria-hidden="true" /> New {cfg.singular}
        </button>
      }
      tabs={TABS}
      statusValue={tab}
      statusCounts={counts}
      onStatusChange={setTab}
      tabsLabel={`${cfg.title} status`}
    >
      {error ? (
        <div className="p-3 text-sm" role="alert" style={{ color: 'rgb(var(--neg))' }}>
          {error}
        </div>
      ) : null}

          <div className="ui-table-scroll">
            <table className="ui-table ui-table-sticky w-full">
              <thead>
                <tr>
                  <ColumnHeader label="Name" col="name" state={columns} className="ui-col-grow" />
                  {cfg.parent ? <ColumnHeader label={cfg.parent.label} col="parent" state={columns} /> : null}
                  <th scope="col" className="ui-col-h-center">People</th>
                  <th scope="col" className="ui-col-h-center">Status</th>
                  <th scope="col" className="ui-col-h-center w-10">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody className="ui-rows">
                {!shown.length ? (
                  <tr>
                    <td colSpan={cfg.parent ? 5 : 4}>
                      {rows.length ? (
                        <EmptyState kind="filtered" totalCount={inTab.length || rows.length} title={`No ${cfg.title.toLowerCase()} match`} description="Nothing in this tab matches the search or the column filters." />
                      ) : (
                        <EmptyState
                          title={`No ${cfg.title.toLowerCase()} yet`}
                          description={cfg.description}
                          routes={[{ label: `New ${cfg.singular}`, description: cfg.description, onSelect: newRow }]}
                        />
                      )}
                    </td>
                  </tr>
                ) : (
                  shown.map((r) => (
                  <tr key={r.id} className="ui-row-click" onClick={() => setEditing({ ...r })}>
                    <td className="ui-col-entity">
                      {r.name}
                      {r.description ? <div className="ui-caption truncate">{r.description}</div> : null}
                    </td>
                    {cfg.parent ? <td className="ui-col-meta">{parentName.get(r[cfg.parent.key]) || '—'}</td> : null}
                    <td className="ui-col-h-center">{r.employeeCount || 0}</td>
                    <td className="ui-col-h-center">
                      <span className={`ui-pill ${r.isActive ? 'ui-pill-pos' : 'ui-pill-neutral'}`}>{r.isActive ? 'Active' : 'Inactive'}</span>
                    </td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <button type="button" className="ui-icon-btn" aria-label={`Delete ${r.name}`} onClick={() => remove(r)}>
                        <Trash2 size={16} aria-hidden="true" />
                      </button>
                    </td>
                  </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

      <Drawer
      widthClass="w-[min(40rem,96vw)]"
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
        title={editing?.id ? `Edit ${cfg.singular}` : `New ${cfg.singular}`}
        actions={
          <>
            <button type="button" className="ui-btn ui-btn-secondary" onClick={() => setEditing(null)}>Cancel</button>
            <button type="submit" form="structure-form" className="ui-btn ui-btn-primary" disabled={saving || !editing?.name?.trim()}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          </>
        }
      >
        {editing ? (
          <form id="structure-form" onSubmit={save} className="grid gap-4">
            <label className="block">
              <span className="ui-label">Name *</span>
              <input className="ui-input w-full" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} required autoFocus />
            </label>
            {cfg.parent ? (
              <label className="block">
                <span className="ui-label">{cfg.parent.label}</span>
                <select
                  className="ui-select w-full"
                  value={editing[cfg.parent.key] || ''}
                  onChange={(e) => setEditing({ ...editing, [cfg.parent.key]: e.target.value })}
                >
                  <option value="">— None —</option>
                  {parents.filter((p) => p.id !== editing.id).map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </label>
            ) : null}
            <label className="block">
              <span className="ui-label">Description</span>
              <textarea className="ui-input w-full" rows={3} value={editing.description || ''} onChange={(e) => setEditing({ ...editing, description: e.target.value })} />
            </label>
            {editing.id ? (
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" className="ui-checkbox" checked={editing.isActive !== false} onChange={(e) => setEditing({ ...editing, isActive: e.target.checked })} />
                Active
              </label>
            ) : null}
          </form>
        ) : null}
      </Drawer>
    </DocumentListShell>
  );
}

export const Departments = () => <StructureList kind="departments" />;
export const JobPositions = (props) => <StructureList kind="job-positions" {...props} />;
export const JobRoles = () => <StructureList kind="job-roles" />;
export const EmployeeTypes = () => <StructureList kind="employee-types" />;
export const WorkTypes = () => <StructureList kind="work-types" />;
export const Areas = (props) => <StructureList kind="areas" {...props} />;
export const BusinessUnits = (props) => <StructureList kind="business-units" {...props} />;
export const Grades = (props) => <StructureList kind="grades" {...props} />;
export const CostCentres = (props) => <StructureList kind="cost-centres" {...props} />;
