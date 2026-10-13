import React, { useCallback, useEffect, useState } from 'react';
import { Printer } from 'lucide-react';

import { PageHeader, SkeletonCard, EmptyState } from '@ui/components/ui/Primitives';
import Drawer from '@ui/components/ui/Drawer';
import { notify } from '@ui/components/ui/notify';
import { listSalarySlips, getSalarySlip, getSlipYearToDate } from '../api/payrollSlips';

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

export default function SalarySlips() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [openId, setOpenId] = useState(null);

  const load = useCallback(async () => {
    try {
      setRows(await listSalarySlips());
      setError('');
    } catch (e) {
      setError(String(e?.message || 'Could not load payslips.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) return <SkeletonCard lines={6} />;

  return (
    <div className="space-y-6">
      <PageHeader
        entity="settings"
        title="Salary slips"
        description="Every payslip produced, and how each figure on it was reached."
      />

      {error ? (
        <div className="ui-card p-3 text-sm" role="alert" style={{ borderColor: 'rgb(var(--neg))', color: 'rgb(var(--neg))' }}>
          {error}
        </div>
      ) : null}

      {rows.length === 0 ? (
        <EmptyState
          title="No payslips yet"
          description="Payslips appear here once a payroll has been calculated. Start one under Payroll → Pay runs."
        />
      ) : (
        <div className="ui-card overflow-hidden">
          <div className="overflow-x-auto ui-table-scroll">
            <table className="ui-table w-full">
              <thead>
                <tr>
                  <th scope="col" className="ui-th">Payslip</th>
                  <th scope="col" className="ui-th">Employee</th>
                  <th scope="col" className="ui-th">Period</th>
                  <th scope="col" className="ui-th ui-col-h-right">Gross</th>
                  <th scope="col" className="ui-th ui-col-h-right">Deductions</th>
                  <th scope="col" className="ui-th ui-col-h-right">Net pay</th>
                  <th scope="col" className="ui-th ui-col-h-center">Payment</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((s) => (
                  <tr key={s.id} className="ui-row-click" onClick={() => setOpenId(s.id)}>
                    <td className="ui-col-id">{s.number}</td>
                    <td className="ui-col-entity">
                      {s.employee?.name || 'Unknown'}
                      {s.employee?.code ? <span className="ui-caption block">{s.employee.code}</span> : null}
                    </td>
                    <td className="ui-col-meta">{s.period?.name || '—'}</td>
                    <td className="ui-col-amount">{money(s.grossEarnings)}</td>
                    <td className="ui-col-amount">{money(s.totalDeductions)}</td>
                    <td className="ui-col-amount font-medium">{money(s.netPay)}</td>
                    <td>
                      <span className={`ui-pill ${s.paymentStatus === 'PAID' ? 'ui-pill-pos' : 'ui-pill-neutral'}`}>
                        {s.paymentStatus === 'PAID' ? 'Paid' : 'Unpaid'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <Drawer
        open={Boolean(openId)}
        onClose={() => setOpenId(null)}
        title="Payslip"
        description="As it was calculated, with the reasoning behind each figure."
        widthClass="w-[min(46rem,52vw)]"
      >
        {openId ? <SlipDocument slipId={openId} /> : null}
      </Drawer>
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
    <div className="space-y-6">
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

const Section = ({ title, lines, trace, onExplain }) => (
  <section className="space-y-1.5">
    <div className="ui-sec-head">{title}</div>
    {lines.map((l) => {
      const t = trace(l.code);
      return (
        <div key={l.componentId} className="flex items-baseline justify-between gap-3">
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
    <div className="space-y-6">
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
