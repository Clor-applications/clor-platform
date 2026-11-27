import React, { useEffect, useId, useRef, useState } from 'react';
import { CircleCheck, RotateCw, TriangleAlert } from 'lucide-react';

import ApproveActions from '@ui/components/ui/ApproveActions';
import { FigureLedger } from '@ui/components/ui/FigureViews';
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

/** The ledger moved to the shared figure kit; People keeps the name. */
export { FigureLedger };

const clockOfMin = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
/** The date and clock in India now, "YYYY-MM-DDTHH:MM". */
const istStamp = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 16);

/** India's date and clock, moved on every minute while the timeline is open. */
function useIstClock() {
  const [stamp, setStamp] = useState(istStamp);
  useEffect(() => {
    const id = setInterval(() => setStamp(istStamp()), 60_000);
    return () => clearInterval(id);
  }, []);
  return { date: stamp.slice(0, 10), time: stamp.slice(11, 16) };
}

/** How many had come in by the end of each 15-minute step, and who came in during it. */
export function dayCurve(arrivals) {
  let total = 0;
  return arrivals.map((b) => {
    total += b.count;
    return { ...b, from: minutesOf(b.at), to: minutesOf(b.at) + 15, total };
  });
}

/** One step of the day in words, for the slider and the screen reader. */
export function stepWords(s, expected) {
  return `By ${clockOfMin(s.to)}, ${s.total} of ${expected} in. ${arrivalWords(s)}`;
}

/**
 * The day as a timeline (owner, 22 Nov 2026, style F, replacing the arrival bars): how
 * many people are in, climbing through the morning, against the whole expected today.
 * The shift start is a dashed line and now is a solid one. Pointing anywhere, or the
 * arrow keys, says how many were in by then and who came in.
 */
