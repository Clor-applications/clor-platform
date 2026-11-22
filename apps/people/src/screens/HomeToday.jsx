import React, { useEffect, useRef, useState } from 'react';
import { CircleCheck, RotateCw, TriangleAlert } from 'lucide-react';

import ApproveActions from '@ui/components/ui/ApproveActions';
import { errorWords } from '@ui/utils/errorWords';
import { approveLeave, rejectLeave } from '@ui/timeOff/api';

/*
 * People → Home, read and act on (owner, 22 Nov 2026, after a UI reel on
 * calm dashboards): tiles that carry a small chart, a chart you can point at,
 * the day as a feed with tags only where something needs a look, decisions in
 * place with a short undo, and the loading, offline and nothing-to-do states
 * designed as screens of their own.
 */

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const minutesOf = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
const dayWords = (d) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
const spanWords = (r) => (r.fromDate === r.toDate ? dayWords(r.fromDate) : `${dayWords(r.fromDate)} to ${dayWords(r.toDate)}`);

/** Who came in during one 15-minute step, in words. */
export function arrivalWords(b) {
  if (!b.count) return `${b.at}: nobody came in`;
  const named = b.names.join(', ');
  const more = b.count - b.names.length;
  return `${b.at}: ${plural(b.count, 'person', 'people')} came in${named ? ` (${named}${more > 0 ? ` and ${more} more` : ''})` : ''}${b.late ? `, ${b.late} late` : ''}`;
}

/** The small arrivals chart inside the "In today" tile; the last step drawn in the tile's ink. */
export function ArrivalSpark({ arrivals }) {
  const max = Math.max(1, ...arrivals.map((b) => b.count));
  return (
    <span className="people-spark" aria-hidden="true">
      {arrivals.map((b, i) => <i key={b.at} data-now={i === arrivals.length - 1 || undefined} style={{ height: `${Math.max(8, (b.count / max) * 100)}%` }} />)}
    </span>
  );
}

/** Leave today split by type, each part in its type's colour, the biggest two named under it. */
export function LeaveSplit({ parts }) {
  const total = parts.reduce((n, p) => n + p.count, 0);
  if (!total) return null;
  return (
    <span className="people-split-wrap" aria-hidden="true">
      <span className="people-split">{parts.map((p) => <i key={p.name} style={{ flex: p.count, background: p.colour }} />)}</span>
      <span className="people-split-legend">{parts.slice(0, 2).map((p) => <span key={p.name}><i style={{ background: p.colour }} />{p.count} {p.name.replace(/ leave$/i, '').toLowerCase()}</span>)}</span>
    </span>
  );
}

/**
 * Arrivals this morning: one bar per 15 minutes. Each bar is a button: pointing at it
 * or moving to it with the keyboard says who came in. Steps after the shift start are
 * drawn in the warning tint, and a dashed line marks the start.
 */
export function ArrivalsChart({ today, onOpen }) {
  const [shown, setShown] = useState(null);
  const bars = useRef(null);
  const { arrivals, shiftStart } = today;
  if (!arrivals?.length) return null;
  const max = Math.max(1, ...arrivals.map((b) => b.count));
  const lateFrom = shiftStart ? minutesOf(shiftStart) : null;
  const startIndex = lateFrom == null ? -1 : arrivals.findIndex((b) => minutesOf(b.at) >= lateFrom);
  const ticks = arrivals.filter((b) => b.at.endsWith(':00'));
  const tip = shown == null ? null : arrivals[shown];
  return (
    <section className="people-today-block" aria-labelledby="arrivals-h">
      <header className="people-block-head">
        <div className="min-w-0">
          <h2 id="arrivals-h" className="people-block-title">Arrivals this morning</h2>
          <p className="ui-caption">Each bar is 15 minutes. Point at one to see who came in.</p>
        </div>
        {onOpen ? <button type="button" className="people-more" onClick={onOpen}>Today’s register</button> : null}
      </header>
      <figure className="people-arrivals" aria-label={`Arrivals by quarter hour. ${arrivals.map(arrivalWords).join('. ')}`}>
        <div className="people-arrivals-bars" ref={bars} onPointerLeave={() => setShown(null)}>
          {arrivals.map((b, i) => (
            <button
              key={b.at}
              type="button"
              className="people-arrivals-bar"
              data-late={(startIndex >= 0 && i >= startIndex) || undefined}
              aria-label={arrivalWords(b)}
              onPointerEnter={() => setShown(i)}
              onFocus={() => setShown(i)}
              onBlur={() => setShown(null)}
            >
              <span style={{ height: `${Math.max(3, (b.count / max) * 100)}%` }} />
            </button>
          ))}
          {startIndex >= 0 ? (
            <span className="people-arrivals-start" style={{ left: `${(startIndex / arrivals.length) * 100}%` }}>
              <b>Shift starts {shiftStart}</b>
            </span>
          ) : null}
          {tip ? (
            <span className="people-arrivals-tip" role="status" style={{ left: `${((shown + 0.5) / arrivals.length) * 100}%` }}>
              <b>{tip.at}</b> · {tip.count} in{tip.late ? `, ${tip.late} late` : ''}
              {tip.names.length ? <><br />{tip.names.join(', ')}{tip.count > tip.names.length ? ` and ${tip.count - tip.names.length} more` : ''}</> : null}
            </span>
          ) : null}
        </div>
        <div className="people-arrivals-axis" aria-hidden="true">
          {ticks.map((t) => <span key={t.at} style={{ left: `${(arrivals.indexOf(t) / arrivals.length) * 100}%` }}>{t.at}</span>)}
        </div>
      </figure>
    </section>
  );
}

