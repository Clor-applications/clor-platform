import type { NextFunction, Request, Response } from 'express';
import { platformPrisma } from '../utils/platformPrisma.js';
import { outsideTenant } from '../utils/tenantScope.js';
import { stepUpRefusal } from './stepUp.js';

/**
 * A person's authority over the account itself — the Workspace's top level
 * (docs/workspace/WORKSPACE_IMPLEMENTATION_CHECKLIST.md, W-1, decision D-2).
 *
 *   OWNER > ADMIN > BILLING_ADMIN | MEMBER
 *
 * This is control-plane authority: who may add a company, change someone's
 * account role, see the account and its plan. It opens no business data — a
 * ledger, a payslip, an employee's file still take a role in that company
 * (spec rule 2.2.7). The paused account-owner work made every owner an
 * administrator of every company; that is deliberately not done here.
 *
 * Read across companies, so every query runs outside the request's tenant and
 * names its account explicitly.
 */

export const ACCOUNT_ROLES = ['OWNER', 'ADMIN', 'BILLING_ADMIN', 'MEMBER'] as const;
export type AccountRole = (typeof ACCOUNT_ROLES)[number];
export const isAccountRole = (v: unknown): v is AccountRole => ACCOUNT_ROLES.includes(v as AccountRole);

/** Who administers the account: owners and admins. */
export const ACCOUNT_ADMINS: AccountRole[] = ['OWNER', 'ADMIN'];
/** Who may see the plan and billing. */
export const ACCOUNT_BILLING: AccountRole[] = ['OWNER', 'ADMIN', 'BILLING_ADMIN'];

export class AccountMembershipError extends Error {
  constructor(public status: number, message: string, public code: string) {
    super(message);
  }
}

/** The person's live role in the account, or null (no membership, or suspended). */
export async function accountRoleOf(accountId: string, userId: string): Promise<AccountRole | null> {
  if (!accountId || !userId) return null;
  const m = await outsideTenant('account membership: the person’s role', () =>
    platformPrisma.accountMembership.findUnique({ where: { accountId_userId: { accountId, userId } }, select: { role: true, status: true } })
  );
  return m && m.status === 'ACTIVE' && isAccountRole(m.role) ? m.role : null;
}

/**
 * A membership for somebody whose home is this account. Idempotent: an
 * existing membership keeps its role. Called wherever a login is made (signup,
 * an administrator adding a person, SCIM, SSO) and at boot for any missed.
 */
export async function ensureAccountMembership(accountId: string, userId: string, role: AccountRole = 'MEMBER', addedByUserId?: string | null) {
  await outsideTenant('account membership: make sure the person belongs', () =>
    platformPrisma.accountMembership.upsert({
      where: { accountId_userId: { accountId, userId } },
      update: {},
      create: { accountId, userId, role, addedByUserId: addedByUserId || null },
    })
  );
}

export async function recordAccountEvent(e: {
  accountId: string;
  actorUserId?: string | null;
  action: string;
  targetType: string;
  targetId?: string | null;
  result?: 'OK' | 'DENIED';
  message?: string;
  metadata?: Record<string, unknown>;
  requestId?: string | null;
}) {
  await outsideTenant('account audit: record', () =>
    platformPrisma.accountAuditEvent.create({
      data: {
        accountId: e.accountId,
        actorUserId: e.actorUserId || null,
        action: e.action,
        targetType: e.targetType,
        targetId: e.targetId || null,
        result: e.result || 'OK',
        message: e.message || null,
        metadata: e.metadata ? JSON.stringify(e.metadata) : null,
        requestId: e.requestId || null,
      },
    })
  );
}

/** The account of the request: the account that owns the company in scope. */
const accountOf = (req: Request) => String(req.tenant?.accountId || '');
const requestIdOf = (req: Request) => String(req.headers['x-request-id'] || '') || null;

/** Route guard: the caller holds one of `roles` in the account of the company in scope. */
export const requireAccountRole =
  (...roles: AccountRole[]) =>
  async (req: Request, res: Response, next: NextFunction) => {
    const role = await accountRoleOf(accountOf(req), String(req.auth?.userId || ''));
    if (role && roles.includes(role)) return next();
    /* A refused attempt to change something is a security signal: it goes in the account's audit (reads are not recorded). */
    if (req.method !== 'GET' && req.method !== 'HEAD' && accountOf(req)) {
      await recordAccountEvent({
        accountId: accountOf(req),
        actorUserId: String(req.auth?.userId || '') || null,
        action: 'ACCESS_DENIED',
        targetType: 'Route',
        targetId: `${req.method} ${req.baseUrl || ''}${req.route?.path || req.path}`,
        result: 'DENIED',
        message: 'An account-level action was refused: the caller lacks the account role it needs.',
        metadata: { code: 'ACCOUNT_ROLE_REQUIRED', required: roles, had: role },
        requestId: requestIdOf(req),
      });
    }
    return res.status(403).json({
      error: roles.includes('BILLING_ADMIN')
        ? 'Only an owner, administrator or billing administrator of this account can open this.'
        : 'Only an owner or administrator of this account can do this.',
      code: 'ACCOUNT_ROLE_REQUIRED',
      required: roles,
    });
  };

