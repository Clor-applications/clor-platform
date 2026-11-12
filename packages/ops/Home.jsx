import React, { useEffect, useState } from 'react';

import { ICON, PageHead, Stat } from '../../apps/admin/src/screens/wsKit';
import { Err, Loading } from './kit';
import { opsHome } from './api';

/**
 * Home (operator console): today's work in plain words, each number a way
 * into its list. Titled by the date, not a greeting.
 */
const n = (count, one, many) => `${count} ${count === 1 ? one : many}`;

export function Home({ go, has }) {
  const [d, setD] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    opsHome().then(setD).catch((e) => setError(String(e?.message || e)));
  }, []);
  const today = new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' });
  return (
    <>
      <PageHead crumbs={['Home']} title={today} />
      <Err>{error}</Err>
      {!d ? (
        error ? null : <Loading />
      ) : (
        <div className="ws-stats">
          {d.alertsOpen != null ? (
            <Stat
              icon={ICON.alert}
              tone={d.alertsCritical ? 'danger' : d.alertsOpen ? 'warn' : null}
              label="Alerts"
              value={d.alertsOpen}
              note={d.alertsOpen ? (d.alertsCritical ? `${n(d.alertsCritical, 'is urgent', 'are urgent')}` : 'Nothing urgent') : 'Everything is working'}
              onOpen={() => go('alerts')}
            />
          ) : null}
          {d.ticketsOpen != null ? (
            <Stat
              icon={ICON.chat}
              tone={d.ticketsOpen ? 'warn' : null}
              label="Tickets"
              value={d.ticketsOpen}
              note={d.ticketsOpen ? `${n(d.ticketsOpen, 'customer waits', 'customers wait')} for an answer` : 'No customer is waiting'}
              onOpen={() => go('tickets')}
            />
          ) : null}
          <Stat
            icon={ICON.mail}
            tone={d.newDemos || d.followUpsDue ? 'warn' : null}
            label="Demo requests"
            value={d.newDemos}
            note={[
              d.newDemos ? `${n(d.newDemos, 'new request waits', 'new requests wait')} for a call` : 'Nobody new is waiting for a call',
              d.followUpsDue ? n(d.followUpsDue, 'follow-up due today', 'follow-ups due today') : null,
              d.demosToday ? `${d.demosToday} came in today` : null,
            ].filter(Boolean).join(' · ')}
            onOpen={() => go('demos')}
          />
          <Stat
            icon={ICON.plan}
            tone={d.trialsEnding ? 'warn' : null}
            label="Trials ending this week"
            value={d.trialsEnding}
            note={d.trialsEnding ? `${n(d.trialsEnding, 'trial ends', 'trials end')} in the next 7 days` : 'No trial ends this week'}
            onOpen={() => (has('trials') ? go('trials') : go('customers', { status: 'trialing' }))}
          />
          <Stat
            icon={ICON.warning}
            tone={d.failedPayments ? 'warn' : null}
            label="Failed payments"
            value={d.failedPayments}
            note={d.failedPayments ? `${n(d.failedPayments, 'payment', 'payments')} this week could not be applied` : 'None this week'}
            onOpen={() => (has('payments') ? go('payments') : go('customers', { status: 'overdue' }))}
          />
          <Stat
            icon={ICON.alert}
            tone={d.failedEmails ? 'warn' : null}
            label="Failed emails"
            value={d.failedEmails}
            note={d.failedEmails ? `${n(d.failedEmails, 'email', 'emails')} this week did not go` : 'Every email this week went'}
            onOpen={() => go('emailLog', { status: 'FAILED' })}
          />
          <Stat
            icon={ICON.companies}
            tone={d.overdue ? 'warn' : null}
            label="Overdue"
            value={d.overdue}
            note={d.overdue ? `${n(d.overdue, 'customer is', 'customers are')} past their trial or payment` : 'Nobody is overdue'}
            onOpen={() => go('customers', { status: 'overdue' })}
          />
          <Stat
            icon={ICON.secure}
            label="Suspended"
            value={d.suspended}
            note={d.suspended ? `${n(d.suspended, 'customer is', 'customers are')} shut out until resumed` : 'Nobody is suspended'}
            onOpen={() => go('customers', { status: 'suspended' })}
          />
        </div>
      )}
    </>
  );
}
