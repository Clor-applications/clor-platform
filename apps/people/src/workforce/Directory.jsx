import React, { useEffect, useRef, useState } from 'react';
import SuggestInput from '@ui/components/ui/SuggestInput';
import { useSuggestions } from './suggestions';
import { useTabIndicator } from '@ui/components/ui/RecordTabs';
import { CalendarClock, Download, Filter, Pencil, Plus, Trash2, TreePalm, Upload, UserCheck, UserMinus, Users, X } from '@ui/components/ui/lineIcons';
import { useContentIcon } from '@ui/components/ui/colorSwap';

import { EmptyState, PageHeader } from '@ui/components/ui/Primitives';
import DataTable from '@ui/components/ui/DataTable';
import SearchField from '@ui/components/ui/SearchField';
import Drawer from '@ui/components/ui/Drawer';
import Alert from '@ui/components/ui/Alert';
import ErrorState from '@ui/components/ui/ErrorState';
import DatePicker from '@ui/components/ui/DatePicker';
import PopupSelect from '@ui/components/pickers/PopupSelect';
import useRequest from '@ui/components/ui/useRequest';
import { notify, confirmDialog } from '@ui/components/ui/notify';
import { usePermissions } from '@ui/permissions/usePermissions';
import { Avatar } from '@ui/personnel/Employees';
import { HOURS_WORDS } from '@ui/personnel/employmentKinds';
import { formatDate } from '@ui/components/ui/DatePicker';

import { bulkUpdate, changeImpact, dataHealth, employeeIds, listContractors, deleteView, downloadText, employeeCounts, exportColumns, exportEmployees, listEmployees, listTags, listViews, openChecklistTasks, saveView, structure, workforcePending } from './api';
import { listBranches } from '../organization/api';
import { hasApp } from '@platform/context';
import { STATUS, StatusBadge, can } from './shared';
import AppAccessSend from './AppAccessSend';

/**
 * Workforce → Directory (People design spec v1 EMP-01, EMP-11, EMP-12; Workforce
 * package WF-02..04, WF-16, WF-17). Everything the list shows is asked of the
 * server: search, filters, sort and page; nothing is filtered in the browser.
 * The search, filters, sort, page and open view live in the address (shell
 * `updateParams`), so Back and refresh return to the same list. Choosing
 * people is per page; changing filters or company clears the choice.
 */
const FILTER_KEYS = ['status', 'dept', 'pos', 'type', 'wtype', 'hrs', 'prob', 'contract', 'area', 'est', 'unit', 'grade', 'centre', 'tag', 'mgr', 'from', 'to', 'lfrom', 'lto', 'working', 'branch'];
const COLUMNS_KEY = 'people.workforce.columns';
const DISMISS_KEY = 'people.workforce.dismissed';
/* Ticked rows are sent as ids in the export address; above this many it grows too long. */
const EXPORT_IDS_MAX = 500;
const readJson = (k, fallback) => { try { return JSON.parse(localStorage.getItem(k) || '') || fallback; } catch { return fallback; } };
const writeJson = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* a convenience only */ } };
const apiParams = (p) => ({
  /* Leavers stay out unless asked for: the default is everyone still with the company. */
  q: p.q, status: p.status || 'CURRENT', departmentId: p.dept, jobPositionId: p.pos, employeeTypeId: p.type, workTypeId: p.wtype, hours: p.hrs, probation: p.prob, contract: p.contract, areaId: p.area, establishmentId: p.est,
  businessUnitId: p.unit, gradeId: p.grade, costCenterId: p.centre, tagId: p.tag, managerId: p.mgr,
  joinedFrom: p.from, joinedTo: p.to, leftFrom: p.lfrom, leftTo: p.lto, working: p.working, branchId: p.branch, sort: p.sort, dir: p.dir,
});

