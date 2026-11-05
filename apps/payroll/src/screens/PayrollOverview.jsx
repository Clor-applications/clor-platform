import React, { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, ArrowRight, Check, HandCoins, Receipt, TrendingUp, Users } from 'lucide-react';

import { PageHeader, SkeletonCard, EmptyState } from '@ui/components/ui/Primitives';
import { getPayrollOverview } from '../api/payrollOverview';
import { getPayrollSetup } from '../api/payrollSetup';
import { wholeRupees as money } from '@ui/utils/money';

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
 *
 * Below the month, the four things a payroll month is made of, each from its
 * own rows: salaries and payslips, the bank payouts, full and final
 * settlements, and the statutory returns. A return shows what it would carry
 * and who it would leave out — never "filed", since CLOR keeps no record of
 * filing yet.
 */

/* The run, as the steps it goes through. How many are behind it, by status. */
const RUN_STEPS = ['Calculated', 'Checked', 'Approved', 'Paid', 'In the books'];
const STEPS_DONE = { DRAFT: 0, CALCULATED: 1, REVIEW: 1, APPROVED: 3, LOCKED: 3, PAID: 4, POSTED: 5 };

/* Where each thing in the way is dealt with, named for the screen it opens. */
const FIX_IN = {
  NO_OPEN_PERIOD: ['periods', 'Pay calendar'],
  PEOPLE_WITHOUT_SALARY: ['assignments', 'Salary assignments'],
  ADJUSTMENTS_UNAPPROVED: ['adjustments', 'Adjustments'],
  REVISIONS_NOT_APPLIED: ['revisions', 'Salary revisions'],
  RUN_NOT_POSTED: ['runs', 'Pay runs'],
  PAYOUTS_FAILED: ['payments', 'Payments'],
  BANK_CHANGES_PENDING: ['bankChanges', 'Bank changes'],
  SETTLEMENTS_OVERDUE: ['settlements', 'Full & final'],
  FILING_GAPS_PF: ['reports', 'Returns to file'],
  FILING_GAPS_ESI: ['reports', 'Returns to file'],
  FILING_GAPS_PT: ['reports', 'Returns to file'],
  FILING_GAPS_TDS: ['taxDeclarations', 'Tax declarations'],
};


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

