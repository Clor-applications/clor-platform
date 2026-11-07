import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Clock3, Moon, Plus, Users } from 'lucide-react';

import { ColumnHeader, useColumnFilters } from '@ui/components/ColumnFilters';
import { useListSearch } from '@ui/components/ListToolbar';
import DocumentListShell from '@ui/components/list/DocumentListShell';
import { SkeletonCard, EmptyState, StatusPill } from '@ui/components/ui/Primitives';
import Drawer from '@ui/components/ui/Drawer';
import { confirmDialog, notify } from '@ui/components/ui/notify';
import { createShift, deleteShift, hm, listShifts, updateShift } from '../api/attendance';
import LoadFailed from '@ui/components/ui/LoadFailed';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const BLANK = {
  name: '',
  startTime: '09:00',
  endTime: '18:00',
  breakMinutes: 60,
  graceMinutes: 10,
  earlyOutGraceMinutes: 0,
  halfDayMinutes: 240,
  fullDayMinutes: 480,
  overtimeAfterMinutes: '',
  checkInBeforeMinutes: '',
  checkOutAfterMinutes: '',
  autoPick: false,
  weeklyOffDays: '0',
  offSaturdays: '',
  code: '',
  color: '',
  isActive: true,
};
const NTH = ['1st', '2nd', '3rd', '4th', '5th'];

const toMin = (hhmm) => {
  const [h, m] = String(hhmm || '').split(':').map(Number);
  return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : null;
};
/**
 * The minutes worked by someone in at the start and out at the end: the span
 * (past midnight for a night shift) less the break, as the server works it
 * out (compute.ts scheduledMinutes). A full day can be at most this, and
 * someone in within the grace and out on time gets a full day.
 */
const netMinutes = (f) => {
  const a = toMin(f.startTime);
  const b = toMin(f.endTime);
  if (a === null || b === null) return null;
  const span = b - a > 0 ? b - a : b - a + 24 * 60;
  const half = Number(f.halfDayMinutes) || 0;
  return span > half ? Math.max(half, span - (Number(f.breakMinutes) || 0)) : span;
};
const hoursWords = (m) => `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}`;
const offs = (s, sats) => {
  const days = s ? s.split(',').map((d) => DAYS[Number(d)]) : [];
  const nth = sats ? sats.split(',').map((n) => `${NTH[Number(n) - 1]} Sat`) : [];
  return [...days, ...nth].join(', ') || 'None';
};

const TABS = [
  { value: '', label: 'All', tone: 'all' },
  { value: 'ACTIVE', label: 'Active', tone: 'paid' },
  { value: 'INACTIVE', label: 'Inactive', tone: 'cancelled' },
];
const COLUMNS = {
  name: (s) => s.name,
  off: (s) => offs(s.weeklyOffDays, s.offSaturdays),
  active: (s) => (s.isActive ? 'Active' : 'Inactive'),
};

/**
 * Work timings. People with no shift fall back to 09:00–18:00, Sunday off.
 * An end at or before the start is a night shift (ends the next morning).
 */
