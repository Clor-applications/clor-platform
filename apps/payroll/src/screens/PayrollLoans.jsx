import React, { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, Ban, Check, Plus, RotateCcw, SkipForward } from 'lucide-react';

import { PageHeader, SkeletonCard, EmptyState } from '@ui/components/ui/Primitives';
import { confirmDialog, notify } from '@ui/components/ui/notify';
import { listPayrollPeriods } from '../api/payrollCalendar';
import { listSalaryComponents } from '../api/payrollComponents';
import { listEmployees } from '../api/payrollPeople';
import {
  listPayrollLoans,
  getPayrollLoan,
  createPayrollLoan,
  previewLoanSchedule,
  approvePayrollLoan,
  setInstallmentAction,
  cancelPayrollLoan,
} from '../api/payrollLoans';

/**
 * Money lent to somebody, and taken back out of their pay.
 *
 * The screen shows a loan as its schedule rather than as a balance, because the
 * schedule is what answers the questions people actually ask: when does this
 * finish, which month was missed, which payslip took that instalment. A balance
 * answers none of them.
 *
 * Approving is separated from creating and given its own weight, because it is
 * the moment a plan turns into a deduction from somebody's pay every month for
 * the next two years. The schedule is shown in full before that happens.
 */

const STATUS = {
  DRAFT: { label: 'Draft', tone: 'ui-pill-neutral' },
  APPROVED: { label: 'Approved', tone: 'ui-pill-pos' },
  ACTIVE: { label: 'Being recovered', tone: 'ui-pill-pos' },
  COMPLETED: { label: 'Repaid', tone: 'ui-pill-neutral' },
  CANCELLED: { label: 'Cancelled', tone: 'ui-pill-neutral' },
};

const INSTALLMENT = {
  PENDING: { label: 'Due', tone: 'ui-pill-neutral' },
  RECOVERED: { label: 'Taken', tone: 'ui-pill-pos' },
  SKIPPED: { label: 'Skipped', tone: 'ui-pill-warn' },
  WAIVED: { label: 'Written off', tone: 'ui-pill-warn' },
};

const TYPES = [
  { id: 'LOAN', label: 'Loan' },
  { id: 'SALARY_ADVANCE', label: 'Salary advance' },
];

const money = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

