import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Ban, Check, Pencil, Plus, Trash2 } from 'lucide-react';

import { PageHeader, SkeletonCard, EmptyState } from '@ui/components/ui/Primitives';
import Drawer from '@ui/components/ui/Drawer';
import { confirmDialog, notify } from '@ui/components/ui/notify';
import { listPayrollPeriods } from '../api/payrollCalendar';
import { listSalaryComponents } from '../api/payrollComponents';
import { listEmployees } from '../api/payrollPeople';
import {
  listPayrollAdjustments,
  createPayrollAdjustment,
  updatePayrollAdjustment,
  approvePayrollAdjustment,
  cancelPayrollAdjustment,
  deletePayrollAdjustment,
} from '../api/payrollAdjustments';

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

const money = (n) => `₹${Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

export default function PayrollAdjustments() {
  const [rows, setRows] = useState([]);
  const [periods, setPeriods] = useState([]);
  const [components, setComponents] = useState([]);
  const [people, setPeople] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [periodFilter, setPeriodFilter] = useState('');
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState('');

  const load = useCallback(async () => {
    try {
      const [adjustments, periodRows, componentRows, employeeRows] = await Promise.all([
        listPayrollAdjustments({ periodId: periodFilter }),
        listPayrollPeriods(),
        listSalaryComponents({ activeOnly: true }),
        listEmployees({ status: 'ACTIVE' }),
      ]);
      setRows(adjustments);
      setPeriods(periodRows);
      /* An employer contribution is a company cost, not something to add to or
         take off somebody's pay, so it is not offered. */
      setComponents(componentRows.filter((c) => c.type !== 'EMPLOYER_CONTRIBUTION'));
      setPeople(employeeRows.employees);
      setError('');
    } catch (e) {
      setError(String(e?.message || 'Could not load adjustments.'));
    } finally {
      setLoading(false);
    }
  }, [periodFilter]);

  useEffect(() => {
    load();
  }, [load]);

  const openPeriods = useMemo(() => periods.filter((p) => !p.isLocked), [periods]);

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

  const cancel = async (row) => {
    const ok = await confirmDialog({
      title: 'Cancel this adjustment?',
      message: 'It stays in the list, marked cancelled, so the decision not to pay it is visible.',
      confirmLabel: 'Yes, cancel it',
    });
    if (!ok) return;
    act(() => cancelPayrollAdjustment(row.id), 'Cancelled.', row.id);
  };

  if (loading) return <SkeletonCard lines={6} />;

  return (
    <div className="space-y-6">
      <PageHeader
        entity="settings"
        title="Adjustments"
        description="One-off earnings and deductions for a single month — a bonus, an arrear, a recovery. Approved before payroll pays them."
        actions={
          <button type="button" className="ui-btn ui-btn-primary" onClick={() => setEditing({})} disabled={!openPeriods.length || !components.length}>
            <Plus size={16} aria-hidden="true" /> New adjustment
          </button>
        }
      />

      {error ? (
        <div className="ui-card p-3 text-sm" role="alert" style={{ borderColor: 'rgb(var(--neg))', color: 'rgb(var(--neg))' }}>
          {error}
        </div>
      ) : null}

      {periods.length ? (
        <div className="flex items-end gap-3">
          <div className="max-w-xs w-full">
            <label className="ui-label" htmlFor="adj-period-filter">Month</label>
            <select id="adj-period-filter" className="ui-select w-full" value={periodFilter} onChange={(e) => setPeriodFilter(e.target.value)}>
              <option value="">Every month</option>
              {periods.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
        </div>
      ) : null}

      {!openPeriods.length && !rows.length ? (
        <EmptyState
          title="No open month to adjust"
          description="An adjustment is paid in a particular month. Add an open payroll period under Settings → Payroll → Payroll periods first."
        />
      ) : rows.length === 0 ? (
        <EmptyState
          title={periodFilter ? 'Nothing adjusted in this month' : 'No adjustments yet'}
          description="A bonus, an arrear, a fine — anything that happened to one person in one month rather than being part of what they are on."
          action={
            openPeriods.length && components.length ? (
              <button type="button" className="ui-btn ui-btn-primary" onClick={() => setEditing({})}>
                <Plus size={16} aria-hidden="true" /> New adjustment
              </button>
            ) : null
          }
        />
      ) : (
        <div className="ui-card overflow-hidden">
          <div className="overflow-x-auto ui-table-scroll">
            <table className="ui-table w-full">
              <thead>
                <tr>
                  <th scope="col" className="ui-th">Employee</th>
                  <th scope="col" className="ui-th">What</th>
                  <th scope="col" className="ui-th">Month</th>
                  <th scope="col" className="ui-th ui-col-h-right">Amount</th>
                  <th scope="col" className="ui-th">Why</th>
                  <th scope="col" className="ui-th ui-col-h-center">Status</th>
                  <th scope="col" className="ui-th ui-col-h-center">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td className="ui-col-entity">
                      {r.employeeName}
                      {r.employeeCode ? <span className="ui-caption"> · {r.employeeCode}</span> : null}
                    </td>
                    <td className="ui-col-meta">{r.componentName}</td>
                    <td className="ui-col-meta">{r.periodName || '—'}</td>
                    <td className="ui-col-amount">
                      {/* A deduction reads as one: the sign is the point. */}
                      {r.type === 'DEDUCTION' ? `−${money(r.amount)}` : money(r.amount)}
                    </td>
                    <td className="ui-col-meta">{r.reason || '—'}</td>
                    <td>
                      <span className={`ui-pill ${STATUS[r.status]?.tone || 'ui-pill-neutral'}`}>{STATUS[r.status]?.label || r.status}</span>
                      {r.consumedByRunNumber ? <span className="ui-caption"> on {r.consumedByRunNumber}</span> : null}
                    </td>
                    <td>
                      <div className="flex items-center justify-center gap-1">
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
                        {['DRAFT', 'APPROVED'].includes(r.status) ? (
                          <button
                            type="button"
                            className="ui-icon-btn"
                            aria-label={`Edit the ${r.componentName} for ${r.employeeName}`}
                            onClick={() => setEditing(r)}
                          >
                            <Pencil size={16} aria-hidden="true" />
                          </button>
                        ) : null}
                        {r.status === 'APPROVED' ? (
                          <button
                            type="button"
                            className="ui-icon-btn"
                            aria-label={`Cancel the ${r.componentName} for ${r.employeeName}`}
                            disabled={busy === r.id}
                            onClick={() => cancel(r)}
                          >
                            <Ban size={16} aria-hidden="true" />
                          </button>
                        ) : null}
                        {r.status === 'DRAFT' ? (
                          <button
                            type="button"
                            className="ui-icon-btn"
                            aria-label={`Delete the ${r.componentName} for ${r.employeeName}`}
                            disabled={busy === r.id}
                            onClick={() => remove(r)}
                          >
                            <Trash2 size={16} aria-hidden="true" />
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <Drawer
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
        title={editing?.id ? 'Edit adjustment' : 'New adjustment'}
        description={
          editing?.status === 'APPROVED'
            ? 'Changing this sends it back for approval — the approval was of an amount, not of a row.'
            : 'One person, one month, one amount.'
        }
      >
        {editing ? (
          <AdjustmentForm
            row={editing}
            people={people}
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
    </div>
  );
}

const AdjustmentForm = ({ row, people, components, periods, onCancel, onSaved }) => {
  const [form, setForm] = useState({
    employeeId: row.employeeId || people[0]?.id || '',
    componentId: row.componentId || components[0]?.id || '',
    periodId: row.periodId || periods[0]?.id || '',
    amount: row.amount ?? '',
    reason: row.reason || '',
    reference: row.reference || '',
  });
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
    setSaving(true);
    try {
      const payload = {
        employeeId: form.employeeId,
        componentId: form.componentId,
        periodId: form.periodId,
        amount,
        reason: form.reason.trim() || null,
        reference: form.reference.trim() || null,
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
    <form onSubmit={save} className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="sm:col-span-2">
          <label className="ui-label" htmlFor="adj-employee">Who</label>
          <select id="adj-employee" className="ui-select w-full" value={form.employeeId} onChange={(e) => set({ employeeId: e.target.value })} required>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}{p.code ? ` · ${p.code}` : ''}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="ui-label" htmlFor="adj-component">What</label>
          <select id="adj-component" className="ui-select w-full" value={form.componentId} onChange={(e) => set({ componentId: e.target.value })} required>
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
          <select id="adj-period" className="ui-select w-full" value={form.periodId} onChange={(e) => set({ periodId: e.target.value })} required>
            {periods.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          <span className="ui-caption">Only this month. It does not carry into the next.</span>
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