export default function Directory({ params = {}, updateParams, openScreen }) {
  const perms = usePermissions();
  const allowed = (k) => can(perms, k);
  /*
   * A search that looks like a phone number or an identifier (six or more
   * digits) is kept on this page only, never in the address bar, history or
   * a shared link (Workforce WF-03 search contract).
   */
  const [privateQ, setPrivateQ] = useState('');
  const p = privateQ ? { ...(params || {}), q: privateQ } : (params || {});
  const tab = ['views', 'team', 'pending'].includes(p.tab) ? p.tab : 'directory';
  const page = Math.max(1, Number(p.page || 1));
  const size = [25, 50, 100].includes(Number(p.size)) ? Number(p.size) : 25;
  const set = (patch, push = false) => updateParams?.(patch, { push });
  /* A link that names one person (a bell notice, an older shared link) opens their record, not the whole list. */
  useEffect(() => { if (params?.id) openScreen?.('employee', { id: params.id }); }, [params?.id]);
  /* The record page's "Workforce" breadcrumb comes back to this exact list. */
  useEffect(() => { try { sessionStorage.setItem('people.workforce.lastDirectory', JSON.stringify(params || {})); } catch { /* convenience */ } }, [JSON.stringify(params || {})]);
  const filtersOn = FILTER_KEYS.filter((k) => p[k]).length;

  /* The list: one request per query; the last good page stays while the next loads. */
  const listKey = JSON.stringify([apiParams(p), page, size, tab]);
  const list = useRequest(() => listEmployees({ ...apiParams(p), ...(tab === 'team' ? { team: 'mine' } : {}), limit: size, offset: (page - 1) * size }), [listKey]);
  const counts = useRequest(() => employeeCounts(), []);
  const pending = useRequest(() => workforcePending(), []);
  const pendingCount = pending.data ? pending.data.requests.length + pending.data.scheduled.length + pending.data.invites.length + pending.data.drafts.length : 0;
  const [lists, setLists] = useState({ branches: [], departments: [], positions: [], types: [], workTypes: [], areas: [], establishments: [], units: [], grades: [], centres: [], teams: [], contractors: [], tags: [] });
  useEffect(() => {
    Promise.all([...['departments', 'job-positions', 'employee-types', 'work-types', 'areas', 'establishments', 'business-units', 'grades', 'cost-centres', 'teams'].map((k) => structure(k).catch(() => [])), listTags().catch(() => []), listBranches().catch(() => []), hasApp('attendance') ? listContractors() : Promise.resolve([])])
      .then(([departments, positions, types, workTypes, areas, establishments, units, grades, centres, teams, tags, branchRows, contractors]) => setLists({ departments, positions, types, workTypes, areas, establishments, units, grades, centres, teams, contractors, tags , branches: branchRows.filter((b) => b.isActive !== false).map((b) => ({ id: b.id, name: b.branchName, isActive: true })) }));
  }, []);

  /* Choosing people: this page, reset whenever the query changes (spec §4.2). */
  const [selected, setSelected] = useState(() => new Set());
  const [selKey, setSelKey] = useState(listKey);
  if (selKey !== listKey) { setSelKey(listKey); setSelected(new Set()); }

  /* Lower-priority columns start hidden so the table fits beside both sidebars; Columns shows them (WF-03). */
  const [prefs, setPrefsState] = useState(() => readJson(COLUMNS_KEY, { hidden: ['manager', 'type', 'location'] }));
  const setPrefs = (next) => { setPrefsState(next); writeJson(COLUMNS_KEY, next); };
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [bulk, setBulk] = useState(null);
  const [appAccess, setAppAccess] = useState(null);
  const [result, setResult] = useState(null);
  const [exporting, setExporting] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);

  const tabsRef = useRef(null);
  const tabIndicator = useTabIndicator(tabsRef, tab);
  const rows = list.data?.employees || [];
  const total = Number(list.data?.total || 0);
  /* Managers to filter and move people to: everyone still here, by name (500 at most for the picker). */
  const [managers, setManagers] = useState([]);
  useEffect(() => { listEmployees({ limit: 500, sort: 'name' }).then((r) => setManagers((r?.employees || []).filter((e) => e.status !== 'LEFT').map((e) => ({ id: e.id, name: e.code ? `${e.name} (${e.code})` : e.name })))).catch(() => {}); }, []);

  const openRecord = (r, recordTab = 'overview') => openScreen?.('employee', { id: r.id, tab: recordTab });
  const columns = [
    { key: 'name', label: 'Employee', sortable: true, always: true, render: (r) => (
      <span className="flex items-center gap-2.5 min-w-0">
        <Avatar person={r} size={28} />
        <span className="min-w-0">
          <span className="block truncate font-medium">{r.preferredName ? `${r.name} (${r.preferredName})` : r.name}</span>
          <span className="block truncate ui-caption">{r.workEmail || r.email || ''}</span>
        </span>
      </span>
    ) },
    { key: 'code', label: 'Employee ID', sortable: true, render: (r) => <span className="tabular-nums">{r.code || '—'}</span> },
    { key: 'department', label: 'Department', sortable: true, render: (r) => r.department || '—' },
    { key: 'designation', label: 'Designation', sortable: true, render: (r) => r.designation || '—' },
    { key: 'manager', label: 'Manager', render: (r) => r.reportingManagerName || '—' },
    { key: 'branch', label: 'Works at', render: (r) => <span className="whitespace-nowrap">{r.branchName || '—'}</span> },
    { key: 'location', label: 'Location', sortable: true, render: (r) => r.areaName || r.workLocation || '—' },
    { key: 'type', label: 'Employment type', render: (r) => lists.types.find((t) => t.id === r.employeeTypeId)?.name || '—' },
    { key: 'dateOfJoining', label: 'Joining date', sortable: true, render: (r) => <span className="tabular-nums whitespace-nowrap">{r.dateOfJoining ? formatDate(String(r.dateOfJoining).slice(0, 10)) : '—'}</span> },
    { key: 'status', label: 'Status', sortable: true, render: (r) => <StatusBadge employee={r} quiet /> },
  ];

  const rowActions = (r) => [
    { key: 'view', label: 'View profile', onSelect: () => openRecord(r) },
    allowed('PEOPLE::Employees::EDIT') ? { key: 'edit', label: 'Edit', onSelect: () => openScreen?.('employee', { id: r.id, tab: 'personal', edit: 'personal' }) } : null,
    allowed('PEOPLE::Employees::EDIT') && r.status !== 'LEFT' ? { key: 'manager', label: 'Change manager', onSelect: () => openScreen?.('employee', { id: r.id, tab: 'organization', action: 'manager' }) } : null,
    allowed('PEOPLE::Employees::EDIT') && r.status !== 'LEFT' ? { key: 'transfer', label: 'Transfer', onSelect: () => openScreen?.('employee', { id: r.id, tab: 'organization', action: 'transfer' }) } : null,
    allowed('PEOPLE::Employees::EDIT') && r.status !== 'LEFT' ? { key: 'designation', label: 'Change designation', onSelect: () => openScreen?.('employee', { id: r.id, tab: 'employment', action: 'designation' }) } : null,
    allowed('PEOPLE::Documents::VIEW') ? { key: 'docs', label: 'Documents', onSelect: () => openRecord(r, 'documents') } : null,
    { key: 'activity', label: 'View activity', onSelect: () => openRecord(r, 'activity') },
  ];

  /* Every person the filters match, not only this page: ids from the server under the same filters and scope. */
  const [selectingAll, setSelectingAll] = useState(false);
  const selectAllMatching = async () => {
    setSelectingAll(true);
    try {
      const r = await employeeIds({ ...apiParams(p), ...(tab === 'team' ? { team: 'mine' } : {}) });
      setSelected(new Set(r.ids || []));
      if (r.capped) notify.info(`The first ${r.ids.length} are selected; a bulk change takes at most that many.`);
    } catch (e) {
      notify.error(String(e?.message || 'Could not select them.'));
    } finally {
      setSelectingAll(false);
    }
  };
  const doExport = async (scope, columns) => {
    /*
     * Ticked rows go up as ids in the address, which holds about 500 of them.
     * More than that is exported by the filters when they are exactly the
     * rows ticked (every match); otherwise it is refused, never cut short.
     */
    const viaFilters = scope === 'selected' && selected.size > EXPORT_IDS_MAX && selected.size === total;
    if (scope === 'selected' && selected.size > EXPORT_IDS_MAX && !viaFilters) {
      notify.error(`Export takes up to ${EXPORT_IDS_MAX} ticked rows. Tick fewer, or export this view instead.`);
      return false;
    }
    setExporting(true);
    try {
      const filter = scope === 'all' ? { status: 'CURRENT' } : scope === 'selected' && !viaFilters ? { ids: [...selected].join(',') } : { ...apiParams(p), ...(tab === 'team' ? { team: 'mine' } : {}) };
      if (viaFilters) notify.info(`Exporting the ${total} people the filters match, which are the rows ticked.`);
      const text = await exportEmployees({ ...filter, columns: columns.join(',') });
      downloadText(text, `employees-${new Date().toISOString().slice(0, 10)}.csv`);
      notify.success('Exported.');
    } catch (e) {
      notify.error(String(e?.message || 'Export failed.'));
    } finally {
      setExporting(false);
    }
  };

  const clearFilters = () => { setPrivateQ(''); set(Object.fromEntries([...FILTER_KEYS, 'q', 'page', 'view'].map((k) => [k, null]))); };
  const lookup = (listName, id) => lists[listName]?.find((x) => x.id === id)?.name || 'Chosen';
  const chips = [
    p.status && { k: 'status', label: p.status === 'ALL' ? 'Including people who left' : `Status: ${STATUS[p.status]?.label || p.status}` },
    p.dept && { k: 'dept', label: p.dept === 'none' ? 'No department' : `Department: ${lookup('departments', p.dept)}` },
    p.pos && { k: 'pos', label: `Designation: ${lookup('positions', p.pos)}` },
    p.type && { k: 'type', label: `Type: ${lookup('types', p.type)}` },
    p.wtype && { k: 'wtype', label: `Work mode: ${lookup('workTypes', p.wtype)}` },
    p.hrs && { k: 'hrs', label: HOURS_WORDS[p.hrs] || 'Hours' },
    p.prob && { k: 'prob', label: 'On probation' },
    p.contract && { k: 'contract', label: 'Contract ending or ended' },
    p.working && { k: 'working', label: 'Working now' },
    p.area && { k: 'area', label: `Location: ${lookup('areas', p.area)}` },
    p.est && { k: 'est', label: `Work site: ${lookup('establishments', p.est)}` },
    p.branch && { k: 'branch', label: p.branch === 'none' ? 'No branch' : `Works at: ${lookup('branches', p.branch)}` },
    p.unit && { k: 'unit', label: `Business unit: ${lookup('units', p.unit)}` },
    p.grade && { k: 'grade', label: `Grade: ${lookup('grades', p.grade)}` },
    p.centre && { k: 'centre', label: `Cost centre: ${lookup('centres', p.centre)}` },
    p.tag && { k: 'tag', label: `Tag: ${lookup('tags', p.tag)}` },
    p.mgr && { k: 'mgr', label: p.mgr === 'none' ? 'No manager' : `Manager: ${managers.find((m) => m.id === p.mgr)?.name || 'Chosen'}` },
    (p.from || p.to) && { k: 'dates', label: `Joined ${p.from ? formatDate(p.from) : 'any time'} – ${p.to ? formatDate(p.to) : 'now'}` },
    (p.lfrom || p.lto) && { k: 'left', label: `Left ${p.lfrom ? formatDate(p.lfrom) : 'any time'} – ${p.lto ? formatDate(p.lto) : 'now'}` },
  ].filter(Boolean);

  return (
    <div className="people-directory space-y-6">
      <PageHeader
        breadcrumb={[{ label: 'People' }, { label: 'Employees' }]}
        title="Employees"
        actions={<>
          {allowed('PEOPLE::Employees::CREATE') ? <button type="button" className="ui-btn ui-btn-secondary" onClick={() => openScreen?.('employeeImport')}><Upload size={16} aria-hidden="true" /> Import</button> : null}
          {allowed('PEOPLE::Employees::EXPORT') ? <button type="button" className="ui-btn ui-btn-secondary" disabled={exporting} onClick={() => setExportOpen(true)}><Download size={16} aria-hidden="true" /> Export</button> : null}
          {allowed('PEOPLE::Employees::CREATE') ? <button type="button" className="ui-btn ui-btn-primary" onClick={() => openScreen?.('employeeNew', {})}><Plus size={16} aria-hidden="true" /> Add employee</button> : null}
        </>}
      />

      <MetricStrip counts={counts.data} onPick={(patch) => set({ ...Object.fromEntries(FILTER_KEYS.map((k) => [k, null])), page: null, ...patch }, true)} />
      <Banners openScreen={openScreen} />

      <div ref={tabsRef} role="tablist" aria-label="Employees" className={`ui-record-tablist ${tabIndicator ? 'has-indicator' : ''}`}>
        {[['directory', 'Directory'], ...(counts.data?.myTeam ? [['team', 'My team', counts.data.myTeam]] : []), ['views', 'Saved views'], ...(pendingCount ? [['pending', 'Pending actions', pendingCount]] : [])].map(([k, l, n]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} className={`ui-tab ${tab === k ? 'is-active' : ''}`} onClick={() => set({ tab: k === 'directory' ? null : k }, true)}>{l}{n ? <span className="ui-tab-count tabular-nums">{n}</span> : null}</button>
        ))}
        {tabIndicator}
      </div>

      {tab === 'pending' ? <PendingActions data={pending.data} error={pending.error} reload={pending.reload} openScreen={openScreen} /> : tab === 'views' ? <SavedViews params={params || {}} prefs={prefs} onApply={(v) => { const f = v.filters || {}; set({ ...Object.fromEntries([...FILTER_KEYS, 'q', 'sort', 'dir'].map((k) => [k, f[k] || null])), view: v.id, tab: null, page: null }, true); if (f.hidden || f.order || f.density) setPrefs({ hidden: f.hidden ? String(f.hidden).split(',').filter(Boolean) : [], order: f.order ? String(f.order).split(',').filter(Boolean) : [], density: f.density || undefined }); }} canShare={allowed('PEOPLE::Employees::EDIT')} /> : (
        <DataTable
          label="Employees"
          columns={columns}
          rows={rows}
          total={total}
          page={page}
          pageSize={size}
          onPage={(n) => set({ page: n > 1 ? n : null }, true)}
          onPageSize={(n) => set({ size: n === 25 ? null : n, page: null })}
          sort={p.sort ? { key: p.sort, dir: p.dir === 'desc' ? 'desc' : 'asc' } : null}
          onSort={(s) => set({ sort: s.key, dir: s.dir === 'desc' ? 'desc' : null, page: null })}
          prefs={prefs}
          onPrefs={setPrefs}
          defaultPrefs={{ hidden: ['manager', 'type', 'location'] }}
          selectable={allowed('PEOPLE::Employees::EDIT') || allowed('PEOPLE::Employees::EXPORT')}
          selected={selected}
          onSelect={setSelected}
          onRowClick={(r) => openRecord(r)}
          rowActions={rowActions}
          loading={list.loading}
          refreshing={list.refreshing}
          card={(r) => (
            <span className="flex items-center gap-3 min-w-0">
              <Avatar person={r} size={40} />
              <span className="min-w-0 flex-1">
                <span className="flex items-center justify-between gap-2"><span className="truncate font-medium">{r.name}</span><StatusBadge employee={r} quiet /></span>
                <span className="block truncate ui-caption">{[r.code, r.designation].filter(Boolean).join(' · ')}</span>
                <span className="block truncate ui-caption">{[r.department, r.branchName || r.areaName || r.workLocation].filter(Boolean).join(' · ')}</span>
              </span>
            </span>
          )}
          toolbar={<>
            <SearchField value={p.q || ''} onSearch={(q) => { if (/\d{6,}/.test(q)) { setPrivateQ(q); set({ q: null, page: null }); } else { setPrivateQ(''); set({ q: q || null, page: null }); } }} placeholder="Search name, employee ID or work email" label="Search employees" className="w-full sm:w-80" />
            <button type="button" className="ui-btn ui-btn-secondary" aria-haspopup="dialog" onClick={() => setFiltersOpen(true)}>
              <Filter size={16} aria-hidden="true" /> Filters{filtersOn ? <span className="ui-pill ui-pill-info tabular-nums ml-1">{filtersOn}</span> : null}
            </button>
            {selected.size ? (
              <div className="ui-bulkbar" role="status" aria-live="polite">
                <span className="tabular-nums font-medium">{selected.size === total && total > rows.length ? `All ${total} matching selected` : `${selected.size} selected`}</span>
                {rows.length && rows.every((r) => selected.has(r.id)) && total > selected.size ? (
                  <button type="button" className="ui-link text-sm" disabled={selectingAll} onClick={selectAllMatching}>{selectingAll ? 'Selecting…' : `Select all ${total} matching`}</button>
                ) : null}
                {allowed('PEOPLE::Employees::EDIT') ? <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={() => setBulk({ field: 'departmentId', value: '', reason: '' })}>Change…</button> : null}
                {allowed('PEOPLE::Employees::EXPORT') ? <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={() => setExportOpen(true)}>Export…</button> : null}
                {allowed('PEOPLE::Lifecycle::CREATE') ? <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={() => setAppAccess([...selected].map((id) => ({ id, name: rows.find((r) => r.id === id)?.name || '' })))}>Send employee app access</button> : null}
                <button type="button" className="ui-link text-sm" onClick={() => setSelected(new Set())}>Clear selection</button>
              </div>
            ) : null}
          </>}
          empty={list.error ? (
            <ErrorState error={list.error} onRetry={list.reload} />
          ) : (p.q || filtersOn) ? (
            <EmptyState kind="filtered" title="No employees match these filters" filters={chips.map((c) => c.label)} onClearFilters={clearFilters} />
          ) : (
            <EmptyState title="No employees yet" description="Add the first employee to start your workforce directory."
              routes={[
                ...(allowed('PEOPLE::Employees::CREATE') ? [{ label: 'Add employee', description: 'One person, step by step.', onSelect: () => openScreen?.('employeeNew', {}) }] : []),
                ...(allowed('PEOPLE::Employees::CREATE') ? [{ label: 'Import employees', description: 'From a spreadsheet, checked before anything is saved.', onSelect: () => openScreen?.('employeeImport') }] : []),
              ]} />
          )}
        />
      )}

      {['directory', 'team'].includes(tab) && list.error && rows.length ? <Alert tone="neg" title="Could not refresh the list" action={<button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={list.reload}>Retry</button>}>Showing the last list loaded. {list.error.message}</Alert> : null}
      {['directory', 'team'].includes(tab) && list.slow ? <Alert tone="info" title="Still loading employee records…" action={<button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={list.cancel}>Cancel</button>} /> : null}
      {['directory', 'team'].includes(tab) && chips.length ? (
        <div className="flex flex-wrap items-center gap-1.5" aria-label="Filters in force">
          {chips.map((c) => (
            <button key={c.k} type="button" className="ui-pill" onClick={() => set(c.k === 'dates' ? { from: null, to: null, page: null } : c.k === 'left' ? { lfrom: null, lto: null, page: null } : { [c.k]: null, page: null })} aria-label={`Remove ${c.label}`}>
              {c.label} <X size={12} aria-hidden="true" />
            </button>
          ))}
          <button type="button" className="ui-link text-sm" onClick={clearFilters}>Clear all</button>
        </div>
      ) : null}

      {filtersOpen ? <FiltersDrawer params={p} lists={lists} managers={managers} onClose={() => setFiltersOpen(false)} onApply={(f) => { set({ ...f, page: null }, true); setFiltersOpen(false); }} /> : null}
      {exportOpen ? <ExportDrawer counts={{ view: total, all: counts.data ? counts.data.total : null, selected: selected.size }} filtered={Boolean(p.q || filtersOn || tab === 'team')} onClose={() => setExportOpen(false)} onExport={doExport} /> : null}
      {bulk ? <BulkDrawer count={selected.size} ids={[...selected]} lists={lists} managers={managers} value={bulk} onChange={setBulk} onClose={() => setBulk(null)}
        onSend={async () => {
          try {
            const r = await bulkUpdate({ ids: [...selected], set: { [bulk.field]: bulk.value === '__clear' ? null : bulk.value }, reason: bulk.reason, ...(bulk.field !== 'hours' && bulk.effectiveFrom && bulk.effectiveFrom !== todayIst() ? { effectiveFrom: bulk.effectiveFrom } : {}) });
            setBulk(null);
            setSelected(new Set());
            setResult({ ...r, field: bulk.field, names: Object.fromEntries(rows.map((x) => [x.id, x.name])) });
            list.reload();
          } catch (e) {
            notify.error(String(e?.message || 'Not changed.'));
          }
        }} /> : null}
      {result ? <BulkResult result={result} onClose={() => setResult(null)} /> : null}
      {appAccess ? <AppAccessSend people={appAccess} onClose={() => { setAppAccess(null); setSelected(new Set()); }} /> : null}
    </div>
  );
}

