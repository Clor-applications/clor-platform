import { emoji } from '@ui/components/ui/emoji';
import React, { useEffect, useState } from 'react';
import { ArrowRight } from '@ui/components/ui/lineIcons';

import { hasApp, orgId } from '@platform/context';
import { apiFetch } from '@platform/http';
import { AppTag, Loading, PageHead, ago } from './wsKit';
import './workspace.css';
import './ws-security.css';
import { errorWords } from '@ui/utils/errorWords';

/* This page's colour icon, the one its menu item wears. */
const PAGE_ICON = emoji('puzzle-piece');

/**
 * Integrations (Workspace plan P2): everything connecting this company to the
 * outside, whether it works, and where it is managed. Read only: each line
 * opens the screen that owns it (services/workspace/integrations.ts).
 */
const getIntegrations = () => apiFetch(`/orgs/${encodeURIComponent(orgId())}/workspace/integrations`, { skipWarehouseHeader: true });

const STATUS = {
  ok: ['Working', 'ok'],
  attention: ['Needs a look', 'danger'],
  off: ['Not in use', 'off'],
};
const WHERE = { people: 'People', attendance: 'Attendance', admin: 'Admin center' };

function State({ status }) {
  const [label, tone] = STATUS[status] || STATUS.off;
  return <span className="ws-state" data-tone={tone}>{label}</span>;
}

/* What can be connected and is not yet (owner, 19 Nov 2026: a page with one line looked empty). The server lists
   only what is set up (services/workspace/integrations.ts); these say what else there is and where it is set up. */
const AVAILABLE = [
  { key: 'readers', label: 'Attendance readers', about: 'Fingerprint and face machines that send punches to CLOR.', time: true, screen: 'readers' },
  { key: 'connectors', label: 'On-site connector', about: 'A small program on your office computer that links readers and Tally to CLOR.', time: true, screen: 'integrations' },
  { key: 'webhooks', label: 'Webhooks', about: 'Addresses CLOR tells when something happens, such as a punch or approved leave.', time: true, screen: 'integrations' },
  { key: 'sso', label: 'Single sign-on', about: 'People sign in with your company account instead of a CLOR password.', app: 'admin', screen: 'sso' },
  { key: 'scim', label: 'Directory sync', about: 'Your directory (Microsoft Entra, Okta, Google) adds and removes CLOR users for you.', app: 'admin', screen: 'sso' },
  { key: 'apiKeys', label: 'API keys', about: 'Keys other systems use to read from or send to CLOR.', app: 'admin', screen: 'credentials' },
];

