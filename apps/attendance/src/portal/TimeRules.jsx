import React, { useCallback, useEffect, useState } from 'react';

import { confirmDialog } from '@ui/components/ui/notify';
import LoadFailed from '@ui/components/ui/LoadFailed';
import { SignedOut, getFixes, getMyMarks, getNightConsent, setNightConsent } from './portalApi';

/*
 * The employee app's side of the attendance rules (WORKFLOW-GAP-RESEARCH-2026-10-30 4.4, 4.5, 4.6, B19;
 * server routes/peopleTimePortal.ts). Phone-first: one card each, the action a thumb's reach away.
 *  - FixNotices (Today): "No punch-out on Tue 29 Oct" with Fix, which opens the missed-punch request
 *    filled in; a manager's line for the team; an absence notice from HR with its date.
 *  - MyMarks (My days): "2 of 3 late marks; the next one costs ½ day", and the rule.
 *  - NightConsent (Me, women only): consent to night work, given or withdrawn by her.
 */
const errText = (e, fallback) => (e instanceof SignedOut ? '' : String(e?.message || fallback));
const day = (iso) => new Date(`${String(iso).slice(0, 10)}T00:00:00Z`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
const half = (d) => (d === 0.5 ? '½ day' : d === 1 ? '1 day' : `${d} days`);

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

/** Days I was asked to fix, still open; my team's for a manager; HR's absence notices to me. */
export function FixNotices({ guard, onFix }) {
  const fetcher = useCallback(() => getFixes(), []);
  const { data, failed, load } = useLoad(fetcher, guard);
  if (failed) return <LoadFailed message={failed} onRetry={load} />;
  const fixes = data?.fixes || [];
  const notices = data?.notices || [];
  const team = data?.team;
  if (!fixes.length && !notices.length && !team?.count) return null;
  return (
    <section className="ui-card space-y-3 p-5" aria-labelledby="fix-h">
      <h2 id="fix-h" className="ui-t-sec">To fix</h2>
      {notices.map((n) => (
        <p key={n.id} className="text-sm" role="alert">
          HR sent you {n.seq === 1 ? 'a notice' : 'a second notice'} about your absence. Report back or explain by <span className="font-medium tabular-nums">{day(n.reportBy)}</span>. The letter is under Me, My documents.
        </p>
      ))}
      {fixes.length ? (
        <ul className="divide-y" style={{ borderColor: 'rgb(var(--border))' }}>
          {fixes.map((f) => (
            <li key={f.date} className="flex items-center justify-between gap-3 py-2 text-sm">
              <span className="min-w-0">
                <span className="block font-medium">{f.what === 'NO_OUT' ? 'No punch-out' : 'No punch'}</span>
                <span className="ui-caption block tabular-nums">{day(f.date)}{f.checkIn ? `, in at ${f.checkIn}` : ''}</span>
              </span>
              <button type="button" className="ui-btn ui-btn-primary shrink-0" onClick={() => onFix?.(f)} aria-label={`Fix ${day(f.date)}`}>Fix</button>
            </li>
          ))}
        </ul>
      ) : null}
      {team?.count ? <p className="text-sm">{team.count} {team.count === 1 ? 'day' : 'days'} of your team still to fix. They have been asked.</p> : null}
    </section>
  );
}

/** The month's late marks against the rule, on My days. Nothing while the rule is off. */
export function MyMarks({ guard, month }) {
  const fetcher = useCallback(() => getMyMarks(month), [month]);
  const { data, failed, load } = useLoad(fetcher, guard);
  if (failed) return <LoadFailed message={failed} onRetry={load} />;
  if (!data?.on) return null;
  const lines = [data.late?.line, data.early?.line].filter(Boolean);
  return (
    <section className="ui-card space-y-2 p-5" aria-labelledby="marks-h">
      <h2 id="marks-h" className="ui-t-sec">Late marks</h2>
      {lines.map((l) => <p key={l} className="text-sm tabular-nums">{l}</p>)}
      {data.days > 0 ? (
        <p className="text-sm tabular-nums">
          {data.status === 'WAIVED' ? `${half(data.days)} waived${data.waivedReason ? `: ${data.waivedReason}` : ''}.` : `Costs ${half(data.days)} this month${data.fromLeave?.length ? `, from ${data.fromLeave.map((p) => p.name).join(', ')}` : ''}${data.lossOfPayDays ? `, ${half(data.lossOfPayDays)} unpaid` : ''}.`}
        </p>
      ) : null}
      {data.policy ? <p className="ui-caption">{data.policy}</p> : null}
    </section>
  );
}

/** A woman's consent to night work: shown only to her, given or withdrawn with one tap and a confirm. */
export function NightConsent({ guard }) {
  const fetcher = useCallback(() => getNightConsent(), []);
  const { data, failed, load } = useLoad(fetcher, guard);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null);
  if (failed) return <LoadFailed message={failed} onRetry={load} />;
  if (!data?.asked) return null;
  const given = data.consent?.status === 'GIVEN';
  const change = async () => {
    const ok = await confirmDialog(given
      ? { title: 'Withdraw your consent to night work?', message: `You will not be given shifts from ${data.window}.${data.nightDaysAhead ? ` HR is told about the ${data.nightDaysAhead} night ${data.nightDaysAhead === 1 ? 'shift' : 'shifts'} you already have.` : ''}`, confirmLabel: 'Withdraw' }
      : { title: 'Agree to work at night?', message: `You may be given shifts from ${data.window}. You can withdraw this at any time here.`, confirmLabel: 'I agree' });
    if (!ok) return;
    setBusy(true);
    setNote(null);
    try {
      await guard(setNightConsent({ status: given ? 'WITHDRAWN' : 'GIVEN' }));
      setNote({ ok: true, text: given ? 'Withdrawn. HR has been told.' : 'Recorded. HR can see it.' });
      load();
    } catch (e) {
      if (!(e instanceof SignedOut)) setNote({ ok: false, text: String(e?.message || 'Not saved.') });
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="ui-card space-y-3 p-5" aria-labelledby="night-h">
      <h2 id="night-h" className="ui-t-sec">Night work</h2>
      <p className="text-sm">
        {given ? `You agreed on ${day(data.consent.onDate)} to work from ${data.window}.` : data.consent ? `You withdrew on ${day(data.consent.onDate)}. You are not given shifts from ${data.window}.` : `You are not given shifts from ${data.window} unless you agree.`}
      </p>
      {note ? <p className="text-sm" role={note.ok ? 'status' : 'alert'}>{note.text}</p> : null}
      <button type="button" className={`ui-btn ${given ? 'ui-btn-secondary' : 'ui-btn-primary'} w-full`} disabled={busy} onClick={change}>{busy ? 'Saving…' : given ? 'Withdraw consent' : 'I agree to night work'}</button>
    </section>
  );
}