const tomorrowIst = () => new Date(Date.now() + 330 * 60_000 + 86_400_000).toISOString().slice(0, 10);
const todayIst = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);

/*
 * WF-07 export: which people (this view, everyone you can see, or the rows
 * ticked), each with its count, and which columns from the server's own list
 * (work details only; nothing statutory or personal can be chosen). The
 * server builds every file, applies scope and logs it.
 */
function ExportDrawer({ counts, filtered, onClose, onExport }) {
  const columns = useRequest(() => exportColumns(), []);
  const [scope, setScope] = useState(counts.selected ? 'selected' : 'filtered');
  const [chosen, setChosen] = useState(null);
  const [busy, setBusy] = useState(false);
  const picked = chosen ?? new Set((columns.data || []).filter((c) => c.default).map((c) => c.key));
  const scopes = [
    ['filtered', filtered ? 'This view' : 'Everyone shown', counts.view],
    ...(filtered && counts.all != null ? [['all', 'Everyone you can see', counts.all]] : []),
    ...(counts.selected ? [['selected', 'Ticked rows', counts.selected]] : []),
  ];
  const toggle = (k) => { const next = new Set(picked); if (next.has(k)) next.delete(k); else next.add(k); setChosen(next); };
  const go = async () => {
    setBusy(true);
    /* A refused export (too many ticked rows) keeps the drawer open to choose another scope. */
    try { if ((await onExport(scope, (columns.data || []).filter((c) => picked.has(c.key)).map((c) => c.key))) !== false) onClose(); } finally { setBusy(false); }
  };
  return (
    <Drawer open onClose={onClose} widthClass="w-[min(36rem,96vw)] ui-drawer-sheet" title="Export employees"
      footer={<><button type="button" className="ui-btn ui-btn-secondary" onClick={onClose}>Cancel</button><button type="button" className="ui-btn ui-btn-primary" disabled={busy || !picked.size || !scopes.find(([k]) => k === scope)?.[2]} onClick={go}><Download size={16} aria-hidden="true" /> {busy ? 'Exporting…' : 'Export CSV'}</button></>}>
      <div className="ui-filter-groups">
        <section aria-label="Who">
          <h3 className="ui-filter-group-title">Who</h3>
          <div role="radiogroup" aria-label="Who" className="ui-choice-list">
            {scopes.map(([k, label, n]) => (
              <label key={k} className="ui-choice-row"><input type="radio" name="export-scope" checked={scope === k} disabled={!n} onChange={() => setScope(k)} /><span className="flex-1">{label}</span><span className="tabular-nums ui-muted">{n ?? '…'}</span></label>
            ))}
          </div>
        </section>
        <section aria-label="Columns">
          <div className="flex items-baseline gap-3"><h3 className="ui-filter-group-title">Columns</h3><span className="ui-caption tabular-nums">{picked.size} chosen</span>
            <button type="button" className="ui-btn ui-btn-ghost ui-btn-sm ml-auto" onClick={() => setChosen(new Set((columns.data || []).map((c) => c.key)))}>All</button>
            <button type="button" className="ui-btn ui-btn-ghost ui-btn-sm" onClick={() => setChosen(null)}>Default</button></div>
          {columns.error ? <ErrorState error={columns.error} onRetry={columns.reload} compact /> : !columns.data ? <span className="ui-skel ui-skel-text" /> : (
            <div className="ui-column-checks">
              {columns.data.map((c) => <label key={c.key} className="ui-choice-row"><input type="checkbox" className="ui-checkbox" checked={picked.has(c.key)} onChange={() => toggle(c.key)} />{c.label}</label>)}
            </div>
          )}
        </section>
      </div>
    </Drawer>
  );
}

