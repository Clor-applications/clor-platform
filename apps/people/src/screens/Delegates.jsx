import React, { useState } from 'react';
import { Plus } from '@ui/components/ui/lineIcons';

import { EmptyState, PageHeader } from '@ui/components/ui/Primitives';
import DataTable from '@ui/components/ui/DataTable';
import Drawer from '@ui/components/ui/Drawer';
import Alert from '@ui/components/ui/Alert';
import DatePicker, { formatDate } from '@ui/components/ui/DatePicker';
import PopupSelect from '@ui/components/pickers/PopupSelect';
import useRequest from '@ui/components/ui/useRequest';
import { confirmDialog, notify } from '@ui/components/ui/notify';
import { usePermissions } from '@ui/permissions/usePermissions';
import { homeCrumbs } from '@ui/timeOff/shared';
import { addStandIn as addLeaveDelegate, listPeople, listStandIns as listLeaveDelegates, removeStandIn as removeLeaveDelegate } from '@ui/timeOff/api';

import { addStandIn as addApprovalDelegate, listStandInsFull as listApprovalDelegates, removeStandIn as removeApprovalDelegate, standInCandidates } from '../api/approvals';

/**
 * Time → Delegates (FEATURE-UI-AUDIT gap 9): one list of who decides in a
 * manager's place while they are away. Two kinds of decision are handed on:
 *
 *   Leave             the team's leave requests (leave delegates; HR names one
 *                     for any manager, a manager for themselves)
 *   Other approvals   job changes, detail changes, leaving, probation and
 *                     letters (People approval stand-ins; only the manager
 *                     names their own, from their own sign-in)
 *
 * One form names both at once, which is what a manager going on leave wants.
 */
const can = (perms, key) => Boolean(perms?.isAdmin || perms?.permissions?.has?.(key));
const KIND = { LEAVE: 'Leave', APPROVALS: 'Other approvals' };
const rank = (r, today) => (r.live ? 0 : r.fromDate > today ? 1 : 2);
const when = (r, today) => (r.live ? ['Live', 'ui-pill-pos'] : r.fromDate > today ? ['Starts later', 'ui-pill-neutral'] : ['Over', 'ui-pill-neutral']);
const todayIst = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);

