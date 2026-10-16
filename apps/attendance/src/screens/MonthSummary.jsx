import React, { useEffect, useState } from 'react';
import { Download } from 'lucide-react';

import { PageHeader, SkeletonCard, EmptyState } from '@ui/components/ui/Primitives';
import { downloadCsv } from '@ui/utils/csv';
import { getSummary, hm, todayIst } from '../api/attendance';
import LoadFailed from '../components/LoadFailed';

/**
 * The month as payroll sees it: payable days and loss-of-pay days per
 * person. Absent days, half a half day, and unpaid leave are loss of pay;
 * holidays, weekly offs and paid leave are paid.
 */
export default function MonthSummary() {
  const [month, setMonth] = useState(todayIst().slice(0, 7));
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);

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

  return (
    <div className="space-y-4">
      <PageHeader
        entity="attendance"
        title="Month summary"
        description="Payable days for payroll. Days still to come are neither paid nor lost yet."
        actions={
          <div className="flex gap-2">
            <input type="month" className="ui-input" value={month} max={todayIst().slice(0, 7)} onChange={(e) => setMonth(e.target.value)} aria-label="Month" />
            <button type="button" className="ui-btn ui-btn-secondary" disabled={!data?.rows?.length} onClick={() => downloadCsv({ fileName: `Attendance summary ${month}`, columns, rows: data.rows })}>
              <Download size={16} aria-hidden="true" /> Export
            </button>
          </div>
        }
      />
      <LoadFailed message={error} onRetry={() => setAttempt((n) => n + 1)} />
      {!data ? (
        error ? null : <SkeletonCard lines={6} />
      ) : !data.rows.length ? (
        <EmptyState title="Nobody employed this month" description="Add people in People, with their joining dates." />
      ) : (
        <div className="ui-card overflow-hidden">
          <div className="overflow-x-auto ui-table-scroll ui-table-fit">
            <table className="ui-table w-full">
              <thead>
                <tr>
                  {columns.map((c) => (
                    <th key={c.key} scope="col" className={`ui-th whitespace-nowrap ${['code', 'name'].includes(c.key) ? '' : 'text-end'}`}>{c.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={r.employeeId}>
                    {columns.map((c) => (
                      <td
                        key={c.key}
                        className={['code', 'name'].includes(c.key) ? (c.key === 'name' ? 'ui-col-entity whitespace-nowrap' : 'ui-col-meta') : 'text-end tabular-nums'}
                        style={c.lead ? { fontWeight: 600 } : undefined}
                      >
                        {['code', 'name'].includes(c.key) ? r[c.key] ?? '—' : shown(c, r)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