function MetricStrip({ counts, onPick }) {
  const mark = useContentIcon();
  if (!counts) return <div className="ui-metric-strip" aria-busy="true"><span className="ui-skel ui-skel-text" /></div>;
  /* The owner's and the CEO's picture: who works here now, who is coming, who came and went this month, who is leaving. */
  const items = [
    { k: 'total', label: 'Working now', value: counts.total, Icon: Users, patch: { working: 'now' } },
    { k: 'joining', label: 'Joining', value: counts.joining, Icon: CalendarClock, patch: 'joining' },
    { k: 'joinedMonth', label: 'Joined this month', value: counts.joinedThisMonth ?? 0, Icon: UserCheck, patch: 'joinedMonth' },
    { k: 'leftMonth', label: 'Left this month', value: counts.leftThisMonth ?? 0, Icon: UserMinus, patch: 'leftMonth' },
    { k: 'onNotice', label: 'On notice', value: counts.onNotice, Icon: UserMinus, patch: { status: 'ON_NOTICE' } },
    { k: 'onLeave', label: 'On leave today', value: counts.onLeave, Icon: TreePalm, patch: null },
  ];
  return (
    <div className="ui-metric-strip" role="list" aria-label="Workforce counts">
      {items.map(({ k, label, value, Icon: LineIcon, patch }) => {
        const Icon = mark(LineIcon);
        const body = (tail) => <><Icon size={18} aria-hidden="true" className="ui-metric-icon" /><span><span className="ui-metric-value tabular-nums">{value}</span> <span className="ui-metric-label">{label}</span>{tail ? <span className="sr-only">{tail}</span> : null}</span></>;
        /* The list item holds the button, so it is still announced as a button. */
        return patch ? (
          <div key={k} role="listitem"><button type="button" className="ui-metric" data-zero={Number(value) === 0 || undefined} onClick={() => onPick(patch === 'joining' ? { from: tomorrowIst() } : patch === 'joinedMonth' ? { status: 'ALL', from: counts.monthStart, to: todayIst() } : patch === 'leftMonth' ? { status: 'LEFT', lfrom: counts.monthStart, lto: todayIst() } : patch)}>{body(': show them')}</button></div>
        ) : <div key={k} role="listitem" className="ui-metric" data-zero={Number(value) === 0 || undefined}>{body()}</div>;
      })}
    </div>
  );
}

