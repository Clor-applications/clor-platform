import React, { useMemo, useRef, useState } from 'react';
import { Plus } from 'lucide-react';

import { EmptyState, PageHeader } from '@ui/components/ui/Primitives';
import DataTable from '@ui/components/ui/DataTable';
import SearchField from '@ui/components/ui/SearchField';
import Drawer from '@ui/components/ui/Drawer';
import ErrorState from '@ui/components/ui/ErrorState';
import PopupSelect from '@ui/components/pickers/PopupSelect';
import useRequest from '@ui/components/ui/useRequest';
import { useTabIndicator } from '@ui/components/ui/RecordTabs';
import { confirmDialog, notify } from '@ui/components/ui/notify';
import { usePermissions } from '@ui/permissions/usePermissions';
import { GST_STATE_BY_CODE } from '@ui/utils/gst';

import { can } from '../workforce/shared';
import { createItem, deleteItem, listItems, mergeItem, people as listPeople, updateItem } from './api';

/**
 * One Organization list (docs/people/design-v1/ORGANIZATION-DECISIONS.md),
 * built the Workforce way: the list on the page ground under one rule, the
 * one primary action top right, Active and Retired as tabs, a row opens its
 * drawer, the row menu holds the rest (edit, merge, retire, history, delete).
 * Retiring something people still use asks where they go; merging moves
 * everyone and everything under it into the survivor. The server logs every
 * change; the Changes screen lists them.
 */
export const STATES = [...new Set(Object.values(GST_STATE_BY_CODE).filter((s) => !/\(Old\)|Other Territory|Centre Jurisdiction/i.test(s)))].sort();

export const KINDS = {
  departments: {
    title: 'Departments', singular: 'department', screen: 'departments',
    fields: [
      { key: 'parentId', label: 'Under', type: 'ref', ref: 'departments', placeholder: 'Top level', tree: true },
      { key: 'headEmployeeId', label: 'Head', type: 'person', placeholder: 'Not set' },
    ],
    columns: [{ key: 'head', label: 'Head', render: (r) => (r.headName ? <span className={r.headLeft ? 'ui-text-neg' : ''}>{r.headName}{r.headLeft ? ' (left)' : ''}</span> : '—') }],
  },
  'job-positions': {
    title: 'Designations', singular: 'designation', screen: 'jobPositions',
    fields: [{ key: 'departmentId', label: 'Department', type: 'ref', ref: 'departments', placeholder: 'Any department' }],
    columns: [{ key: 'department', label: 'Department', render: (r, refs) => refs.departments?.get(r.departmentId) || '—' }],
  },
  'job-roles': {
    title: 'Job Roles', singular: 'job role', screen: 'jobRoles',
    fields: [{ key: 'jobPositionId', label: 'Designation', type: 'ref', ref: 'job-positions', placeholder: 'Choose…', required: true }],
    columns: [{ key: 'designation', label: 'Designation', render: (r, refs) => refs['job-positions']?.get(r.jobPositionId) || '—' }],
  },
  teams: {
    title: 'Teams', singular: 'team', screen: 'teams',
    fields: [
      { key: 'departmentId', label: 'Department', type: 'ref', ref: 'departments', placeholder: 'Any department' },
      { key: 'leadEmployeeId', label: 'Lead', type: 'person', placeholder: 'Not set' },
    ],
    columns: [{ key: 'department', label: 'Department', render: (r, refs) => refs.departments?.get(r.departmentId) || '—' }],
  },
  seats: {
    title: 'Positions', singular: 'position', screen: 'seats',
    fields: [
      { key: 'teamId', label: 'Team', type: 'ref', ref: 'teams', placeholder: 'Choose…', required: true },
      { key: 'jobPositionId', label: 'Designation', type: 'ref', ref: 'job-positions', placeholder: 'Any' },
      { key: 'budgetRef', label: 'Budget reference', type: 'text', placeholder: 'FY27-OPS-04' },
    ],
    columns: [{ key: 'team', label: 'Team', render: (r, refs) => refs.teams?.get(r.teamId) || '—' }],
  },
  areas: {
    title: 'Locations', singular: 'location', screen: 'areas',
    fields: [{ key: 'parentId', label: 'Inside', type: 'ref', ref: 'areas', placeholder: 'Top level', tree: true }],
    columns: [],
  },
  establishments: {
    title: 'Work Sites', singular: 'work site', screen: 'establishments', noDelete: false,
    fields: [
      { key: 'state', label: 'State', type: 'state', required: true },
      { key: 'kind', label: 'Kind', type: 'select', options: [['OFFICE', 'Office'], ['SHOP', 'Shop'], ['FACTORY', 'Factory'], ['SITE', 'Site'], ['WAREHOUSE', 'Warehouse']] },
      { key: 'address', label: 'Address', type: 'textarea', wide: true },
      { key: 'holdsOriginals', label: 'The company keeps employees’ original documents here', type: 'checkbox', wide: true },
    ],
    columns: [{ key: 'state', label: 'State', render: (r) => r.state || '—' }],
  },
  'business-units': { title: 'Business Units', singular: 'business unit', screen: 'businessUnits', fields: [], columns: [] },
  grades: { title: 'Grades', singular: 'grade', screen: 'grades', fields: [], columns: [] },
  'cost-centres': { title: 'Cost Centres', singular: 'cost centre', screen: 'costCentres', fields: [], columns: [] },
};

