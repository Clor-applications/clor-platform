import React, { useEffect, useMemo, useState } from 'react';
import { emoji } from '@ui/components/ui/emoji';
import { ArrowRight, RefreshCw } from '@ui/components/ui/lineIcons';

import { orgId } from '@platform/context';
import { apiFetch } from '@platform/http';
import { AppTag, Avatar, FilterSelect, Loading, PageHead, ago, appName } from './wsKit';
import './workspace.css';
import './ws-security.css';

/* This page's colour icon, the one its menu item wears. */
const PAGE_ICON = emoji('inbox-tray');

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
  /* Each tab its own accent (owner, 19 Nov 2026): orange to decide, blue for tasks, green for updates. */
  { key: 'decide', label: 'To decide', empty: 'Nothing waits for your decision.', tone: '--cat-2' },
  { key: 'task', label: 'Your tasks', empty: 'No tasks on your name.', tone: '--cat-1' },
  { key: 'updates', label: 'Updates', empty: 'No updates in the last 30 days.', tone: '--cat-3' },
];

const label = (app) => APP_NAME[app] || appName(app);
const appTag = (app) => (app === 'admin' ? <span className="ws-tag ws-tag--workspace">Workspace</span> : <AppTag app={app}>{label(app)}</AppTag>);
const dayMs = 86400000;

