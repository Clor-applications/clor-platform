import React, { useCallback, useEffect, useState } from 'react';
import { ShieldCheck } from 'lucide-react';

import { EmptyState, PageHeader, SkeletonCard, StatTile } from '@ui/components/ui/Primitives';
import { MoreButton } from '@ui/components/list/ListPageParts';
import { exportFormatFromKey, exportMenuItem, runListExport } from '@ui/components/list/exportMenu';
import { getPayrollReadiness, todayIst } from '../api/attendance';
import LoadFailed from '@ui/components/ui/LoadFailed';

/**
 * Attendance → Period Closing → Payroll Readiness: the HR research's control
 * tower for one month. Every issue in the way of payroll — open days,
 * waiting approvals, unmatched punches, and the People / Payroll data that
 * would make a pay run fail — with who fixes it, the people blocking close,
 * and the money at stake (estimated from salaries, for those allowed to see
 * pay). Read-only: every fix opens the screen that makes it.
 */
const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
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

export default function PayrollReadiness({ openScreen }) {
  const [month, setMonth] = useState(lastMonth());
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  /* A team-scoped role: payroll readiness is the whole company's, so it is not shown. */
  const [teamOnly, setTeamOnly] = useState(false);
  const [seen, setSeen] = useState(month);
  if (seen !== month) {
    setSeen(month);
    setData(null);
  }
  const load = useCallback(() => {
    getPayrollReadiness(month)
      .then((d) => { setData(d); setError(''); setTeamOnly(false); })
      .catch((e) => {
        if (e?.data?.code === 'TEAM_SCOPED') { setTeamOnly(true); setError(''); return; }
        setError(String(e?.message || 'Could not check the month.'));
      });
  }, [month]);
  useEffect(() => {
    load();
  }, [load]);

  const fix = (i) =>
    i.app === 'payroll' ? (
      <a className="ui-btn ui-btn-secondary ui-btn-sm" href={`?app=payroll&open=${encodeURIComponent(i.screen)}`}>Fix in Payroll</a>
    ) : (
      <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={() => openScreen?.(i.screen)}>Fix</button>
    );
  const monthEnd = (m) => new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0)).toISOString().slice(0, 10);

  return (
    <div className="space-y-3">
      <PageHeader
        entity="report"
        title="Payroll Readiness"
        description="What is in the way of this month's payroll, who fixes it, and the pay at stake if nobody does."
        actions={
          <span className="flex items-center gap-2">
            <input type="month" className="ui-input ui-ctl-compact !w-auto" value={month} max={todayIst().slice(0, 7)} onChange={(e) => setMonth(e.target.value)} aria-label="Month" />
            {teamOnly ? null : <MoreButton
              items={[exportMenuItem('Export')]}
              onSelect={(k) => {
                const format = exportFormatFromKey(k);
                if (format && data) runListExport({ format, title: `Payroll readiness ${month}`, fileName: `Payroll readiness ${month}`, label: 'person/people', columns: EXPORT_COLUMNS, rows: data.blockers });
              }}
            />}
          </span>
        }
      />
      <div className="pb-8 space-y-4">
        <LoadFailed message={error} onRetry={load} />
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
            <section className="grid grid-cols-2 gap-3 md:grid-cols-4" aria-label="Summary">
              <StatTile label="Ready" value={`${data.score}%`} hint={data.ready ? 'nothing blocks the month' : 'of people with nothing in the way'} tone={data.ready ? 'pos' : 'warn'} />
              <StatTile label="People blocking" value={data.people.blocking} hint={`of ${data.people.total}`} tone={data.people.blocking ? 'neg' : 'pos'} />
              <StatTile label="Pay at stake" value={data.payVisible ? money(data.moneyAtRisk) : 'Hidden'} hint={data.payVisible ? 'estimate: open days × a day’s pay' : 'needs permission to see salaries'} tone={data.moneyAtRisk ? 'neg' : 'neutral'} />
              <StatTile label="Issues" value={data.issues.length} hint={`${data.issues.filter((i) => i.blocks).length} block the month`} tone={data.issues.length ? 'warn' : 'pos'} />
            </section>

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
                          {i.money != null ? <span className="tabular-nums"> · {money(i.money)} at stake</span> : null}
                        </h2>
                      </div>
                      {fix(i)}
                    </div>
                    <p className="text-sm">{i.why}</p>
                    <p className="ui-caption">Who fixes it: {i.owner}</p>
                  </article>
                ))}
              </section>
            )}

            {data.blockers.length ? (
              <section className="ui-card overflow-hidden" aria-labelledby="blockers-h">
                <div className="px-4 pt-4 pb-2">
                  <h2 id="blockers-h" className="ui-t-sec">People in the way</h2>
                  <p className="ui-caption">Worst first. Open a name to see their days.</p>
                </div>
                <div className="ui-table-scroll">
                  <table className="ui-table w-full">
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
                  </table>
                </div>
              </section>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
