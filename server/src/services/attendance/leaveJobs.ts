import { peoplePrisma, peopleWrite } from '../../utils/peoplePrisma.js';
import { platformPrisma } from '../../utils/platformPrisma.js';
import { exclusive, leaseFor } from '../jobLease.js';
import { usersWithPermission } from '../notifications.js';
import { queueNotice, type DirectNotice } from './notices.js';
import { resolveAccess } from '../access.js';
import { isFeatureEnabled } from '../features.js';
import { activeManagerOf, chainFor, CHAINS, type Chain } from './approvalChain.js';
import { addDays, periodEnd, periodOf } from './leaveAccrual.js';
import { leavePeriodOf } from './leaveBalances.js';
import { today } from './days.js';
import { teamScope } from '../people/scope.js';
import { registerJob } from '../jobRegistry.js';

/**
 * Leave automation that runs on its own (TIME-LEAVE-DECISIONS.md, advanced
 * build), once per instance under a lease:
 *
 *  - hand-on: a request whose manager step has waited longer than the type
 *    allows (LeaveType.handOnAfterDays) goes on to HR, with a line in its
 *    history, so nothing waits on someone who is away;
 *  - the morning digest: one notice a day to each approver with what waits
 *    on them, never one per request;
 *  - lapsing days: the person is told once, 30 days before the period end,
 *    when days of theirs will lapse.
 */

const DAY = 86_400_000;

export async function runLeaveHandOns(now = new Date()) {
  const types = await peoplePrisma.leaveType.findMany({ where: { handOnAfterDays: { not: null } }, select: { id: true, orgId: true, handOnAfterDays: true, approval: true } });
  let handed = 0;
  for (const t of types) {
    const company = await chainFor(t.orgId, 'leave');
    const chain: Chain = t.approval && (CHAINS as string[]).includes(t.approval) ? (t.approval as Chain) : company;
    if (chain === 'HR') continue;
    const cutoff = now.getTime() - t.handOnAfterDays! * DAY;
    const open = await peoplePrisma.leaveRequest.findMany({ where: { orgId: t.orgId, leaveTypeId: t.id, status: 'PENDING', managerApprovedAt: null, createdAt: { lt: new Date(cutoff) } } });
    /* The wait starts when the manager last got it: a change starts it over. */
    const stepStart = (r: { createdAt: Date; history: unknown }) => {
      const h = (Array.isArray(r.history) ? r.history : []) as Array<{ at?: string; what?: string }>;
      const edited = [...h].reverse().find((x) => x.what === 'EDITED');
      return edited?.at ? Math.max(new Date(edited.at).getTime(), r.createdAt.getTime()) : r.createdAt.getTime();
    };
    const waiting = open.filter((r) => stepStart(r) < cutoff);
    for (const r of waiting) {
      if (!(await activeManagerOf(t.orgId, r.employeeId))) continue;
      const history = [...((Array.isArray(r.history) ? r.history : []) as any[]), { at: now.toISOString(), by: 'system', what: 'HANDED_ON', note: `No decision from the manager in ${t.handOnAfterDays} days` }];
      /* The manager's step counts as taken by nobody: HR decides, and the story says so. */
      /* Only while it still waits for the manager: a decision taken meanwhile is never written over (closure audit, 28 Oct 2026). */
      /* The hand-on and the notice to HR commit together (closure audit O-07). */
      const { tellWaiting } = await import('../../routes/leave.js');
      const claimed = await peopleWrite(t.orgId, async () => {
        const c = await peoplePrisma.leaveRequest.updateMany({ where: { id: r.id, status: 'PENDING', managerApprovedAt: null, updatedAt: r.updatedAt }, data: { managerApprovedAt: now, managerApprovedById: null, managerNote: `Handed on to HR: no decision in ${t.handOnAfterDays} days`, history } });
        if (c.count) await tellWaiting(t.orgId, r.id);
        return c;
      });
      if (!claimed.count) continue;
      await platformPrisma.auditLog
        .create({ data: { accountId: r.accountId, orgId: t.orgId, branchId: '', entity: 'LeaveRequest', entityId: r.id, action: 'HAND_ON', message: `Handed on to HR: no decision from the manager in ${t.handOnAfterDays} days`, metadata: JSON.stringify({ employeeId: r.employeeId, leaveTypeId: r.leaveTypeId }), createdByUserId: 'system' } })
        .catch((e) => console.error('[audit] hand-on not recorded:', e instanceof Error ? e.message : e));
      handed += 1;
    }
  }
  return handed;
}

/*
 * The digest and lapse notices are addressed here and delivered by the outbox
 * (attendance/notices.ts), under a key unique per person (Notification
 * dedupeKey): a job that runs twice, or a delivery tried again, sends once.
 * Before queueing, the job skips a person who already has it, sent or queued.
 */
const correlationFor = (userId: string, key: string) => `notice_${key}_${userId}`;
async function alreadyQueued(orgId: string, userId: string, key: string) {
  const sent = await platformPrisma.notification.findUnique({ where: { orgId_userId_dedupeKey: { orgId, userId, dedupeKey: key } }, select: { id: true } });
  if (sent) return true;
  return Boolean(await peoplePrisma.outboxEvent.findFirst({ where: { orgId, correlationId: correlationFor(userId, key) }, select: { id: true } }));
}
async function queueDirect(accountId: string, orgId: string, d: DirectNotice, employeeId: string | null = null) {
  await queueNotice({ accountId, orgId }, 'direct', d as unknown as Record<string, unknown>, { employeeId, correlationId: correlationFor(d.userIds[0], d.dedupeKey) });
}

