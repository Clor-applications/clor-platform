import React, { useCallback, useEffect, useState } from 'react';
import { confirmDialog } from '@ui/components/ui/notify';

import { PageHead, ago } from '../../apps/admin/src/screens/wsKit';
import { Err, Loading, Tabs, day, may, useRowBusy, errorWords } from './kit';
import { workerName } from './Health';
import { daysLeft } from './Trials';
import { inr } from './money';
import { opsAudit, opsHandover, opsHealth, opsHome, opsMarkQueue, opsOverview, opsUnmarkQueue, opsWriteHandover } from './api';
import { Button } from '@ui/components/ui/Primitives';
import { FigureLedger, PartsRing, ViewSwitch } from '@ui/components/ui/FigureViews';

/**
 * Overview (operator console; R&D CLOR-05): the customer base as one figure
 * and a ledger, sign-ups over the month, the background services, the work that needs a staff member today
 * (the things themselves, not a count of them), and what staff did last. Each part loads on its own, so a role that cannot see one
 * still gets the rest.
 */
const n = (count, one, many) => `${count} ${count === 1 ? one : many}`;
const nf = (count, one, many) => `${Number(count).toLocaleString('en-IN')} ${count === 1 ? one : many}`;
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
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    fetch()
      .then((d) => live && setState({ d, error: '' }))
      .catch((e) => live && setState({ d: null, error: errorWords(e, 'load this part of Overview') }));
    return () => {
      live = false;
    };
  }, [fetch, tick]);
  const reload = useCallback(() => {
    setState({ d: null, error: '' });
    setTick((t) => t + 1);
  }, []);
  return { ...state, reload };
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
      <Figures d={ov.d} error={ov.error} onRetry={ov.reload} go={go} has={has} />
      <Handover canWrite={may(me?.role, 'SUPPORT', 'SALES', 'BILLING')} />
      {/* What needs somebody comes before how the machinery is doing: it was under the services table, below the fold (owner, 17 Nov 2026: "info should be available right away"). */}
      <div className="ops-split">
        <NeedsAction d={today.d} error={today.error} onRetry={today.reload} go={go} has={has} canMark={may(me?.role, 'SUPPORT', 'SALES', 'BILLING')} />
        <RecentActions d={audit.d} error={audit.error} onRetry={audit.reload} go={go} has={has} />
      </div>
      <Services d={health.d} error={health.error} onRetry={health.reload} go={go} has={has} />
    </>
  );
}

/* --------------------------------------------------------------- figures */
const SHORT = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const shortDay = (iso) => SHORT.format(new Date(`${iso}T00:00:00Z`));

/**
 * New accounts over the last 30 days, two ways (style H): day by day, and in
 * weeks counted back from today. The newest column is drawn strong.
 */
export function signupViews(signups = []) {
  if (!signups.length) return [];
  const total = signups.reduce((s, d) => s + d.count, 0);
  const days = signups.map((d, i) => ({
    key: d.day,
    label: shortDay(d.day),
    /* A date under every seventh column, counted back from today: one number fits a column. */
    tick: (signups.length - 1 - i) % 7 === 0 ? String(Number(d.day.slice(8, 10))) : '',
    value: d.count,
    words: n(d.count, 'new account', 'new accounts'),
  }));
  const weeks = [];
  for (let end = signups.length; end > 0; end -= 7) {
    const part = signups.slice(Math.max(0, end - 7), end);
    const c = part.reduce((s, d) => s + d.count, 0);
    weeks.unshift({ key: part[0].day, label: `${shortDay(part[0].day)} to ${shortDay(part[part.length - 1].day)}`, tick: shortDay(part[0].day), value: c, words: n(c, 'new account', 'new accounts') });
  }
  const week = weeks[weeks.length - 1].value;
  return [
    { key: 'days', label: 'Last 30 days', value: n(total, 'new account', 'new accounts'), short: total.toLocaleString('en-IN'), note: 'Sign-ups day by day', colsLabel: 'New accounts, day by day', points: days },
    { key: 'weeks', label: 'Week by week', value: n(week, 'new account', 'new accounts'), short: `${week} this week`, note: 'The last seven days, against the weeks before', colsLabel: 'New accounts, week by week', points: weeks },
  ];
}

