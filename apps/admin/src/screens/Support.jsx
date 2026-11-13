import React, { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, ChevronRight, Plus, Send } from '@ui/components/ui/lineIcons';

import { getTicket, listTickets, openTicket, replyTicket, ticketSolved } from '@platform/admin/account';
import { lastErrorRef } from '@platform/http';
import { hasApp, requestOpenHelp } from '@platform/context';
import { INCLUDED_IN } from '@platform/includedApps';
import { ICON, PageHead, WsDrawer, ago } from './wsKit';
import './workspace.css';

/**
 * Workspace → Help and support (Ops plan P1, customer tickets).
 *
 * Ask CLOR for help and follow the answer here. Everyone sees the tickets
 * they opened; the account's owners and administrators see every ticket the
 * account opened. CLOR answers from its own console and the person who asked
 * gets an email; replies show as "CLOR support".
 */

export const STATUS = {
  OPEN: { label: 'With CLOR', pill: 'ws-pill ws-pill--warn' },
  WAITING: { label: 'Waiting for you', pill: 'ws-pill ws-pill--danger' },
  SOLVED: { label: 'Solved', pill: 'ws-pill ws-pill--ok' },
  CLOSED: { label: 'Closed', pill: 'ws-pill ws-pill--off' },
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

  const load = useCallback(() => {
    listTickets()
      .then((r) => {
        setRows(r?.tickets || []);
        setWhole(Boolean(r?.wholeAccount));
      })
      .catch((e) => setError(e.message || 'Could not load your tickets.'));
  }, []);
  useEffect(load, [load]);

  if (openId) return <TicketView id={openId} onBack={() => { setOpenId(null); load(); }} />;

  const waiting = (rows || []).filter((t) => t.status === 'WAITING').length;

  return (
    <div className="ws">
      <div className="ws-inner">
        <PageHead
          crumbs={['Overview', 'Help and support']}
          title="Help and support"
          description={whole ? 'Every question your account has asked CLOR, and the answers.' : 'Your questions to CLOR, and the answers.'}
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
        ) : rows && rows.length === 0 ? (
          <div className="ws-empty">
            <span className="ws-tile" aria-hidden="true"><ICON.chat size={20} /></span>
            <p>No tickets yet. If something is not working, or you cannot find how to do something, ask here and CLOR will answer by email.</p>
            <button type="button" className="ws-btn ws-btn--quiet" onClick={() => requestOpenHelp('welcome')}>Try the help centre first</button>
          </div>
        ) : rows ? (
          <ul className="ws-list ws-list--ground" aria-label="Tickets">
            {rows.map((t) => (
              <li key={t.id}>
                <button type="button" className="ws-item" onClick={() => setOpenId(t.id)}>
                  <span className="ws-item-text">
                    <span className="ws-item-title">
                      <span className="ui-num" style={{ color: 'rgb(var(--ws-muted))', marginRight: 8 }}>{t.code}</span>
                      {t.subject}
                    </span>
                    <span className="ws-item-sub">
                      {[t.app ? APP_NAME[t.app] : null, whole ? t.openedBy : null, `updated ${ago(t.updatedAt)}`].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                  <span className={STATUS[t.status]?.pill || 'ws-pill'}>{STATUS[t.status]?.label || t.status}</span>
                  <ChevronRight size={16} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
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
      setError(err.message || 'Could not send. Try again.');
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
    getTicket(id).then(setT).catch((e) => setError(e.status === 404 ? 'This ticket is not yours to see, or no longer exists.' : e.message || 'Could not load the ticket.'));
  }, [id]);

  const act = async (fn) => {
    setBusy(true);
    setError('');
    try {
      setT(await fn());
      setReply('');
    } catch (e) {
      setError(e.message || 'That did not work. Try again.');
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
