import React, { useEffect, useMemo, useState } from 'react';
import { ArrowRight } from '@ui/components/ui/lineIcons';

import { orgId } from '@platform/context';
import { apiFetch } from '@platform/http';
import { ICON, PageHead, ago, productIcon } from './wsKit';
import './workspace.css';

/**
 * Inbox (Workspace plan P1): everything waiting on you in every app of this
 * company, in one list, oldest first, and your latest updates beside it.
 *
 * Workspace points, the app decides: each row opens the screen that owns it,
 * where its own rules (two people, an authenticator code) still apply.
 * The server sends only what this person may decide (services/workspace/inbox.ts).
 */
const getInbox = () => apiFetch(`/orgs/${encodeURIComponent(orgId())}/workspace/inbox`, { skipWarehouseHeader: true });

const APP_NAME = { accounting: 'Books', payroll: 'Payroll', people: 'People', attendance: 'Attendance', admin: 'Workspace' };

const TABS = [
  { key: 'decide', label: 'To decide', empty: 'Nothing waits for your decision.' },
  { key: 'task', label: 'Your tasks', empty: 'No tasks on your name.' },
  { key: 'updates', label: 'Updates', empty: 'No updates in the last 30 days.' },
];

function AppName({ app }) {
  const icon = productIcon(app);
  return (
    <span className="inline-flex items-center gap-2">
      {icon ? React.createElement(icon, { size: 16, 'aria-hidden': true }) : null}
      {APP_NAME[app] || app}
    </span>
  );
}

export default function Inbox({ openApp, openScreen }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('decide');
  const [app, setApp] = useState('all');

  useEffect(() => {
    let live = true;
    getInbox()
      .then((r) => live && setData(r || { rows: [], updates: [], unanswered: [] }))
      .catch((e) => live && setError(e?.message || 'The inbox could not be loaded. Try again in a minute.'));
    return () => { live = false; };
  }, []);

  const all = useMemo(() => {
    if (!data) return null;
    if (tab === 'updates') return data.updates.map((u) => ({ ...u, key: u.id }));
    return data.rows.filter((r) => r.kind === tab);
  }, [data, tab]);
  const apps = useMemo(() => [...new Set((all || []).map((r) => r.app))], [all]);
  const rows = (all || []).filter((r) => app === 'all' || r.app === app);
  const count = (k) => (data ? (k === 'updates' ? data.updates.filter((u) => !u.read).length : data.rows.filter((r) => r.kind === k).length) : 0);
  const open = (o) => {
    if (!o) return;
    if (o.app === 'admin') openScreen?.(o.screen, o.params || {});
    else openApp?.(o.app, o.screen, o.params || {});
  };
  const empty = TABS.find((t) => t.key === tab)?.empty;
  const missing = (data?.unanswered || []).map((a) => (a === 'updates' ? 'your updates' : APP_NAME[a] || a));

  return (
    <div className="ws">
      <div className="ws-inner">
        <PageHead
          crumbs={['Overview', 'Inbox']}
          title="Inbox"
          description="What waits on you in every app, oldest first. Open a row to decide it in its own app."
        />

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="ws-tabs" role="tablist" aria-label="Inbox">
            {TABS.map((t) => (
              <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} className="ws-tab" onClick={() => { setTab(t.key); setApp('all'); }}>
                {t.label}
                {count(t.key) ? <span className="ws-pill ml-2 tabular-nums">{count(t.key)}</span> : null}
              </button>
            ))}
          </div>
          {apps.length > 1 ? (
            <select className="ui-select" aria-label="App" value={app} onChange={(e) => setApp(e.target.value)} style={{ width: 'auto' }}>
                <option value="all">All apps</option>
                {apps.map((a) => <option key={a} value={a}>{APP_NAME[a] || a}</option>)}
              </select>
          ) : null}
        </div>

        {missing.length ? (
          <p role="status" className="ws-notice">{`Could not reach ${missing.join(' and ')} just now, so this list may be short. Reload in a minute.`}</p>
        ) : null}
        {error ? <p role="alert" className="text-sm" style={{ color: 'rgb(var(--ws-danger))' }}>{error}</p> : null}

        {all === null && !error ? (
          <p className="ws-card-blurb">Loading…</p>
        ) : !rows.length && !error ? (
          <div className="ws-empty">
            <span className="ws-tile" aria-hidden="true"><ICON.inbox size={20} /></span>
            <p>{empty}</p>
          </div>
        ) : rows.length ? (
          <div className="ws-table-wrap">
            <table className="ws-table">
              <caption className="sr-only">{TABS.find((t) => t.key === tab)?.label}</caption>
              <thead>
                {tab === 'updates' ? (
                  <tr><th>Update</th><th>App</th><th>When</th><th><span className="sr-only">Open</span></th></tr>
                ) : (
                  <tr><th>What</th><th>Who</th><th>App</th><th>{tab === 'task' ? 'Due' : 'Waiting'}</th><th><span className="sr-only">Open</span></th></tr>
                )}
              </thead>
              <tbody>
                {tab === 'updates'
                  ? rows.map((u) => (
                      <tr key={u.key}>
                        <td>
                          <strong style={{ fontWeight: u.read ? 500 : 600 }}>{u.title}</strong>
                          {u.body ? <div className="ws-card-blurb">{u.body}</div> : null}
                        </td>
                        <td><AppName app={u.app} /></td>
                        <td>{ago(u.at)}</td>
                        <td className="num">
                          {u.open ? (
                            <button type="button" className="ws-btn ws-btn--quiet ws-btn--small" onClick={() => open(u.open)}>
                              Open <ArrowRight size={14} aria-hidden="true" />
                            </button>
                          ) : null}
                        </td>
                      </tr>
                    ))
                  : rows.map((r) => (
                      <tr key={r.key}>
                        <td>
                          <strong style={{ fontWeight: 600 }}>{r.title}</strong>
                          {r.detail && tab !== 'task' ? <div className="ws-card-blurb">{r.detail}</div> : null}
                        </td>
                        <td>{r.who || '—'}</td>
                        <td><AppName app={r.app} /></td>
                        <td>
                          {r.overdue ? <span className="ws-pill ws-pill--off">Overdue</span> : tab === 'task' ? (r.detail ? r.detail.replace(/^Due /, '') : '—') : ago(r.since)}
                        </td>
                        <td className="num">
                          <button type="button" className="ws-btn ws-btn--quiet ws-btn--small" onClick={() => open(r.open)} aria-label={`Open ${r.title} in ${APP_NAME[r.app] || r.app}`}>
                            Open <ArrowRight size={14} aria-hidden="true" />
                          </button>
                        </td>
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
