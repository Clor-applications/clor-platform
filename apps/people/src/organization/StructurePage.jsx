import React, { useMemo, useState } from 'react';
import { tintOf } from './tints';
import { KIND_WORDS } from '@ui/personnel/employmentKinds';
import SuggestInput from '@ui/components/ui/SuggestInput';
import { useSuggestions } from '../workforce/suggestions';
import { Plus, X } from '@ui/components/ui/lineIcons';
import DatePicker, { formatDate } from '@ui/components/ui/DatePicker';

import { EmptyState } from '@ui/components/ui/Primitives';
import ListHeader from '@ui/components/list/ListHeader';
import DataTable from '@ui/components/ui/DataTable';
import SearchField from '@ui/components/ui/SearchField';
import Drawer from '@ui/components/ui/Drawer';
import ErrorState from '@ui/components/ui/ErrorState';
import PopupSelect from '@ui/components/pickers/PopupSelect';
import useRequest from '@ui/components/ui/useRequest';
import { confirmDialog, notify } from '@ui/components/ui/notify';
import { usePermissions } from '@ui/permissions/usePermissions';
import { GST_STATE_BY_CODE } from '@ui/utils/gst';

import { can } from '../workforce/shared';
import { createItem, deleteItem, listItems, mergeItem, people as listPeople, updateItem } from './api';
import { plusDaysIso, todayIst } from '@ui/utils/dates';

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
    columns: [{ key: 'head', label: 'Head', render: (r) => (r.headName ? <span className={`org-head ${r.headLeft ? 'ui-text-neg' : ''}`}><span className="org-head-face" aria-hidden="true">{r.headName.trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase()}</span>{r.headName}{r.headLeft ? ' (left)' : ''}</span> : <span className="ui-muted">No head</span>) }],
  },
  'job-positions': {
    title: 'Designations', singular: 'designation', screen: 'jobPositions',
    fields: [{ key: 'departmentId', label: 'Department', type: 'ref', ref: 'departments', placeholder: 'Any department' }],
    columns: [{ key: 'department', label: 'Department', render: (r, refs) => refs.departments?.get(r.departmentId) || '—' }],
  },
  'job-roles': {
    title: 'Job roles', singular: 'job role', screen: 'jobRoles',
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
      { key: 'budgetRef', label: 'Budget reference', type: 'text', placeholder: 'FY27-OPS-04', suggest: 'budgetRef' },
    ],
    columns: [{ key: 'team', label: 'Team', render: (r, refs) => refs.teams?.get(r.teamId) || '—' }],
  },
  areas: {
    title: 'Locations', singular: 'location', screen: 'areas',
    fields: [{ key: 'parentId', label: 'Inside', type: 'ref', ref: 'areas', placeholder: 'Top level', tree: true }],
    columns: [],
  },
  establishments: {
    title: 'Work sites', singular: 'work site', screen: 'establishments', noDelete: false,
    fields: [
      { key: 'state', label: 'State', type: 'state', required: true },
      { key: 'legalEntityId', label: 'Legal company', type: 'ref', ref: 'legal-entities', placeholder: 'Not set' },
      { key: 'kind', label: 'Kind', type: 'select', options: [['OFFICE', 'Office'], ['SHOP', 'Shop'], ['FACTORY', 'Factory'], ['SITE', 'Site'], ['WAREHOUSE', 'Warehouse']] },
      { key: 'address', label: 'Address', type: 'text', wide: true, suggest: 'branchAddress', max: 500 },
      { key: 'holdsOriginals', label: 'The company keeps employees’ original documents here', type: 'checkbox', wide: true },
      /* Statutory registrations (People audit gap 16): Compliance reads them, and one running out becomes a renewal there. */
      { key: 'registrations', label: 'Registrations', type: 'registrations', wide: true },
    ],
    columns: [
      { key: 'state', label: 'State', render: (r) => r.state || '—' },
      { key: 'registrations', label: 'Registrations', render: (r) => registrationSummary(r.registrations) },
    ],
  },
  /* Settings lists: a person's terms and the company in law, laid out like every other list. */
  'employee-types': {
    title: 'Employment types', singular: 'employment type', screen: 'employeeTypes', settings: true,
    fields: [
      { key: 'category', label: 'Counts as', type: 'select', options: Object.entries(KIND_WORDS) },
      { key: 'probationMonths', label: 'Probation (months)', type: 'text', inputMode: 'numeric', placeholder: 'None' },
      { key: 'noticeDays', label: 'Notice (days)', type: 'text', inputMode: 'numeric', placeholder: 'None' },
    ],
    columns: [
      { key: 'category', label: 'Counts as', render: (r) => KIND_WORDS[r.category] || '—' },
      { key: 'probation', label: 'Probation', render: (r) => (r.probationMonths ? <span className="tabular-nums">{r.probationMonths} {r.probationMonths === 1 ? 'month' : 'months'}</span> : '—') },
      { key: 'notice', label: 'Notice', render: (r) => (r.noticeDays ? <span className="tabular-nums">{r.noticeDays} days</span> : '—') },
    ],
  },
  'work-types': { title: 'Work modes', singular: 'work mode', screen: 'workTypes', settings: true, fields: [], columns: [] },
  'legal-entities': {
    title: 'Legal entity', singular: 'legal entity', noun: 'legal companies', screen: 'legalEntities', settings: true,
    fields: [
      { key: 'pan', label: 'PAN', type: 'text', placeholder: 'ABCDE1234F' },
      { key: 'cin', label: 'CIN', type: 'text' },
      { key: 'address', label: 'Registered address', type: 'text', wide: true, max: 500 },
    ],
    columns: [{ key: 'pan', label: 'PAN', render: (r) => <span className="tabular-nums">{r.pan || '—'}</span> }],
  },
  'business-units': { title: 'Business units', singular: 'business unit', screen: 'businessUnits', fields: [], columns: [] },
  grades: { title: 'Grades', singular: 'grade', screen: 'grades', fields: [], columns: [] },
  'cost-centres': { title: 'Cost centres', singular: 'cost centre', screen: 'costCentres', fields: [], columns: [] },
};

