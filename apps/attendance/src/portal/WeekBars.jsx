import React from 'react';
import { hm } from './portalApi';

const iso = (d) => d.toISOString().slice(0, 10);

/** Monday to Sunday of the week holding `today`, each with the minutes worked that day (0 when none recorded). */
export function weekDays(days, today) {
  const t = new Date(`${today}T00:00:00Z`);
  const monday = new Date(t);
  monday.setUTCDate(t.getUTCDate() - ((t.getUTCDay() + 6) % 7));
  const byDate = new Map((days || []).map((d) => [d.date, d]));
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(monday);
    d.setUTCDate(monday.getUTCDate() + i);
    const date = iso(d);
    return { date, minutes: Number(byDate.get(date)?.workedMinutes) || 0, future: date > today };
  });
}

/** Round 21 pick: my hours this week as one bar per day, so a short day stands out. */
export default function WeekBars({ days, today }) {
  const week = weekDays(days, today);
  const total = week.reduce((t, d) => t + d.minutes, 0);
  const top = Math.max(9 * 60, ...week.map((d) => d.minutes));
  return (
    /* On the page, not in a box; the bars in ink, not the app colour (DESIGN.md "Charts": ink first). */
    <section className="flex flex-col gap-2" aria-labelledby="week-h">
      <div className="flex items-baseline justify-between gap-2">
        <h3 id="week-h" className="text-sm font-semibold">This week</h3>
        <span className="text-sm tabular-nums">{hm(total)}</span>
      </div>
      <ol className="ui-week-bars-row" aria-label="Hours worked each day this week">
        {week.map((d) => {
          const name = new Date(`${d.date}T00:00:00Z`).toLocaleDateString('en-IN', { weekday: 'short', timeZone: 'UTC' });
          return (
            <li key={d.date} aria-label={`${name}: ${d.future ? 'not yet' : d.minutes ? hm(d.minutes) : 'no hours'}`} data-today={d.date === today || undefined}>
              <span className="ui-week-bar" data-future={d.future || undefined}><span style={{ height: `${Math.round((d.minutes / top) * 100)}%`, background: 'rgb(var(--fg-muted))' }} /></span>
              <span className="ui-caption" aria-hidden="true">{name.slice(0, 2)}</span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
