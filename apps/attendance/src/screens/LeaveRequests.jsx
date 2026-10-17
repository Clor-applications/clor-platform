import React, { useCallback, useEffect, useState } from 'react';
import { Check, Plus, X } from 'lucide-react';

import { PageHeader, SkeletonCard, EmptyState } from '@ui/components/ui/Primitives';
import Drawer from '@ui/components/ui/Drawer';
import { confirmDialog, notify } from '@ui/components/ui/notify';
import { downloadCsv } from '@ui/utils/csv';
import {
  LEAVE_STATUS,
  approveLeave,
  cancelLeave,
  createLeaveRequest,
  leaveRange,
  listEmployees,
  listLeaveRequests,
  listLeaveTypes,
  rejectLeave,
} from '../api/attendance';
import LoadFailed from '../components/LoadFailed';

const TABS = ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED', ''];

/** Everyone's leave. Approving marks the working days in it "on leave". */
export default function LeaveRequests() {
  const [status, setStatus] = useState('PENDING');
  const [rows, setRows] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [adding, setAdding] = useState(false);

  const load = useCallback(() => {
    listLeaveRequests({ status }).then((v) => { setRows(v); setLoadError(''); }).catch((e) => setLoadError(String(e?.message || 'Could not load leave.')));
  }, [status]);
  useEffect(() => {
    load();
  }, [load]);

  const act = async (fn, r, done) => {
    try {
      await fn(r.id);
      notify.success(done);
      load();
    } catch (e) {
      notify.error(String(e?.message || 'Not saved.'));
    }
  };
  const cancel = async (r) => {
    const ok = await confirmDialog({
      title: `Cancel ${r.employeeName}'s leave?`,
      message: r.status === 'APPROVED' ? 'The days go back to unmarked, and the balance is returned.' : leaveRange(r.fromDate, r.toDate),
      confirmLabel: 'Yes, cancel it',
    });
    if (ok) act(cancelLeave, r, 'Cancelled.');
  };

  return (
    <div className="space-y-6">
      <PageHeader
        entity="attendance"
        title="Leave requests"
        description="Approving marks each working day in the range on leave. Unpaid leave is loss of pay."
        actions={
          <div className="flex gap-2">
            <button
              type="button"
              className="ui-btn ui-btn-secondary"
              disabled={!rows?.length}
              onClick={() =>
                downloadCsv({
                  fileName: `Leave ${status ? status.toLowerCase() : 'all'}`,
                  columns: [
                    { key: 'employeeCode', label: 'Employee ID' },
                    { key: 'employeeName', label: 'Name' },
                    { key: 'leaveTypeName', label: 'Type' },
                    { key: 'isPaid', label: 'Paid', value: (r) => (r.isPaid ? 'Yes' : 'No') },
                    { key: 'fromDate', label: 'From' },
                    { key: 'toDate', label: 'To' },
                    { key: 'days', label: 'Days' },
                    { key: 'reason', label: 'Reason' },
                    { key: 'status', label: 'Status' },
                  ],
                  rows,
                })
              }
            >
              Export
            </button>
            <button type="button" className="ui-btn ui-btn-primary" onClick={() => setAdding(true)}>
              <Plus size={16} aria-hidden="true" /> Add leave
            </button>
          </div>
        }
      />
      <div role="tablist" className="flex flex-wrap gap-1">
        {TABS.map((s) => (
          <button key={s || 'all'} type="button" role="tab" aria-selected={status === s} className="ui-segment" onClick={() => setStatus(s)}>
            {s ? s[0] + s.slice(1).toLowerCase() : 'All'}
          </button>
        ))}
      </div>
      <LoadFailed message={loadError} onRetry={load} />
      {!rows ? (
        loadError ? null : <SkeletonCard lines={5} />
      ) : !rows.length ? (
        <EmptyState
          title={status === 'PENDING' ? 'Nothing waiting for approval' : status ? `No ${status.toLowerCase()} leave` : 'No leave requests yet'}
          description={status === 'PENDING' ? 'Requests from the portal and from Add leave land here.' : status ? 'Try another tab.' : 'Add leave for somebody, or let them ask from the employee portal.'}
        />
      ) : (
        <div className="ui-card overflow-hidden">
          <div className="overflow-x-auto ui-table-scroll ui-table-fit">
            <table className="ui-table w-full">
              <thead>
                <tr>
                  <th scope="col" className="ui-th">Employee</th>
                  <th scope="col" className="ui-th">Type</th>
                  <th scope="col" className="ui-th">Dates</th>
                  <th scope="col" className="ui-th text-end">Days</th>
                  <th scope="col" className="ui-th">Reason</th>
                  <th scope="col" className="ui-th ui-col-h-center">Status</th>
                  <th scope="col" className="ui-th"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td className="ui-col-entity">{r.employeeName}</td>
                    <td className="whitespace-nowrap">{r.leaveTypeName}{r.isPaid ? '' : <span className="ui-caption"> · unpaid</span>}</td>
                    <td className="whitespace-nowrap">{leaveRange(r.fromDate, r.toDate)}</td>
                    <td className="text-end tabular-nums">{r.days}</td>
                    <td className="max-w-[14rem] truncate" title={r.reason}>{r.reason}</td>
                    <td className="ui-col-h-center"><span className={`ui-pill ${LEAVE_STATUS[r.status] || 'ui-pill-neutral'}`}>{r.status.toLowerCase()}</span></td>
                    <td className="whitespace-nowrap">
                      <span className="flex justify-end gap-1">
                        {r.status === 'PENDING' ? (
                          <>
                            <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" aria-label={`Approve ${r.employeeName}'s leave`} onClick={() => act(approveLeave, r, 'Approved; the days are marked on leave.')}>
                              <Check size={14} aria-hidden="true" /> Approve
                            </button>
                            <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" aria-label={`Reject ${r.employeeName}'s leave`} onClick={() => act(rejectLeave, r, 'Rejected.')}>
                              <X size={14} aria-hidden="true" /> Reject
                            </button>
                          </>
                        ) : null}
                        {r.status === 'PENDING' || r.status === 'APPROVED' ? (
                          <button type="button" className="ui-btn ui-btn-ghost ui-btn-sm" aria-label={`Cancel ${r.employeeName}'s leave`} onClick={() => cancel(r)}>Cancel</button>
                        ) : null}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {adding ? <AddLeave onClose={() => setAdding(false)} onSaved={() => { setAdding(false); setStatus('PENDING'); load(); }} /> : null}
    </div>
  );
}

/** Leave on someone's behalf (they told HR, or forgot to ask). It still needs approving. */
function AddLeave({ onClose, onSaved }) {
  const [people, setPeople] = useState([]);
  const [types, setTypes] = useState([]);
  const [form, setForm] = useState({ employeeId: '', leaveTypeId: '', fromDate: '', toDate: '', reason: '' });
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    listEmployees().then(setPeople).catch(() => setPeople([]));
    listLeaveTypes().then((t) => setTypes(t.filter((x) => x.isActive))).catch(() => setTypes([]));
  }, []);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const r = await createLeaveRequest({ ...form, toDate: form.toDate || form.fromDate });
      notify.success(`${r.request.days} day${r.request.days === 1 ? '' : 's'} added, waiting for approval.`);
      onSaved();
    } catch (err) {
      notify.error(String(err?.message || 'Not saved.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Drawer
      widthClass="w-[min(40rem,96vw)]"
      open
      onClose={onClose}
      title="Add leave"
      description="On someone's behalf. It waits for approval like any other request."
      actions={
        <>
          <button type="button" className="ui-btn ui-btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" form="add-leave" className="ui-btn ui-btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
        </>
      }
    >
      <form id="add-leave" onSubmit={save} className="grid gap-4 sm:grid-cols-2">
        <label className="block sm:col-span-2">
          <span className="ui-label">Employee *</span>
          <select className="ui-select w-full" required value={form.employeeId} onChange={set('employeeId')}>
            <option value="">Choose…</option>
            {people.map((p) => <option key={p.id} value={p.id}>{p.name}{p.code ? ` · ${p.code}` : ''}</option>)}
          </select>
        </label>
        <label className="block sm:col-span-2">
          <span className="ui-label">Type *</span>
          <select className="ui-select w-full" required value={form.leaveTypeId} onChange={set('leaveTypeId')}>
            <option value="">Choose…</option>
            {types.map((t) => <option key={t.id} value={t.id}>{t.name}{t.isPaid ? '' : ' (unpaid)'}</option>)}
          </select>
        </label>
        <label className="block"><span className="ui-label">From *</span><input type="date" className="ui-input w-full" required value={form.fromDate} onChange={set('fromDate')} /></label>
        <label className="block"><span className="ui-label">To</span><input type="date" className="ui-input w-full" min={form.fromDate || undefined} value={form.toDate} onChange={set('toDate')} /></label>
        <label className="block sm:col-span-2"><span className="ui-label">Reason *</span><input className="ui-input w-full" required minLength={3} maxLength={500} value={form.reason} onChange={set('reason')} /></label>
      </form>
    </Drawer>
  );
}