export default function Inbox({ openApp, openScreen }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('decide');
  const [app, setApp] = useState('');

  const load = () => {
    setLoading(true);
    setError('');
    return getInbox()
      .then((r) => setData(r || { rows: [], updates: [], unanswered: [] }))
      .catch((e) => setError(e?.message || 'The inbox could not be loaded. Try again in a minute.'))
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const all = useMemo(() => {
    if (!data) return null;
    if (tab === 'updates') return data.updates.map((u) => ({ ...u, key: u.id }));
    return data.rows.filter((r) => r.kind === tab);
  }, [data, tab]);
  const apps = useMemo(() => [...new Set((all || []).map((r) => r.app))], [all]);
  const rows = (all || []).filter((r) => !app || r.app === app);
  const count = (k) => (data ? (k === 'updates' ? data.updates.filter((u) => !u.read).length : data.rows.filter((r) => r.kind === k).length) : 0);
  const open = (o) => {
    if (!o) return;
    if (o.app === 'admin') openScreen?.(o.screen, o.params || {});
    else openApp?.(o.app, o.screen, o.params || {});
  };
  const empty = TABS.find((t) => t.key === tab)?.empty;
  const missing = (data?.unanswered || []).map((a) => (a === 'updates' ? 'your updates' : label(a)));

  /* The side summary (owner, 19 Nov 2026: use the right side, as Activity does): what is waiting, where, and for how long. */
  const summary = useMemo(() => {
    const list = data?.rows || [];
    const byApp = new Map();
    for (const r of all || []) byApp.set(r.app, (byApp.get(r.app) || 0) + 1);
    const decide = list.filter((r) => r.kind === 'decide');
    const oldest = decide.reduce((o, r) => (!o || r.since < o ? r.since : o), null);
    const now = Date.now();
    const ages = [
      ['Today', decide.filter((r) => now - new Date(r.since) < dayMs).length],
      ['This week', decide.filter((r) => { const a = now - new Date(r.since); return a >= dayMs && a < 7 * dayMs; }).length],
      ['Older', decide.filter((r) => now - new Date(r.since) >= 7 * dayMs).length],
    ];
    return {
      total: list.length,
      overdue: list.filter((r) => r.overdue).length,
      apps: [...byApp].map(([id, n]) => ({ id, n })).sort((a, b) => b.n - a.n),
      oldest,
      ages,
      decide: decide.length,
      unread: (data?.updates || []).filter((u) => !u.read).length,
    };
  }, [data, all]);

  const isUpdates = tab === 'updates';

  return (
    <div className="ws">
      <div className="ws-inner">
        <PageHead
          crumbs={['Home', 'Inbox']}
          icon={PAGE_ICON}
          title="Inbox"
        />

        <div className="ws-filters ws-filters--one-row">
          <div className="ws-tabs ws-inbox-tabs" role="tablist" aria-label="Inbox">
            {TABS.map((t) => (
              <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} className="ws-tab" style={{ '--tab': `var(${t.tone})` }} onClick={() => { setTab(t.key); setApp(''); }}>
                {t.label}
                {count(t.key) ? <span className="ws-inbox-count">{count(t.key)}</span> : null}
              </button>
            ))}
          </div>
          {apps.length > 1 ? (
            <FilterSelect label="App" value={app} options={[['', 'All'], ...apps.map((a) => [a, label(a)])]} onChange={setApp} />
          ) : null}
          <span className="ws-filters-end">
            <button type="button" onClick={() => load()} className="ws-btn ws-btn--quiet ws-btn--icon" disabled={loading} aria-label={loading ? 'Loading' : 'Refresh'} title="Refresh">
              <RefreshCw size={16} aria-hidden="true" />
            </button>
          </span>
        </div>

        {missing.length ? (
          <p role="status" className="ws-notice">{`Could not reach ${missing.join(' and ')} just now, so this list may be short. Reload in a minute.`}</p>
        ) : null}
        {error ? <p role="alert" className="text-sm" style={{ color: 'rgb(var(--ws-danger))' }}>{error}</p> : null}

        {all === null && !error ? (
          <Loading shape="rows" label="Loading…" />
        ) : all !== null ? (
          <div className="ws-activity-layout">
            <div className="ws-activity-main">
              {!rows.length ? (
                <div className="ws-inbox-empty">
                  <PAGE_ICON size={28} aria-hidden="true" />
                  <div>
                    <p className="ws-inbox-empty-title">{empty}</p>
                    <p className="ws-card-blurb">New requests from every app you use land here first.</p>
                  </div>
                </div>
              ) : (
                <div className="ws-table-wrap">
                  <table className="ws-table ws-sec-table ws-activity-table ws-inbox-table" data-updates={isUpdates ? '' : undefined}>
                    <caption className="sr-only">{TABS.find((t) => t.key === tab)?.label}</caption>
                    <colgroup>
                      <col className="ws-col-what" />
                      {isUpdates ? null : <col className="ws-col-who" />}
                      <col className="ws-col-app" />
                      <col className="ws-col-when" />
                      <col className="ws-col-open" />
                    </colgroup>
                    <thead>
                      <tr>
                        <th scope="col">{isUpdates ? 'Update' : 'What'}</th>
                        {isUpdates ? null : <th scope="col">Who</th>}
                        <th scope="col" className="ws-mid">App</th>
                        <th scope="col" className="ws-mid">{isUpdates ? 'When' : tab === 'task' ? 'Due' : 'Waiting'}</th>
                        <th scope="col"><span className="sr-only">Open</span></th>
                      </tr>
                    </thead>
                    <tbody>
                      {isUpdates
                        ? rows.map((u) => (
                            <tr key={u.key} data-unread={u.read ? undefined : ''}>
                              <td>
                                <span className="ws-inbox-what">
                                  {u.read ? null : <span className="ws-inbox-dot" aria-label="Unread" />}
                                  <strong style={{ fontWeight: u.read ? 500 : 600 }}>{u.title}</strong>
                                </span>
                                {u.body ? <div className="ws-card-blurb">{u.body}</div> : null}
                              </td>
                              <td className="ws-mid">{appTag(u.app)}</td>
                              <td className="ws-mid ws-sec-when">{ago(u.at)}</td>
                              <td className="num">
                                {u.open ? (
                                  <button type="button" className="ws-inbox-open" onClick={() => open(u.open)} aria-label={`Open ${u.title}`}>
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
                              <td>
                                {r.who ? (
                                  <span className="ws-sec-who"><Avatar name={r.who} /><span>{r.who}</span></span>
                                ) : '—'}
                              </td>
                              <td className="ws-mid">{appTag(r.app)}</td>
                              <td className="ws-mid ws-sec-when">
                                {r.overdue ? <span className="ws-pill ws-pill--danger">Overdue</span> : tab === 'task' ? (r.detail ? r.detail.replace(/^Due /, '') : '—') : ago(r.since)}
                              </td>
                              <td className="num">
                                <button type="button" className="ws-inbox-open" onClick={() => open(r.open)} aria-label={`Open ${r.title} in ${label(r.app)}`}>
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

            <aside className="ws-activity-side" aria-label="Inbox summary">
              <section className="ws-activity-box">
                <p className="ws-activity-box-title">Waiting on you</p>
                <p className="ws-activity-big"><span className="ui-num">{summary.total}</span> {summary.total === 1 ? 'item' : 'items'}</p>
                <p className="ws-activity-sub">
                  {summary.overdue ? `${summary.overdue} overdue · ` : ''}
                  {summary.oldest ? `oldest ${ago(summary.oldest)}` : 'nothing old'}
                </p>
                {summary.decide ? (
                  <ul className="ws-activity-bars" aria-label="Decisions by age">
                    {summary.ages.map(([k, n]) => (
                      <li key={k} data-tone={k === 'Older' && n ? 'danger' : undefined}>
                        <span className="ws-activity-bar-label">{k}</span>
                        <span className="ws-activity-bar"><span style={{ width: `${n ? Math.max(6, Math.round((n / summary.decide) * 100)) : 0}%` }} /></span>
                        <span className="ws-activity-bar-n ui-num">{n}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </section>
              {summary.apps.length ? (
                <section className="ws-activity-box">
                  <p className="ws-activity-box-title">{`${TABS.find((t) => t.key === tab)?.label} by app`}</p>
                  <ul className="ws-activity-people">
                    {summary.apps.map((a) => (
                      <li key={a.id}>
                        <button type="button" className="ws-activity-person" aria-pressed={app === a.id} onClick={() => setApp((v) => (v === a.id ? '' : a.id))} title={app === a.id ? 'Show every app' : `Show only ${label(a.id)}`}>
                          {appTag(a.id)}
                          <span className="ws-activity-bar-n ui-num">{a.n}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}
              <section className="ws-activity-box">
                <p className="ws-activity-box-title">Updates</p>
                <p className="ws-activity-big"><span className="ui-num">{summary.unread}</span> unread</p>
                {tab !== 'updates' && (data?.updates || []).length ? (
                  <button type="button" className="ws-inbox-link" onClick={() => { setTab('updates'); setApp(''); }}>
                    See updates <ArrowRight size={14} aria-hidden="true" />
                  </button>
                ) : <p className="ws-activity-sub">From the last 30 days</p>}
              </section>
            </aside>
          </div>
        ) : null}
      </div>
    </div>
  );
}
