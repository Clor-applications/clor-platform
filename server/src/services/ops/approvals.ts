import type { Request } from 'express';

import { platformPrisma } from '../../utils/platformPrisma.js';
import { sendTemplate } from '../mailer.js';
import { audit } from '../../routes/ops.js';

/**
 * Two-person approval (Ops plan: approval-managed changes). An operator asks
 * for a change that is over a limit; a second operator, never the one who
 * asked, approves it with a fresh authenticator code, and only then is it
 * applied, as the approver, with both names on the record. Two kinds, both
 * held to the one limit in the platform setting `ops.approvals`, which the
 * owner sets on the Approvals page:
 *  - DEAL: a subscription deal whose discount is more than the limit
 *    (routes/opsDeals.ts);
 *  - GRANT: apps set free or cheaper by hand ("Free plan by hand", "Change
 *    apps", Trials "Convert"), counted the same way (services/ops/grants.ts).
 * Both change the customer's plan, so a customer has at most one of either
 * waiting, and each request keeps the plan's version when it was asked: one
 * changed directly since is refused when it is approved.
 *
 * A request lasts EXPIRES_HOURS. One that is not decided by then is shown as
 * expired and cannot be approved: ask again, with the prices as they are then.
 */
export const APPROVALS_KEY = 'ops.approvals';
export const EXPIRES_HOURS = 72;
const DEFAULT_PERCENT = 20;

export type ApprovalSettings = { discountPercent: number };

export function readApprovalSettings(v: unknown): ApprovalSettings {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  const n = Number(o.discountPercent);
  return { discountPercent: Number.isInteger(n) && n >= 0 && n <= 90 ? n : DEFAULT_PERCENT };
}

export async function approvalSettings(): Promise<ApprovalSettings> {
  const row = await platformPrisma.platformSetting.findUnique({ where: { key: APPROVALS_KEY } });
  return readApprovalSettings(row?.value);
}

export async function saveApprovalSettings(discountPercent: number, userId: string) {
  const value = readApprovalSettings({ discountPercent });
  await platformPrisma.platformSetting.upsert({ where: { key: APPROVALS_KEY }, create: { key: APPROVALS_KEY, value, updatedByUserId: userId }, update: { value, updatedByUserId: userId } });
  return value;
}

export const STATUS_WORDS: Record<string, string> = { PENDING: 'Waiting', APPROVED: 'Approved', REJECTED: 'Turned down', CANCELLED: 'Withdrawn', EXPIRED: 'Expired', FAILED: 'Approved, could not be applied' };

/** The status as people should see it: a waiting request past its time is expired. */
export const statusOf = (a: { status: string; expiresAt: Date }, now = new Date()) => (a.status === 'PENDING' && a.expiresAt <= now ? 'EXPIRED' : a.status);

const OPS_URL = () => (process.env.OPS_URL || 'https://ops.clor.in').replace(/\/$/, '');

/** Email every other operator who can approve: Billing and the owner. */
async function tellApprovers(askedBy: string, a: { id: string; summary: string; reason: string }, customerName: string) {
  const ops = await platformPrisma.platformOperator.findMany({ where: { active: true, role: { in: ['BILLING', 'SUPER_ADMIN'] }, userId: { not: askedBy } }, select: { userId: true } });
  if (!ops.length) return 0;
  const [users, asker] = await Promise.all([
    platformPrisma.user.findMany({ where: { id: { in: ops.map((o) => o.userId) }, isActive: true }, select: { email: true, fullName: true } }),
    platformPrisma.user.findUnique({ where: { id: askedBy }, select: { fullName: true, email: true } }),
  ]);
  let sent = 0;
  for (const u of users) {
    await sendTemplate({
      templateKey: 'ops.approval_asked',
      to: u.email,
      transactional: true,
      relatedType: 'OpsApproval',
      relatedId: a.id,
      data: { userName: u.fullName || u.email, askedBy: asker?.fullName || asker?.email || 'A colleague', customer: customerName, summary: a.summary, reason: a.reason, opsUrl: `${OPS_URL()}/#/approvals` },
    })
      .then(() => (sent += 1))
      .catch(() => null);
  }
  return sent;
}

/**
 * Keep the request, write it in the audit log, and tell the people who can approve it.
 *
 * One waiting request per customer: the check and the new row are
 * made under a lock on the customer's account row, so two operators asking at
 * the same moment cannot both open one (a find, then a create, let both
 * through). Null when one is already waiting.
 */
export const APPROVAL_KINDS = ['DEAL', 'GRANT'] as const;
export type ApprovalKind = (typeof APPROVAL_KINDS)[number];
/** Plain words for a kind, on the Approvals page. */
export const KIND_WORDS: Record<string, string> = { DEAL: 'Subscription deal', GRANT: 'Apps by hand' };
export const ALREADY_WAITING = 'A change to this customer’s plan is already waiting in Approvals. Withdraw it there first, or wait for the decision.';

/** Whether a change to this customer's plan is already waiting (a quick answer; askApproval asks again under the lock). */
export const waitingFor = (accountId: string) => platformPrisma.opsApproval.findFirst({ where: { accountId, kind: { in: [...APPROVAL_KINDS] }, status: 'PENDING', expiresAt: { gt: new Date() } }, select: { id: true } });

export async function askApproval(req: Request, input: { kind: ApprovalKind; accountId: string | null; customerName: string; payload: unknown; summary: string; discountPercent: number | null; reason: string }) {
  const data = {
    kind: input.kind,
    accountId: input.accountId,
    payload: input.payload as any,
    summary: input.summary,
    discountPercent: input.discountPercent,
    reason: input.reason,
    requestedBy: req.auth!.userId,
    expiresAt: new Date(Date.now() + EXPIRES_HOURS * 3600_000),
  };
  const a = await platformPrisma.$transaction(async (tx) => {
    if (input.accountId) {
      await tx.$queryRaw`SELECT id FROM "Account" WHERE id = ${input.accountId} FOR UPDATE`;
      /* Any kind: a deal and a grant both rewrite the plan, so they wait one at a time. */
      const waiting = await tx.opsApproval.findFirst({ where: { accountId: input.accountId, kind: { in: [...APPROVAL_KINDS] }, status: 'PENDING', expiresAt: { gt: new Date() } }, select: { id: true } });
      if (waiting) return null;
    }
    return tx.opsApproval.create({ data });
  });
  if (!a) return null;
  await audit(req, 'APPROVAL_ASKED', { accountId: input.accountId }, { approvalId: a.id, customer: input.customerName, what: input.summary, kind: KIND_WORDS[input.kind], discount: input.discountPercent != null ? `${input.discountPercent}%` : undefined, reason: input.reason }, { customerLog: false });
  await tellApprovers(req.auth!.userId, a, input.customerName);
  return { id: a.id, summary: a.summary, status: a.status, expiresAt: a.expiresAt };
}
