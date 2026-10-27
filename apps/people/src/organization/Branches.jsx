import React, { useMemo, useRef, useState } from 'react';
import SuggestInput from '@ui/components/ui/SuggestInput';
import { refreshSuggestions, useSuggestions } from '../workforce/suggestions';
import { Plus } from 'lucide-react';

import { EmptyState, PageHeader } from '@ui/components/ui/Primitives';
import DataTable from '@ui/components/ui/DataTable';
import SearchField from '@ui/components/ui/SearchField';
import Drawer from '@ui/components/ui/Drawer';
import ErrorState from '@ui/components/ui/ErrorState';
import PopupSelect from '@ui/components/pickers/PopupSelect';
import useRequest from '@ui/components/ui/useRequest';
import { useTabIndicator } from '@ui/components/ui/RecordTabs';
import { notify } from '@ui/components/ui/notify';
import { usePermissions } from '@ui/permissions/usePermissions';

import { can } from '../workforce/shared';
import { createBranch, listBranches, organization, retireBranch, updateBranch } from './api';
import { STATES } from './StructurePage';

/**
 * Organization → Branches. A branch is the company's registered place, the
 * same record Accounting invoices from (platform `Branch`); Attendance gives
 * people the holidays of their branch. Here a branch shows who works from it;
 * its address and state are edited here too, its GST details in Accounting.
 * A work site (the place in labour law) has its own list beside this one.
 */
export default function Branches({ openScreen }) {
  const perms = usePermissions();
  const canCreate = can(perms, 'MASTERS::Company/Branch setup::CREATE');
  const canEdit = can(perms, 'MASTERS::Company/Branch setup::EDIT');
  const req = useRequest(async () => {
    const [branches, org] = await Promise.all([listBranches(), organization().catch(() => null)]);
    const people = new Map((org?.branches || []).map((b) => [b.id, b.people]));
    return { branches: branches.map((b) => ({ ...b, people: people.get(b.id) ?? 0 })), noBranch: org?.unplaced?.noBranch ?? 0 };
  }, []);
  const [tab, setTab] = useState('active');
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState(null);
  const tabsRef = useRef(null);
  const tabIndicator = useTabIndicator(tabsRef, tab);
  const rows = req.data?.branches || [];
  const counts = { active: rows.filter((b) => b.isActive !== false).length, retired: rows.filter((b) => b.isActive === false).length };
  const shown = rows.filter((b) => (tab === 'active' ? b.isActive !== false : b.isActive === false)).filter((b) => !q || `${b.branchName} ${b.branchCode} ${b.city || ''} ${b.state}`.toLowerCase().includes(q.toLowerCase()));
  const columns = [
    { key: 'name', label: 'Branch', always: true, render: (b) => <span className="min-w-0"><span className="block truncate font-medium">{b.branchName}</span><span className="block truncate ui-caption tabular-nums">{b.branchCode}</span></span> },
    { key: 'place', label: 'City, state', render: (b) => [b.city, b.state].filter(Boolean).join(', ') || '—' },
    { key: 'people', label: 'People', align: 'right', render: (b) => <button type="button" className="ui-link tabular-nums" onClick={() => openScreen?.('employees', { branch: b.id })}>{b.people}</button> },
  ];
  const rowActions = (b) => [
    canEdit ? { key: 'edit', label: 'Edit', onSelect: () => setEditing({ ...b }) } : null,
    { key: 'people', label: 'Show people', onSelect: () => openScreen?.('employees', { branch: b.id }) },
    { key: 'history', label: 'History', onSelect: () => openScreen?.('orgChanges', { kind: 'branches', item: b.id }) },
  ];
  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumb={[{ label: 'People' }, { label: 'Organization', onClick: () => openScreen?.('organization') }, { label: 'Branches' }]}
        title="Branches"
        actions={canCreate ? <button type="button" className="ui-btn ui-btn-primary" onClick={() => setEditing({ branchName: '', branchCode: '', addressLine1: '', city: '', state: '', isActive: true })}><Plus size={16} aria-hidden="true" /> New branch</button> : null}
      />
      <div ref={tabsRef} role="tablist" aria-label="Branches" className={`ui-record-tablist ${tabIndicator ? 'has-indicator' : ''}`}>
        {[['active', 'In use', counts.active], ['retired', 'Retired', counts.retired]].map(([k, l, n]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} className={`ui-tab ${tab === k ? 'is-active' : ''}`} onClick={() => setTab(k)}>{l}{n ? <span className="ui-tab-count tabular-nums">{n}</span> : null}</button>
        ))}
        {tabIndicator}
      </div>
      {req.data?.noBranch && counts.active > 1 ? (
        <ul className="ui-attention"><li><span className="ui-attention-dot" aria-hidden="true" />{req.data.noBranch} {req.data.noBranch === 1 ? 'person has' : 'people have'} no branch, so Attendance gives them only company-wide holidays. <button type="button" className="ui-link" onClick={() => openScreen?.('employees', { branch: 'none' })}>Show them</button></li></ul>
      ) : null}
      {req.error ? <ErrorState error={req.error} onRetry={req.reload} /> : (
        <DataTable
          label="Branches"
          columns={columns}
          rows={shown}
          total={shown.length}
          page={1}
          pageSize={Math.max(25, shown.length)}
          onRowClick={canEdit ? (b) => setEditing({ ...b }) : null}
          rowActions={rowActions}
          loading={req.loading}
          refreshing={req.refreshing}
          rowKey={(b) => b.id}
          noun="branches"
          card={(b) => <span className="min-w-0 flex-1"><span className="flex items-center justify-between gap-2"><span className="truncate font-medium">{b.branchName}</span><span className="ui-caption tabular-nums">{b.people}</span></span><span className="block truncate ui-caption">{[b.city, b.state].filter(Boolean).join(', ')}</span></span>}
          empty={q ? <EmptyState kind="filtered" title="No branches match" description="Nothing here matches the search." /> : <EmptyState title={tab === 'retired' ? 'No retired branches' : 'No branches yet'} description={tab === 'retired' ? 'A branch you retire stays here for its history.' : 'Add the company’s first branch.'} />}
          toolbar={<SearchField value={q} onSearch={setQ} placeholder="Search branches" label="Search branches" className="w-full sm:w-80" />}
        />
      )}
      {editing ? <BranchDrawer value={editing} codes={rows.map((b) => b.branchCode)} others={rows.filter((b) => b.isActive !== false && b.id !== editing.id)} onClose={() => setEditing(null)} onDone={() => { setEditing(null); req.reload(); }} /> : null}
    </div>
  );
}