const FEED_KIND = { late: 'att', leaveApplied: 'leave', joined: 'people', leaving: 'people' };
const FEED_FILTERS = [['all', 'All'], ['att', 'Attendance'], ['leave', 'Leave'], ['people', 'Joining and exits']];

/** The day in the company, newest first; a tag only on a row that needs a look (DESIGN.md: exceptions only). */
export function TodayFeed({ today, openPerson }) {
  const [filter, setFilter] = useState('all');
  const feed = today?.feed || [];
  if (!feed.length) return null;
  const kinds = new Set(feed.map((e) => FEED_KIND[e.kind]));
  const rows = feed.filter((e) => filter === 'all' || FEED_KIND[e.kind] === filter);
  return (
    <section className="people-today-block" aria-labelledby="feed-h">
      <header className="people-block-head">
        <div className="min-w-0">
          <h2 id="feed-h" className="people-block-title">Today in the company</h2>
          <p className="ui-caption">Newest first.</p>
        </div>
      </header>
      {kinds.size > 1 ? (
        <div className="people-feed-chips" role="group" aria-label="Show">
          {FEED_FILTERS.filter(([k]) => k === 'all' || kinds.has(k)).map(([k, label]) => (
            <button key={k} type="button" className="people-feed-chip" aria-pressed={filter === k} onClick={() => setFilter(k)}>{label}</button>
          ))}
        </div>
      ) : null}
      <ul className="people-list people-feed">
        {rows.map((e) => (
          <li key={`${e.kind}-${e.employeeId}-${e.at}`}>
            <button type="button" className="people-row people-row-action" onClick={openPerson(e.employeeId)}>
              <span className="people-feed-time tabular-nums">{e.at === '00:00' ? 'Today' : e.at}</span>
              <span className="min-w-0 flex-1"><b>{e.name}</b> <span className="people-feed-what">{e.text}{e.from ? `, ${spanWords({ fromDate: e.from, toDate: e.to || e.from })}` : ''}</span></span>
              {e.kind === 'late' ? <span className="ui-pill ui-pill-warn">Late</span> : null}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

const UNDO_MS = 5000;

/**
 * Leave waiting for this reader, decided in place (owner, 22 Nov 2026). Approve leaves the
 * row at once and is sent after five seconds, so Undo really undoes it. Leaving Home sends it
 * at once; a reload or a closed tab before then sends nothing. Reject asks why, as the Inbox
 * does: the person reads it.
 */
export function DecideInPlace({ requests, onDecided, max = 3 }) {
  const [gone, setGone] = useState(() => new Set());
  const [held, setHeld] = useState(null);
  const [asking, setAsking] = useState(null);
  const [why, setWhy] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState({});
  const timer = useRef(null);

  const send = async (r, approve, note = '') => {
    try {
      if (approve) await approveLeave(r.id, note);
      else await rejectLeave(r.id, note);
      onDecided?.(r, approve);
    } catch (e) {
      setGone((g) => { const n = new Set(g); n.delete(r.id); return n; });
      setError((x) => ({ ...x, [r.id]: errorWords(e, approve ? 'approve the request' : 'reject the request') }));
    }
  };
  /* A held approval goes out now: before another decision, or when its five seconds end. */
  const heldRef = useRef(null);
  const hold = (r) => { heldRef.current = r; setHeld(r); };
  const flush = () => {
    clearTimeout(timer.current);
    const h = heldRef.current;
    hold(null);
    if (h) send(h, true);
  };
  const approve = (r) => {
    flush();
    setError((x) => ({ ...x, [r.id]: '' }));
    setGone((g) => new Set(g).add(r.id));
    hold(r);
    timer.current = setTimeout(flush, UNDO_MS);
  };
  /* Leaving Home sends a held approval rather than dropping it: the row was already gone. */
  const flushRef = useRef(flush);
  useEffect(() => { flushRef.current = flush; });
  useEffect(() => () => flushRef.current(), []);
  const undo = () => {
    clearTimeout(timer.current);
    const h = heldRef.current;
    hold(null);
    if (h) setGone((g) => { const n = new Set(g); n.delete(h.id); return n; });
  };
  const reject = async (r) => {
    if (!why.trim()) { setError((x) => ({ ...x, [r.id]: 'Say why. They see this with the decision.' })); return; }
    flush();
    setBusy(true);
    setGone((g) => new Set(g).add(r.id));
    await send(r, false, why.trim());
    setBusy(false);
    setAsking(null);
    setWhy('');
  };

  const shown = requests.filter((r) => !gone.has(r.id)).slice(0, max);
  return (
    <>
      {shown.length ? (
        <ul className="people-decide-list" aria-label="Leave waiting for you">
          {shown.map((r) => (
            <li key={r.id} className="people-decide">
              <span className="min-w-0 flex-1">
                <span className="people-row-title block truncate">{r.employeeName}, {r.leaveTypeName || 'leave'}</span>
                <span className="ui-caption block truncate">{spanWords(r)} · {plural(r.days, 'day')}{r.reason ? ` · ${r.reason}` : ''}</span>
                {error[r.id] ? <span className="ui-field-error block" role="alert">{error[r.id]}</span> : null}
              </span>
              {asking === r.id ? (
                <span className="people-decide-why">
                  <input className="ui-input" aria-label={`Why reject ${r.employeeName}’s leave`} placeholder="Why not?" value={why} maxLength={500} autoFocus onChange={(e) => setWhy(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') reject(r); if (e.key === 'Escape') { setAsking(null); setWhy(''); } }} />
                  <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" disabled={busy} onClick={() => reject(r)}>Reject</button>
                  <button type="button" className="ui-btn ui-btn-ghost ui-btn-sm" onClick={() => { setAsking(null); setWhy(''); }}>Cancel</button>
                </span>
              ) : (
                <ApproveActions what={`leave for ${r.employeeName}`} onApprove={() => approve(r)} onReject={() => { setAsking(r.id); setWhy(''); }} rejectTitle="Reject (asks for a reason)" />
              )}
            </li>
          ))}
        </ul>
      ) : null}
      {held ? (
        <div className="people-undo" role="status">
          <CircleCheck size={18} aria-hidden="true" />
          <span className="min-w-0 flex-1">Approved: {held.employeeName}, {spanWords(held)}</span>
          <button type="button" className="ui-link" onClick={undo}>Undo</button>
        </div>
      ) : null}
    </>
  );
}

/** Online and offline as the browser tells it, with the time the screen last had fresh figures. */
export function useConnection(onBack) {
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine !== false));
  const [since, setSince] = useState(() => new Date());
  const [back, setBack] = useState(false);
  const backRef = useRef(onBack);
  useEffect(() => { backRef.current = onBack; });
  useEffect(() => {
    let hide;
    const off = () => setOnline(false);
    const on = () => {
      setOnline(true);
      setSince(new Date());
      setBack(true);
      backRef.current?.();
      clearTimeout(hide);
      hide = setTimeout(() => setBack(false), 3000);
    };
    window.addEventListener('offline', off);
    window.addEventListener('online', on);
    return () => { window.removeEventListener('offline', off); window.removeEventListener('online', on); clearTimeout(hide); };
  }, []);
  return { online, since, back, markFresh: () => setSince(new Date()) };
}

export const clockWords = (d) => d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false });

/** Connection lost: what still works, and Try now. Then a short "Back online". */
export function ConnectionBar({ online, back, onRetry }) {
  if (online && !back) return null;
  return online ? (
    <div className="people-conn" data-state="on" role="status">
      <span className="people-conn-ico"><CircleCheck size={18} aria-hidden="true" /></span>
      <span className="min-w-0 flex-1"><b>Back online</b><span className="people-conn-notes"><span>Figures refreshed</span></span></span>
    </div>
  ) : (
    <div className="people-conn" data-state="off" role="alert">
      <span className="people-conn-ico"><TriangleAlert size={18} aria-hidden="true" /></span>
      <span className="min-w-0 flex-1">
        <b>Connection lost</b>
        <span className="people-conn-notes">
          <span>Punches still record on the readers and phones</span>
          <span>Decisions wait until you are back</span>
        </span>
      </span>
      <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={onRetry}><RotateCw size={14} aria-hidden="true" /> Try now</button>
    </div>
  );
}

/** Home while its first figures load: the same tiles and columns, in grey, so nothing jumps when they arrive. */
export function HomeSkeleton() {
  return (
    <div className="people-home" role="status" aria-busy="true" aria-label="Loading Home">
      <div className="people-home-head"><div className="min-w-0 space-y-2"><div className="ui-skel h-8 w-64" /><div className="ui-skel h-4 w-80" /></div></div>
      <div className="people-kpis">
        {[0, 1, 2, 3].map((i) => <div key={i} className="people-kpi people-kpi-skel"><div className="ui-skel h-9 w-9" /><div className="ui-skel h-3 w-24" /><div className="ui-skel h-7 w-16" /><div className="ui-skel h-3 w-32" /></div>)}
      </div>
      <div className="people-home-grid">
        <div className="people-home-main space-y-3"><div className="ui-skel h-5 w-40" /><div className="ui-skel h-11 w-full" /><div className="ui-skel h-11 w-full" /><div className="ui-skel h-40 w-full" /></div>
        <div className="people-home-side space-y-3"><div className="ui-skel h-5 w-32" /><div className="ui-skel h-11 w-full" /><div className="ui-skel h-11 w-full" /><div className="ui-skel h-11 w-full" /></div>
      </div>
    </div>
  );
}
