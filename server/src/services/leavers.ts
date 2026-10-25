import { platformPrisma } from '../utils/platformPrisma.js';
import { peoplePrisma } from '../utils/peoplePrisma.js';
import { runInTenant } from '../utils/tenantScope.js';
import { revokeAllSessions } from './auth.js';
import { userLimitReason } from './entitlements.js';

/**
 * Somebody has left the business.
 *
 * Deleting them would take their name off every invoice, approval and audit
 * line they ever touched, so nobody is deleted for leaving: they are marked
 * as left. Their sign-in stops at once (isActive false, every session ended),
 * the reason, last working day and a note are kept, and the seat is free for
 * whoever replaces them (the plan counts active users only).
 *
 * What was waiting on them is handed to someone named: their waiting approval
 * steps (marked as stood in for the leaver), open HR desk requests and open
 * attendance exceptions — in every company of this account they worked in.
 *
 * A shared address (accounts@…) can be released for the successor: the
 * leaver's address is kept in releasedEmail and the login gets a placeholder
 * that can never receive mail. Reactivating gives it back if it is still free.
 *
 * Only a person of this account can be marked as left; someone who signs in
 * with their own account (a CA, say) is removed from the company instead.
 */

export const LEAVE_REASONS = ['RESIGNED', 'TERMINATED', 'ROLE_CHANGED', 'CONTRACT_ENDED', 'RETIRED', 'OTHER'] as const;
export type LeaveReason = (typeof LEAVE_REASONS)[number];
export const LEAVE_REASON_LABEL: Record<LeaveReason, string> = {
  RESIGNED: 'Resigned',
  TERMINATED: 'Employment ended by the business',
  ROLE_CHANGED: 'Moved to a role without access',
  CONTRACT_ENDED: 'Contract ended',
  RETIRED: 'Retired',
  OTHER: 'Other',
};

export class LeaverError extends Error {
  constructor(public status: number, message: string, public code: string) {
    super(message);
  }
}

const placeholderEmail = (userId: string) => `left.${userId}@deactivated.invalid`;
const OPEN_DESK = ['OPEN', 'WAITING_EMPLOYEE', 'REOPENED'];
const OPEN_EXCEPTION = ['OPEN', 'IN_PROGRESS'];

export type Handover = { approvals: number; deskRequests: number; exceptions: number; companies: number; skippedCompanies: number };

/** Moves what was waiting on `fromUserId` to `toUserId` in one company (people database). */
async function handOverIn(orgId: string, fromUserId: string, toUserId: string) {
  return runInTenant(orgId, async () => {
    const desk = await peoplePrisma.deskRequest.updateMany({ where: { orgId, assigneeUserId: fromUserId, status: { in: OPEN_DESK } }, data: { assigneeUserId: toUserId } });
    const exceptions = await peoplePrisma.attendanceExceptionState.updateMany({ where: { orgId, assigneeUserId: fromUserId, status: { in: OPEN_EXCEPTION } }, data: { assigneeUserId: toUserId } });
    const steps = await peoplePrisma.approvalStep.findMany({ where: { orgId, status: 'WAITING' }, select: { id: true, approverUserId: true, candidateUserIds: true, standInForUserId: true } });
    let approvals = 0;
    for (const s of steps) {
      const candidates = Array.isArray(s.candidateUserIds) ? (s.candidateUserIds as string[]) : [];
      if (s.approverUserId !== fromUserId && !candidates.includes(fromUserId)) continue;
      const next = [...new Set(candidates.map((u) => (u === fromUserId ? toUserId : u)).concat(s.approverUserId === fromUserId ? [toUserId] : []))];
      await peoplePrisma.approvalStep.update({
        where: { id: s.id },
        data: {
          candidateUserIds: next,
          approverUserId: s.approverUserId === fromUserId ? toUserId : s.approverUserId,
          standInForUserId: s.approverUserId === fromUserId ? fromUserId : s.standInForUserId,
        },
      });
      approvals += 1;
    }
    return { approvals, deskRequests: desk.count, exceptions: exceptions.count };
  });
}

/** What a leaver still had waiting, across the account's companies — shown before confirming. */
export async function pendingFor(accountId: string, userId: string) {
  const orgIds = (await platformPrisma.userOrgMembership.findMany({ where: { accountId, userId }, select: { orgId: true } })).map((m) => m.orgId);
  let approvals = 0;
  let deskRequests = 0;
  let exceptions = 0;
  for (const orgId of orgIds) {
    await runInTenant(orgId, async () => {
      deskRequests += await peoplePrisma.deskRequest.count({ where: { orgId, assigneeUserId: userId, status: { in: OPEN_DESK } } });
      exceptions += await peoplePrisma.attendanceExceptionState.count({ where: { orgId, assigneeUserId: userId, status: { in: OPEN_EXCEPTION } } });
      const steps = await peoplePrisma.approvalStep.findMany({ where: { orgId, status: 'WAITING' }, select: { approverUserId: true, candidateUserIds: true } });
      approvals += steps.filter((s) => s.approverUserId === userId || (Array.isArray(s.candidateUserIds) && (s.candidateUserIds as string[]).includes(userId))).length;
    });
  }
  return { approvals, deskRequests, exceptions, companies: orgIds.length };
}