/* Kinds without a description column on the server (EmployeeType, WorkType) are not listed here; the rest carry one. */
const DESCRIBED = new Set(['departments', 'job-positions', 'job-roles', 'teams', 'seats', 'areas', 'establishments', 'business-units', 'grades', 'cost-centres']);
/* Kinds whose children follow them in a merge, and the parent key the server uses. */
const TREE_KEY = { departments: 'parentId', areas: 'parentId' };

/** Every descendant of an item in a tree list, so a move or merge never lands inside itself. */
const descendantsOf = (rows, id, key) => {
  const out = new Set();
  let frontier = [id];
  while (frontier.length) {
    const next = rows.filter((r) => frontier.includes(r[key]) && !out.has(r.id)).map((r) => r.id);
    next.forEach((x) => out.add(x));
    frontier = next;
  }
  return out;
};
/** "Operations › Site A" for a row in a tree list. */
const pathOf = (rows, row, key) => {
  const names = [];
  let at = row;
  for (let i = 0; at && i < 20; i += 1) { names.unshift(at.name); at = rows.find((r) => r.id === at[key]); }
  return names.join(' › ');
};

export default function StructurePage({ kind, openScreen, params = {}, updateParams }) {
  const cfg = KINDS[kind];
  const perms = usePermissions();
  const canCreate = can(perms, 'PEOPLE::Org Structure::CREATE');
  const canEdit = can(perms, 'PEOPLE::Org Structure::EDIT');
  const canDelete = can(perms, 'PEOPLE::Org Structure::DELETE');
  const canMove = canEdit && can(perms, 'PEOPLE::Employees::EDIT');
  const refKinds = useMemo(() => [...new Set(cfg.fields.filter((f) => f.type === 'ref').map((f) => f.ref))], [cfg]);
  const needsPeople = cfg.fields.some((f) => f.type === 'person');
  const req = useRequest(async () => {
    const [items, ...refLists] = await Promise.all([listItems(kind), ...refKinds.map((k) => (k === kind ? Promise.resolve(null) : listItems(k)))]);
    const refs = Object.fromEntries(refKinds.map((k, i) => [k, refLists[i] || items]));
    const staff = needsPeople ? await listPeople().catch(() => []) : [];
    return { items, refs, staff };
  }, [kind]);
  const [tab, setTab] = useState('active');
  const [q, setQ] = useState('');
  /* "New department" on the Overview opens this page with its form ready. */
  const [editing, setEditing] = useState(() => (params.new === '1' ? { name: '', isActive: true } : null));
  const [retiring, setRetiring] = useState(null);
  const [merging, setMerging] = useState(null);
  const tabsRef = useRef(null);
  const tabIndicator = useTabIndicator(tabsRef, tab);

  const items = req.data?.items || [];
  const refNames = useMemo(() => Object.fromEntries(Object.entries(req.data?.refs || {}).map(([k, list]) => [k, new Map((list || []).map((r) => [r.id, TREE_KEY[k] ? pathOf(list, r, TREE_KEY[k]) : r.name]))])), [req.data]);
  const counts = { active: items.filter((r) => r.isActive !== false).length, retired: items.filter((r) => r.isActive === false).length };
  const shown = items
    .filter((r) => (tab === 'active' ? r.isActive !== false : r.isActive === false))
    .filter((r) => !q || `${r.name} ${r.description || ''}`.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => (TREE_KEY[kind] ? pathOf(items, a, TREE_KEY[kind]).localeCompare(pathOf(items, b, TREE_KEY[kind])) : a.name.localeCompare(b.name)));

  const reactivate = async (r) => {
    try { await updateItem(kind, r.id, { name: r.name, isActive: true }); notify.success(`${r.name} is back in use.`); req.reload(); } catch (e) { notify.error(String(e?.message || 'Not changed.')); }
  };
  const remove = async (r) => {
    if (!(await confirmDialog({ title: `Delete ${r.name}?`, message: 'Nobody uses it, so it goes for good. Retire it instead to keep it in the history.', confirmLabel: 'Delete' }))) return;
    try { await deleteItem(kind, r.id); notify.success('Deleted.'); req.reload(); } catch (e) { notify.error(String(e?.message || 'Not deleted.')); }
  };

  const columns = [
    { key: 'name', label: 'Name', always: true, render: (r) => (
      <span className="min-w-0">
        <span className="block truncate font-medium">{r.name}</span>
        {TREE_KEY[kind] && r[TREE_KEY[kind]] ? <span className="block truncate ui-caption">{pathOf(items, items.find((x) => x.id === r[TREE_KEY[kind]]) || {}, TREE_KEY[kind])}</span> : null}
      </span>
    ) },
    ...cfg.columns.map((c) => ({ ...c, render: (r) => c.render(r, refNames) })),
    { key: 'people', label: 'People', align: 'right', render: (r) => <span className="tabular-nums">{r.employeeCount || 0}</span> },
  ];
  const rowActions = (r) => [
    canEdit ? { key: 'edit', label: 'Edit', onSelect: () => setEditing({ ...r }) } : null,
    canMove && r.isActive !== false ? { key: 'merge', label: 'Merge into…', onSelect: () => setMerging(r) } : null,
    canEdit && r.isActive !== false ? { key: 'retire', label: 'Retire', onSelect: () => setRetiring(r) } : null,
    canEdit && r.isActive === false ? { key: 'reactivate', label: 'Bring back', onSelect: () => reactivate(r) } : null,
    { key: 'history', label: 'History', onSelect: () => openScreen?.('orgChanges', { kind, item: r.id }) },
    canDelete && !r.employeeCount ? { key: 'delete', label: 'Delete', onSelect: () => remove(r) } : null,
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumb={[{ label: 'People' }, { label: 'Organization', onClick: () => openScreen?.('organization') }, { label: cfg.title }]}
        title={cfg.title}
        actions={canCreate ? <button type="button" className="ui-btn ui-btn-primary" onClick={() => setEditing({ name: '', isActive: true })}><Plus size={16} aria-hidden="true" /> New {cfg.singular}</button> : null}
      />
      <div ref={tabsRef} role="tablist" aria-label={cfg.title} className={`ui-record-tablist ${tabIndicator ? 'has-indicator' : ''}`}>
        {[['active', 'In use', counts.active], ['retired', 'Retired', counts.retired]].map(([k, l, n]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} className={`ui-tab ${tab === k ? 'is-active' : ''}`} onClick={() => setTab(k)}>{l}{n ? <span className="ui-tab-count tabular-nums">{n}</span> : null}</button>
        ))}
        {tabIndicator}
      </div>
      {req.error ? <ErrorState error={req.error} onRetry={req.reload} /> : (
        <DataTable
          label={cfg.title}
          columns={columns}
          rows={shown}
          total={shown.length}
          page={1}
          pageSize={Math.max(25, shown.length)}
          onRowClick={canEdit ? (r) => setEditing({ ...r }) : null}
          rowActions={rowActions}
          loading={req.loading}
          refreshing={req.refreshing}
          noun={cfg.title.toLowerCase()}
          card={(r) => (
            <span className="min-w-0 flex-1">
              <span className="flex items-center justify-between gap-2"><span className="truncate font-medium">{r.name}</span><span className="ui-caption tabular-nums">{r.employeeCount || 0}</span></span>
              {cfg.columns[0] ? <span className="block truncate ui-caption">{cfg.columns[0].render(r, refNames)}</span> : null}
            </span>
          )}
          empty={q
            ? <EmptyState kind="filtered" title={`No ${cfg.title.toLowerCase()} match`} description="Nothing here matches the search." />
            : tab === 'retired'
              ? <EmptyState title={`No retired ${cfg.title.toLowerCase()}`} description="What you retire stays here, with its history." />
              : <EmptyState title={`No ${cfg.title.toLowerCase()} yet`} description={`Add the first ${cfg.singular}.`} />}
          toolbar={<SearchField value={q} onSearch={setQ} placeholder={`Search ${cfg.title.toLowerCase()}`} label={`Search ${cfg.title.toLowerCase()}`} className="w-full sm:w-80" />}
        />
      )}
      {editing ? <EditDrawer kind={kind} cfg={cfg} value={editing} items={items} refs={req.data?.refs || {}} staff={req.data?.staff || []} onClose={() => { setEditing(null); if (params.new) updateParams?.({ new: null }); }} onDone={() => { setEditing(null); if (params.new) updateParams?.({ new: null }); req.reload(); }} onRetire={(r) => { setEditing(null); setRetiring(r); }} /> : null}
      {retiring ? <RetireDrawer kind={kind} cfg={cfg} item={retiring} items={items} onClose={() => setRetiring(null)} onDone={() => { setRetiring(null); req.reload(); }} /> : null}
      {merging ? <MergeDrawer kind={kind} cfg={cfg} item={merging} items={items} onClose={() => setMerging(null)} onDone={() => { setMerging(null); req.reload(); }} /> : null}
    </div>
  );
}

