import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

import LoadFailed from '../components/LoadFailed';
import { SignedOut, getHolidays, getUpdates, pickRestrictedHoliday, todayIst } from './portalApi';

const errText = (e, fallback) => (e instanceof SignedOut ? '' : String(e?.message || fallback));

// ---------------------------------------------------------------------------
// What's new: decisions on my requests, for staff with no other notice
// ---------------------------------------------------------------------------

const SEEN = 'clor.portal.seen';
const SEEN_MAX = 300;
/* What this browser has already shown and the person put away. Private windows and blocked storage just show everything again. */
const seenKeys = () => {
  try {
    const v = JSON.parse(localStorage.getItem(SEEN) || '[]');
    return new Set(Array.isArray(v) ? v.map(String) : []);
  } catch {
    return new Set();
  }
};
const markSeen = (keys) => {
  try {
    const all = [...seenKeys(), ...keys.filter((k) => k)];
    localStorage.setItem(SEEN, JSON.stringify([...new Set(all)].slice(-SEEN_MAX)));
  } catch {
    /* storage blocked: seen for this page only */
  }
};
const PILL = {
  APPROVED: ['Approved', 'ui-pill-pos'],
  REJECTED: ['Rejected', 'ui-pill-neg'],
  CANCELLED: ['Cancelled', 'ui-pill-neutral'],
  SHORTENED: ['Changed', 'ui-pill-neutral'],
  MORE_INFO: ['Needs you', 'ui-pill-warn'],
  LAPSE: ['Use it or lose it', 'ui-pill-warn'],
  /* Referrals (server: services/people/talent/referrals.ts portalUpdates). */
  JOB: ['New job', 'ui-pill-info'],
  JOINED: ['Joined', 'ui-pill-pos'],
  NOT_TAKEN: ['Referral', 'ui-pill-neutral'],
};
const EVERY = 5 * 60_000;

/**
 * "What's new" on Today (server: portal /updates): leave and requests
 * approved or rejected with the approver's note, leave cancelled or
 * shortened by someone else, HR's answer on my details or resignation, and
 * the warning that leave will lapse. Checked on open and every five minutes
 * while the app is open; "Got it" puts an item away on this browser.
 */
