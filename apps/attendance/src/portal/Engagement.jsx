import React, { useCallback, useEffect, useState } from 'react';

import { confirmDialog } from '@ui/components/ui/notify';
import { ExitQuestionsForm } from '@ui/lifecycle/LeavingExtras';
import LoadFailed from '@ui/components/ui/LoadFailed';
import { SignedOut, getCelebrations, getExitInterview, getTodayPosts, sendExitInterview, setCelebrations } from './portalApi';

/*
 * The employee app's side of leaving and engagement (WORKFLOW-GAP-RESEARCH-2026-10-30 4.8, 4.9; server
 * routes/peopleEngagementPortal.ts). Phone-first, one card each:
 *  - TodayPosts (Today): today's birthdays and work anniversaries in my team, tomorrow's holiday.
 *  - ExitInterview (Me, while leaving): five short questions, about two minutes, sent once.
 *  - Celebrations (Me): whether my team is told on my birthday and work anniversary.
 */
const errText = (e, fallback) => (e instanceof SignedOut ? '' : String(e?.message || fallback));
const day = (iso) => new Date(`${String(iso).slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });

function useLoad(fetcher, guard) {
  const [data, setData] = useState(null);
  const [failed, setFailed] = useState('');
  const load = useCallback(() => {
    guard(fetcher())
      .then((d) => { setData(d || {}); setFailed(''); })
      .catch((e) => setFailed(errText(e, 'Could not load.')));
  }, [fetcher, guard]);
  useEffect(() => { load(); }, [load]);
  return { data, failed, load };
}

const KIND_WORD = { BIRTHDAY: 'Birthday', ANNIVERSARY: 'Work anniversary', HOLIDAY: 'Holiday' };

export function TodayPosts({ guard }) {
  const fetcher = useCallback(() => getTodayPosts(), []);
  const { data, failed } = useLoad(fetcher, guard);
  /* A greeting that did not load is not worth an error card on Today. */
  if (failed || !data?.posts?.length) return null;
  return (
    <section className="ui-card space-y-2 p-5" aria-labelledby="today-posts-h">
      <h2 id="today-posts-h" className="ui-t-sec">Today</h2>
      <ul className="space-y-2">
        {data.posts.map((p) => (
          <li key={p.id} className="text-sm">
            <span className="ui-caption block">{KIND_WORD[p.kind] || ''}</span>
            <span className={p.mine ? 'font-medium' : ''}>{p.text}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function ExitInterview({ guard, refreshKey }) {
  const fetcher = useCallback(() => getExitInterview(), []);
  const { data, failed, load } = useLoad(fetcher, guard);
  const [answers, setAnswers] = useState({});
  const [hide, setHide] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null);
  const [open, setOpen] = useState(false);
  useEffect(() => { if (refreshKey) load(); }, [refreshKey, load]);
  if (failed) return <LoadFailed message={failed} onRetry={load} />;
  const iv = data?.interview;
  if (!iv) return null;
  const send = async (e) => {
    e.preventDefault();
    const miss = iv.questions.find((q) => q.kind !== 'TEXT' && !answers[q.key]);
    if (miss) { setNote({ ok: false, text: `Answer “${miss.text}”.` }); return; }
    if (!(await confirmDialog({ title: 'Send your answers?', message: hide ? 'HR and the owner read them; your managers do not.' : 'HR, the owner and your managers read them.', confirmLabel: 'Send', tone: 'primary' }))) return;
    setBusy(true);
    setNote(null);
    try {
      await guard(sendExitInterview({ answers, hideFromManager: hide }));
      setOpen(false);
      load();
    } catch (err) {
      const text = errText(err, 'Not sent.');
      if (text) setNote({ ok: false, text });
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="ui-card space-y-3 p-5" aria-labelledby="exit-h">
      <h2 id="exit-h" className="ui-t-sec">Exit interview</h2>
      {note ? <p className="text-sm" role={note.ok ? 'status' : 'alert'}>{note.text}</p> : null}
      {iv.status === 'SUBMITTED' ? (
        <p className="text-sm">You sent your answers{iv.submittedAt ? ` on ${day(new Date(new Date(iv.submittedAt).getTime() + 330 * 60_000).toISOString())}` : ''}{iv.enteredBy === 'HR' ? ' (HR wrote them down from your conversation)' : ''}. Thank you.</p>
      ) : open ? (
        <form onSubmit={send} className="space-y-4">
          <ExitQuestionsForm questions={iv.questions} answers={answers} onChange={(a) => { setAnswers(a); setNote(null); }} idPrefix="app-exit" />
          {/* The whole row is the target on a phone: 44px tall, the box larger than the default 16px. */}
          <label className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" className="ui-checkbox h-5 w-5 shrink-0" checked={hide} onChange={(e) => setHide(e.target.checked)} />Keep my answers from my managers</label>
          <p className="ui-caption">{iv.purpose}</p>
          <div className="flex gap-2">
            <button type="submit" className="ui-btn ui-btn-primary min-h-11 flex-1" disabled={busy}>{busy ? 'Sending…' : 'Send answers'}</button>
            <button type="button" className="ui-btn ui-btn-secondary min-h-11" onClick={() => setOpen(false)}>Later</button>
          </div>
        </form>
      ) : (
        <>
          <p className="text-sm">Before your last day, {day(iv.lastDay)}, tell us why you are leaving and what we could do better. {iv.questions.length} short questions, about two minutes.</p>
          <button type="button" className="ui-btn ui-btn-primary w-full" onClick={() => setOpen(true)}>Answer now</button>
        </>
      )}
    </section>
  );
}

export function Celebrations({ guard }) {
  const fetcher = useCallback(() => getCelebrations(), []);
  const { data, failed, load } = useLoad(fetcher, guard);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null);
  if (failed) return <LoadFailed message={failed} onRetry={load} />;
  if (!data) return null;
  const announced = !data.optedOut;
  const change = async () => {
    setBusy(true);
    setNote(null);
    try {
      await guard(setCelebrations(announced));
      setNote({ ok: true, text: announced ? 'Done. Your team will not be told.' : 'Done. Your team will be told on the day.' });
      load();
    } catch (e) {
      const text = errText(e, 'Not saved.');
      if (text) setNote({ ok: false, text });
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="ui-card space-y-3 p-5" aria-labelledby="celebrate-h">
      <h2 id="celebrate-h" className="ui-t-sec">Birthdays and anniversaries</h2>
      <label className="flex items-start justify-between gap-3 text-sm">
        <span>Tell my team on my birthday and work anniversary<span className="ui-caption block">Only the day is shown, never the year.</span></span>
        <input type="checkbox" role="switch" className="ui-checkbox mt-0.5" checked={announced} disabled={busy} onChange={change} aria-label="Tell my team on my birthday and work anniversary" />
      </label>
      {note ? <p className="text-sm" role={note.ok ? 'status' : 'alert'}>{note.text}</p> : null}
    </section>
  );
}
