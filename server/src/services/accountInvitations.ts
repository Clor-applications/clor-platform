import { createHash, randomBytes } from 'node:crypto';
import bcrypt from 'bcrypt';
import type { Request } from 'express';
import { platformPrisma } from '../utils/platformPrisma.js';
import { outsideTenant, runInTenant } from '../utils/tenantScope.js';
import { userIsAdmin } from './roleGuards.js';
import { userLimitReason } from './entitlements.js';
import { sendTemplate } from './mailer.js';
import { ACCOUNT_ADMINS, accountRoleOf, recordAccountEvent, type AccountRole } from './accountMembership.js';
import { lockQuota } from './quotaLock.js';
import { domainRefusalFor, policyForOrgs, validatePassword } from './policy.js';

/**
 * Workspace W-3: inviting a person into the account.
 *
 * Replaces "an administrator types a password for somebody else": the person
 * gets a link, and they choose their own password (or use the login they
 * already have). The rules, from the spec (§9) and decision D-2:
 *
 *  - Only an owner or administrator of the account invites. Nobody is invited
 *    as an owner: an owner is made by another owner, with step-up.
 *  - Granting a role in a company needs the inviter to administer that
 *    company — nobody grants more than they hold.
 *  - The token is shown once (in the email) and stored only as a hash. It
 *    works once: accepting moves PENDING → ACCEPTED under a conditional
 *    update, so a second accept (a double click, two tabs) creates nothing.
 *  - It expires (INVITE_DAYS); resending issues a new token and a new date;
 *    revoking ends it. Every step is in the account's audit.
 *  - Seats: a pending invitation reserves no seat. The plan's user limit is
 *    checked when the invitation is sent (a warning) and enforced when it is
 *    accepted.
 *  - A person whose login belongs to another account is not invited here:
 *    they are let into a company through Outside access.
 */

export const INVITE_DAYS = 7;
export const INVITABLE_ROLES: AccountRole[] = ['ADMIN', 'BILLING_ADMIN', 'MEMBER'];
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const APP_URL = process.env.APP_URL || 'http://localhost:5173';

export type Grant = { orgId: string; branchIds: string[]; roleIds: string[] };

export class InvitationError extends Error {
  constructor(public status: number, message: string, public code: string) {
    super(message);
  }
}

const parseGrants = (raw: string): Grant[] => {
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
};

/** What an invitation looks like to the account's administrators (never the token). */
export const shapeInvitation = (i: {
  id: string; email: string; accountRole: string; grants: string; status: string; expiresAt: Date; invitedByUserId: string;
  acceptedAt: Date | null; revokedAt: Date | null; sendCount: number; lastSentAt: Date; createdAt: Date;
}) => ({
  id: i.id,
  email: i.email,
  accountRole: i.accountRole,
  grants: parseGrants(i.grants),
  status: i.status === 'PENDING' && i.expiresAt < new Date() ? 'EXPIRED' : i.status,
  expiresAt: i.expiresAt,
  invitedByUserId: i.invitedByUserId,
  acceptedAt: i.acceptedAt,
  revokedAt: i.revokedAt,
  sendCount: i.sendCount,
  lastSentAt: i.lastSentAt,
  createdAt: i.createdAt,
});