/* D-V9: live counts from Data Health and checklists, dismissed per browser until the count changes. */
function Banners({ openScreen }) {
  const [docs, setDocs] = useState(0);
  const [joiners, setJoiners] = useState(0);
  const [dismissed, setDismissed] = useState(() => readJson(DISMISS_KEY, {}));
  useEffect(() => {
    dataHealth().then((h) => setDocs((h?.checks || []).filter((c) => /^(document|permit)-/.test(c.id)).reduce((a, c) => a + (c.count || 0), 0))).catch(() => {});
    openChecklistTasks().then((t) => setJoiners(new Set(t.filter((x) => x.kind === 'JOINING').map((x) => x.employee?.id)).size)).catch(() => {});
  }, []);
  const dismiss = (k, n) => { const next = { ...dismissed, [k]: n }; setDismissed(next); writeJson(DISMISS_KEY, next); };
  const items = [
    docs && dismissed.docs !== docs ? { key: 'docs', tone: 'neg', text: `${docs} expired ${docs === 1 ? 'document' : 'documents'}`, link: 'Review', screen: 'dataHealth', n: docs } : null,
    joiners && dismissed.joiners !== joiners ? { key: 'joiners', tone: 'warn', text: `${joiners} ${joiners === 1 ? 'joiner' : 'joiners'} with joining steps open`, link: 'Open Joining', screen: 'joiners', n: joiners } : null,
  ].filter(Boolean);
  if (!items.length) return null;
  /* One quiet line, not a stack of coloured boxes: the list below is what the page is for. */
  return (
    <ul className="ui-attention" aria-label="Needs attention">
      {items.map((it) => (
        <li key={it.key}>
          <span className={`ui-attention-dot is-${it.tone}`} aria-hidden="true" />
          <span>{it.text}</span>
          <button type="button" className="ui-link" onClick={() => openScreen?.(it.screen)}>{it.link}</button>
          <button type="button" className="ui-icon-btn ui-attention-x" aria-label={`Dismiss: ${it.text}`} onClick={() => dismiss(it.key, it.n)}><X size={14} aria-hidden="true" /></button>
        </li>
      ))}
    </ul>
  );
}

