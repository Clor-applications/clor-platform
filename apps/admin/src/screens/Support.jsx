import React, { useCallback, useEffect, useState } from 'react';
import { emoji } from '@ui/components/ui/emoji';
import { ArrowLeft, ArrowRight, ChevronRight, Plus, Send } from '@ui/components/ui/lineIcons';

import { getTicket, listTickets, openTicket, replyTicket, ticketSolved } from '@platform/admin/account';
import { lastErrorRef } from '@platform/http';
import { hasApp, requestOpenHelp } from '@platform/context';
import { INCLUDED_IN } from '@platform/includedApps';
import { Avatar, ICON, PageHead, WsDrawer, ago } from './wsKit';
import './workspace.css';
import './ws-security.css';
import { errorWords } from '@ui/utils/errorWords';

/* This page's colour icon, the one its menu item wears. */
const PAGE_ICON = emoji('red-question-mark');
const EMPTY_ICON = emoji('speech-balloon');

/**
 * Workspace → Help and support (Ops plan P1, customer tickets).
 *
 * Ask CLOR for help and follow the answer here. Everyone sees the tickets
 * they opened; the account's owners and administrators see every ticket the
 * account opened. CLOR answers from its own console and the person who asked
 * gets an email; replies show as "CLOR support".
 */

export const STATUS = {
  OPEN: { label: 'With CLOR', pill: 'ws-pill ws-pill--warn', tone: 'info' },
  WAITING: { label: 'Waiting for you', pill: 'ws-pill ws-pill--danger', tone: 'warn' },
  SOLVED: { label: 'Solved', pill: 'ws-pill ws-pill--ok', tone: 'ok' },
  CLOSED: { label: 'Closed', pill: 'ws-pill ws-pill--off', tone: 'off' },
};
const CATEGORY = [
  ['QUESTION', 'A question', 'How to do something'],
  ['PROBLEM', 'Something is not working', 'An error, a wrong figure, a page that will not load'],
  ['BILLING', 'Plan or billing', 'Your plan, an invoice, a payment'],
  ['DATA', 'My data', 'Importing, exporting, or a correction you cannot make yourself'],
  ['OTHER', 'Something else', ''],
];
const APP = [
  ['', 'Not about one app'],
  ['accounting', 'Books'],
  ['people', 'People'],
  ['attendance', 'Attendance'],
  ['payroll', 'Payroll'],
  ['workspace', 'Workspace'],
];
const APP_NAME = Object.fromEntries(APP.filter(([k]) => k));
/* Coloured tabs, as on the Inbox (owner, 19 Nov 2026). */
const SHOW = [
  { key: 'all', label: 'All', tone: '--cat-1' },
  { key: 'open', label: 'Open', tone: '--cat-2' },
  { key: 'done', label: 'Solved', tone: '--cat-3' },
];

const ticketFromUrl = () => {
  try {
    return new URLSearchParams(window.location.search).get('ticket');
  } catch {
    return null;
  }
};

