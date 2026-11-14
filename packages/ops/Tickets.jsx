import React, { useCallback, useEffect, useState } from 'react';

import { PageHead, Panel, ago } from '../../apps/admin/src/screens/wsKit';
import { APP_NAMES, Err, Loading, Tabs, may, when } from './kit';
import { opsTicket, opsTicketChange, opsTicketReply, opsTickets } from './api';
import { SavedReplyPicker } from './SavedReplies';

/**
 * Customer tickets (operator console, Ops plan P1). Everyone on the console
 * reads them; Support answers, decides the priority and takes a ticket. A
 * reply goes to the customer by email and shows to them as "CLOR support";
 * an internal note is for CLOR only. The list puts the longest-waiting
 * active ticket first.
 */
export const STATUS = {
  OPEN: ['Needs an answer', 'ws-pill--warn'],
  WAITING: ['Waiting on customer', 'ws-pill'],
  SOLVED: ['Solved', 'ws-pill--ok'],
  CLOSED: ['Closed', 'ws-pill--off'],
};
const PRIORITY = { NORMAL: ['Normal', 'ws-pill'], HIGH: ['High', 'ws-pill--warn'], URGENT: ['Urgent', 'ws-pill--danger'] };
const CATEGORY = { QUESTION: 'Question', PROBLEM: 'Problem', BILLING: 'Plan or billing', DATA: 'Data', OTHER: 'Other' };
const appName = (a) => (a === 'workspace' ? 'Workspace' : APP_NAMES[a] || a);

