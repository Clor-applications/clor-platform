import { flagCreatorRemoved } from '../services/credentialReview.js';
import { actorFrom } from '../services/credentials.js';
import { Router, type Request as ExpressRequest } from 'express';
import { assignUserCode } from '../services/displayCodes.js';
import { z } from 'zod';
import bcrypt from 'bcrypt';
import { prisma } from '../utils/prisma.js';
import { platformPrisma } from '../utils/platformPrisma.js';
import { userLimitReason } from '../services/entitlements.js';
import { getAuthPolicy, policyForUser, validatePassword } from '../services/policy.js';
import { domainRefusalForPerson } from '../services/signInRules.js';
import { requireAuth } from '../middleware/auth.js';
import { requireTenantContext } from '../middleware/tenantContext.js';
import { requirePermission } from '../middleware/rbac.js';
import { PermissionAction } from '../constants/enums.js';
import { sendTemplate } from '../services/mailer.js';
import { recordAuthEvent, revokeAllSessions } from '../services/auth.js';
import { LEAVE_REASONS, LEAVE_REASON_LABEL, LeaverError, markLeft, pendingFor, reactivate } from '../services/leavers.js';
import { RoleType } from '../constants/enums.js';
import { hasValidStepUp } from '../services/stepUp.js';
import { resolveAccess, resolveUserPermissions } from '../services/access.js';
import { permKey } from '../constants/permissionCatalog.js';
import { NO_FIT, SuggestionError, roleSuggestionEnabled, suggestRole } from '../services/roleSuggestion.js';
import {
  ADMIN_ONLY_ERROR,
  OWN_ACCESS_ERROR,
  grantAuthority,
  LAST_ADMIN_ERROR,
  cannotGrantError,
  rolePermissionKeys,
  unheldGrants,
  userIsAdmin,
  identityBlockedIn,
  wouldRemoveLastAdmin,
  LastAdminError,
  assertAnAdminRemains,
} from '../services/roleGuards.js';
import { outsideTenant, runInTenant } from '../utils/tenantScope.js';
import { OutsideAccessError, checkOutsideTerms, grantOutsideAccess, refusalOf } from '../services/outsideAccess.js';
import { ensureAccountMembership } from '../services/accountMembership.js';
import { QuotaBusyError, lockQuota } from '../services/quotaLock.js';
import { otherCompany } from '../utils/companyWords.js';

export const usersRouter = Router();
usersRouter.use(requireAuth, requireTenantContext);

const updateUserSchema = z
  .object({
    email: z.string().email().optional(),
    fullName: z.string().min(1).max(120).optional(),
    mobile: z.string().max(30).optional().nullable(),
    isActive: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'No fields to update' });

const setPrimaryRoleSchema = z.object({
  roleId: z.string().min(1).optional().nullable(),
});

const changePasswordSchema = z.object({
  password: z.string().min(8).max(200),
});

const isMember = async (accountId: string, orgId: string, userId: string) =>
  Boolean(await platformPrisma.userOrgMembership.findFirst({ where: { accountId, orgId, userId }, select: { id: true } }));

/**
 * Why a role assignment must be refused, or null when it may go ahead.
 *
 * Assigning a role hands out every permission it holds, so it is bounded the
 * same way editing a role is: the caller must hold what the role grants, only
 * an administrator may hand out (or take away) an Administrator role, and the
 * organisation's last administrator cannot be demoted. `role` null means the
 * user's org-wide roles are being cleared.
 */
async function assignmentRefusal(
  req: ExpressRequest,
  accountId: string,
  orgId: string,
  userId: string,
  role: { id: string; roleType: string } | null,
  scopeBranchId: string | null
): Promise<{ status: number; body: Record<string, unknown> } | null> {
  // Bounded by what the caller holds where this assignment applies (A-19).
  const { authority, refusal } = await grantAuthority(req, scopeBranchId, permKey('SETTINGS', 'Users', 'EDIT'));
  if (refusal) return refusal;

  if (role?.roleType === RoleType.ADMIN && !authority.isAdmin) return { status: 403, body: ADMIN_ONLY_ERROR };

  if (role) {
    const missing = unheldGrants(authority, await rolePermissionKeys(role.id));
    if (missing.length) return { status: 403, body: cannotGrantError(missing) };
  }

  if (userId === req.auth!.userId && !authority.isAdmin) return { status: 403, body: OWN_ACCESS_ERROR };

  // Org-wide assignments replace the user's org-wide role; a branch-scoped one
  // adds to it and cannot demote anybody.
  if (scopeBranchId) return null;

  // Whether the organisation still has an administrator afterwards is checked
  // inside the assignment's own transaction: the person may stay one through
  // a role profile, which a prediction made here would have to reimplement.
  const targetIsAdmin = await userIsAdmin(accountId, orgId, userId);
  if (targetIsAdmin && !authority.isAdmin) return { status: 403, body: ADMIN_ONLY_ERROR };
  return null;
}

usersRouter.get('/orgs/:orgId/users', requirePermission('SETTINGS', PermissionAction.VIEW, 'Users'), async (req, res) => {
  const accountId = req.tenant!.accountId;
  const orgId = String(req.params.orgId);
  if (orgId !== req.tenant!.orgId) return otherCompany(res);

  const memberships = await platformPrisma.userOrgMembership.findMany({
    where: { accountId, orgId },
    include: {
      user: { select: { id: true, code: true, email: true, fullName: true, phone: true, isActive: true, leftAt: true, leftReason: true, lastWorkingDay: true, leftNote: true, releasedEmail: true } },
    },
    orderBy: [{ createdAt: 'asc' }],
  });

  const userIds = memberships.map((m) => m.userId);
  const assignments = userIds.length
    ? await platformPrisma.userRoleAssignment.findMany({
        where: { accountId, orgId, userId: { in: userIds }, OR: [{ branchId: null }, { branchId: req.tenant!.branchId }] },
        select: { userId: true, roleId: true, branchId: true, createdAt: true },
        orderBy: [{ createdAt: 'desc' }],
      })
    : [];

  // One role per person on this screen: the one they hold in the branch being
  // worked in, else their company-wide one.
  const roleIdByUserId = new Map<string, string>();
  for (const a of [...assignments].sort((x, y) => Number(Boolean(y.branchId)) - Number(Boolean(x.branchId)))) {
    if (!roleIdByUserId.has(a.userId)) roleIdByUserId.set(a.userId, a.roleId);
  }

  const users = memberships.map((m) => ({
    id: m.user.id,
    code: m.user.code || null,
    email: m.user.email,
    fullName: m.user.fullName,
    mobile: m.user.phone,
    // legacy compatibility for older UI code
    name: m.user.fullName,
    isActive: m.user.isActive,
    /* Left the business (services/leavers.ts): kept, with why and when. */
    left: m.user.leftAt ? { at: m.user.leftAt, reason: m.user.leftReason, lastWorkingDay: m.user.lastWorkingDay, note: m.user.leftNote, releasedEmail: m.user.releasedEmail } : null,
    roleId: roleIdByUserId.get(m.user.id) || null,
  }));

  res.json({ users });
});

/**
 * May this caller change this person's sign-in identity — email or password?
 *
 * Both are global: one User signs in to every company they belong to. Checking
 * only that the person is a member of the caller's company let the admin of
 * any company that had invited somebody reset that person's password, or move
 * their email to an address the admin controls and then use "forgot password"
 * — taking over the person's own companies too.
 *
 * So: only for people whose home is this account (created here, not invited
 * in from elsewhere), and an Administrator's identity only by an
 * Administrator. Everyone else changes their own, from their profile.
 * Returns the refusal to send, or null.
 */
async function identityChangeRefusal(req: any, accountId: string, orgId: string, userId: string) {
  if (userId === req.auth!.userId) return null;
  const target = await platformPrisma.user.findUnique({ where: { id: userId }, select: { accountId: true } });
  if (!target || target.accountId !== accountId) {
    return {
      status: 403,
      body: {
        error: 'This person signs in with their own account. Only they can change its email or password.',
        code: 'foreign_identity',
      },
    };
  }
  if (!req.isAdmin && (await userIsAdmin(accountId, orgId, userId))) return { status: 403, body: ADMIN_ONLY_ERROR };
  return elsewhereRefusal(req.auth!.userId, userId);
}