/* --------------------------------------------------------------- forms */

const field = (f, form, set, ctx) => {
  const id = `org-${f.key}`;
  if (f.type === 'checkbox') {
    return <label key={f.key} className={`flex items-center gap-2 text-sm ${f.wide ? 'sm:col-span-2' : ''}`}><input id={id} type="checkbox" className="ui-checkbox" checked={Boolean(form[f.key])} onChange={(e) => set(f.key, e.target.checked)} />{f.label}</label>;
  }
  if (f.type === 'textarea') {
    return <label key={f.key} className={`block ${f.wide ? 'sm:col-span-2' : ''}`}><span className="ui-label">{f.label}{f.required ? ' *' : ''}</span><textarea id={id} className="ui-input w-full" rows={2} maxLength={500} value={form[f.key] || ''} onChange={(e) => set(f.key, e.target.value)} /></label>;
  }
  if (f.type === 'text') {
    return <label key={f.key} className="block"><span className="ui-label">{f.label}{f.required ? ' *' : ''}</span><input id={id} className="ui-input w-full" maxLength={120} placeholder={f.placeholder || ''} value={form[f.key] || ''} onChange={(e) => set(f.key, e.target.value)} /></label>;
  }
  let options = [];
  if (f.type === 'select') options = f.options.map(([value, label]) => ({ value, label }));
  if (f.type === 'state') options = STATES.map((s) => ({ value: s, label: s }));
  if (f.type === 'person') options = [{ value: '', label: 'Not set' }, ...ctx.staff.filter((p) => p.status !== 'LEFT').map((p) => ({ value: p.id, label: p.code ? `${p.name} (${p.code})` : p.name }))];
  if (f.type === 'ref') {
    const list = (ctx.refs[f.ref] || []).filter((r) => r.isActive !== false || r.id === form[f.key]);
    /* A tree never takes itself or anything under itself as its parent. */
    const blocked = f.tree && form.id ? new Set([form.id, ...descendantsOf(list, form.id, f.key)]) : new Set();
    options = [{ value: '', label: f.placeholder || 'Not set' }, ...list.filter((r) => !blocked.has(r.id)).map((r) => ({ value: r.id, label: f.tree ? pathOf(list, r, f.key) : r.name }))];
  }
  return (
    <div key={f.key} className={f.wide ? 'sm:col-span-2' : ''}>
      <PopupSelect showValueSubtext={false} label={`${f.label}${f.required ? ' *' : ''}`} value={form[f.key] || ''} onChange={(v) => set(f.key, v || '')} placeholder={f.placeholder || 'Choose…'} alwaysSearch={options.length > 8} options={options} />
    </div>
  );
};

