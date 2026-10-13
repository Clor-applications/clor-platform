import React, { useEffect, useMemo, useState } from 'react';
import { Check, Mail, RefreshCw, RotateCcw, Save, Send, Server } from 'lucide-react';

import {
  getEmailSettings,
  getNotifications,
  getOutbox,
  retryOutbox,
  saveEmailSettings,
  saveNotifications,
  sendTestEmail,
  testEmailConnection,
} from '../../api/email';
import { EmptyState, Spinner, StatusPill, SkeletonCard } from '@ui/components/ui/Primitives';
import SettingsScreenHeader from './SettingsScreenHeader';

const TABS = [
  { key: 'server', label: 'Mail server' },
  { key: 'notifications', label: 'Notifications' },
  { key: 'log', label: 'Delivery log' },
];

const emptySettings = {
  provider: 'SYSTEM',
  host: '',
  port: 587,
  secure: false,
  username: '',
  password: '',
  fromName: '',
  fromEmail: '',
  replyTo: '',
};

/** Email configuration, notification preferences, and what actually got sent. */
export const EmailSettings = () => {
  const [tab, setTab] = useState('server');

  const [settings, setSettings] = useState(emptySettings);
  const [baseline, setBaseline] = useState(emptySettings);
  const [hasPassword, setHasPassword] = useState(false);
  const [verifiedAt, setVerifiedAt] = useState(null);

  const [events, setEvents] = useState([]);
  const [eventBaseline, setEventBaseline] = useState([]);

  const [messages, setMessages] = useState([]);

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const load = () =>
    Promise.all([getEmailSettings(), getNotifications()]).then(([s, n]) => {
      const next = { ...emptySettings, ...(s?.settings || {}), password: '' };
      delete next.hasPassword;
      setSettings(next);
      setBaseline(next);
      setHasPassword(Boolean(s?.settings?.hasPassword));
      setVerifiedAt(s?.settings?.verifiedAt || null);
      setEvents(n?.events || []);
      setEventBaseline(n?.events || []);
    });

  useEffect(() => {
    let cancelled = false;
    Promise.resolve()
      .then(load)
      .catch((e) => !cancelled && setError(String(e?.message || e)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (tab !== 'log') return;
    Promise.resolve()
      .then(getOutbox)
      .then((d) => setMessages(d?.messages || []))
      .catch((e) => setError(String(e?.message || e)));
  }, [tab]);

  const serverDirty = useMemo(
    () => JSON.stringify(settings) !== JSON.stringify(baseline),
    [settings, baseline]
  );
  const eventsDirty = useMemo(
    () => JSON.stringify(events) !== JSON.stringify(eventBaseline),
    [events, eventBaseline]
  );

  const isSmtp = settings.provider === 'SMTP';
  const set = (patch) => setSettings((prev) => ({ ...prev, ...patch }));

  const run = async (key, fn, successNote) => {
    setBusy(key);
    setError('');
    setNotice('');
    try {
      const result = await fn();
      if (successNote) setNotice(typeof successNote === 'function' ? successNote(result) : successNote);
      return result;
    } catch (e) {
      setError(String(e?.message || e));
      return null;
    } finally {
      setBusy('');
    }
  };

  const payload = () => {
    const out = {
      provider: settings.provider,
      host: settings.host || null,
      port: settings.port ? Number(settings.port) : null,
      secure: Boolean(settings.secure),
      username: settings.username || null,
      fromName: settings.fromName || null,
      fromEmail: settings.fromEmail || null,
      replyTo: settings.replyTo || null,
    };
    // Only send the password when one was typed: omitting it keeps the stored value.
    if (settings.password) out.password = settings.password;
    return out;
  };

  if (loading) {
    return (
      <SkeletonCard lines={4} />
    );
  }

  return (
    <div className="space-y-6">
      <SettingsScreenHeader
        entity="settings"
        title="Email"
              actions={
          notice ? (
            <span className="ui-pill ui-pill-pos" role="status">
              <Check size={11} aria-hidden="true" /> {notice}
            </span>
          ) : null
        }
      />

      {error ? (
        <div
          className="ui-card p-3 text-sm"
          role="alert"
          style={{ borderColor: 'rgb(var(--neg))', color: 'rgb(var(--neg))' }}
        >
          {error}
        </div>
      ) : null}

      <div className="flex gap-1" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
            className={`ui-btn ${tab === t.key ? 'ui-btn-secondary' : 'ui-btn-ghost'}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'server' ? (
        <div className="ui-card p-4 space-y-4">
          <fieldset>
            <legend className="ui-label">Send using</legend>
            <div className="space-y-2">
              {[
                {
                  value: 'SYSTEM',
                  title: 'The platform mail server',
                  hint: 'Nothing to configure. Messages come from a shared sending address.',
                },
                {
                  value: 'SMTP',
                  title: 'Your own SMTP server',
                  hint: 'Messages come from your address, which is better for deliverability and trust.',
                },
              ].map((opt) => (
                <label key={opt.value} className="flex items-start gap-3 cursor-pointer">
                  <input
                    type="radio"
                    name="provider"
                    className="ui-checkbox mt-1"
                    checked={settings.provider === opt.value}
                    onChange={() => set({ provider: opt.value })}
                  />
                  <span>
                    <span className="ui-title text-sm block">{opt.title}</span>
                    <span className="ui-muted text-xs">{opt.hint}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>

          {isSmtp ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className="ui-label" htmlFor="smtp-host">
                  Host
                </label>
                <input
                  id="smtp-host"
                  className="ui-input"
                  value={settings.host || ''}
                  onChange={(e) => set({ host: e.target.value })}
                  placeholder="smtp.yourprovider.com"
                />
              </div>
              <div>
                <label className="ui-label" htmlFor="smtp-port">
                  Port
                </label>
                <input
                  id="smtp-port"
                  type="number"
                  className="ui-input"
                  value={settings.port ?? ''}
                  onChange={(e) => set({ port: e.target.value })}
                />
                <div className="ui-subtle text-xs mt-1">465 for TLS, 587 for STARTTLS.</div>
              </div>
              <div className="flex items-end">
                <label className="flex items-center gap-2 cursor-pointer pb-2">
                  <input
                    type="checkbox"
                    checked={Boolean(settings.secure)}
                    onChange={(e) => set({ secure: e.target.checked })}
                  />
                  <span className="text-sm">Use TLS on connect</span>
                </label>
              </div>
              <div>
                <label className="ui-label" htmlFor="smtp-user">
                  Username
                </label>
                <input
                  id="smtp-user"
                  className="ui-input"
                  value={settings.username || ''}
                  onChange={(e) => set({ username: e.target.value })}
                  autoComplete="off"
                />
              </div>
              <div>
                <label className="ui-label" htmlFor="smtp-pass">
                  Password
                </label>
                <input
                  id="smtp-pass"
                  type="password"
                  className="ui-input"
                  value={settings.password || ''}
                  onChange={(e) => set({ password: e.target.value })}
                  placeholder={hasPassword ? '•••••••• (unchanged)' : ''}
                  autoComplete="new-password"
                />
                <div className="ui-subtle text-xs mt-1">
                  {hasPassword
                    ? 'A password is stored. Leave blank to keep it.'
                    : 'Stored encrypted and never shown again.'}
                </div>
              </div>
              <div>
                <label className="ui-label" htmlFor="from-name">
                  From name
                </label>
                <input
                  id="from-name"
                  className="ui-input"
                  value={settings.fromName || ''}
                  onChange={(e) => set({ fromName: e.target.value })}
                  placeholder="Your company"
                />
              </div>
              <div>
                <label className="ui-label" htmlFor="from-email">
                  From address
                </label>
                <input
                  id="from-email"
                  type="email"
                  className="ui-input"
                  value={settings.fromEmail || ''}
                  onChange={(e) => set({ fromEmail: e.target.value })}
                  placeholder="billing@yourcompany.com"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="ui-label" htmlFor="reply-to">
                  Reply-to (optional)
                </label>
                <input
                  id="reply-to"
                  type="email"
                  className="ui-input"
                  value={settings.replyTo || ''}
                  onChange={(e) => set({ replyTo: e.target.value })}
                />
              </div>
            </div>
          ) : null}

          <div className="flex flex-wrap items-center gap-2 pt-1">
            <button
              type="button"
              className="ui-btn ui-btn-primary"
              disabled={!serverDirty || Boolean(busy)}
              onClick={() =>
                run(
                  'save',
                  async () => {
                    const res = await saveEmailSettings(payload());
                    await load();
                    return res;
                  },
                  'Settings saved'
                )
              }
            >
              {busy === 'save' ? <Spinner /> : <Save size={16} aria-hidden="true" />} Save
            </button>

            <button
              type="button"
              className="ui-btn ui-btn-secondary"
              disabled={!serverDirty || Boolean(busy)}
              onClick={() => setSettings(baseline)}
            >
              <RotateCcw size={16} aria-hidden="true" /> Revert
            </button>

            <button
              type="button"
              className="ui-btn ui-btn-secondary"
              disabled={Boolean(busy) || !isSmtp}
              onClick={() => run('test', () => testEmailConnection(payload()), 'Server answered')}
            >
              {busy === 'test' ? <Spinner /> : <Server size={16} aria-hidden="true" />} Test connection
            </button>

            <button
              type="button"
              className="ui-btn ui-btn-secondary"
              disabled={Boolean(busy)}
              onClick={() =>
                run('send', sendTestEmail, (r) =>
                  r?.ok ? `Test message sent to ${r.to}` : `Not delivered: ${r?.error || 'unknown error'}`
                )
              }
            >
              {busy === 'send' ? <Spinner /> : <Send size={16} aria-hidden="true" />} Send test email
            </button>

            {verifiedAt ? <span className="ui-pill ui-pill-pos">Connection verified</span> : null}
          </div>

          <p className="ui-subtle text-xs">
            Sign-in and password messages are always sent, whichever server is chosen. Only the notifications on the
            next tab can be switched off.
          </p>
        </div>
      ) : null}

      {tab === 'notifications' ? (
        <div className="ui-card overflow-hidden">
          {events.length === 0 ? (
            <EmptyState icon={Mail} title="No optional notifications" description="Nothing to configure yet." />
          ) : (
            <>
              {events.map((e, idx) => (
                <label
                  key={e.key}
                  className="flex items-start gap-3 px-4 py-3 cursor-pointer transition-colors hover:bg-[rgb(var(--surface-sunken))]"
                  style={idx ? { borderTop: '1px solid rgb(var(--border))' } : undefined}
                >
                  <input
                    type="checkbox"
                    className="ui-checkbox mt-1"
                    checked={Boolean(e.enabled)}
                    onChange={(ev) =>
                      setEvents((prev) =>
                        prev.map((x) => (x.key === e.key ? { ...x, enabled: ev.target.checked } : x))
                      )
                    }
                  />
                  <span className="min-w-0">
                    <span className="ui-title text-sm block">{e.label}</span>
                    <span className="ui-muted text-xs">{e.description}</span>
                  </span>
                </label>
              ))}

              <div
                className="px-4 py-3 flex items-center gap-2"
                style={{ borderTop: '1px solid rgb(var(--border))' }}
              >
                <button
                  type="button"
                  className="ui-btn ui-btn-primary"
                  disabled={!eventsDirty || Boolean(busy)}
                  onClick={() =>
                    run(
                      'notif',
                      async () => {
                        await saveNotifications(
                          events.map((e) => ({ eventKey: e.key, enabled: Boolean(e.enabled) }))
                        );
                        setEventBaseline(events);
                      },
                      'Notifications saved'
                    )
                  }
                >
                  {busy === 'notif' ? <Spinner /> : <Save size={16} aria-hidden="true" />} Save
                </button>
                {eventsDirty ? <span className="ui-pill ui-pill-warn">Unsaved changes</span> : null}
              </div>
            </>
          )}
        </div>
      ) : null}

      {tab === 'log' ? (
        <div className="ui-card overflow-hidden">
          <div
            className="px-4 py-3 flex items-center justify-between gap-2"
            style={{ borderBottom: '1px solid rgb(var(--border))' }}
          >
            <span className="ui-muted text-xs">The last 50 messages this company tried to send.</span>
            <div className="flex gap-2">
              <button
                type="button"
                className="ui-btn ui-btn-ghost"
                onClick={() => run('refresh', async () => setMessages((await getOutbox())?.messages || []))}
              >
                <RefreshCw size={16} aria-hidden="true" /> Refresh
              </button>
              <button
                type="button"
                className="ui-btn ui-btn-secondary"
                disabled={Boolean(busy)}
                onClick={() =>
                  run(
                    'retry',
                    async () => {
                      const r = await retryOutbox();
                      setMessages((await getOutbox())?.messages || []);
                      return r;
                    },
                    (r) => `Retried ${r?.retried ?? 0} message(s)`
                  )
                }
              >
                Retry failed
              </button>
            </div>
          </div>

          {messages.length === 0 ? (
            <EmptyState icon={Mail} title="Nothing sent yet" description="Messages will appear here once sent." />
          ) : (
            <div className="overflow-x-auto">
              <table className="ui-table ui-table-wide">
                <thead>
                  <tr>
                    <th scope="col">To</th>
                    <th scope="col">Subject</th>
                    <th scope="col">Type</th>
                    <th scope="col">Status</th>
                    <th scope="col" className="ui-num">Tries</th>
                    <th scope="col">When</th>
                  </tr>
                </thead>
                <tbody>
                  {messages.map((m) => (
                    <tr key={m.id}>
                      <td className="ui-col-entity">{m.toEmail}</td>
                      <td className="ui-col-meta">
                        {m.subject}
                        {m.lastError ? (
                          <div className="text-xs" style={{ color: 'rgb(var(--neg))' }}>
                            {m.lastError}
                          </div>
                        ) : null}
                      </td>
                      <td className="ui-col-meta ui-mono text-xs">{m.templateKey}</td>
                      <td>
                        <StatusPill status={m.status === 'SENT' ? 'Sent' : m.status === 'FAILED' ? 'Failed' : m.status} />
                      </td>
                      <td className="ui-col-amount">{m.attempts}</td>
                      <td className="ui-col-date">
                        {new Date(m.sentAt || m.createdAt).toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
};

export default EmailSettings;
