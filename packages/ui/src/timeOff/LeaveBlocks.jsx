import React, { useMemo, useState } from 'react';
import { Plus, X } from '@ui/components/ui/lineIcons';

import { EmptyState, PageHeader } from '@ui/components/ui/Primitives';
import DataTable from '@ui/components/ui/DataTable';
import Drawer from '@ui/components/ui/Drawer';
import ErrorState from '@ui/components/ui/ErrorState';
import DatePicker, { formatDate } from '@ui/components/ui/DatePicker';
import PopupSelect from '@ui/components/pickers/PopupSelect';
import useRequest from '@ui/components/ui/useRequest';
import { confirmDialog, notify } from '@ui/components/ui/notify';
import { usePermissions } from '@ui/permissions/usePermissions';
import { listStructure } from '@ui/personnel/api';

import { can, istDay } from './shared';
import { createLeaveBlock, deleteLeaveBlock, listLeaveBlocks, listLeaveTypes, listPeople, updateLeaveBlock } from './api';

/**
 * Settings → Leave block dates (owner, 29 Oct 2026, from ERPNext's Leave
 * Block List): days nobody may ask for leave, such as a year-end close or a
 * peak season. A block is for the whole company or some departments, every
 * leave type or some, and the people it names may still ask. HR entering
 * leave for someone is not held to it. Soonest first; past blocks drop off.
 */
const BLANK = { name: '', fromDate: '', toDate: '', departmentIds: [], leaveTypeIds: [], allowedEmployeeIds: [] };
const span = (b) => (b.fromDate === b.toDate ? formatDate(b.fromDate) : `${formatDate(b.fromDate)} – ${formatDate(b.toDate)}`);
const names = (ids, items, every) => (!ids?.length ? every : ids.map((x) => items.get(x) || 'Removed').join(', '));

export default function LeaveBlocks() {
  const perms = usePermissions();
  const canEdit = can(perms, 'ATTENDANCE::Leave Types::EDIT') && !perms?.ownDocumentsOnly;
  const req = useRequest(() => listLeaveBlocks(), []);
  const refs = useRequest(() => Promise.all([listStructure('departments').catch(() => []), listLeaveTypes().catch(() => []), listPeople().catch(() => [])])
    .then(([departments, types, people]) => ({ departments, types: types.filter((t) => t.isActive), people })), []);
  const [open, setOpen] = useState(null);
  const [today] = useState(() => istDay(Date.now()));
  const maps = useMemo(() => ({
    departments: new Map((refs.data?.departments || []).map((x) => [x.id, x.name])),
    types: new Map((refs.data?.types || []).map((x) => [x.id, x.name])),
    people: new Map((refs.data?.people || []).map((x) => [x.id, x.name])),
  }), [refs.data]);
  const rows = req.data || [];

  const remove = async (b) => {
    const ok = await confirmDialog({ title: 'Remove this block?', message: `Leave can be asked for on ${span(b)} again.`, confirmLabel: 'Remove' });
    if (!ok) return;
    try {
      await deleteLeaveBlock(b.id);
      notify.success('Block removed.');
      req.reload();
    } catch (err) {
      notify.error(String(err?.message || 'Not removed.'));
    }
  };

  const columns = [
    { key: 'name', label: 'Block', always: true, render: (b) => <span className="font-medium">{b.name}</span> },
    { key: 'when', label: 'Dates', render: (b) => <span className="tabular-nums whitespace-nowrap">{span(b)}</span> },
    { key: 'who', label: 'Departments', render: (b) => names(b.departmentIds, maps.departments, 'Everyone') },
    { key: 'types', label: 'Leave types', render: (b) => names(b.leaveTypeIds, maps.types, 'Every type') },
    { key: 'allowed', label: 'May still ask', render: (b) => (b.allowedEmployeeIds?.length ? names(b.allowedEmployeeIds, maps.people, '') : '—') },
    { key: 'status', label: 'Status', render: (b) => (b.toDate < today ? <span className="ui-pill ui-pill-neutral">Over</span> : b.fromDate <= today ? <span className="ui-pill ui-pill-warn">Now</span> : <span className="ui-pill ui-pill-neutral">Coming</span>) },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Leave block dates"
        actions={canEdit ? <button type="button" className="ui-btn ui-btn-primary" onClick={() => setOpen(BLANK)}><Plus size={16} aria-hidden="true" /> Add block</button> : null}
      />
      {req.error && !req.data ? <ErrorState error={req.error} onRetry={req.reload} /> : (
        <DataTable
          label="Leave block dates"
          columns={columns}
          rows={rows}
          total={rows.length}
          page={1}
          pageSize={Math.max(25, rows.length)}
          noun="blocks"
          loading={req.loading}
          refreshing={req.refreshing}
          onRowClick={canEdit ? (b) => setOpen(b) : undefined}
          rowActions={canEdit ? (b) => [{ key: 'edit', label: 'Change', onSelect: () => setOpen(b) }, { key: 'remove', label: 'Remove', danger: true, onSelect: () => remove(b) }] : null}
          card={(b) => (
            <span className="min-w-0 flex-1">
              <span className="flex items-center justify-between gap-2"><span className="truncate font-medium">{b.name}</span><span className="ui-caption tabular-nums whitespace-nowrap">{span(b)}</span></span>
              <span className="block truncate ui-caption">{names(b.departmentIds, maps.departments, 'Everyone')} · {names(b.leaveTypeIds, maps.types, 'Every type')}</span>
            </span>
          )}
          empty={<EmptyState title="No days blocked" description="Block days nobody may ask for leave, such as the year-end close or the festive rush. HR can still enter leave on them." />}
        />
      )}
      {open ? <BlockDrawer block={open} refs={refs.data || { departments: [], types: [], people: [] }} onClose={() => setOpen(null)} onDone={() => { setOpen(null); req.reload(); }} /> : null}
    </div>
  );
}