export default function Delegates() {
  const perms = usePermissions();
  const seesLeave = can(perms, 'ATTENDANCE::Leave Requests::VIEW');
  const namesLeave = can(perms, 'ATTENDANCE::Leave Requests::APPROVE');
  const seesApprovals = can(perms, 'PEOPLE::Requests::VIEW');
  /* Whole-company roles name a leave delegate for anyone; a team role only for themselves. */
  const wholeCompany = Boolean(perms?.isAdmin) || !perms?.ownDocumentsOnly;
  const leave = useRequest(() => (seesLeave ? listLeaveDelegates() : Promise.resolve({ standIns: [] })), [seesLeave]);
  const approvals = useRequest(() => (seesApprovals ? listApprovalDelegates() : Promise.resolve({ standIns: [] })), [seesApprovals]);
  const [adding, setAdding] = useState(false);
  const today = leave.data?.today || approvals.data?.today || todayIst();
  const selfEmployeeId = approvals.data?.selfEmployeeId || null;
  const reload = () => { leave.reload(); approvals.reload(); };

  const rows = [
    ...(leave.data?.standIns || []).map((r) => ({ ...r, key: `L:${r.id}`, kind: 'LEAVE' })),
    ...(approvals.data?.standIns || []).map((r) => ({ ...r, key: `A:${r.id}`, kind: 'APPROVALS', managerName: 'You', mine: true })),
  ].map((r) => ({ ...r, name: `${r.standInName || 'Delegate'} for ${r.mine ? 'you' : r.managerName} (${KIND[r.kind].toLowerCase()})` }))
    .sort((a, b) => rank(a, today) - rank(b, today) || a.fromDate.localeCompare(b.fromDate));

  const remove = async (r) => {
    const ok = await confirmDialog({ title: 'Remove this delegate?', message: `${r.standInName || 'They'} stop${r.standInName ? 's' : ''} deciding ${r.kind === 'LEAVE' ? 'leave' : 'other approvals'} for ${r.mine ? 'you' : r.managerName}.`, confirmLabel: 'Remove' });
    if (!ok) return;
    try {
      await (r.kind === 'LEAVE' ? removeLeaveDelegate(r.id) : removeApprovalDelegate(r.id));
      notify.success('Delegate removed.');
      reload();
    } catch (err) {
      notify.error(String(err?.message || 'Not removed.'));
    }
  };

  const columns = [
    { key: 'manager', label: 'In place of', always: true, render: (r) => <span className="font-medium">{r.managerName || '—'}</span> },
    { key: 'standIn', label: 'Decides', render: (r) => r.standInName || '—' },
    { key: 'kind', label: 'What', render: (r) => KIND[r.kind] },
    { key: 'from', label: 'From', render: (r) => <span className="tabular-nums whitespace-nowrap">{formatDate(r.fromDate)}</span> },
    { key: 'to', label: 'To', render: (r) => <span className="tabular-nums whitespace-nowrap">{formatDate(r.toDate)}</span> },
    { key: 'status', label: 'Status', render: (r) => { const [label, pill] = when(r, today); return <span className={`ui-pill ${pill}`}>{label}</span>; } },
  ];
  const canRemove = (r) => (r.kind === 'LEAVE' ? namesLeave : true);
  const error = (seesLeave && leave.error && !leave.data) || (seesApprovals && approvals.error && !approvals.data);

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumb={homeCrumbs()}
        title="Delegates"
        actions={namesLeave || seesApprovals ? <button type="button" className="ui-btn ui-btn-primary" onClick={() => setAdding(true)}><Plus size={16} aria-hidden="true" /> Add delegate</button> : null}
      />
      {error ? <Alert tone="neg" title="Part of this list could not be loaded" action={<button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={reload}>Retry</button>}>{(leave.error || approvals.error)?.message || 'Try again.'}</Alert> : null}
      <DataTable
        label="Delegates"
        columns={columns}
        rows={rows}
        total={rows.length}
        page={1}
        pageSize={Math.max(25, rows.length)}
        noun="delegates"
        loading={leave.loading || approvals.loading}
        refreshing={leave.refreshing || approvals.refreshing}
        rowActions={(r) => (canRemove(r) ? [{ key: 'remove', label: 'Remove', danger: true, onSelect: () => remove(r) }] : [])}
        card={(r) => {
          const [label, pill] = when(r, today);
          return (
            <span className="min-w-0 flex-1">
              <span className="flex items-center justify-between gap-2"><span className="truncate font-medium">{r.standInName} for {r.mine ? 'you' : r.managerName}</span><span className={`ui-pill ${pill}`}>{label}</span></span>
              <span className="block ui-caption tabular-nums">{KIND[r.kind]} · {formatDate(r.fromDate)} – {formatDate(r.toDate)}</span>
            </span>
          );
        }}
        empty={<EmptyState title="No delegates" description="While a manager is away, someone else can decide their team's leave and other approvals." />}
      />
      {adding ? (
        <AddDelegate wholeCompany={wholeCompany} namesLeave={namesLeave} namesApprovals={seesApprovals} selfEmployeeId={selfEmployeeId}
          onClose={() => setAdding(false)} onDone={() => { setAdding(false); reload(); }} />
      ) : null}
    </div>
  );
}

