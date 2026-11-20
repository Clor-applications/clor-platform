import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ExceptionTag } from '@ui/components/ui/ExceptionTag';
import { shownLines } from '@ui/picks/round60';
import { FileText, Printer } from '@ui/components/ui/lineIcons';

import { ColumnHeader, useColumnFilters } from '@ui/components/ColumnFilters';
import { useListSearch } from '@ui/components/ListToolbar';
import DocumentListShell from '@ui/components/list/DocumentListShell';
import { exportFormatFromKey, exportMenuItem, runListExport } from '@ui/components/list/exportMenu';
import { SkeletonCard, EmptyState } from '@ui/components/ui/Primitives';
import Drawer from '@ui/components/ui/Drawer';
import { notify } from '@ui/components/ui/notify';
import { listSalarySlips, getSalarySlip, getSlipYearToDate } from '../api/payrollSlips';
import LoadFailed from '@ui/components/ui/LoadFailed';
import DraftStrip from '../components/DraftStrip';
import { SPLIT_NOTE, SPLIT_TITLE, countWords, splitLines } from '@ui/picks/payLines';
import { errorWords } from '@ui/utils/errorWords';
import { countItems } from '../components/countItems';
import { dateWords } from '@ui/utils/dates';
import { moneyCell } from '@ui/utils/money';

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


