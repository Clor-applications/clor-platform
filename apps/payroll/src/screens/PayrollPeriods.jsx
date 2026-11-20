import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarDays, Lock, Plus, Trash2 } from '@ui/components/ui/lineIcons';

import { ColumnHeader, useColumnFilters } from '@ui/components/ColumnFilters';
import { useListSearch } from '@ui/components/ListToolbar';
import DocumentListShell from '@ui/components/list/DocumentListShell';
import { exportFormatFromKey, exportMenuItem, runListExport } from '@ui/components/list/exportMenu';
import { SkeletonCard, EmptyState } from '@ui/components/ui/Primitives';
import Drawer from '@ui/components/ui/Drawer';
import { confirmDialog, notify } from '@ui/components/ui/notify';
import {
  listPayrollPeriods,
  createPayrollPeriod,
  updatePayrollPeriod,
  setPayrollPeriodLock,
  deletePayrollPeriod,
} from '../api/payrollCalendar';
import LoadFailed from '@ui/components/ui/LoadFailed';
import { CLOSED_MONTH_NOTE } from '@ui/picks/round54';
import { errorWords } from '@ui/utils/errorWords';
import { countItems } from '../components/countItems';
import { listPayrollRuns } from '../api/payrollRuns';
import { rupees, sumMoney } from '@ui/utils/money';
import { dateWords } from '@ui/utils/dates';
import { ExceptionTag } from '@ui/components/ui/ExceptionTag';

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

/* The consequence of closing a month that still has deductions nobody took, written here rather than shown as the server's text. */
const untakenWords = (untaken, name) => {
  const list = Array.isArray(untaken) ? untaken : [];
  const n = list.length;
  const total = list.reduce((t, u) => t + (Number(u.amount) || 0), 0);
  const what = n ? `${n} ${n === 1 ? 'deduction' : 'deductions'} due in ${name}, ${rupees(total)} in all, ${n === 1 ? 'was' : 'were'} not taken by any payslip.` : `Some deductions due in ${name} were not taken by any payslip.`;
  return `${what} Once the month is closed they are never taken, unless you move them to an open month first.`;
};

/** The question before a period is closed: its name, how many pay runs, and what they paid. `runs` null: not known. */
export const closeWords = (row, runs) => {
  const n = runs ? runs.length : Number(row?.usage?.runs || 0);
  const net = runs ? sumMoney(runs.map((r) => r.netTotal)) : null;
  const what = n
    ? `${n} pay ${n === 1 ? 'run' : 'runs'}${net != null ? `, ${rupees(net)} net pay in all` : ''}`
    : 'No pay run';
  return {
    title: `Close ${row.name}?`,
    message: `${what}. Once closed, nothing more can be paid or changed in ${row.name}; a mistake found later is put right in an open month.`,
    confirmLabel: 'Close period',
    tone: 'danger',
  };
};

/** Dates in words (DESIGN.md: "9 Dec 2026"), never DD/MM/YYYY. */
const shown = (iso) => dateWords(iso);

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

const TABS = [
  { value: '', label: 'All', tone: 'all' },
  { value: 'OPEN', label: 'Open', tone: 'outstanding' },
  { value: 'CLOSED', label: 'Closed', tone: 'cancelled' },
];
const COLUMNS = {
  name: (p) => p.name,
  cycle: (p) => labelFor(p.frequency),
};
const EXPORT_COLUMNS = [
  { key: 'name', label: 'Period' },
  { key: 'cycle', label: 'Cycle', value: (p) => labelFor(p.frequency) },
  { key: 'startDate', label: 'From', value: (p) => shown(p.startDate) },
  { key: 'endDate', label: 'To', value: (p) => shown(p.endDate) },
  { key: 'paymentDate', label: 'Paid on', value: (p) => shown(p.paymentDate) },
  { key: 'usage', label: 'Payroll', value: (p) => describeUsage(p.usage) },
  { key: 'isLocked', label: 'Status', value: (p) => (p.isLocked ? 'Closed' : 'Open') },
];

