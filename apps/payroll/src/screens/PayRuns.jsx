import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowLeft, Check, Info, Play, Plus } from 'lucide-react';

import { PageHeader, SkeletonCard, EmptyState } from '@ui/components/ui/Primitives';
import { confirmDialog, notify } from '@ui/components/ui/notify';
import { listPayrollPeriods, listPayGroups } from '../api/payrollCalendar';
import {
  listPayrollRuns,
  getPayrollRun,
  createPayrollRun,
  setRunEmployeeIncluded,
  saveRunInputs,
  validatePayrollRun,
  calculatePayrollRun,
  submitRunForReview,
  approvePayrollRun,
  rejectPayrollRun,
  lockPayrollRun,
  previewPayrollPosting,
  postPayrollRun,
} from '../api/payrollRuns';

/**
 * Running payroll.
 *
 * The shape of the screen is the shape of the decision: who is being paid, for
 * how many days, what is wrong with that, and only then the money. Each stage
 * is a thing somebody chooses rather than a step a wizard walks them through,
 * so the stages stay visible and reachable instead of collapsing into one
 * button that produces payslips nobody picked.
 *
 * What the screen refuses to do is decide anything. Eligibility, validation,
 * the arithmetic and whether a status may change are all the server's, and the
 * screen shows what it is told — a second copy of "can this be approved" living
 * here is a copy that can disagree with the one that actually decides.
 */

const STATUS_LABEL = {
  DRAFT: 'Draft',
  CALCULATED: 'Calculated',
  REVIEW: 'In review',
  APPROVED: 'Approved',
  LOCKED: 'Locked',
  PAID: 'Paid',
  POSTED: 'Posted',
  CANCELLED: 'Cancelled',
};

const money = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;

