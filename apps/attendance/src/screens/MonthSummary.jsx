import React, { useEffect, useMemo, useState } from 'react';
import { CalendarCheck, CalendarX, Clock, Lock, Unlock, Users } from 'lucide-react';

import { ColumnHeader, useColumnFilters } from '@ui/components/ColumnFilters';
import { useListSearch } from '@ui/components/ListToolbar';
import DocumentListShell from '@ui/components/list/DocumentListShell';
import { exportFormatFromKey, exportMenuItem, runListExport } from '@ui/components/list/exportMenu';
import { SkeletonCard, EmptyState } from '@ui/components/ui/Primitives';
import { closeMonth, getSummary, hm, reopenMonth, todayIst } from '../api/attendance';
import { confirmDialog, notify } from '@ui/components/ui/notify';
import LoadFailed from '../components/LoadFailed';

/**
 * The month as payroll sees it: payable days and loss-of-pay days per
 * person. Absent days, half a half day, and unpaid leave are loss of pay;
 * holidays, weekly offs and paid leave are paid.
 */
const FILTER_COLUMNS = { code: (r) => r.code, name: (r) => r.name };

export default function MonthSummary({ openScreen } = {}) {
  const [month, setMonth] = useState(todayIst().slice(0, 7));
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const ended = month < todayIst().slice(0, 7);
  const toggleClosed = async () => {
    const closing = !data?.closed;
    /* Closing goes through the month-close checklist, so nobody closes a month without seeing what is open. */
    if (closing && openScreen) {
      openScreen('monthClose', { month });
      return;
    }
    if (closing) {
      const noOut = (data?.rows || []).reduce((n, r) => n + (r.incompleteDays || 0), 0);
      const ok = await confirmDialog({
        title: `Close ${month}?`,
        message: `Its days become final: corrections, leave, manual changes and late reader uploads can no longer change them, so Payroll takes fixed figures.${noOut ? ` ${noOut} days still have no check-out and will stay as loss of pay.` : ''} You can reopen it.`,
        confirmLabel: 'Close month',
        tone: 'default',
      });
      if (!ok) return;
    }
    setBusy(true);
    try {
      await (closing ? closeMonth(month, true) : reopenMonth(month));
      notify.success(closing ? `${month} closed.` : `${month} reopened.`);
      setAttempt((n) => n + 1);
    } catch (e) {
      notify.error(String(e?.message || 'Not done.'));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    let cancelled = false;
    getSummary(month)
      .then((d) => !cancelled && (setData(d), setError('')))
      .catch((e) => !cancelled && setError(String(e?.message || 'Could not load the month.')));
    return () => {
      cancelled = true;
    };
  }, [month, attempt]);

  /* What payroll reads first, then why: payable and loss of pay lead, the breakdown follows. */
  const columns = [
    { key: 'code', label: 'Employee ID' },
    { key: 'name', label: 'Name' },
    { key: 'payableDays', label: 'Payable days', lead: true },
    { key: 'lossOfPayDays', label: 'Loss of pay', lead: true },
    { key: 'present', label: 'Present' },
    { key: 'halfDays', label: 'Half days' },
    { key: 'absent', label: 'Absent' },
    { key: 'incompleteDays', label: 'No check-out' },
    { key: 'leave', label: 'Leave' },
    { key: 'unpaidLeaveDays', label: 'Unpaid leave' },
    { key: 'holidays', label: 'Holidays' },
    { key: 'weeklyOffs', label: 'Weekly offs' },
    { key: 'lateCount', label: 'Late days' },
    { key: 'latePenaltyDays', label: 'Late penalty' },
    { key: 'approvedOvertimeMinutes', label: 'Approved OT', value: (r) => hm(r.approvedOvertimeMinutes) },
    { key: 'notYet', label: 'To come' },
    { key: 'totalDays', label: 'Days' },
  ];
  /* A table of mostly zeros hides the few figures that matter; a zero reads as a dash (the export keeps the 0). */
  const shown = (c, r) => {
    const v = c.value ? (r[c.key] ? c.value(r) : 0) : r[c.key];
    return v === 0 || v === '0:00' ? '—' : v ?? '—';
  };

  const search = useListSearch(data?.rows || [], ['name', 'code']);
  const filters = useColumnFilters();
  const rows = filters.applyFilters(search.filtered, FILTER_COLUMNS);
  const figures = useMemo(() => {
    const list = data?.rows || [];
    const sum = (k) => list.reduce((a, r) => a + Number(r[k] || 0), 0);
    return { people: list.length, payable: sum('payableDays'), lop: sum('lossOfPayDays'), noOut: sum('incompleteDays') };
  }, [data]);
  const round = (n) => Math.round(n * 10) / 10;

  return (
    <DocumentListShell
      entity="report"
      title="Month summary"
      description="Payable days for payroll. Days still to come are neither paid nor lost yet."
      compact
      tight
      denseCards
      search={{ value: search.query, onChange: search.setQuery, placeholder: 'Search people…', label: 'Search people' }}
      headerExtras={<input type="month" className="ui-input ui-ctl-compact !w-auto" value={month} max={todayIst().slice(0, 7)} onChange={(e) => setMonth(e.target.value)} aria-label="Month" />}
      moreItems={[exportMenuItem('Export summary')]}
      onMoreSelect={(k) => {
        const format = exportFormatFromKey(k);
        if (!format || !data?.rows?.length) return;
        runListExport({ format, title: 'Attendance summary', subtitle: month, fileName: `Attendance summary ${month}`, label: 'person/people', columns, rows });
      }}
      primary={
        ended && data ? (
          data.closed ? (
            <button type="button" className="ui-btn ui-btn-secondary" disabled={busy} onClick={toggleClosed}><Unlock size={16} aria-hidden="true" /> Reopen month</button>
          ) : (
            <button type="button" className="ui-btn ui-btn-primary" disabled={busy} onClick={toggleClosed}><Lock size={16} aria-hidden="true" /> Close month</button>
          )
        ) : null
      }
      cards={data ? [
        { label: 'People', value: figures.people, count: true, tone: 'all', Icon: Users },
        { label: 'Payable days', value: round(figures.payable), count: true, tone: 'paid', Icon: CalendarCheck },
        { label: 'Loss of pay days', value: round(figures.lop), count: true, tone: 'overdue', Icon: CalendarX },
        { label: 'No check-out', value: figures.noOut, count: true, tone: 'outstanding', Icon: Clock },
      ] : null}
      above={
        data?.closed ? (
          <div className="ui-card p-3 text-sm" role="status">
            <span className="ui-pill ui-pill-pos">Closed</span> <span className="ui-caption">These days are final. Reopen the month to change them.</span>
          </div>
        ) : null
      }
    >
      <LoadFailed message={error} onRetry={() => setAttempt((n) => n + 1)} />
      {!data ? (
        error ? null : <SkeletonCard lines={6} />
      ) : (
        <div className="ui-table-scroll">
          <table className="ui-table ui-table-sticky w-full">
            <thead>
              <tr>
                {columns.map((c) =>
                  FILTER_COLUMNS[c.key] ? (
                    <ColumnHeader key={c.key} label={c.label} col={c.key} state={filters} className="whitespace-nowrap" />
                  ) : (
                    <th key={c.key} scope="col" className="ui-num whitespace-nowrap">{c.label}</th>
                  )
                )}
              </tr>
            </thead>
            <tbody className="ui-rows">
              {!rows.length ? (
                <tr>
                  <td colSpan={columns.length}>
                    {data.rows.length ? (
                      <EmptyState kind="filtered" totalCount={data.rows.length} title="Nobody matches" description="Nobody matches the search or the column filters." />
                    ) : (
                      <EmptyState icon={Users} title="Nobody employed this month" description="Add people in People, with their joining dates." />
                    )}
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.employeeId}>
                    {columns.map((c) => (
                      <td
                        key={c.key}
                        className={FILTER_COLUMNS[c.key] ? (c.key === 'name' ? 'ui-col-entity whitespace-nowrap' : 'whitespace-nowrap') : 'ui-num'}
                        style={c.lead ? { fontWeight: 600 } : undefined}
                      >
                        {FILTER_COLUMNS[c.key] ? r[c.key] ?? '—' : shown(c, r)}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </DocumentListShell>
  );
}
