import React, { useCallback, useEffect, useState } from 'react';

import LoadFailed from '@ui/components/ui/LoadFailed';
import SuggestInput from '@ui/components/ui/SuggestInput';
import { SignedOut, answerSwap, askSwap, getSwaps, swapColleagues, todayIst, withdrawSwap } from './portalApi';

/**
 * Shift swaps in the employee app (People, FEATURE-UI-AUDIT gap 24), on the
 * Schedule tab: what colleagues asked of me (accept or decline), asking a
 * colleague on another shift to swap a day or a few, and my own swaps with
 * where they stand. The manager approves in People; approved, My schedule
 * shows the swapped shifts.
 */
const STATUS = {
  ASKED: ['Waiting for them', 'ui-pill-warn'],
  DECLINED: ['Declined', 'ui-pill-neutral'],
  WAITING: ['Waiting for approval', 'ui-pill-warn'],
  APPROVED: ['Approved', 'ui-pill-pos'],
  REJECTED: ['Not approved', 'ui-pill-neg'],
  WITHDRAWN: ['Withdrawn', 'ui-pill-neutral'],
  CANCELLED: ['Cancelled', 'ui-pill-neutral'],
};
const dayLabel = (d) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
const span = (a, b) => (a === b ? dayLabel(a) : `${dayLabel(a)} – ${dayLabel(b)}`);
const hours = (s) => `${s.name} ${s.startTime}–${s.endTime}`;
const plusDays = (iso, n) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const errText = (e, fallback) => (e instanceof SignedOut ? '' : String(e?.message || fallback));

function Pill({ status }) {
  const [words, cls] = STATUS[status] || [status, 'ui-pill-neutral'];
  return <span className={`ui-pill ${cls}`}>{words}</span>;
}

export default function ShiftSwaps({ guard, onChanged }) {
  const [data, setData] = useState(null);
  const [failed, setFailed] = useState('');
  const [note, setNote] = useState(null);
  const load = useCallback(() => {
    guard(getSwaps())
      .then((d) => { setData({ mine: d?.mine || [], askedOfMe: d?.askedOfMe || [], rules: d?.rules || null }); setFailed(''); })
      .catch((e) => setFailed(errText(e, 'Could not load your shift swaps.')));
  }, [guard]);
  useEffect(() => { load(); }, [load]);
  const changed = (text, ok = true) => { setNote(text ? { ok, text } : null); load(); if (ok) onChanged?.(); };

  if (failed) return <LoadFailed message={failed} onRetry={load} />;
  if (!data) return null;
  const waitingOnMe = data.askedOfMe.filter((s) => s.status === 'ASKED');
  return (
    <>
      {note ? <p className="text-sm" role={note.ok ? 'status' : 'alert'} style={note.ok ? undefined : { color: 'rgb(var(--neg))' }}>{note.text}</p> : null}
      {waitingOnMe.map((s) => <AskedOfMe key={s.id} swap={s} guard={guard} onDone={changed} />)}
      <AskSwap guard={guard} rules={data.rules} onDone={changed} reasons={[...new Set(data.mine.map((s) => s.reason).filter(Boolean))]} />
      <MySwaps swaps={[...data.mine.map((s) => ({ ...s, asker: true })), ...data.askedOfMe.filter((s) => s.status !== 'ASKED').map((s) => ({ ...s, asker: false }))].sort((x, y) => String(y.createdAt).localeCompare(String(x.createdAt)))} guard={guard} onDone={changed} />
    </>
  );
}

