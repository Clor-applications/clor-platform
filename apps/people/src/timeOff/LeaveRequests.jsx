import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarCheck, Check, Clock3, Plus, X } from 'lucide-react';

import { useListSearch } from '@ui/components/ListToolbar';
import DocumentListShell from '@ui/components/list/DocumentListShell';
import { exportFormatFromKey, exportMenuItem, runListExport } from '@ui/components/list/exportMenu';
import { Pagination, usePaged, useResetPage } from '@ui/components/list/ListPageParts';
import { EmptyState, SkeletonCard } from '@ui/components/ui/Primitives';
import Drawer from '@ui/components/ui/Drawer';
import { confirmDialog, notify } from '@ui/components/ui/notify';
import { listEmployees } from '@ui/personnel/api';
import {
  STATUS_LABEL, STATUS_PILL, approveLeave, cancelLeave, colorOf, createLeaveRequest, dates,
  getLeaveLedger, getLeaveSettings, listLeaveRequests, listLeaveTypes, periodChoices, periodYearOf, rejectLeave,
} from './api';

/**
 * People → Leave & Attendance → Leave Applications. HR decides here: each
 * request shows what it does to the person's balance and who else is away
 * on those days, so a decision needs no second screen. HR can also enter
 * leave for someone, which is not held to notice or how late.
 */
const TABS = ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED', ''];
const overlaps = (a, b) => a.fromDate <= b.toDate && b.fromDate <= a.toDate;

export function TypeDot({ row }) {
  return <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: colorOf({ color: row.leaveTypeColor, name: row.leaveTypeName }) }} aria-hidden="true" />;
}

