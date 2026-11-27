import { PEOPLE_SCREEN_ALIASES } from '@platform/includedApps';
import TimeRegisterTable from '@ui/components/list/TimeRegisterTable';
import React, { useState } from 'react';
import useRequest from '@ui/components/ui/useRequest';
import { ShieldCheck } from '@ui/components/ui/lineIcons';

import { EmptyState, PageHeader, SkeletonCard } from '@ui/components/ui/Primitives';
import { CountLine } from '@ui/components/ui/CountLine';
import { MoreButton } from '@ui/components/list/ListPageParts';
import { exportFormatFromKey, exportMenuItem, runListExport } from '@ui/components/list/exportMenu';
import { getPayrollReadiness, todayIst } from '../api/attendance';
import LoadFailed from '@ui/components/ui/LoadFailed';
import { errorWords } from '@ui/utils/errorWords';

/**
 * Attendance → Period Closing → Payroll Readiness: the HR research's control
 * tower for one month. Every issue in the way of payroll — open days,
 * waiting approvals, unmatched punches, and the People / Payroll data that
 * would make a pay run fail — with who fixes it, the people blocking close,
 * and the money at stake (estimated from salaries, for those allowed to see
 * pay). Read-only: every fix opens the screen that makes it.
 */
const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const money = (v) => (v == null ? '—' : inr.format(v));
const lastMonth = () => {
  const [y, m] = todayIst().slice(0, 7).split('-').map(Number);
  return new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 7);
};
const EXPORT_COLUMNS = [
  { key: 'name', label: 'Employee' },
  { key: 'code', label: 'Employee ID' },
  { key: 'problems', label: 'What is in the way', value: (r) => r.problems.join('; ') },
  { key: 'money', label: 'Pay at stake (estimate)', value: (r) => (r.money == null ? '' : r.money) },
];