function BranchDrawer({ value, codes, others, onClose, onDone }) {
  const isNew = !value.id;
  const initial = useMemo(() => ({ branchName: value.branchName || '', branchCode: value.branchCode || '', addressLine1: value.addressLine1 || '', addressLine2: value.addressLine2 || '', city: value.city || '', state: value.state || '', isActive: value.isActive !== false }), [value]);
  const [form, setForm] = useState(initial);
  /* Retiring a branch people work at: they move to another open branch first. */
  const [moveTo, setMoveTo] = useState('');
  const retiring = !isNew && value.isActive !== false && !form.isActive;
  const cities = useSuggestions('city');
  /* A new branch's code, from its name: the first letters, kept clear of codes already used. */
  const codeHints = useMemo(() => {
    const name = form.branchName.trim().toUpperCase().replace(/[^A-Z0-9 ]/g, '');
    if (!isNew || !name) return [];
    const words = name.split(/\s+/).filter(Boolean);
    const used = new Set((codes || []).map((c) => String(c).toUpperCase()));
    const tries = [words.length > 1 ? words.map((w) => w[0]).join('').slice(0, 4) : '', name.replace(/\s+/g, '').slice(0, 3)].filter((c) => c.length >= 2);
    for (let n = 2; tries.length < 3 && n < 10; n += 1) tries.push(`${name.replace(/\s+/g, '').slice(0, 3)}${n}`);
    return [...new Set(tries)].filter((c) => !used.has(c)).slice(0, 2);
  }, [form.branchName, isNew, codes]);
  const working = retiring ? value.people || 0 : 0;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);
  const missing = !form.branchName.trim() ? 'name' : !form.branchCode.trim() ? 'code' : !form.addressLine1.trim() ? 'address' : !form.state ? 'state' : working && !moveTo ? 'branch to move them to' : null;
  const save = async () => {
    if (missing) { setError({ message: `Add the ${missing}.` }); return; }
    setBusy(true);
    setError(null);
    try {
      const body = { branchName: form.branchName.trim(), branchCode: form.branchCode.trim(), addressLine1: form.addressLine1.trim(), addressLine2: form.addressLine2.trim() || null, city: form.city.trim() || null, state: form.state, ...(isNew ? { country: 'India' } : { isActive: form.isActive }) };
      refreshSuggestions();
      if (isNew) await createBranch(body);
      else if (retiring) {
        const { isActive: _closing, ...rest } = body;
        await updateBranch(value.id, rest);
        await retireBranch(value.id, { moveTo: moveTo || null });
      } else await updateBranch(value.id, body);
      notify.success(`${body.branchName} saved.`);
      onDone();
    } catch (e) { setError(e); } finally { setBusy(false); }
  };
  return (
    <Drawer open onClose={onClose} widthClass="w-[min(36rem,96vw)] ui-drawer-sheet" title={isNew ? 'New branch' : `Edit ${value.branchName}`} dirty={dirty}
      footer={<><button type="button" className="ui-btn ui-btn-secondary" onClick={onClose}>Cancel</button><button type="button" className="ui-btn ui-btn-primary" disabled={busy || !dirty || (working > 0 && !others.length)} onClick={save}>{busy ? 'Saving…' : 'Save'}</button></>}>
      <form className="ui-form-grid" onSubmit={(e) => { e.preventDefault(); save(); }}>
        {error ? <div className="sm:col-span-2"><ErrorState error={error?.status ? error : null} compact title={error?.status ? undefined : error.message} body={error?.status && error.status < 500 ? error.message : undefined} /></div> : null}
        <label className="block"><span className="ui-label">Name *</span><input className="ui-input w-full" maxLength={200} value={form.branchName} onChange={(e) => set('branchName', e.target.value)} autoFocus /></label>
        <label className="block"><span className="ui-label">Code *</span>{isNew ? <SuggestInput maxLength={20} value={form.branchCode} onChange={(v) => set('branchCode', v)} suggestions={codeHints} placeholder="BLR" /> : <input className="ui-input w-full" value={form.branchCode} disabled />}</label>
        <label className="block sm:col-span-2"><span className="ui-label">Address *</span><input className="ui-input w-full" maxLength={250} value={form.addressLine1} onChange={(e) => set('addressLine1', e.target.value)} /></label>
        <label className="block sm:col-span-2"><span className="ui-label">Address, line 2</span><input className="ui-input w-full" maxLength={250} value={form.addressLine2} onChange={(e) => set('addressLine2', e.target.value)} /></label>
        <label className="block"><span className="ui-label">City</span><SuggestInput maxLength={100} value={form.city} onChange={(v) => set('city', v)} suggestions={form.branchName.trim() ? [{ value: form.branchName.trim(), hint: 'Branch name' }, ...cities] : cities} /></label>
        <div><PopupSelect showValueSubtext={false} label="State *" value={form.state} onChange={(v) => set('state', v || '')} placeholder="Choose…" alwaysSearch options={STATES.map((s) => ({ value: s, label: s }))} /></div>
        {!isNew ? <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" className="ui-checkbox" checked={form.isActive} onChange={(e) => set('isActive', e.target.checked)} />In use</label> : null}
        {working ? (
          others.length ? (
            <div className="sm:col-span-2 grid gap-2">
              <p className="text-sm">{working === 1 ? '1 person works' : `${working} people work`} here. They move first.</p>
              <PopupSelect showValueSubtext={false} label="Move them to *" value={moveTo} onChange={(v) => setMoveTo(v || '')} placeholder="Choose…" options={others.map((b) => ({ value: b.id, label: b.branchName }))} />
            </div>
          ) : <p className="text-sm sm:col-span-2 ui-text-neg">{working === 1 ? '1 person works' : `${working} people work`} here and there is no other branch to move them to. Add one first.</p>
        ) : null}
      </form>
    </Drawer>
  );
}
