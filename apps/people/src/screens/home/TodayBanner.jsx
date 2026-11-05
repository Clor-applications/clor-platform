import React from 'react';
import { CaretRight, Clock } from '@phosphor-icons/react';

import { Face, dayDate, plural } from './bits';

/*
 * Who is out today, by kind (owner's suite spec, 5–6 Nov 2026). Planned leave and sick leave are leave; work from
 * home and field duty are working, elsewhere. Each kind names its tint by meaning: violet for planned, clay for
 * sick, teal for home, green for the field.
 */
export const AWAY_KINDS = [
  { key: 'planned', label: 'Planned leave', tint: 'lilac' },
  { key: 'sick', label: 'Sick', tint: 'peach' },
  { key: 'wfh', label: 'Working from home', tint: 'sky' },
  { key: 'field', label: 'Field duty', tint: 'mint' },
];

/**
 * Home's attendance banner: the live clock-in count from Attendance, and who is out today. A part this reader may
 * not see, or Attendance being off, leaves that part out rather than showing nought.
 */
export default function TodayBanner({ today, colourOf, openPerson, onCalendar }) {
  if (!today || (!today.clock && !today.away)) return null;
  const { clock, away } = today;
  const kinds = AWAY_KINDS.filter((k) => away?.[k.key]);
  return (
    <section className="home-today" aria-labelledby="today-h" data-reveal style={{ '--i': 1 }}>
      <header className="home-today-head">
        <h2 id="today-h" className="soft-panel-title"><span className="soft-panel-icon" data-tint="mint"><Clock size={16} weight="duotone" aria-hidden="true" /></span>Today at work</h2>
        <span className="flex items-center gap-3">
          {clock ? <a className="people-more" href="?app=attendance&open=today">Attendance <CaretRight size={14} aria-hidden="true" /></a> : null}
          {away ? <button type="button" className="people-more" onClick={onCalendar}>Leave calendar <CaretRight size={14} aria-hidden="true" /></button> : null}
        </span>
      </header>
      <div className="home-today-body">
        {clock ? (
          <div className="home-clock" aria-label={`${clock.inNow} in now, ${clock.clockedIn} of ${clock.expected} clocked in today, ${clock.late} late`}>
            <span className="home-clock-value tabular-nums" data-zero={clock.inNow === 0 || undefined}>{clock.inNow}</span>
            <span className="home-clock-words">
              <span className="font-semibold">in now</span>
              <span className="ui-caption"><span className="tabular-nums">{clock.clockedIn}</span> of <span className="tabular-nums">{clock.expected}</span> clocked in{clock.late ? <> · <span className="tabular-nums">{clock.late}</span> late</> : null}</span>
            </span>
            <span className="home-clock-bar" aria-hidden="true"><span style={{ width: `${clock.expected ? Math.min(100, (clock.clockedIn / clock.expected) * 100) : 0}%` }} /></span>
          </div>
        ) : null}
        {kinds.length ? (
          <ul className="home-away">
            {kinds.map((k) => {
              const list = away[k.key];
              return (
                <li key={k.key} data-tint={k.tint}>
                  <span className="home-away-label"><span className="home-away-dot" aria-hidden="true" />{k.label}<b className="tabular-nums" data-zero={list.length === 0 || undefined}>{list.length}</b></span>
                  {list.length ? (
                    <ul className="home-away-people">
                      {list.slice(0, 4).map((p) => (
                        <li key={`${k.key}-${p.employeeId}`}>
                          <button type="button" className="home-away-person" onClick={() => openPerson(p.employeeId)} title={`${p.name}: ${p.what}, until ${dayDate(p.until)}`}>
                            <Face person={p} size={24} colour={colourOf(p.department)} />
                            <span className="truncate">{p.name}</span>
                          </button>
                        </li>
                      ))}
                      {list.length > 4 ? <li className="ui-caption">and {plural(list.length - 4, 'other')}</li> : null}
                    </ul>
                  ) : <span className="ui-caption">Nobody</span>}
                </li>
              );
            })}
          </ul>
        ) : null}
      </div>
    </section>
  );
}
