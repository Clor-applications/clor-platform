import { Prisma } from '@prisma/client';
import { prisma } from '../utils/prisma.js';
import { platformPrisma } from '../utils/platformPrisma.js';
import { resolveRoleIds } from './access.js';
import { sendTemplate } from './mailer.js';

/**
 * Amount-based approval thresholds.
 *
 * A document whose amount matches an active rule is held until someone holding
 * the approver role signs it off. While it is held it must not reach the
 * ledger: an unapproved invoice that had already posted would defeat the point.
 */

export type ApprovalOutcome = {
  required: boolean;
  ruleId?: string;
  ruleName?: string;
  autoApproved?: boolean;
};

/** The active rule covering this amount, if any. Lowest sequence wins. */
export async function findMatchingRule(opts: {
  accountId: string;
  orgId: string;
  branchId: string;
  docType: string;
  amount: number;
}) {
  const rules = await prisma.approvalRule.findMany({
    where: {
      accountId: opts.accountId,
      orgId: opts.orgId,
      docType: opts.docType,
      isActive: true,
      OR: [{ branchId: null }, { branchId: opts.branchId }],
    },
    orderBy: [{ sequence: 'asc' }, { createdAt: 'asc' }],
  });

  const amount = Number(opts.amount || 0);
  return (
    rules.find((r) => {
      const min = Number(r.minAmount ?? 0);
      const max = r.maxAmount === null || r.maxAmount === undefined ? null : Number(r.maxAmount);
      if (amount < min) return false;
      if (max !== null && amount >= max) return false;
      return true;
    }) || null
  );
}

/**
 * Decide whether a document needs approval, and record the request if so.
 *
 * A user who already holds the approver role approves their own document
 * implicitly — requiring them to approve what they just raised is friction with
 * no control value, since they could approve it a second later anyway.
 */
export async function evaluateApproval(opts: {
  accountId: string;
  orgId: string;
  branchId: string;
  userId: string;
  docType: string;
  docId: string;
  amount: number;
}): Promise<ApprovalOutcome> {
  const rule = await findMatchingRule(opts);
  if (!rule) return { required: false };

  const roleIds = await resolveRoleIds(opts.accountId, opts.orgId, opts.userId, opts.branchId);
  if (roleIds.includes(rule.approverRoleId)) {
    return { required: false, ruleId: rule.id, ruleName: rule.name, autoApproved: true };
  }

  await prisma.approvalRequest.create({
    data: {
      accountId: opts.accountId,
      orgId: opts.orgId,
      branchId: opts.branchId,
      docType: opts.docType,
      docId: opts.docId,
      ruleId: rule.id,
      sequence: rule.sequence,
      amount: new Prisma.Decimal(Number(opts.amount || 0).toFixed(2)),
      status: 'PENDING',
      requestedByUserId: opts.userId,
    },
  });

  await notifyApprovers(rule, opts);

  return { required: true, ruleId: rule.id, ruleName: rule.name };
}

/** True when the document is waiting on someone. */
export async function isPending(accountId: string, orgId: string, docType: string, docId: string) {
  const row = await prisma.approvalRequest.findFirst({
    where: { accountId, orgId, docType, docId, status: 'PENDING' },
    select: { id: true },
  });
  return Boolean(row);
}

export class ApprovalError extends Error {
  status: number;
  constructor(message: string, status = 403) {
    super(message);
    this.name = 'ApprovalError';
    this.status = status;
  }
}

/** Approve or reject. Only a holder of the rule's approver role may decide. */
export async function decide(opts: {
  accountId: string;
  orgId: string;
  branchId: string;
  userId: string;
  requestId: string;
  approve: boolean;
  comment?: string;
}) {
  const request = await prisma.approvalRequest.findFirst({
    where: { id: opts.requestId, accountId: opts.accountId, orgId: opts.orgId },
    include: { rule: true },
  });
  if (!request) throw new ApprovalError('Approval request not found', 404);
  if (request.status !== 'PENDING') throw new ApprovalError('This request has already been decided', 409);

  const roleIds = await resolveRoleIds(opts.accountId, opts.orgId, opts.userId, opts.branchId);
  if (!roleIds.includes(request.rule.approverRoleId)) {
    throw new ApprovalError('You do not hold the role required to approve this document');
  }
  if (request.requestedByUserId === opts.userId) {
    throw new ApprovalError('You cannot approve a document you raised');
  }

  return prisma.approvalRequest.update({
    where: { id: request.id },
    data: {
      status: opts.approve ? 'APPROVED' : 'REJECTED',
      decidedByUserId: opts.userId,
      decidedAt: new Date(),
      comment: opts.comment || null,
    },
    include: { rule: true },
  });
}