const shownDate = (iso) => {
  const s = String(iso || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return '—';
  const [y, m, d] = s.split('-');
  return `${d}/${m}/${y}`;
};

export default function PayRuns() {
  const [runs, setRuns] = useState([]);
  const [periods, setPeriods] = useState([]);
  const [payGroups, setPayGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [openId, setOpenId] = useState(null);
  const [starting, setStarting] = useState(false);

  const load = useCallback(async () => {
    try {
      const [runRows, periodRows, groupRows] = await Promise.all([
        listPayrollRuns(),
        listPayrollPeriods({ openOnly: true }),
        listPayGroups({ activeOnly: true }),
      ]);
      setRuns(runRows);
      setPeriods(periodRows);
      setPayGroups(groupRows);
      setError('');
    } catch (e) {
      setError(String(e?.message || 'Could not load payroll runs.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const start = async (payload) => {
    try {
      const made = await createPayrollRun(payload);
      notify.success(`${made.run.number} started with ${made.eligible} ${made.eligible === 1 ? 'person' : 'people'}.`);
      setStarting(false);
      setOpenId(made.run.id);
      load();
    } catch (e) {
      notify.error(String(e?.message || 'Could not start that payroll.'));
    }
  };

  if (loading) return <SkeletonCard lines={6} />;

  if (openId) {
    return <RunWorkflow runId={openId} onBack={() => { setOpenId(null); load(); }} />;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        entity="settings"
        title="Pay runs"
        description="Payroll for a period and a population — checked, reviewed and approved before anybody is paid."
        actions={
          <button type="button" className="ui-btn ui-btn-primary" onClick={() => setStarting(true)} disabled={!periods.length}>
            <Play size={16} aria-hidden="true" /> Run payroll
          </button>
        }
      />

      {error ? (
        <div className="ui-card p-3 text-sm" role="alert" style={{ borderColor: 'rgb(var(--neg))', color: 'rgb(var(--neg))' }}>
          {error}
        </div>
      ) : null}

      {starting ? (
        <StartRun periods={periods} payGroups={payGroups} onCancel={() => setStarting(false)} onStart={start} />
      ) : null}

      {periods.length === 0 ? (
        <EmptyState
          title="No open payroll period"
          description="Payroll runs for a period. Add one under Settings → Payroll → Payroll periods, and payroll has a month to run for."
        />
      ) : runs.length === 0 && !starting ? (
        <EmptyState
          title="No payroll has been run yet"
          description="Start a run for a period and payroll will gather everybody eligible, check them, and work out what each is owed."
          action={
            <button type="button" className="ui-btn ui-btn-primary" onClick={() => setStarting(true)}>
              <Plus size={16} aria-hidden="true" /> Run payroll
            </button>
          }
        />
      ) : runs.length ? (
        <div className="ui-card overflow-hidden">
          <div className="overflow-x-auto ui-table-scroll">
            <table className="ui-table w-full">
              <thead>
                <tr>
                  <th scope="col" className="ui-th">Payroll</th>
                  <th scope="col" className="ui-th">Period</th>
                  <th scope="col" className="ui-th ui-col-h-center">Pay date</th>
                  <th scope="col" className="ui-th ui-col-h-right">People</th>
                  <th scope="col" className="ui-th ui-col-h-right">Gross</th>
                  <th scope="col" className="ui-th ui-col-h-right">Net pay</th>
                  <th scope="col" className="ui-th ui-col-h-center">Status</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => (
                  <tr key={r.id} className="ui-row-click" onClick={() => setOpenId(r.id)}>
                    <td className="ui-col-id">{r.number}</td>
                    <td className="ui-col-entity">{r.period?.name || '—'}</td>
                    <td className="ui-col-date ui-col-h-center">{shownDate(r.payrollDate)}</td>
                    <td className="ui-col-amount">{r.employeeCount}</td>
                    <td className="ui-col-amount">{money(r.grossTotal)}</td>
                    <td className="ui-col-amount">{money(r.netTotal)}</td>
                    <td>
                      <span className={`ui-pill ${['APPROVED', 'LOCKED', 'PAID', 'POSTED'].includes(r.status) ? 'ui-pill-pos' : 'ui-pill-neutral'}`}>
                        {STATUS_LABEL[r.status] || r.status}
                      </span>
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

const StartRun = ({ periods, payGroups, onCancel, onStart }) => {
  const [form, setForm] = useState({ periodId: periods[0]?.id || '', payGroupId: '' });
  const set = (patch) => setForm((p) => ({ ...p, ...patch }));

  return (
    <form
      className="ui-card p-4 space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        onStart({ periodId: form.periodId, payGroupId: form.payGroupId || null });
      }}
    >
      <div className="ui-sec-head">Run payroll</div>
      <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-3 items-end">
        <div>
          <label className="ui-label" htmlFor="run-period">Period</label>
          <select id="run-period" className="ui-select w-full" value={form.periodId} onChange={(e) => set({ periodId: e.target.value })} required>
            {periods.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="ui-label" htmlFor="run-group">Pay group</label>
          <select id="run-group" className="ui-select w-full" value={form.payGroupId} onChange={(e) => set({ payGroupId: e.target.value })}>
            <option value="">Everybody</option>
            {payGroups.map((g) => (
              <option key={g.id} value={g.id}>{g.name}</option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" className="ui-btn ui-btn-secondary" onClick={onCancel}>Cancel</button>
          <button type="submit" className="ui-btn ui-btn-primary">Start</button>
        </div>
      </div>
    </form>
  );
};

/* ------------------------------------------------------------- the run */

const RunWorkflow = ({ runId, onBack }) => {
  const [data, setData] = useState(null);
  const [issues, setIssues] = useState(null);
  const [busy, setBusy] = useState('');
  const [stage, setStage] = useState('people');

  const load = useCallback(async () => {
    try {
      setData(await getPayrollRun(runId));
    } catch (e) {
      notify.error(String(e?.message || 'Could not load that payroll.'));
    }
  }, [runId]);

  useEffect(() => {
    load();
  }, [load]);

  const act = async (label, fn, after) => {
    setBusy(label);
    try {
      const out = await fn();
      if (after) after(out);
      await load();
    } catch (e) {
      notify.error(String(e?.message || `Could not ${label}.`));
    } finally {
      setBusy('');
    }
  };

  const run = data?.run;
  const editable = run && ['DRAFT', 'CALCULATED', 'REVIEW'].includes(run.status);

  const byEmployee = useMemo(() => new Map((data?.employees || []).map((e) => [e.employeeId, e])), [data]);

  if (!data) return <SkeletonCard lines={6} />;

  const errorCount = issues ? issues.errors : run.errorCount;
  const warningCount = issues ? issues.warnings : run.warningCount;

  return (
    <div className="space-y-6">
      <PageHeader
        entity="settings"
        title={`${run.number} — ${run.period?.name || 'payroll'}`}
        description={`${run.employeeCount} ${run.employeeCount === 1 ? 'person' : 'people'}, paid on ${shownDate(run.payrollDate)}.`}
        actions={
          <>
            <button type="button" className="ui-btn ui-btn-secondary" onClick={onBack}>
              <ArrowLeft size={16} aria-hidden="true" /> Back
            </button>
            <RunPrimaryAction run={run} busy={busy} issues={issues} act={act} runId={runId} setIssues={setIssues} />
          </>
        }
      />

      <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
        <Tile label="People" value={run.employeeCount} />
        <Tile label="Gross" value={money(run.grossTotal)} />
        <Tile label="Deductions" value={money(run.deductionTotal)} />
        <Tile label="Net pay" value={money(run.netTotal)} strong />
      </div>

      {errorCount > 0 || warningCount > 0 ? (
        <div className="flex flex-wrap items-center gap-3">
          {errorCount > 0 ? (
            <span className="ui-pill ui-pill-neg">
              <AlertTriangle size={12} aria-hidden="true" /> {errorCount} to resolve
            </span>
          ) : null}
          {warningCount > 0 ? (
            <span className="ui-pill ui-pill-warn">
              <Info size={12} aria-hidden="true" /> {warningCount} worth checking
            </span>
          ) : null}
        </div>
      ) : null}

      <div className="ui-segmented" role="tablist" aria-label="Payroll stage">
        {[
          ['people', 'People'],
          ['inputs', 'Days'],
          ['issues', 'Checks'],
          ['review', 'Review'],
          ['books', 'Accounting'],
        ].map(([id, label]) => (
          <button key={id} type="button" role="tab" aria-selected={stage === id} className="ui-segment" onClick={() => setStage(id)}>
            {label}
          </button>
        ))}
      </div>

      {stage === 'people' ? (
        <PeopleStage data={data} editable={editable} runId={runId} onChanged={load} />
      ) : stage === 'inputs' ? (
        <DaysStage data={data} editable={editable} runId={runId} onSaved={load} />
      ) : stage === 'issues' ? (
        <ChecksStage issues={issues} byEmployee={byEmployee} data={data} />
      ) : stage === 'review' ? (
        <ReviewStage data={data} byEmployee={byEmployee} />
      ) : (
        <BooksStage runId={runId} run={run} onPosted={load} />
      )}

      {run.rejectionReason ? (
        <div className="ui-card p-3 text-sm" role="status" style={{ background: 'rgb(var(--warn-soft))', color: 'rgb(var(--warn-ink))' }}>
          Sent back: {run.rejectionReason}
        </div>
      ) : null}
    </div>
  );
};

/**
 * One primary action, and it is whatever the run's status says comes next.
 *
 * The status is the server's, so the button follows it rather than the screen
 * keeping its own idea of where the run has got to.
 */
const RunPrimaryAction = ({ run, busy, act, runId, setIssues }) => {
  if (run.status === 'DRAFT' || (run.status === 'CALCULATED' && run.errorCount > 0)) {
    return (
      <button
        type="button"
        className="ui-btn ui-btn-primary"
        disabled={Boolean(busy)}
        onClick={() =>
          act('check this payroll', async () => {
            const out = await validatePayrollRun(runId);
            setIssues(out);
            if (out.canCalculate) {
              await calculatePayrollRun(runId);
              notify.success('Payroll calculated.');
            } else {
              notify.error(`${out.errors} thing${out.errors === 1 ? '' : 's'} to resolve first.`);
            }
            return out;
          })
        }
      >
        {busy ? 'Working…' : 'Check and calculate'}
      </button>
    );
  }
  if (run.status === 'CALCULATED') {
    return (
      <button
        type="button"
        className="ui-btn ui-btn-primary"
        disabled={Boolean(busy)}
        onClick={() => act('send for review', () => submitRunForReview(runId), () => notify.success('Sent for review.'))}
      >
        Send for review
      </button>
    );
  }
  if (run.status === 'APPROVED') {
    return (
      <>
        <button
          type="button"
          className="ui-btn ui-btn-secondary"
          disabled={Boolean(busy)}
          onClick={() => act('lock', () => lockPayrollRun(runId), () => notify.success('Payroll locked.'))}
        >
          Lock
        </button>
        <button
          type="button"
          className="ui-btn ui-btn-primary"
          disabled={Boolean(busy)}
          onClick={() =>
            act(
              'post to the books',
              () => postPayrollRun(runId),
              (out) => notify.success(out?.replayed ? 'Already posted.' : 'Posted to the books.')
            )
          }
        >
          Post to accounts
        </button>
      </>
    );
  }
  if (run.status === 'REVIEW') {
    return (
      <>
        <button
          type="button"
          className="ui-btn ui-btn-secondary"
          disabled={Boolean(busy)}
          onClick={async () => {
            const reason = window.prompt('Why is this going back?');
            if (reason === null) return;
            act('send it back', () => rejectPayrollRun(runId, { reason }), () => notify.success('Sent back.'));
          }}
        >
          Send back
        </button>
        <button
          type="button"
          className="ui-btn ui-btn-primary"
          disabled={Boolean(busy)}
          onClick={async () => {
            const ok = await confirmDialog({
              title: `Approve ${run.number}?`,
              message: `Approving fixes these figures: ${money(run.netTotal)} to ${run.employeeCount} ${run.employeeCount === 1 ? 'person' : 'people'}. Nothing can be changed afterwards.`,
              confirmLabel: 'Yes, approve',
            });
            if (ok) act('approve', () => approvePayrollRun(runId), () => notify.success('Payroll approved.'));
          }}
        >
          Approve payroll
        </button>
      </>
    );
  }
  if (run.status === 'APPROVED' || run.status === 'LOCKED') {
    return (
      <button
        type="button"
        className="ui-btn ui-btn-primary"
        disabled={Boolean(busy)}
        onClick={() =>
          act(
            'post to the books',
            () => postPayrollRun(runId),
            (out) => notify.success(out?.replayed ? 'Already posted.' : 'Posted to the books.')
          )
        }
      >
        Post to accounts
      </button>
    );
  }
  return null;
};

const Tile = ({ label, value, strong = false }) => (
  <div className="ui-card p-3">
    <div className="ui-card-label">{label}</div>
    <div className={`ui-num ${strong ? 'text-lg font-medium' : 'text-lg'}`}>{value}</div>
  </div>
);

const PeopleStage = ({ data, editable, runId, onChanged }) => (
  <div className="ui-card overflow-hidden">
    <div className="overflow-x-auto ui-table-scroll">
      <table className="ui-table w-full">
        <thead>
          <tr>
            <th scope="col" className="ui-th ui-col-h-center w-10">In</th>
            <th scope="col" className="ui-th">Employee</th>
            <th scope="col" className="ui-th">Designation</th>
            <th scope="col" className="ui-th ui-col-h-center">State</th>
          </tr>
        </thead>
        <tbody>
          {data.employees.map((m) => (
            <tr key={m.employeeId}>
              <td className="ui-col-h-center">
                <input
                  type="checkbox"
                  className="ui-checkbox"
                  aria-label={`Include ${m.employee?.name || 'this person'} in this payroll`}
                  checked={m.inclusion === 'INCLUDED'}
                  disabled={!editable}
                  onChange={(e) =>
                    setRunEmployeeIncluded(runId, m.employeeId, e.target.checked)
                      .then(onChanged)
                      .catch((err) => notify.error(String(err?.message || 'Could not change that.')))
                  }
                />
              </td>
              <td className="ui-col-entity">
                {m.employee?.name || 'Unknown'}
                {m.employee?.code ? <span className="ui-caption block">{m.employee.code}</span> : null}
              </td>
              <td className="ui-col-meta">{m.employee?.designation || '—'}</td>
              <td>
                <span className={`ui-pill ${m.state === 'ERROR' ? 'ui-pill-neg' : m.state === 'WARNING' ? 'ui-pill-warn' : 'ui-pill-neutral'}`}>
                  {m.state === 'CALCULATED' ? 'Calculated' : m.state === 'ERROR' ? 'Needs fixing' : m.state === 'WARNING' ? 'Check' : m.state === 'READY' ? 'Ready' : 'Pending'}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </div>
);

const DaysStage = ({ data, editable, runId, onSaved }) => {
  const [rows, setRows] = useState(() =>
    data.employees
      .filter((m) => m.inclusion === 'INCLUDED')
      .map((m) => ({
        employeeId: m.employeeId,
        name: m.employee?.name || 'Unknown',
        workingDays: m.input?.workingDays ?? 30,
        payableDays: m.input?.payableDays ?? 30,
        lwpDays: m.input?.lwpDays ?? 0,
        variablePay: m.input?.variablePay ?? 0,
      }))
  );
  const [saving, setSaving] = useState(false);
  const patch = (idx, p) => setRows((list) => list.map((r, i) => (i === idx ? { ...r, ...p } : r)));

  const save = async () => {
    setSaving(true);
    try {
      await saveRunInputs(
        runId,
        rows.map((r) => ({
          employeeId: r.employeeId,
          workingDays: Number(r.workingDays) || 0,
          payableDays: Number(r.payableDays) || 0,
          lwpDays: Number(r.lwpDays) || 0,
          variablePay: Number(r.variablePay) || 0,
        }))
      );
      notify.success('Days saved.');
      onSaved();
    } catch (e) {
      notify.error(String(e?.message || 'Could not save those days.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3">
      <p className="ui-caption">
        Days are worked out from the period and each person&apos;s joining and leaving dates. Change them where somebody took
        unpaid leave.
      </p>
      <div className="ui-card overflow-hidden">
        <div className="overflow-x-auto ui-table-scroll">
          <table className="ui-table w-full">
            <thead>
              <tr>
                <th scope="col" className="ui-th">Employee</th>
                <th scope="col" className="ui-th ui-col-h-right">Working days</th>
                <th scope="col" className="ui-th ui-col-h-right">Payable days</th>
                <th scope="col" className="ui-th ui-col-h-right">Unpaid leave</th>
                <th scope="col" className="ui-th ui-col-h-right">Variable pay</th>
              </tr>
            </thead>
            <tbody>
              <fieldset className="contents" disabled={!editable}>
                {rows.map((r, idx) => (
                  <tr key={r.employeeId}>
                    <td className="ui-col-entity">{r.name}</td>
                    {['workingDays', 'payableDays', 'lwpDays', 'variablePay'].map((field) => (
                      <td key={field} className="ui-col-amount">
                        <input
                          type="number"
                          min="0"
                          className="ui-input ui-num w-full min-w-0 px-2 py-1"
                          aria-label={`${field === 'workingDays' ? 'Working days' : field === 'payableDays' ? 'Payable days' : field === 'lwpDays' ? 'Unpaid leave days' : 'Variable pay'} for ${r.name}`}
                          value={r[field]}
                          onChange={(e) => patch(idx, { [field]: e.target.value })}
                        />
                      </td>
                    ))}
                  </tr>
                ))}
              </fieldset>
            </tbody>
          </table>
        </div>
      </div>
      {editable ? (
        <div className="flex justify-end">
          <button type="button" className="ui-btn ui-btn-secondary" onClick={save} disabled={saving}>
            {saving ? 'Saving…' : 'Save days'}
          </button>
        </div>
      ) : null}
    </div>
  );
};

const ChecksStage = ({ issues, byEmployee, data }) => {
  const list = issues?.issues || data.employees.flatMap((m) => m.issues || []);
  if (!list.length) {
    return (
      <div className="ui-card p-4">
        <p className="ui-caption">Nothing to resolve. Run the check to see the latest.</p>
      </div>
    );
  }
  const order = { ERROR: 0, WARNING: 1, INFO: 2 };
  const sorted = [...list].sort((a, b) => (order[a.severity] ?? 3) - (order[b.severity] ?? 3));
  return (
    <div className="ui-card overflow-hidden">
      <ul>
        {sorted.map((i, idx) => (
          <li key={idx} className="flex items-start gap-2 px-4 py-2.5 text-sm" style={{ borderTop: idx ? '1px solid rgb(var(--border))' : 'none' }}>
            {i.severity === 'ERROR' ? (
              <AlertTriangle size={15} aria-hidden="true" className="mt-0.5 shrink-0" style={{ color: 'rgb(var(--neg))' }} />
            ) : i.severity === 'WARNING' ? (
              <Info size={15} aria-hidden="true" className="mt-0.5 shrink-0" style={{ color: 'rgb(var(--warn-ink))' }} />
            ) : (
              <Check size={15} aria-hidden="true" className="mt-0.5 shrink-0 ui-subtle" />
            )}
            <span className="min-w-0">
              {i.message}
              {i.employeeId && byEmployee.get(i.employeeId)?.employee?.name ? (
                <span className="ui-caption block">{byEmployee.get(i.employeeId).employee.name}</span>
              ) : null}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
};

const ReviewStage = ({ data, byEmployee }) => {
  if (!data.slips.length) {
    return (
      <div className="ui-card p-4">
        <p className="ui-caption">Nothing calculated yet. Check and calculate, and the payslips appear here.</p>
      </div>
    );
  }
  return (
    <div className="ui-card overflow-hidden">
      <div className="overflow-x-auto ui-table-scroll">
        <table className="ui-table w-full">
          <thead>
            <tr>
              <th scope="col" className="ui-th">Employee</th>
              <th scope="col" className="ui-th ui-col-h-right">Gross</th>
              <th scope="col" className="ui-th ui-col-h-right">Deductions</th>
              <th scope="col" className="ui-th ui-col-h-right">Employer cost</th>
              <th scope="col" className="ui-th ui-col-h-right">Net pay</th>
              <th scope="col" className="ui-th ui-col-h-right">Last period</th>
              <th scope="col" className="ui-th ui-col-h-right">Change</th>
            </tr>
          </thead>
          <tbody>
            {data.slips.map((s) => {
              const person = byEmployee.get(s.employeeId)?.employee;
              /* A large move month on month is usually right and always worth
                 a second look, so it is marked rather than hidden. */
              const big = s.variancePercent != null && Math.abs(s.variancePercent) >= 20;
              return (
                <tr key={s.id}>
                  <td className="ui-col-entity">{person?.name || 'Unknown'}</td>
                  <td className="ui-col-amount">{money(s.grossEarnings)}</td>
                  <td className="ui-col-amount">{money(s.totalDeductions)}</td>
                  <td className="ui-col-amount">{money(s.employerCost)}</td>
                  <td className="ui-col-amount font-medium">{money(s.netPay)}</td>
                  <td className="ui-col-amount">{s.previousNetPay == null ? '—' : money(s.previousNetPay)}</td>
                  <td className="ui-col-amount" style={big ? { color: 'rgb(var(--warn-ink))' } : undefined}>
                    {s.variancePercent == null ? '—' : `${s.variancePercent > 0 ? '+' : ''}${s.variancePercent.toFixed(1)}%`}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};

/**
 * What payroll will write to the books, shown before it writes it.
 *
 * The entry, in full, with whatever would stop it. Finance seeing payroll only
 * after it has been posted is how a misconfigured component becomes a
 * correcting journal next month.
 */
const BooksStage = ({ runId, run, onPosted }) => {
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState('');
  const [posting, setPosting] = useState(false);

  useEffect(() => {
    let alive = true;
    previewPayrollPosting(runId)
      .then((p) => alive && setPreview(p))
      .catch((e) => alive && setError(String(e?.message || 'Could not work out the entry.')));
    return () => {
      alive = false;
    };
  }, [runId, run.status]);

  if (error) {
    return (
      <div className="ui-card p-3 text-sm" role="alert" style={{ borderColor: 'rgb(var(--neg))', color: 'rgb(var(--neg))' }}>
        {error}
      </div>
    );
  }
  if (!preview) return <SkeletonCard lines={4} />;

  const post = async () => {
    setPosting(true);
    try {
      const out = await postPayrollRun(runId);
      notify.success(out?.replayed ? 'Already posted.' : 'Posted to the books.');
      onPosted();
    } catch (e) {
      notify.error(String(e?.message || 'Could not post that payroll.'));
    } finally {
      setPosting(false);
    }
  };

  return (
    <div className="space-y-3">
      {preview.alreadyPosted ? (
        <p className="ui-caption">
          Posted on {shownDate(String(preview.alreadyPosted.postedAt || '').slice(0, 10))}. This is the entry it made.
        </p>
      ) : null}

      {preview.problems.length ? (
        <ul className="ui-card overflow-hidden">
          {preview.problems.map((p, i) => (
            <li
              key={i}
              className="flex items-start gap-2 px-4 py-2.5 text-sm"
              style={{ borderTop: i ? '1px solid rgb(var(--border))' : 'none', color: 'rgb(var(--neg))' }}
            >
              <AlertTriangle size={15} aria-hidden="true" className="mt-0.5 shrink-0" />
              <span>{p.message}</span>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="ui-card overflow-hidden">
        <div className="overflow-x-auto ui-table-scroll">
          <table className="ui-table w-full">
            <thead>
              <tr>
                <th scope="col" className="ui-th">Ledger</th>
                <th scope="col" className="ui-th ui-col-h-right">Debit</th>
                <th scope="col" className="ui-th ui-col-h-right">Credit</th>
              </tr>
            </thead>
            <tbody>
              {preview.lines.map((l, i) => (
                <tr key={`${l.ledgerAccountId}-${i}`}>
                  <td className="ui-col-entity">{l.ledgerName}</td>
                  <td className="ui-col-amount">{l.debit > 0 ? money(l.debit) : ''}</td>
                  <td className="ui-col-amount">{l.credit > 0 ? money(l.credit) : ''}</td>
                </tr>
              ))}
              <tr>
                <td className="ui-col-entity font-medium">Total</td>
                <td className="ui-col-amount font-medium">{money(preview.totalDebit)}</td>
                <td className="ui-col-amount font-medium">{money(preview.totalCredit)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex items-center justify-between gap-3">
        <span className={`ui-pill ${preview.balanced ? 'ui-pill-pos' : 'ui-pill-neg'}`}>
          {preview.balanced ? 'Balanced' : 'Does not balance'}
        </span>
        {!preview.alreadyPosted && preview.balanced && !preview.problems.length && ['APPROVED', 'LOCKED'].includes(run.status) ? (
          <button type="button" className="ui-btn ui-btn-primary" onClick={post} disabled={posting}>
            {posting ? 'Posting…' : 'Post to accounts'}
          </button>
        ) : null}
      </div>
    </div>
  );
};
