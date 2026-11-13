import React, { useCallback, useEffect, useRef, useState } from 'react';

import LoadFailed from '@ui/components/ui/LoadFailed';
import SuggestInput from '@ui/components/ui/SuggestInput';
import { SignedOut, askOvertime, cancelOvertime, confirmMonth, disputeMonth, getMonthReview, getOvertime, hm, todayIst } from './portalApi';

/*
 * The month's review and overtime in the web employee app (time depth, gap 18):
 * what only the Android app had. Confirm last month's days, or say what is
 * wrong before the cutoff; ask for overtime or comp-off on a day that has it.
 * The same routes the phone app uses (portal.ts /month-review, /overtime).
 */

const lastMonth = () => {
  const [y, m] = todayIst().slice(0, 7).split('-').map(Number);
  return new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 7);
};
const monthWords = (m) => new Date(`${m}-01T00:00:00Z`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });
const dayWords = (d) => new Date(`${d}T00:00:00Z`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
const PILL = { PENDING: ['ui-pill-warn', 'Waiting'], APPROVED: ['ui-pill-pos', 'Approved'], REJECTED: ['ui-pill-neg', 'Rejected'], CANCELLED: ['ui-pill-neutral', 'Cancelled'] };
const Pill = ({ status }) => <span className={`ui-pill ${PILL[status]?.[0] || 'ui-pill-neutral'}`}>{PILL[status]?.[1] || status}</span>;

/** Load once per key; only the latest answer fills the card. */
function useLoad(fn, key, guard) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const seq = useRef(0);
  const load = useCallback(() => {
    const n = ++seq.current;
    guard(fn(key))
      .then((d) => { if (n === seq.current) { setData(d); setError(''); } })
      .catch((e) => { if (n === seq.current && !(e instanceof SignedOut)) setError(String(e?.message || 'Could not load.')); });
  }, [fn, key, guard]);
  useEffect(() => { load(); }, [load]);
  return { data, error, load };
}