function EditDrawer({ kind, cfg, value, items, refs, staff, onClose, onDone, onRetire }) {
  const isNew = !value.id;
  const initial = useMemo(() => ({ ...value }), [value]);
  const [form, setForm] = useState(initial);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);
  const save = async () => {
    if (!String(form.name || '').trim()) { setError({ message: 'Give it a name.' }); return; }
    const missing = cfg.fields.find((f) => f.required && !form[f.key] && f.type !== 'checkbox');
    if (missing) { setError({ message: `Choose the ${missing.label.toLowerCase()}.` }); return; }
    setBusy(true);
    setError(null);
    try {
      const body = { name: form.name.trim(), ...(DESCRIBED.has(kind) ? { description: form.description || null } : {}), ...Object.fromEntries(cfg.fields.map((f) => [f.key, f.type === 'checkbox' ? Boolean(form[f.key]) : form[f.key] || null])) };
      if (isNew) await createItem(kind, body); else await updateItem(kind, form.id, body);
      notify.success(`${body.name} saved.`);
      onDone();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Drawer open onClose={onClose} widthClass="w-[min(36rem,96vw)] ui-drawer-sheet" title={isNew ? `New ${cfg.singular}` : `Edit ${value.name}`} dirty={dirty}
      footer={<>
        {!isNew && value.isActive !== false ? <button type="button" className="ui-btn ui-btn-ghost mr-auto" onClick={() => onRetire(value)}>Retire</button> : null}
        <button type="button" className="ui-btn ui-btn-secondary" onClick={onClose}>Cancel</button>
        <button type="button" className="ui-btn ui-btn-primary" disabled={busy || !dirty} onClick={save}>{busy ? 'Saving…' : 'Save'}</button>
      </>}>
      <form className="ui-form-grid" onSubmit={(e) => { e.preventDefault(); save(); }}>
        {error ? <div className="sm:col-span-2"><ErrorState error={error?.status ? error : null} compact title={error?.status ? undefined : error.message} body={error?.status === 400 || error?.status === 409 ? error.message : undefined} /></div> : null}
        <label className="block sm:col-span-2"><span className="ui-label">Name *</span><input className="ui-input w-full" maxLength={120} value={form.name || ''} onChange={(e) => set('name', e.target.value)} autoFocus /></label>
        {cfg.fields.map((f) => field(f, form, set, { refs: { ...refs, [kind]: refs[kind] || items }, staff }))}
        {DESCRIBED.has(kind) ? <label className="block sm:col-span-2"><span className="ui-label">Description</span><textarea className="ui-input w-full" rows={2} maxLength={500} value={form.description || ''} onChange={(e) => set('description', e.target.value)} /></label> : null}
      </form>
    </Drawer>
  );
}