export default function PayrollLoans() {
  const [loans, setLoans] = useState([]);
  const [people, setPeople] = useState([]);
  const [components, setComponents] = useState([]);
  const [periods, setPeriods] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [openId, setOpenId] = useState(null);
  const [starting, setStarting] = useState(false);

  const load = useCallback(async () => {
    try {
      const [loanRows, employeeRows, componentRows, periodRows] = await Promise.all([
        listPayrollLoans(),
        listEmployees({ status: 'ACTIVE' }),
        listSalaryComponents({ activeOnly: true }),
        listPayrollPeriods({ openOnly: true }),
      ]);
      setLoans(loanRows);
      setPeople(employeeRows.employees);
      /* A recovery takes money off somebody's pay, so only a deduction can
         carry one. */
      setComponents(componentRows.filter((c) => c.type === 'DEDUCTION'));
      setPeriods(periodRows);
      setError('');
    } catch (e) {
      setError(String(e?.message || 'Could not load loans.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) return <SkeletonCard lines={6} />;

  if (openId) {
    return (
      <LoanDetail
        loanId={openId}
        onBack={() => {
          setOpenId(null);
          load();
        }}
      />
    );
  }

  const canStart = people.length > 0 && components.length > 0 && periods.length > 0;

  return (
    <div className="space-y-6">
      <PageHeader
        entity="settings"
        title="Loans & advances"
        description="Money lent to staff, and the schedule it comes back out of their pay on."
        actions={
          <button type="button" className="ui-btn ui-btn-primary" onClick={() => setStarting(true)} disabled={!canStart}>
            <Plus size={16} aria-hidden="true" /> New loan
          </button>
        }
      />

      {error ? (
        <div className="ui-card p-3 text-sm" role="alert" style={{ borderColor: 'rgb(var(--neg))', color: 'rgb(var(--neg))' }}>
          {error}
        </div>
      ) : null}

      {starting ? (
        <LoanForm
          people={people}
          components={components}
          periods={periods}
          onCancel={() => setStarting(false)}
          onCreated={(loan) => {
            setStarting(false);
            setOpenId(loan.id);
          }}
        />
      ) : null}

      {!canStart && !loans.length ? (
        <EmptyState
          title="Nothing to lend against yet"
          description="A loan needs somebody to lend to, a deduction for the recovery to appear as on a payslip, and an open month for recovery to start in."
        />
      ) : loans.length === 0 && !starting ? (
        <EmptyState
          title="No loans yet"
          description="Lend somebody money and payroll takes it back a month at a time, capped at what they actually earn."
          action={
            <button type="button" className="ui-btn ui-btn-primary" onClick={() => setStarting(true)}>
              <Plus size={16} aria-hidden="true" /> New loan
            </button>
          }
        />
      ) : loans.length ? (
        <div className="ui-card overflow-hidden">
          <div className="overflow-x-auto ui-table-scroll">
            <table className="ui-table w-full">
              <thead>
                <tr>
                  <th scope="col" className="ui-th">Loan</th>
                  <th scope="col" className="ui-th">Employee</th>
                  <th scope="col" className="ui-th">Kind</th>
                  <th scope="col" className="ui-th ui-col-h-right">Lent</th>
                  <th scope="col" className="ui-th ui-col-h-right">A month</th>
                  <th scope="col" className="ui-th ui-col-h-right">Still owed</th>
                  <th scope="col" className="ui-th ui-col-h-center">Status</th>
                </tr>
              </thead>
              <tbody>
                {loans.map((l) => (
                  <tr key={l.id} className="ui-row-click" onClick={() => setOpenId(l.id)}>
                    <td className="ui-col-id">{l.number}</td>
                    <td className="ui-col-entity">
                      {l.employeeName}
                      {l.employeeCode ? <span className="ui-caption"> · {l.employeeCode}</span> : null}
                    </td>
                    <td className="ui-col-meta">{TYPES.find((t) => t.id === l.type)?.label || l.type}</td>
                    <td className="ui-col-amount">{money(l.principal)}</td>
                    <td className="ui-col-amount">{l.installmentAmount ? money(l.installmentAmount) : '—'}</td>
                    <td className="ui-col-amount">{money(l.outstandingBalance)}</td>
                    <td>
                      <span className={`ui-pill ${STATUS[l.status]?.tone || 'ui-pill-neutral'}`}>{STATUS[l.status]?.label || l.status}</span>
                    </td>
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

/**
 * The terms, with the schedule they produce shown as they are typed.
 *
 * The preview is the point of the form. "Six instalments of ₹10,000" is what
 * somebody is actually agreeing to, and seeing it before approving is what
 * stops a loan being approved on a number nobody worked out.
 */
const LoanForm = ({ people, components, periods, onCancel, onCreated }) => {
  const [form, setForm] = useState({
    employeeId: people[0]?.id || '',
    type: 'LOAN',
    principal: '',
    interestRate: 0,
    startDate: new Date().toISOString().slice(0, 10),
    recoveryStartPeriodId: periods[0]?.id || '',
    installmentCount: 6,
    recoveryComponentId: components[0]?.id || '',
    notes: '',
  });
  const [schedule, setSchedule] = useState(null);
  const [saving, setSaving] = useState(false);
  const set = (patch) => setForm((p) => ({ ...p, ...patch }));

  const principal = Number(form.principal);
  const count = Number(form.installmentCount);
  const rate = Number(form.interestRate);

  useEffect(() => {
    if (!(principal > 0) || !(count > 0)) {
      setSchedule(null);
      return undefined;
    }
    let alive = true;
    previewLoanSchedule({ principal, interestRate: rate || 0, installmentCount: count })
      .then((s) => {
        if (alive) setSchedule(s);
      })
      .catch(() => {
        if (alive) setSchedule(null);
      });
    return () => {
      alive = false;
    };
  }, [principal, count, rate]);

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      onCreated(
        await createPayrollLoan({
          employeeId: form.employeeId,
          type: form.type,
          principal,
          interestRate: rate || 0,
          startDate: form.startDate,
          recoveryStartPeriodId: form.recoveryStartPeriodId,
          installmentCount: count,
          recoveryComponentId: form.recoveryComponentId,
          notes: form.notes.trim() || null,
        })
      );
    } catch (err) {
      notify.error(String(err?.message || 'Could not create that loan.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="ui-card p-4 space-y-3" onSubmit={save}>
      <div className="ui-sec-head">New loan</div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <div>
          <label className="ui-label" htmlFor="loan-employee">Who</label>
          <select id="loan-employee" className="ui-select w-full" value={form.employeeId} onChange={(e) => set({ employeeId: e.target.value })} required>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}{p.code ? ` · ${p.code}` : ''}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="ui-label" htmlFor="loan-type">Kind</label>
          <select id="loan-type" className="ui-select w-full" value={form.type} onChange={(e) => set({ type: e.target.value })}>
            {TYPES.map((t) => (
              <option key={t.id} value={t.id}>{t.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="ui-label" htmlFor="loan-principal">Amount lent</label>
          <input
            id="loan-principal"
            type="number"
            min="0"
            step="0.01"
            className="ui-input ui-num w-full"
            value={form.principal}
            onChange={(e) => set({ principal: e.target.value })}
            required
          />
        </div>
        <div>
          <label className="ui-label" htmlFor="loan-date">Lent on</label>
          <input id="loan-date" type="date" className="ui-input w-full" value={form.startDate} onChange={(e) => set({ startDate: e.target.value })} required />
        </div>

        <div>
          <label className="ui-label" htmlFor="loan-count">Instalments</label>
          <input
            id="loan-count"
            type="number"
            min="1"
            max="600"
            className="ui-input ui-num w-full"
            value={form.installmentCount}
            onChange={(e) => set({ installmentCount: e.target.value })}
            required
          />
        </div>
        <div>
          <label className="ui-label" htmlFor="loan-rate">Interest (% a year)</label>
          <input
            id="loan-rate"
            type="number"
            min="0"
            max="100"
            step="0.01"
            className="ui-input ui-num w-full"
            value={form.interestRate}
            onChange={(e) => set({ interestRate: e.target.value })}
          />
          <span className="ui-caption">Flat, on the whole amount, over the term.</span>
        </div>
        <div>
          <label className="ui-label" htmlFor="loan-start-period">Recovery starts</label>
          <select
            id="loan-start-period"
            className="ui-select w-full"
            value={form.recoveryStartPeriodId}
            onChange={(e) => set({ recoveryStartPeriodId: e.target.value })}
            required
          >
            {periods.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="ui-label" htmlFor="loan-component">Shows on the payslip as</label>
          <select
            id="loan-component"
            className="ui-select w-full"
            value={form.recoveryComponentId}
            onChange={(e) => set({ recoveryComponentId: e.target.value })}
            required
          >
            {components.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label className="ui-label" htmlFor="loan-notes">Notes</label>
        <input id="loan-notes" className="ui-input w-full" value={form.notes} onChange={(e) => set({ notes: e.target.value })} />
      </div>

      {schedule ? (
        <p className="ui-caption">
          {count} {count === 1 ? 'instalment' : 'instalments'} of about {money(schedule.schedule[0]?.dueAmount)}, {money(schedule.total)} in all
          {schedule.interest > 0 ? ` — ${money(schedule.interest)} of that interest` : ''}. Nothing comes out of anybody's pay until this is approved.
        </p>
      ) : null}

      <div className="flex items-center justify-end gap-2">
        <button type="button" className="ui-btn ui-btn-secondary" onClick={onCancel} disabled={saving}>Cancel</button>
        <button type="submit" className="ui-btn ui-btn-primary" disabled={saving || !schedule}>
          {saving ? 'Creating…' : 'Create as draft'}
        </button>
      </div>
    </form>
  );
};

const LoanDetail = ({ loanId, onBack }) => {
  const [loan, setLoan] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');

  const load = useCallback(async () => {
    try {
      setLoan(await getPayrollLoan(loanId));
    } catch (e) {
      notify.error(String(e?.message || 'Could not load that loan.'));
    } finally {
      setLoading(false);
    }
  }, [loanId]);

  useEffect(() => {
    load();
  }, [load]);

  const act = async (fn, done, key) => {
    setBusy(key);
    try {
      await fn();
      notify.success(done);
      load();
    } catch (e) {
      notify.error(String(e?.message || 'Could not do that.'));
    } finally {
      setBusy('');
    }
  };

  const approve = async () => {
    const ok = await confirmDialog({
      title: 'Approve this loan?',
      message: `${money(loan.principal)} over ${loan.installmentCount} instalments. From the month recovery starts, this comes out of their pay every month until it is repaid.`,
      confirmLabel: 'Yes, approve',
      tone: 'default',
    });
    if (!ok) return;
    act(() => approvePayrollLoan(loanId), 'Approved. The schedule is now running.', 'approve');
  };

  const waive = async (installment) => {
    const ok = await confirmDialog({
      title: 'Write this instalment off?',
      message: `${money(installment.dueAmount)} is forgiven and comes off what is owed. To move it rather than forgive it, skip it instead.`,
      confirmLabel: 'Yes, write it off',
    });
    if (!ok) return;
    act(() => setInstallmentAction(loanId, installment.id, 'WAIVE'), 'Written off.', installment.id);
  };

  const cancel = async () => {
    const ok = await confirmDialog({
      title: 'Cancel this loan?',
      message: 'The schedule is removed and nothing will be recovered.',
      confirmLabel: 'Yes, cancel it',
    });
    if (!ok) return;
    act(() => cancelPayrollLoan(loanId), 'Cancelled.', 'cancel');
  };

  if (loading) return <SkeletonCard lines={6} />;
  if (!loan) return null;

  const running = loan.status === 'ACTIVE';

  return (
    <div className="space-y-6">
      <PageHeader
        entity="settings"
        title={loan.number}
        description={`${loan.employeeName} · ${TYPES.find((t) => t.id === loan.type)?.label || loan.type} · ${money(loan.principal)} lent${
          loan.recoveryComponentName ? ` · shows as ${loan.recoveryComponentName}` : ''
        }`}
        actions={
          <div className="flex items-center gap-2">
            <button type="button" className="ui-btn ui-btn-secondary" onClick={onBack}>
              <ArrowLeft size={16} aria-hidden="true" /> Back
            </button>
            {loan.status === 'DRAFT' ? (
              <>
                <button type="button" className="ui-btn ui-btn-secondary" onClick={cancel} disabled={busy === 'cancel'}>
                  <Ban size={16} aria-hidden="true" /> Cancel
                </button>
                <button type="button" className="ui-btn ui-btn-primary" onClick={approve} disabled={busy === 'approve'}>
                  {busy === 'approve' ? 'Approving…' : 'Approve'}
                </button>
              </>
            ) : null}
          </div>
        }
      />

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Figure label="Lent" value={money(loan.principal)} />
        <Figure label="Taken back" value={money(loan.recovered ?? 0)} />
        <Figure label="Written off" value={money(loan.waived ?? 0)} />
        <Figure label="Still owed" value={money(loan.outstanding ?? loan.outstandingBalance)} />
      </div>

      {loan.status === 'DRAFT' ? (
        <p className="ui-caption">
          Nothing comes out of anybody&rsquo;s pay until this is approved. Approving writes the schedule below against real months.
        </p>
      ) : null}

      {loan.installments?.length ? (
        <div className="ui-card overflow-hidden">
          <div className="px-4 py-3 ui-sec-head" style={{ borderBottom: '1px solid rgb(var(--border))' }}>
            The schedule
          </div>
          <div className="overflow-x-auto ui-table-scroll">
            <table className="ui-table w-full">
              <thead>
                <tr>
                  <th scope="col" className="ui-th ui-col-h-right">#</th>
                  <th scope="col" className="ui-th">Month</th>
                  <th scope="col" className="ui-th ui-col-h-right">Due</th>
                  <th scope="col" className="ui-th ui-col-h-right">Of that, interest</th>
                  <th scope="col" className="ui-th ui-col-h-center">Status</th>
                  <th scope="col" className="ui-th">Taken on</th>
                  {running ? (
                    <th scope="col" className="ui-th ui-col-h-center">
                      <span className="sr-only">Actions</span>
                    </th>
                  ) : null}
                </tr>
              </thead>
              <tbody>
                {loan.installments.map((i) => (
                  <tr key={i.id}>
                    <td className="ui-col-amount">{i.sequence}</td>
                    <td className="ui-col-meta">{i.periodName || 'A month not on the calendar yet'}</td>
                    <td className="ui-col-amount">{money(i.dueAmount)}</td>
                    <td className="ui-col-amount">{i.interestAmount ? money(i.interestAmount) : '—'}</td>
                    <td>
                      <span className={`ui-pill ${INSTALLMENT[i.status]?.tone || 'ui-pill-neutral'}`}>{INSTALLMENT[i.status]?.label || i.status}</span>
                    </td>
                    <td className="ui-col-id">{i.slipNumber || '—'}</td>
                    {running ? (
                      <td>
                        <div className="flex items-center justify-center gap-1">
                          {i.status === 'PENDING' ? (
                            <>
                              <button
                                type="button"
                                className="ui-icon-btn"
                                aria-label={`Skip instalment ${i.sequence} — still owed`}
                                disabled={busy === i.id}
                                onClick={() => act(() => setInstallmentAction(loanId, i.id, 'SKIP'), 'Skipped. It is still owed.', i.id)}
                              >
                                <SkipForward size={16} aria-hidden="true" />
                              </button>
                              <button
                                type="button"
                                className="ui-icon-btn"
                                aria-label={`Write instalment ${i.sequence} off`}
                                disabled={busy === i.id}
                                onClick={() => waive(i)}
                              >
                                <Ban size={16} aria-hidden="true" />
                              </button>
                            </>
                          ) : null}
                          {['SKIPPED', 'WAIVED'].includes(i.status) ? (
                            <button
                              type="button"
                              className="ui-icon-btn"
                              aria-label={`Put instalment ${i.sequence} back`}
                              disabled={busy === i.id}
                              onClick={() => act(() => setInstallmentAction(loanId, i.id, 'RESTORE'), 'Put back.', i.id)}
                            >
                              <RotateCcw size={16} aria-hidden="true" />
                            </button>
                          ) : null}
                          {i.status === 'RECOVERED' ? <Check size={16} aria-hidden="true" style={{ color: 'rgb(var(--pos))' }} /> : null}
                        </div>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : loan.status === 'DRAFT' ? (
        <p className="ui-caption">The schedule is written when this is approved.</p>
      ) : null}

      {loan.notes ? <p className="ui-caption">{loan.notes}</p> : null}
    </div>
  );
};

const Figure = ({ label, value }) => (
  <div className="ui-card p-3">
    <div className="ui-caption">{label}</div>
    <div className="ui-amount mt-0.5">{value}</div>
  </div>
);
