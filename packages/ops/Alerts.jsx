import React, { useCallback, useEffect, useState } from 'react';

import { PageHead, ago } from '../../apps/admin/src/screens/wsKit';
import { Err, Loading, Tabs, when } from './kit';
import { opsAcknowledgeAlert, opsAlerts } from './api';

/**
 * Alerts (operator console, Ops plan P1). The alerts job looks every ten
 * minutes and raises one alert per problem; it closes the alert itself when
 * the problem clears. Acknowledging says "I am on it" and stops it counting
 * as new. Each alert is for one team; owners see and act on all of them.
 */
const TEAM = { SUPPORT: 'Support', BILLING: 'Finance', SALES: 'Sales' };
const KIND = { worker: 'Background job', email: 'Email', webhook: 'Webhooks', readers: 'Readers', closure: 'Company deletion', invoice: 'Invoice', ticket: 'Ticket', trial: 'Trial', errors: 'Errors' };

export function Alerts({ go, me }) {
  const [d, setD] = useState(null);
  const [tab, setTab] = useState('open');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const load = useCallback(() => {
    opsAlerts().then(setD).catch((e) => setError(String(e?.message || e)));
  }, []);
  useEffect(load, [load]);

  const ack = async (a) => {
    setBusy(a.id);
    setError('');
    try {
      await opsAcknowledgeAlert(a.id);
      load();
    } catch (e) {
      setError(String(e?.message || e));
    } finally {
      setBusy('');
    }
  };
  const open = (link) => link && go(link.page, link.params || {}, link.id || '', link.tab || '');
  const rows = d ? (tab === 'open' ? d.open : tab === 'mine' ? d.open.filter((a) => a.forMe) : d.closed) : [];

  return (
    <div className="ws">
      <div className="ws-inner">
        <PageHead
          crumbs={['System', 'Alerts']}
          title="Alerts"
          description="Checked every ten minutes. An alert closes on its own when the problem clears; new ones are emailed to the team they are for."
          meta={d ? `${d.counts.open} open · ${d.counts.critical} urgent · ${d.counts.unacknowledged} not acknowledged` : null}
        />
        <Tabs
          label="Which alerts"
          value={tab}
          onChange={setTab}
          tabs={[
            ['open', `Open${d ? ` (${d.counts.open})` : ''}`],
            ['mine', 'For my team'],
            ['closed', 'Closed'],
          ]}
        />
        <Err>{error}</Err>
        {!d && !error ? (
          <Loading />
        ) : d && rows.length === 0 ? (
          <div className="ws-empty">
            <p>{tab === 'closed' ? 'Nothing closed in the last 7 days.' : 'Nothing needs CLOR staff right now.'}</p>
          </div>
        ) : d ? (
          <ul className="ws-list ws-list--ground" aria-label="Alerts">
            {rows.map((a) => (
              <li key={a.id}>
                <div className="ws-item ws-item--wrap" style={{ alignItems: 'flex-start' }}>
                  <span className={`ws-pill ${a.resolvedAt ? 'ws-pill--off' : a.severity === 'critical' ? 'ws-pill--danger' : 'ws-pill--warn'}`} style={{ flex: 'none', marginTop: 2 }}>
                    {a.resolvedAt ? 'Cleared' : a.severity === 'critical' ? 'Urgent' : 'Warning'}
                  </span>
                  <span className="ws-item-text">
                    <span className="ws-item-title">{a.title}</span>
                    {a.detail ? <span className="ws-item-sub">{a.detail}</span> : null}
                    <span className="ws-item-sub">
                      {[
                        KIND[a.kind] || a.kind,
                        `for ${TEAM[a.audience] || a.audience}`,
                        a.resolvedAt ? `cleared ${when(a.resolvedAt)}` : `since ${ago(a.firstSeenAt)}`,
                        a.acknowledgedBy ? `${a.acknowledgedBy.id === me?.user?.id ? 'you are' : `${a.acknowledgedBy.name} is`} on it` : null,
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  </span>
                  <span className="ws-item-actions inline-flex flex-wrap gap-2">
                    {a.link ? (
                      <button type="button" className="ws-btn ws-btn--quiet ws-btn--small" onClick={() => open(a.link)}>Open</button>
                    ) : null}
                    {!a.resolvedAt && !a.acknowledgedAt && a.forMe && me?.role !== 'READ_ONLY' ? (
                      <button type="button" className="ws-btn ws-btn--quiet ws-btn--small" disabled={busy === a.id} onClick={() => ack(a)}>
                        I am on it
                      </button>
                    ) : null}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        ) : null}
        {d ? (
          <p className="ws-item-sub">
            Raised when: a background job fails or runs late; {d.rules.emailsFailingPerHour} or more emails fail in an hour, or any waits over an hour; {d.rules.webhooksFailingPerDay} or more webhooks fail in a day; a customer’s reader is offline over 30 minutes; a company deletion stops; a CLOR invoice is past due; an urgent ticket has no answer after {d.rules.urgentTicketMinutes} minutes, or any ticket waits over {d.rules.ticketWaitHours} hours; a trial ends within {d.rules.trialEndingDays} days.
          </p>
        ) : null}
      </div>
    </div>
  );
}