/**
 * The customer base as one big figure and a ledger (owner, 22 Nov 2026, style G,
 * replacing the four tiles): accounts in all, and under it the shares that need
 * reading. Each row opens its list; a row at nought is left out.
 */
function Figures({ d, error, onRetry, go, has }) {
  if (error) return <Err onRetry={onRetry}>{error}</Err>;
  if (!d) return <Loading />;
  const all = d.accounts || 0;
  if (!all) return null;
  const paying = d.paying ?? 0;
  const share = (v) => (all ? (v || 0) / all : 0);
  const pct = Math.round(share(paying) * 100);
  const people = [d.companies ? nf(d.companies, 'company', 'companies') : null, d.users ? nf(d.users, 'person', 'people') : null].filter(Boolean).join(', ');
  const hero = {
    label: 'Customer accounts',
    value: all.toLocaleString('en-IN'),
    words: people ? `${people} signed up` : 'Accounts on CLOR',
    pill: d.newThisWeek ? `+${d.newThisWeek} this week` : 'None new this week',
    tone: d.newThisWeek ? 'pos' : undefined,
  };
  const rows = [
    { key: 'paying', label: 'Paying', sub: `${pct}% of accounts`, value: paying, share: share(paying), tone: 'pos', onClick: () => go('customers', { status: 'active' }) },
    {
      key: 'trials',
      label: 'Trials ending in 7 days',
      sub: 'Each owner is emailed before it ends',
      value: d.trialsEndingIn7d,
      share: share(d.trialsEndingIn7d),
      tone: 'warn',
      onClick: () => (has('trials') ? go('trials') : go('customers', { status: 'trialing' })),
    },
    { key: 'legacy', label: 'Older accounts with no plan', sub: 'Every app is open to them: move each to a plan', value: d.legacy ?? 0, share: share(d.legacy), tone: 'neg', onClick: () => go('customers') },
    { key: 'suspended', label: 'Suspended', sub: 'Signed out until staff bring them back', value: d.suspended ?? 0, share: share(d.suspended), onClick: () => go('customers', { status: 'suspended' }) },
  ];
  const views = signupViews(d.signups);
  return (
    <>
      <FigureLedger label="Customers in numbers" hero={hero} rows={rows} />
      {views.length && views[0].points.some((p) => p.value > 0) ? (
        <section className="ops-section" aria-labelledby="ops-signups">
          <div className="ops-section-head">
            <h2 id="ops-signups" className="ops-h2">Sign-ups</h2>
          </div>
          <ViewSwitch views={views} label="Sign-ups, how to look" />
        </section>
      ) : null}
    </>
  );
}