function AddDelegate({ wholeCompany, namesLeave, namesApprovals, selfEmployeeId, onClose, onDone }) {
  const [form, setForm] = useState({ managerEmployeeId: selfEmployeeId || '', standInEmployeeId: '', fromDate: '', toDate: '', leave: namesLeave, approvals: namesApprovals && Boolean(selfEmployeeId) });
  const [saving, setSaving] = useState(false);
  /* Whose decisions: the people this role may see. Who decides: also anyone with a sign-in (a team manager's own manager is outside their team). */
  const people = useRequest(() => Promise.all([listPeople().catch(() => []), namesApprovals ? standInCandidates() : Promise.resolve([])]), [namesApprovals]);
  const label = (x) => (x.code ? `${x.name} (${x.code})` : x.name);
  const options = (people.data?.[0] || []).map((x) => ({ value: x.id, label: label(x) }));
  const standInOptions = [...options, ...(people.data?.[1] || []).filter((x) => !options.some((o) => o.value === x.id)).map((x) => ({ value: x.id, label: label(x) }))].sort((a, b) => a.label.localeCompare(b.label));
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v, ...(k === 'fromDate' && v && (!f.toDate || f.toDate < v) ? { toDate: v } : {}) }));
  /* Other approvals are handed on by the manager themselves: offered only when the manager is the person signed in. */
  const forSelf = !wholeCompany || !form.managerEmployeeId || form.managerEmployeeId === selfEmployeeId;
  const approvalsOn = form.approvals && namesApprovals && forSelf && Boolean(selfEmployeeId);
  const leaveOn = form.leave && namesLeave;
  const same = Boolean(form.standInEmployeeId) && form.standInEmployeeId === (wholeCompany ? form.managerEmployeeId : selfEmployeeId);
  const ready = form.standInEmployeeId && form.fromDate && form.toDate && (!wholeCompany || !leaveOn || form.managerEmployeeId) && !same && (leaveOn || approvalsOn);
  const dirty = Boolean(form.standInEmployeeId || form.fromDate);

  const save = async (e) => {
    e?.preventDefault();
    if (!ready || saving) return;
    setSaving(true);
    const done = [];
    const failed = [];
    const dates = { fromDate: form.fromDate, toDate: form.toDate };
    if (leaveOn) {
      try {
        await addLeaveDelegate({ ...(wholeCompany && form.managerEmployeeId ? { managerEmployeeId: form.managerEmployeeId } : {}), standInEmployeeId: form.standInEmployeeId, ...dates });
        done.push('leave');
      } catch (err) { failed.push(`Leave: ${err?.message || 'not saved'}`); }
    }
    if (approvalsOn) {
      try {
        await addApprovalDelegate({ standInEmployeeId: form.standInEmployeeId, ...dates });
        done.push('other approvals');
      } catch (err) { failed.push(`Other approvals: ${err?.message || 'not saved'}`); }
    }
    setSaving(false);
    const name = standInOptions.find((o) => o.value === form.standInEmployeeId)?.label?.replace(/ \(.*\)$/, '') || 'They';
    if (done.length) notify.success(`${name} decides ${done.join(' and ')} from ${formatDate(form.fromDate)} to ${formatDate(form.toDate)}.`);
    if (failed.length) notify.error(failed.join(' '));
    if (done.length && !failed.length) onDone();
    else if (done.length) onDone();
  };

  return (
    <Drawer open onClose={onClose} widthClass="w-[min(36rem,96vw)]" dirty={dirty} title="Add delegate"
      footer={<>
        <button type="button" className="ui-btn ui-btn-secondary" onClick={onClose}>Cancel</button>
        <button type="submit" form="add-delegate" className="ui-btn ui-btn-primary" disabled={!ready || saving}>{saving ? 'Saving…' : 'Save'}</button>
      </>}>
      <form id="add-delegate" onSubmit={save} className="space-y-4">
        {wholeCompany ? <PopupSelect showValueSubtext={false} label="In place of *" value={form.managerEmployeeId} onChange={(v) => set('managerEmployeeId', v || '')} placeholder="Choose…" alwaysSearch options={options} /> : null}
        <PopupSelect showValueSubtext={false} label="Decides *" value={form.standInEmployeeId} onChange={(v) => set('standInEmployeeId', v || '')} placeholder="Choose…" alwaysSearch options={standInOptions} />
        {same ? <p className="ui-caption ui-text-neg" role="alert">Someone else decides.</p> : null}
        <div className="grid gap-4 sm:grid-cols-2">
          <div><span className="ui-label" id="dl-from">From *</span><DatePicker label="From" describedBy="dl-from" value={form.fromDate} onChange={(v) => set('fromDate', v || '')} /></div>
          <div><span className="ui-label" id="dl-to">To *</span><DatePicker label="To" describedBy="dl-to" value={form.toDate} min={form.fromDate} onChange={(v) => set('toDate', v || '')} /></div>
        </div>
        <fieldset className="space-y-2">
          <legend className="ui-label">What they decide</legend>
          {namesLeave ? <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="ui-checkbox" checked={form.leave} onChange={(e) => set('leave', e.target.checked)} />Leave requests</label> : null}
          {namesApprovals ? (
            <>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="ui-checkbox" checked={approvalsOn} disabled={!forSelf || !selfEmployeeId} onChange={(e) => set('approvals', e.target.checked)} />Other approvals: job changes, detail changes, leaving, probation, letters</label>
              {!selfEmployeeId ? <span className="block ui-caption">Other approvals are handed on from your own employee record; your sign-in is not linked to one.</span>
                : !forSelf ? <span className="block ui-caption">Other approvals are handed on by the manager themselves, from their own sign-in.</span> : null}
            </>
          ) : null}
        </fieldset>
      </form>
    </Drawer>
  );
}
