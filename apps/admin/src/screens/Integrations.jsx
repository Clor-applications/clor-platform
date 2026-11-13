import React, { useEffect, useState } from 'react';
import { ArrowRight } from '@ui/components/ui/lineIcons';

import { orgId } from '@platform/context';
import { apiFetch } from '@platform/http';
import { ICON, PageHead, ago } from './wsKit';
import './workspace.css';

/**
 * Integrations (Workspace plan P2): everything connecting this company to the
 * outside, whether it works, and where it is managed. Read only: each line
 * opens the screen that owns it (services/workspace/integrations.ts).
 */
const getIntegrations = () => apiFetch(`/orgs/${encodeURIComponent(orgId())}/workspace/integrations`, { skipWarehouseHeader: true });

const STATUS = {
  ok: ['Working', 'ws-pill ws-pill--ok'],
  attention: ['Needs a look', 'ws-pill ws-pill--warn'],
  off: ['Not in use', 'ws-pill ws-pill--off'],
};
const WHERE = { people: 'People', attendance: 'Attendance', admin: 'Workspace' };

function Pill({ status }) {
  const [label, cls] = STATUS[status] || STATUS.off;
  return <span className={cls}>{label}</span>;
}

export default function Integrations({ openApp, openScreen }) {
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let live = true;
    getIntegrations()
      .then((r) => live && setRows(r?.integrations || []))
      .catch((e) => live && setError(e?.message || 'Integrations could not be loaded. Try again in a minute.'));
    return () => { live = false; };
  }, []);

  const manage = (m) => (m.app === 'admin' ? openScreen?.(m.screen) : openApp?.(m.app, m.screen, {}));
  const attention = (rows || []).filter((r) => r.status === 'attention').length;

  return (
    <div className="ws">
      <div className="ws-inner">
        <PageHead
          crumbs={['Company', 'Integrations']}
          title="Integrations"
          description="What connects this company to machines and systems outside CLOR, and whether it is working. Each one is managed in its own place."
          meta={rows?.length ? (attention ? `${attention} need${attention === 1 ? 's' : ''} a look` : 'All working') : null}
        />

        {error ? <p role="alert" className="text-sm" style={{ color: 'rgb(var(--ws-danger))' }}>{error}</p> : null}

        {rows === null && !error ? (
          <p className="ws-card-blurb">Loading…</p>
        ) : rows && !rows.length ? (
          <div className="ws-empty">
            <span className="ws-tile" aria-hidden="true"><ICON.data size={20} /></span>
            <p>Nothing outside CLOR is connected to this company yet. Readers, connectors, webhooks, single sign-on and API keys show here once they are set up.</p>
          </div>
        ) : rows?.length ? (
          <ul className="ws-list" aria-label="Integrations">
            {rows.map((x) => (
              <li key={x.key} aria-labelledby={`int-${x.key}`}>
                <div className="ws-item" style={{ alignItems: 'flex-start' }}>
                  <span className={`ws-tile${x.status === 'attention' ? ' ws-tile--warn' : ''}`} aria-hidden="true">
                    {x.status === 'attention' ? <ICON.warning size={18} /> : <ICON.data size={18} />}
                  </span>
                  <span className="ws-item-text">
                    <span id={`int-${x.key}`} className="ws-item-title">{x.label}</span>
                    <span className="ws-item-sub">{x.about}</span>
                    <span className="ws-item-sub tabular-nums">
                      {x.summary}
                      {x.lastActivityAt ? ` · last heard ${ago(x.lastActivityAt)}` : ''}
                    </span>
                    {x.parts?.length ? (
                      <ul className="mt-2 grid gap-1" aria-label={`${x.label}, one by one`}>
                        {x.parts.map((p, i) => (
                          <li key={`${p.name}-${i}`} className="flex flex-wrap items-center gap-2 text-sm">
                            <Pill status={p.status} />
                            <span style={{ fontWeight: 600 }}>{p.name}</span>
                            {p.note ? <span className="ws-item-sub">{p.note}</span> : null}
                            {p.lastSeenAt ? <span className="ws-item-sub">· {ago(p.lastSeenAt)}</span> : null}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                    {x.manageNote ? <span className="ws-item-sub">{x.manageNote}</span> : null}
                  </span>
                  <span className="inline-flex items-center gap-2">
                    <Pill status={x.status} />
                    {x.manage ? (
                      <button type="button" className="ws-btn ws-btn--quiet ws-btn--small" onClick={() => manage(x.manage)} aria-label={`Manage ${x.label} in ${WHERE[x.manage.app] || x.manage.app}`}>
                        Manage <ArrowRight size={14} aria-hidden="true" />
                      </button>
                    ) : null}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}
