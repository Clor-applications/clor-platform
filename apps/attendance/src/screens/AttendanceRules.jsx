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
      notify.success('Rules saved. Past days keep their figures until you recalculate them below.');
    } catch (err) {
      notify.error(String(err?.message || 'Not saved.'));
    }
  };
  const run = async () => {
    setBusy(true);
    try {
      const r = await recompute(range);
      notify.success(`${r.recomputed} days recalculated.`);
    } catch (err) {
      notify.error(String(err?.message || 'Not done.'));
    } finally {
      setBusy(false);
    }
  };

  if (!rules) return loadError ? <LoadFailed message={loadError} onRetry={() => setAttempt((n) => n + 1)} /> : <SkeletonCard lines={6} />;
  const num = (k, fallback = 0) => (e) => setRules({ ...rules, [k]: e.target.value === '' ? fallback : Number(e.target.value) });
  return (
    <div className="space-y-6">
      <PageHeader entity="attendance" title="Attendance rules" description="Company-wide. Grace, half day, overtime and weekly offs are set on each shift." />

      {/* A settings page: the compact column (DESIGN.md, Content width), not a field stretched across the screen. */}
      <form onSubmit={save} className="max-w-2xl space-y-6">
        <section className="ui-card space-y-3 p-5" aria-labelledby="rules-default-h">
          <h2 id="rules-default-h" className="ui-t-sec">Default shift</h2>
          <label className="block">
            <span className="ui-label">For anyone with no schedule</span>
            <select className="ui-select w-full" value={rules.defaultShiftId || ''} onChange={(e) => setRules({ ...rules, defaultShiftId: e.target.value })}>
              <option value="">Standard 09:00–18:00, Sunday off</option>
              {shifts.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.startTime}–{s.endTime})</option>)}
            </select>
            <span className="ui-caption">Used only when no temporary, personal, rotation or department schedule applies.</span>
          </label>
        </section>

        <section className="ui-card space-y-3 p-5" aria-labelledby="rules-late-h">
          <h2 id="rules-late-h" className="ui-t-sec">Late arrivals</h2>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className="ui-label">Free late arrivals a month</span>
              <input type="number" inputMode="numeric" min={0} max={31} className="ui-input w-full" value={rules.lateAllowancePerMonth} onChange={num('lateAllowancePerMonth')} />
            </label>
            <label className="block">
              <span className="ui-label">Then half a day’s pay lost every</span>
              <div className="flex items-center gap-2">
                <input type="number" inputMode="numeric" min={0} max={31} className="ui-input w-24" value={rules.latePenaltyEvery} onChange={num('latePenaltyEvery')} aria-describedby="late-every-hint" />
                <span className="text-sm">late arrivals</span>
              </div>
            </label>
          </div>
          <p id="late-every-hint" className="ui-caption">
            {Number(rules.latePenaltyEvery) > 0
              ? `After ${Number(rules.lateAllowancePerMonth) || 0} free, every ${rules.latePenaltyEvery} late arrivals cost half a day.`
              : 'No penalty: set a number above 0 to turn it on.'}
          </p>
        </section>

        <section className="ui-card space-y-3 p-5" aria-labelledby="rules-readers-h">
          <h2 id="rules-readers-h" className="ui-t-sec">Readers and phone punches</h2>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" className="ui-checkbox mt-0.5" checked={rules.readerUsersBecomeEmployees !== false} onChange={(e) => setRules({ ...rules, readerUsersBecomeEmployees: e.target.checked })} />
            <span>
              Add people enrolled on a reader as employees
              <span className="ui-caption block">Named as on the reader and copied to your other readers. Off: their punches wait under Unmatched punches.</span>
            </span>
          </label>
          <label className="block">
            <span className="ui-label">Keep phone-punch selfies for</span>
            <div className="flex items-center gap-2">
              <input type="number" inputMode="numeric" min={7} max={365} className="ui-input w-24" value={rules.photoRetentionDays ?? 90} onChange={num('photoRetentionDays', 90)} />
              <span className="text-sm">days</span>
            </div>
            <span className="ui-caption">Then the photo is deleted; the punch stays.</span>
          </label>
        </section>

        <section className="ui-card space-y-3 p-5" aria-labelledby="approvals-h">
          <h2 id="approvals-h" className="ui-t-sec">Who approves</h2>
          <p className="ui-caption">A manager is the person named in “Reports to” on the employee file; they decide from the portal. Someone with no manager goes straight to HR.</p>
          {[['leaveApproval', 'Leave requests'], ['correctionApproval', 'Attendance corrections']].map(([k, label]) => (
            <label key={k} className="block">
              <span className="ui-label">{label}</span>
              <select className="ui-select w-full" value={rules[k] || 'HR'} onChange={(e) => setRules({ ...rules, [k]: e.target.value })}>
                <option value="HR">HR decides (a manager may also decide from the portal)</option>
                <option value="MANAGER">The manager decides (HR can still step in)</option>
                <option value="MANAGER_THEN_HR">The manager first, then HR</option>
              </select>
            </label>
          ))}
        </section>

        <div><button type="submit" className="ui-btn ui-btn-primary">Save rules</button></div>
      </form>

      <section className="ui-card max-w-2xl space-y-3 p-5" aria-labelledby="recompute-h">
        <h2 id="recompute-h" className="ui-t-sec">Recalculate past days</h2>
        <p className="ui-caption">After changing shifts or schedules. Days set by hand, corrections and leave stay as they are. Up to 62 days at a time.</p>
        <div className="flex flex-wrap items-end gap-3">
          <label className="block"><span className="ui-label">From</span><input type="date" className="ui-input" value={range.from} max={range.to} onChange={(e) => setRange({ ...range, from: e.target.value })} /></label>
          <label className="block"><span className="ui-label">To</span><input type="date" className="ui-input" value={range.to} max={todayIst()} onChange={(e) => setRange({ ...range, to: e.target.value })} /></label>
          <button type="button" className="ui-btn ui-btn-secondary" disabled={busy} onClick={run}>{busy ? 'Recalculating…' : 'Recalculate'}</button>
        </div>
      </section>
    </div>
  );
}