/* Draft vs applied (WF-03 filter contract): nothing changes until Apply; closing with a changed draft asks first. */
function FiltersDrawer({ params, lists, managers, onClose, onApply }) {
  const initial = Object.fromEntries(FILTER_KEYS.map((k) => [k, params[k] || '']));
  const [draft, setDraft] = useState(initial);
  const dirty = JSON.stringify(draft) !== JSON.stringify(initial);
  const opt = (arr) => [{ value: '', label: 'Any' }, ...arr.map((x) => ({ value: x.id, label: x.name }))];
  const field = (k, label, options, placeholder = 'Any') => (
    <div className="block">
      <PopupSelect showValueSubtext={false} label={label} placeholder={placeholder} value={draft[k]} onChange={(v) => setDraft({ ...draft, [k]: v || '' })} options={options} alwaysSearch={options.length > 8} />
    </div>
  );
  return (
    <Drawer open onClose={onClose} widthClass="w-[min(40rem,96vw)] ui-drawer-sheet" title="Filters" dirty={dirty}
      footer={<>
        <button type="button" className="ui-btn ui-btn-ghost mr-auto" onClick={() => setDraft(Object.fromEntries(FILTER_KEYS.map((k) => [k, ''])))}>Reset</button>
        <button type="button" className="ui-btn ui-btn-secondary" onClick={onClose}>Cancel</button>
        <button type="button" className="ui-btn ui-btn-primary" onClick={() => onApply(Object.fromEntries(FILTER_KEYS.map((k) => [k, draft[k] || null])))}>Apply</button>
      </>}>
      {/* Grouped by what a person asks: who they are in the job, where they sit, who they report to, when they joined. */}
      <div className="ui-filter-groups">
        <section aria-label="Job">
          <h3 className="ui-filter-group-title">Job</h3>
          <div className="ui-form-grid">
            {field('status', 'Status', [{ value: '', label: 'Current employees' }, ...Object.entries(STATUS).map(([value, s]) => ({ value, label: s.label })), { value: 'ALL', label: 'Everyone, including left' }], 'Current employees')}
            {field('pos', 'Designation', opt(lists.positions))}
            {field('type', 'Employment type', opt(lists.types))}
            {lists.workTypes.length ? field('wtype', 'Work mode', opt(lists.workTypes)) : null}
            {field('hrs', 'Hours', [{ value: '', label: 'Any' }, ...Object.entries(HOURS_WORDS).map(([value, label]) => ({ value, label }))])}
            {field('prob', 'Probation', [{ value: '', label: 'Any' }, { value: 'on', label: 'On probation' }])}
            {field('contract', 'Contract end', [{ value: '', label: 'Any' }, { value: 'ending', label: 'Ending in 30 days or ended' }])}
            {lists.grades.length ? field('grade', 'Grade', opt(lists.grades)) : null}
            {lists.tags.length ? field('tag', 'Tag', opt(lists.tags)) : null}
          </div>
        </section>
        <section aria-label="Place">
          <h3 className="ui-filter-group-title">Place</h3>
          <div className="ui-form-grid">
            {field('dept', 'Department', [...opt(lists.departments), { value: 'none', label: 'No department' }])}
            {(lists.branches || []).length > 1 ? field('branch', 'Works at', [...opt(lists.branches), { value: 'none', label: 'No branch' }]) : null}
            {field('area', 'Location', opt(lists.areas))}
            {lists.establishments.length ? field('est', 'Work site', opt(lists.establishments)) : null}
            {lists.units.length ? field('unit', 'Business unit', opt(lists.units)) : null}
            {lists.centres.length ? field('centre', 'Cost centre', opt(lists.centres)) : null}
          </div>
        </section>
        <section aria-label="Reporting and joining">
          <h3 className="ui-filter-group-title">Reporting and joining</h3>
          <div className="ui-form-grid">
            {field('mgr', 'Manager', [...opt(managers), { value: 'none', label: 'No manager' }])}
            <div />
            <div><label className="ui-label" htmlFor="wf-from">Joined from</label><DatePicker id="wf-from" value={draft.from} max={draft.to || ''} onChange={(v) => setDraft({ ...draft, from: v })} /></div>
            <div><label className="ui-label" htmlFor="wf-to">Joined to</label><DatePicker id="wf-to" value={draft.to} min={draft.from || ''} onChange={(v) => setDraft({ ...draft, to: v })} /></div>
          </div>
        </section>
      </div>
    </Drawer>
  );
}

/* What a small team moves together: every field the server's bulk change takes (services/people/bulk.ts), offered once the company keeps that list. A department is never cleared in bulk; the others may be. */
const BULK_FIELDS = [
  ['departmentId', 'Department', 'departments'], ['jobPositionId', 'Designation', 'positions'], ['reportingManagerId', 'Manager', null],
  ['branchId', 'Works at', 'branches'], ['areaId', 'Location', 'areas'], ['establishmentId', 'Work site', 'establishments'],
  ['teamId', 'Team', 'teams'], ['businessUnitId', 'Business unit', 'units'], ['gradeId', 'Grade', 'grades'], ['costCenterId', 'Cost centre', 'centres'],
  ['employeeTypeId', 'Employment type', 'types'], ['hours', 'Hours', 'hours'], ['workTypeId', 'Work mode', 'workTypes'], ['contractorId', 'Contractor', 'contractors'],
];
const NO_CLEAR = new Set(['departmentId', 'hours']);
/* The change-impact preview answers for these (routes/people.ts change-impact); asked for the first people picked and summed. */
const IMPACT_FIELDS = new Set(['establishmentId', 'departmentId', 'reportingManagerId', 'areaId']);
const IMPACT_SAMPLE = 25;
const IMPACT_HEADINGS = [['ACTION', 'Needs you'], ['AUTO', 'Follows by itself'], ['TASK', 'To check (a task is added)'], ['INFO', 'Nothing to do']];

/** What else the change affects, for the people picked: each line once, with how many of them it touches. */
function BulkImpact({ ids, field, value }) {
  /* The answer is kept with the question it answers; a newer question shows as checking until its own answer lands. */
  const [state, setState] = useState({ ask: '', lines: [], asked: 0 });
  const key = ids.join(',');
  const wanted = IMPACT_FIELDS.has(field) && value ? `${field}=${value}|${key}` : '';
  useEffect(() => {
    if (!wanted) return undefined;
    let live = true;
    const sample = key.split(',').filter(Boolean).slice(0, IMPACT_SAMPLE);
    /* Five at a time: a long selection must not open twenty-five requests at once. */
    const ask = (id) => changeImpact(id, { [field]: value === '__clear' ? '' : value }).then((r) => r?.impact || []).catch(() => []);
    (async () => {
      const all = [];
      for (let i = 0; i < sample.length && live; i += 5) all.push(...(await Promise.all(sample.slice(i, i + 5).map(ask))));
      return all;
    })()
      .then((all) => {
        if (!live) return;
        const byKey = new Map();
        for (const impact of all) {
          for (const i of impact) {
            const k = `${i.target}:${i.title}`;
            const had = byKey.get(k);
            byKey.set(k, had ? { ...had, people: had.people + 1 } : { ...i, people: 1 });
          }
        }
        setState({ ask: wanted, lines: [...byKey.values()], asked: sample.length });
      });
    return () => { live = false; };
  }, [wanted, key, field, value]);
  if (!wanted) return null;
  if (state.ask !== wanted) return <span className="ui-skel ui-skel-text" aria-label="Checking what else this affects" />;
  if (!state.lines.length) return null;
  return (
    <div className="ui-impact" aria-label="What else this affects">
      {ids.length > state.asked ? <p className="ui-caption">Checked for the first {state.asked} of {ids.length} people.</p> : null}
      {IMPACT_HEADINGS.map(([kind, heading]) => {
        const lines = state.lines.filter((i) => i.target === kind);
        return lines.length ? (
          <section key={kind} className={`ui-impact-group is-${kind.toLowerCase()}`} aria-label={heading}>
            <p className="ui-impact-heading" aria-hidden="true">{heading}</p>
            <ul>
              {lines.map((i) => (
                <li key={`${i.target}:${i.title}`}>
                  <span className="block text-sm font-medium">{i.title}{state.asked > 1 ? <span className="ui-muted font-normal tabular-nums"> · {i.people} of {state.asked}</span> : null}</span>
                  {i.detail ? <span className="block ui-caption">{i.detail}</span> : null}
                </li>
              ))}
            </ul>
          </section>
        ) : null;
      })}
    </div>
  );
}