/** Checks every grant belongs to the account and is within the inviter's authority; fills a default branch. */
async function checkGrants(accountId: string, inviterId: string, grants: Grant[]): Promise<Grant[]> {
  if (!grants.length) throw new InvitationError(400, 'Choose at least one company for this person.', 'NO_COMPANY');
  const out: Grant[] = [];
  for (const g of grants) {
    const orgId = String(g?.orgId || '');
    const org = await platformPrisma.org.findFirst({ where: { id: orgId, accountId }, select: { id: true } });
    if (!org) throw new InvitationError(400, 'One of the companies is not in this account.', 'FOREIGN_COMPANY');
    const branchIds = [...new Set((g.branchIds || []).map(String))];
    const roleIds = [...new Set((g.roleIds || []).map(String))];
    const result = await runInTenant(orgId, async () => {
      if (branchIds.length) {
        const n = await platformPrisma.branch.count({ where: { accountId, orgId, id: { in: branchIds } } });
        if (n !== branchIds.length) throw new InvitationError(400, 'One of the branches is not in that company.', 'FOREIGN_BRANCH');
      }
      if (roleIds.length) {
        const n = await platformPrisma.role.count({ where: { accountId, orgId, id: { in: roleIds } } });
        if (n !== roleIds.length) throw new InvitationError(400, 'One of the roles is not in that company.', 'FOREIGN_ROLE');
        /* Nobody grants more than they hold: roles in a company are given by its administrators. */
        if (!(await userIsAdmin(accountId, orgId, inviterId))) {
          throw new InvitationError(403, 'You can only give roles in a company you administer.', 'ABOVE_AUTHORITY');
        }
      }
      /* No branch chosen: the head office, else the company's first branch. */
      let fallback = branchIds;
      if (!fallback.length) {
        const ho =
          (await platformPrisma.branch.findFirst({ where: { accountId, orgId, branchCode: 'HO' }, select: { id: true } })) ||
          (await platformPrisma.branch.findFirst({ where: { accountId, orgId }, orderBy: { createdAt: 'asc' }, select: { id: true } }));
        fallback = ho ? [ho.id] : [];
      }
      return { orgId, branchIds: fallback, roleIds };
    });
    out.push(result);
  }
  return out;
}

async function sendInvitationEmail(accountId: string, inviterId: string, email: string, token: string, expiresAt: Date, grants: Grant[]) {
  const [account, inviter, orgs] = await Promise.all([
    platformPrisma.account.findUnique({ where: { id: accountId }, select: { name: true } }),
    platformPrisma.user.findUnique({ where: { id: inviterId }, select: { fullName: true, email: true } }),
    platformPrisma.org.findMany({ where: { accountId, id: { in: grants.map((g) => g.orgId) } }, select: { name: true } }),
  ]);
  await sendTemplate({
    templateKey: 'account.invited',
    to: email,
    accountId,
    relatedType: 'AccountInvitation',
    transactional: true,
    data: {
      inviterName: inviter?.fullName || inviter?.email || 'Your administrator',
      accountName: account?.name || 'their account',
      companies: orgs.length ? ` (${orgs.map((o) => o.name).join(', ')})` : '',
      inviteUrl: `${APP_URL.replace(/\/$/, '')}/invite?token=${token}`,
      expiresOn: expiresAt.toISOString().slice(0, 10),
    },
  });
}

