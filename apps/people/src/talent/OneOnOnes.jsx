import React, { useMemo, useState } from 'react';
import { Plus } from '@ui/components/ui/lineIcons';
import { EmptyState } from '@ui/components/ui/Primitives';
import ListHeader from '@ui/components/list/ListHeader';
import DataTable from '@ui/components/ui/DataTable';
import Drawer from '@ui/components/ui/Drawer';
import ErrorState from '@ui/components/ui/ErrorState';
import DatePicker from '@ui/components/ui/DatePicker';
import PopupSelect from '@ui/components/pickers/PopupSelect';
import useRequest from '@ui/components/ui/useRequest';
import { notify } from '@ui/components/ui/notify';
import { listOneOnOnes, saveOneOnOne } from '../api/talent';
import { FormError, Footer, SHEET, day, todayIst } from './shared';

/**
 * One-on-ones (TALENT-DECISIONS.md, Growth): a manager's notes and agreed actions with each person
 * who reports to them. Only those two see them, not HR. Your own one-on-ones with your manager
 * show here too, to read.
 */
export default function OneOnOnes() {
  const [person, setPerson] = useState('');
  const [editing, setEditing] = useState(null);
  const req = useRequest(() => listOneOnOnes({ employeeId: person }), [person]);
  const reports = req.data?.reports || [];
  const rows = req.data?.rows || [];
  const columns = [
    { key: 'date', label: 'Date', always: true, render: (r) => <span className="tabular-nums whitespace-nowrap font-medium">{day(r.date)}</span> },
    { key: 'with', label: 'With', render: (r) => (r.mine ? r.employee?.name : <span>{r.manager?.name} <span className="ui-caption">(your manager)</span></span>) },
    { key: 'notes', label: 'Talked about', render: (r) => <span className="block max-w-[28rem] line-clamp-2" title={r.notes || ''}>{r.notes || '—'}</span> },
    { key: 'actions', label: 'Agreed', render: (r) => <span className="block max-w-[24rem] line-clamp-2" title={r.actions || ''}>{r.actions || '—'}</span> },
  ];
  const blank = { employeeId: person || (reports.length === 1 ? reports[0].id : '') };
  return (
    <div className="space-y-6">
      <ListHeader
        module="Talent"
        title="One-on-ones"
        description="What you talked about with each person in your team, and what you both agreed."
        primary={reports.length ? { label: 'New one-on-one', icon: Plus, onClick: () => setEditing(blank) } : null}
        toolbar={reports.length > 1 ? <div className="w-full sm:w-56"><PopupSelect showValueSubtext={false} ariaLabel="Person" value={person} onChange={(v) => setPerson(v || '')} options={[{ value: '', label: 'Everyone' }, ...reports.map((p) => ({ value: p.id, label: p.name }))]} /></div> : null}
      />
      {req.error && !req.data ? <ErrorState error={req.error} onRetry={req.reload} /> : (
        <DataTable label="One-on-ones" columns={columns} rows={rows} loading={req.loading} refreshing={req.refreshing} total={rows.length} pageSize={Math.max(25, rows.length)} noun="one-on-ones"
          onRowClick={(r) => (r.mine ? setEditing(r) : null)}
          card={(r) => (
            <span className="min-w-0 flex-1">
              <span className="flex items-center justify-between gap-2"><span className="truncate font-medium">{r.mine ? r.employee?.name : `${r.manager?.name} (your manager)`}</span><span className="tabular-nums ui-caption">{day(r.date)}</span></span>
              <span className="block truncate ui-caption">{r.actions || r.notes || ''}</span>
            </span>
          )}
          empty={person
            ? <EmptyState kind="filtered" title="None with this person yet" description="Write down what you talked about and what you both agreed." routes={[{ label: 'New one-on-one', onSelect: () => setEditing(blank) }]} />
            : <EmptyState title="No one-on-ones yet" description={reports.length ? 'Write down what you talked about with someone in your team, and what you both agreed.' : 'People who report to you, and your own talks with your manager, show here.'} routes={reports.length ? [{ label: 'New one-on-one', onSelect: () => setEditing(blank) }] : undefined} />} />
      )}
      {editing ? <OneOnOneForm value={editing} reports={reports} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); req.reload(); }} /> : null}
    </div>
  );
}

function OneOnOneForm({ value, reports, onClose, onSaved }) {
  const initial = useMemo(() => ({ employeeId: value.employeeId || '', date: value.date || todayIst(), notes: value.notes || '', actions: value.actions || '' }), [value]);
  const [form, setForm] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const dirty = JSON.stringify(form) !== JSON.stringify(initial);
  const save = async () => {
    const missing = !form.employeeId ? 'Choose who it was with.' : !form.notes.trim() && !form.actions.trim() ? 'Write what you talked about or agreed.' : null;
    if (missing) { setError({ message: missing }); return; }
    setBusy(true);
    setError(null);
    try { await saveOneOnOne({ ...form, notes: form.notes.trim() || null, actions: form.actions.trim() || null }, value.id); notify.success('Saved. Only the two of you see it.'); onSaved(); } catch (e) { setError(e); setBusy(false); }
  };
  return (
    <Drawer open onClose={onClose} widthClass={SHEET} dirty={dirty} title={value.id ? `One-on-one with ${value.employee?.name || ''}` : 'New one-on-one'}
      footer={<Footer onCancel={onClose} onSave={save} busy={busy} label="Save" disabled={Boolean(value.id) && !dirty} />}>
      <form className="ui-form-grid" onSubmit={(e) => { e.preventDefault(); if (busy) return; save(); }}>
        <FormError error={error} />
        {!value.id ? <div><PopupSelect showValueSubtext={false} label="With *" value={form.employeeId} placeholder="Choose…" alwaysSearch={reports.length > 8} onChange={(v) => set({ employeeId: v || '' })} options={reports.map((p) => ({ value: p.id, label: p.code ? `${p.name} (${p.code})` : p.name }))} /></div> : null}
        <div><label className="ui-label" htmlFor="one-date">Date *</label><DatePicker id="one-date" max={todayIst()} value={form.date} onChange={(d) => set({ date: d || '' })} /></div>
        <label className="block sm:col-span-2"><span className="ui-label">What you talked about</span><textarea className="ui-input w-full" rows={6} maxLength={8000} value={form.notes} onChange={(e) => set({ notes: e.target.value })} /></label>
        <label className="block sm:col-span-2"><span className="ui-label">What you agreed</span><textarea className="ui-input w-full" rows={4} maxLength={4000} value={form.actions} onChange={(e) => set({ actions: e.target.value })} /></label>
      </form>
    </Drawer>
  );
}
