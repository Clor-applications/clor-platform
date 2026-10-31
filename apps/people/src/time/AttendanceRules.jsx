import React, { useMemo, useState } from 'react';

import { Button, PageHeader, SkeletonCard } from '@ui/components/ui/Primitives';
import ErrorState from '@ui/components/ui/ErrorState';
import useRequest from '@ui/components/ui/useRequest';
import useUnsavedChanges from '@ui/components/ui/useUnsavedChanges';
import { notify } from '@ui/components/ui/notify';
import { getRequestRules } from '@ui/timeOff/api';

import { getAttendanceRules, previewLateMarks, saveAttendanceRules } from './api';
import { dayAmount, istToday, lastMonth, minutesText, monthTitle, shiftMonth } from './shared';

/**
 * Settings → Attendance rules (WORKFLOW-GAP-RESEARCH-2026-10-30 4.4, 4.5, 4.6, B19): one sheet, a
 * block per rule, Save in its footer. Late marks cost pay, so they start off and show who they would
 * hit before they are saved. The missing-punch limit lives with the request types; it is shown here
 * so the two rules read together.
 */
const num = (v) => (v === '' || v == null ? '' : String(v));
const toForm = (r) => ({
  marksOn: Boolean(r.marks.on),
  lateOn: Boolean(r.marks.late.on), lateEvery: num(r.marks.late.every), lateFree: num(r.marks.late.free), lateGrace: num(r.marks.late.graceMinutes),
  earlyOn: Boolean(r.marks.early.on), earlyEvery: num(r.marks.early.every), earlyFree: num(r.marks.early.free), earlyGrace: num(r.marks.early.graceMinutes),
  cost: String(r.marks.cost), takeFrom: r.marks.takeFrom || [],
  cutMode: r.marks.cutMode || 'TIME_MISSED', roundTo: String(r.marks.roundToMinutes || 15),
  nudgeOn: Boolean(r.nudge.on), afterHours: num(r.nudge.afterHours), managerDigest: Boolean(r.nudge.managerDigest),
  absenceOn: Boolean(r.absence.on), absenceDays: num(r.absence.days), noticeGapDays: num(r.absence.noticeGapDays), replyDays: num(r.absence.replyDays),
  nightOn: Boolean(r.night.on), nightFrom: r.night.from, nightTo: r.night.to, nightMode: r.night.mode || 'ENFORCE',
});
const int = (v, lo, hi, dflt) => Math.max(lo, Math.min(hi, Number.isFinite(Number(v)) && v !== '' ? Math.round(Number(v)) : dflt));
const marksBody = (f) => ({
  on: f.marksOn,
  late: { on: f.lateOn, every: int(f.lateEvery, 1, 31, 3), free: int(f.lateFree, 0, 31, 0), graceMinutes: f.lateGrace === '' ? null : int(f.lateGrace, 0, 240, 0) },
  early: { on: f.earlyOn, every: int(f.earlyEvery, 1, 31, 3), free: int(f.earlyFree, 0, 31, 0), graceMinutes: f.earlyGrace === '' ? null : int(f.earlyGrace, 0, 240, 0) },
  cost: f.cost === '1' ? 1 : 0.5,
  takeFrom: f.takeFrom,
  cutMode: f.cutMode,
  roundToMinutes: Number(f.roundTo) === 30 ? 30 : Number(f.roundTo) === 60 ? 60 : 15,
});
/* How much a mark cuts (DECISIONS.md 1): the time missed is what the law allows (Code on Wages 2019, s.20). */
const CUTS = [
  ['TIME_MISSED', 'The time actually missed'],
  ['TIME_MISSED_ROUNDED_DOWN', 'The time missed, rounded down'],
  ['HALF_DAY_PER_N', 'Every few marks, half or a full day'],
];
/* What a minute cut takes, in the words of the mode chosen (never more than the time missed). */
const cutCaption = (f) => {
  const tail = 'The free ones and the minutes allowed above apply first.';
  if (f.cutMode !== 'TIME_MISSED_ROUNDED_DOWN') return `A mark cuts the minutes the person was late or left early, as a part of the day on their shift. ${tail}`;
  const step = Number(f.roundTo) || 15;
  const unit = step === 60 ? 'whole hours' : `${step} minutes`;
  return `A mark cuts its minutes rounded down to ${unit}, as a part of the day on their shift: ${step + 5} minutes late cuts ${step}, ${step - 5} minutes cuts nothing. It never cuts more than the time missed. ${tail}`;
};
const toBody = (f) => ({
  marks: marksBody(f),
  nudge: { on: f.nudgeOn, afterHours: int(f.afterHours, 0, 24, 2), managerDigest: f.managerDigest },
  absence: { on: f.absenceOn, days: int(f.absenceDays, 2, 30, 5), noticeGapDays: int(f.noticeGapDays, 1, 30, 7), replyDays: int(f.replyDays, 1, 30, 7) },
  night: { on: f.nightOn, from: f.nightFrom, to: f.nightTo, mode: f.nightMode },
});

