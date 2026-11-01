import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarDays, History, Plus, Repeat, Trash2, Users } from 'lucide-react';

import { ColumnHeader, useColumnFilters } from '@ui/components/ColumnFilters';
import { useListSearch } from '@ui/components/ListToolbar';
import DocumentListShell from '@ui/components/list/DocumentListShell';
import { exportFormatFromKey, exportMenuItem, runListExport } from '@ui/components/list/exportMenu';
import { SkeletonCard, EmptyState, StatusPill } from '@ui/components/ui/Primitives';
import Drawer from '@ui/components/ui/Drawer';
import { confirmDialog, notify } from '@ui/components/ui/notify';
import { listPayGroups, createPayGroup, updatePayGroup, deletePayGroup } from '../api/payrollCalendar';
import LoadFailed from '@ui/components/ui/LoadFailed';

/**
 * Populations paid on the same rhythm.
 *
 * Monthly staff, weekly site labour, contractors on a fortnight. A pay group is
 * what a payroll run is drawn from, so the useful thing to show on a row is not
 * the group's own settings but what already depends on it: a group with runs
 * behind it can be renamed and can be retired, and can no longer change its
 * cycle. Saying so on the row is cheaper than letting somebody find out from a
 * refused save.
 */

const FREQUENCIES = [
  { id: 'MONTHLY', label: 'Monthly' },
  { id: 'WEEKLY', label: 'Weekly' },
  { id: 'FORTNIGHTLY', label: 'Fortnightly' },
  { id: 'CUSTOM', label: 'Custom' },
];

const labelFor = (id) => FREQUENCIES.find((f) => f.id === id)?.label || id;

const blank = () => ({ name: '', code: '', frequency: 'MONTHLY', paymentDay: '', notes: '', isActive: true });

/** What is holding a group, in words rather than three numbers. */
const describeUsage = (u) => {
  if (!u || !u.total) return '—';
  const parts = [
    u.runs ? `${u.runs} run${u.runs === 1 ? '' : 's'}` : null,
    u.assignments ? `${u.assignments} assignment${u.assignments === 1 ? '' : 's'}` : null,
    u.structures ? `${u.structures} structure${u.structures === 1 ? '' : 's'}` : null,
  ].filter(Boolean);
  return parts.join(', ');
};

const TABS = [
  { value: '', label: 'All', tone: 'all' },
  { value: 'ACTIVE', label: 'Active', tone: 'paid' },
  { value: 'INACTIVE', label: 'Inactive', tone: 'cancelled' },
];
const COLUMNS = {
  name: (g) => g.name,
  cycle: (g) => labelFor(g.frequency),
};
const EXPORT_COLUMNS = [
  { key: 'name', label: 'Pay group' },
  { key: 'code', label: 'Code' },
  { key: 'cycle', label: 'Cycle', value: (g) => labelFor(g.frequency) },
  { key: 'paymentDay', label: 'Paid on day', value: (g) => g.paymentDay ?? '' },
  { key: 'usage', label: 'In use by', value: (g) => describeUsage(g.usage) },
  { key: 'isActive', label: 'Status', value: (g) => (g.isActive ? 'Active' : 'Inactive') },
];