/** POST /account/invitations — the caller is an owner or administrator (checked here, not only by the route). */
export async function createInvitation(req: Request, input: { email?: unknown; accountRole?: unknown; grants?: unknown }) {
  const accountId = String(req.tenant?.accountId || '');
  const inviterId = String(req.auth?.userId || '');
  const email = String(input.email || '').trim().toLowerCase();
  const accountRole = (String(input.accountRole || 'MEMBER').toUpperCase() as AccountRole);
  const requestId = String(req.headers['x-request-id'] || '') || null;

  const role = await accountRoleOf(accountId, inviterId);
  if (!role || !ACCOUNT_ADMINS.includes(role)) throw new InvitationError(403, 'Only an owner or administrator of this account can invite people.', 'ACCOUNT_ROLE_REQUIRED');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new InvitationError(400, 'That is not an email address.', 'BAD_EMAIL');
  if (!INVITABLE_ROLES.includes(accountRole)) {
    throw new InvitationError(400, 'A person can be invited as an administrator, a billing administrator or a member. An owner is made by another owner afterwards.', 'BAD_ROLE');
  }

  return outsideTenant('account invitation: create', async () => {
    const existing = await platformPrisma.user.findFirst({ where: { email }, select: { id: true, accountId: true } });
    if (existing && existing.accountId !== accountId) {
      throw new InvitationError(409, 'This person has a Clor login in another account. Let them into a company under Outside access instead.', 'OTHER_ACCOUNT');
    }
    if (existing) {
      const m = await platformPrisma.accountMembership.findUnique({ where: { accountId_userId: { accountId, userId: existing.id } }, select: { status: true } });
      if (m?.status === 'ACTIVE') throw new InvitationError(409, 'This person is already in the account. Change their access under Users instead.', 'ALREADY_MEMBER');
    }
    const grants = await checkGrants(accountId, inviterId, (Array.isArray(input.grants) ? input.grants : []) as Grant[]);
    /* #4: every company named must allow this address's domain. */
    const domainRefused = await domainRefusalFor(grants.map((g) => g.orgId), email);
    if (domainRefused) throw new InvitationError(400, domainRefused, 'EMAIL_DOMAIN_NOT_ALLOWED');
    const seatWarning = existing ? null : await userLimitReason(accountId);

    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + INVITE_DAYS * 86_400_000);
    const row = await platformPrisma.$transaction(async (tx) => {
      /* One live invitation per person: a new one replaces the old. */
      await tx.accountInvitation.updateMany({ where: { accountId, email, status: 'PENDING' }, data: { status: 'REVOKED', revokedAt: new Date(), revokedByUserId: inviterId } });
      return tx.accountInvitation.create({ data: { accountId, email, accountRole, grants: JSON.stringify(grants), tokenHash: sha256(token), expiresAt, invitedByUserId: inviterId } });
    });
    await sendInvitationEmail(accountId, inviterId, email, token, expiresAt, grants);
    await recordAccountEvent({ accountId, actorUserId: inviterId, action: 'INVITATION_SENT', targetType: 'AccountInvitation', targetId: row.id, message: `Invited ${email} as ${accountRole}`, metadata: { accountRole, companies: grants.map((g) => g.orgId) }, requestId });
    return { invitation: shapeInvitation(row), seatWarning };
  });
}

export async function listInvitations(accountId: string) {
  return outsideTenant('account invitation: list', async () =>
    (await platformPrisma.accountInvitation.findMany({ where: { accountId }, orderBy: { createdAt: 'desc' }, take: 200 })).map(shapeInvitation)
  );
}

/** Resend: a new token and a new expiry; the old link stops working. */
export async function resendInvitation(req: Request, id: string) {
  const accountId = String(req.tenant?.accountId || '');
  const actor = String(req.auth?.userId || '');
  return outsideTenant('account invitation: resend', async () => {
    const row = await platformPrisma.accountInvitation.findFirst({ where: { id, accountId } });
    if (!row) throw new InvitationError(404, 'No such invitation.', 'NOT_FOUND');
    if (row.status !== 'PENDING' && row.status !== 'EXPIRED') throw new InvitationError(409, `This invitation was ${row.status.toLowerCase()}; send a new one instead.`, 'NOT_PENDING');
    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + INVITE_DAYS * 86_400_000);
    const updated = await platformPrisma.accountInvitation.update({
      where: { id },
      data: { tokenHash: sha256(token), expiresAt, status: 'PENDING', sendCount: { increment: 1 }, lastSentAt: new Date() },
    });
    await sendInvitationEmail(accountId, actor, row.email, token, expiresAt, parseGrants(row.grants));
    await recordAccountEvent({ accountId, actorUserId: actor, action: 'INVITATION_RESENT', targetType: 'AccountInvitation', targetId: id, message: `Sent the invitation to ${row.email} again` });
    return shapeInvitation(updated);
  });
}

export async function revokeInvitation(req: Request, id: string) {
  const accountId = String(req.tenant?.accountId || '');
  const actor = String(req.auth?.userId || '');
  return outsideTenant('account invitation: revoke', async () => {
    const done = await platformPrisma.accountInvitation.updateMany({ where: { id, accountId, status: { in: ['PENDING', 'EXPIRED'] } }, data: { status: 'REVOKED', revokedAt: new Date(), revokedByUserId: actor } });
    if (!done.count) throw new InvitationError(404, 'No open invitation with that id.', 'NOT_FOUND');
    await recordAccountEvent({ accountId, actorUserId: actor, action: 'INVITATION_REVOKED', targetType: 'AccountInvitation', targetId: id, message: 'Revoked an invitation' });
    return { revoked: true };
  });
}