export function DayTimeline({ today, onOpen, now: pinned }) {
  const [shown, setShown] = useState(null);
  const clock = useIstClock();
  const { arrivals, shiftStart, expected } = today;
  if (!arrivals?.length) return null;
  const steps = dayCurve(arrivals);
  const last = steps[steps.length - 1];
  /* "Now" is drawn only on today's own date; `now` pins the clock (tests). */
  const now = pinned || (clock.date === today.date ? clock.time : null);
  const nowMin = now ? minutesOf(now) : null;
  const shiftMin = shiftStart ? minutesOf(shiftStart) : null;
  const lo = Math.floor(Math.min(steps[0].from, shiftMin ?? Infinity, ...(nowMin == null ? [] : [nowMin])) / 60) * 60;
  /* The morning, not the whole day: up to an hour past the last arrival, or now if sooner. */
  const hi = Math.min(24 * 60, Math.ceil(Math.max(last.to, (shiftMin ?? 0) + 60, Math.min(nowMin ?? 0, last.to + 60)) / 60) * 60);
  const top = Math.max(1, expected, last.total) * 1.08;
  const x = (m) => ((m - lo) / (hi - lo)) * 100;
  const y = (n) => 100 - (n / top) * 100;
  const end = nowMin == null ? last.to : Math.max(last.to, Math.min(nowMin, hi));
  const pts = [[x(steps[0].from), y(0)], ...steps.map((s) => [x(s.to), y(s.total)]), [x(end), y(last.total)]];
  const line = pts.map(([a, b], i) => `${i ? 'L' : 'M'}${a.toFixed(2)},${b.toFixed(2)}`).join(' ');
  const area = `${line} L${x(end).toFixed(2)},100 L${x(steps[0].from).toFixed(2)},100 Z`;
  const hours = [];
  for (let h = lo; h <= hi; h += 60) hours.push(h);
  const step = shown == null ? null : steps[shown];
  const byShift = shiftMin == null ? null : steps.filter((s) => s.to <= shiftMin).reduce((n, s) => Math.max(n, s.total), 0);
  const pick = (clientX, box) => {
    const m = lo + ((clientX - box.left) / box.width) * (hi - lo);
    let i = steps.findIndex((s) => m < s.to);
    if (i < 0) i = steps.length - 1;
    setShown(i);
  };
  const onKey = (e) => {
    const i = shown == null ? steps.length - 1 : shown;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { e.preventDefault(); setShown(Math.max(0, i - 1)); }
    else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { e.preventDefault(); setShown(Math.min(steps.length - 1, shown == null ? i : i + 1)); }
    else if (e.key === 'Home') { e.preventDefault(); setShown(0); }
    else if (e.key === 'End') { e.preventDefault(); setShown(steps.length - 1); }
    else if (e.key === 'Escape') setShown(null);
  };
  const first = steps.find((s) => s.count);
  const facts = [
    first?.names[0] ? { k: 'first', label: 'First in', value: `${first.names[0]}, ${first.at}` } : null,
    byShift != null ? { k: 'shift', label: `In by ${shiftStart}`, value: `${byShift} of ${expected}` } : null,
    { k: 'late', label: 'Came in late', value: String(today.late || 0), tone: today.late ? 'warn' : undefined },
    { k: 'now', label: nowMin == null ? 'In that day' : 'In now', value: `${today.inCount} of ${expected}` },
  ].filter(Boolean);
  return (
    <section className="people-today-block" aria-labelledby="day-h">
      <header className="people-block-head">
        <div className="min-w-0">
          <h2 id="day-h" className="people-block-title">The day so far</h2>
        </div>
        {onOpen ? <button type="button" className="people-more" onClick={onOpen}>Today’s register</button> : null}
      </header>
      <figure className="people-day">
        <div
          className="people-day-plot"
          role="slider"
          tabIndex={0}
          aria-label="Time of day"
          aria-description="Use the arrow keys to inspect attendance by time."
          aria-valuemin={0}
          aria-valuemax={steps.length - 1}
          aria-valuenow={shown ?? steps.length - 1}
          aria-valuetext={stepWords(step || last, expected)}
          onPointerMove={(e) => pick(e.clientX, e.currentTarget.getBoundingClientRect())}
          onPointerDown={(e) => pick(e.clientX, e.currentTarget.getBoundingClientRect())}
          onPointerLeave={() => setShown(null)}
          onKeyDown={onKey}
          onBlur={() => setShown(null)}
        >
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
            <line x1="0" x2="100" y1={y(expected)} y2={y(expected)} className="people-day-goal" vectorEffect="non-scaling-stroke" />
            <path d={area} className="people-day-area" />
            <path d={line} className="people-day-line" vectorEffect="non-scaling-stroke" />
          </svg>
          <span className="people-day-goal-label" style={{ top: `${y(expected)}%` }}>{expected} expected</span>
          {shiftMin != null && shiftMin >= lo && shiftMin <= hi ? (
            <span className="people-day-mark" data-k="shift" style={{ left: `${x(shiftMin)}%` }}><b>Shift starts {shiftStart}</b></span>
          ) : null}
          {nowMin != null && nowMin >= lo && nowMin <= hi ? (
            <span className="people-day-mark" data-k="now" style={{ left: `${x(nowMin)}%` }}><b>Now {now} · {today.inCount} in</b></span>
          ) : null}
          {step ? (
            <>
              <span className="people-day-dot" style={{ left: `${x(step.to)}%`, top: `${y(step.total)}%` }} aria-hidden="true" />
              <span className="people-day-tip" role="status" style={{ left: `${Math.min(85, Math.max(15, x(step.to)))}%` }}>
                <b>By {clockOfMin(step.to)}</b> · {step.total} in{step.count ? `, ${step.count} came in` : ''}{step.late ? ` (${step.late} late)` : ''}
                {step.names.length ? <><br />{step.names.join(', ')}{step.count > step.names.length ? ` and ${step.count - step.names.length} more` : ''}</> : null}
              </span>
            </>
          ) : null}
        </div>
        <div className="people-day-axis" aria-hidden="true">
          {hours.map((h) => <span key={h} style={{ left: `${x(h)}%` }}>{clockOfMin(h)}</span>)}
        </div>
        <dl className="people-day-facts">
          {facts.map((f) => (
            <div key={f.k} data-tone={f.tone}>
              <dt>{f.label}</dt>
              <dd className="tabular-nums">{f.value}</dd>
            </div>
          ))}
        </dl>
      </figure>
    </section>
  );
}

