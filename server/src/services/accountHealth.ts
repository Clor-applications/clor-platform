import { platformPrisma } from '../utils/platformPrisma.js';
import { peoplePrisma } from '../utils/peoplePrisma.js';

/**
 * The Workspace Overview's account-wide figures that are not one company's:
 * what the account is set up as (companies, branches, GST registrations, cost
 * centres), what it pays each month, and whether the things that feed the
 * suite from outside (readers, on-site connectors, e-mail) are flowing.
 *
 * Read only from rows that exist. A figure the product cannot know — a price
 * nobody has set, a check no job has run — comes back as null or is left
 * out, never as a zero that looks like an answer.
 */

type Item = { appCode: string; seats: number | null; unitAmount: number | null; priceModel: string | null };

/**
 * What the subscription costs a month, in INR minor units (paise), from its
 * items. Pricing is set by CLOR per account and may be undecided: an item
 * with no price model, no amount, or per-seat with no seats cannot be summed,
 * so the run rate is null and the item is named in `unpriced`. A yearly
 * subscription is spread over twelve months; one with no interval (granted by
 * hand) only has a run rate when everything on it is free.
 */
export function monthlyRunRate(sub: { status: string; billingInterval: string | null; currency: string; items: Item[] } | null) {
  if (!sub) return null;
  const unpriced: string[] = [];
  let total = 0;
  for (const i of sub.items) {
    if (i.priceModel === 'free') continue;
    const unit = i.unitAmount;
    if (unit == null || !i.priceModel) {
      unpriced.push(i.appCode);
      continue;
    }
    if (i.priceModel === 'per_seat') {
      if (i.seats == null) {
        unpriced.push(i.appCode);
        continue;
      }
      total += unit * i.seats;
    } else total += unit;
  }
  const interval = sub.billingInterval;
  let monthly: number | null = unpriced.length ? null : total;
  if (monthly != null && monthly > 0) {
    if (interval === 'year') monthly = Math.round(monthly / 12);
    else if (interval !== 'month') monthly = null;
  }
  /* A cancelled or paused subscription runs at nothing, whatever its items say. */
  if (sub.status === 'cancelled' || sub.status === 'paused') monthly = 0;
  return { monthly, currency: sub.currency || 'INR', interval, status: sub.status, unpriced };
}

/** Companies, branches, GST registrations and cost centres across the account's open companies. */
export async function accountEntities(accountId: string, orgIds: string[]) {
  const [branches, costCentres] = await Promise.all([
    platformPrisma.branch.findMany({ where: { accountId, orgId: { in: orgIds }, isActive: true }, select: { orgId: true, gstin: true } }),
    peoplePrisma.costCenter.count({ where: { accountId, orgId: { in: orgIds }, isActive: true } }),
  ]);
  /* A GSTIN is one registration however many branches share it (a state's offices file under one). */
  const gstins = new Set(branches.map((b) => String(b.gstin || '').trim().toUpperCase()).filter(Boolean));
  const withGstin = new Set(branches.filter((b) => String(b.gstin || '').trim()).map((b) => b.orgId));
  return {
    companies: orgIds.length,
    branches: branches.length,
    taxProfiles: gstins.size,
    companiesWithoutGstin: orgIds.filter((id) => !withGstin.has(id)).length,
    costCentres,
  };
}

const DAY = 86_400_000;

/**
 * Whether what feeds the suite from outside is flowing, one line per source
 * the account actually has. Attendance readers and on-site connectors are
 * judged by the reader-check job (services/attendance/readerHealth.ts), whose
 * open alerts are read here rather than re-judged; e-mail and Tally postings
 * by their failures over the last seven days. An account with none of these
 * has nothing to sync, and says so.
 */
