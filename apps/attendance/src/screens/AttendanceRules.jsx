import React, { useCallback, useEffect, useState } from 'react';

import { PageHeader, SkeletonCard } from '@ui/components/ui/Primitives';
import { notify } from '@ui/components/ui/notify';
import { dayLabel, getRules, hm, listRuleVersions, listShifts, recompute, saveRules, simulateRules, todayIst } from '../api/attendance';
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

  const header = <PageHeader entity="settings" title="Attendance policy" description="Company-wide. Grace, half day, overtime and weekly offs are set on each shift." />;
  if (!rules) {
    return (
      <div className="space-y-3">
        {header}
        <div className="pb-8 max-w-3xl">
          {loadError ? <LoadFailed message={loadError} onRetry={() => setAttempt((n) => n + 1)} /> : <SkeletonCard lines={6} />}
        </div>
      </div>
    );
  }
  const num = (k, fallback = 0) => (e) => setRules({ ...rules, [k]: e.target.value === '' ? fallback : Number(e.target.value) });
  return (
    <div className="space-y-3">
      {header}

      {/* A settings page: the compact column (DESIGN.md, Content width), not a field stretched across the screen. */}
      <div className="pb-8 max-w-3xl space-y-6">
      <form onSubmit={save} className="space-y-3">
        <section className="ui-card space-y-3 p-4" aria-labelledby="rules-default-h">
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

        <section className="ui-card space-y-3 p-4" aria-labelledby="rules-late-h">
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

        <section className="ui-card space-y-3 p-4" aria-labelledby="rules-readers-h">
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

        <section className="ui-card space-y-3 p-4" aria-labelledby="approvals-h">
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

      <section className="ui-card space-y-3 p-4" aria-labelledby="recompute-h">
        <h2 id="recompute-h" className="ui-t-sec">Recalculate past days</h2>
        <p className="ui-caption">After changing shifts or schedules. Days set by hand, corrections and leave stay as they are. Up to 62 days at a time.</p>
        <div className="flex flex-wrap items-end gap-3">
          <label className="block"><span className="ui-label">From</span><input type="date" className="ui-input" value={range.from} max={range.to} onChange={(e) => setRange({ ...range, from: e.target.value })} /></label>
          <label className="block"><span className="ui-label">To</span><input type="date" className="ui-input" value={range.to} max={todayIst()} onChange={(e) => setRange({ ...range, to: e.target.value })} /></label>
          <button type="button" className="ui-btn ui-btn-secondary" disabled={busy} onClick={run}>{busy ? 'Recalculating…' : 'Recalculate'}</button>
        </div>
      </section>

      <RulePreview shifts={shifts} />
      <RuleHistory shifts={shifts} attempt={attempt} />
      </div>
    </div>
  );
}

const RULE_FIELDS = [
  ['startTime', 'Start', 'time'],
  ['endTime', 'End', 'time'],
  ['graceMinutes', 'Grace (min)'],
  ['earlyOutGraceMinutes', 'Early-out grace (min)'],
  ['breakMinutes', 'Break (min)'],
  ['halfDayMinutes', 'Half day (min)'],
  ['fullDayMinutes', 'Full day (min)'],
  ['overtimeAfterMinutes', 'Overtime after (min)'],
];
const STATUS_WORD = { PRESENT: 'Present', HALF_DAY: 'Half day', ABSENT: 'Absent', ON_LEAVE: 'On leave', HOLIDAY: 'Holiday', WEEKLY_OFF: 'Weekly off' };
const pair = (k, [a, b]) => (k === 'status' ? `${STATUS_WORD[a] || a} → ${STATUS_WORD[b] || b}` : k.endsWith('Minutes') && k !== 'lateMinutes' && k !== 'earlyOutMinutes' ? `${hm(a)} → ${hm(b)}` : `${a} → ${b} min`);

/**
 * What a change to a shift would do to days already worked, before it is
 * saved. Nothing is written: the server scores the same punches under both
 * rules and lists every day whose figures would differ.
 */