/* -------------------------------------------------------------- services */
function Services({ d, error, onRetry, go, has }) {
  return (
    <section className="ops-section" aria-labelledby="ops-services">
      <div className="ops-section-head">
        <h2 id="ops-services" className="ops-h2">Services</h2>
        {has('health') ? (
          <button type="button" className="ops-link" onClick={() => go('health')}>
            Background jobs →
          </button>
        ) : null}
      </div>
      {error ? (
        <Err onRetry={onRetry}>{error}</Err>
      ) : !d ? (
        <Loading />
      ) : !d.workers.length ? (
        <p className="ws-card-blurb">No background job has run in the last week.</p>
      ) : (
        <>
        <PartsRing
          label="Background services now"
          middle={d.workers.length}
          middleWords={d.workers.length === 1 ? 'service' : 'services'}
          parts={[
            { key: 'failing', label: 'Failing now', value: d.workers.filter((w) => w.state === 'failing').length, tone: 'neg' },
            { key: 'late', label: 'Running late', value: d.workers.filter((w) => w.state === 'late').length, tone: 'warn' },
            { key: 'ok', label: 'Running well', value: d.workers.filter((w) => w.state === 'ok').length, tone: 'pos' },
          ]}
        />
        <div className="ws-table-wrap">
          <table className="ws-table">
            <caption className="sr-only">Background services</caption>
            <thead>
              <tr>
                <th>Service</th>
                <th>Now</th>
                <th className="num">Failed, last 24 hours</th>
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
        </>
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
      title: d.ticketsOverADay ? `Tickets: urgent or not taken · ${n(d.ticketsOverADay, 'has', 'have')} waited over a day` : 'Tickets: urgent or not taken',
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
    {
      /* A paying customer nobody has signed in to for two weeks: the money shown is what leaves if they do. */
      k: 'quiet',
      title: 'Paying customers gone quiet',
      more: total('quiet') > items('quiet').length ? { label: `See all ${total('quiet')}`, open: () => go('customers', { status: 'active' }) } : null,
      rows: items('quiet').map((q) => ({
        id: q.accountId,
        pill: ['Quiet', 'warn'],
        title: q.customer || 'A customer',
        sub: q.lastActiveAt ? `Nobody has signed in since ${day(q.lastActiveAt)}` : 'Nobody has ever signed in',
        money: q.monthly != null ? q.monthly : undefined,
        end: 'a month',
        open: () => go('customers', {}, q.accountId),
      })),
    },
    {
      /* A trial opened a week or more ago that nobody came back to after the first day. */
      k: 'stalled',
      title: 'Trials nobody came back to',
      more: total('stalled') > items('stalled').length ? { label: `See all ${total('stalled')}`, open: () => (has('trials') ? go('trials') : go('customers', { status: 'trialing' })) } : null,
      rows: items('stalled').map((t) => ({
        id: t.accountId,
        pill: ['Stalled', 'warn'],
        title: t.customer || 'A customer',
        sub: `Signed up ${day(t.signedUpAt)} · ${t.lastActiveAt ? 'not seen since that day' : 'never signed in'}`,
        end: `Trial ends ${day(t.trialEndsAt)}`,
        open: () => go('customers', {}, t.accountId),
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

/*
 * The queue by whose work it is (20 Nov 2026): Sales looks at customers, Finance at money, Support at
 * tickets, whoever is on call at the platform. Every group and every count row belongs to one; one
 * not named here is a customer matter.
 */
const QUEUE_PART = {
  trials: 'customers', quiet: 'customers', stalled: 'customers', suspended: 'customers',
  invoices: 'money', payments: 'money', renewals: 'money', approvals: 'money', overdue: 'money',
  tickets: 'support',
  alerts: 'platform', emails: 'platform',
};
const partOf = (k) => QUEUE_PART[k] || 'customers';
const QUEUE_FILTERS = [['all', 'All'], ['mine', 'Mine'], ['customers', 'Customers'], ['money', 'Money'], ['support', 'Support'], ['platform', 'Platform']];

function NeedsAction({ d, error, onRetry, go, has, canMark = false }) {
  /* The moment the page opened: days left and days overdue are counted from it, not from each render. */
  const [now] = useState(() => Date.now());
  /*
   * Marks on a row (server: /ops/home/marks). "Mine" says who is on it, for everybody; "Not today" puts
   * the row away for this staff member until tomorrow. The page's own copy after a change, else what it loaded with.
   */
  const [changed, setChanged] = useState(null);
  const [showLater, setShowLater] = useState(false);
  const [markError, setMarkError] = useState('');
  const marks = changed || d?.marks || { mine: {}, later: [] };
  const later = new Set(marks.later || []);
  const rowBusy = useRowBusy();
  const mark = (fn, key, kind) => {
    setMarkError('');
    return rowBusy.run(key, () =>
      fn(key, kind)
        .then((r) => setChanged(r?.marks || { mine: {}, later: [] }))
        .catch((e) => setMarkError(errorWords(e, 'mark this row')))
    );
  };
  /* Taking a row someone else is on asks first, by name: they stop being shown as on it. */
  const takeOver = async (key, r, holder) => {
    if (rowBusy.busy(key)) return;
    const ok = await confirmDialog({
      title: `Take over from ${holder.name}?`,
      message: `${r.title}${r.sub ? ` (${r.sub})` : ''}. It shows as yours from now on, and ${holder.name} is no longer shown as on it.`,
      confirmLabel: 'Take over',
      cancelLabel: 'Leave it with them',
      tone: 'primary',
    });
    if (ok) mark(opsMarkQueue, key, 'MINE');
  };
  const all = d ? workGroups(d, go, has, now) : [];
  const putAway = all.reduce((sum, g) => sum + g.rows.filter((r) => later.has(`${g.k}:${r.id}`)).length, 0);
  const [filter, setFilter] = useState('all');
  const visible = all.map((g) => ({ ...g, rows: showLater ? g.rows : g.rows.filter((r) => !later.has(`${g.k}:${r.id}`)) })).filter((g) => g.rows.length);
  const allCounts = d ? countRows(d, go, has) : [];
  const isMine = (g, r) => Boolean(marks.mine?.[`${g.k}:${r.id}`]?.me);
  /* How many rows each filter holds, so an empty one is not offered. "Mine" counts rows taken; a count row cannot be taken. */
  const size = {
    all: visible.reduce((n0, g) => n0 + g.rows.length, 0) + allCounts.length,
    mine: visible.reduce((n0, g) => n0 + g.rows.filter((r) => isMine(g, r)).length, 0),
  };
  for (const g of visible) size[partOf(g.k)] = (size[partOf(g.k)] || 0) + g.rows.length;
  for (const c of allCounts) size[partOf(c.k)] = (size[partOf(c.k)] || 0) + 1;
  const offered = QUEUE_FILTERS.filter(([k]) => k === 'all' || size[k]);
  /* A filter that emptied (its last row was let go, or put away) falls back to everything. */
  const on = offered.some(([k]) => k === filter) ? filter : 'all';
  const groups = on === 'all' ? visible : on === 'mine' ? visible.map((g) => ({ ...g, rows: g.rows.filter((r) => isMine(g, r)) })).filter((g) => g.rows.length) : visible.filter((g) => partOf(g.k) === on);
  const counts = on === 'all' ? allCounts : on === 'mine' ? [] : allCounts.filter((c) => partOf(c.k) === on);
  return (
    <section className="ops-section" aria-labelledby="ops-needs">
      <h2 id="ops-needs" className="ops-h2">Needs you today</h2>
      {error ? (
        <Err onRetry={onRetry}>{error}</Err>
      ) : !d ? (
        <Loading />
      ) : !groups.length && !counts.length ? (
        <p className="ops-quiet-line">{putAway ? 'Nothing else needs you today.' : 'Nothing needs you today.'}</p>
      ) : (
        <>
          {offered.length > 2 ? <Tabs label="Whose work" value={on} onChange={setFilter} tabs={offered.map(([k, name]) => [k, k === 'all' ? name : `${name} (${size[k]})`])} /> : null}
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
                {g.rows.map((r) => {
                  const key = `${g.k}:${r.id}`;
                  const holder = marks.mine?.[key];
                  const away = later.has(key);
                  const pending = rowBusy.busy(key);
                  return (
                  <li key={r.id}>
                    <div className={`ops-need${canMark || holder ? ' ops-need--marks' : ''}`}>
                      <span className={`ws-pill ws-pill--${r.pill[1]}`}>{r.pill[0]}</span>
                      <span className="ws-item-text">
                        <button type="button" className="ws-name-link justify-self-start text-left" onClick={r.open}>{r.title}</button>
                        <span className="ws-item-sub">{r.sub}</span>
                      </span>
                      {r.money != null ? (
                        <span className="ops-ink text-right tabular-nums">{inr(r.money)}{r.end ? <span className="ws-item-end"> {r.end}</span> : null}</span>
                      ) : r.end ? (
                        <span className="ws-item-end">{r.end}</span>
                      ) : (
                        <span />
                      )}
                      {canMark || holder ? (
                        <span className="ops-need-marks">
                          {holder ? <span className="ws-item-sub">{holder.me ? 'Yours' : `${holder.name} is on it`}</span> : null}
                          {canMark ? (
                            <>
                              {holder?.me ? (
                                <button type="button" className="ops-link" disabled={pending} aria-label={`Let go: ${r.title}`} onClick={() => mark(opsUnmarkQueue, key, 'MINE')}>Let go</button>
                              ) : (
                                <button type="button" className="ops-link" disabled={pending} aria-label={`${holder ? 'Take over' : 'Mine'}: ${r.title}`} onClick={() => (holder ? takeOver(key, r, holder) : mark(opsMarkQueue, key, 'MINE'))}>{pending ? 'Saving…' : holder ? 'Take over' : 'Mine'}</button>
                              )}
                              {away ? (
                                <button type="button" className="ops-link" disabled={pending} aria-label={`Bring back: ${r.title}`} onClick={() => mark(opsUnmarkQueue, key, 'LATER')}>Bring back</button>
                              ) : (
                                <button type="button" className="ops-link" disabled={pending} aria-label={`Not today: ${r.title}`} onClick={() => mark(opsMarkQueue, key, 'LATER')}>Not today</button>
                              )}
                            </>
                          ) : null}
                        </span>
                      ) : null}
                    </div>
                  </li>
                  );
                })}
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
      <Err>{markError}</Err>
      {putAway ? (
        <p className="ops-quiet-line" role="status">
          {n(putAway, 'row', 'rows')} put away until tomorrow.{' '}
          <button type="button" className="ops-link" onClick={() => setShowLater((v) => !v)}>{showLater ? 'Hide them' : 'Show them'}</button>
        </p>
      ) : null}
      {d?.yesterday ? (
        <p className="ops-quiet-line" aria-label="Yesterday">
          Yesterday: {n(d.yesterday.signUps, 'sign-up', 'sign-ups')} · {n(d.yesterday.demos, 'demo request', 'demo requests')} · <span className="tabular-nums">{inr(d.yesterday.collected)}</span> collected
          {d.yesterday.invoicesPaid ? ` on ${n(d.yesterday.invoicesPaid, 'invoice', 'invoices')}` : ''} · {n(d.yesterday.lost, 'customer left', 'customers left')}
        </p>
      ) : null}
    </section>
  );
}

/* ------------------------------------------------------- recent actions */
function RecentActions({ d, error, onRetry, go, has }) {
  const events = (d?.events || []).slice(0, 4);
  return (
    <section className="ops-section" aria-labelledby="ops-recent">
      <div className="ops-section-head">
        <h2 id="ops-recent" className="ops-h2">Recent staff actions</h2>
        {has('audit') ? (
          <button type="button" className="ops-link" onClick={() => go('audit')}>
            Staff audit log →
          </button>
        ) : null}
      </div>
      {error ? (
        <Err onRetry={onRetry}>{error}</Err>
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
                    {/* The field-by-field detail stays in the Audit log; here it read as raw fields (QA, 19 Nov 2026). */}
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
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    opsHandover()
      .then((r) => live && setState({ note: r.note || null, error: '' }))
      .catch((e) => live && setState({ note: null, error: errorWords(e, 'load the handover note') }));
    return () => {
      live = false;
    };
  }, [tick]);
  const retry = () => {
    setState({ note: undefined, error: '' });
    setTick((t) => t + 1);
  };
  const save = async () => {
    setBusy(true);
    setSaveError('');
    try {
      const r = await opsWriteHandover(draft.trim());
      setState({ note: r.note, error: '' });
      setDraft(null);
    } catch (e) {
      setSaveError(errorWords(e, 'save the handover note'));
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
        <Err onRetry={retry}>{error}</Err>
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
            <Button plain className="ws-btn ws-btn--primary" loading={busy} disabled={draft.trim().length < 3} onClick={save}>
              Save note
            </Button>
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
