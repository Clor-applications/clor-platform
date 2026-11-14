import React, { useEffect, useState } from 'react';
import { BuildingPeopleColor, CalendarClockColor, ReceiptColor, WarningColor } from '@fluentui/react-icons';
import { colorSet } from '@ui/components/ui/colorIcon';

import { PageHead, ago } from '../../apps/admin/src/screens/wsKit';
import { Err, Loading } from './kit';
import { workerName } from './Health';
import { opsAudit, opsHealth, opsHome, opsOverview } from './api';

/**
 * Overview (operator console; R&D CLOR-05): four numbers about the customer
 * base, the background services, what needs a staff member today, and what
 * staff did last. Each part loads on its own, so a role that cannot see one
 * still gets the rest.
 */
const n = (count, one, many) => `${count} ${count === 1 ? one : many}`;
const KI = colorSet({ accounts: BuildingPeopleColor, paying: ReceiptColor, trials: CalendarClockColor, legacy: WarningColor }, 20);
const WORKER = { ok: ['Healthy', 'ws-pill ws-pill--ok'], late: ['Slow', 'ws-pill ws-pill--warn'], failing: ['Failing', 'ws-pill ws-pill--danger'] };
const initials = (s) =>
  String(s || '?')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();

/** One part of the page: its data, or the reason it could not load. */
function usePart(fetch) {
  const [state, setState] = useState({ d: null, error: '' });
  useEffect(() => {
    let live = true;
    fetch()
      .then((d) => live && setState({ d, error: '' }))
      .catch((e) => live && setState({ d: null, error: String(e?.message || e) }));
    return () => {
      live = false;
    };
  }, [fetch]);
  return state;
}
const getOverview = () => opsOverview();
const getHome = () => opsHome();
const getHealth = () => opsHealth();
const getAudit = () => opsAudit({});

export function Home({ go, has }) {
  const ov = usePart(getOverview);
  const today = usePart(getHome);
  const health = usePart(getHealth);
  const audit = usePart(getAudit);
  return (
    <>
      <PageHead
        title="Overview"
        description="Platform health and the customer accounts that need staff attention today."
        actions={
          <>
            {has('health') ? (
              <button type="button" className="ws-btn ws-btn--quiet" onClick={() => go('health')}>
                Jobs &amp; workers
              </button>
            ) : null}
            {has('announcements') ? (
              <button type="button" className="ws-btn ws-btn--primary" onClick={() => go('announcements')}>
                Post an announcement
              </button>
            ) : null}
          </>
        }
      />
      <Kpis d={ov.d} error={ov.error} go={go} has={has} />
      <Services d={health.d} error={health.error} go={go} has={has} />
      <div className="ops-split">
        <NeedsAction d={today.d} error={today.error} go={go} has={has} />
        <RecentActions d={audit.d} error={audit.error} go={go} has={has} />
      </div>
    </>
  );
}

/* ----------------------------------------------------------------- tiles */
function Kpis({ d, error, go, has }) {
  if (error) return <Err>{error}</Err>;
  if (!d) return <Loading />;
  const paying = d.paying ?? 0;
  const pct = d.accounts ? Math.round((paying / d.accounts) * 100) : 0;
  const tiles = [
    { k: 'accounts', tone: 1, label: 'Accounts', value: d.accounts, note: d.newThisWeek ? `+${d.newThisWeek} this week` : 'None new this week', open: () => go('customers') },
    { k: 'paying', tone: 2, label: 'Paying', value: paying, note: `${pct}% of accounts`, open: () => go('customers', { status: 'active' }) },
    {
      k: 'trials',
      tone: 4,
      label: 'Trials ending in 7 days',
      value: d.trialsEndingIn7d,
      note: d.trialsEndingIn7d ? 'Each owner is emailed before it ends' : 'No trial ends this week',
      state: d.trialsEndingIn7d ? 'warn' : null,
      open: () => (has('trials') ? go('trials') : go('customers', { status: 'trialing' })),
    },
    {
      k: 'legacy',
      tone: 8,
      label: 'Legacy all-apps accounts',
      value: d.legacy ?? 0,
      note: d.legacy ? 'Fail-open: must move to a plan' : 'Every account is on a plan',
      state: d.legacy ? 'neg' : null,
      open: () => go('customers'),
    },
  ];
  return (
    <div className="ops-kpis">
      {tiles.map((t) => {
        const Icon = KI[t.k];
        return (
          <button key={t.k} type="button" className="ops-kpi" style={{ '--kpi': `var(--cat-${t.tone})` }} onClick={t.open}>
            <span className="ops-kpi-chip" aria-hidden="true">
              <Icon size={20} />
            </span>
            <span className="ops-kpi-label">{t.label}</span>
            <span className="ops-kpi-value" data-state={t.state || undefined}>
              {Number(t.value || 0).toLocaleString('en-IN')}
            </span>
            <span className="ops-kpi-note">{t.note}</span>
          </button>
        );
      })}
    </div>
  );
}