/** A-01: refused when the person works in a company the caller could not manage them in. */
async function elsewhereRefusal(callerId: string, userId: string) {
  const blocked = await identityBlockedIn(callerId, userId);
  if (!blocked) return null;
  return {
    status: 403,
    body: {
      error:
        blocked.reason === 'admin_target'
          ? 'This person administers another company. Only an administrator of every company they work in can change their sign-in.'
          : 'This person also works in a company you cannot manage users in, so their sign-in is not yours to change.',
      code: 'identity_elsewhere',
    },
  };
}

/*
 * Somebody has left (services/leavers.ts). Same guards as switching a person
 * off below — an administrator only by an administrator, never the last one,
 * never someone whose sign-in belongs to companies the caller cannot manage —
 * plus a reason, a last working day and a hand-over.
 */
const leaveSchema = z.object({
  reason: z.enum(LEAVE_REASONS),
  lastWorkingDay: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  note: z.string().max(1000).optional().nullable(),
  handoverUserId: z.string().optional().nullable(),
  releaseEmail: z.boolean().optional(),
});

const leaverRefusal = (res: any, e: unknown) => {
  if (e instanceof LeaverError) return res.status(e.status).json({ error: e.message, code: e.code });
  throw e;
};

usersRouter.get('/orgs/:orgId/users/:userId/leaving', requirePermission('SETTINGS', PermissionAction.EDIT, 'Users'), async (req, res) => {
  const { accountId } = req.tenant!;
  const userId = String(req.params.userId);
  const member = await platformPrisma.userOrgMembership.findFirst({ where: { accountId, orgId: String(req.params.orgId), userId }, select: { id: true } });
  if (!member) return res.status(404).json({ error: 'This person is not in this company.' });
  res.json({ pending: await pendingFor(accountId, userId), reasons: LEAVE_REASONS.map((key) => ({ key, label: LEAVE_REASON_LABEL[key] })) });
});

usersRouter.post('/orgs/:orgId/users/:userId/leave', requirePermission('SETTINGS', PermissionAction.EDIT, 'Users'), async (req, res) => {
  const { accountId } = req.tenant!;
  const orgId = String(req.params.orgId);
  const userId = String(req.params.userId);
  const body = leaveSchema.parse(req.body);
  const member = await platformPrisma.userOrgMembership.findFirst({ where: { accountId, orgId, userId }, select: { id: true } });
  if (!member) return res.status(404).json({ error: 'This person is not in this company.' });
  if (!req.isAdmin && (await userIsAdmin(accountId, orgId, userId))) return res.status(403).json(ADMIN_ONLY_ERROR);
  if (await wouldRemoveLastAdmin(accountId, orgId, userId)) return res.status(409).json(LAST_ADMIN_ERROR);
  if (userId !== req.auth!.userId) {
    const refusal = await elsewhereRefusal(req.auth!.userId, userId);
    if (refusal) return res.status(refusal.status).json(refusal.body);
  }
  let out;
  try {
    out = await markLeft({ accountId, orgId, actorUserId: req.auth!.userId, userId, ...body });
  } catch (e) {
    return leaverRefusal(res, e);
  }
  /* What they made keeps working; it is flagged for someone to check, in every company. */
  await flagCreatorRemoved({ accountId, userId, orgIds: 'ALL' }, 'The person who made it has left', actorFrom(req));
  if (req.res) req.res.locals.audited = true;
  await platformPrisma.auditLog.create({
    data: {
      accountId,
      orgId,
      branchId: req.tenant!.branchId,
      entity: 'User',
      entityId: userId,
      action: 'LEFT',
      message: `Marked as left: ${LEAVE_REASON_LABEL[body.reason]}, last working day ${body.lastWorkingDay}${body.handoverUserId ? `; handed over ${out.handover.approvals} approvals, ${out.handover.deskRequests} desk requests, ${out.handover.exceptions} exceptions` : ''}${out.releasedEmail ? '; address released' : ''}`,
      createdByUserId: req.auth!.userId,
    },
  });
  await recordAuthEvent({ accountId, userId, eventType: 'USER_MARKED_LEFT', detail: `${body.reason} by ${req.auth!.userId}` });
  res.json({ ok: true, ...out });
});

usersRouter.post('/orgs/:orgId/users/:userId/reactivate', requirePermission('SETTINGS', PermissionAction.EDIT, 'Users'), async (req, res) => {
  const { accountId } = req.tenant!;
  const orgId = String(req.params.orgId);
  const userId = String(req.params.userId);
  const member = await platformPrisma.userOrgMembership.findFirst({ where: { accountId, orgId, userId }, select: { id: true } });
  if (!member) return res.status(404).json({ error: 'This person is not in this company.' });
  if (!req.isAdmin && (await userIsAdmin(accountId, orgId, userId))) return res.status(403).json(ADMIN_ONLY_ERROR);
  if (userId !== req.auth!.userId) {
    const refusal = await elsewhereRefusal(req.auth!.userId, userId);
    if (refusal) return res.status(refusal.status).json(refusal.body);
  }
  let out;
  try {
    out = await reactivate({ accountId, actorUserId: req.auth!.userId, userId });
  } catch (e) {
    return leaverRefusal(res, e);
  }
  if (req.res) req.res.locals.audited = true;
  await platformPrisma.auditLog.create({
    data: { accountId, orgId, branchId: req.tenant!.branchId, entity: 'User', entityId: userId, action: 'REACTIVATED', message: `Reactivated${out.emailRestored === false ? '; their old address is now someone else\'s' : ''}`, createdByUserId: req.auth!.userId },
  });
  await recordAuthEvent({ accountId, userId, eventType: 'USER_REACTIVATED', detail: `by ${req.auth!.userId}` });
  res.json({ ok: true, ...out });
});

usersRouter.patch('/orgs/:orgId/users/:userId', requirePermission('SETTINGS', PermissionAction.EDIT, 'Users'), async (req, res) => {
  const accountId = req.tenant!.accountId;
  const orgId = String(req.params.orgId);
  const userId = String(req.params.userId);
  const createdByUserId = req.auth!.userId;

  if (orgId !== req.tenant!.orgId) return otherCompany(res);

  const body = updateUserSchema.parse(req.body);

  // Ensure target user is a member of this org.
  const member = await platformPrisma.userOrgMembership.findFirst({ where: { accountId, orgId, userId }, select: { id: true } });
  if (!member) return res.status(404).json({ error: 'This person is not in this company.' });

  if (body.isActive === false) {
    if (!req.isAdmin && (await userIsAdmin(accountId, orgId, userId))) return res.status(403).json(ADMIN_ONLY_ERROR);
    if (await wouldRemoveLastAdmin(accountId, orgId, userId)) return res.status(409).json(LAST_ADMIN_ERROR);
  }

  if ('email' in body && body.email) {
    const refusal = await identityChangeRefusal(req, accountId, orgId, userId);
    if (refusal) return res.status(refusal.status).json(refusal.body);
    const domainRefused = await domainRefusalForPerson(userId, accountId, [orgId], body.email);
    if (domainRefused) return res.status(400).json({ error: domainRefused, code: 'EMAIL_DOMAIN_NOT_ALLOWED' });
  }

  /*
   * A name and being able to sign in at all are global too: an invited person's
   * own companies use the same User. Another account's admin may take away
   * access to this company (company access), not rename or switch off the
   * person everywhere.
   */
  if (('fullName' in body || 'isActive' in body || 'mobile' in body) && userId !== req.auth!.userId) {
    const target = await platformPrisma.user.findUnique({ where: { id: userId }, select: { accountId: true } });
    if (!target || target.accountId !== accountId) {
      return res.status(403).json({
        error: 'This person signs in with their own account. To stop them using this company, remove their access to it; their name and sign-in are theirs.',
        code: 'foreign_identity',
      });
    }
    /* Switching somebody off is global too: it ends their sign-in in every company they work in. */
    if ('isActive' in body) {
      const refusal = await elsewhereRefusal(req.auth!.userId, userId);
      if (refusal) return res.status(refusal.status).json(refusal.body);
    }
  }

  // Same global-uniqueness rule as user creation: login resolves by email
  // across every account, so an email may not be moved onto a taken address.
  if ('email' in body && body.email) {
    const nextEmail = body.email.toLowerCase();
    const clash = await platformPrisma.user.findFirst({
      where: { email: nextEmail, NOT: { id: userId } },
      select: { id: true },
    });
    if (clash) return res.status(409).json({ error: 'That email address is already in use. Add the person from Users instead, or use another address.' });
  }

  const updated = await platformPrisma.user.update({
    where: { id: userId },
    data: {
      // A changed address has not been proven by anyone yet.
      ...('email' in body ? { email: body.email!.toLowerCase(), emailVerifiedAt: null } : {}),
      ...('fullName' in body ? { fullName: body.fullName! } : {}),
      ...('mobile' in body ? { phone: body.mobile?.trim() || null } : {}),
      ...('isActive' in body ? { isActive: Boolean(body.isActive) } : {}),
    },
    select: { id: true, email: true, fullName: true, isActive: true },
  });
  /* Batch 5: what they made keeps working; it is flagged for someone to check, in every company. */
  if (body.isActive === false) await flagCreatorRemoved({ accountId, userId, orgIds: 'ALL' }, 'The person who made it was switched off', actorFrom(req));

  /* Written by name here; the general recorder (auditMutations) leaves it. */

  if (req.res) req.res.locals.audited = true;

  await platformPrisma.auditLog.create({
    data: {
      accountId,
      orgId: req.tenant!.orgId,
      branchId: req.tenant!.branchId,
      entity: 'User',
      entityId: updated.id,
      action: 'EDIT',
      message: `User updated: ${updated.email}`,
      createdByUserId,
    },
  });

  res.json({ user: updated });
});