/** A colleague asks me: their shift for mine on those days. */
function AskedOfMe({ swap, guard, onDone }) {
  const [declining, setDeclining] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState('');
  const answer = async (accept) => {
    setBusy(accept ? 'accept' : 'decline');
    try {
      await guard(answerSwap(swap.id, accept, text.trim() || null));
      onDone(accept ? `You accepted. It now waits for ${swap.requester.name}'s manager.` : 'You declined. They are told.');
    } catch (e) {
      const t = errText(e, 'Not saved.');
      if (t) onDone(t, false);
    } finally {
      setBusy('');
    }
  };
  return (
    <section className="ui-card space-y-3 p-5" aria-label={`Swap asked by ${swap.requester.name}`}>
      <div className="flex items-start justify-between gap-2">
        <h2 className="ui-t-sec">{swap.requester.name} asks to swap</h2>
        <span className="ui-pill ui-pill-warn">For you</span>
      </div>
      <ul className="space-y-1 text-sm">
        {swap.days.map((d) => (
          <li key={d.date}>
            <span className="font-medium">{dayLabel(d.date)}:</span> you work <span className="tabular-nums">{hours(d.requesterShift)}</span> <span className="ui-muted">instead of {d.colleagueShift.name}</span>
          </li>
        ))}
      </ul>
      {swap.reason ? <p className="text-sm ui-muted">“{swap.reason}”</p> : null}
      {declining ? (
        <div className="space-y-2">
          <textarea className="ui-input w-full" rows={2} maxLength={300} aria-label="Why not" placeholder="Why not? They see this." value={text} onChange={(e) => setText(e.target.value)} />
          <div className="flex gap-2">
            <button type="button" className="ui-btn ui-btn-danger flex-1" disabled={Boolean(busy)} onClick={() => answer(false)}>{busy === 'decline' ? 'Saving…' : 'Decline'}</button>
            <button type="button" className="ui-btn ui-btn-secondary" onClick={() => { setDeclining(false); setText(''); }}>Back</button>
          </div>
        </div>
      ) : (
        <div className="flex gap-2">
          <button type="button" className="ui-btn ui-btn-primary flex-1" disabled={Boolean(busy)} onClick={() => answer(true)}>{busy === 'accept' ? 'Saving…' : 'Accept'}</button>
          <button type="button" className="ui-btn ui-btn-secondary" disabled={Boolean(busy)} onClick={() => setDeclining(true)}>Decline</button>
        </div>
      )}
    </section>
  );
}

