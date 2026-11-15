import { notifyUsers } from './notifications.js';
import { Prisma } from '@prisma/client';
import { prisma } from '../utils/prisma.js';
import { platformPrisma } from '../utils/platformPrisma.js';
import { resolveRoleIds } from './access.js';
import { sendTemplate } from './mailer.js';
import { isFeatureEnabled } from './features.js';
import { getApprovalPolicy } from './approvalPolicy.js';

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

/**
 * Active levels covering this amount, in approval order.
 *
 * One rule per level (sequence): where a branch has its own rule at a level,
 * it replaces the company-wide one there.
 */
export async function findMatchingRules(opts: {
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
  const matching = rules.filter((r) => {
    const min = Number(r.minAmount ?? 0);
    const max = r.maxAmount === null || r.maxAmount === undefined ? null : Number(r.maxAmount);
    if (amount < min) return false;
    if (max !== null && amount >= max) return false;
    return true;
  });
  const byLevel = new Map<number, (typeof matching)[number]>();
  for (const rule of matching) {
    const current = byLevel.get(rule.sequence);
    if (!current || (rule.branchId === opts.branchId && current.branchId !== opts.branchId)) {
      byLevel.set(rule.sequence, rule);
    }
  }
  return [...byLevel.values()].sort((a, b) => a.sequence - b.sequence);
}

/** The first level covering this amount, if any. Lowest sequence wins. */
export async function findMatchingRule(opts: Parameters<typeof findMatchingRules>[0]) {
  return (await findMatchingRules(opts))[0] || null;
}

/**
 * Decide whether a document needs approval, and record the request if so.
 *
 * A requester must never release their own document merely because they also
 * hold the approver role. The decision endpoint enforces the same separation.
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
  if (!(await isFeatureEnabled(opts.accountId, opts.orgId, 'approvals'))) return { required: false };
  const policy = await getApprovalPolicy(opts.accountId, opts.orgId);
  const levels = await findMatchingRules(opts);
  if (!levels.length) return { required: false };
  for (const level of levels) {
    const eligible = await eligibleApproverIds(level.approverRoleId, opts, policy.allowSelfApproval);
    if (!eligible.length) throw new ApprovalError(`No active approver is assigned for ${level.name}. Assign an approver before submitting.`, 409);
  }
  await createRequestForRule(levels[0], opts);
  return { required: true, ruleId: levels[0].id, ruleName: levels[0].name };
}

async function createRequestForRule(
  rule: { id: string; name: string; sequence: number; approverRoleId: string },
  opts: { accountId: string; orgId: string; branchId: string; userId: string; docType: string; docId: string; amount: number }
) {
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

  // Telling the approvers must not undo a request that has been recorded.
  try {
    await notifyApprovers(rule, opts);
  } catch (error) {
    console.error('Approval notification failed', error);
  }
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

  if (request.branchId !== opts.branchId) {
    throw new ApprovalError('Switch to the document branch to decide this request');
  }
  const policy = await getApprovalPolicy(opts.accountId, opts.orgId);
  const roleIds = await resolveRoleIds(opts.accountId, opts.orgId, opts.userId, request.branchId);
  if (!roleIds.includes(request.rule.approverRoleId)) {
    throw new ApprovalError('You do not hold the role required to approve this document');
  }
  if (request.requestedByUserId === opts.userId && !policy.allowSelfApproval) {
    throw new ApprovalError('You cannot approve a document you raised');
  }
  if (opts.approve && policy.requireApprovalRemarks && !opts.comment?.trim()) {
    throw new ApprovalError('Give a note before approving this document', 400);
  }
  if (!opts.approve && !opts.comment?.trim()) {
    throw new ApprovalError('Give a reason for rejecting this document', 400);
  }

  // An approval at one level hands the document to the next level, if the
  // amount is covered by one; only the last level releases it.
  const levels = opts.approve
    ? await findMatchingRules({
        accountId: opts.accountId,
        orgId: opts.orgId,
        branchId: request.branchId,
        docType: request.docType,
        amount: Number(request.amount),
      })
    : [];
  const nextRule = levels.find((r) => r.sequence > request.sequence);

  const decided = await prisma.$transaction(async (tx) => {
    /*
     * A-12: claimed only while still pending. Reading "pending" and then
     * writing were two steps, so two approvers at the same moment both passed
     * and both posted the invoice to the journal. Exactly one claim succeeds.
     */
    const claimed = await tx.approvalRequest.updateMany({
      where: { id: request.id, status: 'PENDING' },
      data: {
        status: opts.approve ? 'APPROVED' : 'REJECTED',
        decidedByUserId: opts.userId,
        decidedAt: new Date(),
        comment: opts.comment?.trim() || null,
      },
    });
    if (claimed.count !== 1) throw new ApprovalError('This request has already been decided', 409);
    if (nextRule) {
      await tx.approvalRequest.create({
        data: {
          accountId: request.accountId,
          orgId: request.orgId,
          branchId: request.branchId,
          docType: request.docType,
          docId: request.docId,
          ruleId: nextRule.id,
          sequence: nextRule.sequence,
          amount: request.amount,
          status: 'PENDING',
          requestedByUserId: request.requestedByUserId,
        },
      });
    }
    return tx.approvalRequest.findUniqueOrThrow({ where: { id: request.id }, include: { rule: true } });
  });

  // The audit trail is in the platform database, so it is written after the
  // decision rather than with it; a failure here must not undo the decision.
  try {
    await platformPrisma.auditLog.create({
      data: {
        accountId: request.accountId,
        orgId: request.orgId,
        branchId: request.branchId,
        entity: 'APPROVAL_REQUEST',
        entityId: request.id,
        action: opts.approve ? 'APPROVED' : 'REJECTED',
        message: opts.comment?.trim() || null,
        metadata: JSON.stringify({ docType: request.docType, docId: request.docId, sequence: request.sequence }),
        createdByUserId: opts.userId,
      },
    });
  } catch (error) {
    console.error('Approval decision not written to the audit trail', error);
  }

  if (nextRule) {
    try {
      await notifyApprovers(nextRule, {
        accountId: request.accountId,
        orgId: request.orgId,
        branchId: request.branchId,
        userId: request.requestedByUserId,
        docType: request.docType,
        docId: request.docId,
        amount: Number(request.amount),
      });
    } catch (error) {
      console.error('Approval notification failed', error);
    }
  }
  return { ...decided, nextLevel: nextRule ? { id: nextRule.id, name: nextRule.name, sequence: nextRule.sequence } : null };
}