async function liveByToken(token: string) {
  const row = await platformPrisma.accountInvitation.findUnique({ where: { tokenHash: sha256(String(token || '')) } });
  if (!row) throw new InvitationError(404, 'This invitation link is not valid. Ask for a new one.', 'INVALID_TOKEN');
  if (row.status === 'ACCEPTED') throw new InvitationError(409, 'This invitation has already been accepted. Sign in instead.', 'ALREADY_ACCEPTED');
  if (row.status === 'REVOKED') throw new InvitationError(410, 'This invitation was withdrawn. Ask for a new one.', 'REVOKED');
  if (row.status === 'EXPIRED' || row.expiresAt < new Date()) throw new InvitationError(410, 'This invitation has expired. Ask for a new one.', 'EXPIRED');
  return row;
}

/** What the person sees before accepting: who invited them, to what. No token or account id goes back. */
export async function previewInvitation(token: string) {
  return outsideTenant('account invitation: preview', async () => {
    const row = await liveByToken(token);
    const grants = parseGrants(row.grants);
    const [account, inviter, orgs, existing] = await Promise.all([
      platformPrisma.account.findUnique({ where: { id: row.accountId }, select: { name: true } }),
      platformPrisma.user.findUnique({ where: { id: row.invitedByUserId }, select: { fullName: true } }),
      platformPrisma.org.findMany({ where: { accountId: row.accountId, id: { in: grants.map((g) => g.orgId) } }, select: { name: true } }),
      platformPrisma.user.findFirst({ where: { email: row.email }, select: { id: true } }),
    ]);
    return {
      email: row.email,
      accountName: account?.name || '',
      companies: orgs.map((o) => o.name),
      accountRole: row.accountRole,
      invitedBy: inviter?.fullName || null,
      expiresAt: row.expiresAt,
      /* Whether to show "sign in to accept" or "choose a password". */
      hasLogin: Boolean(existing),
    };
  });
}

/**
 * Accept. Either the caller is signed in with the invited email, or there is
 * no login for it yet and one is made with the password they chose. The
 * status change is the guard: only the request that moves PENDING to
 * ACCEPTED goes on to create memberships.
 */
