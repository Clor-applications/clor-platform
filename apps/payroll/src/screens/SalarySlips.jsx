import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Banknote, Clock, FileText, MinusCircle, Printer, Wallet } from 'lucide-react';

import { ColumnHeader, useColumnFilters } from '@ui/components/ColumnFilters';
import { useListSearch } from '@ui/components/ListToolbar';
import DocumentListShell from '@ui/components/list/DocumentListShell';
import { exportFormatFromKey, exportMenuItem, runListExport } from '@ui/components/list/exportMenu';
import { SkeletonCard, EmptyState } from '@ui/components/ui/Primitives';
import Drawer from '@ui/components/ui/Drawer';
import { notify } from '@ui/components/ui/notify';
import { listSalarySlips, getSalarySlip, getSlipYearToDate } from '../api/payrollSlips';
import LoadFailed from '../components/LoadFailed';

/**
 * Payslips.
 *
 * Two things a payslip has to do. It has to be a document somebody can read,
 * print and send — so the detail view is laid out as a payslip rather than as a
 * form with the values filled in. And every figure on it has to be answerable,
 * because "why is my HRA that?" is the most common question payroll receives
 * and the honest answer is the arithmetic that actually produced it.
 *
 * Everything shown comes from the payslip's own snapshot. Somebody promoted
 * since still has last March's payslip showing last March's job, and a salary
 * component edited today changes nothing that has already been paid.
 */

