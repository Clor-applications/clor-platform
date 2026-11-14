import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LogIn, LogOut, Plus } from '@ui/components/ui/lineIcons';

import { EmptyState, PageHeader, SkeletonCard } from '@ui/components/ui/Primitives';
import DataTable from '@ui/components/ui/DataTable';
import ErrorState from '@ui/components/ui/ErrorState';
import PopupSelect from '@ui/components/pickers/PopupSelect';
import { formatDate } from '@ui/components/ui/DatePicker';
import useRequest from '@ui/components/ui/useRequest';
import { confirmDialog, notify } from '@ui/components/ui/notify';
import { DAY_LABEL, DAY_PILL, STATUS_LABEL, STATUS_PILL, cancelMyRequest, clock, getMyDays, myRequests, phonePunch, todayIst } from './api';
import PhonePunch from './PhonePunch';
import MarksLine from './MarksLine';
import { EnterRequest, KINDS, KIND_NAME, WhenCell, detailsText, monthChoices } from './AttendanceRequests';
import { homeCrumbs, useCanActForSelf } from './shared';
import './time-off.css';

/**
 * The basic check-in in HR (founder, 22 Oct 2026): one button for someone
 * with an employee file, writing the same day record a reader or the phone
 * would, so Attendance (if the company has it) counts it like any punch.
 */
function useMyDays() {
  const [me, setMe] = useState(undefined);
  /* A check-in reloads straight away; the older answer, if it lands later, must not put the day back as it was. */
  const seq = useRef(0);
  const load = useCallback(() => {
    const n = ++seq.current;
    getMyDays().then((x) => { if (n === seq.current) setMe(x); }).catch(() => { if (n === seq.current) setMe(null); });
  }, []);
  useEffect(() => { load(); }, [load]);
  return [me, load];
}

/* `secondary`: on a screen whose one primary action is something else (People → Home), the button steps down. */
export function CheckInCard({ me, onChanged, secondary = false }) {
  const [busy, setBusy] = useState(false);
  const canAct = useCanActForSelf();
  if (!me) return null;
  const t = me.todayRecord;
  const press = async () => {
    setBusy(true);
    try {
      await clock(me.clockedIn ? 'OUT' : 'IN');
      notify.success(me.clockedIn ? 'Checked out.' : 'Checked in.');
      onChanged();
    } catch (e) {
      notify.error(String(e?.message || 'Not recorded.'));
    } finally {
      setBusy(false);
    }
  };
  const closed = t?.checkIn && t?.checkOut && !me.clockedIn;
  return (
    <section className="ui-card p-4 flex flex-wrap items-center justify-between gap-3" aria-label="Check in">
      <div>
        <h2 className="ui-t-sec">{me.clockedIn ? 'You are checked in' : closed ? 'Done for today' : 'Not checked in today'}</h2>
        <p className="ui-caption tabular-nums">
          {t?.checkInTime ? `In ${t.checkInTime}` : me.shift?.label ? me.shift.label : me.shift?.startTime ? `Shift ${me.shift.startTime}–${me.shift.endTime || ''}` : ''}
          {t?.checkOutTime ? `, out ${t.checkOutTime}` : ''}
        </p>
      </div>
      {/* The company's punch policy (audit #6): phone-only people, browser clock-in off, or not from the office network. */}
      {!closed && canAct && me.webClock?.allowed === false ? <p className="ui-caption" role="note">{me.webClock.why}</p> : null}
      {closed || !canAct || me.webClock?.allowed === false ? null : (
        <button type="button" className={`ui-btn ${secondary ? 'ui-btn-secondary' : 'ui-btn-primary'}`} disabled={busy} onClick={press}>
          {me.clockedIn ? <LogOut size={16} aria-hidden="true" /> : <LogIn size={16} aria-hidden="true" />} {me.clockedIn ? 'Check out' : 'Check in'}
        </button>
      )}
    </section>
  );
}

