import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';

import { SkeletonCard, EmptyState } from '@ui/components/ui/Primitives';
import SettingsScreenHeader from '@ui/chrome/SettingsScreenHeader';
import Drawer from '@ui/components/ui/Drawer';
import { confirmDialog, notify } from '@ui/components/ui/notify';
import { createStructure, deleteStructure, listStructure, updateStructure } from '../api/people';

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
    title: 'Job positions',
    singular: 'job position',
    description: 'The designations people hold — Accountant, Store Manager, Driver.',
    parent: { key: 'departmentId', kind: 'departments', label: 'Department' },
  },
  'job-roles': {
    title: 'Job roles',
    singular: 'job role',
    description: 'Finer roles inside a position — Senior, Trainee, Night shift.',
    parent: { key: 'jobPositionId', kind: 'job-positions', label: 'Job position' },
  },
  'employee-types': {
    title: 'Employee types',
    singular: 'employee type',
    description: 'Permanent, probation, contract, intern, consultant.',
  },
  'work-types': {
    title: 'Work types',
    singular: 'work type',
    description: 'Where the work happens — office, remote, hybrid, field.',
  },
};

export default function StructureList({ kind }) {
  const cfg = KINDS[kind];
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

  if (loading) return <SkeletonCard lines={5} />;
  const newRow = () => setEditing({ name: '', description: '', isActive: true });

  return (
    <div className="space-y-6">
      <SettingsScreenHeader
        entity="settings"
        title={cfg.title}
        description={cfg.description}
        actions={
          <button type="button" className="ui-btn ui-btn-primary" onClick={newRow}>
            <Plus size={16} aria-hidden="true" /> New {cfg.singular}
          </button>
        }
      />

      {error ? (
        <div className="ui-card p-3 text-sm" role="alert" style={{ borderColor: 'rgb(var(--neg))', color: 'rgb(var(--neg))' }}>
          {error}
        </div>
      ) : null}

      {rows.length === 0 ? (
        <EmptyState title={`No ${cfg.title.toLowerCase()} yet`} description={cfg.description} />
      ) : (
        <div className="ui-card overflow-hidden">
          <div className="overflow-x-auto ui-table-scroll">
            <table className="ui-table w-full">
              <thead>
                <tr>
                  <th scope="col" className="ui-th">Name</th>
                  {cfg.parent ? <th scope="col" className="ui-th">{cfg.parent.label}</th> : null}
                  <th scope="col" className="ui-th ui-col-h-center">People</th>
                  <th scope="col" className="ui-th ui-col-h-center">Status</th>
                  <th scope="col" className="ui-th ui-col-h-center w-10">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
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
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <Drawer
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
    </div>
  );
}

export const Departments = () => <StructureList kind="departments" />;
export const JobPositions = () => <StructureList kind="job-positions" />;
export const JobRoles = () => <StructureList kind="job-roles" />;
export const EmployeeTypes = () => <StructureList kind="employee-types" />;
export const WorkTypes = () => <StructureList kind="work-types" />;
