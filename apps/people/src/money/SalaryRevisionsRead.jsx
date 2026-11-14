import React from 'react';

import { SkeletonCard } from '@ui/components/ui/Primitives';
import ListHeader, { ListEmpty as EmptyState } from '@ui/components/list/ListHeader';
import ErrorState from '@ui/components/ui/ErrorState';
import useRequest from '@ui/components/ui/useRequest';
import { formatDate } from '@ui/components/ui/DatePicker';
import { usePermissions } from '@ui/permissions/usePermissions';
import { can } from '@ui/timeOff/shared';

import { getHrSalaryRevisions } from '../api/choices';
import PayrollSalaryRevisions from '../../../payroll/src/screens/SalaryRevisions';
import { wholeRupees as money } from '@ui/utils/money';
import { Avatar } from '@ui/personnel/Employees';
import { ArrowTrendingLines20Color, Clock20Color, CoinMultiple20Color, PeopleList20Color } from '@fluentui/react-icons';
import { KpiTiles } from '../components/Core';

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
const WAITING = new Set(['DRAFT', 'REVIEWED']);

export function SalaryRevisionsReadOnly() {
  const req = useRequest(() => getHrSalaryRevisions(), []);
  const title = 'Salary revisions';
  const rows = req.data?.revisions || [];
  /* PEOPLE-09's figures, from the same list: how many, the average rise, what the rises add a year, what still waits. */
  const live = rows.filter((r) => r.status !== 'REJECTED');
  const rises = live.map((r) => Number(r.incrementPercent)).filter((n) => Number.isFinite(n));
  const added = live.reduce((a, r) => a + Math.max(0, Number(r.proposedAnnualCtc || 0) - Number(r.currentAnnualCtc || 0)), 0);
  const waiting = rows.filter((r) => WAITING.has(r.status)).length;
  const strip = rows.length ? (
    <KpiTiles label="Salary revisions at a glance" items={[
      { key: 'n', label: 'Revisions', cat: 1, Icon: PeopleList20Color, value: live.length, note: `${new Set(live.map((r) => r.employeeId || r.employeeName)).size} people` },
      { key: 'avg', label: 'Average increase', cat: 2, Icon: ArrowTrendingLines20Color, value: rises.length ? `${(rises.reduce((a, n) => a + n, 0) / rises.length).toFixed(1)}%` : '—', note: 'Across revisions not rejected' },
      { key: 'cost', label: 'Annual cost added', cat: 3, Icon: CoinMultiple20Color, value: money(added), note: 'New CTC less old, a year' },
      { key: 'wait', label: 'Awaiting approval', cat: 4, Icon: Clock20Color, value: waiting, tone: 'warn', note: waiting ? 'Approved in Payroll' : 'Nothing waiting' },
    ]} />
  ) : null;
  const header = <ListHeader section="Pay, benefits & assets" title={title} strip={strip} description="Annual CTC changes, from when, and where each revision stands. Read only: Payroll raises, reviews and approves revisions." />;
  if (req.error && !req.data) return <div className="space-y-6">{header}<ErrorState error={req.error} onRetry={req.reload} /></div>;
  if (!req.data) return <div className="space-y-6">{header}<SkeletonCard lines={6} /></div>;
  return (
    <div className="space-y-6">
      {header}
      {!rows.length ? (
        <EmptyState title="No salary revisions yet" description="A revision raised in Payroll shows here once it exists, with its old and new pay." />
      ) : (
        <>
        <div className="ui-table-scroll">
          <table className="ui-table w-full" aria-label="Salary revisions">
            <thead>
              <tr>
                <th scope="col">Employee</th>
                <th scope="col" className="ui-col-h-right">Old CTC</th>
                <th scope="col" className="ui-col-h-right">New CTC</th>
                <th scope="col" className="ui-col-h-right">Change</th>
                <th scope="col" className="ui-col-h-right">Effective</th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody className="ui-rows">
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="ui-col-entity"><span className="pc-who"><Avatar person={{ name: r.employeeName }} size={32} /><span className="pc-who-text"><span className="pc-who-name">{r.employeeName}</span>{r.employeeCode || r.designation ? <span className="pc-who-sub">{r.designation || r.employeeCode}</span> : null}</span></span></td>
                  <td className="ui-col-amount tabular-nums text-right">{money(r.currentAnnualCtc)}</td>
                  <td className="ui-col-amount tabular-nums text-right font-semibold">{money(r.proposedAnnualCtc)}</td>
                  <td className="ui-col-amount tabular-nums text-right">{r.incrementPercent ? <span className={Number(r.incrementPercent) > 0 ? 'pc-up' : ''}>{Number(r.incrementPercent) > 0 ? '+' : ''}{Number(r.incrementPercent).toFixed(1)}%</span> : '—'}</td>
                  <td className="ui-col-date tabular-nums text-right whitespace-nowrap">{r.effectiveFrom ? formatDate(String(r.effectiveFrom).slice(0, 10)) : '—'}</td>
                  <td><span className={`ui-pill ${STATUS[r.status]?.tone || 'ui-pill-neutral'}`}>{STATUS[r.status]?.label || r.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="pc-note">Amounts are annual CTC. Only people the company lets read salaries see this page.</p>
        </>
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