const money = (n) =>
  `₹${Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const shownDate = (iso) => {
  const s = String(iso || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return '—';
  const [y, m, d] = s.split('-');
  return `${d}/${m}/${y}`;
};

const TABS = [
  { value: '', label: 'All', tone: 'all' },
  { value: 'UNPAID', label: 'Unpaid', tone: 'outstanding' },
  { value: 'PAID', label: 'Paid', tone: 'paid' },
];
const COLUMNS = {
  employee: (s) => s.employee?.name || 'Unknown',
  period: (s) => s.period?.name || '—',
};
const EXPORT_COLUMNS = [
  { key: 'number', label: 'Payslip' },
  { key: 'employee', label: 'Employee', value: (s) => s.employee?.name || '' },
  { key: 'code', label: 'Code', value: (s) => s.employee?.code || '' },
  { key: 'period', label: 'Period', value: (s) => s.period?.name || '' },
  { key: 'grossEarnings', label: 'Gross', value: (s) => Number(s.grossEarnings || 0) },
  { key: 'totalDeductions', label: 'Deductions', value: (s) => Number(s.totalDeductions || 0) },
  { key: 'netPay', label: 'Net pay', value: (s) => Number(s.netPay || 0) },
  { key: 'paymentStatus', label: 'Payment', value: (s) => (s.paymentStatus === 'PAID' ? 'Paid' : 'Unpaid') },
];
const isPaid = (s) => s.paymentStatus === 'PAID';

export default function SalarySlips() {
  const [all, setAll] = useState(null);
  const [error, setError] = useState('');
  const [openId, setOpenId] = useState(null);
  const [status, setStatus] = useState('');

  const load = useCallback(() => {
    listSalarySlips()
      .then((v) => {
        setAll(v);
        setError('');
      })
      .catch((e) => setError(String(e?.message || 'Could not load payslips.')));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const counts = useMemo(() => {
    const list = all || [];
    const paid = list.filter(isPaid).length;
    return { '': list.length, PAID: paid, UNPAID: list.length - paid };
  }, [all]);
  const figures = useMemo(() => {
    const list = all || [];
    const sum = (f, k) => list.filter(f).reduce((a, x) => a + Number(x[k] || 0), 0);
    return { gross: sum(() => true, 'grossEarnings'), net: sum(() => true, 'netPay'), unpaid: sum((x) => !isPaid(x), 'netPay'), deductions: sum(() => true, 'totalDeductions') };
  }, [all]);
  const inTab = useMemo(() => (all || []).filter((x) => !status || (status === 'PAID') === isPaid(x)), [all, status]);
  const search = useListSearch(inTab, ['number']);
  const filters = useColumnFilters();
  const searched = useMemo(() => {
    const q = search.query.trim().toLowerCase();
    if (!q) return inTab;
    return inTab.filter((x) => `${x.number} ${x.employee?.name || ''} ${x.employee?.code || ''} ${x.period?.name || ''}`.toLowerCase().includes(q));
  }, [inTab, search.query]);
  const rows = filters.applyFilters(searched, COLUMNS);

  return (
    <DocumentListShell
      entity="payslip"
      title="Salary slips"
      description="Every payslip produced, and how each figure on it was reached."
      compact
      tight
      denseCards
      search={{ value: search.query, onChange: search.setQuery, placeholder: 'Search payslips…', label: 'Search payslips' }}
      moreItems={all?.length ? [exportMenuItem('Export payslips')] : null}
      onMoreSelect={(k) => {
        const format = exportFormatFromKey(k);
        if (!format) return;
        runListExport({ format, title: 'Salary slips', fileName: 'Salary slips', label: 'payslip/payslips', columns: EXPORT_COLUMNS, rows });
      }}
      cards={[
        { label: 'Gross', value: figures.gross, tone: 'sent', Icon: Banknote },
        { label: 'Deductions', value: figures.deductions, tone: 'partial', Icon: MinusCircle },
        { label: 'Net pay', value: figures.net, tone: 'paid', Icon: Wallet },
        { label: 'Net still unpaid', value: figures.unpaid, tone: 'outstanding', Icon: Clock, onSelect: () => setStatus('UNPAID') },
      ]}
      tabs={TABS}
      statusValue={status}
      statusCounts={counts}
      onStatusChange={setStatus}
      tabsLabel="Payment"
    >
      <LoadFailed message={error} onRetry={load} />
      {!all ? (
        error ? null : <SkeletonCard lines={4} />
      ) : (
        <div className="ui-table-scroll">
          <table className="ui-table ui-table-sticky w-full">
            <thead>
              <tr>
                <th scope="col">Payslip</th>
                <ColumnHeader label="Employee" col="employee" state={filters} />
                <ColumnHeader label="Period" col="period" state={filters} />
                <th scope="col" className="ui-num">Gross</th>
                <th scope="col" className="ui-num">Deductions</th>
                <th scope="col" className="ui-num">Net pay</th>
                <th scope="col" className="ui-col-h-center">Payment</th>
              </tr>
            </thead>
            <tbody className="ui-rows">
              {!rows.length ? (
                <tr>
                  <td colSpan={7}>
                    {inTab.length ? (
                      <EmptyState kind="filtered" totalCount={inTab.length} title="No payslips match" description="Nothing in this tab matches the search or the column filters." />
                    ) : (
                      <EmptyState
                        icon={FileText}
                        title={status ? `No ${status.toLowerCase()} payslips` : 'No payslips yet'}
                        description="Payslips appear here once a payroll has been calculated. Start one under Pay runs."
                      />
                    )}
                  </td>
                </tr>
              ) : (
                rows.map((x) => (
                  <tr key={x.id} className="ui-row-click" onClick={() => setOpenId(x.id)}>
                    <td className="ui-col-id">{x.number}</td>
                    <td className="ui-col-entity">
                      {x.employee?.name || 'Unknown'}
                      {x.employee?.code ? <span className="ui-caption"> · {x.employee.code}</span> : null}
                    </td>
                    <td className="ui-col-meta">{x.period?.name || '—'}</td>
                    <td className="ui-num">{money(x.grossEarnings)}</td>
                    <td className="ui-num">{money(x.totalDeductions)}</td>
                    <td className="ui-num font-medium">{money(x.netPay)}</td>
                    <td className="ui-col-h-center">
                      <span className={`ui-pill ${isPaid(x) ? 'ui-pill-pos' : 'ui-pill-neutral'}`}>{isPaid(x) ? 'Paid' : 'Unpaid'}</span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      <Drawer
        open={Boolean(openId)}
        onClose={() => setOpenId(null)}
        title="Payslip"
        description="As it was calculated, with the reasoning behind each figure."
        widthClass="w-[min(46rem,96vw)]"
      >
        {openId ? <SlipDocument slipId={openId} /> : null}
      </Drawer>
    </DocumentListShell>
  );
}

const SlipDocument = ({ slipId }) => {
  const [slip, setSlip] = useState(null);
  const [ytd, setYtd] = useState(null);
  const [explaining, setExplaining] = useState(null);

  useEffect(() => {
    let alive = true;
    getSalarySlip(slipId)
      .then((s) => alive && setSlip(s))
      .catch((e) => alive && notify.error(String(e?.message || 'Could not open that payslip.')));
    getSlipYearToDate(slipId)
      .then((y) => alive && setYtd(y))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [slipId]);

  if (!slip) return <SkeletonCard lines={5} />;

  const trace = (code) => slip.calculation.find((t) => t.code === code) || null;

  return (
    <div className="space-y-4">
      {/* Who, and for when. A payslip is identified by the person and the
          period before it is read as a set of numbers. */}
      <section className="space-y-1">
        <div className="flex items-baseline justify-between gap-3">
          <h3 className="ui-t-sec">{slip.employee.name}</h3>
          <span className="ui-col-id">{slip.number}</span>
        </div>
        <p className="ui-caption">
          {[slip.employee.designation, slip.employee.department].filter(Boolean).join(' · ') || '—'}
        </p>
        <p className="ui-caption">
          {slip.period?.name || ''} · paid {shownDate(slip.payrollDate)} · {slip.days.payableDays} of{' '}
          {slip.days.periodDays} days
        </p>
      </section>

      <Section title="Earnings" lines={slip.earnings} trace={trace} onExplain={setExplaining} />
      {slip.deductions.length ? (
        <Section title="Deductions" lines={slip.deductions} trace={trace} onExplain={setExplaining} />
      ) : null}
      <DeductionNote note={slip.deductionNote} />

      <section className="space-y-1.5" style={{ borderTop: '1px solid rgb(var(--border))', paddingTop: '0.75rem' }}>
        <Row label="Gross" value={slip.grossEarnings} />
        <Row label="Total deductions" value={slip.totalDeductions} />
        <Row label="Net pay" value={slip.netPay} strong />
      </section>

      {slip.employerContributions.length ? (
        <section className="space-y-1.5">
          <div className="ui-sec-head">What the company also pays</div>
          {slip.employerContributions.map((l) => (
            <Row key={l.componentId} label={l.name} value={l.amount} muted />
          ))}
        </section>
      ) : null}

      {ytd ? (
        <section className="space-y-1.5">
          <div className="ui-sec-head">This financial year so far</div>
          <Row label={`Gross over ${ytd.payslips} payslip${ytd.payslips === 1 ? '' : 's'}`} value={ytd.grossEarnings} muted />
          <Row label="Net paid" value={ytd.netPay} muted />
        </section>
      ) : null}

      <section className="space-y-1.5">
        <div className="ui-sec-head">Paid into</div>
        <p className="ui-caption">
          {[slip.employee.bankName, slip.employee.bankAccountNumber].filter(Boolean).join(' · ') ||
            'No bank account on file'}
        </p>
        <p className="ui-caption">PAN {slip.employee.pan || 'not on file'}</p>
        {slip.employee.masked ? (
          <p className="ui-caption">Shown in part. The full details need their own permission.</p>
        ) : null}
      </section>

      <div className="flex items-center justify-end gap-2">
        <button type="button" className="ui-btn ui-btn-secondary" onClick={() => window.print()}>
          <Printer size={16} aria-hidden="true" /> Print
        </button>
      </div>

      <Drawer
        open={Boolean(explaining)}
        onClose={() => setExplaining(null)}
        title={explaining ? `How ${explaining.name} was worked out` : ''}
        description="The base it started from, the rule applied, and anything that changed it."
      >
        {explaining ? <Explanation line={explaining} trace={trace(explaining.code)} slip={slip} /> : null}
      </Drawer>
    </div>
  );
};

/** What this payslip could not take and moved to next month: nothing is dropped, and it says so. */
export const DeductionNote = ({ note }) => {
  if (!note?.carried?.length) return null;
  return (
    <section className="space-y-1.5" aria-label="Deductions moved to next month">
      <div className="ui-sec-head">Moved to next month</div>
      {note.carried.map((c) => (
        <Row key={c.label} label={c.label} value={c.amount} muted />
      ))}
      <p className="ui-caption">
        {note.reason === 'LIMIT'
          ? `Deductions are held to ${note.percent}% of wages: ${money(note.limit)} of ${money(note.wages)} this month. The rest comes off next month's payslip.`
          : 'This payslip had nothing left to take it from. The rest comes off next month’s payslip.'}
      </p>
    </section>
  );
};