/* -------------------------------------------------------------- services */
function Services({ d, error, go, has }) {
  return (
    <section className="ops-section" aria-labelledby="ops-services">
      <div className="ops-section-head">
        <h2 id="ops-services" className="ops-h2">Services</h2>
        {has('health') ? (
          <button type="button" className="ops-link" onClick={() => go('health')}>
            All jobs →
          </button>
        ) : null}
      </div>
      {error ? (
        <Err>{error}</Err>
      ) : !d ? (
        <Loading />
      ) : !d.workers.length ? (
        <p className="ws-card-blurb">No background job has run in the last week.</p>
      ) : (
        <div className="ws-table-wrap">
          <table className="ws-table">
            <caption className="sr-only">Background services</caption>
            <thead>
              <tr>
                <th>Service</th>
                <th>Now</th>
                <th className="num">Failed (24 h)</th>
                <th className="hidden md:table-cell">Last ran</th>
                <th className="hidden lg:table-cell">Last error</th>
              </tr>
            </thead>
            <tbody>
              {d.workers.slice(0, 6).map((w) => {
                const [word, cls] = WORKER[w.state] || [w.state, 'ws-pill'];
                return (
                  <tr key={w.worker}>
                    <td className="ops-strong">{workerName(w.worker)}</td>
                    <td>
                      <span className={cls}>{word}</span>
                    </td>
                    <td className="num">{w.failedToday}</td>
                    <td className="hidden md:table-cell">{ago(w.lastStartedAt)}</td>
                    <td className="hidden lg:table-cell ops-clip">{w.state === 'ok' ? '—' : w.lastError || '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

/* ---------------------------------------------------------- needs action */
function NeedsAction({ d, error, go, has }) {
  let rows = [];
  if (d) {
    rows = [
      d.alertsOpen
        ? { k: 'alerts', tag: 'System', tone: d.alertsCritical ? 'danger' : 'warn', label: 'Alerts', title: n(d.alertsOpen, 'alert is open', 'alerts are open'), note: d.alertsCritical ? `${n(d.alertsCritical, 'is urgent', 'are urgent')}` : 'Nothing urgent', open: () => go('alerts') }
        : null,
      d.ticketsOpen
        ? { k: 'tickets', tag: 'Support', tone: 'warn', label: 'Tickets', title: n(d.ticketsOpen, 'ticket needs an answer', 'tickets need an answer'), note: `${n(d.ticketsOpen, 'customer waits', 'customers wait')} for an answer`, open: () => go('tickets') }
        : null,
      d.newDemos || d.followUpsDue
        ? {
            k: 'demos',
            tag: 'Sales',
            tone: 'warn',
            label: 'Demo requests',
            title: d.newDemos ? n(d.newDemos, 'new demo request', 'new demo requests') : n(d.followUpsDue, 'follow-up due', 'follow-ups due'),
            note: [
              d.newDemos ? `${n(d.newDemos, 'new request waits', 'new requests wait')} for a call` : null,
              d.followUpsDue ? n(d.followUpsDue, 'follow-up due today', 'follow-ups due today') : null,
              d.demosToday ? `${d.demosToday} came in today` : null,
            ]
              .filter(Boolean)
              .join(' · '),
            open: () => go('demos'),
          }
        : null,
      d.trialsEnding
        ? { k: 'trials', tag: 'Trials', tone: 'warn', label: 'Trials ending this week', title: n(d.trialsEnding, 'trial ends this week', 'trials end this week'), note: `${n(d.trialsEnding, 'trial ends', 'trials end')} in the next 7 days`, open: () => (has('trials') ? go('trials') : go('customers', { status: 'trialing' })) }
        : null,
      d.failedPayments
        ? { k: 'payments', tag: 'Billing', tone: 'danger', label: 'Failed payments', title: n(d.failedPayments, 'payment failed', 'payments failed'), note: `${n(d.failedPayments, 'payment', 'payments')} this week could not be applied`, open: () => (has('payments') ? go('payments') : go('customers', { status: 'overdue' })) }
        : null,
      d.failedEmails
        ? { k: 'emails', tag: 'Email', tone: 'warn', label: 'Failed emails', title: n(d.failedEmails, 'email failed', 'emails failed'), note: `${n(d.failedEmails, 'email', 'emails')} this week did not go`, open: () => go('emailLog', { status: 'FAILED' }) }
        : null,
      d.overdue
        ? { k: 'overdue', tag: 'Billing', tone: 'danger', label: 'Overdue', title: n(d.overdue, 'account is overdue', 'accounts are overdue'), note: `${n(d.overdue, 'customer is', 'customers are')} past their trial or payment`, open: () => go('customers', { status: 'overdue' }) }
        : null,
      d.suspended
        ? { k: 'suspended', tag: 'Access', tone: 'off', label: 'Suspended', title: n(d.suspended, 'account is suspended', 'accounts are suspended'), note: `${n(d.suspended, 'customer is', 'customers are')} shut out until resumed`, open: () => go('customers', { status: 'suspended' }) }
        : null,
    ].filter(Boolean);
  }
  return (
    <section className="ops-section" aria-labelledby="ops-needs">
      <h2 id="ops-needs" className="ops-h2">Needs action</h2>
      {error ? (
        <Err>{error}</Err>
      ) : !d ? (
        <Loading />
      ) : !rows.length ? (
        <p className="ops-quiet-line">Nothing needs a staff member right now.</p>
      ) : (
        <ul className="ws-list ws-list--ground" aria-label="Needs action">
          {rows.map((r) => (
            <li key={r.k}>
              <div className="ops-need">
                <span className={`ws-pill ws-pill--${r.tone}`}>{r.tag}</span>
                <span className="ws-item-text">
                  <span className="ws-item-title">{r.title}</span>
                  <span className="ws-item-sub">{r.note}</span>
                </span>
                <button type="button" className="ops-link" aria-label={`Open ${r.label}`} onClick={r.open}>
                  Open →
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/* ------------------------------------------------------- recent actions */
function RecentActions({ d, error, go, has }) {
  const events = (d?.events || []).slice(0, 4);
  return (
    <section className="ops-section" aria-labelledby="ops-recent">
      <div className="ops-section-head">
        <h2 id="ops-recent" className="ops-h2">Recent staff actions</h2>
        {has('audit') ? (
          <button type="button" className="ops-link" onClick={() => go('audit')}>
            Audit log →
          </button>
        ) : null}
      </div>
      {error ? (
        <Err>{error}</Err>
      ) : !d ? (
        <Loading />
      ) : !events.length ? (
        <p className="ops-quiet-line">No staff action yet.</p>
      ) : (
        <ul className="ws-list ws-list--ground" aria-label="Recent staff actions">
          {events.map((e) => {
            const who = e.operator?.fullName || e.operator?.email || 'Staff';
            return (
              <li key={e.id}>
                <div className="ops-recent">
                  <span className="ops-initials ops-initials--sm" aria-hidden="true">{initials(who)}</span>
                  <span className="ws-item-text">
                    <span className="ws-item-sub ops-ink">
                      <strong>{who}</strong> {String(e.label || e.action || '').replace(/^./, (c) => c.toLowerCase())}
                      {e.accountName ? ` · ${e.accountName}` : ''}
                    </span>
                    {e.summary ? <span className="ws-item-sub">Reason: {e.summary}</span> : null}
                  </span>
                  <span className="ws-item-end">{ago(e.at)}</span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