export async function listAccountMembers(accountId: string) {
  return outsideTenant('account membership: list', async () => {
    const rows = await platformPrisma.accountMembership.findMany({ where: { accountId }, orderBy: { createdAt: 'asc' } });
    const people = await platformPrisma.user.findMany({
      where: { id: { in: rows.map((r) => r.userId) } },
      select: { id: true, fullName: true, email: true, isActive: true, lastLoginAt: true },
    });
    const byId = new Map(people.map((p) => [p.id, p]));
    return rows.map((r) => ({
      userId: r.userId,
      name: byId.get(r.userId)?.fullName || null,
      email: byId.get(r.userId)?.email || null,
      canSignIn: byId.get(r.userId)?.isActive ?? false,
      lastSignInAt: byId.get(r.userId)?.lastLoginAt || null,
      role: r.role,
      status: r.status,
      since: r.createdAt,
    }));
  });
}

/**
 * Change somebody's account role, under the rules:
 *  - only an owner makes or unmakes an owner, and only after a fresh
 *    authenticator code (step-up);
 *  - an admin may set admin, billing admin or member, never touching an owner;
 *  - the last active owner cannot stop being one.
 * Every change, and every refusal by these rules, is in the account's audit.
 */
export async function setAccountRole(req: Request, targetUserId: string, nextRole: AccountRole) {
  const accountId = accountOf(req);
  const actorUserId = String(req.auth?.userId || '');
  const deny = async (status: number, message: string, code: string) => {
    await recordAccountEvent({ accountId, actorUserId, action: 'ACCOUNT_ROLE_CHANGE', targetType: 'AccountMembership', targetId: targetUserId, result: 'DENIED', message, metadata: { to: nextRole, code }, requestId: requestIdOf(req) });
    throw new AccountMembershipError(status, message, code);
  };

  const actorRole = await accountRoleOf(accountId, actorUserId);
  if (!actorRole || !ACCOUNT_ADMINS.includes(actorRole)) await deny(403, 'Only an owner or administrator of this account can change account roles.', 'ACCOUNT_ROLE_REQUIRED');

  const target = await outsideTenant('account membership: the person being changed', () =>
    platformPrisma.accountMembership.findUnique({ where: { accountId_userId: { accountId, userId: targetUserId } } })
  );
  if (!target) await deny(404, 'This person does not belong to this account.', 'NOT_A_MEMBER');
  if (target!.role === nextRole) return { changed: false, role: nextRole };

  const ownership = target!.role === 'OWNER' || nextRole === 'OWNER';
  if (ownership && actorRole !== 'OWNER') await deny(403, 'Only an owner of this account can make or remove an owner.', 'ACCOUNT_OWNER_ONLY');
  if (nextRole === 'OWNER' && target!.status !== 'ACTIVE') await deny(409, 'A suspended person cannot own the account.', 'SUSPENDED_MEMBER');
  if (ownership) {
    const refused = await stepUpRefusal(req, 'Changing who owns the account needs an authenticator app. Set one up in your profile first.');
    if (refused) await deny(refused.status, refused.body.error, refused.body.code);
  }

  /* The last-owner check and the write in one transaction, so two owners demoting each other at once cannot leave none. */
  await outsideTenant('account membership: change the role', () =>
    platformPrisma.$transaction(async (tx) => {
      if (target!.role === 'OWNER') {
        await tx.$executeRaw`SELECT 1 FROM "AccountMembership" WHERE "accountId" = ${accountId} AND "role" = 'OWNER' FOR UPDATE`;
        const owners = await tx.accountMembership.count({ where: { accountId, role: 'OWNER', status: 'ACTIVE', NOT: { userId: targetUserId } } });
        if (owners === 0) throw new AccountMembershipError(409, 'An account needs at least one owner. Make someone else an owner first.', 'LAST_ACCOUNT_OWNER');
      }
      await tx.accountMembership.update({ where: { accountId_userId: { accountId, userId: targetUserId } }, data: { role: nextRole } });
    })
  ).catch(async (e) => {
    if (e instanceof AccountMembershipError) await deny(e.status, e.message, e.code);
    throw e;
  });

  await recordAccountEvent({
    accountId,
    actorUserId,
    action: 'ACCOUNT_ROLE_CHANGE',
    targetType: 'AccountMembership',
    targetId: targetUserId,
    message: `Account role changed from ${target!.role} to ${nextRole}`,
    metadata: { from: target!.role, to: nextRole },
    requestId: requestIdOf(req),
  });
  return { changed: true, role: nextRole };
}

/** Boot: everyone whose home is an account belongs to it (a login made before this release, or by a path that missed it). */
export async function syncAccountMemberships() {
  return outsideTenant('account membership: everyone belongs to their home account', async () => {
    const missing = await platformPrisma.$queryRaw<{ id: string; accountId: string; isActive: boolean }[]>`
      SELECT u."id", u."accountId", u."isActive" FROM "User" u
      LEFT JOIN "AccountMembership" m ON m."accountId" = u."accountId" AND m."userId" = u."id"
      WHERE m."id" IS NULL`;
    for (const u of missing) {
      await platformPrisma.accountMembership.create({ data: { accountId: u.accountId, userId: u.id, status: u.isActive ? 'ACTIVE' : 'SUSPENDED' } }).catch((e: any) => {
        if (String(e?.code || '') !== 'P2002') throw e;
      });
    }
    return missing.length;
  });
}