export default function PayGroups() {
  const [all, setAll] = useState(null);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(null);
  const [status, setStatus] = useState('');

  const load = useCallback(() => {
    listPayGroups()
      .then((v) => {
        setAll(v);
        setError('');
      })
      .catch((e) => setError(String(e?.message || 'Could not load pay groups.')));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const remove = async (row) => {
    const ok = await confirmDialog({
      title: `Delete ${row.name}?`,
      message:
        'A group nothing has been paid on can be deleted. One with payroll behind it must be made inactive instead, so those runs keep a population you can name.',
      confirmLabel: 'Yes, delete',
    });
    if (!ok) return;
    try {
      await deletePayGroup(row.id);
      notify.success(`${row.name} deleted.`);
      load();
    } catch (e) {
      notify.error(String(e?.message || 'Could not delete that pay group.'));
    }
  };

  const counts = useMemo(() => {
    const list = all || [];
    const active = list.filter((g) => g.isActive).length;
    return { '': list.length, ACTIVE: active, INACTIVE: list.length - active };
  }, [all]);
  const inTab = useMemo(() => (all || []).filter((g) => !status || (status === 'ACTIVE') === Boolean(g.isActive)), [all, status]);
  const search = useListSearch(inTab, ['name', 'code']);
  const filters = useColumnFilters();
  const rows = filters.applyFilters(search.filtered, COLUMNS);
  const figures = useMemo(() => {
    const list = all || [];
    return {
      monthly: list.filter((g) => g.frequency === 'MONTHLY').length,
      other: list.filter((g) => g.frequency !== 'MONTHLY').length,
      inUse: list.filter((g) => g.usage?.total).length,
    };
  }, [all]);
  const create = () => setEditing(blank());

  return (
    <DocumentListShell
      entity="payGroup"
      title="Pay groups"
      description="Populations paid on the same rhythm — monthly staff, weekly labour, contractors."
      compact
      tight
      denseCards
      search={{ value: search.query, onChange: search.setQuery, placeholder: 'Search pay groups…', label: 'Search pay groups' }}
      moreItems={all?.length ? [exportMenuItem('Export pay groups')] : null}
      onMoreSelect={(k) => {
        const format = exportFormatFromKey(k);
        if (!format) return;
        runListExport({ format, title: 'Pay groups', fileName: 'Pay groups', label: 'pay group/pay groups', columns: EXPORT_COLUMNS, rows });
      }}
      primary={
        <button type="button" className="ui-btn ui-btn-primary" onClick={create}>
          <Plus size={16} aria-hidden="true" /> New pay group
        </button>
      }
      cards={[
        { label: 'Active groups', value: counts.ACTIVE, count: true, tone: 'paid', Icon: Users, onSelect: () => setStatus('ACTIVE') },
        { label: 'Paid monthly', value: figures.monthly, count: true, tone: 'sent', Icon: CalendarDays },
        { label: 'Other cycles', value: figures.other, count: true, tone: 'partial', Icon: Repeat },
        { label: 'Used by payroll', value: figures.inUse, count: true, tone: 'outstanding', Icon: History },
      ]}
      tabs={TABS}
      statusValue={status}
      statusCounts={counts}
      onStatusChange={setStatus}
      tabsLabel="Active or inactive"
    >
      <LoadFailed message={error} onRetry={load} />
      {!all ? (
        error ? null : <SkeletonCard lines={4} />
      ) : (
        <div className="ui-table-scroll">
          <table className="ui-table ui-table-sticky w-full">
            <thead>
              <tr>
                <ColumnHeader label="Pay group" col="name" state={filters} />
                <ColumnHeader label="Cycle" col="cycle" state={filters} />
                <th scope="col" className="ui-col-h-center">Paid on</th>
                <th scope="col">In use by</th>
                <th scope="col" className="ui-col-h-center">Status</th>
                <th scope="col"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody className="ui-rows">
              {!rows.length ? (
                <tr>
                  <td colSpan={6}>
                    {inTab.length ? (
                      <EmptyState kind="filtered" totalCount={inTab.length} title="No pay groups match" description="Nothing in this tab matches the search or the column filters." />
                    ) : (
                      <EmptyState
                        icon={Users}
                        title={status ? `No ${status.toLowerCase()} pay groups` : 'No pay groups yet'}
                        description="A payroll run is drawn from a pay group. Add the rhythms this company pays on, and a run can name who it is for."
                        routes={status ? undefined : [{ label: 'New pay group', description: 'E.g. Monthly staff, Weekly site labour.', onSelect: create }]}
                      />
                    )}
                  </td>
                </tr>
              ) : (
                rows.map((g) => (
                  <tr key={g.id} className="ui-row-click" onClick={() => setEditing({ ...g, paymentDay: g.paymentDay ?? '' })}>
                    <td className="ui-col-entity">
                      {g.name}
                      {g.code ? <span className="ui-caption ml-2 ui-mono">{g.code}</span> : null}
                    </td>
                    <td className="ui-col-meta">{labelFor(g.frequency)}</td>
                    <td className="ui-col-h-center">{g.paymentDay ? `Day ${g.paymentDay}` : '—'}</td>
                    <td className="ui-col-meta">{describeUsage(g.usage)}</td>
                    <td className="ui-col-h-center">{g.isActive ? <StatusPill status="active" /> : <span className="ui-caption">Inactive</span>}</td>
                    <td className="text-end" onClick={(e) => e.stopPropagation()}>
                      <button type="button" className="ui-icon-btn" aria-label={`Delete ${g.name}`} onClick={() => remove(g)}>
                        <Trash2 size={16} aria-hidden="true" />
                      </button>
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
        title={editing?.id ? 'Edit pay group' : 'New pay group'}
        description="Who is paid together, and how often."
      >
        {editing ? (
          <PayGroupForm
            initial={editing}
            onClose={() => setEditing(null)}
            onSaved={() => {
              setEditing(null);
              load();
            }}
          />
        ) : null}
      </Drawer>
    </DocumentListShell>
  );
}

const PayGroupForm = ({ initial, onClose, onSaved }) => {
  const [form, setForm] = useState(initial);
  const [saving, setSaving] = useState(false);
  const set = (patch) => setForm((p) => ({ ...p, ...patch }));

  /* A day of the month only means something on a monthly cycle, and the server
     refuses one anywhere else — so the field goes away rather than being
     offered and then rejected. */
  const monthly = form.frequency === 'MONTHLY';
  const lockedCycle = Number(initial?.usage?.runs || 0) > 0;

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const payload = {
        name: form.name,
        code: form.code || null,
        frequency: form.frequency,
        paymentDay: monthly && String(form.paymentDay || '').trim() ? Number(form.paymentDay) : null,
        notes: form.notes || null,
        isActive: Boolean(form.isActive),
      };
      if (initial.id) await updatePayGroup(initial.id, payload);
      else await createPayGroup(payload);
      notify.success(`${form.name} saved.`);
      onSaved();
    } catch (err) {
      notify.error(String(err?.message || 'Could not save that pay group.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={save} className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-[1fr_9rem] gap-3">
        <div>
          <label className="ui-label" htmlFor="paygroup-name">Name</label>
          <input
            id="paygroup-name"
            className="ui-input w-full"
            value={form.name}
            onChange={(e) => set({ name: e.target.value })}
            required
            autoFocus
          />
        </div>
        <div>
          <label className="ui-label" htmlFor="paygroup-code">Code</label>
          <input
            id="paygroup-code"
            className="ui-input ui-mono w-full"
            value={form.code || ''}
            onChange={(e) => set({ code: e.target.value })}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="ui-label" htmlFor="paygroup-frequency">Cycle</label>
          <select
            id="paygroup-frequency"
            className="ui-select w-full"
            value={form.frequency}
            onChange={(e) => set({ frequency: e.target.value })}
            disabled={lockedCycle}
          >
            {FREQUENCIES.map((f) => (
              <option key={f.id} value={f.id}>{f.label}</option>
            ))}
          </select>
          {lockedCycle ? (
            <span className="ui-caption block mt-1">
              Payroll has been run on this cycle, so it can no longer change. Retire this group and add one on the new cycle.
            </span>
          ) : null}
        </div>

        {monthly ? (
          <div>
            <label className="ui-label" htmlFor="paygroup-payment-day">Paid on day</label>
            <input
              id="paygroup-payment-day"
              type="number"
              min="1"
              max="31"
              className="ui-input ui-num w-full"
              value={form.paymentDay ?? ''}
              onChange={(e) => set({ paymentDay: e.target.value })}
            />
          </div>
        ) : null}
      </div>

      <div>
        <label className="ui-label" htmlFor="paygroup-notes">Notes</label>
        <input
          id="paygroup-notes"
          className="ui-input w-full"
          value={form.notes || ''}
          onChange={(e) => set({ notes: e.target.value })}
        />
      </div>

      <label className="flex items-start gap-2 text-sm" htmlFor="paygroup-active">
        <input
          id="paygroup-active"
          type="checkbox"
          className="ui-checkbox mt-0.5"
          checked={Boolean(form.isActive)}
          onChange={(e) => set({ isActive: e.target.checked })}
        />
        <span>
          <span className="block">Active</span>
          <span className="ui-caption block">An inactive group keeps its history but is offered to no new payroll.</span>
        </span>
      </label>

      <div className="flex items-center justify-end gap-2 pt-1">
        <button type="button" className="ui-btn ui-btn-secondary" onClick={onClose} disabled={saving}>
          Cancel
        </button>
        <button type="submit" className="ui-btn ui-btn-primary" disabled={saving}>
          {saving ? 'Saving…' : 'Save pay group'}
        </button>
      </div>
    </form>
  );
};
