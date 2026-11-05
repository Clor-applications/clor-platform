import React, { useRef, useState } from 'react';
import { CaretRight, Check, IdentificationCard, Hourglass, SealCheck, SignOut, X } from '@phosphor-icons/react';

import { notify } from '@ui/components/ui/notify';
import { bulkReviewLeave, bulkReviewRequests } from '@ui/timeOff/api';
import { Face, PanelHead, plural, range, shortDate } from './bits';

const REVIEW = { LEAVE: bulkReviewLeave, ATTENDANCE: bulkReviewRequests };
/* What a request asks for, as a sentence: "asks for casual leave", "asks to work from home". */
const ASKS = { WFH: 'asks to work from home', ON_DUTY: 'asks for field duty', PERMISSION: 'asks for time off', MISSED_PUNCH: 'asks to fix a missed punch', SHIFT_CHANGE: 'asks to change shift' };
const asks = (i) => (i.kind === 'LEAVE' ? `asks for ${String(i.what || 'leave').toLowerCase()}` : ASKS[i.subKind] || `asks for ${String(i.what || 'a change').toLowerCase()}`);
const SHOWN = 5;
const TONE = { urgent: { label: 'Now', pill: 'neg' }, soon: { label: 'This week', pill: 'neutral' }, info: { label: 'When you can', pill: 'neutral' } };
/* Home's to-dos the rows above already carry: leave and attendance requests. (Data check stays: it finds more than these four details.) */
const COVERED = new Set(['leave', 'attendanceRequests']);

/**
 * "Waiting for your action" (owner's suite spec, 5–6 Nov 2026): leave and work-from-home requests decided in place
 * (Approve in one click; Reject asks for the reason they will read, on the row), then missing statutory details,
 * probation check-ins at 30, 60 and 90 days and exit clearance to sign, then every other to-do Home already had.
 */
