import React, { useCallback, useEffect, useState } from 'react';
import { HelpCircle, LogIn, LogOut } from 'lucide-react';

import { PageHeader, SkeletonCard } from '@ui/components/ui/Primitives';
import { notify } from '@ui/components/ui/notify';
import { clock, dayLabel, explainMyDay, getMe, hm, phonePunch, REASON_CODES, requestCorrection, STATUS, todayIst } from '../api/attendance';
import LoadFailed from '@ui/components/ui/LoadFailed';
import DayExplain from '../components/DayExplain';
import PhonePunch from '../components/PhonePunch';

/**
 * Clock in, clock out, and one's own month — Horilla's check-in/out widget.
 * The time recorded is the server's, not this device's.
 *
 * When HR has switched phone punching on for this person (Portal access), the
 * plain clock gives way to the same punch card the employee portal uses:
 * location against the work sites, an optional selfie, the punch recorded
 * under the "Phone punches" reader so Transactions and the day's record see it.
 */
export default function MyAttendance() {
  const [me, setMe] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ date: '', checkIn: '', checkOut: '', reason: '', reasonCode: '' });
  const [explaining, setExplaining] = useState(null);
  const explainLoad = useCallback(() => explainMyDay(explaining), [explaining]);

  const load = useCallback(() => {
    getMe()
      .then((d) => {
        setMe(d);
        setError('');
      })
      .catch((e) => setError(String(e?.message || 'Could not load your attendance.')));
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const punch = async () => {
    setBusy(true);
    try {
      const r = await clock(me?.webClock?.outOnly ? 'OUT' : undefined);
      notify.success(r.kind === 'IN' ? `Clocked in at ${r.record.checkInTime}.` : `Clocked out at ${r.record.checkOutTime}.`);
      load();
    } catch (e) {
      notify.error(String(e?.message || 'Could not clock.'));
    } finally {
      setBusy(false);
    }
  };

  const ask = async (e) => {
    e.preventDefault();
    try {
      await requestCorrection({ ...form, checkOut: form.checkOut || null, reasonCode: form.reasonCode || null });
      notify.success('Correction sent for approval.');
      setForm({ date: '', checkIn: '', checkOut: '', reason: '', reasonCode: '' });
      load();
    } catch (err) {
      notify.error(String(err?.message || 'Not sent.'));
    }
  };

  if (error) {
    return (
      <div className="space-y-3">
        <PageHeader entity="attendance" title="My attendance" />
        <div className="pb-8"><LoadFailed message={error} onRetry={load} /></div>
      </div>
    );
  }
  if (!me) return <div className="space-y-3"><PageHeader entity="attendance" title="My attendance" /><div className="pb-8"><SkeletonCard lines={6} /></div></div>;
  const t = me.todayRecord;
  /*
   * A day this browser opened can always be closed here, even when the punch policy now sends this person
   * to the phone or refuses the browser (review of #144): otherwise the day is left open with no way out.
   */
  const outOnly = Boolean(me.webClock?.outOnly);
  const showClock = outOnly || (!me.phone?.allowed && me.webClock?.allowed !== false);

  return (
    <div className="space-y-3">
      <PageHeader entity="attendance" title="My attendance" description={`${me.employee.name}${me.employee.code ? ` · ${me.employee.code}` : ''} · ${me.shift.name} (${me.shift.startTime}–${me.shift.endTime})`} />
      <div className="pb-8 space-y-6">

      {me.phone?.allowed ? (
        <PhonePunch phone={me.phone} punches={me.punches} onPunch={phonePunch} onDone={load} />
      ) : null}
      <section className="ui-card flex flex-wrap items-center gap-4 p-4">
        {showClock ? <button type="button" className="ui-btn ui-btn-primary !h-12 !px-6 text-base" onClick={punch} disabled={busy}>
          {me.clockedIn || outOnly ? <LogOut size={18} aria-hidden="true" /> : <LogIn size={18} aria-hidden="true" />}
          {busy ? 'Saving…' : me.clockedIn || outOnly ? 'Clock out' : 'Clock in'}
        </button> : null}
        {/* The company's punch policy says this browser may not clock in (audit #6): say why, instead of a button the server refuses. */}
        {outOnly || (!me.phone?.allowed && me.webClock?.allowed === false) ? <p className="ui-caption basis-full" role="note">{me.webClock.why}</p> : null}
        <dl className="flex flex-wrap gap-6 text-sm">
          <div><dt className="ui-t-label">Today</dt><dd>{me.today}</dd></div>
          <div><dt className="ui-t-label">In</dt><dd>{t?.checkInTime || '—'}</dd></div>
          <div><dt className="ui-t-label">Out</dt><dd>{t?.checkOutTime || '—'}</dd></div>
          <div><dt className="ui-t-label">Worked</dt><dd>{t?.checkOut ? hm(t.workedMinutes) : '—'}</dd></div>
          {t?.lateMinutes ? <div><dt className="ui-t-label">Late</dt><dd>{t.lateMinutes} min</dd></div> : null}
        </dl>
      </section>

      <section className="ui-card overflow-hidden" aria-labelledby="mine-h">
        <header className="ui-card-head"><h2 id="mine-h" className="ui-t-sec">Last 30 days</h2></header>
        <div className="ui-table-scroll">
          <table className="ui-table ui-table-sticky w-full">
            <thead>
              <tr>
                <th scope="col" className="ui-col-date">Day</th>
                <th scope="col" className="ui-col-h-center">In</th>
                <th scope="col" className="ui-col-h-center">Out</th>
                <th scope="col" className="ui-num">Worked</th>
                <th scope="col" className="ui-num">Late</th>
                <th scope="col" className="ui-col-h-center">Status</th>
                <th scope="col" className="w-10"><span className="sr-only">Why</span></th>
              </tr>
            </thead>
            <tbody className="ui-rows">
              {me.records.map((r) => (
                <tr key={r.id}>
                  <td className="ui-col-date whitespace-nowrap">{dayLabel(r.date, { weekday: true, year: false })}</td>
                  <td className="ui-col-h-center">{r.checkInTime || '—'}</td>
                  <td className="ui-col-h-center">{r.checkOutTime || '—'}</td>
                  <td className="ui-num">{r.checkOut ? hm(r.workedMinutes) : '—'}</td>
                  <td className="ui-num">{r.lateMinutes ? `${r.lateMinutes}m` : '—'}</td>
                  <td className="ui-col-h-center"><span className={`ui-pill ${STATUS[r.status]?.pill || 'ui-pill-neutral'}`}>{STATUS[r.status]?.label || r.status}</span></td>
                  <td className="ui-col-meta">
                    <button type="button" className="ui-icon-btn" title="Why does this day say this?" aria-label={`Why is ${dayLabel(r.date)} ${STATUS[r.status]?.label?.toLowerCase() || r.status}?`} onClick={() => setExplaining(r.date)}>
                      <HelpCircle size={16} aria-hidden="true" />
                    </button>
                  </td>
                </tr>
              ))}
              {!me.records.length ? (
                <tr><td colSpan={7} className="ui-muted py-6 text-center text-sm">No days yet.</td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="ui-card p-4" aria-labelledby="fix-h">
        <h2 id="fix-h" className="ui-t-sec mb-3">Ask for a correction</h2>
        <form onSubmit={ask} className="grid gap-3 sm:grid-cols-4">
          <label className="block"><span className="ui-label">Day</span><input type="date" className="ui-input w-full" max={todayIst()} required value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></label>
          <label className="block"><span className="ui-label">In</span><input type="time" className="ui-input w-full" required value={form.checkIn} onChange={(e) => setForm({ ...form, checkIn: e.target.value })} /></label>
          <label className="block"><span className="ui-label">Out</span><input type="time" className="ui-input w-full" value={form.checkOut} onChange={(e) => setForm({ ...form, checkOut: e.target.value })} /></label>
          <label className="block">
            <span className="ui-label">What happened</span>
            <select className="ui-select w-full" value={form.reasonCode} onChange={(e) => setForm({ ...form, reasonCode: e.target.value })}>
              <option value="">Choose…</option>
              {REASON_CODES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
          </label>
          <label className="block sm:col-span-4"><span className="ui-label">Reason</span><input className="ui-input w-full" required minLength={3} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} /></label>
          <div className="sm:col-span-4"><button type="submit" className="ui-btn ui-btn-secondary">Send for approval</button></div>
        </form>
        {me.requests.length ? (
          <ul className="mt-4 space-y-1 text-sm">
            {me.requests.map((r) => (
              <li key={r.id} className="flex items-center justify-between">
                <span>{dayLabel(r.date)} — {r.reason}</span>
                <span className={`ui-pill ${r.status === 'APPROVED' ? 'ui-pill-pos' : r.status === 'REJECTED' ? 'ui-pill-neg' : 'ui-pill-warn'}`}>{r.status.toLowerCase()}</span>
              </li>
            ))}
          </ul>
        ) : null}
      </section>
      </div>
      <DayExplain open={Boolean(explaining)} onClose={() => setExplaining(null)} load={explainLoad} title="Why my day says this" />
    </div>
  );
}