const TABS = [
  { value: '', label: 'All', tone: 'all' },
  { value: 'UNPAID', label: 'Unpaid', tone: 'outstanding' },
  { value: 'PAID', label: 'Paid', tone: 'paid' },
];
const COLUMNS = {
  employee: (s) => s.employee?.name || 'Name missing',
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
      .catch((e) => setError(errorWords(e, 'load payslips')));
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
    <div className="ui-touch-44">
    <DocumentListShell
      entity="payslip"
      title="Payslips"
      description="Every payslip produced, and how each figure on it was reached."
      compact
      tight
      search={{ value: search.query, onChange: search.setQuery, placeholder: 'Search payslips…', label: 'Search payslips' }}
      moreItems={all?.length ? [exportMenuItem('Export payslips')] : null}
      onMoreSelect={(k) => {
        const format = exportFormatFromKey(k);
        if (!format) return;
        runListExport({ format, title: 'Payslips', fileName: 'Payslips', label: 'payslip/payslips', columns: EXPORT_COLUMNS, rows });
      }}
      countLine={countItems([
        { label: 'Gross', value: figures.gross, tone: 'sent' },
        { label: 'Deductions', value: figures.deductions, tone: 'partial' },
        { label: 'Net pay', value: figures.net, tone: 'paid' },
        { label: 'Net still unpaid', value: figures.unpaid, tone: 'outstanding', onSelect: () => setStatus('UNPAID') },
      ])}
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
          <table className="ui-table ui-table-sticky ui-table-phone w-full">
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
                    <td className="ui-col-entity" data-phone="name">
                      {x.employee?.name || 'Name missing'}
                      {x.employee?.code ? <span className="ui-caption"> · {x.employee.code}</span> : null}
                    </td>
                    <td className="ui-col-meta" data-phone="sub">{x.period?.name || '—'}{x.extraPayRun ? <span className="ui-caption"> · Extra pay run</span> : null}</td>
                    <td className="ui-num">{moneyCell(x.grossEarnings)}</td>
                    <td className="ui-num">{moneyCell(x.totalDeductions)}</td>
                    <td className="ui-num" data-phone="key">{moneyCell(x.netPay)}</td>
                    <td className="ui-col-h-center" data-phone="tag">
                      <ExceptionTag label={isPaid(x) ? '' : 'Unpaid'} normal="Paid" />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
            {/* The register's total (DESIGN.md "Tables": a total row is bold over a rule), over the rows shown. */}
            {rows.length > 1 ? (
              <tfoot>
                <tr className="ui-table-total">
                  <th scope="row" colSpan={3} data-phone="name">Total, {rows.length} payslips</th>
                  <td className="ui-num">{moneyCell(rows.reduce((a, x) => a + Number(x.grossEarnings || 0), 0))}</td>
                  <td className="ui-num">{moneyCell(rows.reduce((a, x) => a + Number(x.totalDeductions || 0), 0))}</td>
                  <td className="ui-num" data-phone="key">{moneyCell(rows.reduce((a, x) => a + Number(x.netPay || 0), 0))}</td>
                  <td />
                </tr>
              </tfoot>
            ) : null}
          </table>
        </div>
      )}

      <Drawer
        open={Boolean(openId)}
        onClose={() => setOpenId(null)}
        title="Payslip"
        description="As it was calculated, with the reasoning behind each figure."
        widthClass="w-[min(46rem,96vw)] ui-touch-44"
      >
        {openId ? <SlipDocument slipId={openId} /> : null}
      </Drawer>
    </DocumentListShell>
    </div>
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
      .catch((e) => alive && notify.error(errorWords(e, 'open that payslip')));
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
      <DraftStrip slip={slip} />
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
          {slip.period?.name || ''} · paid {dateWords(slip.payrollDate)}
          {/* An extra only (a bonus, arrears) paid no days: the month's salary did. */}
          {slip.extraPayRun && !slip.days.workingDays ? ' · Extra pay run' : <>{slip.extraPayRun ? ' · Extra pay run' : ''} · {slip.days.payableDays} of {slip.days.periodDays} days</>}
        </p>
      </section>

      {splitLines(slip.ctc?.split).length ? (
        <section className="space-y-1" aria-label={SPLIT_TITLE}>
          <div className="ui-sec-head">{SPLIT_TITLE}</div>
          {splitLines(slip.ctc.split).map((t) => <p key={t} className="text-sm tabular-nums">{t}</p>)}
          <p className="ui-caption">{SPLIT_NOTE}</p>
        </section>
      ) : null}
      <Section title="Earnings" lines={slip.earnings} trace={trace} onExplain={setExplaining} />
      {slip.deductions.length ? (
        <Section title="Deductions" lines={slip.deductions} trace={trace} onExplain={setExplaining} />
      ) : null}
      <DeductionNote note={slip.deductionNote} leaving={Boolean(slip.employee?.dateOfLeaving && slip.period?.endDate && String(slip.employee.dateOfLeaving).slice(0, 10) <= slip.period.endDate)} />

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
export const DeductionNote = ({ note, leaving = false }) => {
  /* Somebody leaving has no next payslip: what is left goes to their full and final (QA retest of #82). */
  const rest = leaving ? 'The rest goes to their full and final settlement.' : "The rest comes off next month's payslip.";
  if (!note?.carried?.length) return null;
  return (
    <section className="space-y-1.5" aria-label={leaving ? 'Deductions left for the full and final' : 'Deductions moved to next month'}>
      <div className="ui-sec-head">{leaving ? 'Left for the full and final' : 'Moved to next month'}</div>
      {note.carried.map((c) => (
        <Row key={c.label} label={c.label} value={c.amount} muted />
      ))}
      <p className="ui-caption">
        {note.reason !== 'LIMIT'
          ? `This payslip had nothing left to take it from. ${rest}`
          : Number(note.counted) > Number(note.limit)
            /* PF, tax and entered deductions are taken as they are and can pass the share alone; then no instalment fits (QA of #82, F6). */
            ? `Instalments may take up to ${note.percent}% of wages (${money(note.limit)} of ${money(note.wages)}), and other deductions already came to ${money(note.counted)}, so none was taken this month. ${leaving ? 'It goes to their full and final settlement.' : "It comes off next month's payslip."}`
            : `Instalments may take up to ${note.percent}% of wages (${money(note.limit)} of ${money(note.wages)}), counting other deductions. ${rest}`}
      </p>
    </section>
  );
};

const Section = ({ title, lines, trace, onExplain }) => (
  <section className="space-y-1.5">
    <div className="ui-sec-head">{title}</div>
    {/* Round 60 zerorows A: a line of ₹0 this month (no overtime, no bonus) is left out. */}
    {shownLines(lines).map((l) => {
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
            {countWords(l) ? <span className="ui-caption block tabular-nums">{countWords(l)}</span> : null}
          </span>
          <span className="ui-num text-sm">{money(l.amount)}</span>
        </div>
      );
    })}
  </section>
);

const Row = ({ label, value, strong = false, muted = false }) => (
  <div className="flex items-baseline justify-between gap-3">
    <span className={strong ? 'text-sm font-semibold' : muted ? 'ui-caption' : 'text-sm'}>{label}</span>
    <span className={`ui-num text-sm ${strong ? 'font-semibold' : ''}`}>{money(value)}</span>
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

      <p className="ui-caption">
        Calculated with the statutory rates in force for this month. The same figures always give the same result, so
        this payslip can be produced again exactly.
      </p>
    </div>
  );
};
