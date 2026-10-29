import React, { useCallback, useEffect, useState } from 'react';

import LoadFailed from '../components/LoadFailed';
import { SignedOut, acknowledgeReview, checkInGoal, getGrowth, writeSelfReview } from './portalApi';

/**
 * Growth in the employee app (Talent, TALENT-DECISIONS.md): my goals with a check-in, my reviews
 * (write the self-review while the cycle is open; read the outcome once HR shares it and say I
 * have read it), my improvement plan, one-on-ones and trainings. Shown only while the company
 * has Performance on. Buttons in the list are secondary; the one primary is Save inside the form that is open.
 */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const longDate = (d) => {
  const [y, m, dd] = String(d || '').slice(0, 10).split('-');
  return y && m && dd ? `${Number(dd)} ${MONTHS[Number(m) - 1]} ${y}` : '';
};
const istDate = (d) => (d ? new Date(new Date(d).getTime() + 330 * 60_000).toISOString().slice(0, 10) : '');
const errText = (e, fallback) => (e instanceof SignedOut ? '' : String(e?.message || fallback));
const HEALTH = [['ON_TRACK', 'On track'], ['AT_RISK', 'At risk'], ['BEHIND', 'Behind']];
const RATINGS = [[1, 'Well below what was expected'], [2, 'Below what was expected'], [3, 'What was expected'], [4, 'Above what was expected'], [5, 'Well above what was expected']];
const ratingWord = (n) => RATINGS.find((r) => r[0] === n)?.[1] || '';
const PLAN = { ACTIVE: 'Running', EXTENDED: 'Extended', COMPLETED: 'Completed', NOT_MET: 'Not met' };
const SEAT = { ASSIGNED: 'To attend', COMPLETED: 'Completed', MISSED: 'Missed' };

