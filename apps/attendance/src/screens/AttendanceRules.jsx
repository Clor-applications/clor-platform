import React, { useEffect, useState } from 'react';

import { PageHeader, SkeletonCard } from '@ui/components/ui/Primitives';
import { notify } from '@ui/components/ui/notify';
import { getRules, listShifts, recompute, saveRules, todayIst } from '../api/attendance';
import LoadFailed from '../components/LoadFailed';

const monthStart = () => `${todayIst().slice(0, 7)}-01`;

/**
 * Company-wide attendance rules (ClorTime's Attendance Rules): the shift for
 * anyone with no schedule at all, the late-arrival penalty, and how long
 * phone-punch selfies are kept. Plus working days out again after schedules change.
 */
export default function AttendanceRules() {
  const [rules, setRules] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [shifts, setShifts] = useState([]);
  const [range, setRange] = useState({ from: monthStart(), to: todayIst() });
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    getRules().then((v) => { setRules(v); setLoadError(''); }).catch((e) => setLoadError(String(e?.message || 'Could not load the rules.')));
    listShifts().then((s) => setShifts(s.filter((x) => x.isActive))).catch(() => setShifts([]));
  }, [attempt]);

  const save = async (e) => {
    e.preventDefault();
    try {
      setRules(await saveRules({ ...rules, defaultShiftId: rules.defaultShiftId || null }));
      notify.success('Rules saved. Past days keep their figures until you work them out again below.');
    } catch (err) {
      notify.error(String(err?.message || 'Not saved.'));
    }
  };
  const run = async () => {
    setBusy(true);
    try {
      const r = await recompute(range);
      notify.success(`${r.recomputed} days worked out again.`);
    } catch (err) {
      notify.error(String(err?.message || 'Not done.'));
    } finally {
      setBusy(false);
    }
  };

  if (!rules) return loadError ? <LoadFailed message={loadError} onRetry={() => setAttempt((n) => n + 1)} /> : <SkeletonCard lines={6} />;
  return (
    <div className="space-y-6">
      <PageHeader entity="attendance" title="Attendance rules" description="Company-wide rules. Late grace, half day, overtime and weekly offs are set on each shift." />

      <form onSubmit={save} className="ui-card grid gap-4 p-5 sm:grid-cols-2">
        <label className="block sm:col-span-2">
          <span className="ui-label">Shift for anyone with no schedule</span>
          <select className="ui-select w-full" value={rules.defaultShiftId || ''} onChange={(e) => setRules({ ...rules, defaultShiftId: e.target.value })}>
            <option value="">Standard 09:00–18:00, Sunday off</option>
            {shifts.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.startTime}–{s.endTime})</option>)}
          </select>
          <span className="ui-caption">Order: temporary schedule, own schedule, rotation, department schedule, then this.</span>
        </label>
        <label className="block">
          <span className="ui-label">Late arrivals a month without penalty</span>
          <input type="number" min={0} max={31} className="ui-input w-full" value={rules.lateAllowancePerMonth} onChange={(e) => setRules({ ...rules, lateAllowancePerMonth: Number(e.target.value) })} />
        </label>
        <label className="block">
          <span className="ui-label">Then every … late arrivals = half a day’s loss of pay</span>
          <input type="number" min={0} max={31} className="ui-input w-full" value={rules.latePenaltyEvery} onChange={(e) => setRules({ ...rules, latePenaltyEvery: Number(e.target.value) })} />
          <span className="ui-caption">0 = no penalty. E.g. 3 → every third late arrival costs half a day.</span>
        </label>
        <label className="block">
          <span className="ui-label">Keep phone-punch selfies for (days)</span>
          <input type="number" min={7} max={365} className="ui-input w-full" value={rules.photoRetentionDays ?? 90} onChange={(e) => setRules({ ...rules, photoRetentionDays: Number(e.target.value) })} />
          <span className="ui-caption">Then the photo is deleted; the punch stays. Personal data — keep it no longer than you need.</span>
        </label>
        <label className="flex items-start gap-2 text-sm sm:col-span-2">
          <input type="checkbox" className="ui-checkbox mt-0.5" checked={rules.readerUsersBecomeEmployees !== false} onChange={(e) => setRules({ ...rules, readerUsersBecomeEmployees: e.target.checked })} />
          <span>
            People added on a reader become employees
            <span className="ui-caption block">Sync both ways: someone enrolled at a reader whose ID matches no employee is added here, named as on the reader, and sent to the other readers. Off: their punches wait under Unmatched punches.</span>
          </span>
        </label>
        <div className="sm:col-span-2"><button type="submit" className="ui-btn ui-btn-primary">Save rules</button></div>
      </form>

      <section className="ui-card space-y-3 p-5" aria-labelledby="recompute-h">
        <h2 id="recompute-h" className="ui-t-sec">Work days out again</h2>
        <p className="ui-caption">After changing shifts or schedules: days from readers and the clock are scored again against the schedules as they are now. Days someone set by hand, corrections and leave are not touched. Up to 62 days at a time.</p>
        <div className="flex flex-wrap items-end gap-3">
          <label className="block"><span className="ui-label">From</span><input type="date" className="ui-input" value={range.from} max={range.to} onChange={(e) => setRange({ ...range, from: e.target.value })} /></label>
          <label className="block"><span className="ui-label">To</span><input type="date" className="ui-input" value={range.to} max={todayIst()} onChange={(e) => setRange({ ...range, to: e.target.value })} /></label>
          <button type="button" className="ui-btn ui-btn-secondary" disabled={busy} onClick={run}>{busy ? 'Working…' : 'Work out again'}</button>
        </div>
      </section>
    </div>
  );
}
