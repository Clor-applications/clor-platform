import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Lock, LockOpen, Plus, Trash2 } from 'lucide-react';

import { SkeletonCard, EmptyState } from '@ui/components/ui/Primitives';
import SettingsScreenHeader from '@ui/chrome/SettingsScreenHeader';
import Drawer from '@ui/components/ui/Drawer';
import { confirmDialog, notify } from '@ui/components/ui/notify';
import {
  listPayrollPeriods,
  createPayrollPeriod,
  updatePayrollPeriod,
  setPayrollPeriodLock,
  deletePayrollPeriod,
} from '../api/payrollCalendar';

/**
 * The pay cycles a run is filed against.
 *
 * The act that matters on this screen is locking, not editing. A period is
 * typed once and then lived in: payroll is run against it, returns are filed,
 * money goes out, and at some point it is closed. So the lock is on the row
 * rather than buried in the form, and a locked row says plainly that it is
 * finished rather than offering controls that will be refused.
 */

const FREQUENCIES = [
  { id: 'MONTHLY', label: 'Monthly' },
  { id: 'WEEKLY', label: 'Weekly' },
  { id: 'FORTNIGHTLY', label: 'Fortnightly' },
  { id: 'CUSTOM', label: 'Custom' },
];

const labelFor = (id) => FREQUENCIES.find((f) => f.id === id)?.label || id;

/** Read the way this country writes a date; the ISO value stays underneath. */
const shown = (iso) => {
  const s = String(iso || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return '—';
  const [y, m, d] = s.split('-');
  return `${d}/${m}/${y}`;
};

/** The month after the last period, which is what somebody is about to add. */
const nextMonthFrom = (rows) => {
  const last = rows.find((r) => r.frequency === 'MONTHLY');
  const base = last ? new Date(`${last.endDate}T12:00:00`) : new Date();
  const start = last ? new Date(base.getFullYear(), base.getMonth() + 1, 1) : new Date(base.getFullYear(), base.getMonth(), 1);
  const end = new Date(start.getFullYear(), start.getMonth() + 1, 0);
  const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const name = start.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });
  return { name, startDate: iso(start), endDate: iso(end), paymentDate: iso(end), frequency: 'MONTHLY' };
};

const describeUsage = (u) => {
  if (!u || !u.total) return '—';
  const parts = [
    u.runs ? `${u.runs} run${u.runs === 1 ? '' : 's'}` : null,
    u.slips ? `${u.slips} payslip${u.slips === 1 ? '' : 's'}` : null,
    u.adjustments ? `${u.adjustments} adjustment${u.adjustments === 1 ? '' : 's'}` : null,
  ].filter(Boolean);
  return parts.join(', ');
};