function BulkDrawer({ count, ids = [], lists, managers, value, onChange, onClose, onSend }) {
  const [busy, setBusy] = useState(false);
  const reasonHints = useSuggestions('reason');
  /* Only lists the company has set up are offered (a branch once there is more than one to move between). */
  const fields = BULK_FIELDS.filter(([k, , src]) => !src || src === 'hours' || k === 'departmentId' || (lists[src] || []).length > (src === 'branches' ? 1 : 0));
  const f = fields.find(([k]) => k === value.field) || fields[0];
  const options = f[2] === 'hours' ? Object.entries(HOURS_WORDS).map(([id, name]) => ({ id, name })) : f[2] ? lists[f[2]] || [] : managers;
  return (
    <Drawer open onClose={onClose} widthClass="w-[min(36rem,96vw)]" title={`Change ${count} ${count === 1 ? 'employee' : 'employees'}`} dirty={Boolean(value.value || value.reason)}
      footer={<>
        <button type="button" className="ui-btn ui-btn-secondary" onClick={onClose}>Cancel</button>
        <button type="button" className="ui-btn ui-btn-primary" disabled={busy || !value.value} onClick={async () => { setBusy(true); try { await onSend(); } finally { setBusy(false); } }}>{busy ? 'Changing…' : `Change ${count}`}</button>
      </>}>
      <div className="grid gap-4">
        <div><PopupSelect showValueSubtext={false} label="What" value={f[0]} onChange={(v) => onChange({ ...value, field: v, value: '' })} alwaysSearch={fields.length > 8} options={fields.map(([k, l]) => ({ value: k, label: l }))} /></div>
        <div><PopupSelect showValueSubtext={false} label="To" value={value.value} onChange={(v) => onChange({ ...value, value: v })} placeholder="Choose…" alwaysSearch options={[...(NO_CLEAR.has(f[0]) ? [] : [{ value: '__clear', label: 'None' }]), ...options.map((o) => ({ value: o.id, label: o.name }))]} /></div>
        {/* From when, as for one person: a later day waits for that day and shows on each record under Upcoming changes. Hours change from today. */}
        {f[0] !== 'hours' ? <div><label className="ui-label" htmlFor="bulk-effective">Effective from</label><DatePicker id="bulk-effective" value={value.effectiveFrom || todayIst()} onChange={(v) => onChange({ ...value, effectiveFrom: v || '' })} /></div> : null}
        <label className="block"><span className="ui-label">Reason</span><SuggestInput maxLength={500} value={value.reason} suggestions={reasonHints} onChange={(v) => onChange({ ...value, reason: v })} placeholder="Ops folded into Sales" /></label>
        <BulkImpact ids={ids} field={f[0]} value={value.value} />
      </div>
    </Drawer>
  );
}

/* WF-17: successes and failures apart, never a false all-success; the result can be saved. */
function BulkResult({ result, onClose }) {
  const failed = result.skipped || [];
  const save = () => {
    const lines = ['Employee,Result,Reason', ...failed.map((s) => `"${(s.name || s.id).replace(/"/g, '""')}",Skipped,"${s.why}"`)];
    downloadText(`\ufeff${lines.join('\r\n')}`, `bulk-${result.correlationId}.csv`);
  };
  return (
    <Drawer open onClose={onClose} widthClass="w-[min(36rem,96vw)]" title="Bulk change finished"
      footer={<>{failed.length ? <button type="button" className="ui-btn ui-btn-secondary" onClick={save}>Download skipped</button> : null}<button type="button" className="ui-btn ui-btn-primary" onClick={onClose}>Done</button></>}>
      <dl className="ui-metric-strip">
        {result.effectiveFrom
          ? <div className="ui-metric"><span><dd className="ui-metric-value tabular-nums">{result.scheduled}</dd><dt className="ui-metric-label">Change on {formatDate(result.effectiveFrom)}</dt></span></div>
          : <div className="ui-metric"><span><dd className="ui-metric-value tabular-nums">{result.changed}</dd><dt className="ui-metric-label">Changed</dt></span></div>}
        <div className="ui-metric"><span><dd className="ui-metric-value tabular-nums">{result.unchanged}</dd><dt className="ui-metric-label">Already so</dt></span></div>
        <div className="ui-metric"><span><dd className="ui-metric-value tabular-nums">{failed.length}</dd><dt className="ui-metric-label">Skipped</dt></span></div>
        <div className="ui-metric"><span><dd className="ui-metric-value tabular-nums">{result.notFound}</dd><dt className="ui-metric-label">Not found</dt></span></div>
      </dl>
      {failed.length ? (
        <ul className="mt-4 divide-y text-sm" aria-label="Skipped">
          {failed.map((s) => <li key={s.id} className="py-2 flex justify-between gap-3"><span>{s.name}</span><span className="ui-muted">{s.why}</span></li>)}
        </ul>
      ) : null}
    </Drawer>
  );
}

function Group({ title, children, count }) {
  return count ? (
    <section className="border-t pt-3 first:border-t-0 first:pt-0" aria-label={title}>
      <header className="mb-1"><h2 className="ui-t-sec">{title} <span className="ui-caption tabular-nums">{count}</span></h2></header>
      <ul className="divide-y text-sm">{children}</ul>
    </section>
  ) : null;
}

