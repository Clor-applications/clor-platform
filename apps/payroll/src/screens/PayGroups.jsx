import React, { useCallback, useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';

import { SkeletonCard, EmptyState } from '@ui/components/ui/Primitives';
import SettingsScreenHeader from '@ui/chrome/SettingsScreenHeader';
import Drawer from '@ui/components/ui/Drawer';
import { confirmDialog, notify } from '@ui/components/ui/notify';
import { listPayGroups, createPayGroup, updatePayGroup, deletePayGroup } from '../api/payrollCalendar';

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

export default function PayGroups() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(null);

  const load = useCallback(async () => {
    try {
      setRows(await listPayGroups());
      setError('');
    } catch (e) {
      setError(String(e?.message || 'Could not load pay groups.'));
    } finally {
      setLoading(false);
    }
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

  if (loading) return <SkeletonCard lines={5} />;

  return (
    <div className="space-y-6">
      <SettingsScreenHeader
        entity="settings"
        title="Pay groups"
        description="Populations paid on the same rhythm — monthly staff, weekly labour, contractors."
        actions={
          <button type="button" className="ui-btn ui-btn-primary" onClick={() => setEditing(blank())}>
            <Plus size={16} aria-hidden="true" /> New pay group
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
          title="No pay groups yet"
          description="A payroll run is drawn from a pay group. Add the rhythms this company pays on, and a run can name who it is for."
          action={
            <button type="button" className="ui-btn ui-btn-primary" onClick={() => setEditing(blank())}>
              <Plus size={16} aria-hidden="true" /> New pay group
            </button>
          }
        />
      ) : (
        <div className="ui-card overflow-hidden">
          <div className="overflow-x-auto ui-table-scroll">
            <table className="ui-table w-full">
              <thead>
                <tr>
                  <th scope="col" className="ui-th">Pay group</th>
                  <th scope="col" className="ui-th">Cycle</th>
                  <th scope="col" className="ui-th ui-col-h-center">Paid on</th>
                  <th scope="col" className="ui-th">In use by</th>
                  <th scope="col" className="ui-th ui-col-h-center">Status</th>
                  <th scope="col" className="ui-th ui-col-h-center w-10">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((g) => (
                  <tr key={g.id} className="ui-row-click" onClick={() => setEditing({ ...g, paymentDay: g.paymentDay ?? '' })}>
                    <td className="ui-col-entity">{g.name}</td>
                    <td className="ui-col-meta">{labelFor(g.frequency)}</td>
                    <td className="ui-col-h-center">{g.paymentDay ? `Day ${g.paymentDay}` : '—'}</td>
                    <td className="ui-col-meta">{describeUsage(g.usage)}</td>
                    <td>
                      <span className={`ui-pill ${g.isActive ? 'ui-pill-pos' : 'ui-pill-neutral'}`}>
                        {g.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <button type="button" className="ui-icon-btn" aria-label={`Delete ${g.name}`} onClick={() => remove(g)}>
                        <Trash2 size={16} aria-hidden="true" />
                      </button>
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
    </div>
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
    <form onSubmit={save} className="space-y-6">
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