/**
 * Tells everyone holding the approving role that something is waiting.
 * Failures here are swallowed by sendTemplate: a mail outage must not stop a
 * document being raised.
 */
async function notifyApprovers(
  rule: { id: string; name: string; approverRoleId: string },
  opts: { accountId: string; orgId: string; userId: string; docType: string; docId: string; amount: number }
) {
  const assignments = await platformPrisma.userRoleAssignment.findMany({
    where: { accountId: opts.accountId, orgId: opts.orgId, roleId: rule.approverRoleId },
    select: { userId: true },
  });

  const profileRoles = await platformPrisma.roleProfileRole.findMany({
    where: { accountId: opts.accountId, orgId: opts.orgId, roleId: rule.approverRoleId },
    select: { profileId: true },
  });
  const viaProfiles = profileRoles.length
    ? await platformPrisma.userRoleProfile.findMany({
        where: {
          accountId: opts.accountId,
          orgId: opts.orgId,
          profileId: { in: profileRoles.map((p) => p.profileId) },
        },
        select: { userId: true },
      })
    : [];

  const userIds = Array.from(new Set([...assignments, ...viaProfiles].map((a) => a.userId))).filter(
    (id) => id !== opts.userId
  );
  if (!userIds.length) return;

  const [approvers, requester, org] = await Promise.all([
    platformPrisma.user.findMany({ where: { id: { in: userIds }, isActive: true }, select: { email: true, fullName: true } }),
    platformPrisma.user.findUnique({ where: { id: opts.userId }, select: { fullName: true } }),
    platformPrisma.org.findUnique({ where: { id: opts.orgId }, select: { name: true } }),
  ]);

  const docNumber = await documentNumber(opts.docType, opts.docId);

  for (const approver of approvers) {
    await sendTemplate({
      templateKey: 'approval.requested',
      to: approver.email,
      toName: approver.fullName,
      accountId: opts.accountId,
      orgId: opts.orgId,
      relatedType: opts.docType,
      relatedId: opts.docId,
      data: {
        docType: opts.docType.toLowerCase(),
        docNumber,
        amount: opts.amount.toFixed(2),
        ruleName: rule.name,
        requesterName: requester?.fullName || 'A colleague',
        orgName: org?.name || '',
      },
    });
  }
}

/** Best-effort human-readable reference for the notification body. */
async function documentNumber(docType: string, docId: string) {
  if (docType !== 'INVOICE') return docId.slice(0, 8);
  const rows = await prisma.invoice.findMany({ where: { id: docId }, select: { number: true } });
  return rows?.[0]?.number || docId.slice(0, 8);
}

/** Tells the raiser what happened to their document. */
export async function notifyDecision(opts: {
  accountId: string;
  orgId: string;
  requestedByUserId: string;
  deciderUserId: string;
  docType: string;
  docId: string;
  amount: number;
  approved: boolean;
  comment?: string | null;
}) {
  const [raiser, decider] = await Promise.all([
    platformPrisma.user.findUnique({ where: { id: opts.requestedByUserId }, select: { email: true, fullName: true } }),
    platformPrisma.user.findUnique({ where: { id: opts.deciderUserId }, select: { fullName: true } }),
  ]);
  if (!raiser) return;

  await sendTemplate({
    templateKey: 'approval.decided',
    to: raiser.email,
    toName: raiser.fullName,
    accountId: opts.accountId,
    orgId: opts.orgId,
    relatedType: opts.docType,
    relatedId: opts.docId,
    data: {
      docType: opts.docType.toLowerCase(),
      docNumber: await documentNumber(opts.docType, opts.docId),
      amount: opts.amount.toFixed(2),
      decision: opts.approved ? 'approved' : 'rejected',
      deciderName: decider?.fullName || 'An approver',
      comment: opts.comment ? `Comment: ${opts.comment}` : '',
    },
  });
}
