import { platformPrisma } from '../../utils/platformPrisma.js';
import { peoplePrisma } from '../../utils/peoplePrisma.js';
import { outsideTenant } from '../../utils/tenantScope.js';
import { exclusive, leaseFor } from '../jobLease.js';
import { registerJob } from '../jobRegistry.js';
import { sendTemplate } from '../mailer.js';
import { READER_OFFLINE_MS, workerLines } from './systemHealth.js';
import { ticketCode } from '../support/tickets.js';
import { customerTitle } from '../../routes/ops.js';
import { apiErrorsSince } from './apiErrors.js';

/**
 * Alerts for CLOR staff (Ops plan P1). Every ten minutes the job looks at what
 * is true now, raises an alert for each new problem, keeps the open ones fresh,
 * and closes those that cleared. New alerts are mailed once, in one message
 * per person per run, to the staff they concern (owners get every one).
 *
 * Each rule reads counts and names only, never a customer's business records.
 */

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
export const ALERT_EVERY_MS = 10 * MIN;
/** Thresholds, in one place so the console can say them. */
export const RULES = {
  emailsFailingPerHour: 5,
  webhooksFailingPerDay: 10,
  urgentTicketMinutes: 60,
  ticketWaitHours: 24,
  trialEndingDays: 3,
  /** This many jobs late together means the runner stopped, not each job. */
  lateJobsMeansStopped: 3,
  /** This many failed requests in a quarter of an hour is an urgent alert; one or two are in Error Reporting only. */
  apiErrorsPerQuarterHour: 5,
};

