import React, { useCallback, useEffect, useState } from 'react';
import { Plus } from 'lucide-react';

import { PageHeader, SkeletonCard, EmptyState } from '@ui/components/ui/Primitives';
import Drawer from '@ui/components/ui/Drawer';
import { confirmDialog, notify } from '@ui/components/ui/notify';
import { createLeaveType, deleteLeaveType, listLeaveTypes, updateLeaveType } from '../api/attendance';
import LoadFailed from '../components/LoadFailed';

const BLANK = { name: '', code: '', isPaid: true, annualDays: 12, isActive: true, accrual: 'YEARLY', prorateForJoiners: true, carryForwardMax: '' };

const monthlyNote = (days) => {
  const n = Math.round(((Number(days) || 0) / 12) * 100) / 100;
  return `${n} day${n === 1 ? '' : 's'} at the start of each month; balances round to the half day.`;
};

const policy = (t) =>
  [t.accrual === 'MONTHLY' ? 'monthly' : 'from 1 January', t.carryForwardMax != null ? `carry up to ${t.carryForwardMax}` : 'lapses at year end'].join(' · ');

/** Kinds of leave: paid ones give days a year, unpaid ones are loss of pay. */
export default function LeaveTypes() {
  const [rows, setRows] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [editing, setEditing] = useState(null);

  const load = useCallback(() => {
    listLeaveTypes().then((v) => { setRows(v); setLoadError(''); }).catch((e) => setLoadError(String(e?.message || 'Could not load leave types.')));
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="space-y-6">
      <PageHeader
        entity="attendance"
        title="Leave types"
        description="Casual, sick, earned… Each paid type gives everyone its days a year; unpaid leave is deducted from pay."
        actions={
          <button type="button" className="ui-btn ui-btn-primary" onClick={() => setEditing({ ...BLANK })}>
            <Plus size={16} aria-hidden="true" /> New leave type
          </button>
        }
      />
      <LoadFailed message={loadError} onRetry={load} />
      {!rows ? (
        loadError ? null : <SkeletonCard lines={4} />
      ) : !rows.length ? (
        <EmptyState title="No leave types yet" description="Add the kinds of leave your company gives, e.g. Casual 12, Sick 6, Loss of pay (unpaid)." />
      ) : (
        <div className="ui-card overflow-hidden">
          <table className="ui-table w-full">
            <thead>
              <tr>
                <th scope="col" className="ui-th">Leave type</th>
                <th scope="col" className="ui-th">Code</th>
                <th scope="col" className="ui-th ui-col-h-center">Paid</th>
                <th scope="col" className="ui-th text-end">Days a year</th>
                <th scope="col" className="ui-th">How it is earned</th>
                <th scope="col" className="ui-th text-end">Requests</th>
                <th scope="col" className="ui-th ui-col-h-center">Active</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => (
                <tr key={t.id} className="ui-row-click" onClick={() => setEditing({ ...t, code: t.code || '' })}>
                  <td className="ui-col-entity">{t.name}</td>
                  <td className="ui-col-meta">{t.code || '—'}</td>
                  <td className="ui-col-h-center">{t.isPaid ? '✓' : <span className="ui-pill ui-pill-warn">unpaid</span>}</td>
                  <td className="text-end tabular-nums">{t.isPaid ? t.annualDays : '—'}</td>
                  <td className="ui-col-meta">{t.isPaid ? policy(t) : '—'}</td>
                  <td className="text-end tabular-nums">{t.requests}</td>
                  <td className="ui-col-h-center">{t.isActive ? '✓' : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing ? <TypeForm initial={{ ...editing, carryForwardMax: editing.carryForwardMax ?? '' }} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} /> : null}
    </div>
  );
}

function TypeForm({ initial, onClose, onSaved }) {
  const [form, setForm] = useState(initial);
  const [saving, setSaving] = useState(false);

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    const body = {
      name: form.name,
      code: form.code || null,
      isPaid: Boolean(form.isPaid),
      annualDays: form.isPaid ? Number(form.annualDays) || 0 : 0,
      isActive: Boolean(form.isActive),
      accrual: form.accrual || 'YEARLY',
      prorateForJoiners: Boolean(form.prorateForJoiners),
      carryForwardMax: form.isPaid && form.carryForwardMax !== '' && form.carryForwardMax != null ? Number(form.carryForwardMax) || 0 : null,
    };
    try {
      if (form.id) await updateLeaveType(form.id, body);
      else await createLeaveType(body);
      notify.success('Leave type saved.');
      onSaved();
    } catch (err) {
      notify.error(String(err?.message || 'Not saved.'));
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    const ok = await confirmDialog({ title: `Delete ${form.name}?`, message: 'Only a type nobody has used can be deleted.', confirmLabel: 'Yes, delete' });
    if (!ok) return;
    try {
      await deleteLeaveType(form.id);
      onSaved();
    } catch (err) {
      notify.error(String(err?.message || 'Not deleted.'));
    }
  };

  return (
    <Drawer
      widthClass="w-[min(40rem,96vw)]"
      open
      onClose={onClose}
      title={form.id ? form.name : 'New leave type'}
      actions={
        <>
          {form.id ? <button type="button" className="ui-btn ui-btn-secondary" onClick={remove}>Delete</button> : null}
          <button type="button" className="ui-btn ui-btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" form="leave-type" className="ui-btn ui-btn-primary" disabled={saving || !form.name.trim()}>{saving ? 'Saving…' : 'Save'}</button>
        </>
      }
    >
      <form id="leave-type" onSubmit={save} className="grid gap-4 sm:grid-cols-2">
        <label className="block"><span className="ui-label">Name *</span><input className="ui-input w-full" required maxLength={60} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Casual leave" /></label>
        <label className="block"><span className="ui-label">Code</span><input className="ui-input w-full" maxLength={10} value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="e.g. CL" /></label>
        <label className="flex items-center gap-2 text-sm sm:col-span-2">
          <input type="checkbox" className="ui-checkbox" checked={Boolean(form.isPaid)} onChange={(e) => setForm({ ...form, isPaid: e.target.checked })} /> Paid leave
        </label>
        {form.isPaid ? (
          <label className="block">
            <span className="ui-label">Days a year</span>
            <input type="number" min={0} max={366} step={0.5} className="ui-input w-full" value={form.annualDays} onChange={(e) => setForm({ ...form, annualDays: e.target.value })} />
            <span className="ui-caption">Change one person's days in Leave balances.</span>
          </label>
        ) : null}
        {form.isPaid ? (
          <label className="block">
            <span className="ui-label">Earned</span>
            <select className="ui-select w-full" value={form.accrual || 'YEARLY'} onChange={(e) => setForm({ ...form, accrual: e.target.value })}>
              <option value="YEARLY">All on 1 January</option>
              <option value="MONTHLY">A twelfth each month</option>
            </select>
            <span className="ui-caption">{form.accrual === 'MONTHLY' ? monthlyNote(form.annualDays) : 'The year’s days are there from the start.'}</span>
          </label>
        ) : null}
        {form.isPaid ? (
          <label className="block">
            <span className="ui-label">Carry into next year, up to</span>
            <input type="number" min={0} max={366} step={0.5} className="ui-input w-full" placeholder="Nothing — unused days lapse" value={form.carryForwardMax} onChange={(e) => setForm({ ...form, carryForwardMax: e.target.value })} />
            <span className="ui-caption">Unused days at 31 December move to the new year, up to this many.</span>
          </label>
        ) : null}
        {form.isPaid ? (
          <label className="flex items-start gap-2 text-sm sm:col-span-2">
            <input type="checkbox" className="ui-checkbox mt-0.5" checked={Boolean(form.prorateForJoiners) || form.accrual === 'MONTHLY'} disabled={form.accrual === 'MONTHLY'} onChange={(e) => setForm({ ...form, prorateForJoiners: e.target.checked })} />
            <span>
              Joiners get the months left in their first year
              <span className="ui-caption block">Joining by the 15th counts that month. Monthly leave always starts from joining.</span>
            </span>
          </label>
        ) : (
          <p className="ui-caption sm:col-span-2">Unpaid: no balance, and each day taken is loss of pay in the month summary.</p>
        )}
        <label className="flex items-center gap-2 text-sm sm:col-span-2">
          <input type="checkbox" className="ui-checkbox" checked={Boolean(form.isActive)} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} /> Active (people can ask for it)
        </label>
      </form>
    </Drawer>
  );
}