const TEAM_COLS = [
  ['onTime', 'In on time', 'pos'],
  ['late', 'In late', 'warn'],
  ['notYet', 'Not in yet', 'neutral'],
  ['onLeave', 'On leave', 'info'],
];
const MAX_TEAMS = 8;

/**
 * Each team's day as a heat table (owner, 22 Nov 2026, style I, replacing headcount by
 * department): a cell is tinted by its share of the team, so the team with half its
 * people not in shows at a glance. The numbers stay in ink; a nought is a dash.
 */
export function TeamsToday({ teams }) {
  if (!teams?.length) return null;
  const head = teams.slice(0, MAX_TEAMS);
  const rest = teams.slice(MAX_TEAMS);
  const sum = (list, name) => list.reduce((t, r) => {
    for (const [k] of TEAM_COLS) t[k] += r[k];
    t.total += r.total;
    return t;
  }, { name, onTime: 0, late: 0, notYet: 0, onLeave: 0, total: 0 });
  const rows = rest.length ? [...head, sum(rest, rest.length === 1 ? rest[0].name : `${rest.length} other teams`)] : head;
  const all = sum(teams, 'Everyone');
  const cell = (r, k, tone) => {
    const v = r[k];
    const share = r.total ? v / r.total : 0;
    return (
      <td key={k} className="people-heat-cell tabular-nums" data-tone={tone} data-zero={v === 0 || undefined} style={{ '--a': (0.08 + share * 0.52).toFixed(3) }}>
        {v || '–'}
      </td>
    );
  };
  return (
    <section className="people-today-block" aria-labelledby="teams-h">
      <header className="people-block-head">
        <div className="min-w-0">
          <h2 id="teams-h" className="people-block-title">Teams today</h2>
          <p className="ui-caption">Darker means more of that team.</p>
        </div>
      </header>
      <div className="ui-table-scroll">
        <table className="people-heat">
          <thead>
            <tr>
              <th scope="col">Team</th>
              {TEAM_COLS.map(([k, label]) => <th key={k} scope="col">{label}</th>)}
              <th scope="col">People</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.name}>
                <th scope="row">{r.name}</th>
                {TEAM_COLS.map(([k, , tone]) => cell(r, k, tone))}
                <td className="tabular-nums">{r.total}</td>
              </tr>
            ))}
          </tbody>
          {teams.length > 1 ? (
            <tfoot>
              <tr>
                <th scope="row">{all.name}</th>
                {TEAM_COLS.map(([k, , tone]) => cell(all, k, tone))}
                <td className="tabular-nums">{all.total}</td>
              </tr>
            </tfoot>
          ) : null}
        </table>
      </div>
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