/** Ask a colleague: the days first, then who works another shift on all of them, then why. */
function AskSwap({ guard, rules, onDone, reasons = [] }) {
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [people, setPeople] = useState(null);
  const [looking, setLooking] = useState(false);
  const [pick, setPick] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const tomorrow = plusDays(todayIst(), 1);
  const last = to || from;

  useEffect(() => {
    setPeople(null);
    setPick('');
    if (!from || last < from) return undefined;
    let off = false;
    setLooking(true);
    guard(swapColleagues(from, last))
      .then((r) => !off && setPeople(r.colleagues))
      .catch((e) => !off && setError(errText(e, 'Could not find colleagues.')))
      .finally(() => !off && setLooking(false));
    return () => { off = true; };
  }, [from, last, guard]);

  const reset = () => { setOpen(false); setFrom(''); setTo(''); setPeople(null); setPick(''); setReason(''); setError(''); };
  const send = async (e) => {
    e.preventDefault();
    if (!pick || busy) return;
    setBusy(true);
    setError('');
    try {
      const r = await guard(askSwap({ colleagueEmployeeId: pick, fromDate: from, toDate: last, reason: reason.trim() || null }));
      reset();
      onDone(`Asked ${r.swap.colleague.name}. Once they accept, it goes to your manager.`);
    } catch (err) {
      const t = errText(err, 'Not sent.');
      if (t) setError(t);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="ui-card space-y-3 p-5" aria-labelledby="swap-ask-h">
      <div className="flex items-center justify-between gap-2">
        <h2 id="swap-ask-h" className="ui-t-sec">Swap a shift</h2>
        {!open ? <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={() => setOpen(true)}>Ask a colleague</button> : null}
      </div>
      {open ? (
        <form onSubmit={send} className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <label className="block"><span className="ui-label">Day *</span><input type="date" className="ui-input w-full" min={tomorrow} required value={from} onChange={(e) => { setFrom(e.target.value); if (to && to < e.target.value) setTo(''); }} /></label>
            <label className="block"><span className="ui-label">Last day</span><input type="date" className="ui-input w-full" min={from || tomorrow} max={from ? plusDays(from, (rules?.maxDays || 7) - 1) : undefined} value={to} onChange={(e) => setTo(e.target.value)} /></label>
          </div>
          {from ? (
            looking ? <p className="ui-caption">Looking for colleagues on another shift…</p> : people ? (
              people.length ? (
                <fieldset className="space-y-2">
                  <legend className="ui-label">Swap with *</legend>
                  {people.map((p) => (
                    <label key={p.employeeId} className="flex items-start gap-3 rounded-lg border p-3 text-sm" style={{ borderColor: pick === p.employeeId ? 'rgb(var(--accent))' : 'rgb(var(--border))' }}>
                      <input type="radio" name="swap-with" className="mt-1" checked={pick === p.employeeId} onChange={() => setPick(p.employeeId)} />
                      <span className="min-w-0">
                        <span className="block font-medium">{p.name}{p.code ? <span className="ui-caption font-normal"> · {p.code}</span> : null}</span>
                        <span className="block ui-caption tabular-nums">{p.days.length === 1 ? `Works ${p.days[0].shift} ${p.days[0].startTime}–${p.days[0].endTime}` : p.days.map((d) => `${dayLabel(d.date)}: ${d.shift}`).join(' · ')}</span>
                      </span>
                    </label>
                  ))}
                </fieldset>
              ) : <p className="text-sm ui-muted">Nobody works another shift on {last === from ? 'that day' : 'all those days'} with enough rest around it (at least {rules?.minRestHours || 8} hours between shifts). Try other days.</p>
            ) : null
          ) : <p className="ui-caption">Up to {rules?.maxDays || 7} days in a row, from tomorrow.</p>}
          {pick ? <label className="block"><span className="ui-label">Why</span><SuggestInput maxLength={300} value={reason} onChange={setReason} suggestions={reasons} placeholder="Exam on Wednesday morning" /></label> : null}
          {error ? <p className="text-sm" role="alert" style={{ color: 'rgb(var(--neg))' }}>{error}</p> : null}
          <div className="flex gap-2">
            <button type="submit" className="ui-btn ui-btn-primary flex-1" disabled={!pick || busy}>{busy ? 'Sending…' : 'Ask'}</button>
            <button type="button" className="ui-btn ui-btn-secondary" onClick={reset}>Cancel</button>
          </div>
        </form>
      ) : null}
    </section>
  );
}

function MySwaps({ swaps, guard, onDone }) {
  const [busy, setBusy] = useState('');
  if (!swaps.length) return null;
  const withdraw = async (s) => {
    setBusy(s.id);
    try {
      await guard(withdrawSwap(s.id));
      onDone('Withdrawn. Your colleague is told.');
    } catch (e) {
      const t = errText(e, 'Not withdrawn.');
      if (t) onDone(t, false);
    } finally {
      setBusy('');
    }
  };
  return (
    <section className="ui-card p-5" aria-labelledby="swap-mine-h">
      <h2 id="swap-mine-h" className="ui-t-sec mb-1">My swaps</h2>
      <ul className="divide-y text-sm" style={{ borderColor: 'rgb(var(--border))' }}>
        {swaps.map((s) => {
          const other = s.asker ? s.colleague : s.requester;
          return (
            <li key={s.id} className="space-y-1 py-3">
              <div className="flex items-start justify-between gap-2">
                <span className="min-w-0">
                  <span className="block font-medium">With {other.name}</span>
                  <span className="block ui-caption tabular-nums">{span(s.fromDate, s.toDate)}{s.days[0] ? ` · ${s.days[0].requesterShift.name} ⇄ ${s.days[0].colleagueShift.name}` : ''}</span>
                </span>
                <Pill status={s.status} />
              </div>
              {s.colleagueNote && s.status === 'DECLINED' ? <p className="ui-caption">“{s.colleagueNote}”</p> : null}
              {s.decisionNote && s.status === 'REJECTED' ? <p className="ui-caption">“{s.decisionNote}”</p> : null}
              {s.asker && ['ASKED', 'WAITING'].includes(s.status) ? (
                <button type="button" className="ui-link text-xs" disabled={busy === s.id} onClick={() => withdraw(s)}>{busy === s.id ? 'Withdrawing…' : 'Withdraw'}</button>
              ) : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