export default function MyGrowth({ guard }) {
  const [data, setData] = useState(null);
  const [failed, setFailed] = useState('');
  const [said, setSaid] = useState(null);
  const load = useCallback(() => {
    guard(getGrowth()).then((d) => { setData(d); setFailed(''); }).catch((e) => setFailed(errText(e, 'Could not load your goals and reviews.')));
  }, [guard]);
  useEffect(() => { load(); }, [load]);
  if (failed) return <LoadFailed message={failed} onRetry={load} />;
  if (!data?.on) return null;
  const done = (text) => { setSaid({ ok: true, text }); load(); };
  const fail = (e) => { const text = errText(e, 'Not saved.'); if (text) setSaid({ ok: false, text }); };
  const active = data.goals.filter((g) => g.status === 'ACTIVE');
  return (
    <section className="ui-card space-y-4 p-5" aria-labelledby="growth-h">
      <h2 id="growth-h" className="ui-t-sec">My goals and reviews</h2>
      {said ? <p className="text-sm" role={said.ok ? 'status' : 'alert'}>{said.text}</p> : null}

      <div className="space-y-2">
        <h3 className="ui-label">My goals</h3>
        {!data.goals.length ? <p className="text-sm ui-muted">No goals yet. Your manager or HR sets them with you.</p> : (
          <ul className="divide-y" aria-label="My goals">
            {[...active, ...data.goals.filter((g) => g.status !== 'ACTIVE')].map((g) => <Goal key={g.id} goal={g} guard={guard} onDone={done} onFail={fail} />)}
          </ul>
        )}
      </div>

      {data.reviews.length ? (
        <div className="space-y-2">
          <h3 className="ui-label">My reviews</h3>
          <ul className="divide-y" aria-label="My reviews">
            {data.reviews.map((r) => <Review key={r.id} review={r} guard={guard} onDone={done} onFail={fail} />)}
          </ul>
        </div>
      ) : null}

      {data.plans.length ? (
        <div className="space-y-2">
          <h3 className="ui-label">Improvement plan</h3>
          {data.plans.map((p) => (
            <div key={p.id} className="space-y-1 text-sm">
              <p className="ui-caption">{PLAN[p.status] || p.status} · {longDate(p.startDate)} to {longDate(p.endDate)}</p>
              <p className="whitespace-pre-wrap">{p.expectations}</p>
              {p.outcomeNote ? <p className="whitespace-pre-wrap ui-muted">{p.outcomeNote}</p> : null}
            </div>
          ))}
        </div>
      ) : null}

      {data.oneOnOnes.length ? (
        <div className="space-y-2">
          <h3 className="ui-label">One-on-ones with my manager</h3>
          <ul className="divide-y" aria-label="One-on-ones">
            {data.oneOnOnes.slice(0, 5).map((o) => (
              <li key={o.id} className="py-2 text-sm space-y-0.5">
                <p className="ui-caption">{longDate(o.date)}</p>
                {o.actions ? <p className="whitespace-pre-wrap"><span className="font-medium">Agreed: </span>{o.actions}</p> : null}
                {o.notes ? <p className="whitespace-pre-wrap ui-muted">{o.notes}</p> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {data.trainings.length ? (
        <div className="space-y-2">
          <h3 className="ui-label">My trainings</h3>
          <ul className="divide-y" aria-label="My trainings">
            {data.trainings.map((t) => (
              <li key={t.id} className="flex items-start justify-between gap-3 py-2 text-sm">
                <span className="min-w-0"><span className="block">{t.title}</span><span className="block ui-caption">{t.completedOn ? `Completed ${longDate(t.completedOn)}` : t.startDate ? `From ${longDate(t.startDate)}` : SEAT[t.status]}</span></span>
                {t.expiresOn ? <span className="ui-caption whitespace-nowrap">Good until {longDate(t.expiresOn)}</span> : <span className="ui-caption">{SEAT[t.status]}</span>}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

function Goal({ goal: g, guard, onDone, onFail }) {
  const [open, setOpen] = useState(false);
  const [progress, setProgress] = useState(String(g.progress || 0));
  const [health, setHealth] = useState(g.health || 'ON_TRACK');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const save = async (e) => {
    e.preventDefault();
    if (health !== 'ON_TRACK' && !note.trim()) { onFail(new Error('Say what is in the way.')); return; }
    setBusy(true);
    try {
      await guard(checkInGoal(g.id, { progress: Number(progress), health, note: note.trim() || null }));
      setOpen(false);
      setNote('');
      onDone(`${g.title}: check-in saved.`);
    } catch (err) { onFail(err); } finally { setBusy(false); }
  };
  return (
    <li className="py-2 space-y-1.5">
      <div className="flex items-start justify-between gap-3">
        <span className="min-w-0">
          <span className={`block text-sm ${g.status === 'DONE' ? 'ui-muted' : ''}`}>{g.title}</span>
          <span className="block ui-caption">{[g.measure, g.dueDate ? `by ${longDate(g.dueDate)}` : null, g.status === 'DONE' ? 'Done' : HEALTH.find((h) => h[0] === g.health)?.[1]].filter(Boolean).join(' · ')}</span>
        </span>
        <span className="tabular-nums text-sm">{g.progress || 0}%</span>
      </div>
      <span className="block h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: 'rgb(var(--border))' }} aria-hidden="true">
        <span className="block h-full rounded-full" style={{ width: `${Math.max(0, Math.min(100, g.progress || 0))}%`, backgroundColor: 'rgb(var(--accent))' }} />
      </span>
      {g.status === 'ACTIVE' && !open ? <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={() => setOpen(true)}>Check in</button> : null}
      {open ? (
        <form onSubmit={save} className="space-y-2 pt-1">
          <label className="block"><span className="ui-label">Progress (%)</span><input className="ui-input w-full tabular-nums" inputMode="numeric" value={progress} onChange={(e) => setProgress(e.target.value.replace(/\D/g, '').slice(0, 3))} /></label>
          <fieldset>
            <legend className="ui-label">How it is going</legend>
            <div className="grid grid-cols-3 gap-2">
              {HEALTH.map(([v, l]) => (
                <label key={v} className={`ui-btn ui-btn-sm ${health === v ? 'ui-btn-primary' : 'ui-btn-secondary'}`}>
                  <input type="radio" className="sr-only" name={`health-${g.id}`} value={v} checked={health === v} onChange={() => setHealth(v)} />{l}
                </label>
              ))}
            </div>
          </fieldset>
          <label className="block"><span className="ui-label">{health === 'ON_TRACK' ? 'Note' : 'What is in the way'}</span><textarea className="ui-input w-full" rows={2} maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} /></label>
          <div className="flex gap-2">
            <button type="submit" className="ui-btn ui-btn-primary ui-btn-sm" disabled={busy || progress === ''}>{busy ? 'Saving…' : 'Save'}</button>
            <button type="button" className="ui-btn ui-btn-ghost ui-btn-sm" onClick={() => setOpen(false)}>Cancel</button>
          </div>
        </form>
      ) : null}
    </li>
  );
}

function Review({ review: r, guard, onDone, onFail }) {
  const [open, setOpen] = useState(false);
  const [rating, setRating] = useState(r.selfRating ? String(r.selfRating) : '');
  const [text, setText] = useState(r.selfText || '');
  const [busy, setBusy] = useState(false);
  const save = async (e) => {
    e.preventDefault();
    if (!rating || !text.trim()) { onFail(new Error('Pick a rating and write a few lines about the period.')); return; }
    setBusy(true);
    try { await guard(writeSelfReview(r.id, { selfRating: Number(rating), selfText: text.trim() })); setOpen(false); onDone('Self-review saved.'); } catch (err) { onFail(err); } finally { setBusy(false); }
  };
  const ack = async () => {
    setBusy(true);
    try { await guard(acknowledgeReview(r.id)); onDone('Marked as read.'); } catch (err) { onFail(err); } finally { setBusy(false); }
  };
  return (
    <li className="py-2 space-y-1.5 text-sm">
      <p><span className="font-medium">{r.cycle}</span><span className="block ui-caption">{r.period.split(' – ').map(longDate).join(' to ')}</span></p>
      {r.shared ? (
        <div className="space-y-1">
          <p><span className="ui-label">Final rating</span> {r.finalRating ? `${r.finalRating} · ${ratingWord(r.finalRating)}` : '—'}</p>
          {r.managerText ? <p className="whitespace-pre-wrap">{r.managerText}</p> : null}
          {r.acknowledgedAt ? <p className="ui-caption">You read it on {longDate(istDate(r.acknowledgedAt))}.</p> : <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" disabled={busy} onClick={ack}>I have read it</button>}
        </div>
      ) : r.canWriteSelf ? (
        open ? (
          <form onSubmit={save} className="space-y-2">
            <label className="block"><span className="ui-label">How did the period go?</span>
              <select className="ui-select w-full" value={rating} onChange={(e) => setRating(e.target.value)}>
                <option value="">Choose…</option>
                {RATINGS.map(([n, w]) => <option key={n} value={n}>{n} · {w}</option>)}
              </select>
            </label>
            <label className="block"><span className="ui-label">What you did and what you want to work on</span><textarea className="ui-input w-full" rows={5} maxLength={8000} value={text} onChange={(e) => setText(e.target.value)} /></label>
            <div className="flex gap-2">
              <button type="submit" className="ui-btn ui-btn-primary ui-btn-sm" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
              <button type="button" className="ui-btn ui-btn-ghost ui-btn-sm" onClick={() => setOpen(false)}>Cancel</button>
            </div>
          </form>
        ) : (
          <div className="space-y-1">
            <p className="ui-caption">{r.selfAt ? `You wrote yours on ${longDate(istDate(r.selfAt))}. You can change it while the review is open.` : r.selfDue ? `Write yours by ${longDate(r.selfDue)}.` : 'Write yours while the review is open.'}</p>
            <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={() => setOpen(true)}>{r.selfAt ? 'Change my self-review' : 'Write my self-review'}</button>
          </div>
        )
      ) : (
        <p className="ui-caption">{r.selfAt ? 'Your self-review is in. You see the outcome once HR shares it.' : 'Self-reviews are closed. You see the outcome once HR shares it.'}</p>
      )}
    </li>
  );
}
