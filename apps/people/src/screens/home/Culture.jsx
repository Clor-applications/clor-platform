import React, { useEffect, useState } from 'react';
import { CaretRight, ChartBar, HandHeart } from '@phosphor-icons/react';

import PopupSelect from '@ui/components/pickers/PopupSelect';
import { notify } from '@ui/components/ui/notify';
import { answerPulse, askPulse, closePulse, getPulse, giveKudos, listKudos, removeKudos } from '../../api/home';
import { Face, PanelHead, plural, shortDate } from './bits';

const ago = (iso) => {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  return days <= 0 ? 'Today' : days === 1 ? 'Yesterday' : days < 7 ? `${days} days ago` : shortDate(iso);
};
const SCORE_WORD = ['Very bad', 'Bad', 'All right', 'Good', 'Very good'];
const SUGGESTED = 'How was your week at work?';

/**
 * Kudos (owner's suite spec, 5–6 Nov 2026): a thank-you anyone in People can give someone who works here, newest
 * first. The giver, or HR, may take one down.
 */
export function KudosPanel({ people, colourOf }) {
  const [list, setList] = useState(null);
  const [giving, setGiving] = useState(false);
  const [to, setTo] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { listKudos().then(setList).catch(() => setList([])); }, []);
  const give = async (e) => {
    e.preventDefault();
    if (busy) return;
    if (!to) { notify.error('Choose who it is for.'); return; }
    if (!message.trim()) { notify.error('Say what you are thanking them for.'); return; }
    setBusy(true);
    try {
      setList(await giveKudos(to, message.trim()));
      notify.success('Kudos given.');
      setGiving(false);
      setTo('');
      setMessage('');
    } catch (err) {
      notify.error(String(err?.message || 'Not given.'));
    } finally {
      setBusy(false);
    }
  };
  const remove = async (k) => {
    try { setList(await removeKudos(k.id)); notify.success('Taken down.'); } catch (err) { notify.error(String(err?.message || 'Not taken down.')); }
  };
  return (
    <section aria-labelledby="kudos-h">
      <PanelHead id="kudos-h" icon={HandHeart} tint="peach" title="Kudos" action={giving ? null : <button type="button" className="people-more" onClick={() => setGiving(true)}>Give kudos <CaretRight size={14} aria-hidden="true" /></button>} />
      {giving ? (
        <form className="home-kudos-form" onSubmit={give}>
          <PopupSelect showValueSubtext={false} label="For" ariaLabel="Kudos for" value={to} onChange={(v) => setTo(v || '')} options={(people || []).map((p) => ({ value: p.id, label: p.name }))} alwaysSearch={(people || []).length > 8} placeholder="Choose someone" />
          <label className="block"><span className="ui-label">What for</span><textarea className="ui-input w-full" rows={2} maxLength={280} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Stayed late to close the Pune order" /></label>
          <span className="flex justify-end gap-2">
            <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={() => setGiving(false)}>Cancel</button>
            <button type="submit" className="ui-btn ui-btn-secondary ui-btn-sm" disabled={busy}>{busy ? 'Giving…' : 'Give kudos'}</button>
          </span>
        </form>
      ) : null}
      {list?.length ? (
        <ul className="people-list">
          {list.map((k) => (
            <li key={k.id} className="people-row home-kudos">
              <Face person={k.to} size={30} colour={colourOf(k.to.department)} />
              <span className="min-w-0 flex-1">
                <span className="block text-sm"><span className="font-medium">{k.to.name}</span> <span className="ui-muted">from {k.fromName}</span></span>
                <span className="home-kudos-text">{k.message}</span>
                <span className="ui-caption">{ago(k.at)}{k.canRemove ? <> · <button type="button" className="ui-link" onClick={() => remove(k)}>Take down</button></> : null}</span>
              </span>
            </li>
          ))}
        </ul>
      ) : giving ? null : (
        <p className="people-empty">{list ? 'No kudos yet. Thank someone for something they did this week.' : 'Loading…'}</p>
      )}
    </section>
  );
}