export default function Support() {
  const [rows, setRows] = useState(null);
  const [whole, setWhole] = useState(false);
  const [error, setError] = useState('');
  const [openId, setOpenId] = useState(ticketFromUrl);
  const [asking, setAsking] = useState(false);
  const [show, setShow] = useState('all');

  const load = useCallback(() => {
    listTickets()
      .then((r) => {
        setRows(r?.tickets || []);
        setWhole(Boolean(r?.wholeAccount));
      })
      .catch((e) => setError(errorWords(e, 'load your tickets')));
  }, []);
  useEffect(load, [load]);

  if (openId) return <TicketView id={openId} onBack={() => { setOpenId(null); load(); }} />;

  const all = rows || [];
  const waiting = all.filter((t) => t.status === 'WAITING').length;
  const shown = all.filter((t) => show === 'all' || (show === 'open' ? t.status === 'OPEN' || t.status === 'WAITING' : t.status === 'SOLVED' || t.status === 'CLOSED'));
  const n = (k) => all.filter((t) => (k === 'open' ? t.status === 'OPEN' || t.status === 'WAITING' : k === 'done' ? t.status === 'SOLVED' || t.status === 'CLOSED' : true)).length;
  const byStatus = Object.keys(STATUS).map((k) => ({ k, n: all.filter((t) => t.status === k).length })).filter((x) => x.n);

  return (
    <div className="ws">
      <div className="ws-inner">
        <PageHead
          crumbs={['Home', 'Help and support']}
          icon={PAGE_ICON}
          title="Help and support"
          actions={
            <button type="button" className="ws-btn ws-btn--primary" onClick={() => setAsking(true)}>
              <Plus size={16} aria-hidden="true" /> New ticket
            </button>
          }
        />

        {waiting ? (
          <p role="status" className="ws-notice">
            CLOR replied to {waiting === 1 ? 'one ticket' : `${waiting} tickets`} and is waiting for you.
          </p>
        ) : null}
        {error ? <p role="alert" className="text-sm" style={{ color: 'rgb(var(--ws-danger))' }}>{error}</p> : null}

        {rows === null && !error ? (
          <div className="grid gap-3" aria-hidden="true">
            {[0, 1, 2].map((i) => <span key={i} className="ui-skel" style={{ height: 56, borderRadius: 12 }} />)}
          </div>
        ) : rows ? (
          <div className="ws-activity-layout">
            <div className="ws-activity-main">
              <div className="ws-tabs ws-tone-tabs" role="tablist" aria-label="Tickets">
                {SHOW.map((s) => (
                  <button key={s.key} type="button" role="tab" aria-selected={show === s.key} className="ws-tab" style={{ '--tab': `var(${s.tone})` }} onClick={() => setShow(s.key)}>
                    {s.label}
                    <span className="ws-tone-count">{n(s.key)}</span>
                  </button>
                ))}
              </div>
              {!shown.length ? (
                <div className="ws-inbox-empty">
                  <EMPTY_ICON size={28} aria-hidden="true" />
                  <div>
                    <p className="ws-inbox-empty-title">{all.length ? 'No tickets here.' : 'No tickets yet.'}</p>
                    <p className="ws-card-blurb">Ask a question and CLOR answers here and by email.</p>
                  </div>
                </div>
              ) : (
                <div className="ws-table-wrap">
                  <table className="ws-table ws-sec-table ws-activity-table ws-inbox-table ws-ticket-table">
                    <caption className="sr-only">Tickets</caption>
                    <colgroup>
                      <col className="ws-col-what" />
                      <col className="ws-col-who" />
                      <col className="ws-col-app" />
                      <col className="ws-col-when" />
                      <col className="ws-col-open" />
                    </colgroup>
                    <thead>
                      <tr>
                        <th scope="col">Ticket</th>
                        <th scope="col">{whole ? 'Opened by' : 'App'}</th>
                        <th scope="col" className="ws-mid">Status</th>
                        <th scope="col" className="ws-mid">Updated</th>
                        <th scope="col"><span className="sr-only">Open</span></th>
                      </tr>
                    </thead>
                    <tbody>
                      {shown.map((t) => (
                        <tr key={t.id}>
                          <td>
                            <strong style={{ fontWeight: 600 }}>{t.subject}</strong>
                            <div className="ws-card-blurb">
                              <span className="ui-num">{t.code}</span>
                              {t.app && whole ? ` · ${APP_NAME[t.app]}` : ''}
                            </div>
                          </td>
                          <td>
                            {whole ? (
                              t.openedBy ? <span className="ws-sec-who"><Avatar name={t.openedBy} /><span>{t.openedBy}</span></span> : '—'
                            ) : (t.app ? APP_NAME[t.app] : 'Not about one app')}
                          </td>
                          <td className="ws-mid"><span className="ws-state" data-tone={STATUS[t.status]?.tone}>{STATUS[t.status]?.label || t.status}</span></td>
                          <td className="ws-mid ws-sec-when">{ago(t.updatedAt)}</td>
                          <td className="num">
                            <button type="button" className="ws-row-link" onClick={() => setOpenId(t.id)} aria-label={`Open ${t.code} ${t.subject}`}>
                              Open <ArrowRight size={14} aria-hidden="true" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <aside className="ws-activity-side" aria-label="Support summary">
              <section className="ws-activity-box">
                <p className="ws-activity-box-title">Your tickets</p>
                <p className="ws-activity-big"><span className="ui-num">{all.length}</span> {all.length === 1 ? 'ticket' : 'tickets'}</p>
                <p className="ws-activity-sub">{n('open') ? `${n('open')} still open` : 'Nothing open'}</p>
                {byStatus.length ? (
                  <ul className="ws-activity-bars ws-activity-bars--wide" aria-label="By status">
                    {byStatus.map((x) => (
                      <li key={x.k} data-tone={x.k === 'WAITING' ? 'danger' : x.k === 'SOLVED' ? 'ok' : undefined}>
                        <span className="ws-activity-bar-label">{STATUS[x.k].label}</span>
                        <span className="ws-activity-bar"><span style={{ width: `${Math.max(6, Math.round((x.n / all.length) * 100))}%` }} /></span>
                        <span className="ws-activity-bar-n ui-num">{x.n}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </section>
              <section className="ws-activity-box">
                <p className="ws-activity-box-title">Before you ask</p>
                <p className="ws-side-note">Most answers are already in the help centre, with steps for every app.</p>
                <button type="button" className="ws-row-link" onClick={() => requestOpenHelp('welcome')}>
                  Open the help centre <ArrowRight size={14} aria-hidden="true" />
                </button>
              </section>
              <section className="ws-activity-box">
                <p className="ws-activity-box-title">How CLOR answers</p>
                <p className="ws-side-note">A person at CLOR replies, not a bot. You get an email, and the whole conversation stays here.</p>
              </section>
            </aside>
          </div>
        ) : null}
      </div>
      <NewTicket open={asking} onClose={() => setAsking(false)} onOpened={(t) => { setAsking(false); setOpenId(t.id); }} />
    </div>
  );
}

function NewTicket({ open, onClose, onOpened }) {
  const [form, setForm] = useState({ subject: '', body: '', category: 'QUESTION', app: '', requestId: '', urgent: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const lastCode = open ? lastErrorRef() : null;
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  const valid = form.subject.trim().length >= 4 && form.body.trim().length >= 10;

  const send = async (e) => {
    e.preventDefault();
    if (!valid || busy) return;
    setBusy(true);
    setError('');
    try {
      const t = await openTicket({ ...form, app: form.app || null, requestId: form.requestId.trim() || null });
      setForm({ subject: '', body: '', category: 'QUESTION', app: '', requestId: '', urgent: false });
      onOpened(t);
    } catch (err) {
      setError(errorWords(err, 'send the ticket'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <WsDrawer
      open={open}
      onClose={onClose}
      title="New ticket"
      description="CLOR support answers by email, usually within one working day."
      actions={
        <>
          <button type="button" className="ws-btn ws-btn--quiet" onClick={onClose}>Cancel</button>
          <button type="submit" form="ws-ticket" className="ws-btn ws-btn--primary" disabled={!valid || busy}>
            <Send size={16} aria-hidden="true" /> {busy ? 'Sending…' : 'Send to CLOR'}
          </button>
        </>
      }
    >
      <form id="ws-ticket" className="grid gap-5" onSubmit={send}>
        {error ? <p role="alert" className="text-sm" style={{ color: 'rgb(var(--ws-danger))' }}>{error}</p> : null}
        <div className="grid">
          <label htmlFor="ws-ticket-category" className="text-sm">What is it?</label>
          <select id="ws-ticket-category" className="ui-select" value={form.category} onChange={set('category')} aria-describedby="ws-ticket-category-help">
            {CATEGORY.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
          <span id="ws-ticket-category-help" className="ui-caption">{CATEGORY.find(([k]) => k === form.category)?.[2]}</span>
        </div>
        <div className="grid">
          <label htmlFor="ws-ticket-app" className="text-sm">Which app</label>
          <select id="ws-ticket-app" className="ui-select" value={form.app} onChange={set('app')}>
            {/* An app the company has inside another (Attendance, on People) is not a choice of its own. */}
            {APP.filter(([k]) => !(INCLUDED_IN[k] && hasApp(INCLUDED_IN[k]))).map(([k, l]) => <option key={k || 'none'} value={k}>{l}</option>)}
          </select>
        </div>
        <label className="grid">
          <span>Subject</span>
          <input className="ui-input" value={form.subject} onChange={set('subject')} maxLength={160} placeholder="Payslips show the wrong month" required />
        </label>
        <label className="grid">
          <span>What happened</span>
          <textarea className="ui-input" rows={6} value={form.body} onChange={set('body')} maxLength={8000} placeholder="What you did, what you expected, and what you saw instead." required />
        </label>
        <div className="grid">
          <label htmlFor="ws-ticket-code" className="text-sm">Error code (if you saw one)</label>
          <input id="ws-ticket-code" className="ui-input" value={form.requestId} onChange={set('requestId')} maxLength={80} spellCheck={false} aria-describedby="ws-ticket-code-help" />
          <span id="ws-ticket-code-help" className="ui-caption">
            It is under the error message. It lets CLOR find exactly what went wrong.
            {lastCode && !form.requestId ? (
              <>
                {' '}
                <button type="button" className="ws-link" onClick={() => setForm((f) => ({ ...f, requestId: lastCode }))}>
                  Use the code from the last error here
                </button>
              </>
            ) : null}
          </span>
        </div>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={form.urgent} onChange={set('urgent')} />
          <span>Urgent: work has stopped</span>
        </label>
      </form>
    </WsDrawer>
  );
}

function TicketView({ id, onBack }) {
  const [t, setT] = useState(null);
  const [error, setError] = useState('');
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getTicket(id).then(setT).catch((e) => setError(e.status === 404 ? 'This ticket is not yours to see, or no longer exists.' : errorWords(e, 'load the ticket')));
  }, [id]);

  const act = async (fn) => {
    setBusy(true);
    setError('');
    try {
      setT(await fn());
      setReply('');
    } catch (e) {
      setError(errorWords(e, 'send the reply'));
    } finally {
      setBusy(false);
    }
  };

  const closed = t?.status === 'CLOSED';
  return (
    <div className="ws">
      <div className="ws-inner">
        <header className="ws-head">
          <div style={{ minWidth: 0 }}>
            <div className="ws-crumbs-row">
              <button type="button" className="ws-back" onClick={onBack} aria-label="Back to tickets" title="Back">
                <ArrowLeft size={16} aria-hidden="true" />
              </button>
              <nav className="ws-crumbs" aria-label="Breadcrumb">
                <button type="button" className="ws-crumb-link" onClick={onBack}>Help and support</button>
                <ChevronRight size={14} aria-hidden="true" />
                <span aria-current="page">{t?.code || 'Ticket'}</span>
              </nav>
            </div>
            <h1 className="ws-title">{t?.subject || ' '}</h1>
            {t ? (
              <p className="ws-lede">
                <span className={STATUS[t.status]?.pill}>{STATUS[t.status]?.label}</span>{' '}
                {[t.app ? APP_NAME[t.app] : null, `opened by ${t.openedBy} ${ago(t.createdAt)}`, t.requestId ? `error code ${t.requestId}` : null].filter(Boolean).join(' · ')}
              </p>
            ) : null}
          </div>
          {t && (t.status === 'OPEN' || t.status === 'WAITING') ? (
            <button type="button" className="ws-btn ws-btn--quiet" disabled={busy} onClick={() => act(() => ticketSolved(t.id))}>
              It is solved
            </button>
          ) : null}
        </header>

        {error ? <p role="alert" className="text-sm" style={{ color: 'rgb(var(--ws-danger))' }}>{error}</p> : null}
        {!t && !error ? <span className="ui-skel" style={{ height: 120, borderRadius: 12 }} aria-hidden="true" /> : null}

        {t ? (
          <>
            <ol className="ws-thread" aria-label="Conversation">
              {t.messages.map((m) => (
                <li key={m.id} className={`ws-msg${m.fromStaff ? ' ws-msg--staff' : ''}`}>
                  <p className="ws-msg-head">
                    <strong>{m.author}</strong> <span>{ago(m.at)}</span>
                  </p>
                  <p className="ws-msg-body">{m.body}</p>
                </li>
              ))}
            </ol>
            {closed ? (
              <p className="ws-notice">This ticket is closed. If you need more help, open a new ticket and mention {t.code}.</p>
            ) : (
              <form
                className="grid gap-3"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (reply.trim()) act(() => replyTicket(t.id, reply.trim()));
                }}
              >
                <label className="grid">
                  <span>{t.status === 'SOLVED' ? 'Still not right? Reply and the ticket opens again' : 'Reply'}</span>
                  <textarea className="ui-input" rows={4} value={reply} onChange={(e) => setReply(e.target.value)} maxLength={8000} />
                </label>
                <div>
                  <button type="submit" className="ws-btn ws-btn--primary" disabled={!reply.trim() || busy}>
                    <Send size={16} aria-hidden="true" /> {busy ? 'Sending…' : 'Send reply'}
                  </button>
                </div>
              </form>
            )}
          </>
        ) : null}
      </div>
    </div>
  );
}
