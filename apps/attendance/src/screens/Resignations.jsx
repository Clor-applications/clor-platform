import React, { useCallback, useEffect, useState } from 'react';

import { PageHeader, SkeletonCard, EmptyState } from '@ui/components/ui/Primitives';
import Drawer from '@ui/components/ui/Drawer';
import { confirmDialog, notify } from '@ui/components/ui/notify';
import { LEAVING_TYPES, listEmployees, rehireEmployee, resignEmployee } from '@ui/personnel/api';
import LoadFailed from '../components/LoadFailed';

const todayIst = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);

/**
 * People who have left, and recording someone leaving (ClorTime's
 * Resignations). Leaving takes them off every reader at once; rehiring puts
 * them back.
 */
export default function Resignations() {
  const [rows, setRows] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [active, setActive] = useState([]);
  const [adding, setAdding] = useState(false);
  const load = useCallback(() => {
    listEmployees({ status: 'LEFT', limit: 500 })
      .then((r) => {
        setRows((r?.employees || []).sort((a, b) => String(b.dateOfLeaving || '').localeCompare(String(a.dateOfLeaving || ''))));
        setLoadError('');
      })
      .catch((e) => setLoadError(String(e?.message || 'Could not load.')));
    listEmployees({ status: 'ACTIVE', limit: 500 }).then((r) => setActive(r?.employees || [])).catch(() => setActive([]));
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const rehire = async (p) => {
    if (!(await confirmDialog({ title: `Rehire ${p.name}?`, message: 'Active again and back on every reader. They enrol fingerprints and face again.', confirmLabel: 'Rehire', tone: 'primary' }))) return;
    try {
      await rehireEmployee(p.id);
      notify.success(`${p.name} is back.`);
      load();
    } catch (e) {
      notify.error(String(e?.message || 'Not rehired.'));
    }
  };

  return (
    <div className="space-y-4">
      <PageHeader
        entity="attendance"
        title="Resignations"
        description="Who has left and why. Recording someone leaving removes them from every reader."
        actions={<button type="button" className="ui-btn ui-btn-primary" onClick={() => setAdding(true)}>Record leaving</button>}
      />
      <LoadFailed message={loadError} onRetry={load} />
      {!rows ? (
        loadError ? null : <SkeletonCard lines={4} />
      ) : !rows.length ? (
        <EmptyState title="Nobody has left" description="People who leave are listed here, with the reason." />
      ) : (
        <div className="ui-card overflow-hidden">
          <div className="overflow-x-auto ui-table-scroll">
            <table className="ui-table w-full">
              <thead>
                <tr>
                  <th scope="col" className="ui-th">Employee</th>
                  <th scope="col" className="ui-th">Department</th>
                  <th scope="col" className="ui-th">Joined</th>
                  <th scope="col" className="ui-th">Last day</th>
                  <th scope="col" className="ui-th">Why</th>
                  <th scope="col" className="ui-th">Note</th>
                  <th scope="col" className="ui-th"><span className="sr-only">Rehire</span></th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => (
                  <tr key={p.id}>
                    <td className="ui-col-entity">{p.name}{p.code ? <span className="ui-caption"> · {p.code}</span> : null}</td>
                    <td className="ui-col-meta">{p.department || '—'}</td>
                    <td className="whitespace-nowrap">{p.dateOfJoining || '—'}</td>
                    <td className="whitespace-nowrap">{p.dateOfLeaving || '—'}</td>
                    <td>{LEAVING_TYPES[p.leavingType] || '—'}</td>
                    <td className="max-w-[16rem] truncate" title={p.leavingReason || ''}>{p.leavingReason || '—'}</td>
                    <td className="text-end"><button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" aria-label={`Rehire ${p.name}`} onClick={() => rehire(p)}>Rehire</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {adding ? <RecordLeaving people={active} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); load(); }} /> : null}
    </div>
  );
}

function RecordLeaving({ people, onClose, onSaved }) {
  const [form, setForm] = useState({ employeeId: '', lastDay: todayIst(), leavingType: 'RESIGNED', reason: '' });
  const [saving, setSaving] = useState(false);
  const save = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const r = await resignEmployee(form.employeeId, { lastDay: form.lastDay, leavingType: form.leavingType, reason: form.reason || null });
      notify.success(r.readers ? `Recorded, and removed from ${r.readers} reader${r.readers === 1 ? '' : 's'}.` : 'Recorded.');
      onSaved();
    } catch (err) {
      notify.error(String(err?.message || 'Not saved.'));
    } finally {
      setSaving(false);
    }
  };
  return (
    <Drawer
      open
      onClose={onClose}
      title="Record leaving"
      description="From the day after the last day they are not expected at work."
      actions={
        <>
          <button type="button" className="ui-btn ui-btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" form="leaving-form" className="ui-btn ui-btn-primary" disabled={saving || !form.employeeId}>{saving ? 'Saving…' : 'Record'}</button>
        </>
      }
    >
      <form id="leaving-form" onSubmit={save} className="grid gap-4">
        <label className="block">
          <span className="ui-label">Employee *</span>
          <select className="ui-select w-full" required value={form.employeeId} onChange={(e) => setForm({ ...form, employeeId: e.target.value })}>
            <option value="">Choose…</option>
            {people.map((p) => <option key={p.id} value={p.id}>{p.name}{p.code ? ` · ${p.code}` : ''}</option>)}
          </select>
        </label>
        <label className="block"><span className="ui-label">Last working day *</span><input type="date" className="ui-input w-full" required value={form.lastDay} onChange={(e) => setForm({ ...form, lastDay: e.target.value })} /></label>
        <label className="block">
          <span className="ui-label">Why</span>
          <select className="ui-select w-full" value={form.leavingType} onChange={(e) => setForm({ ...form, leavingType: e.target.value })}>
            {Object.entries(LEAVING_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <label className="block"><span className="ui-label">Note</span><input className="ui-input w-full" maxLength={500} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} /></label>
      </form>
    </Drawer>
  );
}
