import React, { useCallback, useEffect, useState } from 'react';

import { PageHeader, SkeletonCard } from '@ui/components/ui/Primitives';
import { confirmDialog, notify } from '@ui/components/ui/notify';
import { LEAVE_STATUS, applyLeave, cancelMyLeave, explainMyLeave, getMyLeave, leaveRange, todayIst } from '../api/attendance';
import LoadFailed from '../components/LoadFailed';
import LeaveExplain from '../components/LeaveExplain';

const BLANK = { leaveTypeId: '', fromDate: '', toDate: '', reason: '' };

/** One's own balances, time off asked for, and a form to ask for more. */
export default function MyLeave() {
  const [year, setYear] = useState(Number(todayIst().slice(0, 4)));
  const [me, setMe] = useState(null);
  const [error, setError] = useState('');
  const [form, setForm] = useState(BLANK);
  const [explaining, setExplaining] = useState(null);
  const explainLoad = useCallback(() => explainMyLeave(explaining, year), [explaining, year]);
  const [saving, setSaving] = useState(false);

  const load = useCallback(() => {
    getMyLeave(year)
      .then((d) => {
        setMe(d);
        setError('');
      })
      .catch((e) => setError(String(e?.message || 'Could not load your leave.')));
  }, [year]);
  useEffect(() => {
    load();
  }, [load]);

  const apply = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const r = await applyLeave({ ...form, toDate: form.toDate || form.fromDate });
      notify.success(`Asked for ${r.request.days} day${r.request.days === 1 ? '' : 's'} of ${r.request.leaveTypeName}.`);
      setForm(BLANK);
      load();
    } catch (err) {
      notify.error(String(err?.message || 'Not sent.'));
    } finally {
      setSaving(false);
    }
  };

  const cancel = async (r) => {
    const ok = await confirmDialog({ title: 'Cancel this leave?', message: leaveRange(r.fromDate, r.toDate), confirmLabel: 'Yes, cancel it' });
    if (!ok) return;
    try {
      await cancelMyLeave(r.id);
      load();
    } catch (err) {
      notify.error(String(err?.message || 'Not cancelled.'));
    }
  };

  if (error) {
    return (
      <div className="space-y-4">
        <PageHeader entity="attendance" title="My leave" />
        <LoadFailed message={error} onRetry={load} />
      </div>
    );
  }
  if (!me) return <SkeletonCard lines={6} />;

  return (
    <div className="space-y-4">
      <PageHeader
        entity="attendance"
        title="My leave"
        description={me.employee.name}
        actions={
          <div className="flex items-center gap-1">
            <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={() => setYear((y) => y - 1)} aria-label="Previous year">‹</button>
            <span className="min-w-[4ch] text-center font-medium tabular-nums">{year}</span>
            <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={() => setYear((y) => y + 1)} aria-label="Next year">›</button>
          </div>
        }
      />

      {me.types.length ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {me.types.map((t) => (
            <section key={t.id} className="ui-card p-4" aria-label={t.name}>
              <div className="ui-t-label">{t.name}</div>
              {t.isPaid ? (
                <>
                  <div className="mt-1 text-2xl font-semibold tabular-nums">{t.available}<span className="ui-caption"> of {t.allocated} left</span></div>
                  <div className="ui-caption">{t.used} taken{t.pending ? ` · ${t.pending} waiting` : ''}</div>
                  <button type="button" className="ui-link text-xs mt-1" onClick={() => setExplaining(t.id)}>How is this worked out?</button>
                </>
              ) : (
                <>
                  <div className="mt-1 text-2xl font-semibold tabular-nums">{t.used}<span className="ui-caption"> taken</span></div>
                  <div className="ui-caption">Unpaid — deducted from pay</div>
                </>
              )}
            </section>
          ))}
        </div>
      ) : (
        <div className="ui-card p-4 text-sm ui-muted">No leave types are set up yet. Ask HR.</div>
      )}

      {me.types.length ? (
        <section className="ui-card p-4" aria-labelledby="apply-h">
          <h2 id="apply-h" className="ui-t-sec mb-3">Ask for leave</h2>
          <form onSubmit={apply} className="grid gap-3 sm:grid-cols-4">
            <label className="block">
              <span className="ui-label">Type</span>
              <select className="ui-select w-full" required value={form.leaveTypeId} onChange={(e) => setForm({ ...form, leaveTypeId: e.target.value })}>
                <option value="">Choose…</option>
                {me.types.map((t) => <option key={t.id} value={t.id}>{t.name}{t.isPaid ? ` (${t.available} left)` : ' (unpaid)'}</option>)}
              </select>
            </label>
            <label className="block"><span className="ui-label">From</span><input type="date" className="ui-input w-full" required value={form.fromDate} onChange={(e) => setForm({ ...form, fromDate: e.target.value, toDate: form.toDate && form.toDate < e.target.value ? e.target.value : form.toDate })} /></label>
            <label className="block"><span className="ui-label">To</span><input type="date" className="ui-input w-full" min={form.fromDate || undefined} value={form.toDate} onChange={(e) => setForm({ ...form, toDate: e.target.value })} /></label>
            <span className="ui-caption self-end pb-2">Leave blank for one day. Weekly offs and holidays are not counted.</span>
            <label className="block sm:col-span-4"><span className="ui-label">Reason</span><input className="ui-input w-full" required minLength={3} maxLength={500} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} /></label>
            <div className="sm:col-span-4"><button type="submit" className="ui-btn ui-btn-primary" disabled={saving}>{saving ? 'Sending…' : 'Send for approval'}</button></div>
          </form>
        </section>
      ) : null}

      <section className="ui-card overflow-hidden" aria-labelledby="mine-h">
        <h2 id="mine-h" className="ui-t-sec px-5 pt-4">Asked for in {year}</h2>
        <div className="overflow-x-auto ui-table-scroll ui-table-fit">
          <table className="ui-table w-full">
            <thead>
              <tr>
                <th scope="col" className="ui-th">Dates</th>
                <th scope="col" className="ui-th">Type</th>
                <th scope="col" className="ui-th text-end">Days</th>
                <th scope="col" className="ui-th">Reason</th>
                <th scope="col" className="ui-th ui-col-h-center">Status</th>
                <th scope="col" className="ui-th"><span className="sr-only">Cancel</span></th>
              </tr>
            </thead>
            <tbody>
              {me.requests.map((r) => {
                const cancellable = r.status === 'PENDING' || (r.status === 'APPROVED' && r.fromDate > me.today);
                return (
                  <tr key={r.id}>
                    <td className="whitespace-nowrap">{leaveRange(r.fromDate, r.toDate)}</td>
                    <td>{r.leaveTypeName}</td>
                    <td className="text-end tabular-nums">{r.days}</td>
                    <td className="max-w-[20rem] truncate" title={r.reason}>{r.reason}</td>
                    <td className="ui-col-h-center"><span className={`ui-pill ${LEAVE_STATUS[r.status] || 'ui-pill-neutral'}`}>{r.status.toLowerCase()}</span></td>
                    <td className="text-end">
                      {cancellable ? <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={() => cancel(r)}>Cancel</button> : null}
                    </td>
                  </tr>
                );
              })}
              {!me.requests.length ? (
                <tr><td colSpan={6} className="ui-muted py-6 text-center text-sm">Nothing asked for this year.</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
      <LeaveExplain open={Boolean(explaining)} onClose={() => setExplaining(null)} load={explainLoad} />
    </div>
  );
}
