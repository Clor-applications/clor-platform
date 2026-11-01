import { peoplePrisma } from '../../utils/peoplePrisma.js';
import { platformPrisma } from '../../utils/platformPrisma.js';
import { runInTenant } from '../../utils/tenantScope.js';
import { exclusive, leaseFor } from '../jobLease.js';
import { registerJob } from '../jobRegistry.js';
import { notifyUsers, usersWithPermission } from '../notifications.js';
import { sendTemplate } from '../mailer.js';
import { appLive } from '../principalAllowed.js';
import { track } from '../productEvents.js';

/**
 * The Monday owner summary (PRODUCT-VIEW §3, the habit loop): once a week, to
 * each owner and HR person of a company that has People or Attendance, one
 * bell notice and one e-mail with
 *
 *  - who is away this week (approved leave; a private type is just "leave"),
 *  - what waits for a decision, counted by kind, and the oldest of it,
 *  - leave that lapses at the period end, when that is within 30 days,
 *  - who joins and who leaves this week.
 *
 * Copied from the Accounting books digest (services/booksDigest.ts): worked out
 * on the server, under a lease, registered with the job registry so the wake
 * endpoint runs it on Cloud Run. Once per company per ISO week: the week is
 * in the dedupe key of the notice and in the e-mail's related id, and a
 * company that already has either is skipped. People who muted the kind get
 * no notice (notifyUsers); a company that switched the e-mail off gets it
 * kept as SUPPRESSED (sendTemplate), never sent.
 */

export const SUMMARY_KIND = 'people.weekly_summary';
export const SUMMARY_TEMPLATE = 'people.weekly_summary';
const RECIPIENT_PERMISSION = 'PEOPLE::Employees::EDIT';
const DAY = 86_400_000;