export default function PayrollPeriods({ menuLabel } = {}) {
  const [all, setAll] = useState(null);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(null);
  const [formDirty, setFormDirty] = useState(false);
  const [busy, setBusy] = useState('');
  const [status, setStatus] = useState('');

  const load = useCallback(() => {
    listPayrollPeriods()
      .then((v) => {
        setAll(v);
        setError('');
      })
      .catch((e) => setError(errorWords(e, 'load the pay calendar')));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const suggestion = useMemo(() => nextMonthFrom(all || []), [all]);

  const toggleLock = async (row) => {
    if (row.isLocked) {
      const ok = await confirmDialog({
        title: `Reopen ${row.name}?`,
        message:
          'A closed period has usually been paid and reported. Reopening it allows new payroll for a month that has already been filed.',
        confirmLabel: 'Reopen period',
      });
      if (!ok) return;
    } else {
      /* Closing is final (round 54: a closed month is never reopened), so it asks first and names what it closes. */
      if (busy) return;
      setBusy(row.id);
      let runs = null;
      try {
        runs = (await listPayrollRuns()).filter((r) => (r.periodId || r.period?.id) === row.id && r.status !== 'CANCELLED');
      } catch {
        runs = null;
      }
      setBusy('');
      const ok = await confirmDialog(closeWords(row, runs));
      if (!ok) return;
    }
    setBusy(row.id);
    try {
      try {
        await setPayrollPeriodLock(row.id, !row.isLocked);
      } catch (e) {
        /* A recovery due this month that no payslip took (QA of #82, F5): said first, closed only when told to. */
        if (e?.code !== 'UNTAKEN_RECOVERIES') throw e;
        const ok = await confirmDialog({
          title: `Close ${row.name} with deductions not taken?`,
          message: untakenWords(e?.data?.untaken, row.name),
          confirmLabel: 'Close anyway',
        });
        if (!ok) return;
        await setPayrollPeriodLock(row.id, true, true);
      }
      notify.success(row.isLocked ? `${row.name} reopened.` : `${row.name} closed.`);
      load();
    } catch (e) {
      notify.error(errorWords(e, 'change that period'));
    } finally {
      setBusy('');
    }
  };

  const remove = async (row) => {
    const ok = await confirmDialog({
      title: `Delete ${row.name}?`,
      message: 'A period with no payroll behind it can be deleted. One that has been run cannot.',
      confirmLabel: 'Delete period',
    });
    if (!ok) return;
    try {
      await deletePayrollPeriod(row.id);
      notify.success(`${row.name} deleted.`);
      load();
    } catch (e) {
      notify.error(errorWords(e, 'delete that period'));
    }
  };

  const counts = useMemo(() => {
    const list = all || [];
    const closed = list.filter((p) => p.isLocked).length;
    return { '': list.length, OPEN: list.length - closed, CLOSED: closed };
  }, [all]);
  const inTab = useMemo(() => (all || []).filter((p) => !status || (status === 'CLOSED') === Boolean(p.isLocked)), [all, status]);
  const search = useListSearch(inTab, ['name']);
  const filters = useColumnFilters();
  const rows = filters.applyFilters(search.filtered, COLUMNS);
  const figures = useMemo(() => {
    const list = all || [];
    return {
      run: list.filter((p) => p.usage?.runs).length,
      waiting: list.filter((p) => !p.isLocked && !p.usage?.runs).length,
    };
  }, [all]);
  const create = () => setEditing(suggestion);

  return (
    <DocumentListShell
      entity="payPeriod"
      title={menuLabel || 'Pay calendar'}
      description={`The pay cycles a run belongs to, and which of them are closed. ${CLOSED_MONTH_NOTE}`}
      compact
      tight
      search={{ value: search.query, onChange: search.setQuery, placeholder: 'Search periods…', label: 'Search the pay calendar' }}
      moreItems={all?.length ? [exportMenuItem('Export periods')] : null}
      onMoreSelect={(k) => {
        const format = exportFormatFromKey(k);
        if (!format) return;
        runListExport({ format, title: 'Pay calendar', fileName: 'Pay calendar', label: 'period/periods', columns: EXPORT_COLUMNS, rows });
      }}
      primary={
        <button type="button" className="ui-btn ui-btn-primary" onClick={create}>
          <Plus size={16} aria-hidden="true" /> New period
        </button>
      }
      countLine={countItems([
        { label: 'Open', value: counts.OPEN, count: true, tone: 'outstanding', onSelect: () => setStatus('OPEN') },
        { label: 'Closed', value: counts.CLOSED, count: true, tone: 'cancelled', onSelect: () => setStatus('CLOSED') },
        { label: 'With a pay run', value: figures.run, count: true, tone: 'paid' },
        { label: 'Not run yet', value: figures.waiting, count: true, tone: 'partial' },
      ])}
      tabs={TABS}
      statusValue={status}
      statusCounts={counts}
      onStatusChange={setStatus}
      tabsLabel="Open or closed"
    >
      <LoadFailed message={error} onRetry={load} />
      {!all ? (
        error ? null : <SkeletonCard lines={4} />
      ) : (
        <div className="ui-table-scroll">
          <table className="ui-table ui-table-sticky ui-table-phone w-full">
            <thead>
              <tr>
                <ColumnHeader label="Period" col="name" state={filters} />
                <ColumnHeader label="Cycle" col="cycle" state={filters} />
                <th scope="col" className="ui-col-h-center">From</th>
                <th scope="col" className="ui-col-h-center">To</th>
                <th scope="col" className="ui-col-h-center">Paid on</th>
                <th scope="col">Payroll</th>
                <th scope="col" className="ui-col-h-center">Status</th>
                <th scope="col"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody className="ui-rows">
              {!rows.length ? (
                <tr>
                  <td colSpan={8}>
                    {inTab.length ? (
                      <EmptyState kind="filtered" totalCount={inTab.length} title="No periods match" description="Nothing in this tab matches the search or the column filters." />
                    ) : (
                      <EmptyState
                        icon={CalendarDays}
                        title={status === 'OPEN' ? 'No open periods' : status === 'CLOSED' ? 'No closed periods yet' : 'No periods in the pay calendar yet'}
                        description="Every payslip is filed against a period. Add the first one and payroll has a month to run for."
                        routes={status ? undefined : [{ label: 'New period', description: `Starts with ${suggestion.name}.`, onSelect: create }]}
                      />
                    )}
                  </td>
                </tr>
              ) : (
                rows.map((p) => (
                  <tr key={p.id} className={p.isLocked ? '' : 'ui-row-click'} onClick={p.isLocked ? undefined : () => setEditing(p)}>
                    <td className="ui-col-entity" data-phone="name">{p.name}</td>
                    <td className="ui-col-meta" data-phone="sub">{labelFor(p.frequency)}</td>
                    <td className="ui-col-date ui-col-h-center">{shown(p.startDate)}</td>
                    <td className="ui-col-date ui-col-h-center">{shown(p.endDate)}</td>
                    <td className="ui-col-date ui-col-h-center" data-phone="key">{shown(p.paymentDate)}</td>
                    <td className="ui-col-meta">{describeUsage(p.usage)}</td>
                    <td className="ui-col-h-center" data-phone="tag">
                      {/* Open and closed are both expected states, so neither carries a tag (DESIGN.md "Status tags"). */}
                      <ExceptionTag label="" normal={p.isLocked ? 'Closed' : 'Open'} />
                    </td>
                    <td data-phone="act" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-1">
                        {/* Round 54 (unlockmonth B): a closed month is never reopened; fix it next month. */}
                        {p.isLocked ? null : (
                          <button
                            type="button"
                            className="ui-icon-btn"
                            aria-label={`Close ${p.name}`}
                            title="Close"
                            disabled={busy === p.id}
                            onClick={() => toggleLock(p)}
                          >
                            <Lock size={16} aria-hidden="true" />
                          </button>
                        )}
                        {!p.isLocked && !p.usage?.total ? (
                          <button type="button" className="ui-icon-btn" aria-label={`Delete ${p.name}`} onClick={() => remove(p)}>
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
        title={editing?.id ? 'Edit period' : 'New period'}
        description="The days this payroll covers, and when it is paid."
        dirty={formDirty}
      >
        {editing ? (
          <PeriodForm
            initial={editing}
            onClose={() => setEditing(null)}
            onDirty={setFormDirty}
            onSaved={() => {
              setFormDirty(false);
              setEditing(null);
              load();
            }}
          />
        ) : null}
      </Drawer>
    </DocumentListShell>
  );
}

const PeriodForm = ({ initial, onClose, onSaved, onDirty }) => {
  const [form, setForm] = useState(initial);
  const [saving, setSaving] = useState(false);
  const dirty = ['name', 'startDate', 'endDate', 'paymentDate', 'frequency'].some((k) => String(form[k] ?? '') !== String(initial[k] ?? ''));
  useEffect(() => {
    onDirty?.(dirty);
  }, [dirty, onDirty]);
  useEffect(() => () => onDirty?.(false), [onDirty]);
  const set = (patch) => setForm((p) => ({ ...p, ...patch }));

  /* Once payroll has been calculated, the dates are part of what it computed —
     proration is days in the period — so they stop being editable and the form
     says why rather than letting a save be refused. */
  const datesFixed = Number(initial?.usage?.total || 0) > 0;

  const save = async (e) => {
    e.preventDefault();
    if (saving) return;
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
      notify.error(errorWords(err, 'save that period'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={save} className="space-y-4">
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
          <span className="ui-caption">What people call it, such as "September 2026".</span>
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
          Payroll has already been run for this period, so its dates are fixed. Proration counts the days in it, and moving
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
