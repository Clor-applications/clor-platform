import React, { useEffect, useState } from 'react';
import { SignedOut, getHolidays, getSchedule } from './portalApi';
import { errorWords } from '@ui/utils/errorWords';

/*
 * Round 48 picks (18 Nov 2026), the employee app:
 * - nextholiday A: "Next holiday · Pongal, Wed 14 Jan" on the Today tab.
 * - myshifts A: My schedule opens on the next 14 days as a list, today on top.
 */

const addDays = (iso, n) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** The first holiday on or after today that the person gets off: an optional one counts only once chosen. */
export function nextHoliday(holidays, today) {
  return (holidays || [])
    .filter((h) => h && h.date && h.date >= today && (!h.restricted || h.picked))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))[0] || null;
}

export const holidayDay = (iso) => new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });

/** The months a run of `n` days from `today` touches, as YYYY-MM. */
export function monthsFor(today, n) {
  const first = today.slice(0, 7);
  const last = addDays(today, n - 1).slice(0, 7);
  return first === last ? [first] : [first, last];
}

/** Today and the next days, `n` in all, from the schedule days of one or two months. */
export function nextDays(days, today, n = 14) {
  const end = addDays(today, n - 1);
  return (days || []).filter((d) => d.date >= today && d.date <= end).sort((a, b) => (a.date < b.date ? -1 : 1));
}

export function NextHoliday({ guard, today }) {
  const [next, setNext] = useState(null);
  useEffect(() => {
    let live = true;
    const year = Number(today.slice(0, 4));
    const find = async () => {
      const here = nextHoliday((await guard(getHolidays(year)))?.holidays, today);
      if (here) return here;
      return nextHoliday((await guard(getHolidays(year + 1)))?.holidays, today);
    };
    find().then((h) => { if (live) setNext(h); }).catch((e) => { if (live && !(e instanceof SignedOut)) setNext(null); });
    return () => { live = false; };
  }, [guard, today]);
  if (!next) return null;
  return (
    /* A line on the page under a hairline, not a box (calm register). */
    <p className="portal-sec flex flex-wrap items-baseline justify-between gap-2 text-sm">
      <span className="ui-label">Next holiday</span>
      <b className="font-semibold">{next.name}, {holidayDay(next.date)}</b>
    </p>
  );
}

/** The next 14 days of my schedule, across a month end when needed. */
export function useNextDays(guard, today, n = 14, retry = 0) {
  const [state, setState] = useState({ days: null, error: '' });
  useEffect(() => {
    let live = true;
    Promise.all(monthsFor(today, n).map((m) => guard(getSchedule(m))))
      .then((all) => { if (live) setState({ days: nextDays(all.flatMap((d) => d?.days || []), today, n), error: '' }); })
      .catch((e) => { if (live && !(e instanceof SignedOut)) setState({ days: null, error: errorWords(e, 'load your schedule') }); });
    return () => { live = false; };
  }, [guard, today, n, retry]);
  return state;
}