export default function PayrollPeriods() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState('');

  const load = useCallback(async () => {
    try {
      setRows(await listPayrollPeriods());
      setError('');
    } catch (e) {
      setError(String(e?.message || 'Could not load payroll periods.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const suggestion = useMemo(() => nextMonthFrom(rows), [rows]);

  const toggleLock = async (row) => {
    if (row.isLocked) {
      const ok = await confirmDialog({
        title: `Reopen ${row.name}?`,
        message:
          'A closed period has usually been paid and reported. Reopening it allows new payroll for a month that has already been filed.',
        confirmLabel: 'Yes, reopen',
      });
      if (!ok) return;
    }
    setBusy(row.id);
    try {
      await setPayrollPeriodLock(row.id, !row.isLocked);
      notify.success(row.isLocked ? `${row.name} reopened.` : `${row.name} closed.`);
      load();
    } catch (e) {
      notify.error(String(e?.message || 'Could not change that period.'));
    } finally {
      setBusy('');
    }
  };

  const remove = async (row) => {
    const ok = await confirmDialog({
      title: `Delete ${row.name}?`,
      message: 'A period with no payroll behind it can be deleted. One that has been run cannot.',
      confirmLabel: 'Yes, delete',
    });
    if (!ok) return;
    try {
      await deletePayrollPeriod(row.id);
      notify.success(`${row.name} deleted.`);
      load();
    } catch (e) {
      notify.error(String(e?.message || 'Could not delete that period.'));
    }
  };

  if (loading) return <SkeletonCard lines={5} />;

  return (
    <div className="space-y-6">
      <SettingsScreenHeader
        entity="settings"
        title="Payroll periods"
        description="The pay cycles a run belongs to, and which of them are closed."
        actions={
          <button type="button" className="ui-btn ui-btn-primary" onClick={() => setEditing(suggestion)}>
            <Plus size={16} aria-hidden="true" /> New period
          </button>
        }
      />

      {error ? (
        <div className="ui-card p-3 text-sm" role="alert" style={{ borderColor: 'rgb(var(--neg))', color: 'rgb(var(--neg))' }}>
          {error}
        </div>
      ) : null}

      {rows.length === 0 ? (
        <EmptyState
          title="No payroll periods yet"
          description="Every payslip is filed against a period. Add the first one and payroll has a month to run for."
          action={
            <button type="button" className="ui-btn ui-btn-primary" onClick={() => setEditing(suggestion)}>
              <Plus size={16} aria-hidden="true" /> New period
            </button>
          }
        />
      ) : (
        <div className="ui-card overflow-hidden">
          <div className="overflow-x-auto ui-table-scroll">
            <table className="ui-table w-full">
              <thead>
                <tr>
                  <th scope="col" className="ui-th">Period</th>
                  <th scope="col" className="ui-th">Cycle</th>
                  <th scope="col" className="ui-th ui-col-h-center">From</th>
                  <th scope="col" className="ui-th ui-col-h-center">To</th>
                  <th scope="col" className="ui-th ui-col-h-center">Paid on</th>
                  <th scope="col" className="ui-th">Payroll</th>
                  <th scope="col" className="ui-th ui-col-h-center">Status</th>
                  <th scope="col" className="ui-th ui-col-h-center w-10">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => (
                  <tr
                    key={p.id}
                    className={p.isLocked ? '' : 'ui-row-click'}
                    onClick={p.isLocked ? undefined : () => setEditing(p)}
                  >
                    <td className="ui-col-entity">{p.name}</td>
                    <td className="ui-col-meta">{labelFor(p.frequency)}</td>
                    <td className="ui-col-date ui-col-h-center">{shown(p.startDate)}</td>
                    <td className="ui-col-date ui-col-h-center">{shown(p.endDate)}</td>
                    <td className="ui-col-date ui-col-h-center">{shown(p.paymentDate)}</td>
                    <td className="ui-col-meta">{describeUsage(p.usage)}</td>
                    <td>
                      <span className={`ui-pill ${p.isLocked ? 'ui-pill-neutral' : 'ui-pill-pos'}`}>
                        {p.isLocked ? 'Closed' : 'Open'}
                      </span>
                    </td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-center gap-1">
                        <button
                          type="button"
                          className="ui-icon-btn"
                          aria-label={p.isLocked ? `Reopen ${p.name}` : `Close ${p.name}`}
                          title={p.isLocked ? 'Reopen' : 'Close'}
                          disabled={busy === p.id}
                          onClick={() => toggleLock(p)}
                        >
                          {p.isLocked ? <LockOpen size={16} aria-hidden="true" /> : <Lock size={16} aria-hidden="true" />}
                        </button>
                        {!p.isLocked && !p.usage?.total ? (
                          <button type="button" className="ui-icon-btn" aria-label={`Delete ${p.name}`} onClick={() => remove(p)}>
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
        title={editing?.id ? 'Edit period' : 'New payroll period'}
        description="The days this payroll covers, and when it is paid."
      >
        {editing ? (
          <PeriodForm
            initial={editing}
            onClose={() => setEditing(null)}
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

const PeriodForm = ({ initial, onClose, onSaved }) => {
  const [form, setForm] = useState(initial);
  const [saving, setSaving] = useState(false);
  const set = (patch) => setForm((p) => ({ ...p, ...patch }));

  /* Once payroll has been calculated, the dates are part of what it computed —
     proration is days in the period — so they stop being editable and the form
     says why rather than letting a save be refused. */
  const datesFixed = Number(initial?.usage?.total || 0) > 0;

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = {
        name: form.name,
        startDate: form.startDate,
        endDate: form.endDate,
        paymentDate: form.paymentDate || null,
        frequency: form.frequency,
      };
      if (initial.id) await updatePayrollPeriod(initial.id, payload);
      else await createPayrollPeriod(payload);
      notify.success(`${form.name} saved.`);
      onSaved();
    } catch (err) {
      notify.error(String(err?.message || 'Could not save that period.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={save} className="space-y-6">
      <div className="grid grid-cols-1 sm:grid-cols-[1fr_10rem] gap-3">
        <div>
          <label className="ui-label" htmlFor="period-name">Name</label>
          <input
            id="period-name"
            className="ui-input w-full"
            value={form.name}
            onChange={(e) => set({ name: e.target.value })}
            required
            autoFocus
          />
          <span className="ui-caption">What people call it — "September 2026".</span>
        </div>
        <div>
          <label className="ui-label" htmlFor="period-frequency">Cycle</label>
          <select
            id="period-frequency"
            className="ui-select w-full"
            value={form.frequency}
            onChange={(e) => set({ frequency: e.target.value })}
            disabled={datesFixed}
          >
            {FREQUENCIES.map((f) => (
              <option key={f.id} value={f.id}>{f.label}</option>
            ))}
          </select>
        </div>
      </div>

      <fieldset className="contents" disabled={datesFixed}>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className="ui-label" htmlFor="period-start">From</label>
            <input
              id="period-start"
              type="date"
              className="ui-input w-full"
              value={form.startDate || ''}
              onChange={(e) => set({ startDate: e.target.value })}
              required
            />
          </div>
          <div>
            <label className="ui-label" htmlFor="period-end">To</label>
            <input
              id="period-end"
              type="date"
              className="ui-input w-full"
              value={form.endDate || ''}
              onChange={(e) => set({ endDate: e.target.value })}
              required
            />
          </div>
          <div>
            <label className="ui-label" htmlFor="period-payment">Paid on</label>
            <input
              id="period-payment"
              type="date"
              className="ui-input w-full"
              value={form.paymentDate || ''}
              onChange={(e) => set({ paymentDate: e.target.value })}
            />
          </div>
        </div>
      </fieldset>

      {datesFixed ? (
        <p className="ui-caption">
          Payroll has already been run for this period, so its dates are fixed — proration counts the days in it, and moving
          them would leave the payslips describing a month they were not calculated for. The name can still change.
        </p>
      ) : null}

      <div className="flex items-center justify-end gap-2 pt-1">
        <button type="button" className="ui-btn ui-btn-secondary" onClick={onClose} disabled={saving}>
          Cancel
        </button>
        <button type="submit" className="ui-btn ui-btn-primary" disabled={saving}>
          {saving ? 'Saving…' : 'Save period'}
        </button>
      </div>
    </form>
  );
};
