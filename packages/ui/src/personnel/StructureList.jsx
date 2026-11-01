import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Trash2 } from '@ui/components/ui/lineIcons';

import { SkeletonCard, EmptyState } from '@ui/components/ui/Primitives';
import { ColumnHeader, useColumnFilters } from '@ui/components/ColumnFilters';
import { useListSearch } from '@ui/components/ListToolbar';
import DocumentListShell from '@ui/components/list/DocumentListShell';
import { exportFormatFromKey, exportMenuItem, runListExport } from '@ui/components/list/exportMenu';
import Drawer from '@ui/components/ui/Drawer';
import { confirmDialog, notify } from '@ui/components/ui/notify';
import { createStructure, deleteStructure, listStructure, updateStructure } from './api';

/**
 * One screen for the org-structure lists Attendance still shows: departments,
 * job positions and areas. Each may hang under another (a sub-department, a
 * position in a department, an area inside an area).
 */
const KINDS = {
  departments: {
    title: 'Departments',
    singular: 'department',
    description: 'How the company is divided. A department can sit under another.',
    parent: { key: 'parentId', kind: 'departments', label: 'Under department' },
  },
  'job-positions': {
    title: 'Designations',
    singular: 'designation',
    description: 'The designations people hold — Accountant, Store Manager, Driver.',
    parent: { key: 'departmentId', kind: 'departments', label: 'Department' },
  },
  areas: {
    title: 'Areas',
    singular: 'area',
    description: 'Sites and zones people work at — a plant, a branch, a floor. An area can sit inside another.',
    parent: { key: 'parentId', kind: 'areas', label: 'Inside area' },
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

  /* Moving from one list to another quickly: the list asked for last wins, an older answer is dropped. */
  const seq = useRef(0);
  const load = useCallback(async () => {
    const n = ++seq.current;
    try {
      const [items, parentItems] = await Promise.all([
        listStructure(kind),
        cfg.parent ? listStructure(cfg.parent.kind) : Promise.resolve([]),
      ]);
      if (n !== seq.current) return;
      setRows(items);
      setParents(parentItems);
      setError('');
    } catch (e) {
      if (n !== seq.current) return;
      setError(String(e?.message || `Could not load ${cfg.title.toLowerCase()}.`));
    } finally {
      if (n === seq.current) setLoading(false);
    }
  }, [kind, cfg]);

  /* Another kind of list: the last one's rows would show under the new title while it loads. */
  useEffect(() => {
    setRows([]);
    setParents([]);
    setEditing(null);
  }, [kind]);

  useEffect(() => {
    setLoading(true);
    load();
  }, [load]);

  const parentName = useMemo(() => new Map(parents.map((p) => [p.id, p.name])), [parents]);

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const body = { name: editing.name, ...(cfg.noDescription ? {} : { description: editing.description || null }), isActive: editing.isActive !== false };
      if (cfg.parent) body[cfg.parent.key] = editing[cfg.parent.key] || null;
      for (const f of cfg.fields || []) body[f.key] = editing[f.key] || null;
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
    ...Object.fromEntries((cfg.columns || []).map((c) => [c.key, (r) => (c.value ? c.value(r) : r[c.key]) || ''])),
  });

  if (loading) return <SkeletonCard lines={5} />;
  const newRow = () => setEditing({ name: '', description: '', isActive: true, ...Object.fromEntries((cfg.fields || []).filter((f) => f.type === 'select' && f.options?.length).map((f) => [f.key, f.options[0][0]])) });

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
                  {(cfg.columns || []).map((c) => <ColumnHeader key={c.key} label={c.label} col={c.key} state={columns} />)}
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
                    <td colSpan={(cfg.parent ? 5 : 4) + (cfg.columns || []).length}>
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
                    {(cfg.columns || []).map((c) => <td key={c.key} className="ui-col-meta">{(c.value ? c.value(r) : r[c.key]) || '—'}</td>)}
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
            {(cfg.fields || []).map((f) => f.type === 'checkbox' ? (
              <label key={f.key} className="block text-sm">
                <span className="flex items-center gap-2"><input type="checkbox" className="ui-checkbox" checked={Boolean(editing[f.key])} onChange={(e) => setEditing({ ...editing, [f.key]: e.target.checked })} />{f.label}</span>
                {f.hint ? <span className="ui-caption block mt-1">{f.hint}</span> : null}
              </label>
            ) : (
              <label key={f.key} className="block">
                <span className="ui-label">{f.label}{f.required ? ' *' : ''}</span>
                {f.type === 'select' ? (
                  <select className="ui-select w-full" value={editing[f.key] || f.options?.[0]?.[0] || ''} onChange={(e) => setEditing({ ...editing, [f.key]: e.target.value })}>
                    {(f.options || []).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                ) : f.type === 'textarea' ? (
                  <textarea className="ui-input w-full" rows={2} value={editing[f.key] || ''} onChange={(e) => setEditing({ ...editing, [f.key]: e.target.value })} />
                ) : (
                  <input className="ui-input w-full" value={editing[f.key] || ''} placeholder={f.placeholder || ''} required={Boolean(f.required)} onChange={(e) => setEditing({ ...editing, [f.key]: e.target.value })} />
                )}
              </label>
            ))}
            {cfg.noDescription ? null : (
              <label className="block">
                <span className="ui-label">Description</span>
                <textarea className="ui-input w-full" rows={3} value={editing.description || ''} onChange={(e) => setEditing({ ...editing, description: e.target.value })} />
              </label>
            )}
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
export const Areas = (props) => <StructureList kind="areas" {...props} />;
