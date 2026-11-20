import React, { useCallback, useEffect, useState } from 'react';
import { SignedOut, askForAsset, confirmMyAsset, getMyAssets, reportAssetProblem, todayIst } from './portalApi';
import { errorWords } from '@ui/utils/errorWords';

/**
 * Company things with me (picks round 51), in the employee app's Me tab: what
 * the register says I hold, in Good, Fair or Damaged; "I still have this";
 * "Report a problem"; and asking for something I need. A problem and an ask go
 * to HR as an Ask HR case, so the answer comes where every other answer does.
 * Nothing shows when the company does not keep assets in CLOR.
 */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const day = (iso) => {
  const [y, m, d] = String(iso || '').slice(0, 10).split('-');
  return y && m && d ? `${Number(d)} ${MONTHS[Number(m) - 1]}${y !== todayIst().slice(0, 4) ? ` ${y}` : ''}` : '';
};
const errText = (e, what) => (e instanceof SignedOut ? '' : errorWords(e, what));

/** The caption under an asset: its tag, its state, and when I last said I have it. */
export function assetLine(a, today = todayIst()) {
  const confirmed = a.confirmedOn ? (a.confirmedOn === today ? 'You confirmed it today' : `You confirmed it on ${day(a.confirmedOn)}`) : null;
  return [a.tag, a.state, confirmed].filter(Boolean).join(' · ');
}

export default function MyAssets({ guard }) {
  const [data, setData] = useState(null);
  const [failed, setFailed] = useState('');
  const [busy, setBusy] = useState('');
  const [problemFor, setProblemFor] = useState(null);
  const [text, setText] = useState('');
  const [asking, setAsking] = useState(false);
  const [note, setNote] = useState(null);
  const load = useCallback(() => {
    guard(getMyAssets()).then((d) => { setData(d); setFailed(''); }).catch((e) => setFailed(errText(e, 'load the company things with you')));
  }, [guard]);
  useEffect(() => { load(); }, [load]);
  if (failed) return <p className="portal-sec text-sm" role="alert" style={{ color: 'rgb(var(--neg))' }}>{failed}</p>;
  if (!data?.available) return null;

  const run = async (key, fn, done) => {
    setBusy(key);
    setNote(null);
    try {
      await guard(fn());
      setNote({ ok: true, text: done });
      setProblemFor(null);
      setAsking(false);
      setText('');
      load();
    } catch (err) {
      const t = errText(err, 'send it');
      if (t) setNote({ ok: false, text: t });
    } finally {
      setBusy('');
    }
  };
  const today = todayIst();
  const writing = problemFor || asking;

  return (
    <section className="portal-sec space-y-3" aria-labelledby="assets-h">
      <h2 id="assets-h" className="ui-t-sec">Company things with you</h2>
      {note ? <p className="text-sm" role={note.ok ? 'status' : 'alert'}>{note.text}</p> : null}
      {data.assets.length ? (
        <ul className="divide-y" aria-label="Company things with you">
          {data.assets.map((a) => (
            <li key={a.id} className="py-3">
              <div className="font-medium">{a.title}</div>
              <div className="ui-caption">{assetLine(a, today)}</div>
              {a.problem ? <div className="ui-caption ui-text-warn">Problem reported{a.problemOn ? ` on ${day(a.problemOn)}` : ''}: {a.problem}</div> : null}
              <div className="mt-2 flex flex-wrap gap-2">
                {a.confirmedOn !== today ? (
                  <button type="button" className="ui-btn ui-btn-secondary ui-btn-sm" disabled={Boolean(busy)} onClick={() => run(`c:${a.id}`, () => confirmMyAsset(a.id), `Thanks. ${a.title} is confirmed as with you.`)}>
                    {busy === `c:${a.id}` ? 'Saving…' : 'I still have this'}
                  </button>
                ) : null}
                <button type="button" className="ui-btn ui-btn-ghost ui-btn-sm" disabled={Boolean(busy)} onClick={() => { setProblemFor(a); setAsking(false); setText(''); setNote(null); }}>Report a problem</button>
              </div>
            </li>
          ))}
        </ul>
      ) : <p className="ui-caption">Nothing is listed as with you.</p>}
      {writing ? (
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (problemFor) run('p', () => reportAssetProblem(problemFor.id, text.trim()), 'Sent to HR. Their answer comes in Ask HR.');
            else run('a', () => askForAsset(text.trim()), 'Sent to HR. Their answer comes in Ask HR.');
          }}
        >
          <label className="block">
            <span className="ui-label">{problemFor ? `What is wrong with ${problemFor.title}?` : 'What do you need?'}</span>
            <textarea className="ui-input w-full" rows={3} maxLength={1000} value={text} onChange={(e) => setText(e.target.value)} placeholder={problemFor ? 'The screen flickers' : 'A headset for calls'} />
          </label>
          <div className="flex gap-2">
            <button type="submit" className="ui-btn ui-btn-primary flex-1" disabled={Boolean(busy) || text.trim().length < (problemFor ? 5 : 3)}>{busy ? 'Sending…' : 'Send to HR'}</button>
            <button type="button" className="ui-btn ui-btn-secondary" onClick={() => { setProblemFor(null); setAsking(false); }}>Cancel</button>
          </div>
        </form>
      ) : (
        <button type="button" className="ui-btn ui-btn-ghost ui-btn-sm" onClick={() => { setAsking(true); setProblemFor(null); setText(''); setNote(null); }}>Ask for something you need</button>
      )}
    </section>
  );
}
