import React, { useEffect, useState } from 'react';
import { MapPin, Smartphone } from 'lucide-react';

import { getSchedule, listTransactions, todayIst } from '../api/attendance';
import { LIVE_COUNT, LIVE_EVERY_MS, punchWhere, punchWho, shiftsOn } from './todayData';

/*
 * The dashboard's panels for the spec's modules that the overview call does
 * not carry: the punches as they arrive, phone punches against the work
 * sites, and who works which shift. Each reads an endpoint its own screen
 * already uses; without access to it, or on a failed read, the panel is not
 * shown, as with Readers.
 */

const hhmm = (local) => String(local || '').slice(11, 16);
const nowIst = () => new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' });

/** The latest punches of the day, from readers and phones, asked again every 30 seconds while today is open. */
export function LivePunches({ date, attempt, openScreen, wide }) {
  const live = date === todayIst();
  const [data, setData] = useState(undefined);
  const [heard, setHeard] = useState('');

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      listTransactions({ from: date, to: date, limit: LIVE_COUNT })
        .then((d) => !cancelled && (setData(d), setHeard(nowIst())))
        .catch(() => !cancelled && setData(null));
    load();
    if (!live) return () => { cancelled = true; };
    const tick = setInterval(() => document.visibilityState === 'visible' && load(), LIVE_EVERY_MS);
    const back = () => document.visibilityState === 'visible' && load();
    document.addEventListener('visibilitychange', back);
    return () => {
      cancelled = true;
      clearInterval(tick);
      document.removeEventListener('visibilitychange', back);
    };
  }, [date, attempt, live]);

  if (!data) return null;
  const rows = data.transactions || [];
  return (
    <section className={`ui-card p-4 ${wide ? 'xl:col-span-3' : 'xl:col-span-2'}`} aria-labelledby="punches-h">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-3">
        <span className="flex items-baseline gap-3">
          <h2 id="punches-h" className="ui-t-sec">{live ? 'Punches coming in' : 'Punches that day'}</h2>
          <span className="ui-caption tabular-nums">{data.total} {live ? 'so far' : 'in all'}</span>
        </span>
        {live ? (
          <span className="ui-live ui-caption" role="status">
            <i aria-hidden="true" />Live, checked <time>{heard}</time>
          </span>
        ) : null}
      </div>
      {rows.length ? (
        <ul className="divide-y" aria-label="Latest punches">
          {rows.map((t) => {
            const where = punchWhere(t);
            return (
              <li key={t.id} className="flex items-center gap-3 py-2 text-sm">
                <time className="tabular-nums shrink-0 font-semibold">{hhmm(t.localTime)}</time>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{punchWho(t)}</span>
                  <span className="ui-caption flex items-center gap-1 truncate">
                    {where.phone ? <Smartphone size={12} aria-hidden="true" className="shrink-0" /> : null}
                    {where.text}
                    {!t.employeeId ? ', not matched to anyone' : ''}
                  </span>
                </span>
                {t.kind ? <span className={`ui-pill ${t.kind === 'IN' ? 'ui-pill-pos' : 'ui-pill-neutral'}`}>{t.kind === 'IN' ? 'In' : t.kind === 'OUT' ? 'Out' : t.kind}</span> : null}
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="ui-muted text-sm">{live ? 'No punches yet today. They show here as readers and phones send them.' : 'No punches that day.'}</p>
      )}
      {openScreen ? (
        <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm mt-3" onClick={() => openScreen('transactions')}>
          Open punch transactions
        </button>
      ) : null}
    </section>
  );
}

/** Phone punches against the geo-fenced work sites: how many, how many away from a site, how many the fence refused. */
export function PhonePunchesCard({ phone, openScreen }) {
  if (!phone) return null;
  const s = phone.summary || {};
  const sites = phone.sites?.length || 0;
  const lines = [
    { n: s.punches || 0, label: `${s.punches === 1 ? 'punch' : 'punches'} from ${s.people || 0} ${s.people === 1 ? 'person' : 'people'}` },
    { n: s.field || 0, label: 'away from a work site', tone: s.field ? 'warn' : null },
    { n: s.refused || 0, label: `refused${s.outside ? `, ${s.outside} outside the fence` : ''}`, tone: s.refused ? 'warn' : null },
  ];
  return (
    <section className="ui-card p-4" aria-labelledby="phone-h">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <h2 id="phone-h" className="ui-t-sec">Phone punches</h2>
        <span className="ui-caption">{sites ? `${sites} work ${sites === 1 ? 'site' : 'sites'} fenced` : 'No work sites yet'}</span>
      </div>
      {sites || s.punches || s.refused ? (
        <ul className="space-y-1 text-sm">
          {lines.map((l) => (
            <li key={l.label} className="flex items-baseline gap-2">
              <strong className={`tabular-nums ${l.tone ? 'ui-today-warn' : ''}`}>{l.n}</strong>
              <span className="ui-muted">{l.label}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="ui-muted flex items-center gap-2 text-sm">
          <MapPin size={14} aria-hidden="true" className="shrink-0" />
          Add a work site with its fence so phones can punch there.
        </p>
      )}
      {openScreen ? (
        <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm mt-3" onClick={() => openScreen(sites ? 'phonePunches' : 'sites')}>
          {sites ? 'Open mobile punches' : 'Add a work site'}
        </button>
      ) : null}
    </section>
  );
}

/** Who works which shift on the day, from the schedule the day is scored against. */
export function ShiftsToday({ date, attempt, openScreen }) {
  const [day, setDay] = useState(undefined);
  useEffect(() => {
    let cancelled = false;
    getSchedule({ month: date.slice(0, 7) })
      .then((d) => !cancelled && setDay(shiftsOn(d, date)))
      .catch(() => !cancelled && setDay(null));
    return () => {
      cancelled = true;
    };
  }, [date, attempt]);

  if (!day) return null;
  const away = [day.off ? `${day.off} weekly off` : '', day.leave ? `${day.leave} on leave` : '', day.holiday ? `${day.holiday} on a holiday` : ''].filter(Boolean);
  return (
    <section className="ui-card p-4" aria-labelledby="shifts-h">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <h2 id="shifts-h" className="ui-t-sec">Shifts {date === todayIst() ? 'today' : 'that day'}</h2>
        <span className="ui-caption tabular-nums">{day.working} working</span>
      </div>
      {day.list.length ? (
        <ul className="divide-y">
          {day.list.map((s) => (
            <li key={s.id} className="flex items-center gap-3 py-2 text-sm">
              {/* The shift's own colour, as on the schedule calendar. */}
              <span className="ui-shift-dot" style={s.color ? { backgroundColor: s.color } : undefined} aria-hidden="true" />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{s.name}</span>
                {s.startTime && s.endTime ? <span className="ui-caption tabular-nums">{s.startTime} to {s.endTime}</span> : null}
              </span>
              <span className="tabular-nums shrink-0 font-semibold">{s.n}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="ui-muted text-sm">Nobody is scheduled to work.</p>
      )}
      {away.length ? <p className="ui-caption mt-2">{away.join(', ')}.</p> : null}
      {openScreen ? (
        <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm mt-3" onClick={() => openScreen('scheduleCalendar')}>
          Open schedule calendar
        </button>
      ) : null}
    </section>
  );
}