function BlockDrawer({ block, refs, onClose, onDone }) {
  const start = useMemo(() => ({ ...BLANK, ...block }), [block]);
  const [form, setForm] = useState(start);
  const [saving, setSaving] = useState(false);
  const editing = Boolean(block.id);
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v, ...(k === 'fromDate' && v && (!f.toDate || f.toDate < v) ? { toDate: v } : {}) }));
  const toggle = (k, v) => setForm((f) => ({ ...f, [k]: f[k].includes(v) ? f[k].filter((x) => x !== v) : [...f[k], v] }));
  const ready = form.name.trim().length >= 2 && form.fromDate && form.toDate;
  const dirty = JSON.stringify(form) !== JSON.stringify(start);
  const people = new Map(refs.people.map((x) => [x.id, x]));

  const save = async (e) => {
    e?.preventDefault();
    if (!ready || saving || !dirty) return;
    setSaving(true);
    try {
      const body = { name: form.name.trim(), fromDate: form.fromDate, toDate: form.toDate, departmentIds: form.departmentIds, leaveTypeIds: form.leaveTypeIds, allowedEmployeeIds: form.allowedEmployeeIds };
      if (editing) await updateLeaveBlock(block.id, body);
      else await createLeaveBlock(body);
      notify.success(editing ? 'Block changed.' : `Leave blocked, ${span(body)}.`);
      onDone();
    } catch (err) {
      notify.error(String(err?.message || 'Not saved.'));
    } finally {
      setSaving(false);
    }
  };

  const chips = (key, legend, items, every) => (
    <fieldset>
      <legend className="ui-label">{legend}</legend>
      {items.length ? (
        <div className="flex flex-wrap gap-1.5">
          {items.map((x) => <button key={x.id} type="button" className="ui-choice-chip" aria-pressed={form[key].includes(x.id)} onClick={() => toggle(key, x.id)}>{x.name}</button>)}
        </div>
      ) : null}
      {!form[key].length ? <span className="ui-caption">None chosen: {every}.</span> : null}
    </fieldset>
  );

  return (
    <Drawer
      open
      onClose={onClose}
      widthClass="w-[min(36rem,96vw)]"
      dirty={dirty}
      title={editing ? block.name : 'Add block'}
      footer={<>
        <button type="button" className="ui-btn ui-btn-secondary" onClick={onClose}>Cancel</button>
        <button type="submit" form="leave-block" className="ui-btn ui-btn-primary" disabled={!ready || saving || !dirty}>{saving ? 'Saving…' : 'Save'}</button>
      </>}
    >
      <form id="leave-block" onSubmit={save} className="space-y-4">
        <label className="block">
          <span className="ui-label">Name *</span>
          <input className="ui-input w-full" maxLength={120} placeholder="Year-end close" value={form.name} onChange={(e) => set('name', e.target.value)} />
        </label>
        <div className="grid gap-4 sm:grid-cols-2">
          <div><span className="ui-label" id="lb-from">First day *</span><DatePicker label="First day" describedBy="lb-from" value={form.fromDate} onChange={(v) => set('fromDate', v || '')} /></div>
          <div><span className="ui-label" id="lb-to">Last day *</span><DatePicker label="Last day" describedBy="lb-to" value={form.toDate} min={form.fromDate} onChange={(v) => set('toDate', v || '')} /></div>
        </div>
        {chips('departmentIds', 'Departments', refs.departments, 'the whole company')}
        {chips('leaveTypeIds', 'Leave types', refs.types, 'every leave type')}
        <div className="space-y-2">
          <PopupSelect showValueSubtext={false} label="May still ask" value="" onChange={(v) => { if (v && !form.allowedEmployeeIds.includes(v)) set('allowedEmployeeIds', [...form.allowedEmployeeIds, v]); }} placeholder="Add a person…" alwaysSearch
            options={refs.people.filter((x) => !form.allowedEmployeeIds.includes(x.id)).map((x) => ({ value: x.id, label: x.code ? `${x.name} (${x.code})` : x.name }))} />
          {form.allowedEmployeeIds.length ? (
            <ul className="flex flex-wrap gap-1.5" aria-label="May still ask">
              {form.allowedEmployeeIds.map((pid) => (
                <li key={pid}>
                  <button type="button" className="ui-choice-chip" aria-label={`Remove ${people.get(pid)?.name || 'this person'}`} onClick={() => toggle('allowedEmployeeIds', pid)}>
                    {people.get(pid)?.name || 'Removed'} <X size={12} aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          ) : <p className="ui-caption">Nobody else. HR entering leave for someone is never held to a block.</p>}
        </div>
      </form>
    </Drawer>
  );
}