export type Finding = {
  key: string;
  kind: 'worker' | 'email' | 'webhook' | 'readers' | 'closure' | 'invoice' | 'ticket' | 'trial' | 'errors';
  severity: 'critical' | 'warning';
  audience: 'SUPPORT' | 'BILLING' | 'SALES';
  title: string;
  detail?: string | null;
  accountId?: string | null;
  link?: { page: string; id?: string; tab?: string; params?: Record<string, string> } | null;
};

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const jobName = (w: string) => w.replace(/[._-]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();

async function customerNames(ids: string[]) {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return new Map<string, string>();
  const [accts, owners] = await Promise.all([
    platformPrisma.account.findMany({ where: { id: { in: unique } }, select: { id: true, name: true, orgs: { select: { name: true }, orderBy: { createdAt: 'asc' }, take: 1 } } }),
    platformPrisma.accountMembership.findMany({ where: { accountId: { in: unique }, role: 'OWNER', status: 'ACTIVE' }, select: { accountId: true, userId: true } }),
  ]);
  const users = owners.length ? await platformPrisma.user.findMany({ where: { id: { in: owners.map((o) => o.userId) } }, select: { id: true, fullName: true } }) : [];
  const ownerName = new Map(owners.map((o) => [o.accountId, users.find((u) => u.id === o.userId)?.fullName || null]));
  return new Map(accts.map((a) => [a.id, customerTitle(a.name, ownerName.get(a.id), a.orgs[0]?.name)]));
}

/** What is wrong right now. Pure reads. */
export async function collectFindings(now = Date.now()): Promise<Finding[]> {
  const out: Finding[] = [];
  const at = (ms: number) => new Date(now - ms);

  const [runs, emailsFailedHour, emailsStuck, webhooksFailed, offline, closures, overdue, tickets, trials] = await Promise.all([
    platformPrisma.jobRun.findMany({ where: { startedAt: { gt: at(7 * DAY) } }, orderBy: { startedAt: 'desc' }, take: 2000, select: { worker: true, startedAt: true, finishedAt: true, outcome: true, error: true } }),
    platformPrisma.emailOutbox.count({ where: { status: 'FAILED', createdAt: { gt: at(HOUR) } } }),
    platformPrisma.emailOutbox.count({ where: { status: 'QUEUED', createdAt: { lt: at(HOUR) } } }),
    peoplePrisma.webhookDelivery.count({ where: { status: { in: ['FAILED', 'DEAD'] }, createdAt: { gt: at(DAY) } } }),
    peoplePrisma.attendanceDevice.groupBy({ by: ['accountId'], where: { isActive: true, lastSeenAt: { lt: at(READER_OFFLINE_MS) } }, _count: { _all: true } }),
    platformPrisma.orgClosure.count({ where: { purgeError: { not: null }, deletedAt: null } }),
    platformPrisma.billingInvoice.findMany({ where: { status: 'ISSUED', dueDate: { lt: new Date(now) } }, select: { id: true, number: true, accountId: true, dueDate: true, total: true }, take: 200 }),
    platformPrisma.supportTicket.findMany({ where: { status: 'OPEN' }, select: { id: true, number: true, subject: true, accountId: true, priority: true, lastCustomerAt: true, createdAt: true }, take: 500 }),
    platformPrisma.subscription.findMany({ where: { status: 'trialing', trialEndsAt: { gt: new Date(now), lt: at(-RULES.trialEndingDays * DAY) } }, select: { accountId: true, trialEndsAt: true }, take: 500 }),
  ]);

  const lines = workerLines(runs, now);
  for (const w of lines) {
    if (w.state === 'failing') out.push({ key: `worker:${w.worker}`, kind: 'worker', severity: 'critical', audience: 'SUPPORT', title: `Background job failing: ${jobName(w.worker)}`, detail: w.lastError || 'Its last run did not finish.', link: { page: 'health' } });
  }
  /* Many jobs late at once is one problem, the job runner or its scheduler stopped: one urgent alert, not one per job. */
  const late = lines.filter((w) => w.state === 'late');
  if (late.length >= RULES.lateJobsMeansStopped)
    out.push({ key: 'workers-late', kind: 'worker', severity: 'critical', audience: 'SUPPORT', title: `${late.length} background jobs are late: the job runner may have stopped`, detail: `Check the scheduler that wakes the jobs. Late: ${late.slice(0, 6).map((w) => jobName(w.worker)).join(', ')}${late.length > 6 ? '…' : '.'}`, link: { page: 'health' } });
  else
    for (const w of late) out.push({ key: `worker-late:${w.worker}`, kind: 'worker', severity: 'warning', audience: 'SUPPORT', title: `Background job late: ${jobName(w.worker)}`, detail: `Usually runs ${w.usualGapMinutes != null && w.usualGapMinutes >= 60 ? `about every ${Math.round(w.usualGapMinutes / 60)} h` : `about every ${w.usualGapMinutes} min`}.`, link: { page: 'health' } });
  if (emailsFailedHour >= RULES.emailsFailingPerHour) out.push({ key: 'emails-failing', kind: 'email', severity: 'critical', audience: 'SUPPORT', title: `${plural(emailsFailedHour, 'email')} failed in the last hour`, detail: 'Check the sending address and the mail provider.', link: { page: 'emailLog', params: { status: 'FAILED' } } });
  if (emailsStuck) out.push({ key: 'emails-stuck', kind: 'email', severity: 'warning', audience: 'SUPPORT', title: `${plural(emailsStuck, 'email')} waiting more than an hour to send`, detail: 'The mail job may have stopped.', link: { page: 'emailLog', params: { status: 'QUEUED' } } });
  if (webhooksFailed >= RULES.webhooksFailingPerDay) out.push({ key: 'webhooks-failing', kind: 'webhook', severity: 'warning', audience: 'SUPPORT', title: `${plural(webhooksFailed, 'webhook delivery', 'webhook deliveries')} failed in the last day`, link: { page: 'health' } });
  if (closures) out.push({ key: 'closures-stuck', kind: 'closure', severity: 'critical', audience: 'SUPPORT', title: `${plural(closures, 'company deletion')} stopped part-way`, detail: 'Tell engineering; the customer asked for this data to go.', link: { page: 'health' } });

  const names = await customerNames([...offline.map((o) => o.accountId), ...overdue.map((i) => i.accountId), ...tickets.map((t) => t.accountId), ...trials.map((t) => t.accountId)]);
  const who = (id: string) => names.get(id) || 'A customer';

  for (const o of offline) {
    const n = o._count._all;
    out.push({ key: `readers:${o.accountId}`, kind: 'readers', severity: 'warning', audience: 'SUPPORT', accountId: o.accountId, title: `${who(o.accountId)}: ${plural(n, 'attendance reader')} offline`, detail: 'Not heard from in over 30 minutes. Punches wait on the reader until it is back.', link: { page: 'customers', id: o.accountId, tab: 'connections' } });
  }
  for (const i of overdue) {
    const days = Math.max(1, Math.floor((now - (i.dueDate as Date).getTime()) / DAY));
    out.push({ key: `invoice:${i.id}`, kind: 'invoice', severity: days > 15 ? 'critical' : 'warning', audience: 'BILLING', accountId: i.accountId, title: `${who(i.accountId)}: invoice ${i.number || ''} overdue ${plural(days, 'day')}`.replace('  ', ' '), detail: `₹${(i.total / 100).toLocaleString('en-IN', { maximumFractionDigits: 0 })} unpaid.`, link: { page: 'invoices', id: i.id } });
  }
  for (const t of tickets) {
    const since = (t.lastCustomerAt || t.createdAt).getTime();
    const waited = now - since;
    if (t.priority === 'URGENT' && waited > RULES.urgentTicketMinutes * MIN)
      out.push({ key: `ticket:${t.id}`, kind: 'ticket', severity: 'critical', audience: 'SUPPORT', accountId: t.accountId, title: `Urgent ${ticketCode(t.number)} from ${who(t.accountId)} has no answer`, detail: t.subject, link: { page: 'tickets', id: t.id } });
    else if (waited > RULES.ticketWaitHours * HOUR)
      out.push({ key: `ticket:${t.id}`, kind: 'ticket', severity: 'warning', audience: 'SUPPORT', accountId: t.accountId, title: `${ticketCode(t.number)} from ${who(t.accountId)} waiting over a day`, detail: t.subject, link: { page: 'tickets', id: t.id } });
  }
  for (const s of trials) {
    const days = Math.max(0, Math.ceil(((s.trialEndsAt as Date).getTime() - now) / DAY));
    out.push({ key: `trial:${s.accountId}`, kind: 'trial', severity: 'warning', audience: 'SALES', accountId: s.accountId, title: `${who(s.accountId)}: trial ends in ${plural(days, 'day')}`, detail: 'A good moment to call.', link: { page: 'customers', id: s.accountId } });
  }
  /* The API itself failing requests: customers are seeing "Server error" right now. */
  const failed = await apiErrorsSince(at(15 * MIN), now);
  if (failed.count >= RULES.apiErrorsPerQuarterHour) {
    out.push({ key: 'api-errors', kind: 'errors', severity: 'critical', audience: 'SUPPORT', title: `CLOR failed ${plural(failed.count, 'request')} in the last 15 minutes`, detail: failed.worst ? `Most often: ${failed.worst.route} (${plural(failed.worst.count, 'time')}). Tell engineering; the details are in Error Reporting.` : 'Tell engineering; the details are in Error Reporting.', link: { page: 'health' } });
  }
  return out;
}

/**
 * Bring the alert table in line with the findings: open new ones, refresh
 * those still true, close the rest. Returns the alerts opened this time.
 */
export async function syncAlerts(findings: Finding[], now = new Date()) {
  const open = await platformPrisma.opsAlert.findMany({ where: { resolvedAt: null } });
  const byKey = new Map(open.map((a) => [a.key, a]));
  const seen = new Set<string>();
  const opened: typeof open = [];
  for (const f of findings) {
    if (seen.has(f.key)) continue;
    seen.add(f.key);
    const data = { kind: f.kind, severity: f.severity, audience: f.audience, title: f.title, detail: f.detail ?? null, accountId: f.accountId ?? null, link: (f.link ?? undefined) as any, lastSeenAt: now };
    const was = byKey.get(f.key);
    if (was) {
      /* A warning that turned critical asks for attention again. */
      const worse = was.severity !== 'critical' && f.severity === 'critical';
      await platformPrisma.opsAlert.update({ where: { id: was.id }, data: { ...data, ...(worse ? { acknowledgedAt: null, acknowledgedBy: null } : {}) } });
      if (worse) opened.push({ ...was, ...data } as any);
      continue;
    }
    try {
      opened.push(await platformPrisma.opsAlert.create({ data: { key: f.key, firstSeenAt: now, ...data } }));
    } catch (e: any) {
      /* Another instance opened it a moment ago (one open alert per key). */
      if (e?.code !== 'P2002') throw e;
    }
  }
  const cleared = open.filter((a) => !seen.has(a.key)).map((a) => a.id);
  if (cleared.length) await platformPrisma.opsAlert.updateMany({ where: { id: { in: cleared }, resolvedAt: null }, data: { resolvedAt: now } });
  return { opened, cleared: cleared.length };
}

const OPS_URL = () => (process.env.OPS_URL || 'https://ops.clor.in').replace(/\/$/, '');

/** One email per staff member listing the alerts opened for them this run. */
export async function tellStaff(opened: { title: string; severity: string; audience: string; detail: string | null }[]) {
  if (!opened.length) return 0;
  const ops = await platformPrisma.platformOperator.findMany({ where: { active: true }, select: { userId: true, role: true } });
  const users = ops.length ? await platformPrisma.user.findMany({ where: { id: { in: ops.map((o) => o.userId) }, isActive: true }, select: { id: true, email: true, fullName: true } }) : [];
  let sent = 0;
  for (const o of ops) {
    const u = users.find((x) => x.id === o.userId);
    if (!u) continue;
    const mine = opened.filter((a) => o.role === 'SUPER_ADMIN' || a.audience === o.role);
    if (!mine.length) continue;
    const critical = mine.filter((a) => a.severity === 'critical').length;
    await sendTemplate({
      templateKey: 'ops.alerts_opened',
      to: u.email,
      transactional: true,
      relatedType: 'OpsAlert',
      data: {
        userName: u.fullName || u.email,
        count: String(mine.length),
        headline: critical ? `${plural(critical, 'urgent alert')} on CLOR` : `${plural(mine.length, 'new alert')} on CLOR`,
        list: mine.map((a) => `- ${a.severity === 'critical' ? '[urgent] ' : ''}${a.title}${a.detail ? `\n  ${a.detail}` : ''}`).join('\n'),
        opsUrl: `${OPS_URL()}/#/alerts`,
      },
    })
      .then(() => (sent += 1))
      .catch(() => null);
  }
  return sent;
}

export async function runAlerts(now = Date.now()) {
  return outsideTenant('ops: alerts', async () => {
    const findings = await collectFindings(now);
    const r = await syncAlerts(findings, new Date(now));
    const told = await tellStaff(r.opened);
    return { findings: findings.length, opened: r.opened.length, cleared: r.cleared, told };
  });
}

export function startOpsAlerts({ intervalMs = ALERT_EVERY_MS, startupDelayMs = 120_000 } = {}) {
  if (process.env.NODE_ENV === 'test' || process.env.VITEST) return () => {};
  const tick = () => exclusive('ops.alerts', leaseFor(intervalMs), () => runAlerts(), { idempotent: true }).catch((e) => console.error('[ops.alerts] failed:', e instanceof Error ? e.message : e));
  registerJob('ops.alerts', tick, intervalMs);
  const t = setTimeout(() => {
    tick();
    const i = setInterval(tick, intervalMs);
    i.unref?.();
  }, startupDelayMs);
  return () => clearTimeout(t);
}
