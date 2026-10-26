import { peoplePrisma } from '../../utils/peoplePrisma.js';
import { platformPrisma } from '../../utils/platformPrisma.js';
import { exclusive, leaseFor } from '../jobLease.js';
import { notifyUsers, usersWithPermission } from '../notifications.js';
import { resolveAccess } from '../access.js';
import { isFeatureEnabled } from '../features.js';
import { activeManagerOf, chainFor, CHAINS, type Chain } from './approvalChain.js';
import { today } from './days.js';
import { teamScope } from '../people/scope.js';

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
    const waiting = await peoplePrisma.leaveRequest.findMany({ where: { orgId: t.orgId, leaveTypeId: t.id, status: 'PENDING', managerApprovedAt: null, createdAt: { lt: new Date(now.getTime() - t.handOnAfterDays! * DAY) } } });
    for (const r of waiting) {
      if (!(await activeManagerOf(t.orgId, r.employeeId))) continue;
      const history = [...((Array.isArray(r.history) ? r.history : []) as any[]), { at: now.toISOString(), by: 'system', what: 'HANDED_ON', note: `No decision from the manager in ${t.handOnAfterDays} days` }];
      /* The manager's step counts as taken by nobody: HR decides, and the story says so. */
      await peoplePrisma.leaveRequest.update({ where: { id: r.id }, data: { managerApprovedAt: now, managerApprovedById: null, managerNote: `Handed on to HR: no decision in ${t.handOnAfterDays} days`, history } });
      handed += 1;
      const { tellWaiting } = await import('../../routes/leave.js');
      await tellWaiting(t.orgId, r.id).catch((e) => console.error('[leave] hand-on notice not sent:', e instanceof Error ? e.message : e));
    }
  }
  return handed;
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
      const had = await platformPrisma.notification.findFirst({ where: { orgId, userId, kind: 'attendance.leave_digest', linkJson: { contains: `"dedupe":"${key}"` } }, select: { id: true } });
      if (had) continue;
      const oldest = Math.floor((now.getTime() - waiting[0].createdAt.getTime()) / DAY);
      await notifyUsers(accountId, orgId, [userId], { kind: 'attendance.leave_digest', title: `${waiting.length} leave ${waiting.length === 1 ? 'request waits' : 'requests wait'} for you${oldest >= 3 ? `; the oldest for ${oldest} days` : ''}`, link: { app, screen: 'leaveRequests', dedupe: key } as any });
      sent += 1;
    }
  }
  return sent;
}

export function startLeaveJobs({ intervalMs = 3_600_000, startupDelayMs = 180_000 } = {}) {
  const tick = () =>
    exclusive('leave.automation', leaseFor(intervalMs), async () => {
      await runLeaveHandOns();
      /* The digest goes out once, in the morning (IST), not every hour. */
      const hour = (new Date(Date.now() + 330 * 60_000).getUTCHours());
      if (hour >= 9 && hour < 11) await runLeaveDigest();
    }).catch((e) => console.error('[leave-automation] failed:', e instanceof Error ? e.message : e));
  const t = setTimeout(() => {
    tick();
    const i = setInterval(tick, intervalMs);
    i.unref?.();
  }, startupDelayMs);
  return () => clearTimeout(t);
}