/** Approvers with something waiting on them, told once a day. */
export async function runLeaveDigest(now = new Date()) {
  const date = today();
  const orgs = await peoplePrisma.leaveRequest.groupBy({ by: ['accountId', 'orgId'], where: { status: 'PENDING' } });
  let sent = 0;
  for (const { accountId, orgId } of orgs) {
    const app = (await isFeatureEnabled(accountId, orgId, 'people')) ? 'people' : 'attendance';
    const { waitingForReader } = await import('../../routes/leave.js');
    for (const userId of await usersWithPermission(accountId, orgId, 'ATTENDANCE::Leave Requests::APPROVE')) {
      const access = await resolveAccess(accountId, orgId, userId);
      const scope = await teamScope({ ownDocumentsOnly: access.ownDocumentsOnly, tenant: { orgId }, auth: { userId } } as any);
      const waiting = await waitingForReader(orgId, scope, userId);
      if (!waiting.length) continue;
      const key = `leave-digest:${date}`;
      if (await alreadyQueued(orgId, userId, key)) continue;
      const oldest = Math.floor((now.getTime() - waiting[0].createdAt.getTime()) / DAY);
      await queueDirect(accountId, orgId, { userIds: [userId], dedupeKey: key, notice: { kind: 'attendance.leave_digest', title: `${waiting.length} leave ${waiting.length === 1 ? 'request waits' : 'requests wait'} for you${oldest >= 3 ? `; the oldest for ${oldest} days` : ''}`, link: { app, screen: 'leaveRequests' } } });
      sent += 1;
    }
  }
  return sent;
}

/**
 * Days that will lapse: each person told once, 30 days before the period end,
 * what will go unless taken (the year-end preview, read for them). Pay-outs
 * the year end would make are not "lapsing".
 */
export async function runLapseNotices(date = today()) {
  const { yearEndPreview } = await import('../../routes/leave.js');
  const { dayWords } = await import('../../routes/leave.js');
  const orgs = await peoplePrisma.leaveType.groupBy({ by: ['accountId', 'orgId'], where: { isPaid: true, isActive: true } });
  let sent = 0;
  for (const { accountId, orgId } of orgs) {
    const period = await leavePeriodOf(orgId);
    const year = periodOf(period, date);
    const end = periodEnd(period, year);
    if (date < addDays(end, -30) || date > end) continue;
    const preview = await yearEndPreview(accountId, orgId, year);
    const byPerson = new Map<string, Array<{ leaveType: string; days: number }>>();
    for (const r of preview.rows) {
      const days = Math.round((r.lapse - r.payOut) * 100) / 100;
      if (days <= 0) continue;
      byPerson.set(r.employeeId, [...(byPerson.get(r.employeeId) || []), { leaveType: r.leaveType, days }]);
    }
    if (!byPerson.size) continue;
    const app = (await isFeatureEnabled(accountId, orgId, 'people')) ? 'people' : 'attendance';
    const people = await peoplePrisma.employee.findMany({ where: { orgId, id: { in: [...byPerson.keys()] }, userId: { not: null } }, select: { id: true, userId: true } });
    for (const p of people) {
      const key = `leave-lapse:${year}`;
      if (await alreadyQueued(orgId, p.userId!, key)) continue;
      const lines = byPerson.get(p.id)!;
      const total = lines.reduce((a, l) => a + l.days, 0);
      await queueDirect(accountId, orgId, { userIds: [p.userId!], dedupeKey: key, notice: { kind: 'attendance.leave_lapse', title: `${total} ${total === 1 ? 'day' : 'days'} of leave will lapse on ${dayWords(end)}`, body: lines.map((l) => `${l.leaveType}: ${l.days}`).join('; '), link: { app, screen: 'myLeave' } } }, p.id);
      sent += 1;
    }
  }
  return sent;
}

/**
 * What of one person's leave lapses at this period's end, once that end is 30
 * days away or less (the same window and sum as runLapseNotices). The employee
 * app's feed reads it on demand: staff with no CLOR sign-in get no
 * notification, so this is how they hear.
 */
export async function lapseFor(accountId: string, orgId: string, employeeId: string, date = today()) {
  const period = await leavePeriodOf(orgId);
  const year = periodOf(period, date);
  const end = periodEnd(period, year);
  if (date < addDays(end, -30) || date > end) return null;
  const { yearEndPreview } = await import('../../routes/leave.js');
  const preview = await yearEndPreview(accountId, orgId, year, [employeeId]);
  const lines = preview.rows
    .filter((r) => r.employeeId === employeeId)
    .map((r) => ({ leaveType: r.leaveType, days: Math.round((r.lapse - r.payOut) * 100) / 100 }))
    .filter((l) => l.days > 0);
  if (!lines.length) return null;
  return { year, end, total: Math.round(lines.reduce((a, l) => a + l.days, 0) * 100) / 100, lines };
}

export function startLeaveJobs({ intervalMs = 3_600_000, startupDelayMs = 180_000 } = {}) {
  const tick = () =>
    exclusive('leave.automation', leaseFor(intervalMs), async () => {
      await runLeaveHandOns();
      /* The digest goes out once, in the morning (IST), not every hour. */
      const hour = (new Date(Date.now() + 330 * 60_000).getUTCHours());
      if (hour >= 9 && hour < 11) {
        await runLeaveDigest();
        await runLapseNotices();
      }
    }).catch((e) => {
      console.error('[leave-automation] failed:', e instanceof Error ? e.message : e);
      /* Thrown on, so the wake call reports it and Cloud Scheduler retries (services/jobRegistry.ts); the timer swallows it below. */
      throw e;
    });
  registerJob('startLeaveJobs', tick, intervalMs);
  const timed = () => tick().catch(() => {});
  const t = setTimeout(() => {
    timed();
    const i = setInterval(timed, intervalMs);
    i.unref?.();
  }, startupDelayMs);
  return () => clearTimeout(t);
}