/**
 * The one-question pulse: a 1 to 5 answer, changeable while the question is open; the counts show only once
 * enough people answered that no single answer stands out. HR asks the question and closes it.
 */
export function PulsePanel() {
  const [p, setP] = useState(null);
  const [asking, setAsking] = useState(false);
  const [text, setText] = useState(SUGGESTED);
  const [busy, setBusy] = useState(false);
  useEffect(() => { getPulse().then(setP).catch(() => setP({ question: null, canAsk: false })); }, []);
  const run = async (fn, done) => {
    if (busy) return;
    setBusy(true);
    try { setP(await fn()); if (done) notify.success(done); } catch (err) { notify.error(String(err?.message || 'Not saved.')); } finally { setBusy(false); }
  };
  if (!p || (!p.question && !p.canAsk)) return null;
  const q = p.question;
  const max = Math.max(1, ...(p.results || []));
  return (
    <section aria-labelledby="pulse-h">
      <PanelHead id="pulse-h" icon={ChartBar} tint="lilac" title="Pulse" action={p.canAsk && !asking ? <button type="button" className="people-more" onClick={() => { setText(SUGGESTED); setAsking(true); }}>{q ? 'New question' : 'Ask a question'} <CaretRight size={14} aria-hidden="true" /></button> : null} />
      {asking ? (
        <form className="home-kudos-form" onSubmit={(e) => { e.preventDefault(); run(() => askPulse(text.trim()), 'Question asked.').then(() => setAsking(false)); }}>
          <label className="block"><span className="ui-label">One question for everyone</span><input className="ui-input w-full" maxLength={160} value={text} onChange={(e) => setText(e.target.value)} /></label>
          {q ? <p className="ui-caption">Asking this closes “{q.text}”. Its answers are kept.</p> : null}
          <span className="flex justify-end gap-2">
            <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" onClick={() => setAsking(false)}>Cancel</button>
            <button type="submit" className="ui-btn ui-btn-secondary ui-btn-sm" disabled={busy || !text.trim()}>Ask</button>
          </span>
        </form>
      ) : null}
      {q ? (
        <div className="home-pulse">
          <p className="home-pulse-q">{q.text}</p>
          <div className="home-pulse-scale" role="radiogroup" aria-label={q.text}>
            {SCORE_WORD.map((w, i) => (
              <button key={w} type="button" role="radio" aria-checked={p.mine === i + 1} className="home-pulse-score" disabled={busy} onClick={() => run(() => answerPulse(q.id, i + 1), p.mine ? 'Answer changed.' : 'Thanks for answering.')} title={w}>
                <b className="tabular-nums">{i + 1}</b><span>{w}</span>
              </button>
            ))}
          </div>
          {p.results ? (
            <ol className="home-pulse-results" aria-label={`Answers: ${p.results.map((n, i) => `${SCORE_WORD[i]} ${n}`).join(', ')}; average ${p.average}`}>
              {p.results.map((n, i) => <li key={SCORE_WORD[i]}><span className="home-pulse-bar"><span style={{ height: `${(n / max) * 100}%` }} /></span><b className="tabular-nums">{n}</b></li>)}
            </ol>
          ) : null}
          <p className="ui-caption">
            <span className="tabular-nums">{plural(p.answered, 'answer')}</span>
            {p.results ? <> · average <span className="tabular-nums">{p.average}</span></> : <> · results show at <span className="tabular-nums">{p.showsAt}</span>, so no one answer stands out</>}
            {p.canAsk ? <> · <button type="button" className="ui-link" disabled={busy} onClick={() => run(closePulse, 'Question closed.')}>Close it</button></> : null}
          </p>
        </div>
      ) : !asking ? <p className="people-empty">No question open. Ask one thing everyone can answer in a second.</p> : null}
    </section>
  );
}