/* The registrations a work site holds; the same list Compliance names (services/people/complianceRules.ts). */
const REGISTRATION_TYPES = [
  ['SE_REG', 'Shops & Establishments'], ['PF', 'PF code (EPFO)'], ['ESI', 'ESI code (ESIC)'], ['PT', 'Professional Tax'], ['LWF', 'Labour Welfare Fund'],
  ['CLRA', 'Contract labour licence'], ['FACTORY', 'Factory licence'], ['TRADE', 'Trade licence'], ['FIRE', 'Fire safety certificate'], ['OTHER', 'Other'],
];
const plusDays = (n) => plusDaysIso(n);
/** "3 · 1 runs out soon" for the list: how many, and what needs renewing. */
function registrationSummary(list) {
  const regs = Array.isArray(list) ? list : [];
  if (!regs.length) return <span className="ui-muted">None</span>;
  const lapsed = regs.filter((r) => r.validTill && r.validTill < todayIst()).length;
  const soon = regs.filter((r) => r.validTill && r.validTill >= todayIst() && r.validTill <= plusDays(30)).length;
  return (
    <span className="whitespace-nowrap">
      <span className="tabular-nums">{regs.length}</span>
      {lapsed ? <span className="ui-pill ui-pill-neg ml-2">{lapsed} lapsed</span> : soon ? <span className="ui-pill ui-pill-warn ml-2">{soon} to renew</span> : null}
    </span>
  );
}
/** Rows worth saving: a type, and a number or a date. */
const cleanRegistrations = (list) => (Array.isArray(list) ? list : []).map((r) => ({ type: r.type || 'OTHER', number: String(r.number || '').trim(), validTill: r.validTill || null })).filter((r) => r.number || r.validTill);

