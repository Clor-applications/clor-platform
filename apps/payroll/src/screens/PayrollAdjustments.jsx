import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Ban, Check, Clock, MinusCircle, Pencil, Percent, Plus, Trash2, Wallet } from '@ui/components/ui/lineIcons';

import { ColumnHeader, useColumnFilters } from '@ui/components/ColumnFilters';
import { useListSearch } from '@ui/components/ListToolbar';
import DocumentListShell from '@ui/components/list/DocumentListShell';
import { exportFormatFromKey, exportMenuItem, runListExport } from '@ui/components/list/exportMenu';
import { SkeletonCard, EmptyState } from '@ui/components/ui/Primitives';
import Drawer from '@ui/components/ui/Drawer';
import SuggestInput from '@ui/components/ui/SuggestInput';
import { confirmDialog, notify } from '@ui/components/ui/notify';
import { listPayrollPeriods } from '../api/payrollCalendar';
import { listSalaryComponents } from '../api/payrollComponents';
import { listEmployees } from '../api/payrollPeople';
import {
  listPayrollAdjustments,
  listLeaveEncashments,
  createPayrollAdjustment,
  updatePayrollAdjustment,
  approvePayrollAdjustment,
  cancelPayrollAdjustment,
  deletePayrollAdjustment,
} from '../api/payrollAdjustments';
import LoadFailed from '@ui/components/ui/LoadFailed';
import { rupees as money } from '@ui/utils/money';

/**
 * Bonuses, arrears, fines — what happened to one person in one month.
 *
 * The screen is built around the two questions somebody actually has. "Is this
 * going to be paid?" is the status column, and "has it been paid?" is the same
 * column saying which payroll paid it, so nobody has to open a payslip to find
 * out. Everything else is a row in a list.
 *
 * Approving is deliberately a separate act from typing, and it is on the row
 * rather than inside the form: money added to a payslip with nobody else
 * looking at it is the easiest payroll fraud there is, and hiding the approval
 * inside the edit form makes the two look like one step.
 */

const STATUS = {
  DRAFT: { label: 'Draft', tone: 'ui-pill-neutral' },
  APPROVED: { label: 'Approved', tone: 'ui-pill-pos' },
  CONSUMED: { label: 'Paid', tone: 'ui-pill-pos' },
  CANCELLED: { label: 'Cancelled', tone: 'ui-pill-neutral' },
};


const TABS = [
  { value: '', label: 'All', tone: 'all' },
  { value: 'DRAFT', label: 'To approve', tone: 'outstanding' },
  { value: 'APPROVED', label: 'Approved', tone: 'sent' },
  { value: 'CONSUMED', label: 'Paid', tone: 'paid' },
  { value: 'CANCELLED', label: 'Cancelled', tone: 'cancelled' },
];
const COLUMNS = {
  employee: (r) => r.employeeName,
  what: (r) => r.componentName,
  month: (r) => r.periodName || '—',
};
const signed = (r) => (r.type === 'DEDUCTION' ? -Number(r.amount || 0) : Number(r.amount || 0));
const EXPORT_COLUMNS = [
  { key: 'employeeName', label: 'Employee' },
  { key: 'employeeCode', label: 'Code' },
  { key: 'componentName', label: 'What' },
  { key: 'periodName', label: 'Month' },
  { key: 'amount', label: 'Amount', value: (r) => signed(r) },
  { key: 'reason', label: 'Why' },
  { key: 'status', label: 'Status', value: (r) => STATUS[r.status]?.label || r.status },
  { key: 'consumedByRunNumber', label: 'Paid on run' },
];