/* `openScreen` is the shell's way to another Payroll screen, by its manifest key. */
export default function PayrollOverview({ openScreen = () => {} }) {
  const onOpen = (key, params) => openScreen(key, params);
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
      <div className="space-y-3">
        <PageHeader entity="payroll" title="Payroll" description="Where this month is, and what is in the way." />
        <div className="px-5 lg:px-7 pb-8 space-y-4">
        <div className="ui-card p-3 text-sm" role="alert" style={{ borderColor: 'rgb(var(--neg))', color: 'rgb(var(--neg))' }}>
          {error}
        </div>
        </div>
      </div>
    );
  }

  if (!overview) return null;

  const { currentPeriod, currentRun, people, previous, latest, trend, pending, blockers, salaries, payouts, settlements, statutory } = overview;
  const change = previous && latest ? percentChange(previous.employerCost, latest.employerCost) : null;
  /* A monthly return opens Reports on "Returns to file" for the month it is for; anything else opens its screen. */
  const openReturn = (key, code) => {
    const row = key === 'reports' ? (statutory || []).find((r) => `FILING_GAPS_${r.code}` === code) : null;
    onOpen(key, row ? { report: 'filings', ...(row.periodId ? { periodId: row.periodId } : {}) } : undefined);
  };
  /* While setup is unfinished, finishing it is the one thing to do here (UX-13):
     a "Run payroll" that cannot run is not offered as the main action. */
  const notReady = Boolean(setup && !setup.ready);

  return (
    <div className="space-y-3">
      <PageHeader
        entity="payroll"
        title="Payroll"
        description={
          currentPeriod
            ? `${currentPeriod.name} · ${shownDate(currentPeriod.startDate)} to ${shownDate(currentPeriod.endDate)}${
                currentPeriod.paymentDate ? ` · paid on ${shownDate(currentPeriod.paymentDate)}` : ''
              }`
            : 'No open payroll period.'
        }
        actions={
          notReady && !currentRun ? (
            <button type="button" className="ui-btn ui-btn-primary" onClick={() => onOpen('setup')}>
              Finish setting up <ArrowRight size={16} aria-hidden="true" />
            </button>
          ) : (
            <button type="button" className="ui-btn ui-btn-primary" onClick={() => onOpen('runs')}>
              {currentRun ? 'Open this payroll' : 'Run payroll'} <ArrowRight size={16} aria-hidden="true" />
            </button>
          )
        }
      />
      <div className="px-5 lg:px-7 pb-8 space-y-4">

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
        <div className="ui-card p-4 flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="ui-sec-head">Payroll is not ready to run yet</div>
            <p className="ui-caption">
              {setup.done} of {setup.total} steps done
              {setup.nextStep ? ` · next: ${setup.nextStep.title} — ${setup.nextStep.detail}` : ''}
            </p>
          </div>
          <button type="button" className="ui-btn ui-btn-secondary shrink-0" onClick={() => onOpen('setup')}>
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
            <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={() => onOpen('runs')}>
              Open
            </button>
          </div>
          <RunSteps status={currentRun.status} />
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
              {notReady ? ' It can run once setup is finished.' : ''}
            </p>
          </div>
          {/* The header carries the main action; this one only repeats it, quietly. */}
          <button
            type="button"
            className="ui-btn ui-btn-secondary"
            onClick={() => onOpen('runs')}
            disabled={notReady}
            title={notReady ? 'Finish setting up payroll first' : undefined}
          >
            Run payroll
          </button>
        </div>
      ) : null}

      {/* What is in the way, in the order somebody would act on it. */}
      {blockers.length ? (
        <div className="ui-card overflow-hidden">
          <div className="px-4 py-3 ui-sec-head" style={{ borderBottom: '1px solid rgb(var(--border))' }}>
            What is in the way
          </div>
          <ul className="divide-y" style={{ borderColor: 'rgb(var(--border))' }}>
            {blockers.map((b) => (
              <li key={b.code} className="px-4 py-3 flex items-start gap-2">
                <AlertTriangle size={15} aria-hidden="true" className="mt-0.5 shrink-0" style={{ color: 'rgb(var(--warn-ink))' }} />
                <span className="text-sm flex-1 min-w-0">{b.message}</span>
                {FIX_IN[b.code] ? (
                  <button type="button" className="ui-link text-sm shrink-0" onClick={() => openReturn(FIX_IN[b.code][0], b.code)}>
                    {FIX_IN[b.code][1]}
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Figure Icon={Users} tint="sky" label="In payroll" value={String(people.inPayroll)} hint={`of ${people.headcount} on the books`} />
        <Figure
          Icon={Receipt}
          tint="lilac"
          label="Approved one-offs"
          value={String(pending.adjustments)}
          hint={pending.adjustmentValue ? `${pending.adjustmentValue > 0 ? '+' : '−'}${money(Math.abs(pending.adjustmentValue))}` : 'nothing pending'}
        />
        <Figure Icon={HandCoins} tint="peach" label="Loans running" value={String(pending.loans)} hint={pending.loanOutstanding ? `${money(pending.loanOutstanding)} owed` : 'nothing owed'} />
        <Figure Icon={TrendingUp} tint="mint" label="Revisions open" value={String(pending.revisions)} hint={pending.revisions ? 'not yet in effect' : 'none waiting'} />
      </div>

      {salaries ? (
        <>
          <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-3">
            <Panel title="Salaries and payslips" onOpen={() => onOpen('structures')} openLabel="Salary structures">
              <Line label="Salary structures in use" value={String(salaries.structures)} />
              <Line label="People on a structure" value={`${salaries.onStructure} of ${people.inPayroll}`} warn={salaries.withoutSalary > 0} />
              <Line
                label={currentPeriod ? `Payslips for ${currentPeriod.name}` : 'Payslips this month'}
                value={salaries.slips ? `${salaries.slips}${salaries.slipsFinal === salaries.slips ? ', approved' : `, ${salaries.slipsFinal} approved`}` : 'None yet'}
                onOpen={salaries.slips ? () => onOpen('slips') : null}
              />
            </Panel>

            <Panel title="Bank payouts" onOpen={() => onOpen('payments')} openLabel="Payments">
              {payouts?.runId ? (
                <>
                  <div className="px-4 py-3">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="ui-caption">Paid of take-home</span>
                      <span className="ui-amount tabular-nums text-sm font-semibold">
                        {money(payouts.paid)} <span className="ui-caption">of {money(payouts.net)}</span>
                      </span>
                    </div>
                    <span className="ui-meter mt-2 block" data-tone="progress" aria-hidden="true">
                      <span style={{ width: `${payouts.net ? Math.min(100, Math.round((payouts.paid / payouts.net) * 100)) : 0}%` }} />
                    </span>
                  </div>
                  <Line label="People paid" value={String(payouts.paidCount)} />
                  <Line label="Sent back by the bank" value={String(payouts.failedCount)} warn={payouts.failedCount > 0} />
                  {payouts.inProgress ? <Line label="Batches not finished" value={String(payouts.inProgress)} /> : null}
                </>
              ) : (
                <p className="px-4 py-3 ui-caption">Nothing to pay until {currentPeriod ? `${currentPeriod.name} is run` : 'a payroll is run'}.</p>
              )}
              <Line
                label="Bank detail changes waiting"
                value={String(overview.bankChanges || 0)}
                warn={overview.bankChanges > 0}
                onOpen={overview.bankChanges ? () => onOpen('bankChanges') : null}
              />
            </Panel>

            <Panel title="Full and final" onOpen={() => onOpen('settlements')} openLabel="Settlements">
              <Line label="Left, not started" value={String(settlements.notStarted)} warn={settlements.notStarted > 0} />
              <Line label="Being worked out" value={String(settlements.drafts)} />
              <Line label="Approved, not paid" value={String(settlements.approved)} />
              <Line label="Past the due date" value={String(settlements.overdue)} warn={settlements.overdue > 0} />
              {settlements.payable ? <Line label="Still to pay" value={money(settlements.payable)} /> : null}
            </Panel>
          </div>

          {/* Full width: six columns and a state do not fit beside another panel. */}
          <Panel title="Statutory returns" onOpen={() => onOpen('compliance')} openLabel="Compliance">
            <div className="ui-table-scroll">
              <table className="ui-table w-full">
                <thead>
                  <tr>
                    <th scope="col">Return</th>
                    <th scope="col">For</th>
                    <th scope="col" className="ui-col-h-center">Due</th>
                    <th scope="col" className="ui-col-h-right">People</th>
                    <th scope="col" className="ui-col-h-right">Amount</th>
                    <th scope="col">State</th>
                  </tr>
                </thead>
                <tbody className="ui-rows">
                  {statutory.map((r) => (
                    <tr key={r.code}>
                      <td className="ui-col-entity">
                        <button type="button" className="ui-link" onClick={() => (r.enabled ? openReturn(r.screen, `FILING_GAPS_${r.code}`) : onOpen('compliance'))}>
                          {r.output}
                        </button>
                      </td>
                      <td>{r.period || '—'}</td>
                      <td className="ui-col-date ui-col-h-center">{shownDate(r.dueDate)}</td>
                      <td className="ui-col-amount">{r.enabled && r.period ? r.people : '—'}</td>
                      <td className="ui-col-amount">{r.enabled && r.period ? money(r.amount) : '—'}</td>
                      <td>
                        <ReturnState row={r} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>
        </>
      ) : null}

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
          <div className="ui-table-scroll">
            <table className="ui-table ui-table-sticky w-full">
              <thead>
                <tr>
                  <th scope="col">Payroll</th>
                  <th scope="col">Month</th>
                  <th scope="col" className="ui-col-h-center">Paid on</th>
                  <th scope="col" className="ui-col-h-right">People</th>
                  <th scope="col" className="ui-col-h-right">Gross</th>
                  <th scope="col" className="ui-col-h-right">Take-home</th>
                  <th scope="col" className="ui-col-h-right">Company pays</th>
                </tr>
              </thead>
              <tbody className="ui-rows">
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
    </div>
  );
}

const Cell = ({ label, value }) => (
  <div className="px-4 py-3">
    <div className="ui-caption">{label}</div>
    <div className="ui-amount mt-1 text-lg font-semibold tabular-nums">{value}</div>
  </div>
);

const Figure = ({ Icon, tint, label, value, hint }) => (
  <div className="ui-card p-3" data-tint={tint}>
    <div className="ui-caption flex items-center gap-2">
      {Icon ? <span className="ui-figure-mark"><Icon size={14} aria-hidden="true" /></span> : null}
      {label}
    </div>
    <div className="ui-amount mt-1 text-lg font-semibold tabular-nums">{value}</div>
    {hint ? <div className="ui-caption">{hint}</div> : null}
  </div>
);

/* The run's steps, the one it is on marked; a run that is in the books has none left. */
const RunSteps = ({ status }) => {
  const done = STEPS_DONE[status] ?? 0;
  return (
    <ol className="ui-stepper px-4 py-3" aria-label="Where this payroll is" style={{ borderBottom: '1px solid rgb(var(--border))' }}>
      {RUN_STEPS.map((label, i) => (
        <li key={label} className={`ui-step ${i === done ? 'is-current' : ''} ${i < done ? 'is-done' : ''}`} aria-current={i === done ? 'step' : undefined}>
          <span className="ui-step-mark" aria-hidden="true">{i < done ? <Check size={14} /> : i + 1}</span>
          <span className="ui-step-label">{label}</span>
        </li>
      ))}
    </ol>
  );
};

/* One module: its heading, a way into the screen that owns it, and its lines under one hairline. */
const Panel = ({ title, onOpen, openLabel, children }) => (
  <section className="ui-card overflow-hidden" aria-label={title}>
    <div className="flex items-center justify-between gap-2 px-4 py-3" style={{ borderBottom: '1px solid rgb(var(--border))' }}>
      <div className="ui-sec-head" role="heading" aria-level={2}>{title}</div>
      <button type="button" className="ui-link text-sm" onClick={onOpen}>
        {openLabel}
      </button>
    </div>
    <div className="divide-y" style={{ borderColor: 'rgb(var(--border))' }}>{children}</div>
  </section>
);

const Line = ({ label, value, warn = false, onOpen = null }) => (
  <div className="px-4 py-2.5 flex items-center justify-between gap-3 text-sm">
    {onOpen ? (
      <button type="button" className="ui-link text-left" onClick={onOpen}>
        {label}
      </button>
    ) : (
      <span>{label}</span>
    )}
    <span className="ui-amount tabular-nums font-semibold" style={warn ? { color: 'rgb(var(--warn-ink))' } : undefined}>
      {value}
    </span>
  </div>
);

/* What a return would do if it were downloaded now. Never "filed": nothing records that. */
const ReturnState = ({ row }) => {
  if (!row.enabled) return <span className="ui-pill ui-pill-neutral">Not switched on</span>;
  if (!row.period) return <span className="ui-pill ui-pill-neutral">No payroll yet</span>;
  if (row.problems) return <span className="ui-pill ui-pill-warn">{row.problems} left out</span>;
  if (!row.people) return <span className="ui-pill ui-pill-neutral">Nothing due</span>;
  return <span className="ui-pill ui-pill-pos">Ready</span>;
};