export default function LeaveRequests() {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('PENDING');
  const [open, setOpen] = useState(null);
  const [adding, setAdding] = useState(false);
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(25);
  const [settings, setSettings] = useState(null);
  const [year, setYear] = useState(null);
  useEffect(() => {
    getLeaveSettings().then((s) => { setSettings(s); setYear(s.current.year); }).catch(() => setYear(0));
  }, []);

  const load = useCallback(() => {
    if (year === null) return;
    listLeaveRequests(year ? { year } : {}).then((r) => { setRows(r); setError(''); }).catch((e) => setError(String(e?.message || 'Could not load leave applications.')));
  }, [year]);
  useEffect(() => { load(); }, [load]);

  const counts = useMemo(() => Object.fromEntries(TABS.map((t) => [t, (rows || []).filter((r) => !t || r.status === t).length])), [rows]);
  const inTab = useMemo(() => (rows || []).filter((r) => !status || r.status === status), [rows, status]);
  const search = useListSearch(inTab, ['employeeName', 'employeeCode', 'leaveTypeName', 'reason', 'department']);
  useResetPage(setPage, [status, search.query, perPage]);
  const { pageRows, safePage, pageCount } = usePaged(search.filtered, perPage, page);
  const today = new Date().toISOString().slice(0, 10);
  const awayToday = (rows || []).filter((r) => r.status === 'APPROVED' && r.fromDate <= today && today <= r.toDate).length;

  return (
    <DocumentListShell
      entity="leave"
      title="Leave Applications"
      description="Decide what is waiting. Each application shows the balance it leaves and who else is away then."
      compact
      tight
      search={{ value: search.query, onChange: search.setQuery, placeholder: 'Search person, type or reason…', label: 'Search leave applications' }}
      headerExtras={settings ? (
        <select className="ui-select" value={year || ''} onChange={(e) => setYear(Number(e.target.value))} aria-label="Leave period">
          {periodChoices(settings).map((c) => <option key={c.year} value={c.year}>{c.label}</option>)}
        </select>
      ) : null}
      moreItems={[exportMenuItem('Export applications')]}
      onMoreSelect={(k) => {
        const format = exportFormatFromKey(k);
        if (!format) return;
        const columns = [['employeeName', 'Employee'], ['employeeCode', 'Code'], ['department', 'Department'], ['leaveTypeName', 'Leave type'], ['fromDate', 'From'], ['toDate', 'To'], ['days', 'Days'], ['reason', 'Reason'], ['statusLabel', 'Status'], ['reviewNote', 'Note']].map(([key, label]) => ({ key, label }));
        runListExport({ format, title: 'Leave applications', fileName: `leave-applications-${year || 'all'}`, label: 'Applications', rows: search.filtered.map((r) => ({ ...r, statusLabel: STATUS_LABEL[r.status] || r.status })), columns });
      }}
      primary={<button type="button" className="ui-btn ui-btn-primary" onClick={() => setAdding(true)}><Plus size={16} aria-hidden="true" /> Enter leave</button>}
      cards={[
        { label: 'Waiting', value: counts.PENDING, count: true, tone: 'outstanding', Icon: Clock3, onSelect: () => setStatus('PENDING') },
        { label: 'Away today', value: awayToday, count: true, tone: 'sent', Icon: CalendarCheck },
      ]}
      tabs={TABS.map((t) => ({ value: t, label: t ? STATUS_LABEL[t] : 'All', tone: 'all' }))}
      statusValue={status}
      statusCounts={counts}
      onStatusChange={setStatus}
      tabsLabel="Status"
    >
      {error ? <p role="alert" className="p-4 text-sm">{error} <button type="button" className="ui-btn ml-2" onClick={load}>Retry</button></p> : null}
      {!rows ? (
        error ? null : <SkeletonCard lines={6} />
      ) : !search.filtered.length ? (
        <EmptyState icon={CalendarCheck} title={status === 'PENDING' ? 'Nothing waiting' : 'No leave applications here'} description={status === 'PENDING' ? 'Requests from the employee app and from managers land here.' : 'Change the tab or the search.'} />
      ) : (
        <>
          <div className="ui-table-scroll">
            <table className="ui-table ui-table-sticky w-full">
              <thead>
                <tr>
                  <th scope="col">Employee</th>
                  <th scope="col">Leave</th>
                  <th scope="col">Dates</th>
                  <th scope="col" className="ui-num">Days</th>
                  <th scope="col" className="ui-col-grow">Reason</th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody className="ui-rows">
                {pageRows.map((r) => (
                  <tr key={r.id} className="ui-row-click" onClick={() => setOpen(r)}>
                    <td className="ui-col-entity">{r.employeeName}<span className="ui-caption block">{[r.employeeCode, r.department].filter(Boolean).join(', ')}</span></td>
                    <td><span className="inline-flex items-center gap-2"><TypeDot row={r} />{r.leaveTypeName}</span></td>
                    <td className="ui-col-meta whitespace-nowrap">{dates(r.fromDate, r.toDate)}{r.halfDay ? <span className="ui-caption block">{r.halfDay === 'FIRST' ? 'First half' : 'Second half'}</span> : null}</td>
                    <td className="ui-num">{r.days}</td>
                    <td className="ui-col-grow whitespace-normal">{r.reason}</td>
                    <td><span className={`ui-pill ${STATUS_PILL[r.status] || ''}`}>{STATUS_LABEL[r.status] || r.status}</span>{r.status === 'PENDING' && r.managerApprovedAt ? <span className="ui-caption block">Manager approved</span> : null}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination total={search.filtered.length} page={safePage} perPage={perPage} pageCount={pageCount} onPage={setPage} onPerPage={setPerPage} />
        </>
      )}
      {open ? <RequestDrawer request={open} settings={settings} all={rows || []} onClose={() => setOpen(null)} onDone={() => { setOpen(null); load(); }} /> : null}
      {adding ? <EnterLeave settings={settings} onClose={() => setAdding(false)} onDone={() => { setAdding(false); load(); }} /> : null}
    </DocumentListShell>
  );
}

function BalanceLine({ employeeId, leaveTypeId, year, days, isPaid }) {
  const [bal, setBal] = useState(undefined);
  useEffect(() => {
    if (!employeeId || !leaveTypeId) return undefined;
    let off = false;
    getLeaveLedger(employeeId, year)
      .then((r) => !off && setBal(r.types.find((t) => t.type.id === leaveTypeId)?.balance || null))
      .catch(() => !off && setBal(null));
    return () => { off = true; };
  }, [employeeId, leaveTypeId, year]);
  if (!isPaid) return <p className="ui-caption">Unpaid: {days} day{days === 1 ? '' : 's'} of loss of pay.</p>;
  if (bal === undefined) return <p className="ui-caption">Working out the balance…</p>;
  if (!bal || bal.available == null) return null;
  return (
    <p className="text-sm">
      Balance: <strong>{bal.available}</strong> available of {bal.allocated}
      {bal.pending ? `, ${bal.pending} waiting` : ''}{bal.used ? `, ${bal.used} taken` : ''}.
    </p>
  );
}

function RequestDrawer({ request: r, settings, all, onClose, onDone }) {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const year = periodYearOf(settings, r.fromDate);
  const alsoAway = all.filter((x) => x.id !== r.id && x.employeeId !== r.employeeId && ['APPROVED', 'PENDING'].includes(x.status) && overlaps(x, r));
  const sameDept = alsoAway.filter((x) => r.department && x.department === r.department);

  const act = async (fn, done) => {
    setBusy(true);
    try {
      await fn();
      notify.success(done);
      onDone();
    } catch (e) {
      notify.error(String(e?.message || 'Not done.'));
    } finally {
      setBusy(false);
    }
  };
  const cancel = async () => {
    const ok = await confirmDialog({ title: 'Cancel this leave?', message: r.status === 'APPROVED' ? 'Its days come off the attendance record and go back to the balance.' : 'The request is withdrawn.', confirmLabel: 'Yes, cancel it' });
    if (ok) act(() => cancelLeave(r.id), 'Leave cancelled.');
  };

  return (
    <Drawer
      open
      onClose={onClose}
      widthClass="w-[min(36rem,96vw)]"
      title={`${r.employeeName}: ${r.leaveTypeName}`}
      actions={
        r.status === 'PENDING' ? (
          <>
            <button type="button" className="ui-btn ui-btn-secondary" disabled={busy} onClick={cancel}>Withdraw</button>
            <button type="button" className="ui-btn ui-btn-secondary" disabled={busy} onClick={() => act(() => rejectLeave(r.id, note), 'Leave rejected.')}><X size={16} aria-hidden="true" /> Reject</button>
            <button type="button" className="ui-btn ui-btn-primary" disabled={busy} onClick={() => act(() => approveLeave(r.id, note), 'Leave approved.')}><Check size={16} aria-hidden="true" /> Approve</button>
          </>
        ) : r.status === 'APPROVED' ? (
          <button type="button" className="ui-btn ui-btn-secondary" disabled={busy} onClick={cancel}>Cancel leave</button>
        ) : null
      }
    >
      <div className="space-y-4">
        <dl className="grid grid-cols-2 gap-3 text-sm">
          <div><dt className="ui-label">Dates</dt><dd>{dates(r.fromDate, r.toDate)}{r.halfDay ? ` (${r.halfDay === 'FIRST' ? 'first' : 'second'} half)` : ''}</dd></div>
          <div><dt className="ui-label">Days</dt><dd>{r.days}</dd></div>
          <div><dt className="ui-label">Status</dt><dd><span className={`ui-pill ${STATUS_PILL[r.status] || ''}`}>{STATUS_LABEL[r.status]}</span></dd></div>
          <div><dt className="ui-label">Asked on</dt><dd>{String(r.createdAt || '').slice(0, 10)}</dd></div>
          <div className="col-span-2"><dt className="ui-label">Reason</dt><dd>{r.reason}</dd></div>
          {r.reviewNote ? <div className="col-span-2"><dt className="ui-label">Note</dt><dd>{r.reviewNote}</dd></div> : null}
        </dl>
        <BalanceLine employeeId={r.employeeId} leaveTypeId={r.leaveTypeId} year={year} days={r.days} isPaid={r.isPaid} />
        <section aria-label="Also away">
          <h3 className="ui-t-sec">Also away then</h3>
          {!alsoAway.length ? <p className="ui-caption">Nobody else.</p> : (
            <>
              {r.department ? <p className="ui-caption">{sameDept.length} of them in {r.department}.</p> : null}
              <ul className="mt-1 space-y-1 text-sm">
                {alsoAway.slice(0, 8).map((x) => (
                  <li key={x.id} className="flex items-center gap-2"><TypeDot row={x} /> {x.employeeName} <span className="ui-caption">{dates(x.fromDate, x.toDate)}{x.status === 'PENDING' ? ', waiting' : ''}{x.department ? `, ${x.department}` : ''}</span></li>
                ))}
              </ul>
            </>
          )}
        </section>
        {r.status === 'PENDING' ? (
          <label className="block"><span className="ui-label">Note to the employee</span><textarea className="ui-input w-full" rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional; shown with the decision" /></label>
        ) : null}
      </div>
    </Drawer>
  );
}

function EnterLeave({ settings, onClose, onDone }) {
  const [people, setPeople] = useState([]);
  const [types, setTypes] = useState([]);
  const [form, setForm] = useState({ employeeId: '', leaveTypeId: '', fromDate: '', toDate: '', halfDay: '', reason: '' });
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    listEmployees({ status: 'ACTIVE' }).then((r) => setPeople((r?.employees || []).filter((e) => e.status !== 'LEFT'))).catch(() => setPeople([]));
    listLeaveTypes().then((t) => setTypes(t.filter((x) => x.isActive))).catch(() => setTypes([]));
  }, []);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value, ...(k === 'fromDate' && (!f.toDate || f.toDate < e.target.value) ? { toDate: e.target.value } : {}) }));
  const type = types.find((t) => t.id === form.leaveTypeId);
  const oneDay = form.fromDate && form.fromDate === form.toDate;

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      await createLeaveRequest({ ...form, halfDay: oneDay && form.halfDay ? form.halfDay : null });
      notify.success('Leave entered. Approve it from Waiting.');
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
      widthClass="w-[min(34rem,96vw)]"
      title="Enter leave for someone"
      actions={
        <>
          <button type="button" className="ui-btn ui-btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" form="enter-leave" className="ui-btn ui-btn-primary" disabled={saving || !form.employeeId || !form.leaveTypeId || !form.fromDate}>{saving ? 'Saving…' : 'Save'}</button>
        </>
      }
    >
      <form id="enter-leave" onSubmit={save} className="grid gap-4 sm:grid-cols-2">
        <label className="block sm:col-span-2">
          <span className="ui-label">Employee *</span>
          <select className="ui-select w-full" required value={form.employeeId} onChange={set('employeeId')}>
            <option value="">Choose…</option>
            {people.map((p) => <option key={p.id} value={p.id}>{p.name}{p.code ? ` (${p.code})` : ''}</option>)}
          </select>
        </label>
        <label className="block sm:col-span-2">
          <span className="ui-label">Leave type *</span>
          <select className="ui-select w-full" required value={form.leaveTypeId} onChange={set('leaveTypeId')}>
            <option value="">Choose…</option>
            {types.map((t) => <option key={t.id} value={t.id}>{t.name}{t.isPaid ? '' : ' (unpaid)'}</option>)}
          </select>
          {type?.description ? <span className="ui-caption">{type.description}</span> : null}
        </label>
        <label className="block"><span className="ui-label">From *</span><input type="date" className="ui-input w-full" required value={form.fromDate} onChange={set('fromDate')} /></label>
        <label className="block"><span className="ui-label">To *</span><input type="date" className="ui-input w-full" required min={form.fromDate} value={form.toDate} onChange={set('toDate')} /></label>
        {oneDay && type?.allowHalfDay !== false ? (
          <label className="block sm:col-span-2">
            <span className="ui-label">Day</span>
            <select className="ui-select w-full" value={form.halfDay} onChange={set('halfDay')}>
              <option value="">Whole day</option>
              <option value="FIRST">First half</option>
              <option value="SECOND">Second half</option>
            </select>
          </label>
        ) : null}
        <label className="block sm:col-span-2"><span className="ui-label">Reason *</span><input className="ui-input w-full" required minLength={3} maxLength={500} value={form.reason} onChange={set('reason')} placeholder="e.g. Told HR by phone" /></label>
        {form.employeeId && type ? (
          <div className="sm:col-span-2"><BalanceLine employeeId={form.employeeId} leaveTypeId={type.id} year={periodYearOf(settings, form.fromDate || new Date().toISOString().slice(0, 10))} days={0} isPaid={type.isPaid} /></div>
        ) : null}
        <p className="ui-caption sm:col-span-2">Weekly offs and holidays inside the dates are not counted, unless the type has the sandwich rule. It waits for approval like any request.</p>
      </form>
    </Drawer>
  );
}