const Section = ({ title, lines, trace, onExplain }) => (
  <section className="space-y-1.5">
    <div className="ui-sec-head">{title}</div>
    {lines.map((l) => {
      const t = trace(l.code);
      return (
        <div key={`${l.componentId}:${l.name}`} className="flex items-baseline justify-between gap-3">
          <span className="min-w-0">
            {/* Every figure is a way in to how it was reached. */}
            <button
              type="button"
              className="ui-link text-sm text-left"
              onClick={() => onExplain(l)}
              aria-label={`How ${l.name} was worked out`}
            >
              {l.name}
            </button>
            {t?.ruleText ? <span className="ui-caption block">{t.ruleText}</span> : null}
          </span>
          <span className="ui-num text-sm">{money(l.amount)}</span>
        </div>
      );
    })}
  </section>
);

const Row = ({ label, value, strong = false, muted = false }) => (
  <div className="flex items-baseline justify-between gap-3">
    <span className={strong ? 'text-sm font-medium' : muted ? 'ui-caption' : 'text-sm'}>{label}</span>
    <span className={`ui-num text-sm ${strong ? 'font-medium' : ''}`}>{money(value)}</span>
  </div>
);

/**
 * The arithmetic behind one figure, in the order it happened.
 *
 * Read from the trace the calculation stored, never recomputed here — a second
 * derivation in the browser is a second answer, and the one on screen would be
 * the one nobody could reproduce.
 */