export async function acceptInvitation(input: { token?: unknown; signedInUserId?: string | null; fullName?: unknown; password?: unknown }) {
  return outsideTenant('account invitation: accept', async () => {
    const row = await liveByToken(String(input.token || ''));
    const grants = parseGrants(row.grants);
    let user = await platformPrisma.user.findFirst({ where: { email: row.email }, select: { id: true, accountId: true, isActive: true } });

    if (user) {
      if (!input.signedInUserId) {
        /* The login may have been made a moment ago by this same invitation (a double click): say so, not "sign in". */
        const now = await platformPrisma.accountInvitation.findUnique({ where: { id: row.id }, select: { status: true } });
        if (now?.status === 'ACCEPTED') throw new InvitationError(409, 'This invitation has already been used.', 'ALREADY_ACCEPTED');
        throw new InvitationError(401, 'You already have a Clor login. Sign in with it to accept.', 'SIGN_IN_REQUIRED');
      }
      if (input.signedInUserId !== user.id) throw new InvitationError(403, `This invitation is for ${row.email}. Sign in with that address to accept it.`, 'WRONG_PERSON');
      if (user.accountId !== row.accountId) throw new InvitationError(409, 'Your login belongs to another account; ask to be let in under Outside access.', 'OTHER_ACCOUNT');
      if (!user.isActive) throw new InvitationError(403, 'Your login is switched off in this account.', 'INACTIVE');
    } else {
      /* Signed in as somebody else, for an address that has no login: not theirs to accept. */
      if (input.signedInUserId) throw new InvitationError(403, `This invitation is for ${row.email}. Sign out, then open the link again to accept it.`, 'WRONG_PERSON');
      const password = String(input.password || '');
      const fullName = String(input.fullName || '').trim();
      if (fullName.length < 2) throw new InvitationError(400, 'Tell us your name.', 'BAD_NAME');
      /*
       * The same rule as signing up, and as an administrator adding someone:
       * the product's own (length, not a common password) and the strictest
       * password rules of the companies the invitation opens. Only length was
       * checked, so "password1" was taken here and refused everywhere else.
       */
      const weak = validatePassword(password, await policyForOrgs(grants.map((g) => g.orgId)));
      if (weak) throw new InvitationError(400, weak, 'WEAK_PASSWORD');
    }
    /* #4: a company may have narrowed its allowed domains since the invitation went out. */
    const domainRefused = await domainRefusalFor(grants.map((g) => g.orgId), row.email);
    if (domainRefused) throw new InvitationError(403, domainRefused, 'EMAIL_DOMAIN_NOT_ALLOWED');

    /* W-6.1: a new login is counted against the plan under the account's quota lock. */
    const releaseQuota = user ? null : await lockQuota(row.accountId, 'USERS');
    try {
    if (!user) {
      const full = await userLimitReason(row.accountId);
      if (full) throw new InvitationError(403, full, 'USER_LIMIT');
    }

    /* The guard: exactly one request moves it to ACCEPTED. */
    const claimed = await platformPrisma.accountInvitation.updateMany({ where: { id: row.id, status: 'PENDING', expiresAt: { gt: new Date() } }, data: { status: 'ACCEPTED', acceptedAt: new Date() } });
    if (!claimed.count) throw new InvitationError(409, 'This invitation has already been used.', 'ALREADY_ACCEPTED');

    if (!user) {
      user = await platformPrisma.user.create({
        data: {
          accountId: row.accountId,
          email: row.email,
          fullName: String(input.fullName).trim(),
          passwordHash: await bcrypt.hash(String(input.password), Number(process.env.BCRYPT_ROUNDS || 12)),
          /* They opened the link sent to this address. */
          emailVerifiedAt: new Date(),
          isActive: true,
        },
        select: { id: true, accountId: true, isActive: true },
      });
    }
    } finally {
      if (releaseQuota) await releaseQuota();
    }
    const userId = user!.id;

    await platformPrisma.accountMembership.upsert({
      where: { accountId_userId: { accountId: row.accountId, userId } },
      update: { status: 'ACTIVE', ...(row.accountRole !== 'MEMBER' ? { role: row.accountRole } : {}) },
      create: { accountId: row.accountId, userId, role: row.accountRole, addedByUserId: row.invitedByUserId },
    });
    for (const g of grants) {
      await runInTenant(g.orgId, async () => {
        await platformPrisma.userOrgMembership.upsert({ where: { accountId_orgId_userId: { accountId: row.accountId, orgId: g.orgId, userId } }, update: {}, create: { accountId: row.accountId, orgId: g.orgId, userId } });
        for (const branchId of g.branchIds) {
          await platformPrisma.userBranchMembership.upsert({
            where: { accountId_orgId_branchId_userId: { accountId: row.accountId, orgId: g.orgId, branchId, userId } },
            update: {},
            create: { accountId: row.accountId, orgId: g.orgId, branchId, userId },
          });
        }
        for (const roleId of g.roleIds) {
          await platformPrisma.userRoleAssignment
            .create({ data: { accountId: row.accountId, orgId: g.orgId, branchId: null, userId, roleId, createdByUserId: row.invitedByUserId }, select: { id: true } })
            .catch((e: any) => {
              if (String(e?.code || '') !== 'P2002') throw e;
            });
        }
      });
    }
    await platformPrisma.accountInvitation.update({ where: { id: row.id }, data: { acceptedByUserId: userId } });
    await recordAccountEvent({ accountId: row.accountId, actorUserId: userId, action: 'INVITATION_ACCEPTED', targetType: 'AccountInvitation', targetId: row.id, message: `${row.email} joined as ${row.accountRole}`, metadata: { companies: grants.map((g) => g.orgId) } });
    return { accepted: true, email: row.email, created: !input.signedInUserId };
  });
}