export default function WaitingQueue({ items, decisions, todos, colourOf, openScreen, onDecided, setupShowing }) {
  const [rejecting, setRejecting] = useState(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(() => new Set());
  const busyRef = useRef(new Set());
  const go = (screen, params) => () => openScreen?.(screen, params);
  const requests = (items || []).filter((i) => REVIEW[i.kind]);
  const statutory = decisions?.statutory?.people ? decisions.statutory : null;
  const probation = decisions?.probation || [];
  const clearance = decisions?.clearance || [];
  /* A to-do is left out only when a row above says the same; if the inbox did not load, the to-do stays. */
  const others = (todos || []).filter((t) => !(COVERED.has(t.key) && requests.length));
  const loading = !items && !todos;

  const decide = async (i, approve) => {
    if (busyRef.current.has(i.key)) return;
    const why = note.trim();
    if (!approve && !why) { notify.error('Say why. They see this with the decision.'); return; }
    busyRef.current.add(i.key);
    setBusy(new Set(busyRef.current));
    try {
      const out = await REVIEW[i.kind]([i.id], approve, approve ? undefined : why);
      const err = (out?.results || [])[0]?.error;
      if (err) notify.error(err);
      else {
        notify.success(approve ? (out?.handedOn ? 'Approved as the manager; now with HR.' : `Approved: ${i.employeeName}.`) : `Rejected: ${i.employeeName}.`);
        setRejecting(null);
        setNote('');
        onDecided?.(i);
      }
    } catch (e) {
      notify.error(String(e?.message || (approve ? 'Not approved.' : 'Not rejected.')));
    } finally {
      busyRef.current.delete(i.key);
      setBusy(new Set(busyRef.current));
    }
  };

  const nothing = !requests.length && !statutory && !probation.length && !clearance.length && !others.length;
  return (
    <section aria-labelledby="todo-h">
      <PanelHead id="todo-h" icon={SealCheck} tint="butter" title="Waiting for your action" action={requests.length ? <button type="button" className="people-more" onClick={go('approvals')}>Approvals <CaretRight size={14} aria-hidden="true" /></button> : null} />
      {requests.length ? (
        <ul className="people-list" aria-label="Requests to decide">
          {requests.slice(0, SHOWN).map((i) => (
            <li key={i.key} className="people-approval">
              <Face person={{ name: i.employeeName, photoUrl: i.photoUrl }} size={34} colour={colourOf(i.department)} />
              <div className="min-w-0 flex-1">
                <p className="text-sm"><button type="button" className="people-name-link" onClick={go('employee', { id: i.employeeId })}>{i.employeeName}</button> <span className="ui-muted">{asks(i)}</span></p>
                <p className="ui-caption truncate"><span className="tabular-nums">{range(i.fromDate, i.toDate)}</span>{i.days ? <>, <span className="tabular-nums">{plural(i.days, 'day')}</span></> : null}{i.overdue ? <span className="ui-pill ui-pill-neg ml-2">Overdue</span> : null}</p>
                {rejecting === i.key ? (
                  <form className="home-reject" onSubmit={(e) => { e.preventDefault(); decide(i, false); }}>
                    <input className="ui-input" aria-label={`Why ${i.employeeName}'s request is rejected`} placeholder="Why not? They read this" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} autoFocus />
                    <button type="submit" className="soft-chip soft-chip-neg" disabled={busy.has(i.key) || !note.trim()}>{busy.has(i.key) ? 'Rejecting' : 'Reject'}</button>
                    <button type="button" className="soft-chip" onClick={() => { setRejecting(null); setNote(''); }}>Cancel</button>
                  </form>
                ) : null}
              </div>
              {rejecting === i.key ? null : i.bulk ? (
                <div className="flex shrink-0 items-center gap-2">
                  <button type="button" className="soft-chip" aria-label={`Reject ${i.employeeName}'s request`} disabled={busy.has(i.key)} onClick={() => { setRejecting(i.key); setNote(''); }}><X size={14} weight="bold" aria-hidden="true" /> Reject</button>
                  <button type="button" className="soft-chip soft-chip-pos" aria-label={`Approve ${i.employeeName}'s request`} disabled={busy.has(i.key)} onClick={() => decide(i, true)}>
                    <Check size={14} weight="bold" aria-hidden="true" /> {busy.has(i.key) ? 'Approving' : 'Approve'}
                  </button>
                </div>
              ) : (
                /* Their own request, theirs to decide only by the company's setting: decided in Approvals, where that is said. */
                <div className="flex shrink-0 items-center gap-2"><button type="button" className="soft-chip" onClick={go('approvals')}>Review</button></div>
              )}
            </li>
          ))}
          {requests.length > SHOWN ? <li className="people-row"><button type="button" className="ui-link text-sm" onClick={go('approvals')}>{plural(requests.length - SHOWN, 'more request')} in Approvals</button></li> : null}
        </ul>
      ) : null}

      {statutory || probation.length || clearance.length ? (
        <ul className="people-list" aria-label="Details and sign-offs">
          {statutory ? (
            <li>
              <button type="button" className="people-row people-row-action" onClick={go('dataHealth')}>
                <span className="home-mark" data-tint="peach"><IdentificationCard size={16} weight="duotone" aria-hidden="true" /></span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">Statutory details missing <span className="ui-muted font-normal">· {plural(statutory.people, 'person', 'people')}</span></span>
                  <span className="home-chips">{statutory.fields.filter((f) => f.count).map((f) => <span key={f.key} className="home-chip">{f.label} <b className="tabular-nums">{f.count}</b></span>)}</span>
                </span>
                <CaretRight size={16} className="ui-subtle shrink-0" aria-hidden="true" />
              </button>
            </li>
          ) : null}
          {probation.map((p) => (
            <li key={`prob-${p.employeeId}-${p.mark}`}>
              <button type="button" className="people-row people-row-action" onClick={go('employee', { id: p.employeeId, tab: 'employment' })}>
                <span className="home-mark" data-tint="lilac"><Hourglass size={16} weight="duotone" aria-hidden="true" /></span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm"><span className="font-medium">{p.name}</span> <span className="ui-muted">· <span className="tabular-nums">{p.mark}</span>-day probation review</span></span>
                  <span className="ui-caption block">{p.late ? 'Was due' : 'Due'} <span className="tabular-nums">{shortDate(p.on)}</span></span>
                </span>
                {p.late ? <span className="ui-pill ui-pill-neg">Late</span> : null}
                <CaretRight size={16} className="ui-subtle shrink-0" aria-hidden="true" />
              </button>
            </li>
          ))}
          {clearance.map((c) => (
            <li key={`clr-${c.employeeId}`}>
              <button type="button" className="people-row people-row-action" onClick={go('leavers', { open: c.employeeId })}>
                <span className="home-mark" data-tint="peach"><SignOut size={16} weight="duotone" aria-hidden="true" /></span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm"><span className="font-medium">{c.name}</span> <span className="ui-muted">· exit clearance to sign</span></span>
                  <span className="home-chips">{c.lines.map((l) => <span key={l.dept + l.label} className="home-chip">{l.label}</span>)}<span className="ui-caption">Last day <span className="tabular-nums">{shortDate(c.lastDay)}</span></span></span>
                </span>
                {c.late ? <span className="ui-pill ui-pill-neg">Past last day</span> : null}
                <CaretRight size={16} className="ui-subtle shrink-0" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {others.length ? (
        <ul className="people-list" aria-label="Other things to do">
          {others.map((t) => (
            <li key={t.key}>
              <button type="button" onClick={go(t.screen, t.params)} className="people-row people-row-action">
                <span className="people-row-count tabular-nums" data-tone={t.tone === 'info' ? undefined : 'warn'}>{t.count}</span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-sm">{t.title}</span>
                    <span className={`ui-pill ui-pill-${TONE[t.tone]?.pill || 'neutral'}`}>{TONE[t.tone]?.label}</span>
                  </span>
                  <span className="ui-caption block">{t.detail}</span>
                </span>
                <CaretRight size={16} className="ui-subtle shrink-0" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {loading ? <p className="people-empty">Loading…</p> : nothing ? (
        <p className="people-empty">{setupShowing ? 'Nothing waits for you yet. Start with the steps below.' : <><strong>All caught up</strong>. Nothing needs your answer right now.</>}</p>
      ) : null}
    </section>
  );
}
