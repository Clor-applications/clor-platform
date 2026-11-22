import React, { useCallback, useEffect, useState } from 'react';
import LoadFailed from '@ui/components/ui/LoadFailed';
import { AlertTriangle, ArrowRight } from '@ui/components/ui/lineIcons';

import { PageHeader, SkeletonCard, EmptyState } from '@ui/components/ui/Primitives';
import { getPayrollOverview } from '../api/payrollOverview';
import { getPayrollSetup } from '../api/payrollSetup';
import { rupees as money, moneyCell } from '@ui/utils/money';
import PayCalendarStrip from '../components/PayCalendarStrip';
import { todayIst, dateWords } from '@ui/utils/dates';
import StatutoryDues from '../components/StatutoryDues';
import { MonthTodo } from '../components/round59';
import { MinimumWageReminder } from '../components/MinimumWagesSection';
import { errorWords } from '@ui/utils/errorWords';
import { FormPart } from '@ui/components/ui/FormPart';
import { Figures } from '../components/Figure';
import Notice from '../components/Notice';
import { ViewSwitch } from '@ui/components/ui/FigureViews';

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



const MAX_MONTHS = 12;
const monthOf = (t) => (t.payrollDate ? new Date(`${String(t.payrollDate).slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-IN', { month: 'short', timeZone: 'UTC' }) : String(t.periodName || t.number).slice(0, 3));

/**
 * What payroll has cost, as one figure with four views (owner, 22 Nov 2026, style H):
 * company pays, gross, net pay and people, each the newest run's, its history as columns.
 */
export function costViews(trend) {
  const runs = trend.slice(-MAX_MONTHS);
  const last = runs[runs.length - 1];
  const before = runs[runs.length - 2];
  if (!last) return [];
  const note = (k) => {
    const c = before ? percentChange(before[k], last[k]) : null;
    return c == null ? `${last.periodName || last.number}` : `${c > 0 ? 'Up' : c < 0 ? 'Down' : 'Level'}${c ? ` ${Math.abs(c)}%` : ''} on ${before.periodName || before.number}`;
  };
  const view = (key, label, fmt) => ({
    key,
    label,
    value: fmt(last[key]),
    note: note(key),
    points: runs.map((t) => ({ key: t.runId, label: monthOf(t), value: Number(t[key]) || 0, words: fmt(t[key]) })),
  });
  return [
    view('employerCost', 'Company pays', (v) => money(v)),
    view('gross', 'Gross', (v) => money(v)),
    view('net', 'Net pay', (v) => money(v)),
    view('employeeCount', 'People', (v) => `${Number(v) || 0} ${Number(v) === 1 ? 'person' : 'people'}`),
  ];
}

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
      setError(errorWords(e, 'load Payroll'));
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
      <div className="space-y-3">
        <PageHeader entity="payroll" title="Overview" description="Where this month is, and what is in the way." />
        <div className="px-5 lg:px-7 pb-8 space-y-4">
        <LoadFailed message={error} onRetry={load} />
        </div>
      </div>
    );
  }

  if (!overview) return null;

  const { currentPeriod, currentRun, people, previous, latest, trend, pending, blockers } = overview;
  const change = previous && latest ? percentChange(previous.employerCost, latest.employerCost) : null;
  /* While setup is unfinished, finishing it is the one thing to do here (UX-13):
     a "Run payroll" that cannot run is not offered as the main action. */
  const notReady = Boolean(setup && !setup.ready);

  return (
    <div className="space-y-3">
      <PageHeader
        entity="payroll"
        title="Overview"
        description={
          currentPeriod
            ? `${currentPeriod.name} · ${dateWords(currentPeriod.startDate)} to ${dateWords(currentPeriod.endDate)}${
                currentPeriod.paymentDate ? ` · paid on ${dateWords(currentPeriod.paymentDate)}` : ''
              }`
            : 'No open period in the pay calendar.'
        }
        /* The month's other figures as one count line, not four cards shown even at zero (DESIGN.md "Page header";
           design audit step 2). */
        counts={[
          { key: 'people', label: `in payroll, of ${people.headcount} on the books`, value: people.inPayroll },
          {
            key: 'oneoffs',
            label: `approved one-offs${pending.adjustmentValue ? ` (${pending.adjustmentValue > 0 ? '+' : '\u2212'}${money(Math.abs(pending.adjustmentValue))})` : ''}`,
            value: pending.adjustments,
          },
          { key: 'loans', label: `${pending.loans === 1 ? 'loan' : 'loans'} running${pending.loanOutstanding ? ` (${money(pending.loanOutstanding)} owed)` : ''}`, value: pending.loans },
          { key: 'revisions', label: `${pending.revisions === 1 ? 'revision' : 'revisions'} not yet in effect`, value: pending.revisions },
        ]}
        actions={
          notReady && !currentRun ? (
            <button type="button" className="ui-btn ui-btn-primary !ps-4 !pe-3.5" onClick={() => onOpen('payrollSetup')}>
              Finish setting up <ArrowRight size={16} aria-hidden="true" />
            </button>
          ) : (
            <button type="button" className="ui-btn ui-btn-primary !ps-4 !pe-3.5" onClick={() => onOpen('payrollRuns')}>
              {currentRun ? 'Open this payroll' : 'Run payroll'} <ArrowRight size={16} aria-hidden="true" />
            </button>
          )
        }
      />
      <div className="px-5 lg:px-7 pb-8 space-y-4">
      {currentPeriod ? <PayCalendarStrip period={currentPeriod} run={currentRun} /> : null}
      {/* Round 66: minimum wage rates due for their April or October revision. */}
      <MinimumWageReminder />

      {/*
        * Setup comes before anything else while it is unfinished.
        *
        * A company halfway through setting payroll up lands here and sees an
        * overview of nothing, with no indication that the emptiness is because
        * three steps are outstanding rather than because nobody has been paid
        * yet. Those are very different problems and the screen should not make
        * them look alike.
        */}
      {notReady ? (
        <Notice
          tone="warn"
          word="Not ready to run"
          action={
            /* The header's primary already says "Finish setting up" unless a run is open: one button for one job. */
            currentRun ? (
              <button type="button" className="ui-btn ui-btn-secondary shrink-0 !ps-4 !pe-3.5" onClick={() => onOpen('payrollSetup')}>
                Finish setting up <ArrowRight size={16} aria-hidden="true" />
              </button>
            ) : null
          }
        >
          {setup.done} of {setup.total} setup steps done
          {setup.nextStep ? ` · next: ${setup.nextStep.title}: ${setup.nextStep.detail}` : ''}
        </Notice>
      ) : null}

      {/* While setup is unfinished the strip above already says what is next; a second "No open payroll
          period" picture under it only repeated the header. */}
      {!currentPeriod && !notReady ? (
        <EmptyState
          title="No open period in the pay calendar"
          description="A pay run is for a month. Add one under Settings → Pay calendar."
          describe
          action={
            <button type="button" className="ui-btn ui-btn-primary" onClick={() => onOpen('periods')}>
              Open Pay calendar
            </button>
          }
        />
      ) : null}

      {/* This month, first, because it is the question. */}
      {currentRun ? (
        /* A heading over a rule, not a box; the stage is said in words, not a tag (it is never an exception). */
        <FormPart
          id="this-month"
          title={currentRun.number}
          description={currentRun.stage}
          action={
            <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={() => onOpen('payrollRuns')}>
              Open
            </button>
          }
        >
          <Figures
            label="This month's payroll"
            items={[
              { label: 'People', value: String(currentRun.employeeCount), raw: currentRun.employeeCount },
              { label: 'Gross', value: moneyCell(currentRun.gross, { zero: true }), raw: currentRun.gross },
              { label: 'Net pay', value: moneyCell(currentRun.net, { zero: true }), raw: currentRun.net },
              { label: 'Company pays', value: moneyCell(currentRun.employerCost, { zero: true }), raw: currentRun.employerCost },
            ]}
          />
        </FormPart>
      ) : currentPeriod ? (
        <FormPart
          id="this-month"
          title={`${currentPeriod.name} has not been run`}
          description={`${people.inPayroll} ${people.inPayroll === 1 ? 'person is' : 'people are'} in payroll and waiting to be paid.${notReady ? ' It can run once setup is finished.' : ''}`}
          action={
            /* The header carries the main action; this one only repeats it, quietly. */
            <button
              type="button"
              className="ui-btn ui-btn-secondary"
              onClick={() => onOpen('payrollRuns')}
              disabled={notReady}
              title={notReady ? 'Finish setting up payroll first' : undefined}
            >
              Run payroll
            </button>
          }
        />
      ) : null}

      {/* Round 59 monthflow C: the month as a short to-do list. */}
      <MonthTodo period={currentPeriod} run={currentRun} onOpen={onOpen} />

      {/* What is in the way, in the order somebody would act on it. */}
      {blockers.length ? (
        <div className="ui-list-surface ui-urgent overflow-hidden" data-tone="warn">
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


      {trend.length ? (
        <div className="ui-list-surface overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3" style={{ borderBottom: '1px solid rgb(var(--border))' }}>
            <div className="ui-sec-head">What payroll has cost</div>
            {change != null ? (
              <span className="ui-caption">
                {change > 0 ? 'Up' : change < 0 ? 'Down' : 'Level'} {change !== 0 ? `${Math.abs(change)}% ` : ''}on the month before
              </span>
            ) : null}
          </div>
          <ViewSwitch label="Show" views={costViews(trend)} />
          <div className="ui-table-scroll">
            <table className="ui-table ui-table-sticky ui-table-phone w-full">
              <thead>
                <tr>
                  <th scope="col">Payroll</th>
                  <th scope="col">Month</th>
                  <th scope="col" className="ui-col-h-center">Paid on</th>
                  <th scope="col" className="ui-col-h-right">People</th>
                  <th scope="col" className="ui-col-h-right">Gross</th>
                  <th scope="col" className="ui-col-h-right">Net pay</th>
                  <th scope="col" className="ui-col-h-right">Company pays</th>
                </tr>
              </thead>
              <tbody className="ui-rows">
                {[...trend].reverse().map((t) => (
                  <tr key={t.runId}>
                    <td className="ui-col-id" data-phone="sub">{t.number}</td>
                    <td className="ui-col-entity" data-phone="name">{t.periodName || '—'}</td>
                    <td className="ui-col-date ui-col-h-center">{dateWords(t.payrollDate)}</td>
                    <td className="ui-col-amount">{t.employeeCount}</td>
                    <td className="ui-col-amount">{moneyCell(t.gross)}</td>
                    <td className="ui-col-amount" data-phone="key">{moneyCell(t.net)}</td>
                    <td className="ui-col-amount">{moneyCell(t.employerCost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {/* Round 50 pick "duecalendar" B: the next five statutory dues, under the month's work. */}
      <StatutoryDues today={todayIst()} />
      </div>
    </div>
  );
}

