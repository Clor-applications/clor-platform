import ReviewTable from '@ui/components/ui/ReviewTable';
import { enumWords } from '@ui/utils/errorWords';
import React, { useState } from 'react';
import { MoreButton } from '@ui/components/list/ListPageParts';
import SearchField from '@ui/components/ui/SearchField';

import { ExceptionTag } from '@ui/components/ui/ExceptionTag';
import { SkeletonCard } from '@ui/components/ui/Primitives';
import ListHeader, { ListEmpty as EmptyState } from '@ui/components/list/ListHeader';
import ErrorState from '@ui/components/ui/ErrorState';
import useRequest from '@ui/components/ui/useRequest';
import { formatDate } from '@ui/components/ui/DatePicker';
import { usePermissions } from '@ui/permissions/usePermissions';
import { can } from '@ui/timeOff/shared';

import { getHrSalaryRevisions } from '../api/choices';
import PayrollSalaryRevisions from '../../../payroll/src/screens/SalaryRevisions';
import { ColumnHeader } from '@ui/components/ColumnFilters';
import { wholeRupees as money, moneyCell } from '@ui/utils/money';
import { Avatar } from '@ui/personnel/Employees';
import { Clock, Coins, TrendingUp, Users } from 'lucide-react';
import { CountLine } from '@ui/components/ui/CountLine';

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
  const [query, setQuery] = useState('');
  const shown = rows.filter((r) => [r.employeeName, r.employeeCode, r.designation, STATUS[r.status]?.label].some((v) => v?.toLowerCase().includes(query.toLowerCase())));
  /* PEOPLE-09's figures, from the same list: how many, the average rise, what the rises add a year, what still waits. */
  const live = rows.filter((r) => r.status !== 'REJECTED');
  const rises = live.map((r) => Number(r.incrementPercent)).filter((n) => Number.isFinite(n));
  const added = live.reduce((a, r) => a + Math.max(0, Number(r.proposedAnnualCtc || 0) - Number(r.currentAnnualCtc || 0)), 0);
  const waiting = rows.filter((r) => WAITING.has(r.status)).length;
  const strip = rows.length ? (
    <CountLine label="Salary revisions at a glance" items={[
      { key: 'n', label: 'Revisions', cat: 1, Icon: Users, value: live.length, note: `${new Set(live.map((r) => r.employeeId || r.employeeName)).size} people` },
      { key: 'avg', label: 'Average increase', cat: 2, Icon: TrendingUp, value: rises.length ? `${(rises.reduce((a, n) => a + n, 0) / rises.length).toFixed(1)}%` : '—', note: 'Across revisions not rejected' },
      { key: 'cost', label: 'Annual cost added', cat: 3, Icon: Coins, value: money(added), note: 'Proposed annual CTC less old, a year' },
      { key: 'wait', label: 'Awaiting approval', cat: 4, Icon: Clock, value: waiting, tone: 'warn', note: waiting ? 'Approved in Payroll' : 'Nothing waiting' },
    ]} />
  ) : null;
  const header = <ListHeader section="Pay & benefits" title={title} strip={strip} description="Read only · Managed in Payroll" toolbar={<SearchField value={query} onSearch={setQuery} label="Search revisions" placeholder="Search revisions" />} />;
  if (req.error && !req.data) return <div className="people-register" data-column-sizing="content">{header}<ErrorState error={req.error} onRetry={req.reload} /></div>;
  if (!req.data) return <div className="people-register" data-column-sizing="content">{header}<SkeletonCard lines={6} /></div>;
  return (
    <div className="people-register" data-column-sizing="content">
      {header}
      <PeopleRevisionTable rows={shown} scope={query} empty={<EmptyState title={query ? 'No matching revisions' : 'No salary revisions yet'} />} />
    </div>
  );
}

function PeopleRevisionTable({ rows, onOpen, filters, exportRows, scope, empty }) {
  const amount = onOpen ? moneyCell : money;
  const status = (r) => <ExceptionTag label={STATUS[r.status]?.label || enumWords(r.status)} normal={STATUS[r.status]?.label} pill={STATUS[r.status]?.tone || 'ui-pill-neutral'} />;
  const employee = (r) => <span className="pc-who"><Avatar person={{ name: r.employeeName }} size={32} /><span className="pc-who-text"><strong>{r.employeeName}</strong><span className="pc-who-sub">{r.employeeCode || r.designation}</span></span></span>;
  const columns = [
    { key: 'employeeName', label: 'Employee', always: true, render: employee, header: filters && <ColumnHeader controlOnly label="Employee" col="employee" state={filters} /> },
    { key: 'currentAnnualCtc', label: 'Current annual CTC', align: 'right', render: (r) => amount(r.currentAnnualCtc) },
    { key: 'proposedAnnualCtc', label: 'Proposed annual CTC', align: 'right', render: (r) => amount(r.proposedAnnualCtc) },
    { key: 'incrementPercent', label: onOpen ? 'Raise' : 'Change', align: 'right', render: (r) => r.incrementPercent == null ? '—' : `${r.incrementPercent}%` },
    { key: 'effectiveFrom', label: 'Effective from', render: (r) => r.effectiveFrom ? formatDate(String(r.effectiveFrom).slice(0, 10)) : '—' },
    ...(onOpen ? [{ key: 'reason', label: 'Reason', render: (r) => r.reason || '—' }] : []),
    { key: 'status', label: 'Status', render: status },
  ];
  return <ReviewTable key={scope} label="Salary revisions" columns={columns} rows={rows}
    recordColumn="employeeName" rowLabel={(r) => r.employeeName} onRowClick={onOpen} exportSelected={exportRows}
    total={rows.length} pageSize={Math.max(25, rows.length)} noun="revisions" empty={empty}
    card={(r) => <span className="grid gap-1"><strong>{[r.employeeName, r.employeeCode].filter(Boolean).join(' · ')}</strong><span>{[amount(r.proposedAnnualCtc), r.effectiveFrom && formatDate(String(r.effectiveFrom).slice(0, 10))].filter(Boolean).join(' · ')}</span>{status(r)}</span>} />;
}

function PeopleRevisionList({ title, primary, countLine, search, moreItems, onMoreSelect, tabs, statusValue, statusCounts, onStatusChange, tabsLabel, above, children }) {
  return <div className="people-register people-revisions" data-column-sizing="content">
    <ListHeader title={title} primary={primary} strip={<CountLine items={countLine} />}
      secondary={moreItems?.length ? <MoreButton items={moreItems} onSelect={onMoreSelect} /> : null}
      toolbar={<SearchField label={search.label} placeholder="Search revisions" value={search.value} onSearch={search.onChange} />}
      tabs={tabs.map((t) => ({ key: t.value, label: t.label, count: statusCounts[t.value] }))}
      tabsLabel={tabsLabel} tab={statusValue} onTab={onStatusChange} />
    {above}
    {children}
  </div>;
}

/** Payroll's screen for those who hold its right; the read-only list for HR the company let in. */
export default function SalaryRevisionsInPeople(props) {
  const perms = usePermissions();
  if (can(perms, 'PAYROLL::Salary Revisions::VIEW')) return <PayrollSalaryRevisions {...props} ListShell={PeopleRevisionList} Records={PeopleRevisionTable} />;
  return <SalaryRevisionsReadOnly />;
}