export default function Integrations({ openApp, openScreen }) {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let live = true;
    getIntegrations()
      .then((r) => live && setRows(r?.integrations || []))
      .catch((e) => live && setError(errorWords(e, 'load the integrations')));
    return () => { live = false; };
  }, []);

  const manage = (m) => (m.app === 'admin' ? openScreen?.(m.screen) : openApp?.(m.app, m.screen, {}));
  const list = rows || [];
  const attention = list.filter((r) => r.status === 'attention').length;
  const working = list.filter((r) => r.status === 'ok').length;
  const timeApp = hasApp('people') ? 'people' : hasApp('attendance') ? 'attendance' : null;
  const have = new Set(list.map((r) => r.key));
  const more = AVAILABLE.filter((a) => !have.has(a.key) && (!a.time || timeApp)).map((a) => ({ ...a, manage: { app: a.time ? timeApp : a.app, screen: a.screen } }));

  return (
    <div className="ws">
      <div className="ws-inner">
        <PageHead
          crumbs={['Apps', 'Integrations']}
          icon={PAGE_ICON}
          title="Integrations"
          description="What connects this company to machines and systems outside CLOR, and whether it is working. Each one is managed in its own place."
        />

        {error ? <p role="alert" className="text-sm" style={{ color: 'rgb(var(--ws-danger))' }}>{error}</p> : null}

        {rows === null && !error ? (
          <Loading shape="rows" label="Loading integrations…" />
        ) : rows ? (
          <div className="ws-activity-layout">
            <div className="ws-activity-main">
              <h2 className="ws-group-title">Connected <span className="ws-group-n">{list.length}</span></h2>
              {list.length ? (
                <div className="ws-table-wrap">
                  <table className="ws-table ws-sec-table ws-activity-table ws-int-table">
                    <caption className="sr-only">Connected</caption>
                    <colgroup><col className="ws-int-what" /><col className="ws-int-detail" /><col className="ws-int-status" /><col className="ws-int-act" /></colgroup>
                    <thead>
                      <tr>
                        <th scope="col">Integration</th>
                        <th scope="col">Now</th>
                        <th scope="col" className="ws-mid">Status</th>
                        <th scope="col"><span className="sr-only">Manage</span></th>
                      </tr>
                    </thead>
                    <tbody>
                      {list.map((x) => (
                        <tr key={x.key}>
                          <td>
                            <strong style={{ fontWeight: 600 }}>{x.label}</strong>
                            <div className="ws-card-blurb">{x.about}</div>
                            {x.parts?.length ? (
                              <ul className="ws-int-parts" aria-label={`${x.label}, one by one`}>
                                {x.parts.map((p, i) => (
                                  <li key={`${p.name}-${i}`}>
                                    <State status={p.status} />
                                    <span style={{ fontWeight: 600 }}>{p.name}</span>
                                    {p.note ? <span className="ws-card-blurb">{p.note}</span> : null}
                                    {p.lastSeenAt ? <span className="ws-card-blurb">· {ago(p.lastSeenAt)}</span> : null}
                                  </li>
                                ))}
                              </ul>
                            ) : null}
                          </td>
                          <td>
                            <span className="tabular-nums">{x.summary}</span>
                            {x.lastActivityAt ? <div className="ws-card-blurb">Last heard {ago(x.lastActivityAt)}</div> : null}
                            {x.manageNote ? <div className="ws-card-blurb">{x.manageNote}</div> : null}
                          </td>
                          <td className="ws-mid"><State status={x.status} /></td>
                          <td className="num">
                            {x.manage ? (
                              <button type="button" className="ws-row-link" onClick={() => manage(x.manage)} aria-label={`Manage ${x.label} in ${WHERE[x.manage.app] || x.manage.app}`}>
                                Manage <ArrowRight size={14} aria-hidden="true" />
                              </button>
                            ) : null}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="ws-card-blurb">Nothing outside CLOR is connected to this company yet.</p>
              )}

              {more.length ? (
                <>
                  <h2 className="ws-group-title">Can be connected <span className="ws-group-n">{more.length}</span></h2>
                  <div className="ws-table-wrap">
                    <table className="ws-table ws-sec-table ws-activity-table ws-int-table">
                      <caption className="sr-only">Can be connected</caption>
                      <colgroup><col className="ws-int-what" /><col className="ws-int-detail" /><col className="ws-int-status" /><col className="ws-int-act" /></colgroup>
                      <thead>
                        <tr>
                          <th scope="col">Integration</th>
                          <th scope="col">Set up in</th>
                          <th scope="col" className="ws-mid">Status</th>
                          <th scope="col"><span className="sr-only">Set up</span></th>
                        </tr>
                      </thead>
                      <tbody>
                        {more.map((a) => (
                          <tr key={a.key}>
                            <td>
                              <strong style={{ fontWeight: 600 }}>{a.label}</strong>
                              <div className="ws-card-blurb">{a.about}</div>
                            </td>
                            <td>{a.manage.app === 'admin' ? <span className="ws-tag ws-tag--workspace">Admin center</span> : <AppTag app={a.manage.app}>{WHERE[a.manage.app] || a.manage.app}</AppTag>}</td>
                            <td className="ws-mid"><span className="ws-state" data-tone="off">Not set up</span></td>
                            <td className="num">
                              <button type="button" className="ws-row-link" onClick={() => manage(a.manage)} aria-label={`Set up ${a.label} in ${WHERE[a.manage.app] || a.manage.app}`}>
                                Set up <ArrowRight size={14} aria-hidden="true" />
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              ) : null}
            </div>

            <aside className="ws-activity-side" aria-label="Integrations summary">
              <section className="ws-activity-box">
                <p className="ws-activity-box-title">Connections</p>
                <p className="ws-activity-big"><span className="ui-num">{list.length}</span> connected</p>
                <p className="ws-activity-sub">{attention ? `${attention} need${attention === 1 ? 's' : ''} a look` : list.length ? 'All working' : 'Nothing connected yet'}</p>
                {list.length ? (
                  <ul className="ws-activity-bars" aria-label="By status">
                    <li data-tone="ok">
                      <span className="ws-activity-bar-label">Working</span>
                      <span className="ws-activity-bar"><span style={{ width: `${Math.round((working / list.length) * 100)}%` }} /></span>
                      <span className="ws-activity-bar-n ui-num">{working}</span>
                    </li>
                    <li data-tone="danger">
                      <span className="ws-activity-bar-label">Needs a look</span>
                      <span className="ws-activity-bar"><span style={{ width: `${Math.round((attention / list.length) * 100)}%` }} /></span>
                      <span className="ws-activity-bar-n ui-num">{attention}</span>
                    </li>
                  </ul>
                ) : null}
              </section>
              <section className="ws-activity-box">
                <p className="ws-activity-box-title">Read only here</p>
                <p className="ws-side-note">This page watches. Each connection is changed where it is managed, so its own rules and checks still apply.</p>
              </section>
            </aside>
          </div>
        ) : null}
      </div>
    </div>
  );
}