export function Tickets({ initialStatus = 'active', openTicket, me }) {
  const [status, setStatus] = useState(initialStatus);
  const [d, setD] = useState(null);
  const [q, setQ] = useState('');
  const [error, setError] = useState('');
  const load = useCallback(() => {
    const params = status === 'mine' ? { status: 'active', mine: '1' } : { status };
    opsTickets({ ...params, q: q.trim() || undefined })
      .then(setD)
      .catch((e) => setError(String(e?.message || e)));
  }, [status, q]);
  useEffect(() => {
    const t = setTimeout(load, q ? 250 : 0);
    return () => clearTimeout(t);
  }, [load, q]);

  return (
    <div className="ws">
      <div className="ws-inner">
        <PageHead
          crumbs={['Customers', 'Tickets']}
          title="Tickets"
          description="Questions and problems customers sent from their Workspace. The one waiting longest is at the top."
          meta={d ? `${d.counts.open} need an answer · ${d.counts.waiting} waiting on customers` : null}
        />
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Tabs
            label="Which tickets"
            value={status}
            onChange={(k) => { setD(null); setStatus(k); }}
            tabs={[
              ['active', 'Active'],
              ['mine', `Mine${d?.counts?.mine ? ` (${d.counts.mine})` : ''}`],
              ['SOLVED', 'Solved'],
              ['CLOSED', 'Closed'],
            ]}
          />
          <input className="ui-input" style={{ maxWidth: 280 }} type="search" aria-label="Find a ticket" placeholder="T-1042 or words in the subject" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <Err>{error}</Err>
        {!d && !error ? (
          <Loading />
        ) : d && d.tickets.length === 0 ? (
          <div className="ws-empty">
            <p>{status === 'active' ? 'No customer is waiting on CLOR. Nice.' : status === 'mine' ? 'You have no active tickets.' : 'Nothing here.'}</p>
          </div>
        ) : d ? (
          <div className="ws-table-wrap">
            <table className="ws-table">
              <caption className="sr-only">Tickets</caption>
              <thead>
                <tr>
                  <th>Ticket</th>
                  <th>Customer</th>
                  <th>Status</th>
                  <th>Priority</th>
                  <th>Owner</th>
                  <th className="num">Last change</th>
                </tr>
              </thead>
              <tbody>
                {d.tickets.map((t) => (
                  <tr key={t.id} className="ws-row-link" onClick={() => openTicket(t.id)}>
                    <td>
                      <button type="button" className="ws-link" onClick={(e) => { e.stopPropagation(); openTicket(t.id); }}>
                        <span className="ui-num">{t.code}</span>
                      </button>{' '}
                      <strong style={{ fontWeight: 600 }}>{t.subject}</strong>
                      <div className="ws-item-sub">{[CATEGORY[t.category], t.app ? appName(t.app) : null].filter(Boolean).join(' · ')}</div>
                    </td>
                    <td>{t.account.name}<div className="ws-item-sub">{t.openedBy.name}</div></td>
                    <td><span className={`ws-pill ${STATUS[t.status]?.[1] || ''}`}>{STATUS[t.status]?.[0] || t.status}</span></td>
                    <td><span className={`ws-pill ${PRIORITY[t.priority]?.[1] || ''}`}>{PRIORITY[t.priority]?.[0]}</span></td>
                    <td>{t.assignedTo ? (t.assignedTo.id === me?.user?.id ? 'You' : t.assignedTo.name) : <span className="ws-item-sub">Nobody yet</span>}</td>
                    <td className="num">{ago(t.updatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function TicketPage({ id, back, openCustomer, lookUp, me }) {
  const [t, setT] = useState(null);
  const [error, setError] = useState('');
  const [body, setBody] = useState('');
  const [savedReplyId, setSavedReplyId] = useState('');
  const [internal, setInternal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const canAct = may(me?.role, 'SUPPORT');

  useEffect(() => {
    opsTicket(id).then(setT).catch((e) => setError(String(e?.message || e)));
  }, [id]);

  const run = async (fn, said) => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const r = await fn();
      setT(r.ticket || r);
      if (said) setNotice(typeof said === 'function' ? said(r) : said);
    } catch (e) {
      setError(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  };
  const send = (solve) =>
    run(async () => {
      const r = await opsTicketReply(id, { body: body.trim(), internal, solve, ...(savedReplyId && !internal ? { savedReplyId } : {}) });
      setBody('');
      setSavedReplyId('');
      return r;
    }, internal ? 'Note added. The customer does not see it.' : (r) => (r.told ? 'Sent. The customer has it by email.' : 'Saved on the ticket. The email did not go; the customer sees it in their Workspace.'));

  if (!t) return <div className="ws"><div className="ws-inner">{error ? <Err>{error}</Err> : <Loading />}</div></div>;
  const mineNow = t.assignedTo?.id === me?.user?.id;

  return (
    <div className="ws">
      <div className="ws-inner">
        <PageHead
          crumbs={['Customers', 'Tickets', t.code]}
          title={t.subject}
          description={`${CATEGORY[t.category]}${t.app ? ` · ${appName(t.app)}` : ''} · opened ${when(t.createdAt)}`}
          actions={
            <button type="button" className="ws-btn ws-btn--quiet" onClick={back}>All tickets</button>
          }
        />
        {notice ? <p role="status" className="ws-notice">{notice}</p> : null}
        <Err>{error}</Err>
        <div className="ws-layout">
          <div className="ws-main">
            <ol className="ws-thread" aria-label="Conversation">
              {t.messages.map((m) => (
                <li key={m.id} className={`ws-msg${m.fromStaff ? ' ws-msg--staff' : ''}${m.internal ? ' ws-msg--note' : ''}`}>
                  <p className="ws-msg-head">
                    <strong>{m.author}</strong> <span>{m.internal ? 'internal note · ' : ''}{when(m.at)}</span>
                  </p>
                  <p className="ws-msg-body">{m.body}</p>
                </li>
              ))}
            </ol>
            {canAct ? (
              <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); if (body.trim()) send(false); }}>
                {!internal ? (
                  <SavedReplyPicker
                    ticketId={id}
                    onPick={(r) => {
                      setBody(r.filled || r.body);
                      setSavedReplyId(r.id);
                    }}
                  />
                ) : null}
                <label className="grid">
                  <span>{internal ? 'Internal note (CLOR only)' : `Reply to ${t.openedBy.name}`}</span>
                  <textarea className="ui-input" rows={5} value={body} onChange={(e) => setBody(e.target.value)} maxLength={8000} />
                </label>
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={internal} onChange={(e) => setInternal(e.target.checked)} />
                  <span>Internal note: the customer does not see it</span>
                </label>
                <div className="flex flex-wrap gap-2">
                  <button type="submit" className="ws-btn ws-btn--primary" disabled={!body.trim() || busy || (t.status === 'CLOSED' && !internal)}>
                    {internal ? 'Add note' : 'Send reply'}
                  </button>
                  {!internal ? (
                    <button type="button" className="ws-btn ws-btn--quiet" disabled={!body.trim() || busy || t.status === 'CLOSED'} onClick={() => send(true)}>
                      Send and mark solved
                    </button>
                  ) : null}
                </div>
              </form>
            ) : (
              <p className="ws-item-sub">Only Support staff answer tickets.</p>
            )}
          </div>
          <aside className="ws-side" aria-label="Ticket details">
            <Panel title="Ticket">
              <dl className="ws-rows">
                <div><dt>Status</dt><dd><span className={`ws-pill ${STATUS[t.status]?.[1] || ''}`}>{STATUS[t.status]?.[0]}</span></dd></div>
                <div><dt>Priority</dt><dd><span className={`ws-pill ${PRIORITY[t.priority]?.[1] || ''}`}>{PRIORITY[t.priority]?.[0]}</span></dd></div>
                <div><dt>Owner</dt><dd>{t.assignedTo ? (mineNow ? 'You' : t.assignedTo.name) : 'Nobody yet'}</dd></div>
                {t.requestId ? <div><dt>Error code</dt><dd className="ui-num">{t.requestId}</dd></div> : null}
              </dl>
              {t.requestId ? (
                <button type="button" className="ws-link" onClick={() => lookUp(t.requestId)}>Look up this error code</button>
              ) : null}
              {canAct ? (
                <div className="grid gap-3" style={{ marginTop: 8 }}>
                  <div className="grid">
                    <label htmlFor="tk-priority" className="text-sm">Priority</label>
                    <select id="tk-priority" className="ui-select" value={t.priority} disabled={busy} onChange={(e) => run(() => opsTicketChange(id, { priority: e.target.value }), 'Priority changed.')}>
                      {Object.entries(PRIORITY).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}
                    </select>
                  </div>
                  <div className="grid">
                    <label htmlFor="tk-status" className="text-sm">Status</label>
                    <select id="tk-status" className="ui-select" value={t.status} disabled={busy} onChange={(e) => run(() => opsTicketChange(id, { status: e.target.value }), 'Status changed.')}>
                      {Object.entries(STATUS).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}
                    </select>
                  </div>
                  <button type="button" className="ws-btn ws-btn--quiet" disabled={busy} onClick={() => run(() => opsTicketChange(id, { assignedOperatorId: mineNow ? null : me.user.id }), mineNow ? 'You let it go.' : 'It is yours now.')}>
                    {mineNow ? 'Let it go' : 'Take it'}
                  </button>
                </div>
              ) : null}
            </Panel>
            <Panel title="Customer">
              <dl className="ws-rows">
                <div><dt>Account</dt><dd><button type="button" className="ws-link" onClick={() => openCustomer(t.account.id)}>{t.account.name}</button></dd></div>
                <div><dt>Asked by</dt><dd>{t.openedBy.name}</dd></div>
                {t.openedBy.email ? <div><dt>Email</dt><dd style={{ overflowWrap: 'anywhere' }}>{t.openedBy.email}</dd></div> : null}
                {t.openedBy.phone ? <div><dt>Phone</dt><dd className="ui-num">{t.openedBy.phone}</dd></div> : null}
              </dl>
            </Panel>
          </aside>
        </div>
      </div>
    </div>
  );
}