/* Kinds without a description column on the server (EmployeeType, WorkType) are not listed here; the rest carry one. */
const DESCRIBED = new Set(['departments', 'job-positions', 'job-roles', 'teams', 'seats', 'areas', 'establishments', 'business-units', 'grades', 'cost-centres', 'legal-entities']);
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

  const items = req.data?.items || [];
  const noun = cfg.noun || cfg.title.toLowerCase();
  const withUnder = (r) => (TREE_KEY[kind] ? [r.id, ...descendantsOf(items, r.id, TREE_KEY[kind])].reduce((n, id) => n + (items.find((x) => x.id === id)?.employeeCount || 0), 0) : r.employeeCount || 0);
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

  /* Each row's own colour (stable by name) and its share of the biggest, so a list reads at a glance. */
  const peak = Math.max(1, ...items.map((x) => x.employeeCount || 0));
  const columns = [
    { key: 'name', label: 'Name', always: true, render: (r) => (
      <span className="flex min-w-0 items-center gap-2.5">
      <span className="org-tile" data-tint={tintOf(r.name)} aria-hidden="true">{(r.name || '?').trim().charAt(0).toUpperCase()}</span>
      <span className="min-w-0">
        <span className="block truncate font-medium">{r.name}</span>
        {TREE_KEY[kind] && r[TREE_KEY[kind]] ? <span className="block truncate ui-caption">{pathOf(items, items.find((x) => x.id === r[TREE_KEY[kind]]) || {}, TREE_KEY[kind])}</span> : null}
      </span>
      </span>
    ) },
    ...cfg.columns.map((c) => ({ ...c, render: (r) => c.render(r, refNames) })),
    /* Direct count; a department with sub-departments also says how many with them (ORG-R050). */
    /* A legal company is used by its work sites, not by people directly. */
    { key: 'people', label: kind === 'legal-entities' ? 'Work sites' : 'People', width: '14rem', render: (r) => { const all = withUnder(r); return (
      <span className="org-count">
        <span className="org-count-bar" aria-hidden="true"><span style={{ width: `${((r.employeeCount || 0) / peak) * 100}%` }} /></span>
        <span className="tabular-nums org-count-n">{r.employeeCount || 0}</span>
        {all > (r.employeeCount || 0) ? <span className="block ui-caption">{all} with sub-{kind === 'areas' ? 'locations' : 'departments'}</span> : null}
      </span>
    ); } },
  ];
  const rowActions = (r) => [
    canEdit ? { key: 'edit', label: 'Edit', onSelect: () => setEditing({ ...r }) } : null,
    canMove && r.isActive !== false ? { key: 'merge', label: 'Merge into…', onSelect: () => setMerging(r) } : null,
    canEdit && r.isActive !== false ? { key: 'retire', label: 'Retire', onSelect: () => setRetiring(r) } : null,
    canEdit && r.isActive === false ? { key: 'reactivate', label: 'Bring back', onSelect: () => reactivate(r) } : null,
    { key: 'history', label: 'History', onSelect: () => openScreen?.('orgChanges', { kind, item: r.id }) },
    canDelete && !r.employeeCount && !(TREE_KEY[kind] && items.some((x) => x[TREE_KEY[kind]] === r.id)) ? { key: 'delete', label: 'Delete', onSelect: () => remove(r) } : null,
  ];

  return (
    <div className="space-y-6">
      <ListHeader
        section="Settings"
        title={cfg.title}
        description={`The ${noun} people are filed under, in use or retired, and how many are in each.`}
        primary={canCreate ? { label: `New ${cfg.singular}`, icon: Plus, onClick: () => setEditing({ name: '', isActive: true }) } : null}
        toolbar={<SearchField value={q} onSearch={setQ} placeholder={`Search ${noun}`} label={`Search ${noun}`} className="w-full sm:w-80" />}
        tabs={[{ key: 'active', label: 'In use', count: counts.active }, { key: 'retired', label: 'Retired', count: counts.retired }]}
        tab={tab}
        onTab={setTab}
      />
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
          noun={noun}
          card={(r) => (
            <span className="min-w-0 flex-1">
              <span className="flex items-center justify-between gap-2"><span className="truncate font-medium">{r.name}</span><span className="ui-caption tabular-nums">{r.employeeCount || 0}</span></span>
              {cfg.columns[0] ? <span className="block truncate ui-caption">{cfg.columns[0].render(r, refNames)}</span> : null}
            </span>
          )}
          empty={q
            ? <EmptyState kind="filtered" title={`No ${noun} match`} description="Nothing here matches the search." />
            : tab === 'retired'
              ? <EmptyState title={`No retired ${noun}`} description="What you retire stays here, with its history." />
              : <EmptyState title={`No ${noun} yet`} description={`People are filed under ${noun} once there is one to file them under.`} routes={canCreate ? [{ label: `New ${cfg.singular}`, onSelect: () => setEditing({ name: '', isActive: true }) }] : undefined} />}
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
  if (f.type === 'registrations') return <RegistrationsField key={f.key} value={form[f.key]} onChange={(v) => set(f.key, v)} sites={ctx.refs?.establishments || []} siteId={form.id} />;
  if (f.type === 'checkbox') {
    return <label key={f.key} className={`flex items-center gap-2 text-sm ${f.wide ? 'sm:col-span-2' : ''}`}><input id={id} type="checkbox" className="ui-checkbox" checked={Boolean(form[f.key])} onChange={(e) => set(f.key, e.target.checked)} />{f.label}</label>;
  }
  if (f.type === 'textarea') {
    return <label key={f.key} className={`block ${f.wide ? 'sm:col-span-2' : ''}`}><span className="ui-label">{f.label}{f.required ? ' *' : ''}</span><textarea id={id} className="ui-input w-full" rows={2} maxLength={500} value={form[f.key] || ''} onChange={(e) => set(f.key, e.target.value)} /></label>;
  }
  if (f.type === 'text' && f.suggest) return <SuggestText key={f.key} f={f} id={id} value={form[f.key] || ''} onChange={(v) => set(f.key, v)} />;
  if (f.type === 'text') {
    return <label key={f.key} className={`block ${f.wide ? 'sm:col-span-2' : ''}`}><span className="ui-label">{f.label}{f.required ? ' *' : ''}</span><input id={id} className={`ui-input w-full ${f.inputMode === 'numeric' ? 'tabular-nums' : ''}`} inputMode={f.inputMode} maxLength={f.max || 120} placeholder={f.placeholder || ''} value={form[f.key] ?? ''} onChange={(e) => set(f.key, f.inputMode === 'numeric' ? e.target.value.replace(/\D/g, '') : e.target.value)} /></label>;
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

/** A work site's registrations: type, number, valid till; added and removed in place. */
function RegistrationsField({ value, onChange, sites = [], siteId }) {
  const rows = Array.isArray(value) ? value : [];
  /* Numbers the company's other sites hold for the same kind: a PF or ESI code is often one for the whole company. */
  const numbersFor = (type) => [...new Set(sites.filter((s) => s.id !== siteId).flatMap((s) => (Array.isArray(s.registrations) ? s.registrations : [])).filter((r) => r.type === type && r.number).map((r) => r.number))];
  const put = (i, patch) => onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  return (
    <fieldset className="grid gap-3 sm:col-span-2 border-t pt-3">
      <legend className="ui-label">Registrations</legend>
      {rows.map((r, i) => (
        <div key={i} className="grid gap-2 sm:grid-cols-3" role="group" aria-label={`Registration ${i + 1}`}>
          <div><PopupSelect showValueSubtext={false} label="Type" value={r.type || ''} onChange={(v) => put(i, { type: v || 'OTHER' })} placeholder="Choose…" options={REGISTRATION_TYPES.map(([v, l]) => ({ value: v, label: l }))} /></div>
          <label className="block"><span className="ui-label">Number</span><SuggestInput maxLength={80} value={r.number || ''} onChange={(v) => put(i, { number: v })} suggestions={numbersFor(r.type)} aria-label={`Registration ${i + 1} number`} /></label>
          <div><span className="ui-label" id={`reg-till-${i}`}>Valid till</span><DatePicker label="Valid till" describedBy={`reg-till-${i}`} value={r.validTill || ''} onChange={(v) => put(i, { validTill: v || '' })} /></div>
          <span className="sm:col-span-3"><button type="button" className="ui-btn ui-btn-ghost ui-btn-sm" aria-label={`Remove registration ${i + 1}`} onClick={() => onChange(rows.filter((_, j) => j !== i))}><X size={16} aria-hidden="true" /> Remove</button></span>
        </div>
      ))}
      {!rows.length ? <p className="ui-caption">PF, ESI, Shops & Establishments and the rest: Compliance reminds you before one runs out.</p> : null}
      <span><button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={() => onChange([...rows, { type: rows.some((r) => r.type === 'SE_REG') ? 'PF' : 'SE_REG', number: '', validTill: '' }])}><Plus size={16} aria-hidden="true" /> Add a registration</button></span>
      {rows.some((r) => r.validTill) ? <p className="ui-caption">{rows.filter((r) => r.validTill).map((r) => `${(REGISTRATION_TYPES.find(([v]) => v === r.type) || ['', 'Registration'])[1]} till ${formatDate(r.validTill)}`).join(' · ')}</p> : null}
    </fieldset>
  );
}

/* A text field that offers what the company already has. */
function SuggestText({ f, id, value, onChange }) {
  const hints = useSuggestions(f.suggest);
  return <label className={`block ${f.wide ? 'sm:col-span-2' : ''}`}><span className="ui-label">{f.label}{f.required ? ' *' : ''}</span><SuggestInput id={id} maxLength={f.max || 120} placeholder={f.placeholder || ''} value={value} onChange={onChange} suggestions={hints} /></label>;
}

/* Names to offer for a new item: what people's records already say, or (work sites) the branches. */
const NAME_SOURCE = { departments: 'department', 'job-positions': 'designation', establishments: 'branch' };
/* After the company's own: the names most small Indian companies use. */
const COMMON_NAMES = {
  departments: ['Accounts', 'Sales', 'Operations', 'Administration', 'Human Resources', 'Production', 'Purchase', 'Stores', 'Marketing', 'Customer Support', 'Logistics', 'IT'],
  'job-positions': ['Manager', 'Executive', 'Accountant', 'Sales Executive', 'Supervisor', 'Office Assistant', 'Receptionist', 'Technician', 'Driver', 'Helper', 'Store Keeper', 'Security Guard'],
};

function EditDrawer({ kind, cfg, value, items, refs, staff, onClose, onDone, onRetire }) {
  const isNew = !value.id;
  const sourced = useSuggestions(NAME_SOURCE[kind] || null);
  const initial = useMemo(() => ({ ...value }), [value]);
  const [form, setForm] = useState(initial);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);
  /* Offered: names already on people's records (or branches) that are not yet in this list. A name already in it is said plainly, not offered. */
  const taken = new Set(items.map((x) => String(x.name).trim().toLowerCase()));
  const nameHints = [...sourced, ...(COMMON_NAMES[kind] || [])].filter((h) => !taken.has(String(h.value ?? h).trim().toLowerCase()));
  const typed = String(form.name || '').trim().toLowerCase();
  const same = typed ? items.find((x) => x.id !== form.id && String(x.name).trim().toLowerCase() === typed) : null;
  /* Moving under another parent: what goes with it and who is affected, before saving (research R056). */
  const treeKey = TREE_KEY[kind];
  const moving = !isNew && treeKey && (form[treeKey] || '') !== (initial[treeKey] || '');
  const [moveReason, setMoveReason] = useState('');
  const move = useMemo(() => {
    if (!moving) return null;
    const under = [...descendantsOf(items, form.id, treeKey)];
    const people = [form.id, ...under].reduce((n, id) => n + (items.find((x) => x.id === id)?.employeeCount || 0), 0);
    const where = (parentId) => { const parent = items.find((x) => x.id === parentId); return parent ? pathOf(items, parent, treeKey) : 'Top level'; };
    return { from: where(initial[treeKey]), to: where(form[treeKey]), under: under.length, people };
  }, [moving, items, form, initial, treeKey]);
  const save = async () => {
    /* Enter in the form and the Save button both land here; one save at a time, or a second copy is created. */
    if (busy) return;
    if (!String(form.name || '').trim()) { setError({ message: 'Give it a name.' }); return; }
    const missing = cfg.fields.find((f) => f.required && !form[f.key] && f.type !== 'checkbox');
    if (missing) { setError({ message: `Choose the ${missing.label.toLowerCase()}.` }); return; }
    setBusy(true);
    setError(null);
    try {
      const body = { ...(move && moveReason.trim() ? { reason: moveReason.trim() } : {}), name: form.name.trim(), ...(DESCRIBED.has(kind) ? { description: form.description || null } : {}), ...Object.fromEntries(cfg.fields.map((f) => [f.key, f.type === 'checkbox' ? Boolean(form[f.key]) : f.type === 'registrations' ? cleanRegistrations(form[f.key]) : (form[f.key] ?? '') === '' ? null : form[f.key]])) };
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
        <label className="block sm:col-span-2"><span className="ui-label">Name *</span><SuggestInput maxLength={120} value={form.name || ''} onChange={(v) => set('name', v)} suggestions={nameHints} autoFocus aria-describedby={same ? 'org-name-same' : undefined} />
          {same ? <span id="org-name-same" className="ui-caption block mt-1">{same.isActive === false ? `${same.name} is in the list, retired. Bring it back instead of adding it again.` : `${same.name} is already in the list.`}</span> : null}
        </label>
        {cfg.fields.map((f) => field(f, form, set, { refs: { ...refs, [kind]: refs[kind] || items }, staff }))}
        {move ? (
          <div className="sm:col-span-2 grid gap-2 border-t pt-3" aria-live="polite">
            <span className="ui-label">What changes</span>
            <p className="text-sm">Moves from <span className="font-medium">{move.from}</span> to <span className="font-medium">{move.to}</span>.</p>
            <p className="text-sm">{[
              move.under ? `${move.under} ${move.under === 1 ? (kind === 'areas' ? 'location' : 'sub-department') : (kind === 'areas' ? 'locations' : 'sub-departments')} under it ${move.under === 1 ? 'moves' : 'move'} with it` : null,
              kind === 'departments' ? 'its teams and designations stay with it' : null,
              `${move.people} ${move.people === 1 ? 'person keeps' : 'people keep'} their ${kind === 'areas' ? 'location' : 'department'}, and the overview and chart show them in the new place`,
            ].filter(Boolean).join('; ').replace(/^./, (c) => c.toUpperCase())}. Nobody's manager or approvals change.</p>
            <label className="block"><span className="ui-label">Reason</span><input className="ui-input w-full" maxLength={500} value={moveReason} onChange={(e) => setMoveReason(e.target.value)} placeholder="Night shift now reports into Operations" /></label>
          </div>
        ) : null}
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