export function MonthReview({ guard }) {
  const [month, setMonth] = useState(lastMonth);
  const { data, error, load } = useLoad(getMonthReview, month, guard);
  const [disputing, setDisputing] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);
  const [allShown, setAllShown] = useState(false);

  const send = async (dispute) => {
    setBusy(true);
    setMessage(null);
    try {
      await guard(dispute ? disputeMonth(month, note.trim()) : confirmMonth(month));
      setMessage({ ok: true, text: dispute ? 'Sent to HR. They check it before payroll.' : 'Confirmed. Thank you.' });
      setDisputing(false);
      setNote('');
      load();
    } catch (e) {
      if (!(e instanceof SignedOut)) setMessage({ ok: false, text: String(e?.message || 'Not sent.') });
    } finally {
      setBusy(false);
    }
  };

  const s = data?.summary;
  const c = data?.confirmation;
  return (
    <section className="ui-card space-y-3 p-5" aria-labelledby="month-review-h">
      <div className="flex items-center justify-between gap-2">
        <h2 id="month-review-h" className="ui-t-sec">Check my month</h2>
        <input type="month" className="ui-input !w-auto" value={month} max={todayIst().slice(0, 7)} onChange={(e) => { setMonth(e.target.value || lastMonth()); setMessage(null); setDisputing(false); setAllShown(false); }} aria-label="Month to check" />
      </div>
      <LoadFailed message={error} onRetry={load} />
      {!data ? (error ? null : <p className="ui-caption">Loading…</p>) : !s ? <p className="ui-caption">Nothing recorded for this month yet.</p> : (
        <>
          <dl className="grid grid-cols-3 gap-2 text-center">
            {[['Payable days', s.payableDays], ['Loss of pay', s.lossOfPayDays], ['Present', s.present], ['Leave', s.leave], ['Absent', s.absent], ['Overtime', hm(s.approvedOvertimeMinutes)]].map(([k, v]) => (
              <div key={k} className="rounded-xl p-2" style={{ backgroundColor: 'rgb(var(--app-bg))' }}>
                <dt className="ui-caption">{k}</dt>
                <dd className="text-base font-semibold tabular-nums">{v}</dd>
              </div>
            ))}
          </dl>
          {data.unresolved.length ? (
            <div>
              <h3 className="ui-t-label mb-1">Still to sort out</h3>
              <ul className="divide-y text-sm" style={{ borderColor: 'rgb(var(--border))' }}>
                {(allShown ? data.unresolved : data.unresolved.slice(0, 5)).map((u) => (
                  <li key={`${u.date}-${u.kind}`} className="flex items-baseline justify-between gap-2 py-1.5">
                    <span className="whitespace-nowrap tabular-nums">{dayWords(u.date)}</span>
                    <span className="ui-caption text-right">{u.text}</span>
                  </li>
                ))}
              </ul>
              {data.unresolved.length > 5 && !allShown ? <button type="button" className="ui-link text-sm mt-1" onClick={() => setAllShown(true)}>Show all {data.unresolved.length}</button> : null}
              <p className="ui-caption mt-1">Fix a day from My days above with a correction; HR sees the rest.</p>
            </div>
          ) : null}
          {data.pendingOvertime ? <p className="ui-caption">{data.pendingOvertime} overtime request{data.pendingOvertime === 1 ? '' : 's'} still waiting for a decision.</p> : null}
          {c ? (
            <p className="text-sm" role="status">
              <span className={`ui-pill ${c.status === 'CONFIRMED' ? 'ui-pill-pos' : 'ui-pill-warn'}`}>{c.status === 'CONFIRMED' ? 'Confirmed' : 'Sent to HR as wrong'}</span>
              {c.note ? <span className="ui-caption block mt-1">“{c.note}”</span> : null}
            </p>
          ) : null}
          {c?.status === 'DISPUTED' && c.reply ? (
            <div className="border-l-2 pl-3" style={{ borderColor: 'rgb(var(--border))' }}>
              <h3 className="ui-t-label">HR’s reply</h3>
              <p className="text-sm whitespace-pre-line">{c.reply.text}</p>
              <p className="ui-caption tabular-nums">{new Date(c.reply.at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</p>
            </div>
          ) : c?.status === 'DISPUTED' ? <p className="ui-caption">HR has not answered yet.</p> : null}
          {data.canConfirm ? (
            disputing ? (
              <div className="space-y-2">
                <label className="block">
                  <span className="ui-label">What is wrong with {monthWords(month)}?</span>
                  <textarea className="ui-input w-full" rows={3} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. I was on duty at the client on the 12th" />
                </label>
                <div className="flex gap-2">
                  <button type="button" className="ui-btn ui-btn-primary flex-1" disabled={busy || note.trim().length < 5} onClick={() => send(true)}>{busy ? 'Sending…' : 'Send to HR'}</button>
                  <button type="button" className="ui-btn ui-btn-secondary" disabled={busy} onClick={() => { setDisputing(false); setNote(''); }}>Cancel</button>
                </div>
              </div>
            ) : (
              <div className="flex gap-2">
                <button type="button" className="ui-btn ui-btn-primary flex-1" disabled={busy} onClick={() => send(false)}>{busy ? 'Saving…' : c?.status === 'CONFIRMED' ? 'Confirm again' : 'These days are right'}</button>
                <button type="button" className="ui-btn ui-btn-secondary" disabled={busy} onClick={() => setDisputing(true)}>Something is wrong</button>
              </div>
            )
          ) : data.why ? <p className="ui-caption">{data.why}</p> : null}
          {data.canConfirm && data.cutoff ? <p className="ui-caption">Confirm or say what is wrong by {dayWords(data.cutoff)}.</p> : null}
          {message ? <p className="text-sm font-medium" role={message.ok ? 'status' : 'alert'} style={{ color: message.ok ? 'rgb(var(--pos))' : 'rgb(var(--neg))' }}>{message.text}</p> : null}
        </>
      )}
    </section>
  );
}

export function MyOvertime({ guard }) {
  const [month, setMonth] = useState(() => todayIst().slice(0, 7));
  const { data, error, load } = useLoad(getOvertime, month, guard);
  const [asking, setAsking] = useState(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState(null);

  const ask = async () => {
    setBusy('ask');
    setMessage(null);
    try {
      await guard(askOvertime({ date: asking.date, kind: asking.kind, reason: reason.trim() }));
      setMessage({ ok: true, text: asking.kind === 'COMP_OFF' ? 'Comp-off asked for.' : 'Overtime asked for.' });
      setAsking(null);
      setReason('');
      load();
    } catch (e) {
      if (!(e instanceof SignedOut)) setMessage({ ok: false, text: String(e?.message || 'Not sent.') });
    } finally {
      setBusy('');
    }
  };
  const cancel = async (id) => {
    setBusy(id);
    setMessage(null);
    try {
      await guard(cancelOvertime(id));
      setMessage({ ok: true, text: 'Request withdrawn.' });
      load();
    } catch (e) {
      if (!(e instanceof SignedOut)) setMessage({ ok: false, text: String(e?.message || 'Not withdrawn.') });
    } finally {
      setBusy('');
    }
  };

  return (
    <section className="ui-card space-y-3 p-5" aria-labelledby="my-overtime-h">
      <div className="flex items-center justify-between gap-2">
        <h2 id="my-overtime-h" className="ui-t-sec">My overtime</h2>
        <input type="month" className="ui-input !w-auto" value={month} max={todayIst().slice(0, 7)} onChange={(e) => { setMonth(e.target.value || todayIst().slice(0, 7)); setAsking(null); setMessage(null); }} aria-label="Overtime month" />
      </div>
      <LoadFailed message={error} onRetry={load} />
      {!data ? (error ? null : <p className="ui-caption">Loading…</p>) : !data.days.length ? (
        <p className="ui-caption">No overtime or work on a day off recorded in {monthWords(month)}.</p>
      ) : (
        <>
          <p className="text-sm tabular-nums">Recorded {hm(data.recordedMinutes)} · approved {hm(data.approvedMinutes)}{data.pendingMinutes ? ` · waiting ${hm(data.pendingMinutes)}` : ''}</p>
          <ul className="divide-y" style={{ borderColor: 'rgb(var(--border))' }}>
            {data.days.map((d) => (
              <li key={d.date} className="space-y-2 py-3">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-medium whitespace-nowrap">{dayWords(d.date)}</span>
                  <span className="ui-caption tabular-nums text-right">
                    {d.restDay ? 'Day off worked' : `${hm(d.overtimeMinutes)} over`}{d.overtimeApproved ? ' · approved' : ''}
                  </span>
                </div>
                {d.overtimeRequest ? (
                  <div className="flex items-center justify-between gap-2 text-sm">
                    <span>Overtime <Pill status={d.overtimeRequest.status} />{d.overtimeRequest.note ? <span className="ui-caption block">{d.overtimeRequest.note}</span> : null}</span>
                    {d.overtimeRequest.status === 'PENDING' ? <button type="button" className="ui-btn ui-btn-ghost ui-btn-sm" disabled={busy === d.overtimeRequest.id} onClick={() => cancel(d.overtimeRequest.id)}>Withdraw</button> : null}
                  </div>
                ) : null}
                {d.compOffRequest ? (
                  <div className="flex items-center justify-between gap-2 text-sm">
                    <span className="tabular-nums">Comp-off {d.compOffRequest.days} day{d.compOffRequest.days === 1 ? '' : 's'} <Pill status={d.compOffRequest.status} />{d.compOffRequest.note ? <span className="ui-caption block">{d.compOffRequest.note}</span> : null}</span>
                    {d.compOffRequest.status === 'PENDING' ? <button type="button" className="ui-btn ui-btn-ghost ui-btn-sm" disabled={busy === d.compOffRequest.id} onClick={() => cancel(d.compOffRequest.id)}>Withdraw</button> : null}
                  </div>
                ) : null}
                {asking?.date === d.date ? (
                  <div className="space-y-2">
                    <label className="block">
                      <span className="ui-label">{asking.kind === 'COMP_OFF' ? 'What was the work?' : 'What was the extra work for?'}</span>
                      <SuggestInput className="ui-input w-full" maxLength={500} value={reason} onChange={setReason} placeholder="e.g. Month-end stock count" />
                    </label>
                    <div className="flex gap-2">
                      <button type="button" className="ui-btn ui-btn-primary flex-1" disabled={busy === 'ask' || reason.trim().length < 3} onClick={ask}>{busy === 'ask' ? 'Sending…' : 'Send'}</button>
                      <button type="button" className="ui-btn ui-btn-secondary" onClick={() => { setAsking(null); setReason(''); }}>Cancel</button>
                    </div>
                  </div>
                ) : d.canAskOvertime || d.canAskCompOff ? (
                  <div className="flex flex-wrap gap-2">
                    {d.canAskOvertime ? <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={() => { setAsking({ date: d.date, kind: 'OVERTIME' }); setReason(''); }}>Ask for overtime</button> : null}
                    {d.canAskCompOff ? <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm tabular-nums" onClick={() => { setAsking({ date: d.date, kind: 'COMP_OFF' }); setReason(''); }}>Ask for {d.compOffDays} day comp-off</button> : null}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        </>
      )}
      {message ? <p className="text-sm font-medium" role={message.ok ? 'status' : 'alert'} style={{ color: message.ok ? 'rgb(var(--pos))' : 'rgb(var(--neg))' }}>{message.text}</p> : null}
    </section>
  );
}
