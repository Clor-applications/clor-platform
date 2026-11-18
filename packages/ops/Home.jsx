import React, { useEffect, useState } from 'react';
import { Building2, CalendarClock, Receipt, TriangleAlert } from 'lucide-react';

import { PageHead, ago } from '../../apps/admin/src/screens/wsKit';
import { Err, Loading, day, may } from './kit';
import { workerName } from './Health';
import { daysLeft } from './Trials';
import { inr } from './money';
import { opsAudit, opsHandover, opsHealth, opsHome, opsOverview, opsWriteHandover } from './api';

/**
 * Overview (operator console; R&D CLOR-05): four numbers about the customer
 * base, the background services, the work that needs a staff member today
 * (the things themselves, not a count of them), and what staff did last. Each part loads on its own, so a role that cannot see one
 * still gets the rest.
 */
const n = (count, one, many) => `${count} ${count === 1 ? one : many}`;
const KI = { accounts: Building2, paying: Receipt, trials: CalendarClock, legacy: TriangleAlert };
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

export function Home({ go, has, me }) {
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
      <Handover canWrite={may(me?.role, 'SUPPORT', 'SALES', 'BILLING')} />
      {/* What needs somebody comes before how the machinery is doing: it was under the services table, below the fold (owner, 17 Nov 2026: "info should be available right away"). */}
      <div className="ops-split">
        <NeedsAction d={today.d} error={today.error} go={go} has={has} />
        <RecentActions d={audit.d} error={audit.error} go={go} has={has} />
      </div>
      <Services d={health.d} error={health.error} go={go} has={has} />
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
    { k: 'accounts', label: 'Accounts', value: d.accounts, note: d.newThisWeek ? `+${d.newThisWeek} this week` : 'None new this week', open: () => go('customers') },
    { k: 'paying', label: 'Paying', value: paying, note: `${pct}% of accounts`, open: () => go('customers', { status: 'active' }) },
    {
      k: 'trials',
     
      label: 'Trials ending in 7 days',
      value: d.trialsEndingIn7d,
      note: d.trialsEndingIn7d ? 'Each owner is emailed before it ends' : 'No trial ends this week',
      state: d.trialsEndingIn7d ? 'warn' : null,
      open: () => (has('trials') ? go('trials') : go('customers', { status: 'trialing' })),
    },
    {
      k: 'legacy',
     
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
          <button key={t.k} type="button" className="ops-kpi" onClick={t.open}>
            <span className="ops-kpi-chip" aria-hidden="true">
              <Icon size={16} />
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

/* ------------------------------------------------------- needs you today */
const DAY = 86_400_000;
const renewIn = (at, now) => {
  const d = Math.ceil((new Date(at).getTime() - now) / DAY);
  return d <= 0 ? 'Today' : d === 1 ? 'Tomorrow' : `In ${d} days`;
};
const daysOverdue = (due, now) => {
  const d = Math.floor((now - new Date(due).getTime()) / DAY);
  return d < 1 ? 'due today' : n(d, 'day overdue', 'days overdue');
};

/**
 * The work itself, in groups, most pressing first (server: /ops/home `work`).
 * Each row opens the thing: the account's Subscription tab, the invoice, the
 * ticket. A group shows five; "See all" opens its list already filtered to the
 * same rows, and is left out where the list has no such filter yet.
 */
function workGroups(d, go, has, now) {
  const w = d.work || {};
  const items = (k) => w[k]?.items || [];
  const total = (k) => Math.max(w[k]?.total || 0, items(k).length);
  const seeAll = (k, open) => (total(k) > items(k).length ? { label: `See all ${total(k)}`, open } : null);
  return [
    {
      k: 'trials',
      title: 'Trials ending this week',
      more: seeAll('trials', () => (has('trials') ? go('trials', { ending: '7' }) : go('customers', { status: 'trialing' }))),
      rows: items('trials').map((t) => ({
        id: t.accountId,
        pill: [daysLeft(t.trialEndsAt, now).replace(/^./, (c) => c.toUpperCase()), 'warn'],
        title: t.customer || 'A customer',
        sub: `Trial ends ${day(t.trialEndsAt)}`,
        open: () => go('customers', {}, t.accountId, 'subscription'),
      })),
    },
    {
      k: 'invoices',
      title: 'Overdue invoices',
      more: seeAll('invoices', () => go('invoices', { status: 'OVERDUE' })),
      rows: items('invoices').map((i) => ({
        id: i.id,
        pill: ['Overdue', 'danger'],
        title: i.customer || 'A customer',
        sub: (
          <>
            <span className="ui-mono">{i.number || 'No number'}</span> · {daysOverdue(i.dueDate, now)}
          </>
        ),
        money: i.total,
        open: () => go('invoices', {}, i.id),
      })),
    },
    {
      k: 'tickets',
      title: 'Tickets: urgent or not taken',
      /* Tickets has no filter for these yet, so the link says what it opens and carries no number. */
      more: total('tickets') > items('tickets').length ? { label: 'All tickets', open: () => go('tickets') } : null,
      rows: items('tickets').map((t) => ({
        id: t.id,
        pill: t.priority === 'URGENT' ? ['Urgent', 'danger'] : ['Not taken', 'warn'],
        title: t.subject,
        sub: (
          <>
            <span className="ui-mono">{t.code}</span> · {t.customer || 'A customer'}
            {t.priority === 'URGENT' && !t.assigned ? ' · not taken' : ''}
          </>
        ),
        end: `Opened ${ago(t.createdAt)}`,
        open: () => go('tickets', {}, t.id),
      })),
    },
    {
      k: 'approvals',
      title: 'Approvals waiting',
      more: seeAll('approvals', () => go('approvals')),
      rows: items('approvals').map((a) => ({
        id: a.id,
        pill: ['Waiting', 'warn'],
        title: a.summary,
        sub: [a.kindWord, a.customer, `asked by ${a.askedBy}`].filter(Boolean).join(' · '),
        end: ago(a.createdAt),
        open: () => go('approvals'),
      })),
    },
    {
      k: 'payments',
      title: 'Failed payments',
      more: has('payments') && total('payments') > items('payments').length ? { label: 'Open Payments', open: () => go('payments') } : null,
      rows: items('payments').map((p) => ({
        id: p.id,
        pill: ['Failed', 'danger'],
        title: p.customer || p.what || 'A payment',
        sub: p.detail || p.what,
        money: p.amount,
        /* A payment nobody could match to a customer has only the Payments log to open. */
        open: () => (p.accountId ? go('customers', {}, p.accountId) : go('payments')),
      })),
    },
    {
      /* Round 55 (renewals B): paid plans renewing in the next 30 days, with the amount and when the customer last signed in. */
      k: 'renewals',
      title: 'Renewals in the next 30 days',
      more: total('renewals') > items('renewals').length ? { label: `See all ${total('renewals')}`, open: () => go('customers', { status: 'active' }) } : null,
      rows: items('renewals').map((r) => ({
        id: r.accountId,
        pill: [renewIn(r.renewsAt, now), 'info'],
        title: r.customer || 'A customer',
        sub: `Renews ${day(r.renewsAt)}${r.interval ? ` · ${r.interval === 'year' ? 'yearly' : 'monthly'}` : ''} · ${r.lastActiveAt ? `last active ${ago(r.lastActiveAt)}` : 'nobody has signed in'}`,
        money: r.amount != null ? r.amount : undefined,
        open: () => go('customers', {}, r.accountId, 'subscription'),
      })),
    },
  ].filter((g) => g.rows.length);
}

/** What Home still knows only as a number: each opens its list. */
function countRows(d, go, has) {
  const listed = (k) => Boolean(d.work?.[k]?.items?.length);
  return [
    d.alertsOpen
      ? { k: 'alerts', tag: 'Platform', tone: d.alertsCritical ? 'danger' : 'warn', label: 'Alerts', title: n(d.alertsOpen, 'alert is open', 'alerts are open'), note: d.alertsCritical ? `${n(d.alertsCritical, 'is urgent', 'are urgent')}` : 'Nothing urgent', open: () => go('alerts') }
      : null,
    /* Open tickets that are all taken and none urgent are not listed above, but customers still wait. */
    d.ticketsOpen && !listed('tickets')
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
    d.trialsEnding && !listed('trials')
      ? { k: 'trials', tag: 'Trials', tone: 'warn', label: 'Trials ending this week', title: n(d.trialsEnding, 'trial ends this week', 'trials end this week'), note: `${n(d.trialsEnding, 'trial ends', 'trials end')} in the next 7 days`, open: () => (has('trials') ? go('trials', { ending: '7' }) : go('customers', { status: 'trialing' })) }
      : null,
    d.failedPayments && !listed('payments')
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

function NeedsAction({ d, error, go, has }) {
  /* The moment the page opened: days left and days overdue are counted from it, not from each render. */
  const [now] = useState(() => Date.now());
  const groups = d ? workGroups(d, go, has, now) : [];
  const counts = d ? countRows(d, go, has) : [];
  return (
    <section className="ops-section" aria-labelledby="ops-needs">
      <h2 id="ops-needs" className="ops-h2">Needs you today</h2>
      {error ? (
        <Err>{error}</Err>
      ) : !d ? (
        <Loading />
      ) : !groups.length && !counts.length ? (
        <p className="ops-quiet-line">Nothing needs you today.</p>
      ) : (
        <>
          {groups.map((g) => (
            <div key={g.k} className="ops-section">
              <div className="ops-section-head">
                <h3 id={`ops-needs-${g.k}`} className="ws-item-title">{g.title}</h3>
                {g.more ? (
                  <button type="button" className="ops-link" aria-label={`${g.more.label}: ${g.title}`} onClick={g.more.open}>
                    {g.more.label} →
                  </button>
                ) : null}
              </div>
              <ul className="ws-list ws-list--ground" aria-labelledby={`ops-needs-${g.k}`}>
                {g.rows.map((r) => (
                  <li key={r.id}>
                    <div className="ops-need">
                      <span className={`ws-pill ws-pill--${r.pill[1]}`}>{r.pill[0]}</span>
                      <span className="ws-item-text">
                        <button type="button" className="ws-name-link justify-self-start text-left" onClick={r.open}>{r.title}</button>
                        <span className="ws-item-sub">{r.sub}</span>
                      </span>
                      {r.money != null ? (
                        <span className="ops-ink text-right tabular-nums">{inr(r.money)}</span>
                      ) : r.end ? (
                        <span className="ws-item-end">{r.end}</span>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          {counts.length ? (
            <div className="ops-section">
              {groups.length ? <h3 id="ops-needs-also" className="ws-item-title">Also waiting</h3> : null}
              <ul className="ws-list ws-list--ground" aria-label="Also waiting">
                {counts.map((r) => (
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
            </div>
          ) : null}
        </>
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

/* -------------------------------------------------------------- handover */
/**
 * Round 55 (handover A): what one shift leaves for the next, the newest note,
 * with who wrote it and when. Writing a new one keeps the old ones on record.
 */
function Handover({ canWrite }) {
  const [state, setState] = useState({ note: undefined, error: '' });
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState('');
  useEffect(() => {
    let live = true;
    opsHandover()
      .then((r) => live && setState({ note: r.note || null, error: '' }))
      .catch((e) => live && setState({ note: null, error: String(e?.message || e) }));
    return () => {
      live = false;
    };
  }, []);
  const save = async () => {
    setBusy(true);
    setSaveError('');
    try {
      const r = await opsWriteHandover(draft.trim());
      setState({ note: r.note, error: '' });
      setDraft(null);
    } catch (e) {
      setSaveError(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  };
  const { note, error } = state;
  return (
    <section className="ops-section" aria-labelledby="ops-handover">
      <div className="ops-section-head">
        <h2 id="ops-handover" className="ops-h2">Handover</h2>
        {canWrite && draft === null && note !== undefined ? (
          <button type="button" className="ops-link" onClick={() => setDraft('')}>
            {note ? 'Write a new note' : 'Write a note'}
          </button>
        ) : null}
      </div>
      {error ? (
        <Err>{error}</Err>
      ) : note === undefined ? (
        <Loading />
      ) : draft !== null ? (
        <div className="grid gap-2">
          <label className="grid gap-1">
            <span className="sr-only">Handover note</span>
            <textarea className="ui-input" rows={4} maxLength={2000} value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="What the next person should pick up: customers waiting, calls promised, anything half done." />
          </label>
          <Err>{saveError}</Err>
          <div className="flex gap-2">
            <button type="button" className="ws-btn ws-btn--primary" disabled={busy || draft.trim().length < 3} onClick={save}>
              {busy ? 'Saving…' : 'Save note'}
            </button>
            <button type="button" className="ws-btn ws-btn--quiet" onClick={() => (setDraft(null), setSaveError(''))}>Cancel</button>
          </div>
        </div>
      ) : note ? (
        <div className="grid gap-1">
          <p className="ops-ink" style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{note.body}</p>
          <span className="ws-item-sub">{note.mine ? 'You' : note.by} · {ago(note.at)}</span>
        </div>
      ) : (
        <p className="ops-quiet-line">No handover note yet.</p>
      )}
    </section>
  );
}
