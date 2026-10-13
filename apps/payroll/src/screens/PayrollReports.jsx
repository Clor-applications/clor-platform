import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Download } from 'lucide-react';

import { PageHeader, SkeletonCard, EmptyState } from '@ui/components/ui/Primitives';
import { notify } from '@ui/components/ui/notify';
import { downloadCsv } from '@ui/utils/csv';
import { listPayrollPeriods } from '../api/payrollCalendar';
import { getSalaryRegister, getStatutoryReport, getVarianceReport, getCostReport } from '../api/payrollReports';

/**
 * Payroll reports.
 *
 * Four reports rather than sixteen, chosen because they answer the four
 * questions somebody actually has: what did we pay, what do we owe the
 * government, what looks wrong, and where did the money go. A list of sixteen
 * report names is a menu nobody reads; these are the ones that get opened.
 *
 * Every figure is read from payslips, which do not change — so a month nobody
 * has run is empty here rather than estimated, and the screen says so.
 */

const REPORTS = [
  { id: 'register', label: 'Salary register', hint: 'Everybody, every component — the one an auditor asks for.' },
  { id: 'statutory', label: 'Statutory', hint: 'What is owed to provident fund, ESI, professional tax and income tax.' },
  { id: 'variance', label: 'What changed', hint: 'Who moved since last month, and every new joiner.' },
  { id: 'cost', label: 'Cost by department', hint: 'Where the money went.' },
];

const SCHEME_NAMES = {
  PF: 'Provident Fund',
  ESI: 'Employee State Insurance',
  PT: 'Professional Tax',
  TDS: 'Income Tax (TDS)',
  LWF: 'Labour Welfare Fund',
};

const money = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

/* The sign belongs outside the currency symbol: "−₹6,360", never "₹-6,360". */
const signedMoney = (n) => {
  if (n == null) return '—';
  const v = Number(n);
  return `${v < 0 ? '−' : v > 0 ? '+' : ''}${money(Math.abs(v))}`;
};

const signedPercent = (n) => {
  if (n == null) return '—';
  const v = Number(n);
  return `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v)}%`;
};