export async function markLeft(args: {
  accountId: string;
  orgId: string;
  actorUserId: string;
  userId: string;
  reason: LeaveReason;
  lastWorkingDay: string;
  note?: string | null;
  handoverUserId?: string | null;
  releaseEmail?: boolean;
}) {
  const { accountId, orgId, actorUserId, userId } = args;
  if (userId === actorUserId) throw new LeaverError(400, 'You cannot mark yourself as left. Ask another administrator.', 'SELF');
  if (!LEAVE_REASONS.includes(args.reason)) throw new LeaverError(400, 'Choose why they left.', 'BAD_REASON');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(args.lastWorkingDay || ''))) throw new LeaverError(400, 'Enter their last working day.', 'BAD_DATE');

  const user = await platformPrisma.user.findUnique({ where: { id: userId }, select: { id: true, accountId: true, email: true, isActive: true, leftAt: true } });
  if (!user || user.accountId !== accountId) {
    throw new LeaverError(403, 'This person signs in with their own account. Remove their access to this company instead.', 'foreign_identity');
  }
  if (user.leftAt) throw new LeaverError(409, 'Already marked as left.', 'ALREADY_LEFT');

  let handoverTo: string | null = null;
  if (args.handoverUserId) {
    const h = await platformPrisma.user.findUnique({ where: { id: String(args.handoverUserId) }, select: { id: true, isActive: true } });
    const member = h && (await platformPrisma.userOrgMembership.findFirst({ where: { accountId, orgId, userId: h.id }, select: { id: true } }));
    if (!h || !h.isActive || !member || h.id === userId) throw new LeaverError(400, 'Hand over to an active person in this company.', 'BAD_HANDOVER');
    handoverTo = h.id;
  }

  const now = new Date();
  await platformPrisma.user.update({
    where: { id: userId },
    data: {
      isActive: false,
      leftAt: now,
      leftReason: args.reason,
      leftNote: args.note ? String(args.note).slice(0, 1000) : null,
      lastWorkingDay: args.lastWorkingDay,
      leftByUserId: actorUserId,
      ...(args.releaseEmail ? { releasedEmail: user.email, email: placeholderEmail(userId), emailVerifiedAt: null } : {}),
    },
  });
  await revokeAllSessions(userId, 'left');

  const handover: Handover = { approvals: 0, deskRequests: 0, exceptions: 0, companies: 0, skippedCompanies: 0 };
  if (handoverTo) {
    const orgIds = (await platformPrisma.userOrgMembership.findMany({ where: { accountId, userId }, select: { orgId: true } })).map((m) => m.orgId);
    for (const o of orgIds) {
      /* Only where the successor works too: nobody is handed work in a company they cannot open. */
      const there = await platformPrisma.userOrgMembership.findFirst({ where: { accountId, orgId: o, userId: handoverTo }, select: { id: true } });
      if (!there) {
        handover.skippedCompanies += 1;
        continue;
      }
      const moved = await handOverIn(o, userId, handoverTo);
      handover.approvals += moved.approvals;
      handover.deskRequests += moved.deskRequests;
      handover.exceptions += moved.exceptions;
      handover.companies += 1;
    }
  }
  return { handover, releasedEmail: args.releaseEmail ? user.email : null };
}

export async function reactivate(args: { accountId: string; actorUserId: string; userId: string }) {
  const user = await platformPrisma.user.findUnique({ where: { id: args.userId }, select: { id: true, accountId: true, isActive: true, releasedEmail: true } });
  if (!user || user.accountId !== args.accountId) throw new LeaverError(403, 'This person signs in with their own account.', 'foreign_identity');
  if (user.isActive) throw new LeaverError(409, 'This person is already active.', 'ALREADY_ACTIVE');
  const full = await userLimitReason(args.accountId);
  if (full) throw new LeaverError(409, `${full} Free a seat first, or move to a larger plan.`, 'USER_LIMIT');

  /* Their old address back, if nobody has taken it since. */
  let emailRestored: boolean | null = null;
  let email: string | undefined;
  if (user.releasedEmail) {
    const taken = await platformPrisma.user.findFirst({ where: { email: user.releasedEmail, NOT: { id: user.id } }, select: { id: true } });
    emailRestored = !taken;
    if (!taken) email = user.releasedEmail;
  }
  await platformPrisma.user.update({
    where: { id: user.id },
    data: {
      isActive: true,
      leftAt: null,
      leftReason: null,
      leftNote: null,
      lastWorkingDay: null,
      leftByUserId: null,
      lockedUntil: null,
      failedLoginCount: 0,
      ...(email ? { email, releasedEmail: null } : {}),
    },
  });
  return { emailRestored };
}