/**
 * Punching from the phone (time depth, gap 18): when HR has switched it on for
 * this person, My attendance punches with their position, as the employee app
 * does, instead of the plain check-in. A punch outside every work site waits
 * for approval while the company's switch says so, and the list says it waits.
 */
const REVIEW = { PENDING: ['ui-pill-warn', 'Waiting for approval'], REJECTED: ['ui-pill-neg', 'Not counted'], APPROVED: ['ui-pill-pos', 'Approved'] };
export function TodayPunches({ punches = [] }) {
  if (!punches.length) return null;
  return (
    <section className="ui-card p-4" aria-labelledby="today-punches-h">
      <h2 id="today-punches-h" className="ui-t-sec mb-2">Punches today</h2>
      <ul className="divide-y text-sm" style={{ borderColor: 'rgb(var(--border))' }}>
        {punches.map((p, i) => (
          <li key={i} className="flex flex-wrap items-center justify-between gap-2 py-2">
            <span className="tabular-nums font-medium">{p.time}</span>
            <span className="ui-caption min-w-0 flex-1 truncate">{p.phone ? `Phone${p.site ? ` · ${p.site}` : ''}` : 'Reader'}</span>
            {p.review && REVIEW[p.review] ? <span className={`ui-pill ${REVIEW[p.review][0]}`}>{REVIEW[p.review][1]}</span> : null}
            {p.kind ? <span className={`ui-pill ${p.kind === 'IN' ? 'ui-pill-pos' : 'ui-pill-neutral'}`}>{p.kind === 'IN' ? 'In' : 'Out'}</span> : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** On People → Home: the check-in, when the person signed in has an employee file. Home's primary is Add an employee, so this one is secondary (2 Nov 2026). */
export function HomeCheckIn() {
  const [me, load] = useMyDays();
  return me ? <CheckInCard me={me} onChanged={load} secondary /> : null;
}

/**
 * My requests (TIME-LEAVE-DECISIONS.md, advanced build): the month's own
 * attendance requests — missed punch, work from home, on duty, permission —
 * with how much of each quota is used, Change and Cancel while they can be,
 * and Ask for a new one. The same engine the employee app uses.
 */
export function MyRequests({ month, onMonth, asking, onAsk, onAsked, preset = null }) {
  const req = useRequest(() => myRequests(month), [month]);
  const d = req.data;
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState('');
  const canAct = useCanActForSelf();
  const months = useMemo(() => monthChoices(), []);
  const rows = useMemo(() => (d?.requests || []).filter((r) => r.date.slice(0, 7) === month || (r.toDate || '').slice(0, 7) === month), [d, month]);
  const on = KINDS.filter((k) => d?.rules?.[k]?.on);
  const today = todayIst();
  const canChange = (r) => canAct && r.status === 'PENDING';
  const canCancel = (r) => canAct && (r.status === 'PENDING' || (r.status === 'APPROVED' && ['WFH', 'ON_DUTY', 'SHIFT_CHANGE'].includes(r.kind) && r.date > today));
  const cancel = async (r) => {
    const ok = await confirmDialog({ title: r.status === 'APPROVED' ? 'Cancel this request?' : 'Withdraw this request?', confirmLabel: r.status === 'APPROVED' ? 'Cancel request' : 'Withdraw' });
    if (!ok) return;
    setBusy(r.id);
    try {
      await cancelMyRequest(r.id);
      notify.success(r.status === 'APPROVED' ? 'Request cancelled.' : 'Request withdrawn.');
      req.reload();
    } catch (e) {
      notify.error(String(e?.message || 'Not done.'));
    } finally {
      setBusy('');
    }
  };
  const columns = [
    { key: 'kind', label: 'Kind', always: true, render: (r) => <span className="whitespace-nowrap font-medium">{KIND_NAME[r.kind] || r.kind}</span> },
    { key: 'when', label: 'When', render: (r) => <WhenCell row={r} /> },
    { key: 'details', label: 'Details', render: (r) => <span className="tabular-nums">{detailsText(r)}</span> },
    { key: 'reason', label: 'Reason', render: (r) => <span className="block max-w-xs truncate" title={r.reason || ''}>{r.reason}</span> },
    { key: 'status', label: 'Status', render: (r) => <span className="inline-flex flex-col items-start gap-0.5"><span className={`ui-pill ${STATUS_PILL[r.status] || ''}`}>{STATUS_LABEL[r.status] || r.status}</span>{r.reviewNote && r.status !== 'PENDING' ? <span className="ui-caption">{r.reviewNote}</span> : null}</span> },
    { key: 'actions', label: '', align: 'right', render: (r) => (
      <span className="inline-flex gap-1 whitespace-nowrap">
        {canChange(r) ? <button type="button" className="ui-btn ui-btn-ghost" disabled={busy === r.id} onClick={() => setEditing(r)}>Change</button> : null}
        {canCancel(r) ? <button type="button" className="ui-btn ui-btn-ghost" disabled={busy === r.id} onClick={() => cancel(r)}>Cancel</button> : null}
      </span>
    ) },
  ];
  return (
    <section className="space-y-3" aria-labelledby="my-requests-h">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="my-requests-h" className="ui-t-sec">My requests</h2>
        <div className="w-44"><PopupSelect showValueSubtext={false} ariaLabel="Month" value={month} onChange={(v) => onMonth(v || today.slice(0, 7))} options={months} /></div>
      </div>
      {on.length ? (
        <ul className="text-sm tabular-nums space-y-0.5" aria-label="Used this month">
          {on.map((k) => <li key={k}>{KIND_NAME[k]}: {d.usage?.[k] ? (d.usage[k].quota == null ? `${d.usage[k].used} used, no limit` : `${d.usage[k].used} of ${d.usage[k].quota} used`) : '—'}{d.usage?.[k]?.pending ? `, ${d.usage[k].pending} waiting` : ''}</li>)}
        </ul>
      ) : null}
      <DataTable
        label="My requests"
        columns={columns}
        rows={rows}
        total={rows.length}
        noun="requests"
        loading={req.loading}
        refreshing={req.refreshing}
        card={(r) => (
          <span className="block min-w-0">
            <span className="flex items-center justify-between gap-2"><span className="font-medium">{KIND_NAME[r.kind]}</span><span className={`ui-pill ${STATUS_PILL[r.status] || ''}`}>{STATUS_LABEL[r.status]}</span></span>
            <span className="block ui-caption"><WhenCell row={r} />{detailsText(r) ? ` · ${detailsText(r)}` : ''}</span>
            <span className="mt-1 inline-flex gap-1">
              {canChange(r) ? <button type="button" className="ui-btn ui-btn-ghost" onClick={() => setEditing(r)}>Change</button> : null}
              {canCancel(r) ? <button type="button" className="ui-btn ui-btn-ghost" onClick={() => cancel(r)}>Cancel</button> : null}
            </span>
          </span>
        )}
        empty={req.error ? <ErrorState error={req.error} onRetry={req.reload} compact /> : <EmptyState title="Nothing asked for this month" />}
      />
      {editing ? <EnterRequest own request={editing} rules={d?.rules} shifts={d?.shifts} usage={d?.usage} month={month} onClose={() => setEditing(null)} onDone={() => { setEditing(null); req.reload(); }} /> : null}
      {asking ? <EnterRequest own preset={preset} rules={d?.rules} shifts={d?.shifts} usage={d?.usage} month={month} onClose={onAsk} onDone={() => { onAsked(); req.reload(); }} /> : null}
    </section>
  );
}

const WEEK_HEAD = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const isoAdd = (iso, by) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + by); return d.toISOString().slice(0, 10); };
const hm = (m) => `${Math.floor(m / 60)}h ${String(Math.round(m % 60)).padStart(2, '0')}m`;
const DAY_TONE = { PRESENT: 'is-pos', HALF_DAY: 'is-warn', ABSENT: 'is-neg' };

/**
 * My days as a calendar (R&D PEOPLE-17): the weeks of the month from Monday, each day's mark and its in and out,
 * a late day washed amber, today outlined. Only the days the record holds are filled; the rest stay blank.
 */
function MyMonth({ records, month, today }) {
  const byDate = new Map((records || []).map((r) => [r.date, r]));
  const [y, m] = month.split('-').map(Number);
  const first = `${month}-01`;
  const last = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  const start = isoAdd(first, -((new Date(`${first}T00:00:00Z`).getUTCDay() + 6) % 7));
  const cells = [];
  for (let d = start; d <= last || cells.length % 7; d = isoAdd(d, 1)) cells.push(d);
  const weeks = Array.from({ length: cells.length / 7 }, (_, i) => cells.slice(i * 7, i * 7 + 7));
  const title = new Date(`${first}T00:00:00Z`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  return (
    <div className="pt-month" role="table" aria-label={`My days, ${title}`}>
      <div className="pt-month-row pt-month-head" role="row">{WEEK_HEAD.map((d) => <span key={d} role="columnheader">{d}</span>)}</div>
      {weeks.map((w) => (
        <div key={w[0]} className="pt-month-row" role="row">
          {w.map((d) => {
            const inMonth = d.startsWith(month);
            const r = inMonth ? byDate.get(d) : null;
            const late = Boolean(r?.lateMinutes);
            const off = r && ['WEEKLY_OFF', 'HOLIDAY', 'ON_LEAVE'].includes(r.status);
            return (
              <div key={d} role="cell" className={`pt-day pt-myday ${inMonth ? '' : 'is-out'} ${off ? 'is-off' : ''} ${late ? 'is-late' : ''} ${d === today ? 'is-today' : ''}`}
                aria-label={inMonth ? `${formatDate(d)}${r ? `: ${late ? 'Late' : DAY_LABEL[r.status] || r.status}${r.checkInTime ? `, ${r.checkInTime}–${r.checkOutTime || 'still in'}` : ''}` : ''}` : undefined}>
                <span className="pt-day-n" aria-hidden="true">{inMonth ? Number(d.slice(8)) : ''}</span>
                {r ? <span className={`pt-myday-mark ${late ? 'is-warn' : DAY_TONE[r.status] || ''}`} aria-hidden="true">{late ? 'Late' : DAY_LABEL[r.status] || r.status}</span> : null}
                {r?.checkInTime ? <span className="pt-myday-time" aria-hidden="true">{r.checkInTime}–{r.checkOutTime || '…'}</span> : null}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

/** This month in four lines: days present, late arrivals, leave days, average hours on the days with both punches. */
function MonthFacts({ records, month }) {
  const mine = (records || []).filter((r) => r.date.startsWith(month));
  const present = mine.filter((r) => r.status === 'PRESENT').length + mine.filter((r) => r.status === 'HALF_DAY').length / 2;
  const late = mine.filter((r) => r.lateMinutes).length;
  const leave = mine.filter((r) => r.status === 'ON_LEAVE').length;
  const worked = mine.filter((r) => r.workedMinutes > 0);
  const avg = worked.length ? worked.reduce((a, r) => a + r.workedMinutes, 0) / worked.length : null;
  return (
    <section className="space-y-2" aria-labelledby="my-month-h">
      <h2 id="my-month-h" className="pt-h2">This month</h2>
      <ul className="pt-facts">
        <li><span>Days present</span><span>{present}</span></li>
        <li><span>Late arrivals</span><span className={late ? 'ui-text-warn' : ''}>{late}</span></li>
        <li><span>Leave taken</span><span>{leave}</span></li>
        <li><span>Average hours</span><span>{avg == null ? '—' : hm(avg)}</span></li>
      </ul>
    </section>
  );
}

export default function MyDays({ params = {} } = {}) {
  const req = useRequest(() => getMyDays(), []);
  const me = req.data;
  /* Opened from the missing-punch notice (?fix=date&in=&out=): the request is open and filled in. */
  const fixDate = /^\d{4}-\d{2}-\d{2}$/.test(String(params?.fix || '')) ? params.fix : '';
  const fix = useMemo(() => (fixDate ? { kind: 'MISSED_PUNCH', date: fixDate, checkIn: params?.in || '', checkOut: params?.out || '', reason: 'Forgot to punch' } : null), [fixDate, params?.in, params?.out]);
  const [month, setMonth] = useState(() => (fix ? fix.date.slice(0, 7) : todayIst().slice(0, 7)));
  const [asking, setAsking] = useState(Boolean(fix));
  const canAct = useCanActForSelf();
  /* No employee file behind this sign-in is a fact about the person, not a failure to retry. */
  const unlinked = req.error?.code === 'NO_EMPLOYEE_LINK' || req.error?.status === 404;
  const columns = [
    { key: 'date', label: 'Date', always: true, render: (r) => <span className="tabular-nums whitespace-nowrap">{formatDate(r.date)}{r.shiftLabel ? <span className="ui-caption block">{r.shiftLabel}</span> : null}</span> },
    { key: 'status', label: 'Day', render: (r) => <span className={`ui-pill ${DAY_PILL[r.status] || 'ui-pill-neutral'}`}>{DAY_LABEL[r.status] || r.status}</span> },
    { key: 'in', label: 'In', align: 'right', render: (r) => <span className="tabular-nums">{r.checkInTime || '—'}</span> },
    { key: 'out', label: 'Out', align: 'right', render: (r) => <span className="tabular-nums">{r.checkOutTime || '—'}</span> },
  ];
  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumb={homeCrumbs()}
        title="My attendance"
        /* Checking in is the day's action and keeps the primary button; asking is occasional. */
        actions={me && canAct ? <button type="button" className="ui-btn ui-btn-secondary" onClick={() => setAsking(true)}><Plus size={16} aria-hidden="true" /> Ask</button> : null}
      />
      {unlinked ? (
        <EmptyState title="Your sign-in is not linked to an employee file" description="Ask HR to put your email on your employee file." />
      ) : req.error && !me ? (
        <ErrorState error={req.error} onRetry={req.reload} />
      ) : !me ? (
        <SkeletonCard lines={5} />
      ) : (
        <>
          <div className="pt-mydays">
            <div className="min-w-0 space-y-3">
              <MyMonth records={me.records} month={todayIst().slice(0, 7)} today={todayIst()} />
              {/* The days before this month that the record still holds (the last thirty), as a list. */}
              {(me.records || []).some((r) => !r.date.startsWith(todayIst().slice(0, 7))) ? (
                <details className="pt-earlier">
                  <summary>Earlier days</summary>
                  <DataTable
                    label="My days"
                    columns={columns}
                    rows={(me.records || []).filter((r) => !r.date.startsWith(todayIst().slice(0, 7)))}
                    total={(me.records || []).filter((r) => !r.date.startsWith(todayIst().slice(0, 7))).length}
                    noun="days"
                    refreshing={req.refreshing}
                    empty={<EmptyState title="No earlier days" />}
                  />
                </details>
              ) : null}
            </div>
            <aside className="space-y-6 min-w-0" aria-label="Today and this month">
              {me.phone?.allowed && canAct ? (
                <>
                  <PhonePunch phone={me.phone} punches={me.punches} onPunch={phonePunch} onDone={req.reload} />
                  <TodayPunches punches={me.punches} />
                </>
              ) : <CheckInCard me={me} onChanged={req.reload} />}
              <MonthFacts records={me.records} month={todayIst().slice(0, 7)} />
            </aside>
          </div>
          <MarksLine month={month} />
          <MyRequests month={month} onMonth={setMonth} asking={asking} preset={fix} onAsk={() => setAsking(false)} onAsked={() => { setAsking(false); req.reload(); }} />
        </>
      )}
    </div>
  );
}