function RulePreview({ shifts }) {
  const [shiftId, setShiftId] = useState('');
  const [changes, setChanges] = useState({});
  const [range, setRange] = useState({ from: monthStart(), to: todayIst() });
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const shift = shifts.find((s) => s.id === shiftId);
  const run = async () => {
    setBusy(true);
    try {
      const body = Object.fromEntries(Object.entries(changes).filter(([, v]) => v !== '' && v !== undefined).map(([k, v]) => [k, k.endsWith('Time') ? v : Number(v)]));
      setResult(await simulateRules({ shiftId, changes: body, ...range }));
    } catch (err) {
      notify.error(String(err?.message || 'Could not preview.'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="ui-card space-y-3 p-4" aria-labelledby="preview-h">
      <h2 id="preview-h" className="ui-t-sec">Preview a shift change</h2>
      <p className="ui-caption">See which days would change before you edit a shift. Nothing is saved here.</p>
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block">
          <span className="ui-label">Shift</span>
          <select className="ui-select w-full" value={shiftId} onChange={(e) => { setShiftId(e.target.value); setChanges({}); setResult(null); }}>
            <option value="">Choose…</option>
            {shifts.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.startTime}–{s.endTime})</option>)}
          </select>
        </label>
        <label className="block"><span className="ui-label">Days from</span><input type="date" className="ui-input w-full" value={range.from} max={range.to} onChange={(e) => setRange({ ...range, from: e.target.value })} /></label>
        <label className="block"><span className="ui-label">To</span><input type="date" className="ui-input w-full" value={range.to} max={todayIst()} onChange={(e) => setRange({ ...range, to: e.target.value })} /></label>
      </div>
      {shift ? (
        <div className="grid gap-3 sm:grid-cols-4">
          {RULE_FIELDS.map(([k, label, type]) => (
            <label key={k} className="block">
              <span className="ui-label">{label}</span>
              <input type={type || 'number'} min={0} className="ui-input w-full" placeholder={shift[k] == null ? 'Full day' : String(shift[k])} value={changes[k] ?? ''} onChange={(e) => setChanges({ ...changes, [k]: e.target.value })} />
            </label>
          ))}
        </div>
      ) : null}
      <button type="button" className="ui-btn ui-btn-secondary" disabled={!shift || busy || !Object.values(changes).some((v) => v !== '')} onClick={run}>{busy ? 'Working it out…' : 'Preview'}</button>
      {result ? (
        <div className="space-y-2">
          <p className="text-sm">
            <strong>{result.changedDays}</strong> of {result.compared} day{result.compared === 1 ? '' : 's'} would change
            {result.changedDays ? ` (status ${result.tally.status}, late ${result.tally.late}, overtime ${result.tally.overtime})` : ''}.
            {result.skipped ? <span className="ui-caption"> {result.skipped} not compared: leave, no check-in, or a closed month.</span> : null}
          </p>
          {result.days.length ? (
            <div className="ui-table-scroll">
                <table className="ui-table ui-table-sticky w-full">
                  <thead><tr><th scope="col">Day</th><th scope="col">Employee</th><th scope="col">In–out</th><th className="ui-col-grow" scope="col">Would change</th></tr></thead>
                  <tbody className="ui-rows">
                    {result.days.map((d) => (
                      <tr key={`${d.employeeId}-${d.date}`}>
                        <td className="ui-col-date whitespace-nowrap">{dayLabel(d.date, { weekday: true, year: false })}</td>
                        <td className="ui-col-entity">{d.name}</td>
                        <td className="tabular-nums whitespace-nowrap">{d.in}–{d.out || '—'}</td>
                        <td className="text-sm">{['status', 'lateMinutes', 'workedMinutes', 'overtimeMinutes', 'earlyOutMinutes'].filter((k) => d[k]).map((k) => <span key={k} className="mr-3 whitespace-nowrap"><span className="ui-caption">{{ status: 'Status', lateMinutes: 'Late', workedMinutes: 'Worked', overtimeMinutes: 'Overtime', earlyOutMinutes: 'Early out' }[k]}</span> {pair(k, d[k])}</span>)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
            </div>
          ) : null}
          <p className="ui-caption">To apply it: edit the shift under Shifts, then recalculate these days above.</p>
        </div>
      ) : null}
    </section>
  );
}

const RULE_LABEL = { lateAllowancePerMonth: 'Free late arrivals', latePenaltyEvery: 'Half day lost every', photoRetentionDays: 'Selfies kept (days)', defaultShiftId: 'Default shift', readerUsersBecomeEmployees: 'Reader people become employees', leaveApproval: 'Leave approval', correctionApproval: 'Correction approval', startTime: 'Start', endTime: 'End', breakMinutes: 'Break', graceMinutes: 'Grace', earlyOutGraceMinutes: 'Early-out grace', halfDayMinutes: 'Half day', fullDayMinutes: 'Full day', overtimeAfterMinutes: 'Overtime after', weeklyOffDays: 'Weekly offs', offSaturdays: 'Saturdays off', isActive: 'Active' };

/** Every saved change to the rules and to shifts' scoring: when, who, and what moved. */
function RuleHistory({ shifts, attempt }) {
  const [versions, setVersions] = useState(null);
  const load = useCallback(() => { listRuleVersions().then(setVersions).catch(() => setVersions([])); }, []);
  useEffect(() => { load(); }, [load, attempt]);
  const shiftName = (id) => shifts.find((s) => s.id === id)?.name || 'a shift';
  const show = (k, v) => (v == null || v === '' ? '—' : k === 'defaultShiftId' ? shiftName(v) : typeof v === 'boolean' ? (v ? 'Yes' : 'No') : String(v));
  if (!versions?.length) return null;
  return (
    <section className="ui-card overflow-hidden" aria-labelledby="history-h">
      <div className="flex items-center justify-between px-4 pt-4 pb-2"><h2 id="history-h" className="ui-t-sec">Changes to the rules</h2><button type="button" className="ui-btn ui-btn-ghost ui-btn-sm" onClick={load}>Refresh</button></div>
      <ol className="divide-y">
        {versions.slice(0, 30).map((v) => {
          const keys = Object.keys({ ...(v.before || {}), ...(v.after || {}) }).filter((k) => JSON.stringify(v.before?.[k]) !== JSON.stringify(v.after?.[k]));
          return (
            <li key={v.version} className="px-4 py-2.5 text-sm">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <strong>{v.kind === 'SHIFT' ? `Shift ${v.name}` : 'Company rules'}</strong>
                <span className="ui-caption">{new Date(v.at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })} · {v.by}</span>
              </div>
              <p className="ui-caption">{keys.map((k) => `${RULE_LABEL[k] || k}: ${show(k, v.before?.[k])} → ${show(k, v.after?.[k])}`).join(' · ') || 'Saved with no change to scoring.'}</p>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