export default function PayrollReports() {
  const [report, setReport] = useState('register');
  const [periods, setPeriods] = useState([]);
  const [periodId, setPeriodId] = useState('');
  const [threshold, setThreshold] = useState(5);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    listPayrollPeriods()
      .then((rows) => {
        setPeriods(rows);
        setPeriodId((p) => p || rows[0]?.id || '');
      })
      .catch((e) => setError(String(e?.message || 'Could not load payroll periods.')));
  }, []);

  const load = useCallback(async () => {
    if (!periodId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const filters = { periodId, ...(report === 'variance' ? { threshold } : {}) };
      const fetcher =
        report === 'statutory'
          ? getStatutoryReport
          : report === 'variance'
            ? getVarianceReport
            : report === 'cost'
              ? getCostReport
              : getSalaryRegister;
      /*
       * Tagged with the report it answers.
       *
       * Choosing a different report re-renders immediately, while this is
       * still in flight — so without the tag the new report's table renders
       * against the previous one's payload and reads a field that is not
       * there. Tagging rather than clearing keeps the old table on screen
       * until the new one is ready, instead of flashing empty.
       */
      const payload = await fetcher(filters);
      setData({ report, payload });
      setError('');
    } catch (e) {
      setError(String(e?.message || 'Could not run that report.'));
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [report, periodId, threshold]);

  useEffect(() => {
    load();
  }, [load]);

  const periodName = useMemo(() => periods.find((p) => p.id === periodId)?.name || 'payroll', [periods, periodId]);

  /* Only ever the payload for the report currently chosen. */
  const shown = data?.report === report ? data.payload : null;
  const hasRows = shown && (report === 'statutory' ? shown.schemes?.length > 0 : shown.rows?.length > 0);

  const exportCsv = () => {
    try {
      if (report === 'register') {
        downloadCsv({
          fileName: `Salary register — ${periodName}`,
          columns: [
            { key: 'employeeCode', label: 'Code' },
            { key: 'employeeName', label: 'Employee' },
            ...shown.columns.map((c) => ({ key: c.code, label: c.name, value: (r) => Number(r.amounts[c.code] || 0).toFixed(2) })),
            { key: 'grossEarnings', label: 'Gross', value: (r) => r.grossEarnings.toFixed(2) },
            { key: 'totalDeductions', label: 'Deductions', value: (r) => r.totalDeductions.toFixed(2) },
            { key: 'netPay', label: 'Take-home', value: (r) => r.netPay.toFixed(2) },
            { key: 'employerCost', label: 'Company pays', value: (r) => r.employerCost.toFixed(2) },
          ],
          rows: shown.rows,
        });
      } else if (report === 'statutory') {
        downloadCsv({
          fileName: `Statutory — ${periodName}`,
          columns: [
            { key: 'scheme', label: 'Scheme' },
            { key: 'employeeCode', label: 'Code' },
            { key: 'employeeName', label: 'Employee' },
            { key: 'uan', label: 'UAN' },
            { key: 'pan', label: 'PAN' },
            { key: 'wage', label: 'Wages', value: (r) => Number(r.wage).toFixed(2) },
            { key: 'employee', label: 'Employee share', value: (r) => Number(r.employee).toFixed(2) },
            { key: 'employer', label: 'Employer share', value: (r) => Number(r.employer).toFixed(2) },
          ],
          rows: shown.schemes.flatMap((s) => s.rows.map((r) => ({ ...r, scheme: SCHEME_NAMES[s.scheme] || s.scheme }))),
        });
      } else if (report === 'variance') {
        downloadCsv({
          fileName: `What changed — ${periodName}`,
          columns: [
            { key: 'employeeCode', label: 'Code' },
            { key: 'employeeName', label: 'Employee' },
            { key: 'previousNetPay', label: 'Last month', value: (r) => (r.previousNetPay == null ? '' : Number(r.previousNetPay).toFixed(2)) },
            { key: 'netPay', label: 'This month', value: (r) => Number(r.netPay).toFixed(2) },
            { key: 'change', label: 'Change', value: (r) => (r.change == null ? '' : Number(r.change).toFixed(2)) },
            { key: 'percent', label: 'Percent', value: (r) => (r.percent == null ? '' : String(r.percent)) },
            { key: 'isNew', label: 'First payslip', value: (r) => (r.isNew ? 'Yes' : '') },
          ],
          rows: shown.rows,
        });
      } else {
        downloadCsv({
          fileName: `Cost by department — ${periodName}`,
          columns: [
            { key: 'department', label: 'Department' },
            { key: 'headcount', label: 'People' },
            { key: 'gross', label: 'Gross', value: (r) => Number(r.gross).toFixed(2) },
            { key: 'deductions', label: 'Deductions', value: (r) => Number(r.deductions).toFixed(2) },
            { key: 'net', label: 'Take-home', value: (r) => Number(r.net).toFixed(2) },
            { key: 'employerCost', label: 'Company pays', value: (r) => Number(r.employerCost).toFixed(2) },
          ],
          rows: shown.rows,
        });
      }
      notify.success('Downloaded.');
    } catch (e) {
      notify.error(String(e?.message || 'Could not build that file.'));
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        entity="settings"
        title="Payroll reports"
        description="Read from the payslips themselves, so a report of a month says what was paid rather than what today's rates would say."
        actions={
          <button type="button" className="ui-btn ui-btn-secondary" onClick={exportCsv} disabled={!hasRows}>
            <Download size={16} aria-hidden="true" /> Download
          </button>
        }
      />

      {error ? (
        <div className="ui-card p-3 text-sm" role="alert" style={{ borderColor: 'rgb(var(--neg))', color: 'rgb(var(--neg))' }}>
          {error}
        </div>
      ) : null}

      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[14rem]">
          <label className="ui-label" htmlFor="report-kind">Report</label>
          <select id="report-kind" className="ui-select w-full" value={report} onChange={(e) => setReport(e.target.value)}>
            {REPORTS.map((r) => (
              <option key={r.id} value={r.id}>{r.label}</option>
            ))}
          </select>
          <span className="ui-caption">{REPORTS.find((r) => r.id === report)?.hint}</span>
        </div>
        <div className="min-w-[12rem]">
          <label className="ui-label" htmlFor="report-period">Month</label>
          <select id="report-period" className="ui-select w-full" value={periodId} onChange={(e) => setPeriodId(e.target.value)}>
            {periods.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>
        {report === 'variance' ? (
          <div className="w-32">
            <label className="ui-label" htmlFor="report-threshold">Bigger than</label>
            <input
              id="report-threshold"
              type="number"
              min="0"
              max="100"
              className="ui-input ui-num w-full"
              value={threshold}
              onChange={(e) => setThreshold(Number(e.target.value) || 0)}
            />
            <span className="ui-caption">percent</span>
          </div>
        ) : null}
      </div>

      {loading ? (
        <SkeletonCard lines={6} />
      ) : !periods.length ? (
        <EmptyState
          title="No payroll periods yet"
          description="A report covers a month. Add payroll periods under Settings → Payroll → Payroll periods."
        />
      ) : !hasRows ? (
        <EmptyState
          title="Nothing paid in this month"
          description="Reports read from payslips, so a month that has not been run is empty rather than estimated. Run payroll for this month and it will fill in."
        />
      ) : report === 'register' ? (
        <Register data={shown} />
      ) : report === 'statutory' ? (
        <Statutory data={shown} />
      ) : report === 'variance' ? (
        <Variance data={shown} />
      ) : (
        <Cost data={shown} />
      )}
    </div>
  );
}

const Register = ({ data }) => (
  <div className="ui-card overflow-hidden">
    <div className="overflow-x-auto ui-table-scroll">
      <table className="ui-table w-full">
        <thead>
          <tr>
            <th scope="col" className="ui-th">Employee</th>
            {data.columns.map((c) => (
              <th key={c.code} scope="col" className="ui-th ui-col-h-right">{c.name}</th>
            ))}
            <th scope="col" className="ui-th ui-col-h-right">Gross</th>
            <th scope="col" className="ui-th ui-col-h-right">Deductions</th>
            <th scope="col" className="ui-th ui-col-h-right">Take-home</th>
          </tr>
        </thead>
        <tbody>
          {data.rows.map((r) => (
            <tr key={r.slipId}>
              <td className="ui-col-entity">
                {r.employeeName}
                {r.employeeCode ? <span className="ui-caption"> · {r.employeeCode}</span> : null}
              </td>
              {data.columns.map((c) => (
                <td key={c.code} className="ui-col-amount">{r.amounts[c.code] ? money(r.amounts[c.code]) : '—'}</td>
              ))}
              <td className="ui-col-amount">{money(r.grossEarnings)}</td>
              <td className="ui-col-amount">{money(r.totalDeductions)}</td>
              <td className="ui-col-amount">{money(r.netPay)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td className="ui-col-entity">{data.rows.length} {data.rows.length === 1 ? 'person' : 'people'}</td>
            {data.columns.map((c) => (
              <td key={c.code} className="ui-col-amount">{data.totals.amounts[c.code] ? money(data.totals.amounts[c.code]) : '—'}</td>
            ))}
            <td className="ui-col-amount">{money(data.totals.grossEarnings)}</td>
            <td className="ui-col-amount">{money(data.totals.totalDeductions)}</td>
            <td className="ui-col-amount">{money(data.totals.netPay)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  </div>
);

const Statutory = ({ data }) => (
  <div className="space-y-6">
    {data.schemes.map((s) => (
      <section key={s.scheme} className="ui-card overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3" style={{ borderBottom: '1px solid rgb(var(--border))' }}>
          <div className="ui-sec-head">{SCHEME_NAMES[s.scheme] || s.scheme}</div>
          <div className="ui-caption">
            {s.count} {s.count === 1 ? 'person' : 'people'} · {money(s.employee)} withheld
            {s.employer ? ` · ${money(s.employer)} from the company` : ''} · {money(s.total)} owed
          </div>
        </div>
        <div className="overflow-x-auto ui-table-scroll">
          <table className="ui-table w-full">
            <thead>
              <tr>
                <th scope="col" className="ui-th">Employee</th>
                <th scope="col" className="ui-th">{s.scheme === 'PF' ? 'UAN' : s.scheme === 'ESI' ? 'ESI number' : 'PAN'}</th>
                <th scope="col" className="ui-th ui-col-h-right">Wages</th>
                <th scope="col" className="ui-th ui-col-h-right">Withheld</th>
                <th scope="col" className="ui-th ui-col-h-right">From the company</th>
              </tr>
            </thead>
            <tbody>
              {s.rows.map((r) => (
                <tr key={r.employeeId}>
                  <td className="ui-col-entity">
                    {r.employeeName}
                    {r.employeeCode ? <span className="ui-caption"> · {r.employeeCode}</span> : null}
                  </td>
                  <td className="ui-col-meta">
                    {(s.scheme === 'PF' ? r.uan : s.scheme === 'ESI' ? r.esiNumber : r.pan) || (
                      <span className="inline-flex items-center gap-1">
                        <AlertTriangle size={13} aria-hidden="true" style={{ color: 'rgb(var(--warn-ink))' }} /> not on file
                      </span>
                    )}
                  </td>
                  <td className="ui-col-amount">{money(r.wage)}</td>
                  <td className="ui-col-amount">{money(r.employee)}</td>
                  <td className="ui-col-amount">{r.employer ? money(r.employer) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    ))}
  </div>
);

const Variance = ({ data }) => (
  <div className="ui-card overflow-hidden">
    <div className="px-4 py-3" style={{ borderBottom: '1px solid rgb(var(--border))' }}>
      <div className="ui-sec-head">
        {data.count} of {data.totalSlips} {data.totalSlips === 1 ? 'payslip' : 'payslips'} worth a second look
      </div>
      <p className="ui-caption">
        Anybody whose take-home moved {data.threshold}% or more since last month, and everybody being paid for the first time.
      </p>
    </div>
    <div className="overflow-x-auto ui-table-scroll">
      <table className="ui-table w-full">
        <thead>
          <tr>
            <th scope="col" className="ui-th">Employee</th>
            <th scope="col" className="ui-th ui-col-h-right">Last month</th>
            <th scope="col" className="ui-th ui-col-h-right">This month</th>
            <th scope="col" className="ui-th ui-col-h-right">Change</th>
            <th scope="col" className="ui-th ui-col-h-right">Percent</th>
            <th scope="col" className="ui-th">Why it is here</th>
          </tr>
        </thead>
        <tbody>
          {data.rows.map((r) => (
            <tr key={r.slipId}>
              <td className="ui-col-entity">
                {r.employeeName}
                {r.employeeCode ? <span className="ui-caption"> · {r.employeeCode}</span> : null}
              </td>
              <td className="ui-col-amount">{r.previousNetPay == null ? '—' : money(r.previousNetPay)}</td>
              <td className="ui-col-amount">{money(r.netPay)}</td>
              <td className="ui-col-amount">{signedMoney(r.change)}</td>
              <td className="ui-col-amount">{signedPercent(r.percent)}</td>
              <td className="ui-col-meta">{r.isNew ? 'First payslip' : 'Moved more than the threshold'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </div>
);

const Cost = ({ data }) => (
  <div className="ui-card overflow-hidden">
    <div className="overflow-x-auto ui-table-scroll">
      <table className="ui-table w-full">
        <thead>
          <tr>
            <th scope="col" className="ui-th">Department</th>
            <th scope="col" className="ui-th ui-col-h-right">People</th>
            <th scope="col" className="ui-th ui-col-h-right">Gross</th>
            <th scope="col" className="ui-th ui-col-h-right">Deductions</th>
            <th scope="col" className="ui-th ui-col-h-right">Take-home</th>
            <th scope="col" className="ui-th ui-col-h-right">Company pays</th>
          </tr>
        </thead>
        <tbody>
          {data.rows.map((r) => (
            <tr key={r.department}>
              <td className="ui-col-entity">{r.department}</td>
              <td className="ui-col-amount">{r.headcount}</td>
              <td className="ui-col-amount">{money(r.gross)}</td>
              <td className="ui-col-amount">{money(r.deductions)}</td>
              <td className="ui-col-amount">{money(r.net)}</td>
              <td className="ui-col-amount">{money(r.employerCost)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td className="ui-col-entity">Everybody</td>
            <td className="ui-col-amount">{data.totals.headcount}</td>
            <td className="ui-col-amount">{money(data.totals.gross)}</td>
            <td className="ui-col-amount">{money(data.totals.deductions)}</td>
            <td className="ui-col-amount">{money(data.totals.net)}</td>
            <td className="ui-col-amount">{money(data.totals.employerCost)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  </div>
);