/** Retire: kept for history, offered to nobody new. People still in it are moved first, to a place chosen here. */
function RetireDrawer({ kind, cfg, item, items, onClose, onDone }) {
  const people = item.employeeCount || 0;
  const tree = TREE_KEY[kind];
  const blocked = tree ? new Set([item.id, ...descendantsOf(items, item.id, tree)]) : new Set([item.id]);
  const targets = items.filter((r) => r.isActive !== false && !blocked.has(r.id));
  const [moveTo, setMoveTo] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const retire = async () => {
    setBusy(true);
    setError(null);
    try {
      await updateItem(kind, item.id, { name: item.name, isActive: false, ...(people ? { moveTo } : {}) });
      notify.success(people ? `${item.name} retired; ${people} ${people === 1 ? 'person moved' : 'people moved'}.` : `${item.name} retired.`);
      onDone();
    } catch (e) { setError(e); } finally { setBusy(false); }
  };
  return (
    <Drawer open onClose={onClose} widthClass="w-[min(32rem,96vw)] ui-drawer-sheet" title={`Retire ${item.name}`}
      footer={<><button type="button" className="ui-btn ui-btn-secondary" onClick={onClose}>Cancel</button><button type="button" className="ui-btn ui-btn-primary" disabled={busy || (people > 0 && !moveTo)} onClick={retire}>{busy ? 'Retiring…' : 'Retire'}</button></>}>
      <div className="grid gap-4">
        {error ? <ErrorState error={error} compact body={error?.message} /> : null}
        <p className="text-sm">{people ? `${people} ${people === 1 ? 'person is' : 'people are'} in ${item.name}. They move first; the ${cfg.singular} then stays in the history and is offered to nobody new.` : `Nobody is in ${item.name}. It stays in the history and is offered to nobody new.`}</p>
        {people ? <div><PopupSelect showValueSubtext={false} label="Move them to *" value={moveTo} onChange={(v) => setMoveTo(v || '')} placeholder="Choose…" alwaysSearch={targets.length > 8} options={targets.map((r) => ({ value: r.id, label: tree ? pathOf(items, r, tree) : r.name }))} /></div> : null}
      </div>
    </Drawer>
  );
}