/** Undo a claim whose consequence (the journal posting) could not be made, so the request can be decided again. */
export async function reopen(requestId: string) {
  await prisma.approvalRequest.updateMany({
    where: { id: requestId, status: 'APPROVED' },
    data: { status: 'PENDING', decidedByUserId: null, decidedAt: null, comment: null },
  });
}

/**
 * Tells everyone holding the approving role that something is waiting.
 * Failures here are swallowed by sendTemplate: a mail outage must not stop a
 * document being raised.
 */
async function notifyApprovers(
  rule: { id: string; name: string; approverRoleId: string },
  opts: { accountId: string; orgId: string; branchId?: string; userId: string; docType: string; docId: string; amount: number }
) {
  const policy = await getApprovalPolicy(opts.accountId, opts.orgId);
  const userIds = await eligibleApproverIds(rule.approverRoleId, opts, policy.allowSelfApproval);
  if (!userIds.length) return;

  const [approvers, requester, org] = await Promise.all([
    platformPrisma.user.findMany({ where: { id: { in: userIds }, isActive: true }, select: { email: true, fullName: true } }),
    platformPrisma.user.findUnique({ where: { id: opts.userId }, select: { fullName: true } }),
    platformPrisma.org.findUnique({ where: { id: opts.orgId }, select: { name: true } }),
  ]);

  const docNumber = await documentNumber(opts.docType, opts.docId);
  await notifyUsers(opts.accountId, opts.orgId, userIds, {
    kind: 'approval.requested',
    title: `${requester?.fullName || 'A colleague'} needs approval on ${opts.docType.toLowerCase()} ${docNumber}`,
    body: `${opts.amount.toFixed(2)} under the rule “${rule.name}”.`,
    link: { app: 'accounting', screen: 'approvals' },
  });

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

/**
 * The active users who may decide at this level: holders of the approver role,
 * directly or through a role profile, company-wide or in the document's
 * branch. The requester is left out unless the company allows self-approval.
 */
async function eligibleApproverIds(
  approverRoleId: string,
  opts: { accountId: string; orgId: string; branchId?: string; userId: string },
  allowSelfApproval = false
) {
  const inBranch = opts.branchId ? { OR: [{ branchId: null }, { branchId: opts.branchId }] } : {};
  const assignments = await platformPrisma.userRoleAssignment.findMany({
    where: { accountId: opts.accountId, orgId: opts.orgId, roleId: approverRoleId, ...inBranch },
    select: { userId: true },
  });

  const profileRoles = await platformPrisma.roleProfileRole.findMany({
    where: { accountId: opts.accountId, orgId: opts.orgId, roleId: approverRoleId },
    select: { profileId: true },
  });
  const viaProfiles = profileRoles.length
    ? await platformPrisma.userRoleProfile.findMany({
        where: {
          accountId: opts.accountId,
          orgId: opts.orgId,
          profileId: { in: profileRoles.map((p) => p.profileId) },
          ...inBranch,
        },
        select: { userId: true },
      })
    : [];

  const candidateIds = Array.from(new Set([...assignments, ...viaProfiles].map((a) => a.userId))).filter(
    (id) => allowSelfApproval || id !== opts.userId
  );
  if (!candidateIds.length) return [];
  const users = await platformPrisma.user.findMany({ where: { id: { in: candidateIds }, isActive: true }, select: { id: true } });
  return users.map((u) => u.id);
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