export default function PayrollAdjustments() {
  const [all, setAll] = useState(null);
  const [encashments, setEncashments] = useState([]);
  const [periods, setPeriods] = useState([]);
  const [components, setComponents] = useState([]);
  const [people, setPeople] = useState([]);
  const [error, setError] = useState('');
  const [periodFilter, setPeriodFilter] = useState('');
  const [status, setStatus] = useState('');
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState('');

  const load = useCallback(() => {
    Promise.all([
      listPayrollAdjustments({ periodId: periodFilter }),
      listPayrollPeriods(),
      listSalaryComponents({ activeOnly: true }),
      listEmployees({ status: 'ACTIVE' }),
      listLeaveEncashments(),
    ])
      .then(([adjustments, periodRows, componentRows, employeeRows, leaveRows]) => {
        setAll(adjustments);
        setEncashments(leaveRows);
        setPeriods(periodRows);
        /* An employer contribution is a company cost, not something to add to or
           take off somebody's pay, so it is not offered. */
        setComponents(componentRows.filter((c) => c.type !== 'EMPLOYER_CONTRIBUTION'));
        setPeople(employeeRows.employees);
        setError('');
      })
      .catch((e) => setError(String(e?.message || 'Could not load adjustments.')));
  }, [periodFilter]);

  useEffect(() => {
    load();
  }, [load]);

  const openPeriods = useMemo(() => periods.filter((p) => !p.isLocked), [periods]);
  const canAdd = openPeriods.length > 0 && components.length > 0;

  const act = async (fn, done, id) => {
    setBusy(id);
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

  const remove = async (row) => {
    const ok = await confirmDialog({
      title: 'Delete this draft?',
      message: 'Nobody has approved it, so there is nothing to keep a record of.',
      confirmLabel: 'Yes, delete',
    });
    if (!ok) return;
    act(() => deletePayrollAdjustment(row.id), 'Deleted.', row.id);
  };

  /* Money still owed, carried forward by a payroll: cancelled only with a reason (QA of #82, F2). */
  const [letGo, setLetGo] = useState(null);
  const cancel = async (row) => {
    if (row.carried) {
      setLetGo(row);
      return;
    }
    const ok = await confirmDialog({
      title: 'Cancel this adjustment?',
      message: 'It stays in the list, marked cancelled, so the decision not to pay it is visible.',
      confirmLabel: 'Yes, cancel it',
    });
    if (!ok) return;
    act(() => cancelPayrollAdjustment(row.id), 'Cancelled.', row.id);
  };

  const counts = useMemo(() => {
    const list = all || [];
    const n = (st) => list.filter((r) => r.status === st).length;
    return { '': list.length, DRAFT: n('DRAFT'), APPROVED: n('APPROVED'), CONSUMED: n('CONSUMED'), CANCELLED: n('CANCELLED') };
  }, [all]);
  const figures = useMemo(() => {
    const list = all || [];
    const sum = (f) => list.filter(f).reduce((a, r) => a + signed(r), 0);
    return {
      toApprove: sum((r) => r.status === 'DRAFT'),
      toPay: sum((r) => r.status === 'APPROVED'),
      paid: sum((r) => r.status === 'CONSUMED'),
      deductions: list.filter((r) => r.type === 'DEDUCTION' && r.status !== 'CANCELLED').reduce((a, r) => a + Number(r.amount || 0), 0),
    };
  }, [all]);
  const inTab = useMemo(() => (all || []).filter((r) => !status || r.status === status), [all, status]);
  const search = useListSearch(inTab, ['employeeName', 'employeeCode', 'componentName', 'reason']);
  const filters = useColumnFilters();
  const rows = filters.applyFilters(search.filtered, COLUMNS);
  const create = () => setEditing({});
  const monthName = periods.find((p) => p.id === periodFilter)?.name || '';

  return (
    <DocumentListShell
      entity="payAdjustment"
      title="Adjustments"
      description="One-off earnings and deductions for a single month — a bonus, an arrear, a recovery. Approved before payroll pays them."
      compact
      tight
      denseCards
      search={{ value: search.query, onChange: search.setQuery, placeholder: 'Search adjustments…', label: 'Search adjustments' }}
      moreItems={all?.length ? [exportMenuItem('Export adjustments')] : null}
      onMoreSelect={(k) => {
        const format = exportFormatFromKey(k);
        if (!format) return;
        runListExport({ format, title: 'Adjustments', subtitle: monthName, fileName: `Adjustments${monthName ? ` ${monthName}` : ''}`, label: 'adjustment/adjustments', columns: EXPORT_COLUMNS, rows });
      }}
      primary={
        <button type="button" className="ui-btn ui-btn-primary" onClick={create} disabled={!canAdd}>
          <Plus size={16} aria-hidden="true" /> New adjustment
        </button>
      }
      cards={[
        { label: 'To approve', value: figures.toApprove, tone: 'outstanding', Icon: Clock, onSelect: () => setStatus('DRAFT') },
        { label: 'Approved', value: figures.toPay, tone: 'sent', Icon: Check, onSelect: () => setStatus('APPROVED') },
        { label: 'Paid', value: figures.paid, tone: 'paid', Icon: Wallet, onSelect: () => setStatus('CONSUMED') },
        { label: 'Deductions', value: figures.deductions, tone: 'overdue', Icon: MinusCircle },
      ]}
      tabs={TABS}
      statusValue={status}
      statusCounts={counts}
      onStatusChange={setStatus}
      tabsLabel="Adjustment status"
      tabsExtras={
        periods.length ? (
          <select className="ui-select ui-btn-sm !w-auto" value={periodFilter} onChange={(e) => setPeriodFilter(e.target.value)} aria-label="Month">
            <option value="">Every month</option>
            {periods.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        ) : null
      }
    >
      <LoadFailed message={error} onRetry={load} />
      {!all ? (
        error ? null : <SkeletonCard lines={4} />
      ) : (
        <div className="ui-table-scroll">
          <table className="ui-table ui-table-sticky w-full">
            <thead>
              <tr>
                <ColumnHeader label="Employee" col="employee" state={filters} />
                <ColumnHeader label="What" col="what" state={filters} />
                <ColumnHeader label="Month" col="month" state={filters} />
                <th scope="col" className="ui-num">Amount</th>
                <th scope="col" className="ui-col-grow">Why</th>
                <th scope="col" className="ui-col-h-center">Status</th>
                <th scope="col"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody className="ui-rows">
              {!rows.length ? (
                <tr>
                  <td colSpan={7}>
                    {inTab.length ? (
                      <EmptyState kind="filtered" totalCount={inTab.length} title="No adjustments match" description="Nothing in this tab matches the search or the column filters." />
                    ) : !openPeriods.length && !(all || []).length ? (
                      <EmptyState
                        icon={Percent}
                        title="No open month to adjust"
                        description="An adjustment is paid in a particular month. Add an open payroll period under Settings → Pay Calendar first."
                      />
                    ) : (
                      <EmptyState
                        icon={Percent}
                        title={periodFilter ? 'Nothing adjusted in this month' : status ? `No ${TABS.find((t) => t.value === status)?.label.toLowerCase()} adjustments` : 'No adjustments yet'}
                        description="A bonus, an arrear, a fine — anything that happened to one person in one month rather than being part of what they are on."
                        routes={canAdd && !status ? [{ label: 'New adjustment', description: 'One person, one month, one amount.', onSelect: create }] : undefined}
                      />
                    )}
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <tr key={r.id}>
                    <td className="ui-col-entity">
                      {r.employeeName}
                      {r.employeeCode ? <span className="ui-caption"> · {r.employeeCode}</span> : null}
                    </td>
                    <td className="ui-col-meta">{r.componentName}</td>
                    <td className="ui-col-meta">{r.periodName || '—'}</td>
                    <td className="ui-num">
                      {/* A deduction reads as one: the sign is the point. */}
                      {r.type === 'DEDUCTION' ? `−${money(r.amount)}` : money(r.amount)}
                    </td>
                    <td className="ui-col-meta ui-col-grow whitespace-normal">{r.reason || '—'}</td>
                    <td className="ui-col-h-center">
                      <span className={`ui-pill ${STATUS[r.status]?.tone || 'ui-pill-neutral'}`}>{STATUS[r.status]?.label || r.status}</span>
                      {r.consumedByRunNumber ? <span className="ui-caption"> on {r.consumedByRunNumber}</span> : null}
                    </td>
                    <td>
                      <div className="flex items-center justify-end gap-1">
                        {r.status === 'DRAFT' ? (
                          <button
                            type="button"
                            className="ui-icon-btn"
                            aria-label={`Approve the ${r.componentName} for ${r.employeeName}`}
                            disabled={busy === r.id}
                            onClick={() => act(() => approvePayrollAdjustment(r.id), 'Approved.', r.id)}
                          >
                            <Check size={16} aria-hidden="true" />
                          </button>
                        ) : null}
                        {['DRAFT', 'APPROVED'].includes(r.status) && (!r.carried || r.carried.final) ? (
                          <button type="button" className="ui-icon-btn" aria-label={`Edit the ${r.componentName} for ${r.employeeName}`} onClick={() => setEditing(r)}>
                            <Pencil size={16} aria-hidden="true" />
                          </button>
                        ) : null}
                        {r.status === 'APPROVED' ? (
                          <button type="button" className="ui-icon-btn" aria-label={`Cancel the ${r.componentName} for ${r.employeeName}`} disabled={busy === r.id} onClick={() => cancel(r)}>
                            <Ban size={16} aria-hidden="true" />
                          </button>
                        ) : null}
                        {r.status === 'DRAFT' ? (
                          <button type="button" className="ui-icon-btn" aria-label={`Delete the ${r.componentName} for ${r.employeeName}`} disabled={busy === r.id} onClick={() => remove(r)}>
                            <Trash2 size={16} aria-hidden="true" />
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}

      <Drawer
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
        title={editing?.carried ? 'Correct a carried deduction' : editing?.id ? 'Edit adjustment' : 'New adjustment'}
        description={
          editing?.carried
            ? 'The rest of a deduction a payroll carried forward. Only the amount changes, with a reason, and it goes back for approval.'
            : editing?.status === 'APPROVED'
            ? 'Changing this sends it back for approval — the approval was of an amount, not of a row.'
            : 'One person, one month, one amount.'
        }
      >
        {editing ? (
          <AdjustmentForm
            row={editing}
            people={people}
            encashments={encashments}
            components={components}
            periods={openPeriods}
            onCancel={() => setEditing(null)}
            onSaved={() => {
              setEditing(null);
              load();
            }}
          />
        ) : null}
      </Drawer>
      <Drawer open={Boolean(letGo)} onClose={() => setLetGo(null)} title="Cancel a carried deduction" description="This is money still owed, carried forward from an earlier payslip. Say why it is let go; the reason stays on the row and in the audit log.">
        {letGo ? (
          <CancelCarried
            row={letGo}
            busy={busy === letGo.id}
            onCancel={() => setLetGo(null)}
            onConfirm={(reason) => {
              const row = letGo;
              setLetGo(null);
              act(() => cancelPayrollAdjustment(row.id, reason), 'Cancelled.', row.id);
            }}
          />
        ) : null}
      </Drawer>
    </DocumentListShell>
  );
}

const CancelCarried = ({ row, busy, onCancel, onConfirm }) => {
  const [reason, setReason] = useState('');
  const why = reason.trim();
  return (
    <div className="space-y-4">
      <p className="text-sm">{row.componentName} for {row.employeeName}: <span className="ui-num tabular-nums">₹{Number(row.amount).toLocaleString('en-IN')}</span></p>
      <label className="block">
        <span className="ui-label">Why is it cancelled?</span>
        <SuggestInput value={reason} onChange={setReason} maxLength={200} placeholder="e.g. Waived by the owner, 2 Nov" suggestions={[]} aria-label="Why is it cancelled?" />
      </label>
      <div className="flex items-center justify-end gap-2">
        <button type="button" className="ui-btn ui-btn-secondary" onClick={onCancel}>Keep it</button>
        <button type="button" className="ui-btn ui-btn-primary" disabled={busy || why.length < 5} onClick={() => onConfirm(why)}>Cancel it</button>
      </div>
    </div>
  );
};

const AdjustmentForm = ({ row, people, components, periods, encashments, onCancel, onSaved }) => {
  const [form, setForm] = useState({
    leaveEncashmentId: '',
    employeeId: row.employeeId || people[0]?.id || '',
    componentId: row.componentId || components[0]?.id || '',
    periodId: row.periodId || periods[0]?.id || '',
    amount: row.amount ?? '',
    reason: row.reason || '',
    reference: row.reference || '',
    correctionReason: '',
  });
  /* A carried row: only its amount, with a reason (QA of #82, F2). */
  const carried = Boolean(row.carried);
  const [saving, setSaving] = useState(false);
  const set = (patch) => setForm((p) => ({ ...p, ...patch }));

  const chosen = components.find((c) => c.id === form.componentId);

  const save = async (e) => {
    e.preventDefault();
    const amount = Number(form.amount);
    if (!(amount > 0)) {
      notify.error('An adjustment of nothing changes nothing.');
      return;
    }
    if (carried && form.correctionReason.trim().length < 5) {
      notify.error('Say why the amount is corrected.');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        ...(form.leaveEncashmentId ? { leaveEncashmentId: form.leaveEncashmentId } : {}),
        employeeId: form.employeeId,
        componentId: form.componentId,
        periodId: form.periodId,
        amount,
        reason: form.reason.trim() || null,
        reference: form.reference.trim() || null,
        ...(carried ? { correctionReason: form.correctionReason.trim() } : {}),
      };
      if (row.id) await updatePayrollAdjustment(row.id, payload);
      else await createPayrollAdjustment(payload);
      notify.success(row.id ? 'Saved.' : 'Added, waiting for approval.');
      onSaved();
    } catch (err) {
      notify.error(String(err?.message || 'Could not save that adjustment.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={save} className="space-y-4">
      {!row.id && encashments.some((r) => r.employeeId === form.employeeId) ? <label className="block"><span className="ui-label">Leave encashment</span><select className="ui-select w-full" value={form.leaveEncashmentId} onChange={(e) => { const picked = encashments.find((r) => r.id === e.target.value); set({ leaveEncashmentId: e.target.value, ...(picked?.amount ? { amount: String(picked.amount) } : {}) }); }}><option value="">Not a leave payout</option>{encashments.filter((r) => r.employeeId === form.employeeId).map((r) => <option key={r.id} value={r.id}>{r.days} days · {r.reason}</option>)}</select><span className="ui-caption">{encashments.find((r) => r.id === form.leaveEncashmentId)?.explanation || 'Choose an earning component and enter the approved payout amount below. This links the leave debit to its payslip.'}</span></label> : null}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="sm:col-span-2">
          <label className="ui-label" htmlFor="adj-employee">Who</label>
          <select id="adj-employee" className="ui-select w-full" disabled={carried} value={form.employeeId} onChange={(e) => set({ employeeId: e.target.value, leaveEncashmentId: '' })} required>
            {/* A row's own person stays choosable after they leave: a leaver's recovery is still corrected here. */}
            {row.employeeId && !people.some((p) => p.id === row.employeeId) ? (
              <option value={row.employeeId}>{row.employeeName || 'This person'}{row.employeeCode ? ` · ${row.employeeCode}` : ''}</option>
            ) : null}
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}{p.code ? ` · ${p.code}` : ''}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="ui-label" htmlFor="adj-component">What</label>
          <select id="adj-component" className="ui-select w-full" disabled={carried} value={form.componentId} onChange={(e) => set({ componentId: e.target.value })} required>
            {components.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          <span className="ui-caption">
            {chosen?.type === 'DEDUCTION' ? 'Taken off this month’s pay.' : 'Added to this month’s pay.'}
          </span>
        </div>

        <div>
          <label className="ui-label" htmlFor="adj-period">Month</label>
          <select id="adj-period" className="ui-select w-full" disabled={carried} value={form.periodId} onChange={(e) => set({ periodId: e.target.value })} required>
            {row.periodId && !periods.some((p) => p.id === row.periodId) ? <option value={row.periodId}>{row.periodName || 'Its month'}</option> : null}
            {periods.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          <span className="ui-caption">{carried ? 'Taken by the next payroll for this person, whichever month that is.' : 'Only this month. It does not carry into the next.'}</span>
        </div>

        <div>
          <label className="ui-label" htmlFor="adj-amount">Amount</label>
          <input
            id="adj-amount"
            type="number"
            min="0"
            step="0.01"
            className="ui-input ui-num w-full"
            value={form.amount}
            onChange={(e) => set({ amount: e.target.value })}
            required
          />
        </div>

        <div>
          <label className="ui-label" htmlFor="adj-reference">Reference</label>
          <input id="adj-reference" className="ui-input w-full" value={form.reference} onChange={(e) => set({ reference: e.target.value })} />
        </div>

        {carried ? (
          <div className="sm:col-span-2">
            <label className="ui-label" htmlFor="adj-correction">Why is the amount corrected?</label>
            <SuggestInput id="adj-correction" value={form.correctionReason} onChange={(v) => set({ correctionReason: v })} maxLength={160} placeholder="e.g. Agreed with the owner, 2 Nov" suggestions={[]} aria-label="Why is the amount corrected?" />
            <span className="ui-caption">Kept on the row and in the audit log.</span>
          </div>
        ) : null}

        <div className="sm:col-span-2">
          <label className="ui-label" htmlFor="adj-reason">Why</label>
          <input
            id="adj-reason"
            className="ui-input w-full"
            value={form.reason}
            onChange={(e) => set({ reason: e.target.value })}
            placeholder="Q4 bonus, arrears for March, canteen recovery…"
          />
          <span className="ui-caption">Whoever approves this reads only what is written here.</span>
        </div>
      </div>

      <div className="flex items-center justify-end gap-2">
        <button type="button" className="ui-btn ui-btn-secondary" onClick={onCancel} disabled={saving}>Cancel</button>
        <button type="submit" className="ui-btn ui-btn-primary" disabled={saving}>
          {saving ? 'Saving…' : row.id ? 'Save' : 'Add'}
        </button>
      </div>
    </form>
  );
};
