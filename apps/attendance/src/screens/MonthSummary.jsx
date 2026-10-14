import React, { useEffect, useState } from 'react';
import { Download } from 'lucide-react';

import { PageHeader, SkeletonCard, EmptyState } from '@ui/components/ui/Primitives';
import { downloadCsv } from '@ui/utils/csv';
import { getSummary, hm, todayIst } from '../api/attendance';

/**
 * The month as payroll sees it: payable days and loss-of-pay days per
 * person. Absent days, half a half day, and unpaid leave are loss of pay;
 * holidays, weekly offs and paid leave are paid.
 */
export default function MonthSummary() {
  const [month, setMonth] = useState(todayIst().slice(0, 7));
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    getSummary(month)
      .then((d) => !cancelled && (setData(d), setError('')))
      .catch((e) => !cancelled && setError(String(e?.message || 'Could not load the month.')));
    return () => {
      cancelled = true;
    };
  }, [month]);

  const columns = [
    { key: 'code', label: 'Employee ID' },
    { key: 'name', label: 'Name' },
    { key: 'totalDays', label: 'Days' },
    { key: 'present', label: 'Present' },
    { key: 'halfDays', label: 'Half days' },
    { key: 'absent', label: 'Absent' },
    { key: 'leave', label: 'Leave' },
    { key: 'unpaidLeaveDays', label: 'Unpaid leave' },
    { key: 'holidays', label: 'Holidays' },
    { key: 'weeklyOffs', label: 'Weekly offs' },
    { key: 'notYet', label: 'To come' },
    { key: 'lossOfPayDays', label: 'Loss of pay' },
    { key: 'payableDays', label: 'Payable days' },
    { key: 'lateCount', label: 'Late days' },
    { key: 'approvedOvertimeMinutes', label: 'Approved OT (h:mm)', value: (r) => hm(r.approvedOvertimeMinutes) },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        entity="attendance"
        title="Month summary"
        description="Payable days for payroll. Days still to come are neither paid nor lost yet; once the month ends, payable days are the month less loss of pay."
        actions={
          <div className="flex gap-2">
            <input type="month" className="ui-input" value={month} max={todayIst().slice(0, 7)} onChange={(e) => setMonth(e.target.value)} aria-label="Month" />
            <button type="button" className="ui-btn ui-btn-secondary" disabled={!data?.rows?.length} onClick={() => downloadCsv({ fileName: `Attendance summary ${month}`, columns, rows: data.rows })}>
              <Download size={16} aria-hidden="true" /> Export
            </button>
          </div>
        }
      />
      {error ? <div className="ui-card p-3 text-sm" role="alert" style={{ color: 'rgb(var(--neg))' }}>{error}</div> : null}
      {!data ? (
        <SkeletonCard lines={6} />
      ) : !data.rows.length ? (
        <EmptyState title="Nobody employed this month" description="Add people in People, with their joining dates." />
      ) : (
        <div className="ui-card overflow-hidden">
          <div className="overflow-x-auto ui-table-scroll">
            <table className="ui-table w-full">
              <thead>
                <tr>
                  {columns.map((c) => (
                    <th key={c.key} scope="col" className={`ui-th ${['code', 'name'].includes(c.key) ? '' : 'text-end'}`}>{c.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={r.employeeId}>
                    {columns.map((c) => (
                      <td key={c.key} className={['code', 'name'].includes(c.key) ? (c.key === 'name' ? 'ui-col-entity' : 'ui-col-meta') : 'text-end tabular-nums'}>
                        {c.value ? c.value(r) : r[c.key] ?? '—'}
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
