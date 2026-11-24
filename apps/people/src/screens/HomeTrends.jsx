import React, { useEffect, useState } from 'react';

import { apiFetch } from '@platform/http';
import { hasApp, requestOpenApp, requireOrgId as orgId } from '@platform/context';
import { BarChart, fmtMoney } from '@ui/components/charts/kit';

/*
 * Two blocks for People Home (DESIGN.md, People, 25 Nov 2026; from the owner's HRM dashboard reference):
 * - Pay runs: the last three regular runs, month, state as a word, net total, each opening its run in Payroll.
 *   Only for people who may read pay runs, and only when the company has Payroll.
 * - Attendance rate: the last six months as bars, this month in the primary, with the chart kit's table.
 *   Only for people who see the whole company's attendance; a team-scoped reader gets nothing, not a refusal.
 * Each block keeps quiet when it has nothing to show: no empty frame on Home.
 */

const PAY_STATE = {
  DRAFT: 'Draft',
  CALCULATED: 'Worked out',
  REVIEW: 'In review',
  APPROVED: 'Approved',
  LOCKED: 'Locked',
  PAID: 'Paid',
  POSTED: 'Paid and posted',
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthOf = (ym) => {
  const [y, m] = String(ym || '').split('-').map(Number);
  return m ? `${MONTHS[m - 1]} ${y}` : '';
};
const runMonth = (run) => run.period?.name || monthOf(String(run.payrollDate || '').slice(0, 7));

function Block({ id, title, action = null, children }) {
  return (
    <section aria-labelledby={id}>
      <header className="people-block-head">
        <h2 id={id} className="people-block-title">{title}</h2>
        {action}
      </header>
      {children}
    </section>
  );
}

export function HomePayRuns({ allowed }) {
  const show = allowed && hasApp('payroll');
  const [runs, setRuns] = useState(null);
  useEffect(() => {
    if (!show) return undefined;
    let live = true;
    apiFetch(`/orgs/${encodeURIComponent(orgId())}/payroll/runs?limit=12`, { skipWarehouseHeader: true })
      .then((r) => live && setRuns((r?.runs || []).filter((x) => x.kind !== 'OFF_CYCLE' && x.status !== 'CANCELLED').slice(0, 3)))
      .catch(() => live && setRuns([]));
    return () => { live = false; };
  }, [show]);
  if (!show || !runs?.length) return null;
  return (
    <Block id="payruns-h" title="Pay runs" action={<button type="button" className="people-more" onClick={() => requestOpenApp('payroll', 'runs')}>All pay runs</button>}>
      <ul className="people-list people-payruns">
        {runs.map((r) => (
          <li key={r.id}>
            <button type="button" className="people-payrun" onClick={() => requestOpenApp('payroll', 'runs', { run: r.id })}>
              <span className="people-payrun-month">{runMonth(r)}</span>
              <span className="ui-caption">{PAY_STATE[r.status] || r.status}</span>
              <span className="people-payrun-total">{r.netTotal ? fmtMoney(r.netTotal) : '—'}</span>
            </button>
          </li>
        ))}
      </ul>
    </Block>
  );
}

export function HomeAttendanceTrend({ allowed }) {
  const show = allowed && hasApp('attendance');
  const [data, setData] = useState(null);
  useEffect(() => {
    if (!show) return undefined;
    let live = true;
    apiFetch(`/orgs/${encodeURIComponent(orgId())}/attendance/reports/insights?months=6`, { skipWarehouseHeader: true })
      .then((r) => live && setData(r || null))
      .catch(() => live && setData(null));
    return () => { live = false; };
  }, [show]);
  const trend = (data?.trend || []).filter((t) => t.attendanceRate != null);
  if (!show || trend.length < 2) return null;
  const current = trend.findIndex((t) => t.month === data.current);
  return (
    <Block id="attendance-trend-h" title="Attendance rate" action={<button type="button" className="people-more" onClick={() => requestOpenApp('attendance', 'reportInsights')}>Insights</button>}>
      <BarChart
        label="Attendance rate by month"
        categories={trend.map((t) => monthOf(t.month).slice(0, 3))}
        series={[{ name: 'Attendance rate', values: trend.map((t) => t.attendanceRate) }]}
        highlight={current >= 0 ? current : undefined}
        format={(v) => `${v}%`}
        labels
        height={180}
      />
    </Block>
  );
}
