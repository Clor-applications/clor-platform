import React, { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, ArrowRight } from 'lucide-react';

import { PageHeader, SkeletonCard, EmptyState } from '@ui/components/ui/Primitives';
import { getPayrollOverview } from '../api/payrollOverview';
import { getPayrollSetup } from '../api/payrollSetup';

/**
 * Where payroll is this month, and what is in the way.
 *
 * Built around one question rather than a set of numbers. A payroll manager on
 * the first of the month wants to know whether this month can be run, what is
 * stopping it, and whether the figure looks like last month's — so this month
 * comes first, the blockers come second in the order somebody would act on
 * them, and the history is underneath for comparison rather than decoration.
 *
 * Nothing here is a control. An overview that also lets you approve things is
 * an overview somebody acts on without having opened the thing they are
 * approving, so every card is a way in to the screen that owns the decision.
 */

const money = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;

const shownDate = (iso) => {
  const s = String(iso || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return '—';
  const [y, m, d] = s.split('-');
  return `${d}/${m}/${y}`;
};

const percentChange = (from, to) => {
  const a = Number(from || 0);
  const b = Number(to || 0);
  if (!a) return null;
  return Math.round(((b - a) / a) * 1000) / 10;
};

export default function PayrollOverview({ onOpen = () => {} }) {
  const [overview, setOverview] = useState(null);
  const [setup, setSetup] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const [state, readiness] = await Promise.all([
        getPayrollOverview(),
        /* Setup is a nicety here, not a dependency: an overview that fails to
           load because a checklist could not be fetched is worse than one
           without the checklist. */
        getPayrollSetup().catch(() => null),
      ]);
      setOverview(state);
      setSetup(readiness);
      setError('');
    } catch (e) {
      setError(String(e?.message || 'Could not load payroll.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) return <SkeletonCard lines={6} />;

  if (error) {
    return (
      <div className="space-y-6">
        <PageHeader entity="settings" title="Payroll" description="Where this month is, and what is in the way." />
        <div className="ui-card p-3 text-sm" role="alert" style={{ borderColor: 'rgb(var(--neg))', color: 'rgb(var(--neg))' }}>
          {error}
        </div>
      </div>
    );
  }

  if (!overview) return null;

  const { currentPeriod, currentRun, people, previous, latest, trend, pending, blockers } = overview;
  const change = previous && latest ? percentChange(previous.employerCost, latest.employerCost) : null;

  return (
    <div className="space-y-6">
      <PageHeader
        entity="settings"
        title="Payroll"
        description={
          currentPeriod
            ? `${currentPeriod.name} · ${shownDate(currentPeriod.startDate)} to ${shownDate(currentPeriod.endDate)}${
                currentPeriod.paymentDate ? ` · paid on ${shownDate(currentPeriod.paymentDate)}` : ''
              }`
            : 'No open payroll period.'
        }
        actions={
          <button type="button" className="ui-btn ui-btn-primary" onClick={() => onOpen('payrollRuns')}>
            {currentRun ? 'Open this payroll' : 'Run payroll'} <ArrowRight size={16} aria-hidden="true" />
          </button>
        }
      />

      {/*
        * Setup comes before anything else while it is unfinished.
        *
        * A company halfway through setting payroll up lands here and sees an
        * overview of nothing, with no indication that the emptiness is because
        * three steps are outstanding rather than because nobody has been paid
        * yet. Those are very different problems and the screen should not make
        * them look alike.
        */}
      {setup && !setup.ready ? (
        <div className="ui-card p-4 flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="ui-sec-head">Payroll is not ready to run yet</div>
            <p className="ui-caption">
              {setup.done} of {setup.total} steps done
              {setup.nextStep ? ` · next: ${setup.nextStep.title} — ${setup.nextStep.detail}` : ''}
            </p>
          </div>
          <button type="button" className="ui-btn ui-btn-primary shrink-0" onClick={() => onOpen('payrollSetup')}>
            Finish setting up <ArrowRight size={16} aria-hidden="true" />
          </button>
        </div>
      ) : null}

      {!currentPeriod ? (
        <EmptyState
          title="No open payroll period"
          description="Payroll runs for a month. Add one under Settings → Payroll → Payroll periods and this month has something to run for."
        />
      ) : null}

      {/* This month, first, because it is the question. */}
      {currentRun ? (
        <div className="ui-card overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3" style={{ borderBottom: '1px solid rgb(var(--border))' }}>
            <div className="flex items-center gap-2">
              <div className="ui-sec-head">{currentRun.number}</div>
              <span className={`ui-pill ${['PAID', 'POSTED'].includes(currentRun.status) ? 'ui-pill-pos' : 'ui-pill-neutral'}`}>
                {currentRun.stage}
              </span>
            </div>
            <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={() => onOpen('payrollRuns')}>
              Open
            </button>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 divide-x" style={{ borderColor: 'rgb(var(--border))' }}>
            <Cell label="People" value={String(currentRun.employeeCount)} />
            <Cell label="Gross" value={money(currentRun.gross)} />
            <Cell label="Take-home" value={money(currentRun.net)} />
            <Cell label="Company pays" value={money(currentRun.employerCost)} />
          </div>
        </div>
      ) : currentPeriod ? (
        <div className="ui-card p-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="ui-sec-head">{currentPeriod.name} has not been run</div>
            <p className="ui-caption">
              {people.inPayroll} {people.inPayroll === 1 ? 'person is' : 'people are'} in payroll and waiting to be paid.
            </p>
          </div>
          <button type="button" className="ui-btn ui-btn-primary" onClick={() => onOpen('payrollRuns')}>
            Run payroll
          </button>
        </div>
      ) : null}

      {/* What is in the way, in the order somebody would act on it. */}
      {blockers.length ? (
        <div className="ui-card overflow-hidden">
          <div className="px-4 py-3 ui-sec-head" style={{ borderBottom: '1px solid rgb(var(--border))' }}>
            Worth dealing with first
          </div>
          <ul className="divide-y" style={{ borderColor: 'rgb(var(--border))' }}>
            {blockers.map((b) => (
              <li key={b.code} className="px-4 py-3 flex items-start gap-2">
                <AlertTriangle size={15} aria-hidden="true" className="mt-0.5 shrink-0" style={{ color: 'rgb(var(--warn-ink))' }} />
                <span className="text-sm">{b.message}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Figure label="In payroll" value={String(people.inPayroll)} hint={`of ${people.headcount} on the books`} />
        <Figure
          label="Approved one-offs"
          value={String(pending.adjustments)}
          hint={pending.adjustmentValue ? `${pending.adjustmentValue > 0 ? '+' : '−'}${money(Math.abs(pending.adjustmentValue))}` : 'nothing pending'}
        />
        <Figure label="Loans running" value={String(pending.loans)} hint={pending.loanOutstanding ? `${money(pending.loanOutstanding)} owed` : 'nothing owed'} />
        <Figure label="Revisions open" value={String(pending.revisions)} hint={pending.revisions ? 'not yet in effect' : 'none waiting'} />
      </div>

      {trend.length ? (
        <div className="ui-card overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3" style={{ borderBottom: '1px solid rgb(var(--border))' }}>
            <div className="ui-sec-head">What payroll has cost</div>
            {change != null ? (
              <span className="ui-caption">
                {change > 0 ? 'Up' : change < 0 ? 'Down' : 'Level'} {change !== 0 ? `${Math.abs(change)}% ` : ''}on the month before
              </span>
            ) : null}
          </div>
          <div className="overflow-x-auto ui-table-scroll">
            <table className="ui-table w-full">
              <thead>
                <tr>
                  <th scope="col" className="ui-th">Payroll</th>
                  <th scope="col" className="ui-th">Month</th>
                  <th scope="col" className="ui-th ui-col-h-center">Paid on</th>
                  <th scope="col" className="ui-th ui-col-h-right">People</th>
                  <th scope="col" className="ui-th ui-col-h-right">Gross</th>
                  <th scope="col" className="ui-th ui-col-h-right">Take-home</th>
                  <th scope="col" className="ui-th ui-col-h-right">Company pays</th>
                </tr>
              </thead>
              <tbody>
                {[...trend].reverse().map((t) => (
                  <tr key={t.runId}>
                    <td className="ui-col-id">{t.number}</td>
                    <td className="ui-col-entity">{t.periodName || '—'}</td>
                    <td className="ui-col-date ui-col-h-center">{shownDate(t.payrollDate)}</td>
                    <td className="ui-col-amount">{t.employeeCount}</td>
                    <td className="ui-col-amount">{money(t.gross)}</td>
                    <td className="ui-col-amount">{money(t.net)}</td>
                    <td className="ui-col-amount">{money(t.employerCost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}
    </div>
  );
}

const Cell = ({ label, value }) => (
  <div className="px-4 py-3">
    <div className="ui-caption">{label}</div>
    <div className="ui-amount mt-0.5">{value}</div>
  </div>
);

const Figure = ({ label, value, hint }) => (
  <div className="ui-card p-3">
    <div className="ui-caption">{label}</div>
    <div className="ui-amount mt-0.5">{value}</div>
    {hint ? <div className="ui-caption">{hint}</div> : null}
  </div>
);