export function WhatsNew({ guard }) {
  const [items, setItems] = useState(null);
  const [failed, setFailed] = useState('');
  const [seen, setSeen] = useState(seenKeys);
  const load = useCallback(() => {
    guard(getUpdates())
      .then((d) => { setItems(d?.decided || []); setFailed(''); })
      .catch((e) => setFailed(errText(e, 'Could not load what is new.')));
  }, [guard]);
  useEffect(() => {
    load();
    const t = setInterval(load, EVERY);
    return () => clearInterval(t);
  }, [load]);
  if (failed) return <LoadFailed message={failed} onRetry={load} />;
  const fresh = (items || []).filter((i) => !seen.has(i.key));
  if (!fresh.length) return null;
  const put = (keys) => { markSeen(keys); setSeen(seenKeys()); };
  return (
    <section className="ui-card space-y-2 p-5" aria-labelledby="new-h">
      <div className="flex items-center justify-between gap-2">
        <h2 id="new-h" className="ui-t-sec">What’s new</h2>
        {fresh.length > 1 ? <button type="button" className="ui-btn ui-btn-ghost ui-btn-sm" onClick={() => put(fresh.map((i) => i.key))}>Clear all</button> : null}
      </div>
      <ul className="divide-y" style={{ borderColor: 'rgb(var(--border))' }}>
        {fresh.map((i) => {
          const [word, pill] = PILL[i.status] || ['Update', 'ui-pill-neutral'];
          return (
            <li key={i.key} className="flex items-start justify-between gap-2 py-2 text-sm">
              <span className="min-w-0 space-y-1">
                <span className={`ui-pill ${pill}`}>{word}</span>
                <span className="block">{i.text}</span>
              </span>
              <button type="button" className="ui-btn ui-btn-ghost ui-btn-sm shrink-0" onClick={() => put([i.key])} aria-label={`Got it: ${i.text}`}>Got it</button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Holidays for a year
// ---------------------------------------------------------------------------

const dayLabel = (d) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });

/**
 * "Holidays {year}" in Leave (server: portal /holidays): every holiday of my
 * area and branch, the restricted (optional) ones marked, and Pick or Drop on
 * a restricted day where the company gives a quota.
 */
export function HolidaysYear({ guard }) {
  const thisYear = Number(todayIst().slice(0, 4));
  const [year, setYear] = useState(thisYear);
  const [data, setData] = useState(null);
  const [failed, setFailed] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState('');
  const latest = useRef(0);
  const load = useCallback(() => {
    const n = ++latest.current;
    guard(getHolidays(year))
      .then((d) => { if (n === latest.current) { setData(d); setFailed(''); } })
      .catch((e) => n === latest.current && setFailed(errText(e, 'Could not load your holidays.')));
  }, [guard, year]);
  useEffect(() => { load(); }, [load]);
  const pick = async (h) => {
    setBusy(h.id);
    setNote('');
    try {
      await guard(pickRestrictedHoliday(h.id, !h.picked));
      load();
    } catch (err) {
      setNote(errText(err, 'Not changed.'));
    } finally {
      setBusy('');
    }
  };
  const shown = data && data.year === year ? data : null;
  const restricted = (shown?.holidays || []).filter((h) => h.restricted);
  return (
    <section className="ui-card space-y-2 p-5" aria-labelledby="hol-h">
      <div className="flex items-center justify-between gap-2">
        <h2 id="hol-h" className="ui-t-sec">Holidays {year}</h2>
        <span className="flex gap-1">
          <button type="button" className="ui-icon-btn" aria-label="Previous year" onClick={() => setYear((y) => y - 1)} disabled={year <= thisYear - 1}><ChevronLeft size={16} aria-hidden="true" /></button>
          <button type="button" className="ui-icon-btn" aria-label="Next year" onClick={() => setYear((y) => y + 1)} disabled={year >= thisYear + 1}><ChevronRight size={16} aria-hidden="true" /></button>
        </span>
      </div>
      <LoadFailed message={failed} onRetry={load} />
      {!shown && !failed ? <p className="ui-caption">Loading…</p> : null}
      {shown ? (
        <>
          {restricted.length ? (
            <p className="ui-caption tabular-nums">
              {shown.quota > 0 ? `Optional holidays: ${shown.picked} of ${shown.quota} picked. An optional day is a working day unless you pick it.` : 'Optional holidays are listed, but your company has not set how many you may pick. Ask HR.'}
            </p>
          ) : null}
          {note ? <p className="text-sm" role="alert" style={{ color: 'rgb(var(--neg))' }}>{note}</p> : null}
          {shown.holidays.length ? (
            <ul className="divide-y" style={{ borderColor: 'rgb(var(--border))' }}>
              {shown.holidays.map((h) => (
                <li key={`${h.date}|${h.name}`} className="flex items-center justify-between gap-2 py-2 text-sm" style={h.past ? { color: 'rgb(var(--fg-muted))' } : undefined}>
                  <span className="min-w-0">
                    <span className="block">{h.name}</span>
                    <span className="ui-caption">{dayLabel(h.date)}{h.restricted ? (h.picked ? ' · Optional · Picked' : ' · Optional') : ''}</span>
                  </span>
                  {h.restricted && shown.quota > 0 && !h.past ? (
                    <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm shrink-0" disabled={busy === h.id || (!h.picked && shown.left <= 0)} onClick={() => pick(h)}>{h.picked ? 'Drop' : 'Pick'}</button>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : <p className="ui-caption">No holidays are set for {year} yet.</p>}
        </>
      ) : null}
    </section>
  );
}