const istDate = (now: Date) => new Date(now.getTime() + 330 * 60_000);
const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (day: string, n: number) => iso(new Date(new Date(`${day}T00:00:00Z`).getTime() + n * DAY));
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const short = (day: string) => new Date(`${day}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' });

/** The ISO week (Monday first) of a day in India, e.g. 2026-W44, and its Monday–Sunday. */
export function isoWeekOf(now: Date) {
  const d = istDate(now);
  const day = d.getUTCDay() || 7;
  const monday = iso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day + 1)));
  const thursday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day + 4));
  const yearStart = Date.UTC(thursday.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((thursday.getTime() - yearStart) / DAY + 1) / 7);
  return { key: `${thursday.getUTCFullYear()}-W${String(week).padStart(2, '0')}`, from: monday, to: addDays(monday, 6), weekday: day, hour: d.getUTCHours() };
}

const KIND_LABEL: Record<string, string> = { MISSED_PUNCH: 'missed punch', WFH: 'work from home', ON_DUTY: 'on duty', PERMISSION: 'permission hours' };

export type WeeklySummary = {
  week: string;
  from: string;
  to: string;
  away: Array<{ name: string; from: string; to: string; leave: string }>;
  waiting: Array<{ kind: string; label: string; count: number }>;
  oldest: { label: string; days: number } | null;
  lapsing: { days: number; people: number; on: string } | null;
  joining: Array<{ name: string; on: string }>;
  leaving: Array<{ name: string; on: string }>;
};

export async function weeklySummaryFor(accountId: string, orgId: string, now = new Date()): Promise<WeeklySummary> {
  const w = isoWeekOf(now);
  const [leave, requests, approvals, joining, leaving] = await Promise.all([
    peoplePrisma.leaveRequest.findMany({ where: { orgId, status: 'APPROVED', fromDate: { lte: w.to }, toDate: { gte: w.from } }, select: { employeeId: true, leaveTypeId: true, fromDate: true, toDate: true }, orderBy: { fromDate: 'asc' }, take: 200 }),
    Promise.all([
      peoplePrisma.leaveRequest.findMany({ where: { orgId, status: 'PENDING' }, select: { createdAt: true } }),
      peoplePrisma.attendanceRequest.findMany({ where: { orgId, status: 'PENDING' }, select: { kind: true, createdAt: true } }),
    ]),
    peoplePrisma.approvalRequest.findMany({ where: { orgId, status: 'WAITING', sourceKind: null }, select: { createdAt: true } }),
    peoplePrisma.employee.findMany({ where: { orgId, dateOfJoining: { gte: w.from, lte: w.to } }, select: { name: true, dateOfJoining: true }, orderBy: { dateOfJoining: 'asc' }, take: 50 }),
    peoplePrisma.employee.findMany({ where: { orgId, dateOfLeaving: { gte: w.from, lte: w.to } }, select: { name: true, dateOfLeaving: true }, orderBy: { dateOfLeaving: 'asc' }, take: 50 }),
  ]);

  const [types, people] = await Promise.all([
    peoplePrisma.leaveType.findMany({ where: { orgId, id: { in: [...new Set(leave.map((l) => l.leaveTypeId))] } }, select: { id: true, name: true, isPrivate: true } }),
    peoplePrisma.employee.findMany({ where: { orgId, id: { in: [...new Set(leave.map((l) => l.employeeId))] } }, select: { id: true, name: true } }),
  ]);
  const typeOf = new Map(types.map((t) => [t.id, t]));
  const nameOf = new Map(people.map((p) => [p.id, p.name]));
  /* A private type (TIME-LEAVE-DECISIONS) is "leave" here: the summary goes to more people than the approver. */
  const away = leave.map((l) => ({ name: nameOf.get(l.employeeId) || 'Someone', from: l.fromDate < w.from ? w.from : l.fromDate, to: l.toDate > w.to ? w.to : l.toDate, leave: typeOf.get(l.leaveTypeId)?.isPrivate ? 'Leave' : typeOf.get(l.leaveTypeId)?.name || 'Leave' }));

  const [pendingLeave, pendingRequests] = requests;
  const waiting: WeeklySummary['waiting'] = [];
  if (pendingLeave.length) waiting.push({ kind: 'leave', label: 'leave', count: pendingLeave.length });
  const byKind = new Map<string, number>();
  for (const r of pendingRequests) byKind.set(r.kind, (byKind.get(r.kind) || 0) + 1);
  for (const [kind, count] of byKind) waiting.push({ kind, label: KIND_LABEL[kind] || kind.toLowerCase().replace(/_/g, ' '), count });
  if (approvals.length) waiting.push({ kind: 'approval', label: 'HR approval', count: approvals.length });

  const all = [
    ...pendingLeave.map((r) => ({ at: r.createdAt, label: 'leave request' })),
    ...pendingRequests.map((r) => ({ at: r.createdAt, label: `${KIND_LABEL[r.kind] || 'attendance'} request` })),
    ...approvals.map((r) => ({ at: r.createdAt, label: 'HR approval' })),
  ].sort((a, b) => a.at.getTime() - b.at.getTime());
  const oldest = all.length ? { label: all[0].label, days: Math.max(0, Math.floor((now.getTime() - all[0].at.getTime()) / DAY)) } : null;

  return {
    week: w.key,
    from: w.from,
    to: w.to,
    away,
    waiting,
    oldest,
    lapsing: await lapsingFor(accountId, orgId, w.from).catch(() => null),
    joining: joining.map((e) => ({ name: e.name, on: e.dateOfJoining! })),
    leaving: leaving.map((e) => ({ name: e.name, on: e.dateOfLeaving! })),
  };
}

/** Days that lapse at the leave period end, when it is within 30 days (the year-end preview, as the lapse notice reads it). */
async function lapsingFor(accountId: string, orgId: string, day: string) {
  const [{ leavePeriodOf }, { addDays: addLeaveDays, periodEnd, periodOf }, { yearEndPreview }] = await Promise.all([
    import('../attendance/leaveBalances.js'),
    import('../attendance/leaveAccrual.js'),
    import('../../routes/leave.js'),
  ]);
  const period = await leavePeriodOf(orgId);
  const year = periodOf(period, day);
  const end = periodEnd(period, year);
  if (day < addLeaveDays(end, -30) || day > end) return null;
  const preview = await yearEndPreview(accountId, orgId, year);
  const byPerson = new Map<string, number>();
  for (const r of preview.rows) {
    const days = Math.round((r.lapse - r.payOut) * 100) / 100;
    if (days > 0) byPerson.set(r.employeeId, (byPerson.get(r.employeeId) || 0) + days);
  }
  if (!byPerson.size) return null;
  return { days: Math.round([...byPerson.values()].reduce((a, n) => a + n, 0) * 100) / 100, people: byPerson.size, on: end };
}

export const isEmpty = (s: WeeklySummary) => !s.away.length && !s.waiting.length && !s.lapsing && !s.joining.length && !s.leaving.length;

/** The notice's one line, and the e-mail's body, in plain words. */
export function summaryText(s: WeeklySummary) {
  const waitingCount = s.waiting.reduce((a, x) => a + x.count, 0);
  const title = [
    s.away.length ? `${plural(new Set(s.away.map((a) => a.name)).size, 'person', 'people')} away this week` : 'Nobody away this week',
    waitingCount ? `${waitingCount} waiting for you` : null,
  ].filter(Boolean).join(' · ');
  const range = (a: { from: string; to: string }) => (a.from === a.to ? short(a.from) : `${short(a.from)}–${short(a.to)}`);
  const lines: string[] = [];
  lines.push(`Away this week (${short(s.from)}–${short(s.to)}):`);
  lines.push(...(s.away.length ? s.away.map((a) => `  ${a.name}: ${a.leave}, ${range(a)}`) : ['  Nobody.']));
  lines.push('');
  lines.push('Waiting for a decision:');
  lines.push(...(s.waiting.length ? s.waiting.map((x) => `  ${plural(x.count, `${x.label} request`)}`.replace('HR approval requests', 'HR approvals').replace('HR approval request', 'HR approval')) : ['  Nothing.']));
  if (s.oldest) lines.push(`  The oldest, a ${s.oldest.label}, has waited ${plural(s.oldest.days, 'day')}.`);
  if (s.lapsing) {
    lines.push('');
    lines.push(`Lapsing leave: ${plural(s.lapsing.days, 'day')} for ${plural(s.lapsing.people, 'person', 'people')} on ${short(s.lapsing.on)}, unless taken.`);
  }
  if (s.joining.length || s.leaving.length) {
    lines.push('');
    if (s.joining.length) lines.push(`Joining: ${s.joining.map((j) => `${j.name} (${short(j.on)})`).join(', ')}`);
    if (s.leaving.length) lines.push(`Leaving: ${s.leaving.map((j) => `${j.name} (${short(j.on)})`).join(', ')}`);
  }
  return { title, body: lines.join('\n') };
}

/** Whether this company was already sent this week's summary, by bell or by e-mail. */
async function alreadySent(orgId: string, week: string) {
  const [notice, mail] = await Promise.all([
    platformPrisma.notification.findFirst({ where: { orgId, kind: SUMMARY_KIND, linkJson: { contains: `"dedupe":"weekly:${week}"` } }, select: { id: true } }),
    platformPrisma.emailOutbox.findFirst({ where: { orgId, relatedType: SUMMARY_KIND, relatedId: `${orgId}:${week}` }, select: { id: true } }),
  ]);
  return Boolean(notice || mail);
}

/** One company's summary, sent once this week. Returns how many people it reached. */
export async function sendWeeklySummary(accountId: string, orgId: string, now = new Date()) {
  return runInTenant(orgId, async () => {
    const week = isoWeekOf(now).key;
    if (await alreadySent(orgId, week)) return 0;
    const ids = await usersWithPermission(accountId, orgId, RECIPIENT_PERMISSION).catch(() => [] as string[]);
    if (!ids.length) return 0;
    const summary = await weeklySummaryFor(accountId, orgId, now);
    /* An empty week is not worth a message: nothing away, waiting, lapsing, joining or leaving. */
    if (isEmpty(summary)) return 0;
    const app = (await appLive(accountId, orgId, 'people')) ? 'attendance' : 'people';
    const { title, body } = summaryText(summary);
    const link = { app, screen: app === 'people' ? 'overview' : 'today', dedupe: `weekly:${week}` } as any;
    await notifyUsers(accountId, orgId, ids, { kind: SUMMARY_KIND, title, body, link });
    const [org, users] = await Promise.all([
      platformPrisma.org.findUnique({ where: { id: orgId }, select: { name: true } }),
      platformPrisma.user.findMany({ where: { id: { in: ids }, isActive: true }, select: { id: true, email: true, fullName: true } }),
    ]);
    for (const u of users) {
      if (!u.email) continue;
      await sendTemplate({
        templateKey: SUMMARY_TEMPLATE,
        to: u.email,
        toName: u.fullName,
        accountId,
        orgId,
        relatedType: SUMMARY_KIND,
        relatedId: `${orgId}:${week}`,
        data: { name: u.fullName || 'there', orgName: org?.name || 'your company', headline: title, summary: body, link: `?app=${app}&open=${link.screen}&from=weekly` },
      }).catch((e) => console.error('[weekly-summary] mail:', e instanceof Error ? e.message : e));
    }
    void track(orgId, 'system', 'digest_sent', { kind: SUMMARY_KIND, week, recipients: users.length, app });
    return users.length;
  });
}

/**
 * Every company with People or Attendance, on Monday from 08:00 India time
 * (and on to Wednesday, to catch up a Monday the job did not run).
 */
export async function runWeeklySummaries(now = new Date(), opts: { anyDay?: boolean } = {}) {
  const w = isoWeekOf(now);
  if (!opts.anyDay && (w.weekday > 3 || (w.weekday === 1 && w.hour < 8))) return 0;
  const orgs = await platformPrisma.org.findMany({ select: { id: true, accountId: true } });
  let sent = 0;
  for (const o of orgs) {
    try {
      const [people, attendance] = await Promise.all([appLive(o.accountId, o.id, 'people'), appLive(o.accountId, o.id, 'attendance')]);
      if (people && attendance) continue;
      sent += await sendWeeklySummary(o.accountId, o.id, now);
    } catch (e) {
      console.error(`[weekly-summary] ${o.id}:`, e instanceof Error ? e.message : e);
    }
  }
  return sent;
}

/** Hourly; the day and hour rule above decides when it sends. */
export function startWeeklySummary({ intervalMs = 3_600_000, startupDelayMs = 360_000 } = {}) {
  if (process.env.NODE_ENV === 'test' || process.env.VITEST) return () => {};
  const tick = () =>
    exclusive('people.weekly_summary', leaseFor(intervalMs), () => runWeeklySummaries(), { idempotent: true }).catch((e) => {
      console.error('[weekly-summary] failed:', e instanceof Error ? e.message : e);
      throw e;
    });
  registerJob('startWeeklySummary', tick, intervalMs);
  const timed = () => tick().catch(() => {});
  const t = setTimeout(() => {
    timed();
    const i = setInterval(timed, intervalMs);
    i.unref?.();
  }, startupDelayMs);
  return () => clearTimeout(t);
}
