import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Ban, CalendarCheck, CalendarClock, CalendarX, Check, Plus, Wallet, X } from 'lucide-react';

import { ColumnHeader, useColumnFilters } from '@ui/components/ColumnFilters';
import { useListSearch } from '@ui/components/ListToolbar';
import DocumentListShell from '@ui/components/list/DocumentListShell';
import { Pagination, usePaged } from '@ui/components/list/ListPageParts';
import { exportFormatFromKey, exportMenuItem, runListExport } from '@ui/components/list/exportMenu';
import { SkeletonCard, EmptyState, StatusPill } from '@ui/components/ui/Primitives';
import Drawer from '@ui/components/ui/Drawer';
import { confirmDialog, notify } from '@ui/components/ui/notify';
import {
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

/* "27 – 28 Oct", "30 Oct – 2 Nov": the range in the width of a date. Exports keep the ISO dates. */
const short = (iso) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const span = (from, to) => {
  if (!from) return '—';
  if (!to || to === from) return short(from);
  return from.slice(0, 7) === to.slice(0, 7) ? `${Number(from.slice(8))} – ${short(to)}` : `${short(from)} – ${short(to)}`;
};

const TABS = [
  { value: 'PENDING', label: 'Pending', tone: 'partial' },
  { value: 'APPROVED', label: 'Approved', tone: 'paid' },
  { value: 'REJECTED', label: 'Rejected', tone: 'overdue' },
  { value: 'CANCELLED', label: 'Cancelled', tone: 'cancelled' },
  { value: '', label: 'All', tone: 'all' },
];
const COLUMNS = {
  employee: (r) => r.employeeName,
  type: (r) => r.leaveTypeName,
  from: (r) => r.fromDate,
  reason: (r) => r.reason,
  status: (r) => r.status,
  department: (r) => r.department || '',
  asked: (r) => String(r.createdAt || '').slice(0, 10),
};
const EXPORT_COLUMNS = [
  { key: 'employeeCode', label: 'Employee ID' },
  { key: 'employeeName', label: 'Name' },
  { key: 'department', label: 'Department' },
  { key: 'leaveTypeName', label: 'Type' },
  { key: 'isPaid', label: 'Paid', value: (r) => (r.isPaid ? 'Yes' : 'No') },
  { key: 'fromDate', label: 'From' },
  { key: 'toDate', label: 'To' },
  { key: 'days', label: 'Days' },
  { key: 'reason', label: 'Reason' },
  { key: 'status', label: 'Status' },
  { key: 'createdAt', label: 'Asked on', value: (r) => String(r.createdAt || '').slice(0, 10) },
];

/** Everyone's leave. Approving marks the working days in it "on leave". */
export default function LeaveRequests() {
  const [status, setStatus] = useState('PENDING');
  const [all, setAll] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [adding, setAdding] = useState(false);
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(25);

  /* All of them at once: the tabs count every status, so the list cannot be fetched one status at a time. */
  const load = useCallback(() => {
    listLeaveRequests({ status: '' }).then((v) => { setAll(v); setLoadError(''); }).catch((e) => setLoadError(String(e?.message || 'Could not load leave.')));
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const counts = useMemo(() => {
    const c = { '': (all || []).length };
    for (const r of all || []) c[r.status] = (c[r.status] || 0) + 1;
    return c;
  }, [all]);
  const inTab = useMemo(() => (all || []).filter((r) => !status || r.status === status), [all, status]);
  const search = useListSearch(inTab, ['employeeName', 'employeeCode', 'leaveTypeName', 'reason', 'fromDate', 'toDate']);
  const filters = useColumnFilters();
  const rows = filters.applyFilters(search.filtered, COLUMNS);
  const { pageCount, safePage, pageRows } = usePaged(rows, perPage, page);
  useEffect(() => setPage(1), [status, search.query]);

  const figures = useMemo(() => {
    const live = (all || []).filter((r) => r.status === 'APPROVED');
    return {
      waiting: counts.PENDING || 0,
      approvedDays: live.reduce((a, r) => a + Number(r.days || 0), 0),
      unpaidDays: live.filter((r) => !r.isPaid).reduce((a, r) => a + Number(r.days || 0), 0),
      rejected: counts.REJECTED || 0,
    };
  }, [all, counts]);

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
    <DocumentListShell
      entity="leave"
      title="Leave requests"
      description="Approving marks each working day in the range on leave. Unpaid leave is loss of pay."
      compact
      tight
      denseCards
      search={{ value: search.query, onChange: search.setQuery, placeholder: 'Search leave…', label: 'Search leave requests' }}
      moreItems={[exportMenuItem('Export leave requests')]}
      onMoreSelect={(k) => {
        const format = exportFormatFromKey(k);
        if (!format) return;
        runListExport({ format, title: 'Leave requests', fileName: `Leave ${status ? status.toLowerCase() : 'all'}`, label: 'request/requests', columns: EXPORT_COLUMNS, rows });
      }}
      primary={
        <button type="button" className="ui-btn ui-btn-primary" onClick={() => setAdding(true)}>
          <Plus size={16} aria-hidden="true" /> Add leave
        </button>
      }
      cards={[
        { label: 'Waiting', value: figures.waiting, count: true, tone: 'partial', Icon: CalendarClock },
        { label: 'Days approved', value: figures.approvedDays, count: true, tone: 'paid', Icon: CalendarCheck },
        { label: 'Unpaid days', value: figures.unpaidDays, count: true, tone: 'outstanding', Icon: Wallet },
        { label: 'Rejected', value: figures.rejected, count: true, tone: 'overdue', Icon: CalendarX },
      ]}
      tabs={TABS}
      statusValue={status}
      statusCounts={counts}
      onStatusChange={setStatus}
      tabsLabel="Leave status"
    >
      <LoadFailed message={loadError} onRetry={load} />
      {!all ? (
        loadError ? null : <SkeletonCard lines={5} />
      ) : (
        <>
          {/* Phones: cards with 44 px actions, like Exceptions; the table from 768 px. */}
          <ul className="space-y-2 md:hidden" aria-label="Leave requests">
            {!rows.length ? (
              <li>
                {inTab.length ? (
                  <EmptyState kind="filtered" totalCount={inTab.length} title="No leave matches" description="Nothing in this tab matches the search or the column filters." />
                ) : (
                  <EmptyState icon={CalendarCheck} title={status === 'PENDING' ? 'Nothing waiting for approval' : status ? `No ${status.toLowerCase()} leave` : 'No leave requests yet'} description="Requests from the portal and from Add leave land here." />
                )}
              </li>
            ) : (
              pageRows.map((r) => (
                <li key={r.id} className="ui-card p-3 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-medium">{r.employeeName}{r.employeeCode ? <span className="ui-caption"> · {r.employeeCode}</span> : null}</p>
                      <p className="ui-caption">{r.leaveTypeName}{r.isPaid ? '' : ' · unpaid'} · {span(r.fromDate, r.toDate)} · {r.days} {Number(r.days) === 1 ? 'day' : 'days'}</p>
                    </div>
                    <StatusPill status={r.status} />
                  </div>
                  {r.reason ? <p className="text-sm">{r.reason}</p> : null}
                  {r.status === 'PENDING' || r.status === 'APPROVED' ? (
                    <div className="grid grid-cols-3 gap-2">
                      {r.status === 'PENDING' ? (
                        <>
                          <button type="button" className="ui-btn ui-btn-secondary min-h-[44px]" aria-label={`Approve ${r.employeeName}'s leave`} onClick={() => act(approveLeave, r, 'Approved; the days are marked on leave.')}><Check size={16} aria-hidden="true" /> Approve</button>
                          <button type="button" className="ui-btn ui-btn-secondary min-h-[44px]" aria-label={`Reject ${r.employeeName}'s leave`} onClick={() => act(rejectLeave, r, 'Rejected.')}><X size={16} aria-hidden="true" /> Reject</button>
                        </>
                      ) : null}
                      <button type="button" className={`ui-btn ui-btn-secondary min-h-[44px] ${r.status === 'APPROVED' ? 'col-span-3' : ''}`} aria-label={`Cancel ${r.employeeName}'s leave`} onClick={() => cancel(r)}><Ban size={16} aria-hidden="true" /> Cancel</button>
                    </div>
                  ) : null}
                </li>
              ))
            )}
          </ul>
          <div className="ui-table-scroll hidden md:block">
            <table className="ui-table ui-table-sticky w-full">
              <thead>
                <tr>
                  <ColumnHeader label="Employee" col="employee" state={filters} />
                  <ColumnHeader label="Department" col="department" state={filters} className="hidden 2xl:table-cell" />
                  <ColumnHeader label="Type" col="type" state={filters} />
                  <ColumnHeader label="Dates" col="from" state={filters} type="date" />
                  <th scope="col" className="ui-num">Days</th>
                  <ColumnHeader label="Reason" col="reason" state={filters}  className="ui-col-grow" />
                  <ColumnHeader label="Asked" col="asked" state={filters} type="date" className="hidden 2xl:table-cell" />
                  <ColumnHeader label="Status" col="status" state={filters} align="center" />
                  <th scope="col"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody className="ui-rows">
                {!rows.length ? (
                  <tr>
                    <td colSpan={9}>
                      {inTab.length ? (
                        <EmptyState kind="filtered" totalCount={inTab.length} title="No leave matches" description="Nothing in this tab matches the search or the column filters." />
                      ) : (
                        <EmptyState
                          icon={CalendarCheck}
                          title={status === 'PENDING' ? 'Nothing waiting for approval' : status ? `No ${status.toLowerCase()} leave` : 'No leave requests yet'}
                          description={status === 'PENDING' ? 'Requests from the portal and from Add leave land here. Approving marks each working day in the range on leave; unpaid leave is loss of pay.' : status ? 'Try another tab.' : 'Add leave for somebody, or let them ask from the employee portal.'}
                          routes={status ? undefined : [{ label: 'Add leave', description: 'On someone’s behalf; it still waits for approval.', onSelect: () => setAdding(true) }]}
                        />
                      )}
                    </td>
                  </tr>
                ) : (
                  pageRows.map((r) => (
                    <tr key={r.id}>
                      <td className="ui-col-entity">
                        {r.employeeName}
                        {r.employeeCode ? <span className="ui-caption"> · {r.employeeCode}</span> : null}
                      </td>
                      <td className="hidden 2xl:table-cell">{r.department || <span className="ui-caption">—</span>}</td>
                      <td className="whitespace-nowrap">{r.leaveTypeName}{r.isPaid ? '' : <span className="ui-caption"> · unpaid</span>}</td>
                      <td className="ui-col-date whitespace-nowrap" title={leaveRange(r.fromDate, r.toDate)}>{span(r.fromDate, r.toDate)}</td>
                      <td className="ui-num">{r.days}</td>
                      <td className="ui-col-grow whitespace-normal min-w-[10rem]">{r.reason}</td>
                      <td className="ui-col-date hidden 2xl:table-cell" title={new Date(r.createdAt).toLocaleString('en-IN')}>{short(String(r.createdAt).slice(0, 10))}</td>
                      <td className="ui-col-h-center"><StatusPill status={r.status} /></td>
                      <td className="ui-col-meta">
                        <span className="flex justify-end gap-1">
                          {r.status === 'PENDING' ? (
                            <>
                              <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" aria-label={`Approve ${r.employeeName}'s leave`} onClick={() => act(approveLeave, r, 'Approved; the days are marked on leave.')}>
                                <Check size={14} aria-hidden="true" /> Approve
                              </button>
                              <button type="button" className="ui-icon-btn" aria-label={`Reject ${r.employeeName}'s leave`} title="Reject" onClick={() => act(rejectLeave, r, 'Rejected.')}>
                                <X size={16} aria-hidden="true" />
                              </button>
                            </>
                          ) : null}
                          {r.status === 'PENDING' || r.status === 'APPROVED' ? (
                            <button type="button" className="ui-icon-btn" aria-label={`Cancel ${r.employeeName}'s leave`} title="Cancel leave" onClick={() => cancel(r)}>
                              <Ban size={16} aria-hidden="true" />
                            </button>
                          ) : null}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <Pagination total={rows.length} page={safePage} perPage={perPage} pageCount={pageCount} onPage={setPage} onPerPage={(n) => { setPerPage(n); setPage(1); }} noun="requests" />
        </>
      )}
      {adding ? <AddLeave onClose={() => setAdding(false)} onSaved={() => { setAdding(false); setStatus('PENDING'); load(); }} /> : null}
    </DocumentListShell>
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