export async function dataHealth(accountId: string, orgIds: string[], now = new Date()) {
  const since = new Date(now.getTime() - 7 * DAY);
  const inAccount = { accountId, orgId: { in: orgIds } };
  const [readers, agents, alerts, mailFailed, mailSent, jobsRecent, jobsFailed, jobsWaiting] = await Promise.all([
    peoplePrisma.attendanceDevice.count({ where: { ...inAccount, isActive: true } }),
    peoplePrisma.siteAgent.findMany({ where: { ...inAccount, isActive: true }, select: { lastSeenAt: true } }),
    peoplePrisma.readerAlert.findMany({ where: { ...inAccount, resolvedAt: null }, select: { kind: true, severity: true, title: true, orgId: true, openedAt: true }, orderBy: { openedAt: 'desc' } }),
    /* Mail an account sends is not always one company's (an invitation), so it is counted by account. */
    platformPrisma.emailOutbox.count({ where: { accountId, status: 'FAILED', updatedAt: { gte: since } } }),
    platformPrisma.emailOutbox.count({ where: { accountId, status: 'SENT', sentAt: { gte: since } } }),
    peoplePrisma.agentJob.count({ where: { ...inAccount, createdAt: { gte: since } } }),
    peoplePrisma.agentJob.count({ where: { ...inAccount, status: 'FAILED', createdAt: { gte: since } } }),
    peoplePrisma.agentJob.count({ where: { ...inAccount, status: { in: ['PENDING', 'SENT'] }, createdAt: { lt: new Date(now.getTime() - DAY) } } }),
  ]);
  const connectorAlerts = alerts.filter((a) => a.kind.startsWith('connector'));
  const readerAlerts = alerts.filter((a) => !a.kind.startsWith('connector'));
  const sources = [];
  if (readers) sources.push({ key: 'readers', label: 'Attendance readers', total: readers, issues: readerAlerts.length });
  if (agents.length) {
    const seen = agents.map((a) => a.lastSeenAt).filter(Boolean) as Date[];
    sources.push({ key: 'connectors', label: 'On-site connectors', total: agents.length, issues: connectorAlerts.length, lastSeenAt: seen.length ? new Date(Math.max(...seen.map((d) => d.getTime()))) : null });
  }
  if (jobsRecent || jobsWaiting) sources.push({ key: 'tally', label: 'Tally postings', total: jobsRecent, issues: jobsFailed + jobsWaiting, failed: jobsFailed, waiting: jobsWaiting });
  if (mailSent || mailFailed) sources.push({ key: 'email', label: 'E-mail delivery', total: mailSent + mailFailed, issues: mailFailed });
  const issues = sources.reduce((n, s) => n + s.issues, 0);
  return {
    status: sources.length ? (issues ? 'attention' : 'ok') : 'none',
    issues,
    sources,
    /* The most serious few, for a line each on the Overview. */
    alerts: alerts.slice(0, 5).map((a) => ({ title: a.title, severity: a.severity, orgId: a.orgId, since: a.openedAt })),
  };
}

/**
 * What the Workspace should warn about the subscription itself (Workspace plan
 * 11 Nov 2026, "expiring subscription"): a trial about to end, a plan set to
 * stop at the end of its period, a lapsed one, and CLOR invoices not yet paid.
 * Dates are the subscription's own; nothing is guessed when one is missing.
 */
export const ENDING_SOON_DAYS = 14;


export function subscriptionWatch(
  sub: { status: string; trialEndsAt: Date | null; currentPeriodEnd: Date | null; cancelAtPeriodEnd: boolean } | null,
  invoices: { status: string; dueDate: Date | null; total: number }[],
  now = new Date(),
) {
  const unpaid = invoices.filter((i) => i.status === 'ISSUED');
  const overdue = unpaid.filter((i) => i.dueDate && i.dueDate < now);
  const bills = { unpaid: unpaid.length, overdue: overdue.length, due: unpaid.reduce((n, i) => n + (i.total || 0), 0) };
  if (!sub) return { status: null, warn: null, endsAt: null, daysLeft: null, renewsAt: null, invoices: bills };
  const status = sub.status;
  const daysTo = (d: Date | null) => (d ? Math.ceil((d.getTime() - now.getTime()) / DAY) : null);
  let warn: 'lapsed' | 'trial-ending' | 'ending' | null = null;
  let endsAt: Date | null = null;
  if (['past_due', 'unpaid', 'canceled', 'cancelled', 'expired', 'paused'].includes(status)) warn = 'lapsed';
  else if (status === 'trialing' && sub.trialEndsAt) {
    endsAt = sub.trialEndsAt;
    if ((daysTo(endsAt) ?? Infinity) <= ENDING_SOON_DAYS) warn = 'trial-ending';
  } else if (sub.cancelAtPeriodEnd && sub.currentPeriodEnd) {
    endsAt = sub.currentPeriodEnd;
    if ((daysTo(endsAt) ?? Infinity) <= ENDING_SOON_DAYS) warn = 'ending';
  }
  return {
    status,
    warn,
    endsAt,
    daysLeft: daysTo(endsAt),
    renewsAt: !sub.cancelAtPeriodEnd && status === 'active' ? sub.currentPeriodEnd : null,
    invoices: bills,
  };
}