const Explanation = ({ line, trace, slip }) => {
  if (!trace) {
    return <p className="ui-caption">No working was recorded for this line.</p>;
  }
  return (
    <div className="space-y-4">
      <section className="space-y-1.5">
        <div className="ui-sec-head">The rule</div>
        <p className="text-sm">{trace.ruleText || '—'}</p>
        {/* For a formula component the rule IS the formula, and printing it
            twice reads as a mistake. */}
        {trace.formula && trace.formula !== trace.ruleText ? (
          <p className="ui-mono text-sm">{trace.formula}</p>
        ) : null}
      </section>

      {trace.baseLabel ? (
        <section className="space-y-1.5">
          <div className="ui-sec-head">What it started from</div>
          <Row label={trace.baseLabel} value={trace.baseAmount} />
        </section>
      ) : null}

      <section className="space-y-1.5">
        <div className="ui-sec-head">Working</div>
        {trace.prorationFactor != null ? (
          <>
            <Row label="Full period" value={line.fullAmount ?? trace.computedAmount} muted />
            <p className="ui-caption">
              Reduced to {slip.days.payableDays} of {slip.days.workingDays} days —{' '}
              {(trace.prorationFactor * 100).toFixed(1)}%.
            </p>
          </>
        ) : null}
        {trace.roundingApplied ? (
          <Row label="Rounding" value={trace.roundingApplied} muted />
        ) : null}
        <Row label="Paid" value={trace.computedAmount} strong />
      </section>

      {trace.statutoryRuleVersion ? (
        <p className="ui-caption">Worked out under statutory rule version {trace.statutoryRuleVersion}.</p>
      ) : null}

      <p className="ui-caption">
        Calculated by payroll engine {slip.engineVersion || 'unknown'}. The same inputs always produce the same figure, so
        this payslip can be reproduced exactly.
      </p>
    </div>
  );
};
