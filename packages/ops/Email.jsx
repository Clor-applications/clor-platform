import React, { useCallback, useEffect, useState } from 'react';
import { Search } from '@ui/components/ui/lineIcons';

import { notify } from '@ui/components/ui/notify';
import { PageHead, WsDrawer } from '../../apps/admin/src/screens/wsKit';
import { Empty, Err, Loading, Pager, ReasonDrawer, may, when } from './kit';
import {
  opsEmailLog,
  opsEmailSenders,
  opsEmailTemplates,
  opsPreviewTemplate,
  opsResendEmail,
  opsResetTemplate,
  opsSaveSender,
  opsSaveTemplate,
  opsTestSender,
  opsTestTemplate,
} from './api';

/**
 * Email on the operator console (server: routes/opsEmail.ts): the addresses
 * CLOR's own mail goes out from, the wording of every email the product
 * sends, and the log of every message with a plain reason when one failed.
 */

/** A test's result as a toast: green when it went, the plain reason when not. */
const testToast = (r) => (r.sent ? notify.success(r.message) : notify.error(r.message));

/* ------------------------------------------------------------- addresses */
export function EmailAddresses({ role }) {
  const [d, setD] = useState(null);
  const [error, setError] = useState('');
  const [edit, setEdit] = useState(null);
  const [form, setForm] = useState({ name: '', email: '', replyTo: '' });
  const [testing, setTesting] = useState('');
  const load = useCallback(() => {
    opsEmailSenders()
      .then((r) => (setD(r), setError('')))
      .catch((e) => setError(String(e?.message || e)));
  }, []);
  useEffect(load, [load]);
  const owner = role === 'SUPER_ADMIN';
  const canTest = may(role, 'SALES', 'SUPPORT', 'BILLING');

  const open = (s) => {
    setForm({ name: s.name || 'CLOR', email: s.email || `${s.purpose}@clor.in`, replyTo: s.replyTo || '' });
    setEdit(s);
  };
  const save = async (reason) => {
    await opsSaveSender(edit.purpose, { ...form, reason });
    notify.success(`${edit.label} mail now goes from ${form.email}.`);
    setEdit(null);
    load();
  };
  const test = async (s) => {
    setTesting(s.purpose);
    try {
      testToast(await opsTestSender(s.purpose));
    } catch (e) {
      notify.error(String(e?.message || e));
    } finally {
      setTesting('');
    }
  };

  return (
    <>
      <PageHead crumbs={['Email']} title="Addresses" />
      <Err>{error}</Err>
      {d && !d.sending ? (
        <p className="ws-notice" role="status">This server has no mail server set up, so messages are recorded in the log but not delivered. Engineering sets that up.</p>
      ) : null}
      {!d ? (
        error ? null : <Loading />
      ) : (
        <div className="ws-table-wrap">
          <table className="ws-table">
            <caption className="sr-only">Sender addresses</caption>
            <thead>
              <tr>
                <th>Address</th>
                <th>Goes out as</th>
                <th className="hidden md:table-cell">Replies go to</th>
                <th><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {d.senders.map((s) => (
                <tr key={s.purpose}>
                  <td>
                    <strong style={{ fontWeight: 600 }}>{s.label}</strong>
                    <div className="ws-item-sub">{s.uses}</div>
                  </td>
                  <td style={{ whiteSpace: 'normal' }}>
                    {s.set ? (
                      <>
                        {s.name} <span className="ws-item-sub">&lt;{s.email}&gt;</span>
                      </>
                    ) : (
                      <span className="ws-item-sub">Not set. Uses the server’s address, {d.serverFrom}</span>
                    )}
                  </td>
                  <td className="hidden md:table-cell">{s.replyTo || '—'}</td>
                  <td className="num">
                    <div className="flex flex-wrap justify-end gap-1">
                      {owner ? <button type="button" className="ws-btn ws-btn--quiet ws-btn--small" onClick={() => open(s)}>Edit</button> : null}
                      {canTest ? (
                        <button type="button" className="ws-btn ws-btn--quiet ws-btn--small" disabled={testing === s.purpose} onClick={() => test(s)}>
                          {testing === s.purpose ? 'Sending…' : 'Send test'}
                        </button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {canTest ? <p className="ws-card-blurb">Send test mails one message from that address to your own inbox.</p> : null}
      <ReasonDrawer
        open={Boolean(edit)}
        title={edit ? `${edit.label} address` : ''}
        what={edit ? `Used for: ${edit.uses.toLowerCase()}. The address must be one the mail service is allowed to send from; Send test checks it.` : ''}
        confirmLabel="Save address"
        ready={form.name.trim().length > 0 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())}
        onClose={() => setEdit(null)}
        onConfirm={save}
      >
        <label className="grid gap-1">
          <span className="text-sm font-medium">Name people see</span>
          <input className="ui-input" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
        </label>
        <label className="grid gap-1">
          <span className="text-sm font-medium">Email address</span>
          <input className="ui-input" type="email" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
        </label>
        <label className="grid gap-1">
          <span className="text-sm font-medium">Replies go to</span>
          <input className="ui-input" type="email" value={form.replyTo} placeholder="The same address" onChange={(e) => setForm((f) => ({ ...f, replyTo: e.target.value }))} />
        </label>
      </ReasonDrawer>
    </>
  );
}

/* ------------------------------------------------------------- templates */
const SENDER_WORDS = { sales: 'Sales', support: 'Support', billing: 'Billing', 'no-reply': 'No-reply' };

export function EmailTemplates({ role }) {
  const [d, setD] = useState(null);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(null);
  const load = useCallback(() => {
    opsEmailTemplates()
      .then((r) => (setD(r), setError('')))
      .catch((e) => setError(String(e?.message || e)));
  }, []);
  useEffect(load, [load]);
  const list = (d?.templates || []).filter((t) => !q || `${t.label} ${t.description}`.toLowerCase().includes(q.toLowerCase()));
  return (
    <>
      <PageHead crumbs={['Email']} title="Templates" meta={d ? `${d.templates.length} emails · ${d.templates.filter((t) => t.changed).length} reworded` : null} />
      <label className="relative" style={{ maxWidth: 460 }}>
        <span className="sr-only">Search emails</span>
        <Search size={16} aria-hidden="true" className="absolute left-3 top-1/2 -translate-y-1/2 ui-muted" />
        <input className="ui-input" style={{ paddingLeft: '2.25rem' }} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find an email" />
      </label>
      <Err>{error}</Err>
      {!d ? (
        error ? null : <Loading />
      ) : list.length === 0 ? (
        <Empty>No email matches.</Empty>
      ) : (
        <ul className="ws-list">
          {list.map((t) => (
            <li key={t.key}>
              <div className="ws-item">
                <span className="ws-item-text">
                  <button type="button" className="ws-name-link" style={{ textAlign: 'left' }} onClick={() => setOpen(t)}>{t.label}</button>
                  <span className="ws-item-sub">{t.description}</span>
                  <span className="ws-item-sub">From {SENDER_WORDS[t.sender]} · {t.changed ? `reworded ${when(t.changedAt)}` : 'default wording'}</span>
                </span>
                {t.changed ? <span className="ws-pill ws-pill--warn">Reworded</span> : null}
              </div>
            </li>
          ))}
        </ul>
      )}
      <TemplateEditor template={open} role={role} onClose={() => setOpen(null)} onSaved={() => { setOpen(null); load(); }} />
    </>
  );
}

function TemplateEditor({ template: t, role, onClose, onSaved }) {
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState('');
  const [confirm, setConfirm] = useState(null); // 'save' | 'reset'
  const [testing, setTesting] = useState(false);
  useEffect(() => {
    if (t) {
      setSubject(t.subject);
      setBody(t.body);
      setPreview(null);
      setError('');
    }
  }, [t]);
  const owner = role === 'SUPER_ADMIN';
  const dirty = t && (subject !== t.subject || body !== t.body);

  const showPreview = async () => {
    setError('');
    try {
      setPreview(await opsPreviewTemplate(t.key, { subject, body }));
    } catch (e) {
      setError(String(e?.message || e));
    }
  };
  const test = async () => {
    setTesting(true);
    try {
      testToast(await opsTestTemplate(t.key));
    } catch (e) {
      notify.error(String(e?.message || e));
    } finally {
      setTesting(false);
    }
  };
  const run = async (reason) => {
    if (confirm === 'save') {
      await opsSaveTemplate(t.key, { subject, body, reason });
      notify.success(`${t.label}: new wording saved. The next one sent uses it.`);
    } else {
      await opsResetTemplate(t.key, reason);
      notify.success(`${t.label} is back to the default wording.`);
    }
    setConfirm(null);
    onSaved();
  };

  return (
    <>
      <WsDrawer
        open={Boolean(t) && !confirm}
        onClose={onClose}
        title={t?.label || ''}
        widthClass="w-[min(48rem,96vw)]"
        actions={
          <>
            {owner && t?.changed ? <button type="button" className="ws-btn ws-btn--quiet" onClick={() => setConfirm('reset')}>Reset to default</button> : null}
            <button type="button" className="ws-btn ws-btn--quiet" onClick={showPreview}>Preview</button>
            {may(role, 'SALES', 'SUPPORT', 'BILLING') ? (
              <button type="button" className="ws-btn ws-btn--quiet" disabled={testing || dirty} title={dirty ? 'Save first: a test sends the saved wording' : undefined} onClick={test}>
                {testing ? 'Sending…' : 'Send test'}
              </button>
            ) : null}
            {owner ? <button type="button" className="ws-btn ws-btn--primary" disabled={!dirty || !subject.trim() || !body.trim()} onClick={() => setConfirm('save')}>Save wording</button> : null}
          </>
        }
      >
        {t ? (
          <div className="grid gap-5">
            <p className="ws-card-blurb">{t.description}</p>
            <label className="grid gap-1">
              <span className="text-sm font-medium">Subject</span>
              <input className="ui-input" value={subject} readOnly={!owner} onChange={(e) => { setSubject(e.target.value); setPreview(null); }} />
            </label>
            <label className="grid gap-1">
              <span className="text-sm font-medium">Message</span>
              <textarea className="ui-input" rows={12} value={body} readOnly={!owner} onChange={(e) => { setBody(e.target.value); setPreview(null); }} style={{ fontFamily: 'inherit', lineHeight: 1.5 }} />
            </label>
            <div className="grid gap-2">
              <span className="text-sm font-medium">Placeholders this email can fill</span>
              <div className="flex flex-wrap gap-1">
                {t.fields.map((f) => (
                  <span key={f} className="ws-pill">{`{{${f}}}`}</span>
                ))}
              </div>
              <span className="ws-card-blurb">Each is replaced with the real value when the email is sent. Plain text only.</span>
            </div>
            <Err>{error}</Err>
            {preview ? (
              <section aria-label="Preview" className="grid gap-2" style={{ borderTop: '1px solid rgb(var(--ws-line))', paddingTop: 16 }}>
                <span className="text-sm font-medium">Preview, with example values</span>
                {preview.unknown?.length ? <Err>{`This email cannot fill ${preview.unknown.map((u) => `{{${u}}}`).join(', ')}; it would show as a blank.`}</Err> : null}
                <strong style={{ fontWeight: 600 }}>{preview.subject}</strong>
                <p style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{preview.body}</p>
              </section>
            ) : null}
            {!owner ? <p className="ws-card-blurb">Only the owner changes the wording.</p> : null}
          </div>
        ) : null}
      </WsDrawer>
      <ReasonDrawer
        open={Boolean(confirm)}
        title={confirm === 'reset' ? 'Reset to the default wording' : 'Save the new wording'}
        what={confirm === 'reset' ? `${t?.label} goes back to CLOR’s built-in wording. Your changes are kept in the audit log only.` : `Every ${t?.label?.toLowerCase()} email sent from now on uses this wording.`}
        confirmLabel={confirm === 'reset' ? 'Reset' : 'Save wording'}
        onClose={() => setConfirm(null)}
        onConfirm={run}
      />
    </>
  );
}

/* --------------------------------------------------------------------- log */
const MAIL_STATUS = { SENT: 'Sent', FAILED: 'Failed', QUEUED: 'Waiting', SUPPRESSED: 'Not sent' };
const mailTone = (s) => (s === 'SENT' ? 'ws-pill ws-pill--ok' : s === 'FAILED' ? 'ws-pill ws-pill--danger' : s === 'QUEUED' ? 'ws-pill ws-pill--warn' : 'ws-pill ws-pill--off');

export function EmailLog({ role, initialStatus = 'all', openCustomer }) {
  const [view, setView] = useState({ status: initialStatus, q: '', page: 0 });
  const [d, setD] = useState(null);
  const [error, setError] = useState('');
  const [resend, setResend] = useState(null);
  const load = useCallback(() => {
    opsEmailLog(view)
      .then((r) => (setD(r), setError('')))
      .catch((e) => setError(String(e?.message || e)));
  }, [view]);
  useEffect(() => {
    const t = setTimeout(load, 200);
    return () => clearTimeout(t);
  }, [load]);
  const canResend = may(role, 'SUPPORT', 'BILLING');
  const pages = d ? Math.max(1, Math.ceil(d.total / d.pageSize)) : 1;

  const run = async (reason) => {
    const r = await opsResendEmail(resend.id, reason);
    if (r.sent) notify.success(r.message);
    else notify.error(r.message);
    setResend(null);
    load();
  };

  return (
    <>
      <PageHead crumbs={['Email']} title="Log" meta={d ? `${d.total} ${d.total === 1 ? 'message' : 'messages'}${d.failedThisWeek ? ` · ${d.failedThisWeek} failed this week` : ''}` : null} />
      <div className="flex flex-wrap gap-2 items-center" role="search">
        <label className="relative flex-1 min-w-[14rem]" style={{ maxWidth: 460 }}>
          <span className="sr-only">Search the log</span>
          <Search size={16} aria-hidden="true" className="absolute left-3 top-1/2 -translate-y-1/2 ui-muted" />
          <input className="ui-input" style={{ paddingLeft: '2.25rem' }} value={view.q} onChange={(e) => setView((v) => ({ ...v, q: e.target.value, page: 0 }))} placeholder="Address or subject" />
        </label>
        <select className="ui-select" style={{ width: 'auto' }} aria-label="Status" value={view.status} onChange={(e) => setView((v) => ({ ...v, status: e.target.value, page: 0 }))}>
          <option value="all">Every status</option>
          <option value="FAILED">Failed</option>
          <option value="SENT">Sent</option>
          <option value="QUEUED">Waiting</option>
          <option value="SUPPRESSED">Not sent on purpose</option>
        </select>
      </div>
      <Err>{error}</Err>
      {!d ? (
        error ? null : <Loading />
      ) : d.messages.length === 0 ? (
        <Empty>{view.status === 'FAILED' ? 'No failed emails.' : 'No messages match.'}</Empty>
      ) : (
        <div className="ws-table-wrap">
          <table className="ws-table">
            <caption className="sr-only">Every email the product tried to send, newest first</caption>
            <thead>
              <tr>
                <th>When</th>
                <th>To</th>
                <th className="hidden md:table-cell">Email</th>
                <th>Status</th>
                <th className="hidden sm:table-cell">Why</th>
                {canResend ? <th><span className="sr-only">Actions</span></th> : null}
              </tr>
            </thead>
            <tbody>
              {d.messages.map((m) => (
                <tr key={m.id}>
                  <td className="tabular-nums">{when(m.at)}</td>
                  <td style={{ whiteSpace: 'normal', overflowWrap: 'anywhere', minWidth: 160 }}>
                    {m.to}
                    {m.accountName ? (
                      <div className="ws-item-sub">
                        <button type="button" className="ws-name-link" onClick={() => openCustomer(m.accountId)}>{m.accountName}</button>
                      </div>
                    ) : null}
                  </td>
                  <td className="hidden md:table-cell" style={{ whiteSpace: 'normal' }}>
                    {m.templateLabel}
                    <div className="ws-item-sub">{m.subject}</div>
                  </td>
                  <td><span className={mailTone(m.status)}>{MAIL_STATUS[m.status] || m.status}</span></td>
                  <td className="hidden sm:table-cell" style={{ whiteSpace: 'normal', maxWidth: 360 }}>{m.reason || '—'}</td>
                  {canResend ? (
                    <td className="num">
                      {m.status === 'FAILED' || m.status === 'QUEUED' ? (
                        <button type="button" className="ws-btn ws-btn--quiet ws-btn--small" onClick={() => setResend(m)}>Resend</button>
                      ) : null}
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pager page={view.page} pages={pages} onPage={(page) => setView((v) => ({ ...v, page }))} />
      <ReasonDrawer
        open={Boolean(resend)}
        title="Resend this email"
        what={resend ? `“${resend.subject}” goes to ${resend.to} again, exactly as it was.${resend.reason ? ` Last time: ${resend.reason}` : ''}` : ''}
        confirmLabel="Resend"
        onClose={() => setResend(null)}
        onConfirm={run}
      />
    </>
  );
}