function Num({ label, value, onChange, min = 0, max = 31, placeholder, suffix }) {
  return (
    <label className="block">
      <span className="ui-label">{label}</span>
      <span className="flex items-center gap-2">
        <input type="number" min={min} max={max} step={1} className="ui-input w-full tabular-nums" value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
        {suffix ? <span className="ui-caption whitespace-nowrap">{suffix}</span> : null}
      </span>
    </label>
  );
}

function Block({ id, title, on, onToggle, children, footer = null }) {
  return (
    <fieldset className="py-6 first:pt-0 last:pb-0 space-y-4" aria-labelledby={`${id}-h`}>
      <div className="flex items-center justify-between gap-4">
        <legend id={`${id}-h`} className="ui-t-sec">{title}</legend>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="ui-checkbox" checked={on} onChange={(e) => onToggle(e.target.checked)} />On</label>
      </div>
      {on ? children : null}
      {footer}
    </fieldset>
  );
}

export default function AttendanceRules({ openScreen }) {
  const req = useRequest(() => getAttendanceRules(), []);
  const reqRules = useRequest(() => getRequestRules().catch(() => null), []);
  const saved = useMemo(() => (req.data?.rules ? toForm(req.data.rules) : null), [req.data]);
  const [draft, setDraft] = useState(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [preview, setPreview] = useState(null);
  const [previewing, setPreviewing] = useState(false);
  /* A late-mark change counts from next month unless HR says this month (a month is worked out under the rule of its last day). */
  const [marksFrom, setMarksFrom] = useState('NEXT_MONTH');
  const form = draft || saved;
  const dirty = Boolean(form && saved && JSON.stringify(form) !== JSON.stringify(saved));
  useUnsavedChanges(dirty);
  const canEdit = Boolean(req.data?.canEdit);
  const leaveTypes = req.data?.leaveTypes || [];
  const month = lastMonth();
  const thisMonth = istToday().slice(0, 7);
  const marksChanged = Boolean(form && saved && JSON.stringify(marksBody(form)) !== JSON.stringify(marksBody(saved)));

  if (req.error && !req.data) return <div className="space-y-6 max-w-2xl"><PageHeader title="Attendance rules" /><ErrorState error={req.error} onRetry={req.reload} /></div>;
  if (!form) return <div className="space-y-6 max-w-2xl"><PageHeader title="Attendance rules" /><SkeletonCard lines={8} /></div>;

  const set = (patch) => { setError(null); setPreview(null); setDraft({ ...form, ...patch }); };
  const toggleType = (typeId, on) => set({ takeFrom: on ? [...form.takeFrom, typeId] : form.takeFrom.filter((t) => t !== typeId) });
  const missedLimit = reqRules.data?.rules?.MISSED_PUNCH?.quotaPerMonth;

  const save = async (e) => {
    e.preventDefault();
    if (!dirty || saving) return;
    setSaving(true);
    setError(null);
    try {
      const out = await saveAttendanceRules({ ...toBody(form), ...(marksChanged ? { marksFrom } : {}) });
      req.setData((d) => ({ ...d, rules: out.rules, version: out.version }));
      setDraft(null);
      setMarksFrom('NEXT_MONTH');
      notify.success(out.marksFrom ? `Attendance rules saved. The late-mark change counts from ${monthTitle(out.marksFrom.slice(0, 7))}.` : 'Attendance rules saved.');
    } catch (err) {
      setError(err);
      notify.error(String(err?.message || 'Not saved.'));
    } finally {
      setSaving(false);
    }
  };
  const runPreview = async () => {
    setPreviewing(true);
    try {
      setPreview(await previewLateMarks(month, { ...marksBody(form), on: true }));
    } catch (err) {
      notify.error(String(err?.message || 'Could not work it out.'));
    } finally {
      setPreviewing(false);
    }
  };
  const order = (typeId) => form.takeFrom.indexOf(typeId);
  /* When a late-mark change counts: in the late-marks section, shown even when the change is switching them off. */
  const marksWhen = canEdit && marksChanged ? (
    <div className="space-y-3">
      <label className="block max-w-sm">
        <span className="ui-label">Late-mark change counts</span>
        <select className="ui-select w-full" value={marksFrom} onChange={(e) => setMarksFrom(e.target.value)}>
          <option value="NEXT_MONTH">From {monthTitle(shiftMonth(thisMonth, 1))}</option>
          <option value="THIS_MONTH">From this month, {monthTitle(thisMonth)}</option>
        </select>
      </label>
      {marksFrom === 'THIS_MONTH' ? (
        <p className="ui-alert ui-alert-warn text-sm" role="alert">Every late mark in {monthTitle(thisMonth)} so far is worked out again under the new rule, so what people lose this month changes.</p>
      ) : (
        <p className="ui-caption">{monthTitle(thisMonth)} stays under the rule it started with.</p>
      )}
    </div>
  ) : null;


  return (
    <div className="space-y-6 max-w-2xl">
      <PageHeader title="Attendance rules" />
      <form className="ui-record-section ui-wizard-body" aria-label="Attendance rules" onSubmit={save}>
        {error ? <ErrorState error={error?.status ? error : null} compact title={error?.status ? undefined : error.message} body={error?.status && error.status < 500 ? error.message : undefined} /> : null}
        <fieldset disabled={!canEdit} className="divide-y min-w-0" style={{ borderColor: 'rgb(var(--border))' }}>
            <Block id="ar-marks" title="Late marks and early exits" footer={marksWhen} on={form.marksOn} onToggle={(v) => set({ marksOn: v, ...(v && !form.lateOn && !form.earlyOn ? { lateOn: true } : {}) })}>
              <div className="space-y-3">
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="ui-checkbox" checked={form.lateOn} onChange={(e) => set({ lateOn: e.target.checked })} />Count late arrivals</label>
                {form.lateOn ? (
                  <div className="grid gap-4 sm:grid-cols-3">
                    <Num label="Late by more than" value={form.lateGrace} onChange={(v) => set({ lateGrace: v })} max={240} placeholder="Shift grace" suffix="min" />
                    {form.cutMode === 'HALF_DAY_PER_N' ? <Num label="Every" value={form.lateEvery} onChange={(v) => set({ lateEvery: v })} min={1} suffix="late marks" /> : null}
                    <Num label="Free each month" value={form.lateFree} onChange={(v) => set({ lateFree: v })} />
                  </div>
                ) : null}
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="ui-checkbox" checked={form.earlyOn} onChange={(e) => set({ earlyOn: e.target.checked })} />Count early exits</label>
                {form.earlyOn ? (
                  <div className="grid gap-4 sm:grid-cols-3">
                    <Num label="Early by more than" value={form.earlyGrace} onChange={(v) => set({ earlyGrace: v })} max={240} placeholder="Shift grace" suffix="min" />
                    {form.cutMode === 'HALF_DAY_PER_N' ? <Num label="Every" value={form.earlyEvery} onChange={(v) => set({ earlyEvery: v })} min={1} suffix="early exits" /> : null}
                    <Num label="Free each month" value={form.earlyFree} onChange={(v) => set({ earlyFree: v })} />
                  </div>
                ) : null}
              </div>
              <div className="grid gap-4 sm:grid-cols-3">
                <label className="block sm:col-span-2">
                  <span className="ui-label">Each mark cuts</span>
                  <select className="ui-select w-full" value={form.cutMode} onChange={(e) => set({ cutMode: e.target.value })}>
                    {CUTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </label>
                {form.cutMode === 'TIME_MISSED_ROUNDED_DOWN' ? (
                  <label className="block">
                    <span className="ui-label">Round each down to</span>
                    <select className="ui-select w-full" value={form.roundTo} onChange={(e) => set({ roundTo: e.target.value })}>
                      <option value="15">15 minutes</option>
                      <option value="30">30 minutes</option>
                      <option value="60">1 hour</option>
                    </select>
                  </label>
                ) : null}
                {form.cutMode === 'HALF_DAY_PER_N' ? (
                  <label className="block">
                    <span className="ui-label">Costs</span>
                    <select className="ui-select w-full" value={form.cost} onChange={(e) => set({ cost: e.target.value })}>
                      <option value="0.5">Half a day</option>
                      <option value="1">A full day</option>
                    </select>
                  </label>
                ) : null}
              </div>
              {form.cutMode === 'HALF_DAY_PER_N' ? (
                <p className="ui-alert ui-alert-warn text-sm" role="note">This can cut more than the time missed. The law allows a cut only for the time missed (Code on Wages 2019, s.20). Late marks shows each person’s cut beside their time missed.</p>
              ) : (
                <p className="ui-caption">{cutCaption(form)}</p>
              )}
              <div className="space-y-2">
                <span className="ui-label">Take it from</span>
                {leaveTypes.length ? (
                  <ul className="space-y-1.5">
                    {leaveTypes.map((t) => (
                      <li key={t.id}>
                        <label className="flex items-center gap-2 text-sm">
                          <input type="checkbox" className="ui-checkbox" checked={order(t.id) >= 0} onChange={(e) => toggleType(t.id, e.target.checked)} />
                          {t.name}
                          {order(t.id) >= 0 && form.takeFrom.length > 1 ? <span className="ui-caption tabular-nums">{order(t.id) + 1}{order(t.id) === 0 ? 'st' : order(t.id) === 1 ? 'nd' : order(t.id) === 2 ? 'rd' : 'th'}</span> : null}
                        </label>
                      </li>
                    ))}
                  </ul>
                ) : null}
                <p className="ui-caption">{form.takeFrom.length ? 'In whole half days, in the order ticked. Anything under half a day, and what there is no leave left for, is unpaid.' : 'Unpaid (loss of pay).'}</p>
              </div>
              <p className="text-sm">
                Missed-punch requests a month: <span className="tabular-nums font-medium">{missedLimit == null ? 'no limit' : missedLimit}</span>.{' '}
                {openScreen ? <button type="button" className="ui-link" onClick={() => openScreen('requestRules')}>Change in Attendance request types</button> : null}
              </p>
              <div className="space-y-3">
                <button type="button" className="ui-btn ui-btn-secondary" disabled={previewing || (!form.lateOn && !form.earlyOn)} onClick={runPreview}>{previewing ? 'Working it out…' : `Who this hits in ${monthTitle(month)}`}</button>
                {preview ? <PreviewTable preview={preview} /> : null}
              </div>
            </Block>

            <Block id="ar-nudge" title="Missing punches" on={form.nudgeOn} onToggle={(v) => set({ nudgeOn: v })}>
              <div className="grid gap-4 sm:grid-cols-3">
                <Num label="Tell them after the shift ends" value={form.afterHours} onChange={(v) => set({ afterHours: v })} max={24} suffix="hours" />
              </div>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="ui-checkbox" checked={form.managerDigest} onChange={(e) => set({ managerDigest: e.target.checked })} />Send each manager a morning list of their team’s unfixed days</label>
            </Block>

            <Block id="ar-absence" title="Unexplained absence" on={form.absenceOn} onToggle={(v) => set({ absenceOn: v })}>
              <div className="grid gap-4 sm:grid-cols-3">
                <Num label="Tell HR after" value={form.absenceDays} onChange={(v) => set({ absenceDays: v })} min={2} max={30} suffix="working days" />
                <Num label="Second notice after" value={form.noticeGapDays} onChange={(v) => set({ noticeGapDays: v })} min={1} max={30} suffix="days" />
                <Num label="Days to answer a notice" value={form.replyDays} onChange={(v) => set({ replyDays: v })} min={1} max={30} />
              </div>
              <p className="ui-caption">Check the number of days against your standing orders; states differ.</p>
            </Block>

            <Block id="ar-night" title="Night work for women" on={form.nightOn} onToggle={(v) => set({ nightOn: v })}>
              <div className="grid gap-4 sm:grid-cols-3">
                <label className="block"><span className="ui-label">Night from</span><input type="time" className="ui-input w-full tabular-nums" value={form.nightFrom} onChange={(e) => set({ nightFrom: e.target.value })} /></label>
                <label className="block"><span className="ui-label">Until</span><input type="time" className="ui-input w-full tabular-nums" value={form.nightTo} onChange={(e) => set({ nightTo: e.target.value })} /></label>
                <label className="block">
                  <span className="ui-label">Without consent</span>
                  <select className="ui-select w-full" value={form.nightMode} onChange={(e) => set({ nightMode: e.target.value })}>
                    <option value="ENFORCE">Refuse the shift</option>
                    <option value="WARN">Save it and warn</option>
                  </select>
                </label>
              </div>
              <p className="ui-caption">A woman needs her written consent on file to work these hours (OSH Code 2020, s.43: before 6 am or after 7 pm; some states set other hours). With a warning, the shift is saved and she is listed on Home and under Night work until consent is recorded.</p>
            </Block>
        </fieldset>

        {canEdit ? (
          <div className="ui-wizard-actions">
            <span className="flex flex-wrap gap-2 ml-auto">
              {dirty ? <button type="button" className="ui-btn ui-btn-secondary" onClick={() => { setDraft(null); setError(null); setPreview(null); setMarksFrom('NEXT_MONTH'); }}>Undo changes</button> : null}
              <Button type="submit" variant="primary" loading={saving} disabled={!dirty && !saving}>Save</Button>
            </span>
          </div>
        ) : null}
      </form>
    </div>
  );
}

function PreviewTable({ preview }) {
  const rows = preview.rows || [];
  if (!rows.length) return <p className="text-sm" role="status">Nobody in {monthTitle(preview.month)}.</p>;
  return (
    <div className="ui-table-scroll border-t" style={{ borderColor: 'rgb(var(--border))' }} role="status">
      <table className="w-full text-sm" aria-label={`Penalties in ${monthTitle(preview.month)}`}>
        <thead>
          <tr className="text-left">
            <th scope="col" className="py-2 pr-3 font-medium">Employee</th>
            <th scope="col" className="py-2 pr-3 text-right font-medium">Late</th>
            <th scope="col" className="py-2 pr-3 text-right font-medium">Early</th>
            <th scope="col" className="py-2 pr-3 text-right font-medium">Now</th>
            <th scope="col" className="py-2 pr-3 text-right font-medium">With this</th>
            <th scope="col" className="py-2 text-right font-medium">Time missed</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.employeeId} className="border-t" style={{ borderColor: 'rgb(var(--border))' }}>
              <td className="py-2 pr-3">{r.name}</td>
              <td className="py-2 pr-3 text-right tabular-nums">{r.lateMarks}</td>
              <td className="py-2 pr-3 text-right tabular-nums">{r.earlyMarks}</td>
              <td className="py-2 pr-3 text-right tabular-nums">{dayAmount(r.now)}</td>
              <td className="py-2 pr-3 text-right tabular-nums font-medium">{dayAmount(r.then)}</td>
              <td className="py-2 text-right tabular-nums">{r.timeMissedMinutes ? minutesText(r.timeMissedMinutes) : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="ui-caption pt-2">{preview.totals.people} {preview.totals.people === 1 ? 'person' : 'people'}, {dayAmount(preview.totals.then)} in all. Nothing is saved until you press Save.</p>
    </div>
  );
}