export default function Shifts({ openScreen }) {
  const [all, setAll] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [editing, setEditing] = useState(null);
  const [status, setStatus] = useState('');

  const load = useCallback(() => {
    listShifts().then((v) => { setAll(v); setLoadError(''); }).catch((e) => setLoadError(String(e?.message || 'Could not load shifts.')));
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const counts = useMemo(() => {
    const list = all || [];
    const active = list.filter((s) => s.isActive).length;
    return { '': list.length, ACTIVE: active, INACTIVE: list.length - active };
  }, [all]);
  const inTab = useMemo(() => (all || []).filter((s) => !status || (status === 'ACTIVE') === Boolean(s.isActive)), [all, status]);
  const search = useListSearch(inTab, ['name', 'code', 'startTime', 'endTime']);
  const filters = useColumnFilters();
  const rows = filters.applyFilters(search.filtered, COLUMNS);
  const figures = useMemo(() => {
    const list = all || [];
    return {
      night: list.filter((s) => s.endTime <= s.startTime).length,
      people: list.reduce((a, s) => a + Number(s.assignments || 0), 0),
    };
  }, [all]);
  const create = () => setEditing({ ...BLANK });

  return (
    <DocumentListShell
      entity="shift"
      title="Shifts"
      description={
        <>
          Timings, grace and the days off of the people on each shift. Anyone without a shift works 09:00–18:00 and has the days off set in{' '}
          {openScreen ? <button type="button" className="ui-link" onClick={() => openScreen('workingWeek')}>Working Week</button> : 'Working Week'}.
        </>
      }
      compact
      tight
      denseCards
      search={{ value: search.query, onChange: search.setQuery, placeholder: 'Search shifts…', label: 'Search shifts' }}
      primary={
        <button type="button" className="ui-btn ui-btn-primary" onClick={create}>
          <Plus size={16} aria-hidden="true" /> New shift
        </button>
      }
      cards={[
        { label: 'Shifts', value: counts[''], count: true, tone: 'all', Icon: Clock3 },
        { label: 'Active', value: counts.ACTIVE, count: true, tone: 'paid', Icon: CheckCircle2, onSelect: () => setStatus('ACTIVE') },
        { label: 'Night shifts', value: figures.night, count: true, tone: 'sent', Icon: Moon },
        { label: 'People assigned', value: figures.people, count: true, tone: 'outstanding', Icon: Users },
      ]}
      tabs={TABS}
      statusValue={status}
      statusCounts={counts}
      onStatusChange={setStatus}
      tabsLabel="Shift status"
    >
      <LoadFailed message={loadError} onRetry={load} />
      {!all ? (
        loadError ? null : <SkeletonCard lines={4} />
      ) : (
        <div className="ui-table-scroll">
          <table className="ui-table ui-table-sticky w-full">
            <thead>
              <tr>
                <ColumnHeader label="Shift" col="name" state={filters}  className="ui-col-grow" />
                <th scope="col" className="ui-col-h-center">Timing</th>
                <th scope="col" className="ui-num">Break</th>
                <th scope="col" className="ui-num">Grace</th>
                <th scope="col" className="ui-num">Full day</th>
                <ColumnHeader label="Weekly off" col="off" state={filters} />
                <th scope="col" className="ui-num">People</th>
                <ColumnHeader label="Active" col="active" state={filters} align="center" />
              </tr>
            </thead>
            <tbody className="ui-rows">
              {!rows.length ? (
                <tr>
                  <td colSpan={8}>
                    {inTab.length ? (
                      <EmptyState kind="filtered" totalCount={inTab.length} title="No shifts match" description="Nothing in this tab matches the search or the column filters." />
                    ) : (
                      <EmptyState
                        icon={Clock3}
                        title={status ? `No ${status.toLowerCase()} shifts` : 'No shifts yet'}
                        description="Timings, grace and days off. Anyone without a shift works 09:00–18:00 with the days off set in Working Week. Create one, then assign people to it."
                        routes={status ? undefined : [{ label: 'New shift', description: 'Timings, grace and weekly offs; then assign people to it.', onSelect: create }]}
                      />
                    )}
                  </td>
                </tr>
              ) : (
                rows.map((s) => (
                  <tr key={s.id} className="ui-row-click" onClick={() => setEditing({ ...s, overtimeAfterMinutes: s.overtimeAfterMinutes ?? '', code: s.code || '', color: s.color || '', offSaturdays: s.offSaturdays || '' })}>
                    <td className="ui-col-entity">
                      {s.code ? <span className="mr-1.5 inline-block rounded-full px-1.5 text-xs font-semibold text-white" style={{ backgroundColor: s.color || 'rgb(var(--fg-subtle))' }}>{s.code}</span> : null}
                      {s.name}
                    </td>
                    <td className="ui-col-h-center whitespace-nowrap">
                      {s.startTime}–{s.endTime}
                      {s.endTime <= s.startTime ? <span className="ui-caption"> (night)</span> : null}
                    </td>
                    <td className="ui-num">{s.breakMinutes}m</td>
                    <td className="ui-num">{s.graceMinutes}m</td>
                    <td className="ui-num">{hm(s.fullDayMinutes)}</td>
                    <td>{offs(s.weeklyOffDays, s.offSaturdays)}</td>
                    <td className="ui-num">{s.assignments}</td>
                    <td className="ui-col-h-center">{s.isActive ? <StatusPill status="active" /> : <span className="ui-caption">Inactive</span>}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
      {editing ? <ShiftForm initial={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); load(); }} /> : null}
    </DocumentListShell>
  );
}

/* Blank, not null, in a number field: the punch window is optional. */
const blankIfNone = (v) => (v == null ? '' : v);

function ShiftForm({ initial, onClose, onSaved }) {
  const [form, setForm] = useState(() => {
    const f = { ...initial, checkInBeforeMinutes: blankIfNone(initial.checkInBeforeMinutes), checkOutAfterMinutes: blankIfNone(initial.checkOutAfterMinutes) };
    /* A new shift's full day is the shift itself; it follows the times until someone types their own. */
    return initial.id ? f : { ...f, fullDayMinutes: netMinutes(f) ?? f.fullDayMinutes };
  });
  /* The full day follows the times and break while it equals the shift's own minutes (or the shift is new). */
  const [fullDayFollows, setFullDayFollows] = useState(() => !initial.id || Number(initial.fullDayMinutes) === netMinutes(initial));
  const [saving, setSaving] = useState(false);
  const SHAPE = ['startTime', 'endTime', 'breakMinutes', 'halfDayMinutes'];
  const set = (k) => (e) => {
    const value = e.target.value;
    if (k === 'fullDayMinutes') setFullDayFollows(Number(value) === netMinutes(form));
    setForm((f) => {
      const next = { ...f, [k]: value };
      if (fullDayFollows && SHAPE.includes(k)) {
        const net = netMinutes(next);
        if (net !== null) next.fullDayMinutes = net;
      }
      return next;
    });
  };
  const net = netMinutes(form);
  /* Checked only when the hours change (as the server does): an older shift whose full day is longer than its hours can still be renamed or turned off. */
  const hoursChanged = !initial.id || [...SHAPE, 'fullDayMinutes'].some((k) => String(form[k]) !== String(initial[k]));
  const overShift = net !== null && Number(form.fullDayMinutes) > net;
  const fullDayTooLong = hoursChanged && overShift;
  /* Said aloud once someone tries to save, not on every key. */
  const [tried, setTried] = useState(false);
  const offSet = new Set(String(form.weeklyOffDays || '').split(',').filter(Boolean));
  const toggleOff = (i) => {
    const n = new Set(offSet);
    if (n.has(String(i))) n.delete(String(i));
    else n.add(String(i));
    setForm((f) => ({ ...f, weeklyOffDays: [...n].sort().join(',') }));
  };

  const save = async (e) => {
    e.preventDefault();
    if (fullDayTooLong) {
      setTried(true);
      return;
    }
    setSaving(true);
    const body = {
      name: form.name,
      startTime: form.startTime,
      endTime: form.endTime,
      breakMinutes: Number(form.breakMinutes),
      graceMinutes: Number(form.graceMinutes),
      earlyOutGraceMinutes: Number(form.earlyOutGraceMinutes),
      halfDayMinutes: Number(form.halfDayMinutes),
      fullDayMinutes: Number(form.fullDayMinutes),
      overtimeAfterMinutes: form.overtimeAfterMinutes === '' ? null : Number(form.overtimeAfterMinutes),
      checkInBeforeMinutes: form.checkInBeforeMinutes === '' ? null : Number(form.checkInBeforeMinutes),
      checkOutAfterMinutes: form.checkOutAfterMinutes === '' ? null : Number(form.checkOutAfterMinutes),
      autoPick: Boolean(form.autoPick),
      weeklyOffDays: form.weeklyOffDays,
      offSaturdays: form.offSaturdays || '',
      code: form.code || null,
      color: form.color || null,
      isActive: Boolean(form.isActive),
    };
    try {
      if (form.id) await updateShift(form.id, body);
      else await createShift(body);
      notify.success('Shift saved.');
      onSaved();
    } catch (err) {
      notify.error(String(err?.message || 'Not saved.'));
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    const ok = await confirmDialog({ title: `Delete ${form.name}?`, message: 'Only a shift nobody has used can be deleted.', confirmLabel: 'Yes, delete' });
    if (!ok) return;
    try {
      await deleteShift(form.id);
      onSaved();
    } catch (err) {
      notify.error(String(err?.message || 'Not deleted.'));
    }
  };

  const num = (k, label, hint) => (
    <label className="block">
      <span className="ui-label">{label}</span>
      <input type="number" min={0} className="ui-input w-full" value={form[k]} onChange={set(k)} />
      {hint ? <span className="ui-caption">{hint}</span> : null}
    </label>
  );

  return (
    <Drawer
      widthClass="w-[min(40rem,96vw)]"
      open
      onClose={onClose}
      title={form.id ? form.name : 'New shift'}
      actions={
        <>
          {form.id ? <button type="button" className="ui-btn ui-btn-secondary" onClick={remove}>Delete</button> : null}
          <button type="button" className="ui-btn ui-btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" form="shift-form" className="ui-btn ui-btn-primary" disabled={saving || !form.name.trim()}>{saving ? 'Saving…' : 'Save'}</button>
        </>
      }
    >
      <form id="shift-form" onSubmit={save} className="grid gap-4 sm:grid-cols-2">
        <label className="block sm:col-span-2"><span className="ui-label">Name *</span><input className="ui-input w-full" required value={form.name} onChange={set('name')} /></label>
        <label className="block"><span className="ui-label">Starts</span><input type="time" className="ui-input w-full" required value={form.startTime} onChange={set('startTime')} /></label>
        <label className="block">
          <span className="ui-label">Ends</span>
          <input type="time" className="ui-input w-full" required value={form.endTime} onChange={set('endTime')} />
          {form.endTime <= form.startTime ? <span className="ui-caption">Night shift — ends the next morning.</span> : null}
        </label>
        {num('breakMinutes', 'Break (minutes)', 'Deducted when the day runs past a half day.')}
        {num('graceMinutes', 'Late grace (minutes)')}
        {num('earlyOutGraceMinutes', 'Early-out grace (minutes)')}
        {num('halfDayMinutes', 'Half day (minutes worked)')}
        <label className="block">
          <span className="ui-label">Full day (minutes worked)</span>
          <input type="number" min={0} className="ui-input w-full" value={form.fullDayMinutes} onChange={set('fullDayMinutes')} aria-invalid={fullDayTooLong || undefined} data-invalid={fullDayTooLong ? 'true' : undefined} aria-describedby={net !== null ? 'full-day-hint' : undefined} />
          {fullDayTooLong ? (
            <span id="full-day-hint" className="ui-field-error block" role={tried ? 'alert' : undefined}>Longer than the shift: {form.startTime}–{form.endTime} less the break is {hoursWords(net)} ({net} min).</span>
          ) : overShift ? (
            <span id="full-day-hint" className="ui-caption">Longer than the shift less its break ({hoursWords(net)}): kept as it is, as nobody can work it. In within the grace and out on time is still a full day.</span>
          ) : net !== null ? (
            <span id="full-day-hint" className="ui-caption">The shift less its break is {hoursWords(net)}. In within the grace and out on time, or this many minutes worked, is a full day.</span>
          ) : null}
        </label>
        {num('overtimeAfterMinutes', 'Overtime after (minutes)', 'Blank = after a full day.')}
        {num('checkInBeforeMinutes', 'Earliest check-in (minutes before start)', 'A punch earlier than this does not count. Blank = no limit.')}
        {num('checkOutAfterMinutes', 'Latest check-out (minutes after end)', 'A punch later than this does not count. Blank = no limit.')}
        <label className="flex items-start gap-2 text-sm sm:col-span-2">
          <input type="checkbox" className="ui-checkbox mt-0.5" checked={Boolean(form.autoPick)} disabled={form.endTime <= form.startTime} onChange={(e) => setForm((f) => ({ ...f, autoPick: e.target.checked }))} />
          <span>
            Can be picked by the first punch
            <span className="ui-caption block">{form.endTime <= form.startTime ? 'Night shifts are not picked automatically: assign them.' : 'When “Pick the shift from the first punch” is on in Attendance rules.'}</span>
          </span>
        </label>
        <fieldset className="sm:col-span-2">
          <legend className="ui-label">Weekly off</legend>
          <div className="flex flex-wrap gap-3">
            {DAYS.map((d, i) => (
              <label key={d} className="flex items-center gap-1.5 text-sm">
                <input type="checkbox" className="ui-checkbox" checked={offSet.has(String(i))} onChange={() => toggleOff(i)} /> {d}
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset className="sm:col-span-2">
          <legend className="ui-label">Saturdays off as well</legend>
          <div className="flex flex-wrap gap-3">
            {NTH.map((n, i) => {
              const sats = new Set(String(form.offSaturdays || '').split(',').filter(Boolean));
              const k = String(i + 1);
              return (
                <label key={n} className="flex items-center gap-1.5 text-sm">
                  <input
                    type="checkbox"
                    className="ui-checkbox"
                    checked={sats.has(k)}
                    onChange={() => {
                      const next = new Set(sats);
                      if (next.has(k)) next.delete(k);
                      else next.add(k);
                      setForm((f) => ({ ...f, offSaturdays: [...next].sort().join(',') }));
                    }}
                  />
                  {n}
                </label>
              );
            })}
          </div>
          <span className="ui-caption">For “2nd and 4th Saturday off” — leave Saturday unticked above.</span>
        </fieldset>
        <label className="block"><span className="ui-label">Code</span><input className="ui-input w-full" maxLength={6} value={form.code || ''} onChange={set('code')} placeholder="e.g. G, N1 — for the schedule calendar" /></label>
        <label className="block"><span className="ui-label">Colour</span><input type="color" className="ui-input h-10 w-full p-1" value={form.color || '#64748b'} onChange={set('color')} /></label>
        <label className="flex items-center gap-2 text-sm sm:col-span-2">
          <input type="checkbox" className="ui-checkbox" checked={Boolean(form.isActive)} onChange={(e) => setForm((f) => ({ ...f, isActive: e.target.checked }))} /> Active
        </label>
      </form>
    </Drawer>
  );
}