export default function PayrollReadiness({ peopleTimePage, openApp, openScreen, menuLabel }) {
  const [month, setMonth] = useState(lastMonth());
  const readiness = useRequest(async () => ({ month, result: await getPayrollReadiness(month) }), [month]);
  const data = readiness.data?.month === month && !readiness.error ? readiness.data.result : null;
  const teamOnly = readiness.error?.data?.code === 'TEAM_SCOPED';
  const error = !teamOnly && readiness.error ? errorWords(readiness.error, 'check the month') : '';

  const issueAction = (issue) => {
    if (issue.app === 'payroll') return <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={() => openApp?.('payroll', issue.screen)}>Fix in Payroll</button>;
    const screen = (peopleTimePage && PEOPLE_SCREEN_ALIASES[issue.screen]) || issue.screen;
    const labels = { records: 'Review days', monthClose: 'Review month', confirmations: 'Review disputes', unmatched: 'Match punches' };
    let target;
    if (issue.screen === 'records') target = { from: month + '-01', to: monthEnd(month) };
    if (['monthClose', 'confirmations'].includes(issue.screen)) target = { month };
    return <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={() => openScreen?.(screen, target)}>{labels[issue.screen] || 'Review issue'}</button>;
  };
  const monthEnd = (m) => new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0)).toISOString().slice(0, 10);

  const figures = data && !teamOnly ? <CountLine
              label="Summary"
              items={[
                { key: 'ready', label: data.ready ? 'ready: nothing blocks the month' : 'ready', value: `${data.score}%` },
                { key: 'blocking', label: `of ${data.people.total} people blocking`, value: data.people.blocking, tone: 'neg' },
                { key: 'pay', label: 'pay at stake (open days × a day’s pay)', value: data.payVisible && data.moneyAtRisk ? money(data.moneyAtRisk) : 0, tone: 'neg' },
                { key: 'issues', label: `${data.issues.length === 1 ? 'issue' : 'issues'}, ${data.issues.filter((i) => i.blocks).length} block the month`, value: data.issues.length, tone: 'warn' },
              ]}
            /> : null;
  return (
    <div className="space-y-3">
      <PageHeader
        entity="report"
        title={menuLabel || 'Payroll readiness'}
        summary={peopleTimePage ? figures : null}
        description={peopleTimePage ? undefined : "Review the issues holding up payroll for the selected month."}
        actions={
          <span className="flex items-center gap-2">
            <input type="month" className="ui-input ui-ctl-compact !w-auto" value={month} max={todayIst().slice(0, 7)} onChange={(e) => { if (e.target.value) setMonth(e.target.value); }} aria-label="Month" />
            {teamOnly ? null : <MoreButton
              items={[exportMenuItem('Export')]}
              onSelect={(k) => {
                const format = exportFormatFromKey(k);
                if (format && data) runListExport({ format, title: `Payroll readiness ${month}`, fileName: `Payroll readiness ${month}`, label: 'person/people', columns: data.payVisible ? EXPORT_COLUMNS : EXPORT_COLUMNS.filter(column => column.key !== 'money'), rows: data.blockers });
              }}
            />}
          </span>
        }
      />
      <div className="pb-8 space-y-4">
        <LoadFailed message={error} onRetry={readiness.reload} />
        {teamOnly ? (
          <div>
            {/* EmptyState shows no sentence under a heading, and here the reason is the point; it gets its own line. */}
            <EmptyState icon={ShieldCheck} title="Payroll readiness covers the whole company" />
            <div className="-mt-6 flex flex-col items-center gap-3 px-6 text-center">
              <p className="ui-caption">Your role sees your own team. Month close shows your team’s open days.</p>
              {openScreen ? <button type="button" className="ui-btn ui-btn-secondary" onClick={() => openScreen('monthClose', { month })}>Open month close</button> : null}
            </div>
          </div>
        ) : !data ? (
          error ? null : <SkeletonCard lines={8} />
        ) : (
          <>
            {!peopleTimePage && figures}
            {!data.payVisible ? <p className="ui-caption">Pay at stake is hidden: it needs permission to see salaries.</p> : null}

            {!data.issues.length ? (
              <EmptyState icon={ShieldCheck} title="Ready for payroll" description="No open days, nothing waiting for approval, and payroll has the details it needs for everyone." />
            ) : (
              <section className="space-y-3" aria-label="Issues">
                {data.issues.map((i) => (
                  <article key={i.key} className="ui-card p-4 space-y-1">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className={`ui-pill ui-pill-${i.blocks ? 'neg' : 'warn'}`}>{i.blocks ? 'Blocks payroll' : 'Check'}</span>
                          <span className="ui-caption">{i.source}</span>
                        </div>
                        <h2 className="ui-t-sec">
                          {i.title} <span className="tabular-nums">· {i.count}</span>
                          {data.payVisible && i.money != null ? <span className="tabular-nums"> · {money(i.money)} at stake</span> : null}
                        </h2>
                      </div>
                      {issueAction(i)}
                    </div>
                    <p className="text-sm">{i.why}</p>
                    <p className="ui-caption">Who fixes it: {i.owner}</p>
                  </article>
                ))}
              </section>
            )}

            {data.blockers.length ? (
              <section className="ui-list-surface overflow-hidden" aria-labelledby="blockers-h">
                <div className="px-4 pt-4 pb-2">
                  <h2 id="blockers-h" className="ui-t-sec">Employees with unresolved issues</h2>
                  <p className="ui-caption">Open an employee to review their attendance for this month.</p>
                </div>
                <div className="ui-table-scroll">
                  <TimeRegisterTable enabled={peopleTimePage} register="PayrollReadiness" required={['Employee']} className="ui-table w-full">
                    <thead>
                      <tr>
                        <th>Employee</th>
                        <th>What is in the way</th>
                        {data.payVisible ? <th className="ui-num">Pay at stake</th> : null}
                      </tr>
                    </thead>
                    <tbody>
                      {data.blockers.map((p) => (
                        <tr key={p.employeeId}>
                          <td>
                            <button type="button" className="ui-link text-left" onClick={() => openScreen?.('records', { employeeId: p.employeeId, from: `${month}-01`, to: monthEnd(month) })}>
                              {p.name}{p.code ? ` · ${p.code}` : ''}
                            </button>
                          </td>
                          <td className="whitespace-normal">{p.problems.join(' · ')}</td>
                          {data.payVisible ? <td className="ui-num tabular-nums">{money(p.money)}</td> : null}
                        </tr>
                      ))}
                    </tbody>
                  </TimeRegisterTable>
                </div>
              </section>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
