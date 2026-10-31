import React from 'react';

import { EmptyState, PageHeader, SkeletonCard } from '@ui/components/ui/Primitives';
import ErrorState from '@ui/components/ui/ErrorState';
import useRequest from '@ui/components/ui/useRequest';
import { formatDate } from '@ui/components/ui/DatePicker';
import { usePermissions } from '@ui/permissions/usePermissions';
import { can } from '@ui/timeOff/shared';

import { getHrSalaryRevisions } from '../api/choices';
import PayrollSalaryRevisions from '../../../payroll/src/screens/SalaryRevisions';

/**
 * Salary revisions in People. Whoever holds Payroll's right works in Payroll's own screen. HR without Payroll
 * access, when the owner allows it (Settings → Company choices), reads the list here: who, the old and the new pay,
 * from when, and where it stands. Read only: no raise, review or approve (SPEC 3.3).
 */
const STATUS = {
  DRAFT: { label: 'Draft', tone: 'ui-pill-neutral' },
  REVIEWED: { label: 'Reviewed', tone: 'ui-pill-neutral' },
  APPROVED: { label: 'Approved', tone: 'ui-pill-pos' },
  APPLIED: { label: 'In effect', tone: 'ui-pill-pos' },
  REJECTED: { label: 'Rejected', tone: 'ui-pill-neutral' },
};
const money = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;

export function SalaryRevisionsReadOnly() {
  const req = useRequest(() => getHrSalaryRevisions(), []);
  const title = 'Salary revisions';
  if (req.error && !req.data) return <div className="space-y-6"><PageHeader title={title} /><ErrorState error={req.error} onRetry={req.reload} /></div>;
  if (!req.data) return <div className="space-y-6"><PageHeader title={title} /><SkeletonCard lines={6} /></div>;
  const rows = req.data.revisions || [];
  return (
    <div className="space-y-4">
      <PageHeader title={title} />
      <p className="ui-caption">Read only. Payroll raises, reviews and approves revisions.</p>
      {!rows.length ? (
        <EmptyState title="No salary revisions yet" />
      ) : (
        <div className="ui-table-scroll border-t" style={{ borderColor: 'rgb(var(--border))' }}>
          <table className="ui-table w-full" aria-label="Salary revisions">
            <thead>
              <tr>
                <th scope="col">Employee</th>
                <th scope="col" className="ui-col-h-right">From (a year)</th>
                <th scope="col" className="ui-col-h-right">To (a year)</th>
                <th scope="col" className="ui-col-h-right">Rise</th>
                <th scope="col" className="ui-col-h-center">In effect from</th>
                <th scope="col" className="ui-col-h-center">Status</th>
              </tr>
            </thead>
            <tbody className="ui-rows">
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="ui-col-entity whitespace-nowrap">{r.employeeName}{r.employeeCode ? <span className="ui-caption"> · {r.employeeCode}</span> : null}</td>
                  <td className="ui-col-amount tabular-nums">{money(r.currentAnnualCtc)}</td>
                  <td className="ui-col-amount tabular-nums">{money(r.proposedAnnualCtc)}</td>
                  <td className="ui-col-amount tabular-nums">{r.incrementPercent ? `${r.incrementPercent}%` : '—'}</td>
                  <td className="ui-col-date ui-col-h-center">{r.effectiveFrom ? formatDate(String(r.effectiveFrom).slice(0, 10)) : '—'}</td>
                  <td className="ui-col-h-center"><span className={`ui-pill ${STATUS[r.status]?.tone || 'ui-pill-neutral'}`}>{STATUS[r.status]?.label || r.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** Payroll's screen for those who hold its right; the read-only list for HR the company let in. */
export default function SalaryRevisionsInPeople(props) {
  const perms = usePermissions();
  if (can(perms, 'PAYROLL::Salary Revisions::VIEW')) return <PayrollSalaryRevisions {...props} />;
  return <SalaryRevisionsReadOnly />;
}