function LeaveDecisionRow({ request: r, approvalError, onApprove, onReject }) {
  const [editing, setEditing] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const sending = useRef(false);
  const row = useRef(null);
  const field = useRef(null);
  const restoreFocus = useRef(false);
  const fieldId = useId();
  const errorId = fieldId + '-error';

  useEffect(() => {
    if (!editing && restoreFocus.current) {
      restoreFocus.current = false;
      row.current?.querySelector('.is-no')?.focus();
    }
  }, [editing]);

  function cancel() {
    if (sending.current) return;
    restoreFocus.current = true;
    setEditing(false);
    setError('');
    setReason('');
  }

  async function submit(event) {
    event.preventDefault();
    if (sending.current) return;
    if (!reason.trim()) {
      setError('Say why. They see this with the decision.');
      field.current?.focus();
      return;
    }
    sending.current = true;
    setSaving(true);
    setError('');
    try {
      await onReject(r, reason.trim());
    } catch (e) {
      setError(errorWords(e, 'reject the request'));
    } finally {
      sending.current = false;
      setSaving(false);
    }
  }

  return <li ref={row} className="people-decide">
    <div className="people-decision-summary">
      <strong className="people-row-title">{r.employeeName}</strong>
      <span className="people-leave-kind">{r.leaveTypeName || 'Leave'}</span>
      <span className="ui-caption">{spanWords(r)} · {plural(r.days, 'day')}</span>
      {r.reason && <span className="ui-caption">{r.reason}</span>}
      {approvalError && <span className="ui-field-error" role="alert">{approvalError}</span>}
    </div>
    {editing ? <form className="people-decision-form" onSubmit={submit}
      onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); cancel(); } }}>
      <label htmlFor={fieldId} className="ui-label">Reason for rejection</label>
      <input id={fieldId} ref={field} className="ui-input" aria-label={`Why reject ${r.employeeName}’s leave`}
        value={reason} maxLength={500} autoFocus readOnly={saving}
        aria-describedby={error ? errorId : undefined} aria-invalid={Boolean(error && !reason.trim()) || undefined}
        onChange={(e) => { setReason(e.target.value); setError(''); }} />
      {error && <span id={errorId} className="ui-field-error" role="alert">{error}</span>}
      <div className="people-decision-actions">
        <button type="submit" className="ui-btn ui-btn-secondary" disabled={saving} aria-busy={saving}>{saving ? 'Rejecting…' : 'Reject'}</button>
        <button type="button" className="ui-btn ui-btn-ghost" disabled={saving} onClick={cancel}>Cancel</button>
      </div>
    </form> : <ApproveActions what={`leave for ${r.employeeName}`} showLabels onApprove={() => onApprove(r)}
      onReject={() => setEditing(true)} rejectTitle="Reject (asks for a reason)" />}
  </li>;
}

/**
 * Leave waiting for this reader, decided in place (owner, 22 Nov 2026). Approve leaves the
 * row at once and is sent after five seconds, so Undo really undoes it. Leaving Home sends it
 * at once; a reload or a closed tab before then sends nothing. Reject asks why, as the Inbox
 * does: the person reads it.
 */
export function DecideInPlace({ requests, onDecided, max = 3 }) {
  const [gone, setGone] = useState(() => new Set());
  const [held, setHeld] = useState(null);
  const [error, setError] = useState({});
  const timer = useRef(null);

  const sendApproval = async (r) => {
    try {
      await approveLeave(r.id, '');
      onDecided?.(r, true);
    } catch (e) {
      setGone((g) => { const n = new Set(g); n.delete(r.id); return n; });
      setError((x) => ({ ...x, [r.id]: errorWords(e, 'approve the request') }));
    }
  };
  /* A held approval goes out now: before another decision, or when its five seconds end. */
  const heldRef = useRef(null);
  const hold = (r) => { heldRef.current = r; setHeld(r); };
  const flush = () => {
    clearTimeout(timer.current);
    const h = heldRef.current;
    hold(null);
    if (h) sendApproval(h);
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
  const reject = async (r, note) => {
    flush();
    await rejectLeave(r.id, note);
    setGone((g) => new Set(g).add(r.id));
    onDecided?.(r, false);
  };

  const shown = requests.filter((r) => !gone.has(r.id)).slice(0, max);
  return (
    <>
      {shown.length ? (
        <ul className="people-decide-list" aria-label="Leave waiting for you">
          {shown.map((r) => <LeaveDecisionRow key={r.id} request={r} approvalError={error[r.id]}
            onApprove={approve} onReject={reject} />)}
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
      <div className="people-ledger">
        <div className="people-ledger-hero space-y-2"><div className="ui-skel h-3 w-20" /><div className="ui-skel h-14 w-24" /><div className="ui-skel h-4 w-40" /></div>
        <div className="space-y-2">{[0, 1, 2, 3].map((i) => <div key={i} className="ui-skel h-9 w-full" />)}</div>
      </div>
      <div className="people-home-grid">
        <div className="people-home-main space-y-3"><div className="ui-skel h-5 w-40" /><div className="ui-skel h-11 w-full" /><div className="ui-skel h-11 w-full" /><div className="ui-skel h-40 w-full" /></div>
        <div className="people-home-side space-y-3"><div className="ui-skel h-5 w-32" /><div className="ui-skel h-11 w-full" /><div className="ui-skel h-11 w-full" /><div className="ui-skel h-11 w-full" /></div>
      </div>
    </div>
  );
}
