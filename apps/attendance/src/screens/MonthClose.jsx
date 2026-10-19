import React, { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CalendarDays, CheckCircle2, Download, Lock, Unlock } from 'lucide-react';

import { ColumnHeader, useColumnFilters } from '@ui/components/ColumnFilters';
import { EmptyState, PageHeader, SkeletonCard } from '@ui/components/ui/Primitives';
import { confirmDialog, notify } from '@ui/components/ui/notify';
import { downloadCsv } from '@ui/utils/csv';
import { closeMonth, getMonthReadiness, getMonthSnapshot, reopenMonth, todayIst } from '../api/attendance';
import LoadFailed from '../components/LoadFailed';

/**
 * Payroll readiness: before a month is closed, everything that would make its
 * payable days wrong — days with no check-out, corrections and leave still
 * waiting, reader IDs that match nobody, working days with no attendance,
 * overtime not approved, days not validated. Closing with items open needs a
 * deliberate acknowledgement, and every close keeps a numbered snapshot of the
 * figures Payroll takes.
 */
const lastMonth = () => {
  const d = new Date(Date.now() + 330 * 60_000);
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() - 1);
  return d.toISOString().slice(0, 7);
};
const monthName = (m) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });

export default function MonthClose({ openScreen, params }) {
  const [month, setMonth] = useState(params?.month || lastMonth());
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    getMonthReadiness(month)
      .then((d) => { setData(d); setError(''); setAck(false); })
      .catch((e) => setError(String(e?.message || 'Could not check the month.')));
  }, [month]);
  useEffect(() => { load(); }, [load]);

  const openItems = (data?.checks || []).filter((c) => c.count > 0);
  const filters = useColumnFilters();
  const openPeople = (data?.people || []).filter((p) => p.missingOut || p.noRecord || p.unapprovedOvertime || p.unvalidated).slice(0, 500);
  const people = filters.applyFilters(openPeople, { employee: (p) => `${p.name}${p.code ? ` · ${p.code}` : ''}` });
  const close = async () => {
    setBusy(true);
    try {
      const r = await closeMonth(month, openItems.length > 0);
      notify.success(`${monthName(month)} closed. Snapshot ${r.snapshot?.version ?? ''} kept for Payroll.`);
      load();
    } catch (e) {
      notify.error(String(e?.message || 'Not closed.'));
    } finally {
      setBusy(false);
    }
  };
  const reopen = async () => {
    const ok = await confirmDialog({ title: `Reopen ${monthName(month)}?`, message: 'Its days can change again. Payroll already run from it is not changed; closing again keeps a new snapshot.', confirmLabel: 'Reopen', tone: 'default' });
    if (!ok) return;
    try {
      await reopenMonth(month);
      notify.success('Reopened.');
      load();
    } catch (e) {
      notify.error(String(e?.message || 'Not reopened.'));
    }
  };
  const downloadSnapshot = async (version) => {
    try {
      const s = await getMonthSnapshot(month, version);
      downloadCsv({
        fileName: `Attendance ${month} snapshot ${version}`,
        columns: [
          { key: 'code', label: 'Employee ID' }, { key: 'name', label: 'Name' }, { key: 'department', label: 'Department' },
          { key: 'payableDays', label: 'Payable days' }, { key: 'lossOfPayDays', label: 'Loss of pay' }, { key: 'present', label: 'Present' },
          { key: 'halfDays', label: 'Half days' }, { key: 'absent', label: 'Absent' }, { key: 'incompleteDays', label: 'No check-out' },
          { key: 'leave', label: 'Leave' }, { key: 'unpaidLeaveDays', label: 'Unpaid leave' }, { key: 'approvedOvertimeMinutes', label: 'Approved OT (min)' },
        ],
        rows: s.rows,
      });
    } catch (e) {
      notify.error(String(e?.message || 'Could not download.'));
    }
  };
  const go = (c) => {
    if (!openScreen) return;
    const end = `${month}-${String(new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate()).padStart(2, '0')}`;
    if (c.screen === 'records') openScreen('records', { from: `${month}-01`, to: end, ...(c.key === 'unvalidated' ? { validated: 'false' } : {}) });
    else openScreen(c.screen);
  };

  return (
    <div className="space-y-3">
      <PageHeader
        entity="report"
        title="Month close"
        description="Check the month before Payroll takes it. Closing makes its days final and keeps a snapshot of the figures."
        actions={<input type="month" className="ui-input !w-auto" value={month} max={todayIst().slice(0, 7)} onChange={(e) => setMonth(e.target.value)} aria-label="Month" />}
      />
      <div className="pb-8 space-y-6">
      <LoadFailed message={error} onRetry={load} />
      {!data ? (
        error ? null : <SkeletonCard lines={8} />
      ) : (
        <>
          <section className={`ui-card ui-readiness ${data.closed ? 'is-closed' : data.ready ? 'is-ready' : 'is-blocked'}`} aria-live="polite">
            <div className="flex items-start gap-3">
              {data.closed ? <Lock size={22} aria-hidden="true" /> : data.ready ? <CheckCircle2 size={22} aria-hidden="true" /> : <AlertTriangle size={22} aria-hidden="true" />}
              <div className="min-w-0 flex-1">
                <h2 className="ui-t-sec">
                  {data.closed
                    ? `${monthName(month)} is closed`
                    : !data.ended
                      ? `${monthName(month)} has not ended yet`
                      : data.ready && !data.toCheck
                        ? `${monthName(month)} is ready to close`
                        : data.ready
                          ? `${monthName(month)} can close; ${data.toCheck} thing${data.toCheck === 1 ? '' : 's'} to check`
                          : `${data.blocking} thing${data.blocking === 1 ? '' : 's'} to settle before ${monthName(month)} closes`}
                </h2>
                <p className="ui-caption mt-0.5">
                  {data.closed
                    ? `Closed ${new Date(data.closed.at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}. Its days are final until it is reopened.`
                    : 'Settle the red items first. The others are worth a look; payable days are worked out from what is there.'}
                </p>
              </div>
              {data.closed ? (
                <button type="button" className="ui-btn ui-btn-secondary" onClick={reopen}><Unlock size={16} aria-hidden="true" /> Reopen</button>
              ) : null}
            </div>
          </section>

          <section className="ui-card overflow-hidden" aria-labelledby="checks-h">
            <h2 id="checks-h" className="ui-t-sec px-4 pt-4 pb-2">Checklist</h2>
            <ul className="divide-y">
              {data.checks.map((c) => (
                <li key={c.key} className="ui-check-row" data-state={c.count === 0 ? 'ok' : c.severity}>
                  <span className="ui-check-mark" aria-hidden="true">{c.count === 0 ? <CheckCircle2 size={18} /> : <AlertTriangle size={18} />}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium">{c.label}</span>
                    <span className="ui-caption">{c.count === 0 ? 'Nothing here.' : c.hint}</span>
                  </span>
                  <span className="ui-check-count tabular-nums" aria-label={`${c.count} ${c.count === 1 ? 'item' : 'items'}`}>{c.count}</span>
                  {c.count && openScreen ? <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={() => go(c)}>Open</button> : <span className="w-[3.75rem]" />}
                </li>
              ))}
            </ul>
          </section>

          {!data.closed && data.ended ? (
            <section className="ui-card p-4 space-y-3" aria-labelledby="close-h">
              <h2 id="close-h" className="ui-t-sec">Close {monthName(month)}</h2>
              <p className="text-sm ui-muted">Corrections, leave, manual changes and late reader uploads can no longer change its days. Payroll takes the figures as they are now; a snapshot is kept.</p>
              {openItems.length ? (
                <label className="flex items-start gap-2 text-sm">
                  <input type="checkbox" className="ui-checkbox mt-0.5" checked={ack} onChange={(e) => setAck(e.target.checked)} />
                  <span>I have seen the {openItems.length} open item{openItems.length === 1 ? '' : 's'} above and want to close the month as it is.</span>
                </label>
              ) : null}
              <button type="button" className="ui-btn ui-btn-primary" disabled={busy || (openItems.length > 0 && !ack)} onClick={close}>
                <Lock size={16} aria-hidden="true" /> {busy ? 'Closing…' : 'Close the month'}
              </button>
            </section>
          ) : null}

          <section className="ui-card overflow-hidden" aria-labelledby="people-h">
            <h2 id="people-h" className="ui-t-sec px-4 pt-4 pb-2">By person</h2>
            <div className="ui-table-scroll">
              <table className="ui-table ui-table-sticky w-full">
                <thead>
                  <tr>
                    <ColumnHeader label="Employee" col="employee" state={filters}  className="ui-col-grow" />
                    <th scope="col" className="ui-num">No check-out</th>
                    <th scope="col" className="ui-num">No attendance</th>
                    <th scope="col" className="ui-num">Overtime to approve</th>
                    <th scope="col" className="ui-num">Not validated</th>
                    <th scope="col"><span className="sr-only">Open</span></th>
                  </tr>
                </thead>
                <tbody className="ui-rows">
                  {!people.length ? (
                    <tr>
                      <td colSpan={6}>
                        {openPeople.length ? (
                          <EmptyState kind="filtered" totalCount={openPeople.length} title="Nobody matches" description="Nobody matches the column filter." />
                        ) : (
                          <EmptyState icon={CheckCircle2} title="Everyone’s days are complete" />
                        )}
                      </td>
                    </tr>
                  ) : (
                    people.map((p) => (
                      <tr key={p.employeeId}>
                        <td className="ui-col-entity">{p.name}{p.code ? <span className="ui-caption"> · {p.code}</span> : null}</td>
                        <td className="ui-num">{p.missingOut ? <strong style={{ color: 'rgb(var(--neg))' }}>{p.missingOut}</strong> : '—'}</td>
                        <td className="ui-num">{p.noRecord || '—'}</td>
                        <td className="ui-num">{p.unapprovedOvertime || '—'}</td>
                        <td className="ui-num">{p.unvalidated || '—'}</td>
                        <td className="ui-col-meta">{openScreen ? <button type="button" className="ui-btn ui-btn-ghost ui-btn-sm" onClick={() => openScreen('records', { employeeId: p.employeeId, from: `${month}-01`, to: `${month}-${String(new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate()).padStart(2, '0')}` })}><CalendarDays size={14} aria-hidden="true" /> Days</button> : null}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>

          {data.snapshots?.length ? (
            <section className="ui-card overflow-hidden" aria-labelledby="snap-h">
              <h2 id="snap-h" className="ui-t-sec px-4 pt-4 pb-2">What Payroll took</h2>
              <ul className="divide-y">
                {data.snapshots.map((s) => (
                  <li key={s.version} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                    <span className="font-medium">Snapshot {s.version}</span>
                    <span className="ui-caption flex-1">{new Date(s.createdAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })} · {s.by}</span>
                    <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={() => downloadSnapshot(s.version)}><Download size={14} aria-hidden="true" /> CSV</button>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </>
      )}
      </div>
    </div>
  );
}
