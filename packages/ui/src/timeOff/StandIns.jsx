import React, { useState } from 'react';
import { Plus } from 'lucide-react';

import { EmptyState, PageHeader } from '@ui/components/ui/Primitives';
import DataTable from '@ui/components/ui/DataTable';
import Drawer from '@ui/components/ui/Drawer';
import ErrorState from '@ui/components/ui/ErrorState';
import DatePicker, { formatDate } from '@ui/components/ui/DatePicker';
import PopupSelect from '@ui/components/pickers/PopupSelect';
import useRequest from '@ui/components/ui/useRequest';
import { confirmDialog, notify } from '@ui/components/ui/notify';
import { usePermissions } from '@ui/permissions/usePermissions';

import { can, homeCrumbs } from './shared';
import { addStandIn, listStandIns, removeStandIn, listPeople } from './api';

/**
 * Time & Leave → Stand-ins: who decides leave for a manager while they are
 * away, between two dates. HR names one for any manager; a manager names one
 * for themselves. Live ones first, then the ones to come, then the ones over.
 */
const rank = (r, today) => (r.live ? 0 : r.fromDate > today ? 1 : 2);
const when = (r, today) => (r.live ? ['Live', 'ui-pill-pos'] : r.fromDate > today ? ['Starts later', 'ui-pill-neutral'] : ['Over', 'ui-pill-neutral']);

export default function StandIns() {
  const perms = usePermissions();
  /* Whole-company roles name a stand-in for anyone; a team role only for themselves. */
  const wholeCompany = Boolean(perms?.isAdmin) || can(perms, 'PEOPLE::Employees::EDIT');
  const req = useRequest(() => listStandIns(), []);
  const [adding, setAdding] = useState(false);
  const today = req.data?.today || '';
  const rows = [...(req.data?.standIns || [])].sort((a, b) => rank(a, today) - rank(b, today) || a.fromDate.localeCompare(b.fromDate));

  const remove = async (r) => {
    const ok = await confirmDialog({ title: 'Remove this stand-in?', message: `${r.standInName} stops deciding for ${r.managerName}.`, confirmLabel: 'Remove' });
    if (!ok) return;
    try {
      await removeStandIn(r.id);
      notify.success('Stand-in removed.');
      req.reload();
    } catch (err) {
      notify.error(String(err?.message || 'Not removed.'));
    }
  };

  const columns = [
    { key: 'manager', label: 'Manager', always: true, render: (r) => <span className="font-medium">{r.managerName || '—'}</span> },
    { key: 'standIn', label: 'Stands in', render: (r) => r.standInName || '—' },
    { key: 'from', label: 'From', render: (r) => <span className="tabular-nums whitespace-nowrap">{formatDate(r.fromDate)}</span> },
    { key: 'to', label: 'To', render: (r) => <span className="tabular-nums whitespace-nowrap">{formatDate(r.toDate)}</span> },
    { key: 'status', label: 'Status', render: (r) => { const [label, pill] = when(r, today); return <span className={`ui-pill ${pill}`}>{label}</span>; } },
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumb={homeCrumbs()}
        title="Stand-ins"
        actions={<button type="button" className="ui-btn ui-btn-primary" onClick={() => setAdding(true)}><Plus size={16} aria-hidden="true" /> Add stand-in</button>}
      />
      {req.error && !req.data ? <ErrorState error={req.error} onRetry={req.reload} /> : (
        <DataTable
          label="Stand-ins"
          columns={columns}
          rows={rows}
          total={rows.length}
          page={1}
          pageSize={Math.max(25, rows.length)}
          noun="stand-ins"
          loading={req.loading}
          refreshing={req.refreshing}
          rowActions={(r) => [{ key: 'remove', label: 'Remove', danger: true, onSelect: () => remove(r) }]}
          card={(r) => {
            const [label, pill] = when(r, today);
            return (
              <span className="min-w-0 flex-1">
                <span className="flex items-center justify-between gap-2"><span className="truncate font-medium">{r.standInName} for {r.managerName}</span><span className={`ui-pill ${pill}`}>{label}</span></span>
                <span className="block ui-caption tabular-nums">{formatDate(r.fromDate)} – {formatDate(r.toDate)}</span>
              </span>
            );
          }}
          empty={<EmptyState title="No stand-ins" description="While a manager is away, someone else can decide their team's leave." />}
        />
      )}
      {adding ? <AddStandIn wholeCompany={wholeCompany} onClose={() => setAdding(false)} onDone={() => { setAdding(false); req.reload(); }} /> : null}
    </div>
  );
}

function AddStandIn({ wholeCompany, onClose, onDone }) {
  const [form, setForm] = useState({ managerEmployeeId: '', standInEmployeeId: '', fromDate: '', toDate: '' });
  const [saving, setSaving] = useState(false);
  const people = useRequest(() => listPeople(), []);
  const options = (people.data || []).map((x) => ({ value: x.id, label: x.code ? `${x.name} (${x.code})` : x.name }));
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v, ...(k === 'fromDate' && v && (!f.toDate || f.toDate < v) ? { toDate: v } : {}) }));
  const same = Boolean(form.managerEmployeeId) && form.managerEmployeeId === form.standInEmployeeId;
  const ready = form.standInEmployeeId && form.fromDate && form.toDate && (!wholeCompany || form.managerEmployeeId) && !same;
  const dirty = Boolean(form.managerEmployeeId || form.standInEmployeeId || form.fromDate);

  const save = async (e) => {
    e?.preventDefault();
    if (!ready || saving) return;
    setSaving(true);
    try {
      const out = await addStandIn({ ...(wholeCompany ? { managerEmployeeId: form.managerEmployeeId } : {}), standInEmployeeId: form.standInEmployeeId, fromDate: form.fromDate, toDate: form.toDate });
      notify.success(`${out.standIn?.standInName || 'They'} stand${out.standIn?.standInName ? 's' : ''} in for ${out.standIn?.managerName || 'the manager'}.`);
      onDone();
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
      widthClass="w-[min(36rem,96vw)]"
      dirty={dirty}
      title="Add stand-in"
      footer={<>
        <button type="button" className="ui-btn ui-btn-secondary" onClick={onClose}>Cancel</button>
        <button type="submit" form="add-stand-in" className="ui-btn ui-btn-primary" disabled={!ready || saving}>{saving ? 'Saving…' : 'Save'}</button>
      </>}
    >
      <form id="add-stand-in" onSubmit={save} className="space-y-4">
        {wholeCompany ? <PopupSelect showValueSubtext={false} label="Manager *" value={form.managerEmployeeId} onChange={(v) => set('managerEmployeeId', v || '')} placeholder="Choose…" alwaysSearch options={options} /> : null}
        <PopupSelect showValueSubtext={false} label="Stands in *" value={form.standInEmployeeId} onChange={(v) => set('standInEmployeeId', v || '')} placeholder="Choose…" alwaysSearch options={options} />
        {same ? <p className="ui-caption ui-text-neg" role="alert">Someone else stands in.</p> : null}
        <div className="grid gap-4 sm:grid-cols-2">
          <div><span className="ui-label" id="si-from">From *</span><DatePicker label="From" describedBy="si-from" value={form.fromDate} onChange={(v) => set('fromDate', v || '')} /></div>
          <div><span className="ui-label" id="si-to">To *</span><DatePicker label="To" describedBy="si-to" value={form.toDate} min={form.fromDate} onChange={(v) => set('toDate', v || '')} /></div>
        </div>
      </form>
    </Drawer>
  );
}