/* WF-01 Pending actions: what is waiting on employee records, each with the place to deal with it. */
function PendingActions({ data, error, reload, openScreen }) {
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!data) return <span className="ui-skel ui-skel-text" />;
  const day = (v) => formatDate(String(v).slice(0, 10));
  const person = (e) => (e ? `${e.name}${e.code ? ` (${e.code})` : ''}` : '');
  return (
    <div className="space-y-6">
      <Group title="Awaiting approval" count={data.requests.length}>
        {data.requests.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center gap-3 py-2">
            <span className="min-w-0 flex-1"><span className="font-medium">{r.title}</span><span className="block ui-caption">Sent {day(r.createdAt)}{r.dueAt ? ` · step due ${day(r.dueAt)}` : ''}</span></span>
            {r.overdue ? <span className="ui-pill ui-pill-neg">Overdue</span> : null}
            {r.mine ? <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={() => openScreen?.('approvals')}>Decide</button> : <span className="ui-caption">With the approver</span>}
            <button type="button" className="ui-link" onClick={() => openScreen?.('employee', { id: r.employee.id, tab: 'history' })}>{person(r.employee)}</button>
          </li>
        ))}
      </Group>
      <Group title="Upcoming changes" count={data.scheduled.length}>
        {data.scheduled.map((c) => (
          <li key={c.id} className="flex flex-wrap items-center gap-3 py-2">
            <span className="tabular-nums w-28 shrink-0">{day(c.effectiveOn)}</span>
            <span className="min-w-0 flex-1">{c.label}: <span className="ui-muted">{c.from || 'None'}</span> <span aria-hidden="true">→</span><span className="sr-only">to</span> <strong>{c.to || 'None'}</strong>{c.reason ? <span className="block ui-caption">{c.reason}</span> : null}</span>
            <button type="button" className="ui-link" onClick={() => openScreen?.('employee', { id: c.employee.id, tab: 'employment' })}>{person(c.employee)}</button>
          </li>
        ))}
      </Group>
      <Group title="Details to review" count={data.invites.length}>
        {data.invites.map((i) => (
          <li key={i.id} className="flex flex-wrap items-center gap-3 py-2">
            <span className="min-w-0 flex-1">{person(i.employee)}<span className="block ui-caption">Sent back {day(i.returnedAt)}</span></span>
            <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={() => openScreen?.('employee', { id: i.employee.id, tab: 'personal' })}>Check details</button>
          </li>
        ))}
      </Group>
      <Group title="Drafts" count={data.drafts.length}>
        {data.drafts.map((d) => (
          <li key={d.id} className="flex flex-wrap items-center gap-3 py-2">
            <span className="min-w-0 flex-1">{d.label || 'Unnamed draft'}<span className="block ui-caption">Step {d.step} of 4 · saved {day(d.updatedAt)}</span></span>
            <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={() => openScreen?.('employeeNew', { draft: d.id })}>Continue</button>
          </li>
        ))}
      </Group>
      {!data.requests.length && !data.scheduled.length && !data.invites.length && !data.drafts.length ? <EmptyState title="Nothing waiting" /> : null}
    </div>
  );
}

/* EMP-12 / WF-03: own views first, then shared ones; only the maker renames, shares or deletes. */
function SavedViews({ params, prefs, onApply, canShare }) {
  const views = useRequest(() => listViews(), []);
  const [naming, setNaming] = useState(null);
  const current = Object.fromEntries([...FILTER_KEYS, 'q', 'sort', 'dir'].filter((k) => params[k]).map((k) => [k, params[k]]));
  const withColumns = { ...current, ...(prefs.hidden?.length ? { hidden: prefs.hidden.join(',') } : {}), ...(prefs.order?.length ? { order: prefs.order.join(',') } : {}), ...(prefs.density ? { density: prefs.density } : {}) };
  const save = async () => {
    try {
      const v = await saveView({ id: naming.id, screen: 'employees', name: naming.name, shared: naming.shared, filters: naming.id ? naming.filters : withColumns });
      notify.success(`Saved "${v.name}".`);
      setNaming(null);
      views.reload();
    } catch (e) {
      notify.error(String(e?.message || 'Not saved.'));
    }
  };
  const remove = async (v) => {
    if (!(await confirmDialog({ title: `Delete the view "${v.name}"?`, confirmLabel: 'Delete' }))) return;
    try { await deleteView(v.id); views.reload(); } catch (e) { notify.error(String(e?.message || 'Not deleted.')); }
  };
  const WORDS = { q: 'Search', status: 'Status', dept: 'Department', pos: 'Designation', type: 'Employment type', wtype: 'Work mode', hrs: 'Hours', prob: 'Probation', contract: 'Contract end', area: 'Location', est: 'Work site', branch: 'Works at', unit: 'Business unit', grade: 'Grade', centre: 'Cost centre', tag: 'Tag', mgr: 'Manager', from: 'Joined from', to: 'Joined to', sort: 'Sorted' };
  const describe = (f = {}) => { const used = Object.keys(f).filter((k) => WORDS[k] && k !== 'dir'); return used.length ? used.map((k) => WORDS[k]).join(', ') : 'All employees'; };
  return (
    <section aria-label="Saved views" className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="ui-t-sec">Saved views{views.data?.length ? <span className="ui-section-count tabular-nums">{views.data.length}</span> : null}</h2>
        <button type="button" className="ui-btn ui-btn-secondary ml-auto" onClick={() => setNaming({ name: '', shared: false })}><Plus size={16} aria-hidden="true" /> Save current view</button>
      </div>
      {views.loading ? <span className="ui-skel ui-skel-text" /> : views.error ? <ErrorState error={views.error} onRetry={views.reload} compact /> : !views.data.length ? <EmptyState title="No saved views yet" /> : (
        <ul className="ui-doc-list">
          {views.data.map((v) => (
            <li key={v.id}>
              <div className="ui-doc-row">
                <span className="min-w-0">
                  <button type="button" className="ui-doc-title" onClick={() => onApply(v)}>{v.name}</button>
                  <span className="ui-doc-meta">{describe(v.filters)}</span>
                </span>
                <span className={`ui-pill ${v.shared ? 'ui-pill-neutral' : 'ui-pill-outline'}`}>{v.shared ? (v.mine ? 'Shared' : 'Shared with you') : 'Private'}</span>
                <span className="flex items-center gap-1">
                  {v.mine ? <>
                    <button type="button" className="ui-icon-btn" aria-label={`Rename ${v.name}`} onClick={() => setNaming({ id: v.id, name: v.name, shared: v.shared, filters: v.filters })}><Pencil size={16} aria-hidden="true" /></button>
                    <button type="button" className="ui-icon-btn" aria-label={`Delete ${v.name}`} onClick={() => remove(v)}><Trash2 size={16} aria-hidden="true" /></button>
                  </> : null}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
      {naming ? (
        <Drawer open onClose={() => setNaming(null)} widthClass="w-[min(36rem,96vw)]" title={naming.id ? 'Rename view' : 'Save current view'} dirty={Boolean(naming.name)}
          footer={<><button type="button" className="ui-btn ui-btn-secondary" onClick={() => setNaming(null)}>Cancel</button><button type="button" className="ui-btn ui-btn-primary" disabled={!naming.name.trim()} onClick={save}>Save</button></>}>
          <div className="grid gap-4">
            <label className="block"><span className="ui-label">Name *</span><input className="ui-input w-full" maxLength={80} value={naming.name} onChange={(e) => setNaming({ ...naming, name: e.target.value })} placeholder="Sales on notice" data-autofocus /></label>
            {canShare ? <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="ui-checkbox" checked={naming.shared} onChange={(e) => setNaming({ ...naming, shared: e.target.checked })} />Share with everyone who can see the directory</label> : null}
          </div>
        </Drawer>
      ) : null}
    </section>
  );
}