/** Merge: a duplicate folded into the one to keep — its people and everything under it move across, and it is retired. */
function MergeDrawer({ kind, cfg, item, items, onClose, onDone }) {
  const tree = TREE_KEY[kind];
  const blocked = tree ? new Set([item.id, ...descendantsOf(items, item.id, tree)]) : new Set([item.id]);
  const targets = items.filter((r) => r.isActive !== false && !blocked.has(r.id));
  const children = tree ? items.filter((r) => r[tree] === item.id).length : 0;
  const [intoId, setIntoId] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const into = items.find((r) => r.id === intoId);
  const merge = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await mergeItem(kind, item.id, { intoId, reason: reason.trim() || null });
      notify.success(`${item.name} merged into ${into?.name}; ${r?.moved ?? item.employeeCount ?? 0} moved.`);
      onDone();
    } catch (e) { setError(e); } finally { setBusy(false); }
  };
  return (
    <Drawer open onClose={onClose} widthClass="w-[min(32rem,96vw)] ui-drawer-sheet" title={`Merge ${item.name}`} dirty={Boolean(intoId || reason)}
      footer={<><button type="button" className="ui-btn ui-btn-secondary" onClick={onClose}>Cancel</button><button type="button" className="ui-btn ui-btn-primary" disabled={busy || !intoId} onClick={merge}>{busy ? 'Merging…' : 'Merge'}</button></>}>
      <div className="grid gap-4">
        {error ? <ErrorState error={error} compact body={error?.message} /> : null}
        <div><PopupSelect showValueSubtext={false} label="Into *" value={intoId} onChange={(v) => setIntoId(v || '')} placeholder="Choose the one to keep…" alwaysSearch={targets.length > 8} options={targets.map((r) => ({ value: r.id, label: tree ? pathOf(items, r, tree) : r.name }))} /></div>
        {into ? (
          <p className="text-sm">{[`${item.employeeCount || 0} ${(item.employeeCount || 0) === 1 ? 'person moves' : 'people move'} to ${into.name}`, children ? `${children} under it ${children === 1 ? 'moves' : 'move'} with them` : null].filter(Boolean).join('; ')}. {item.name} is then retired; each person's history says it was merged.</p>
        ) : null}
        <label className="block"><span className="ui-label">Reason</span><textarea className="ui-input w-full" rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={`Same ${cfg.singular} entered twice`} /></label>
      </div>
    </Drawer>
  );
}