// Replace the user's org-wide (branchId null) role assignment.
/* ------------------------------------------------- a person's companies */

/**
 * Which companies one person can work in, seen and set in one place.
 *
 * Access was granted a company at a time: switch to that company, invite the
 * same email again, pick a role. It worked, and it made the answer to "what can
 * this person see?" a thing you could only find by visiting every company and
 * looking. For a CA firm assigning ten clients to an intern that is ten trips
 * and no way to check the result.
 *
 * Scoped to the caller's own account throughout. A membership is a key to a
 * company's books, and the one thing this must never do is hand out a key to a
 * company the caller does not own.
 */
usersRouter.get('/users/:userId/companies', requirePermission('SETTINGS', PermissionAction.VIEW, 'Users'), (req, res) =>
  outsideTenant('company access: every company on the account a person may be given', async () => {
  const accountId = req.tenant!.accountId;
  const userId = String(req.params.userId);

  const target = await platformPrisma.user.findFirst({ where: { id: userId, accountId }, select: { id: true } });
  if (!target) return res.status(404).json({ error: 'No such person.' });

  const [orgs, memberships, assignments] = await Promise.all([
    platformPrisma.org.findMany({ where: { accountId }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
    platformPrisma.userOrgMembership.findMany({ where: { accountId, userId }, select: { orgId: true } }),
    platformPrisma.userRoleAssignment.findMany({
      where: { accountId, userId, branchId: null },
      select: { orgId: true, roleId: true, role: { select: { id: true, name: true } } },
    }),
  ]);

  const member = new Set(memberships.map((m) => m.orgId));
  const roleByOrg = new Map(assignments.map((a) => [a.orgId, a.role]));

  res.json({
    companies: orgs.map((o) => ({
      orgId: o.id,
      name: o.name,
      hasAccess: member.has(o.id),
      role: roleByOrg.get(o.id) || null,
    })),
  });
  }));

const companyAccessSchema = z.object({
  /** The complete set. A company left out is access taken away. */
  orgIds: z.array(z.string().min(1)).max(500),
});

usersRouter.put('/users/:userId/companies', requirePermission('SETTINGS', PermissionAction.EDIT, 'Users'), (req, res) =>
  outsideTenant('company access: memberships across the companies of the account', async () => {
  const accountId = req.tenant!.accountId;
  const userId = String(req.params.userId);
  const body = companyAccessSchema.parse(req.body);

  const target = await platformPrisma.user.findFirst({ where: { id: userId, accountId }, select: { id: true, email: true } });
  if (!target) return res.status(404).json({ error: 'No such person.' });

  // Only companies in this account, and only ones that exist. Anything else in
  // the request is dropped rather than trusted.
  const owned = await platformPrisma.org.findMany({ where: { accountId, id: { in: body.orgIds } }, select: { id: true } });
  const wanted = new Set(owned.map((o) => o.id));

  const current = await platformPrisma.userOrgMembership.findMany({ where: { accountId, userId }, select: { orgId: true } });
  const have = new Set(current.map((m) => m.orgId));

  const toAdd = [...wanted].filter((id) => !have.has(id));
  const toRemove = [...have].filter((id) => !wanted.has(id));

  /*
   * A-05: Users EDIT in the company at hand used to be enough to add or take
   * away access to every company of the account — so a person who manages
   * users in one company could strip another company's administrators, or
   * give themselves a way in. Each company touched now needs the caller's own
   * right to manage users there, and an administrator there when the person
   * being changed administers it.
   */
  const callerId = req.auth!.userId;
  for (const orgId of [...toAdd, ...toRemove]) {
    const caller = await resolveAccess(accountId, orgId, callerId);
    if (!caller.isAdmin && !caller.permissions.has(permKey('SETTINGS', 'Users', 'EDIT'))) {
      return res.status(403).json({ error: 'You cannot manage users in one of these companies.', code: 'not_your_company', orgId });
    }
    if (!caller.isAdmin && toRemove.includes(orgId) && (await userIsAdmin(accountId, orgId, userId))) {
      return res.status(403).json({ ...ADMIN_ONLY_ERROR, orgId });
    }
  }

  /* Review N4: a company added must allow the person's domain, as when they are first added (owners exempt). */
  if (toAdd.length) {
    const domainRefused = await domainRefusalForPerson(userId, accountId, toAdd, target.email);
    if (domainRefused) return res.status(400).json({ error: domainRefused, code: 'EMAIL_DOMAIN_NOT_ALLOWED' });
  }

  // Taking a company away from its only administrator locks that company.
  for (const orgId of toRemove) {
    if (await wouldRemoveLastAdmin(accountId, orgId, userId)) {
      return res.status(409).json({ ...LAST_ADMIN_ERROR, orgId });
    }
  }

  /*
   * Removing access removes the role with it.
   *
   * A role assignment left behind on a company the person can no longer open is
   * a permission waiting to come back the moment anybody re-adds them, silently
   * and at whatever level they had before.
   */
  await platformPrisma.$transaction([
    ...(toRemove.length
      ? [
          platformPrisma.userRoleAssignment.deleteMany({ where: { accountId, userId, orgId: { in: toRemove } } }),
          platformPrisma.userRoleProfile.deleteMany({ where: { accountId, userId, orgId: { in: toRemove } } }),
          /* Branch and warehouse grants go too, or re-adding the company silently restores them (as DELETE /orgs/:orgId/users/:userId does). */
          platformPrisma.userWarehouseRoleAssignment.deleteMany({ where: { accountId, userId, orgId: { in: toRemove } } }),
          platformPrisma.userWarehouseAccess.deleteMany({ where: { accountId, userId, orgId: { in: toRemove } } }),
          platformPrisma.userBranchMembership.deleteMany({ where: { accountId, userId, orgId: { in: toRemove } } }),
          platformPrisma.userOrgMembership.deleteMany({ where: { accountId, userId, orgId: { in: toRemove } } }),
        ]
      : []),
    ...toAdd.map((orgId) =>
      platformPrisma.userOrgMembership.create({ data: { accountId, orgId, userId } })
    ),
  ]);

  /* Batch 5: in the companies they lost, what they made is flagged for review. */
  if (toRemove.length) await flagCreatorRemoved({ accountId, userId, orgIds: toRemove }, 'The person who made it no longer works in this company', actorFrom(req));
  res.json({ ok: true, added: toAdd.length, removed: toRemove.length });
  }));

usersRouter.put('/orgs/:orgId/users/:userId/role', requirePermission('SETTINGS', PermissionAction.EDIT, 'Users'), async (req, res) => {
  const accountId = req.tenant!.accountId;
  const orgId = String(req.params.orgId);
  const userId = String(req.params.userId);
  const createdByUserId = req.auth!.userId;

  if (orgId !== req.tenant!.orgId) return otherCompany(res);

  const body = setPrimaryRoleSchema.parse(req.body);

  if (!(await isMember(accountId, orgId, userId))) return res.status(404).json({ error: 'This person is not in this company.' });

  const role = body.roleId ? await platformPrisma.role.findFirst({ where: { id: body.roleId, accountId, orgId } }) : null;
  if (body.roleId && !role) return res.status(404).json({ error: 'No such role.' });
  if (role?.branchId) return res.status(400).json({ error: 'That role belongs to a branch, so it cannot be given company-wide. Give it in that branch instead.' });

  const refused = await assignmentRefusal(req, accountId, orgId, userId, role, null);
  if (refused) return res.status(refused.status).json(refused.body);

  try {
    await platformPrisma.$transaction(async (tx) => {
      // Clear org-wide roles
      await tx.userRoleAssignment.deleteMany({ where: { accountId, orgId, userId, branchId: null } });
      if (role) {
        await tx.userRoleAssignment.create({
          data: { accountId, orgId, branchId: null, userId, roleId: role.id, createdByUserId },
        });
      }
      await assertAnAdminRemains(tx, accountId, orgId);
    });
  } catch (err) {
    if (err instanceof LastAdminError) return res.status(409).json(LAST_ADMIN_ERROR);
    throw err;
  }

  res.json({ ok: true });
});

/** Whether the role suggestion is switched on here, so the screen can offer it. */
usersRouter.get('/orgs/:orgId/users/role-suggestion', requirePermission('SETTINGS', PermissionAction.VIEW, 'Users'), async (req, res) => {
  if (String(req.params.orgId) !== req.tenant!.orgId) return otherCompany(res);
  res.json({ enabled: roleSuggestionEnabled() });
});

const suggestionSchema = z.object({
  jobTitle: z.string().trim().min(2).max(80),
  duties: z.string().trim().max(500).optional().default(''),
});

/**
 * Suggests one of the roles the caller may hand out, from a job title and a
 * line about the work. See services/roleSuggestion.ts for what is sent where.
 *
 * Candidates are only the roles this caller could assign — never an
 * Administrator role for a non-administrator, never a role holding something
 * the caller does not — so a suggestion can always be accepted.
 */
usersRouter.post('/orgs/:orgId/users/role-suggestion', requirePermission('SETTINGS', PermissionAction.EDIT, 'Users'), async (req, res) => {
  const accountId = req.tenant!.accountId;
  const orgId = String(req.params.orgId);
  if (orgId !== req.tenant!.orgId) return otherCompany(res);
  const body = suggestionSchema.parse(req.body);

  const roles = await platformPrisma.role.findMany({
    where: { accountId, orgId, branchId: null },
    select: { id: true, name: true, description: true, roleType: true },
  });
  const grants = await platformPrisma.rolePermission.findMany({
    where: { roleId: { in: roles.map((r) => r.id) }, allowed: true },
    select: { roleId: true, permission: { select: { module: true, subModule: true, action: true } } },
  });
  const keysByRole = new Map<string, string[]>();
  for (const g of grants) {
    const list = keysByRole.get(g.roleId) || [];
    list.push(permKey(g.permission.module, g.permission.subModule, g.permission.action));
    keysByRole.set(g.roleId, list);
  }
  // Suggested roles are company-wide, so only what the caller could assign company-wide (A-19).
  const { authority } = await grantAuthority(req, null, permKey('SETTINGS', 'Users', 'EDIT'));
  const assignable = authority
    ? roles.filter((r) => (r.roleType !== RoleType.ADMIN || authority.isAdmin) && unheldGrants(authority, keysByRole.get(r.id) || []).length === 0)
    : [];

  try {
    const s = await suggestRole(body, assignable);
    const nameOf = new Map(assignable.map((r) => [r.id, r.name]));
    res.json({
      roleId: s.choice === NO_FIT ? null : s.choice,
      noFit: s.choice === NO_FIT,
      confidence: s.confidence,
      alternatives: s.ranked.slice(0, 3).map((r) => ({ roleId: r.id, name: nameOf.get(r.id), probability: r.probability })),
    });
  } catch (err) {
    if (err instanceof SuggestionError) return res.status(err.status).json({ error: err.message, code: 'suggestion_unavailable' });
    throw err;
  }
});

/**
 * What one person can do in this company: every role they hold (org-wide,
 * per branch, or through a profile) and the permissions those add up to.
 *
 * The Users table shows one role per person, the org-wide one, which was the
 * only answer the product gave to "what can this person do?". A branch role
 * or a role profile could grant far more and was visible nowhere.
 */
usersRouter.get('/orgs/:orgId/users/:userId/access', requirePermission('SETTINGS', PermissionAction.VIEW, 'Users'), async (req, res) => {
  const accountId = req.tenant!.accountId;
  const orgId = String(req.params.orgId);
  const userId = String(req.params.userId);
  if (orgId !== req.tenant!.orgId) return otherCompany(res);
  if (!(await isMember(accountId, orgId, userId))) return res.status(404).json({ error: 'This person is not in this company.' });

  // No branch: every assignment counts, wherever it applies.
  const access = await resolveAccess(accountId, orgId, userId);

  const [direct, profiles, branches, memberships, warehouses, warehouseRoles] = await Promise.all([
    platformPrisma.userRoleAssignment.findMany({
      where: { accountId, orgId, userId },
      select: { branchId: true, role: { select: { id: true, name: true, roleType: true, ownDocumentsOnly: true } } },
    }),
    platformPrisma.userRoleProfile.findMany({
      where: { accountId, orgId, userId },
      select: { profile: { select: { id: true, name: true, roles: { select: { roleId: true } } } } },
    }),
    platformPrisma.branch.findMany({ where: { accountId, orgId }, select: { id: true, branchName: true } }),
    platformPrisma.userBranchMembership.findMany({ where: { accountId, orgId, userId }, select: { branchId: true }, orderBy: [{ createdAt: 'asc' }] }),
    platformPrisma.userWarehouseAccess.findMany({ where: { accountId, orgId, userId }, select: { warehouseId: true } }),
    platformPrisma.userWarehouseRoleAssignment.findMany({ where: { accountId, orgId, userId }, select: { warehouseId: true, roleId: true } }),
  ]);
  const branchName = new Map(branches.map((b) => [b.id, b.branchName]));

  const profileRoleIds = [...new Set(profiles.flatMap((p) => p.profile.roles.map((r) => r.roleId)))];
  const profileRoles = profileRoleIds.length
    ? await platformPrisma.role.findMany({ where: { id: { in: profileRoleIds } }, select: { id: true, name: true, roleType: true } })
    : [];

  const restrictions = await resolveUserPermissions(accountId, orgId, userId);

  res.json({
    isAdmin: access.isAdmin,
    ownDocumentsOnly: access.ownDocumentsOnly,
    roles: [
      ...direct.map((a) => ({
        ...a.role,
        /* Where the assignment applies and which role it is, as the access editor (PUT below) sends them back. */
        branchId: a.branchId,
        roleId: a.role.id,
        scope: a.branchId ? `Branch: ${branchName.get(a.branchId) || a.branchId}` : 'Whole company',
      })),
      ...profileRoles.map((r) => ({
        ...r,
        scope: `Profile: ${profiles.find((p) => p.profile.roles.some((x) => x.roleId === r.id))?.profile.name || ''}`,
      })),
    ],
    permissions: Array.from(access.permissions).sort(),
    restrictions: Object.fromEntries([...restrictions].map(([type, ids]) => [type, ids.size])),
    /* The branches and warehouses the person may work in, and the roles held at one warehouse only. */
    branchIds: memberships.map((row) => row.branchId),
    warehouseIds: warehouses.map((row) => row.warehouseId),
    warehouseRoles,
  });
});

const userScopeSchema = z.object({
  branches: z.array(z.object({ branchId: z.string().min(1), roleId: z.string().min(1) })).min(1),
  warehouseIds: z.array(z.string()).default([]),
  warehouseRoles: z.array(z.object({ warehouseId: z.string().min(1), roleId: z.string().min(1) })).default([]),
});

/**
 * Sets where one person works and as what, in one save: their branches with a
 * role in each, the warehouses they may use, and any role they hold at one
 * warehouse on top of their branch role.
 *
 * It replaces the person's branches, direct role assignments and warehouses in
 * this company, so it is bounded like every other way of giving access:
 *
 *  - each role is checked as a role assignment in its branch is (the caller
 *    manages users there, holds what the role grants, and only an
 *    administrator hands out an Administrator role);
 *  - taking away a branch, or a company-wide role, needs the caller to manage
 *    users where that was held;
 *  - a company administrator is not edited here: they reach every branch
 *    already, and this would replace their company-wide role with branch ones.
 *
 * Role profiles are left as they are.
 */
usersRouter.put('/orgs/:orgId/users/:userId/access', requirePermission('SETTINGS', PermissionAction.EDIT, 'Users'), async (req, res) => {
  const { accountId, orgId } = req.tenant!;
  const userId = String(req.params.userId);
  const callerId = req.auth!.userId;
  if (String(req.params.orgId) !== orgId) return otherCompany(res);

  const body = userScopeSchema.parse(req.body);
  const branchIds = body.branches.map((row) => row.branchId);
  if (new Set(branchIds).size !== branchIds.length) return res.status(400).json({ error: 'Choose one role for each branch.' });
  const warehouseIds = Array.from(new Set(body.warehouseIds));

  if (!(await isMember(accountId, orgId, userId))) return res.status(404).json({ error: 'This person is not in this company.' });
  if (await userIsAdmin(accountId, orgId, userId)) {
    return res.status(403).json({
      error: 'A company administrator already works in every branch. Change their company-wide role first to limit them to branches.',
      code: 'admin_access_not_scoped',
    });
  }

  const gate = permKey('SETTINGS', 'Users', 'EDIT');
  const roleIds = [...new Set([...body.branches.map((row) => row.roleId), ...body.warehouseRoles.map((row) => row.roleId)])];
  const [validBranches, validRoles, validWarehouses, heldAssignments, heldBranches] = await Promise.all([
    platformPrisma.branch.findMany({ where: { accountId, orgId, id: { in: branchIds } }, select: { id: true } }),
    platformPrisma.role.findMany({ where: { accountId, orgId, id: { in: roleIds } }, select: { id: true, branchId: true, roleType: true } }),
    warehouseIds.length ? prisma.warehouse.findMany({ where: { accountId, orgId, id: { in: warehouseIds } }, select: { id: true, branchId: true } }) : Promise.resolve([]),
    platformPrisma.userRoleAssignment.findMany({ where: { accountId, orgId, userId }, select: { branchId: true, roleId: true } }),
    platformPrisma.userBranchMembership.findMany({ where: { accountId, orgId, userId }, select: { branchId: true } }),
  ]);
  if (validBranches.length !== branchIds.length) return res.status(400).json({ error: 'One of the branches is not in this company.' });
  const roleById = new Map(validRoles.map((role) => [role.id, role]));
  if (body.branches.some((row) => !roleById.has(row.roleId) || (roleById.get(row.roleId)!.branchId && roleById.get(row.roleId)!.branchId !== row.branchId))) {
    return res.status(400).json({ error: 'One of the roles does not belong to the branch it was chosen for. Choose a role from that branch.' });
  }
  if (validWarehouses.length !== warehouseIds.length || validWarehouses.some((row) => !branchIds.includes(row.branchId))) {
    return res.status(400).json({ error: 'Each warehouse must be in one of the chosen branches.' });
  }
  const warehouseById = new Map(validWarehouses.map((warehouse) => [warehouse.id, warehouse]));
  const warehouseRoleProblem =
    new Set(body.warehouseRoles.map((row) => row.warehouseId)).size !== body.warehouseRoles.length ||
    body.warehouseRoles.some((row) => {
      const warehouse = warehouseById.get(row.warehouseId);
      const role = roleById.get(row.roleId);
      return !warehouse || !role || (role.branchId && role.branchId !== warehouse.branchId);
    });
  if (warehouseRoleProblem) return res.status(400).json({ error: 'A warehouse role needs a warehouse, and a role in that warehouse’s branch.' });

  // Taking away what the person holds today: a company-wide role by somebody
  // who manages users company-wide, a branch by somebody who manages it there.
  if (heldAssignments.some((a) => a.branchId === null)) {
    const { refusal } = await grantAuthority(req, null, gate);
    if (refusal) return res.status(refusal.status).json(refusal.body);
  }
  const leavingBranches = new Set([...heldBranches.map((row) => row.branchId), ...heldAssignments.map((a) => a.branchId).filter((id): id is string => Boolean(id))]);
  for (const branchId of leavingBranches) {
    if (branchIds.includes(branchId)) continue; // judged below, as an assignment in that branch
    const { refusal } = await grantAuthority(req, branchId, gate);
    if (refusal) return res.status(403).json({ error: 'You can remove access only in a branch you look after.', code: 'not_in_branch' });
  }

  // Each branch role, exactly as POST …/roles judges one.
  let grantsAdminRole = false;
  for (const assignment of body.branches) {
    const role = roleById.get(assignment.roleId)!;
    const refused = await assignmentRefusal(req, accountId, orgId, userId, role, assignment.branchId);
    if (refused) return res.status(refused.status).json(refused.body);
    if (role.roleType === RoleType.ADMIN) grantsAdminRole = true;
  }
  // A role at one warehouse is bounded by what the caller holds in that warehouse's branch.
  for (const assignment of body.warehouseRoles) {
    const role = roleById.get(assignment.roleId)!;
    const refused = await assignmentRefusal(req, accountId, orgId, userId, role, warehouseById.get(assignment.warehouseId)!.branchId);
    if (refused) return res.status(refused.status).json(refused.body);
    if (role.roleType === RoleType.ADMIN) grantsAdminRole = true;
  }
  /* W-5.2, as POST …/roles: handing out an Administrator role takes a fresh code where the granter has an authenticator. */
  if (grantsAdminRole && userId !== callerId) {
    const granter = await platformPrisma.user.findUnique({ where: { id: callerId }, select: { totpEnabledAt: true } });
    if (granter?.totpEnabledAt && !hasValidStepUp(req)) {
      return res.status(403).json({ error: 'Enter the code from your authenticator app to make someone an administrator.', code: 'STEP_UP_REQUIRED' });
    }
  }

  try {
    await platformPrisma.$transaction(async (tx) => {
      await tx.userWarehouseRoleAssignment.deleteMany({ where: { accountId, orgId, userId } });
      await tx.userWarehouseAccess.deleteMany({ where: { accountId, orgId, userId } });
      await tx.userRoleAssignment.deleteMany({ where: { accountId, orgId, userId } });
      await tx.userBranchMembership.deleteMany({ where: { accountId, orgId, userId } });
      for (const { branchId, roleId } of body.branches) {
        await tx.userBranchMembership.create({ data: { accountId, orgId, branchId, userId } });
        await tx.userRoleAssignment.create({ data: { accountId, orgId, branchId, userId, roleId, createdByUserId: callerId } });
      }
      for (const warehouse of validWarehouses) {
        await tx.userWarehouseAccess.create({ data: { accountId, orgId, branchId: warehouse.branchId, warehouseId: warehouse.id, userId } });
      }
      for (const { warehouseId, roleId } of body.warehouseRoles) {
        await tx.userWarehouseRoleAssignment.create({
          data: { accountId, orgId, branchId: warehouseById.get(warehouseId)!.branchId, warehouseId, userId, roleId, createdByUserId: callerId },
        });
      }
      await assertAnAdminRemains(tx, accountId, orgId);
    });
  } catch (err) {
    if (err instanceof LastAdminError) return res.status(409).json(LAST_ADMIN_ERROR);
    throw err;
  }

  /* Written by name here; the general recorder (auditMutations) leaves it. */
  if (req.res) req.res.locals.audited = true;
  await platformPrisma.auditLog.create({
    data: {
      accountId,
      orgId,
      branchId: req.tenant!.branchId,
      entity: 'User',
      entityId: userId,
      action: 'ACCESS',
      message: `Access set: ${body.branches.length} branch role(s), ${validWarehouses.length} warehouse(s), ${body.warehouseRoles.length} warehouse role(s)`,
      metadata: JSON.stringify({ branches: body.branches, warehouseIds, warehouseRoles: body.warehouseRoles }),
      createdByUserId: callerId,
    },
  });

  res.json({ ok: true });
});

usersRouter.post('/orgs/:orgId/users/:userId/password', requirePermission('SETTINGS', PermissionAction.EDIT, 'Users'), async (req, res) => {
  const accountId = req.tenant!.accountId;
  const orgId = String(req.params.orgId);
  const userId = String(req.params.userId);
  const createdByUserId = req.auth!.userId;

  if (orgId !== req.tenant!.orgId) return otherCompany(res);

  const body = changePasswordSchema.parse(req.body);

  // Ensure target user is a member of this org.
  const member = await platformPrisma.userOrgMembership.findFirst({ where: { accountId, orgId, userId }, select: { id: true } });
  if (!member) return res.status(404).json({ error: 'This person is not in this company.' });

  const refusal = await identityChangeRefusal(req, accountId, orgId, userId);
  if (refusal) return res.status(refusal.status).json(refusal.body);

  /* The strictest rules of every company this person is in, not just this one (SX-13). */
  const weak = validatePassword(body.password, await policyForUser(accountId, userId));
  if (weak) return res.status(400).json({ error: weak, code: 'WEAK_PASSWORD' });

  const rounds = Number(process.env.BCRYPT_ROUNDS || 12);
  const passwordHash = await bcrypt.hash(body.password, rounds);

  await platformPrisma.user.update({
    where: { id: userId },
    data: { passwordHash },
    select: { id: true },
  });
  // Whoever held the old password is signed out everywhere.
  await revokeAllSessions(userId, 'ADMIN_PASSWORD_RESET');

  /* Written by name here; the general recorder (auditMutations) leaves it. */

  if (req.res) req.res.locals.audited = true;

  await platformPrisma.auditLog.create({
    data: {
      accountId,
      orgId: req.tenant!.orgId,
      branchId: req.tenant!.branchId,
      entity: 'User',
      entityId: userId,
      action: 'PASSWORD',
      message: `Password changed for user: ${userId}`,
      createdByUserId,
    },
  });

  res.json({ ok: true });
});

const createUserSchema = z.object({
  email: z.string().email(),
  username: z.string().max(80).optional().nullable(),
  fullName: z.string().min(1).max(120),
  mobile: z.string().max(30).optional().nullable(),
  password: z.string().min(8).max(200),
  // allow initial memberships
  orgIds: z.array(z.string()).default([]),
  branchIdsByOrg: z.record(z.string(), z.array(z.string())).default({}),
  /** GAP-006: for a person from another account, what the company lets them use and until when. */
  outsideAccess: z.object({ apps: z.array(z.string()).nullable().optional(), expiresAt: z.string().nullable().optional() }).optional(),
});

usersRouter.post('/users', requirePermission('SETTINGS', PermissionAction.CREATE, 'Users'), async (req, res) => {
  const accountId = req.tenant!.accountId;
  const createdByUserId = req.auth!.userId;

  const body = createUserSchema.parse(req.body);
  const email = body.email.toLowerCase();

  /*
   * The plan's seat allowance. Checked before anything is written, and before
   * the invitation branch below, so an account at its limit is told so rather
   * than being allowed to add a person and discover it later.
   *
   * An account with no entitlement row is on the default plan, which is
   * unlimited, so this refuses nobody until a plan is deliberately assigned.
   */
  /* W-6.1: the seat check and the new login happen under the account's quota lock; released when the response ends, whatever path it takes. */
  let releaseQuota: () => Promise<void>;
  try {
    releaseQuota = await lockQuota(accountId, 'USERS');
  } catch (e) {
    if (e instanceof QuotaBusyError) return res.status(e.status).json({ error: e.message, code: e.code });
    throw e;
  }
  res.once('close', () => void releaseQuota().catch(() => {}));
  const seatsFull = await userLimitReason(accountId);
  if (seatsFull) return res.status(403).json({ error: seatsFull, code: 'USER_LIMIT' });

  /*
   * An email is one person, everywhere.
   *
   * A person already registered is INVITED into this company rather than
   * refused: the accountant a client brings in, or a colleague who already has
   * a login from another business, should not need a second identity with the
   * same address. Their existing login is given a membership here.
   *
   * This used to answer 409 for an email registered under another account, so
   * the only person who could ever be added to a company was somebody who had
   * never used the product before.
   *
   * The reply deliberately does NOT echo the existing user's details when they
   * come from elsewhere. Confirming that an address is registered is a small
   * leak, and returning the name attached to it is a larger one.
   */
  const existing = await platformPrisma.user.findFirst({
    where: { email },
    select: { id: true, email: true, fullName: true, accountId: true, isActive: true, emailVerifiedAt: true },
  });

  let invited: { id: string; email: string; fullName: string | null; accountId: string } | null = null;
  if (existing) {
    if (!existing.isActive) {
      return res.status(409).json({ error: 'That email address belongs to a deactivated user.' });
    }
    /*
     * A-02: signing up never proves the address. Somebody could register
     * cfo@yourclient.com first and inherit the access an administrator later
     * gives that address. A login from another account is attached only once
     * its owner has confirmed the email; ours (made by this account) are ours.
     */
    if (existing.accountId !== accountId && !existing.emailVerifiedAt) {
      return res.status(409).json({
        error: 'That address already has a CLOR sign-in that has not been confirmed. Ask the person to confirm their email from the link CLOR sent them, then add them again.',
        code: 'unverified_identity',
      });
    }
    const already = await platformPrisma.userOrgMembership.findFirst({
      where: { orgId: req.tenant!.orgId, userId: existing.id },
      select: { id: true },
    });
    if (already) {
      /*
       * GAP-006: an outside person whose access here was ended or paused is
       * added again by a fresh grant — the administrator's act, recorded.
       */
      if (existing.accountId !== accountId) {
        const row = await platformPrisma.outsideAccess.findUnique({ where: { orgId_userId: { orgId: req.tenant!.orgId, userId: existing.id } } });
        if (refusalOf(row)) {
          try {
            await grantOutsideAccess({ accountId, orgId: req.tenant!.orgId, userId: existing.id, homeAccountId: existing.accountId, byUserId: createdByUserId, apps: body.outsideAccess?.apps, expiresAt: body.outsideAccess?.expiresAt });
          } catch (e) {
            if (e instanceof OutsideAccessError) return res.status(e.status).json({ error: e.message });
            throw e;
          }
          if (req.res) req.res.locals.audited = true;
          await platformPrisma.auditLog.create({ data: { accountId, orgId: req.tenant!.orgId, branchId: req.tenant!.branchId, entity: 'User', entityId: existing.id, action: 'OUTSIDE_ACCESS_GRANTED', message: `Let ${existing.email} in again from another account`, createdByUserId } });
          return res.status(200).json({ user: { id: existing.id, email: existing.email }, regranted: true });
        }
      }
      return res.status(409).json({ error: 'That person already has access to this company.' });
    }
    invited = {
      id: existing.id,
      email: existing.email,
      fullName: existing.accountId === accountId ? existing.fullName : null,
      accountId: existing.accountId,
    };
  }

  if (!invited && body.username) {
    const usernameTaken = await platformPrisma.user.findFirst({
      where: { username: body.username.trim() },
      select: { id: true },
    });
    if (usernameTaken) return res.status(409).json({ error: 'That username is already taken. Choose another.' });
  }

  /*
   * #4: each company the person is added to must allow their address's
   * domain. Only this account's companies are read (review S5: another
   * account's list must not show through), and an owner, or someone from
   * another account let in by an engagement, is not held to it (S2, S3).
   */
  {
    const asked = body.orgIds.length ? body.orgIds : [req.tenant!.orgId];
    const ours = await platformPrisma.org.findMany({ where: { accountId, id: { in: asked } }, select: { id: true } });
    const domainRefused = await domainRefusalForPerson(invited?.id, accountId, ours.map((o) => o.id), email);
    if (domainRefused) return res.status(400).json({ error: domainRefused, code: 'EMAIL_DOMAIN_NOT_ALLOWED' });
  }

  /* A new login meets the adding company's password rules (SX-13). */
  if (!invited) {
    const weak = validatePassword(body.password, await getAuthPolicy(accountId, req.tenant!.orgId));
    if (weak) return res.status(400).json({ error: weak, code: 'WEAK_PASSWORD' });
  }

  /*
   * An invited person keeps the login they already have. Setting a password for
   * somebody else's existing identity would be an account takeover dressed as
   * an invitation.
   */
  const user =
    invited ??
    (await platformPrisma.user.create({
      data: {
        accountId,
        email,
        username: body.username ? body.username.trim() : null,
        fullName: body.fullName,
        phone: body.mobile?.trim() || null,
        passwordHash: await bcrypt.hash(body.password, Number(process.env.BCRYPT_ROUNDS || 12)),
      },
      select: { id: true, email: true, fullName: true, accountId: true },
    }));
  /* The login now exists and counts: the next request may check. */
  await releaseQuota();
  /* A new login belongs to this account (W-1.1); an invited person from elsewhere keeps their own account. */
  if (!invited) await ensureAccountMembership(accountId, user.id, 'MEMBER', createdByUserId);
  // A new person is numbered in the company that added them; someone who
  // already has an ID (e.g. a CA invited from another account) keeps it.
  await assignUserCode(user.id, req.tenant!.orgId);

  // memberships
  const orgIds = body.orgIds.length ? Array.from(new Set(body.orgIds)) : [req.tenant!.orgId];

  /* GAP-006: the terms for an outside person are checked before anything is written. */
  const outside = invited && invited.accountId !== accountId;
  if (outside) {
    try {
      checkOutsideTerms(body.outsideAccess?.apps, body.outsideAccess?.expiresAt);
    } catch (e) {
      if (e instanceof OutsideAccessError) return res.status(e.status).json({ error: e.message });
      throw e;
    }
  }

  // C-8: body-supplied org/branch ids must belong to the caller's account —
  // otherwise this is an unvalidated cross-account foreign key.
  const ownedOrgs = await platformPrisma.org.findMany({ where: { accountId, id: { in: orgIds } }, select: { id: true } });
  const ownedOrgIds = new Set(ownedOrgs.map((o) => o.id));
  for (const orgId of orgIds) {
    if (!ownedOrgIds.has(orgId)) {
      return res.status(400).json({ error: 'One of the companies is not in this account.' });
    }
    const requestedBranches = Array.from(new Set(body.branchIdsByOrg[orgId] || []));
    if (requestedBranches.length) {
      const ownedBranches = await platformPrisma.branch.findMany({
        where: { accountId, orgId, id: { in: requestedBranches } },
        select: { id: true },
      });
      if (ownedBranches.length !== requestedBranches.length) {
        return res.status(400).json({ error: 'One of the branches is not in that company.' });
      }
    }
  }

  for (const orgId of orgIds) {
    await platformPrisma.userOrgMembership.upsert({
      where: { accountId_orgId_userId: { accountId, orgId, userId: user.id } },
      update: {},
      create: { accountId, orgId, userId: user.id },
    });

    let branchIds = body.branchIdsByOrg[orgId] || [];
    if (!branchIds.length && orgId === req.tenant!.orgId) branchIds = [req.tenant!.branchId];
    branchIds = Array.from(new Set(branchIds));

    for (const branchId of branchIds) {
      await platformPrisma.userBranchMembership.upsert({
        where: { accountId_orgId_branchId_userId: { accountId, orgId, branchId, userId: user.id } },
        update: {},
        create: { accountId, orgId, branchId, userId: user.id },
      });
    }

    /* GAP-006: this administrator letting in a person from another account is the company's consent, recorded. */
    if (outside) {
      await runInTenant(orgId, () =>
        grantOutsideAccess({ accountId, orgId, userId: user.id, homeAccountId: invited!.accountId, byUserId: createdByUserId, apps: body.outsideAccess?.apps, expiresAt: body.outsideAccess?.expiresAt })
      );
    }
  }

  /* Written by name here; the general recorder (auditMutations) leaves it. */

  if (req.res) req.res.locals.audited = true;

  await platformPrisma.auditLog.create({
    data: {
      accountId,
      orgId: req.tenant!.orgId,
      branchId: req.tenant!.branchId,
      entity: 'User',
      entityId: user.id,
      action: 'CREATE',
      message: `User created: ${user.email}`,
      createdByUserId,
    },
  });

  const [inviter, org] = await Promise.all([
    platformPrisma.user.findUnique({ where: { id: createdByUserId }, select: { fullName: true } }),
    platformPrisma.org.findUnique({ where: { id: req.tenant!.orgId }, select: { name: true } }),
  ]);

  await sendTemplate({
    templateKey: 'auth.user_invited',
    to: user.email,
    toName: user.fullName ?? undefined,
    accountId,
    orgId: req.tenant!.orgId,
    transactional: true,
    relatedType: 'User',
    relatedId: user.id,
    data: {
      userName: user.fullName,
      email: user.email,
      orgName: org?.name || '',
      inviterName: inviter?.fullName || 'An administrator',
    },
  });

  res.status(201).json({ user });
});

usersRouter.delete('/orgs/:orgId/users/:userId', requirePermission('SETTINGS', PermissionAction.DELETE, 'Users'), async (req, res) => {
  const accountId = req.tenant!.accountId;
  const orgId = String(req.params.orgId);
  const userId = String(req.params.userId);
  const createdByUserId = req.auth!.userId;

  if (orgId !== req.tenant!.orgId) return otherCompany(res);

  if (!req.isAdmin && (await userIsAdmin(accountId, orgId, userId))) return res.status(403).json(ADMIN_ONLY_ERROR);
  if (await wouldRemoveLastAdmin(accountId, orgId, userId)) return res.status(409).json(LAST_ADMIN_ERROR);

  // Remove user from this org (do not delete the global user record)
  await platformPrisma.userRoleAssignment.deleteMany({ where: { accountId, orgId, userId } });
  // Profiles too: a profile left behind is a set of roles waiting to come back
  // the moment anybody re-adds this person.
  await platformPrisma.userRoleProfile.deleteMany({ where: { accountId, orgId, userId } });
  await platformPrisma.userWarehouseRoleAssignment.deleteMany({ where: { accountId, orgId, userId } });
  await platformPrisma.userWarehouseAccess.deleteMany({ where: { accountId, orgId, userId } });
  await platformPrisma.userBranchMembership.deleteMany({ where: { accountId, orgId, userId } });
  await platformPrisma.userOrgMembership.deleteMany({ where: { accountId, orgId, userId } });

  /* Written by name here; the general recorder (auditMutations) leaves it. */

  if (req.res) req.res.locals.audited = true;

  await platformPrisma.auditLog.create({
    data: {
      accountId,
      orgId: req.tenant!.orgId,
      branchId: req.tenant!.branchId,
      entity: 'User',
      entityId: userId,
      action: 'REMOVE',
      message: `User removed from org: ${userId}`,
      createdByUserId,
    },
  });
  /* Batch 5: what they made keeps working; it is flagged for someone to check. */
  await flagCreatorRemoved({ accountId, userId, orgIds: [orgId] }, 'The person who made it was removed from this company', actorFrom(req));

  res.json({ ok: true });
});

const assignBranchesSchema = z.object({
  branchIds: z.array(z.string()).min(1),
});

usersRouter.get('/orgs/:orgId/users/:userId/branches', requirePermission('SETTINGS', PermissionAction.VIEW, 'Users'), async (req, res) => {
  const accountId = req.tenant!.accountId;
  const orgId = String(req.params.orgId);
  const userId = String(req.params.userId);
  if (orgId !== req.tenant!.orgId) return otherCompany(res);

  // Ensure target user is a member of this org.
  const member = await platformPrisma.userOrgMembership.findFirst({ where: { accountId, orgId, userId }, select: { id: true } });
  if (!member) return res.status(404).json({ error: 'This person is not in this company.' });

  const rows = await platformPrisma.userBranchMembership.findMany({
    where: { accountId, orgId, userId },
    select: { branchId: true },
    orderBy: [{ createdAt: 'asc' }],
  });

  res.json({ branchIds: rows.map((r) => r.branchId) });
});

usersRouter.post('/orgs/:orgId/users/:userId/branches', requirePermission('SETTINGS', PermissionAction.EDIT, 'Users'), async (req, res) => {
  const accountId = req.tenant!.accountId;
  const orgId = String(req.params.orgId);
  const userId = String(req.params.userId);
  if (orgId !== req.tenant!.orgId) return otherCompany(res);

  const body = assignBranchesSchema.parse(req.body);
  const branchIds = Array.from(new Set(body.branchIds));
  const valid = await platformPrisma.branch.count({ where: { accountId, orgId, id: { in: branchIds } } });
  if (valid !== branchIds.length) return res.status(400).json({ error: 'One of the branches is not in this company.' });
  // Giving or taking a branch is done by somebody who manages users in that branch.
  const existingBranches = await platformPrisma.userBranchMembership.findMany({ where: { accountId, orgId, userId }, select: { branchId: true } });
  const before = new Set(existingBranches.map((row) => row.branchId));
  const changed = [...branchIds.filter((id) => !before.has(id)), ...[...before].filter((id) => !branchIds.includes(id))];
  for (const branchId of changed) {
    const { refusal } = await grantAuthority(req, branchId, permKey('SETTINGS', 'Users', 'EDIT'));
    if (refusal) return res.status(403).json({ error: 'You can give access only in a branch you look after.', code: 'not_in_branch' });
  }

  /* Review N4: this can add the person to the company; if so, its domain rule applies as anywhere else (owners and outsiders exempt). */
  const alreadyMember = await platformPrisma.userOrgMembership.findFirst({ where: { accountId, orgId, userId }, select: { id: true } });
  if (!alreadyMember) {
    const who = await platformPrisma.user.findUnique({ where: { id: userId }, select: { email: true } });
    const domainRefused = who ? await domainRefusalForPerson(userId, accountId, [orgId], who.email) : null;
    if (domainRefused) return res.status(400).json({ error: domainRefused, code: 'EMAIL_DOMAIN_NOT_ALLOWED' });
  }

  // ensure org membership exists
  await platformPrisma.userOrgMembership.upsert({
    where: { accountId_orgId_userId: { accountId, orgId, userId } },
    update: {},
    create: { accountId, orgId, userId },
  });

  // replace branch membership for this org
  await platformPrisma.userBranchMembership.deleteMany({ where: { accountId, orgId, userId } });
  for (const branchId of branchIds) {
    await platformPrisma.userBranchMembership.create({ data: { accountId, orgId, branchId, userId } });
  }

  res.json({ ok: true });
});

const assignRoleSchema = z.object({
  roleId: z.string().min(1),
  branchId: z.string().optional().nullable(),
});

usersRouter.post('/orgs/:orgId/users/:userId/roles', requirePermission('SETTINGS', PermissionAction.EDIT, 'Users'), async (req, res) => {
  const accountId = req.tenant!.accountId;
  const orgId = String(req.params.orgId);
  const userId = String(req.params.userId);
  const createdByUserId = req.auth!.userId;

  if (orgId !== req.tenant!.orgId) return otherCompany(res);

  const body = assignRoleSchema.parse(req.body);

  if (!(await isMember(accountId, orgId, userId))) return res.status(404).json({ error: 'This person is not in this company.' });

  const role = await platformPrisma.role.findFirst({ where: { id: body.roleId, accountId, orgId } });
  if (!role) return res.status(404).json({ error: 'No such role.' });

  const scopeBranchId = body.branchId ?? null;
  if (role.branchId && role.branchId !== scopeBranchId) return res.status(400).json({ error: 'That role belongs to another branch. Choose a role from this branch.' });
  if (scopeBranchId) {
    const branch = await platformPrisma.branch.findFirst({ where: { id: scopeBranchId, accountId, orgId }, select: { id: true } });
    if (!branch) return res.status(400).json({ error: 'That branch is not in this company.' });
  }

  const refused = await assignmentRefusal(req, accountId, orgId, userId, role, scopeBranchId);
  if (refused) return res.status(refused.status).json(refused.body);

  /*
   * W-5.2: making somebody a company administrator is the largest step up in
   * power there is. Where the person granting it has an authenticator, it
   * takes a fresh code (the client asks for it and retries); the grant is in
   * the audit trail either way.
   */
  if (role.roleType === RoleType.ADMIN && userId !== createdByUserId) {
    const granter = await platformPrisma.user.findUnique({ where: { id: createdByUserId }, select: { totpEnabledAt: true } });
    if (granter?.totpEnabledAt && !hasValidStepUp(req)) {
      return res.status(403).json({ error: 'Enter the code from your authenticator app to make someone an administrator.', code: 'STEP_UP_REQUIRED' });
    }
  }

  try {
    await platformPrisma.$transaction(async (tx) => {
      // Enforce a single role per scope (org-wide when branchId=null, or per-branch when provided)
      await tx.userRoleAssignment.deleteMany({ where: { accountId, orgId, userId, branchId: scopeBranchId } });
      await tx.userRoleAssignment.create({
        data: { accountId, orgId, branchId: scopeBranchId, userId, roleId: role.id, createdByUserId },
      });
      await assertAnAdminRemains(tx, accountId, orgId);
    });
  } catch (err: any) {
    if (err instanceof LastAdminError) return res.status(409).json(LAST_ADMIN_ERROR);
    // If the client sent duplicates or raced, keep endpoint idempotent.
    if (!(String(err?.name || '') === 'PrismaClientKnownRequestError' && String(err?.code || '') === 'P2002')) throw err;
  }

  res.status(201).json({ ok: true });
});

const assignWarehousesSchema = z.object({
  warehouseIds: z.array(z.string()).min(1),
});

usersRouter.post('/orgs/:orgId/users/:userId/warehouses', requirePermission('SETTINGS', PermissionAction.EDIT, 'Users'), async (req, res) => {
  const accountId = req.tenant!.accountId;
  const orgId = String(req.params.orgId);
  const userId = String(req.params.userId);
  if (orgId !== req.tenant!.orgId) return otherCompany(res);

  const body = assignWarehousesSchema.parse(req.body);
  const warehouseIds = Array.from(new Set(body.warehouseIds));

  // Checked before anything is cleared: a wrong id used to leave the person
  // with no warehouses at all.
  const warehouses = await prisma.warehouse.findMany({ where: { accountId, orgId, id: { in: warehouseIds } }, select: { id: true, branchId: true } });
  if (warehouses.length !== warehouseIds.length) return res.status(400).json({ error: 'One of the warehouses is not in this company.' });

  // A warehouse is given, or taken away, by somebody who manages users in its
  // branch; and given only to somebody who works in that branch.
  const existing = await platformPrisma.userWarehouseAccess.findMany({ where: { accountId, orgId, userId }, select: { warehouseId: true, branchId: true } });
  const had = new Set(existing.map((row) => row.warehouseId));
  const added = warehouses.filter((w) => !had.has(w.id));
  const removed = existing.filter((row) => !warehouseIds.includes(row.warehouseId));
  for (const warehouse of added) {
    const member = await platformPrisma.userBranchMembership.findFirst({ where: { accountId, orgId, branchId: warehouse.branchId, userId }, select: { id: true } });
    if (!member && !(await userIsAdmin(accountId, orgId, userId))) return res.status(400).json({ error: 'This person has no access to that warehouse’s branch. Give them the branch first.' });
  }
  for (const branchId of new Set([...added.map((w) => w.branchId), ...removed.map((row) => row.branchId)])) {
    const { refusal } = await grantAuthority(req, branchId, permKey('SETTINGS', 'Users', 'EDIT'));
    if (refusal) return res.status(403).json({ error: 'You can give access only to a warehouse in a branch you look after.', code: 'not_in_branch' });
  }

  await platformPrisma.$transaction(async (tx) => {
    // clear then assign
    await tx.userWarehouseAccess.deleteMany({ where: { accountId, orgId, userId } });
    // A role held at a warehouse goes when the warehouse does.
    await tx.userWarehouseRoleAssignment.deleteMany({ where: { accountId, orgId, userId, warehouseId: { notIn: warehouseIds } } });
    for (const wh of warehouses) {
      await tx.userWarehouseAccess.create({ data: { accountId, orgId, branchId: wh.branchId, warehouseId: wh.id, userId } });
    }
  });

  res.json({ ok: true });
});
