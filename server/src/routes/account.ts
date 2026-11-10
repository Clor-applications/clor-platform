import { Router } from 'express';
import { z } from 'zod';
import { ARCHIVE_REASONS, ARCHIVE_REASON_LABEL, ArchiveError, type ArchiveReason, archiveCompany, reactivateCompany } from '../services/companyArchive.js';

import { prisma } from '../utils/prisma.js';
import { platformPrisma } from '../utils/platformPrisma.js';
import { requireAuth } from '../middleware/auth.js';
import { requireTenantContext } from '../middleware/tenantContext.js';
import {
  ACCOUNT_ADMINS,
  ACCOUNT_BILLING,
  AccountMembershipError,
  accountRoleOf,
  isAccountRole,
  listAccountMembers,
  recordAccountEvent,
  requireAccountRole,
  setAccountRole,
} from '../services/accountMembership.js';
import { appsOfPermissions, memberAccess, memberDirectory, removeFromCompany, setMemberStatus, signOutMember } from '../services/accountMembers.js';
import { resolveAccess } from '../services/access.js';
import { InvitationError, createInvitation, listInvitations, resendInvitation, revokeInvitation } from '../services/accountInvitations.js';
import { entitlementFor } from '../services/entitlements.js';
import { outsideTenant, runInTenant } from '../utils/tenantScope.js';
import { getFeatures } from '../services/features.js';
import { appAccess, getSubscription } from '../services/subscriptions.js';
import { accountEntities, dataHealth, monthlyRunRate, subscriptionWatch } from '../services/accountHealth.js';

/**
 * The account, above any one company.
 *
 * Everything in this product is scoped to a company, which is right for doing
 * the work and wrong for running the business that does it. A CA firm with
 * twenty clients had no screen that could answer "how many companies do we
 * have, who has access to them, and how close are we to the plan's limits" —
 * the only way to find out was to enter each company in turn.
 *
 * The figures are real. There is no mock here: the account, its companies and
 * its people all exist on the server already.
 */
export const accountRouter = Router();
accountRouter.use(requireAuth, requireTenantContext);

/*
 * W-1.4: the account overview is the account's, so its owners, administrators
 * and billing administrators see it — not whoever can view one company's
 * profile, which is what gated it before.
 */
const ACCOUNT_VIEW = requireAccountRole(...ACCOUNT_BILLING);

const num = (v: unknown) => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

accountRouter.get('/account/overview', ACCOUNT_VIEW, (req, res) =>
  outsideTenant('account overview: every company on the account, each with its own figures', async () => {
  const { accountId } = req.tenant!;

  const [account, orgs, users, entitlement] = await Promise.all([
    platformPrisma.account.findFirst({ where: { id: accountId }, select: { id: true, code: true, name: true, createdAt: true } }),
    platformPrisma.org.findMany({
      where: { accountId },
      select: { id: true, name: true, slug: true, pan: true, createdAt: true, archivedAt: true, archivedReason: true, archivedNote: true },
      orderBy: { name: 'asc' },
    }),
    platformPrisma.user.findMany({
      where: { accountId },
      select: { id: true, fullName: true, email: true, isActive: true, lastLoginAt: true },
      orderBy: { fullName: 'asc' },
    }),
    entitlementFor(accountId),
  ]);

  const orgIds = orgs.map((o) => o.id);

  /*
   * Counted in one query each rather than per company. A practice with fifty
   * clients would otherwise make a hundred and fifty round trips to draw one
   * screen.
   */
  /*
   * The state and the GSTIN live on the head-office branch, not on the org.
   *
   * That is where setup-company writes them, and the state is worth showing
   * here because it decides whether every invoice the company raises splits
   * into CGST and SGST or lands as IGST.
   */
  const [headOffices, memberships, invoices] = await Promise.all([
    platformPrisma.branch.findMany({
      where: { accountId, orgId: { in: orgIds }, branchCode: 'HO' },
      select: { orgId: true, state: true, gstin: true },
    }),
    platformPrisma.userOrgMembership.groupBy({
      by: ['orgId'],
      where: { accountId, orgId: { in: orgIds } },
      _count: true,
    }),
    prisma.invoice.groupBy({
      by: ['orgId'],
      where: { accountId, orgId: { in: orgIds } },
      _count: true,
      _sum: { total: true, paidAmount: true },
    }),
  ]);

  /*
   * Which apps each company has switched on, read the way the shell reads
   * them for the company in use (its feature switches, within the apps the
   * account owns), so the Workspace can say it for every company. Each
   * company's switches are its own rows, read inside that company.
   */
  const access = await appAccess(accountId);
  const appsByOrg = new Map<string, string[]>();
  for (const o of orgs) {
    const f = (await runInTenant(o.id, () => getFeatures(accountId, o.id))) as Record<string, boolean>;
    const apps = ['accounting', ...(['people', 'attendance', 'payroll'] as const).filter((k) => f[k])];
    appsByOrg.set(o.id, access.restricted ? apps.filter((a) => access.ownedApps.includes(a)) : apps);
  }

  /*
   * The Overview's account-wide figures: what the account is set up as, what
   * it pays, the seats it bought per app, and whether what feeds it from
   * outside is flowing — over the companies still open (an archived one is
   * read-only and off the plan's count).
   */
  const openIds = orgs.filter((o) => !o.archivedAt).map((o) => o.id);
  const [entities, subscription, health, bills] = await Promise.all([
    accountEntities(accountId, openIds),
    getSubscription(accountId),
    dataHealth(accountId, openIds),
    /* CLOR's own invoices to this account that still want paying (roadmap item 8). */
    platformPrisma.billingInvoice.findMany({ where: { accountId, status: 'ISSUED' }, select: { status: true, dueDate: true, total: true } }),
  ]);

  const headByOrg = new Map(headOffices.map((b) => [b.orgId, b]));
  const peopleByOrg = new Map(memberships.map((m) => [m.orgId, Number(m._count) || 0]));
  const billedByOrg = new Map(
    invoices.map((i) => [i.orgId, { count: Number(i._count) || 0, billed: num(i._sum.total), settled: num(i._sum.paidAmount) }])
  );

  res.json({
    account: account ? { id: account.id, code: account.code || null, name: account.name, since: account.createdAt } : null,
    plan: {
      key: entitlement.planKey,
      name: entitlement.planName,
      status: entitlement.status,
      inGoodStanding: entitlement.inGoodStanding,
      limits: entitlement.limits,
    },
    usage: {
      companies: orgs.filter((o) => !o.archivedAt).length,
      archivedCompanies: orgs.filter((o) => o.archivedAt).length,
      users: users.filter((u) => u.isActive).length,
    },
    entities,
    /* Seats bought per app; null where an app is not seat-metered. Seats in use are the Workspace's to count from the directory. */
    seats: subscription ? subscription.items.map((i) => ({ app: i.appCode, bought: i.seats ?? null })) : null,
    runRate: monthlyRunRate(subscription),
    renewal: subscriptionWatch(subscription, bills),
    dataHealth: health,
    companies: orgs.map((o) => {
      const billing = billedByOrg.get(o.id) || { count: 0, billed: 0, settled: 0 };
      const head = headByOrg.get(o.id);
      return {
        orgId: o.id,
        name: o.name,
        slug: o.slug || '',
        /* Archived (services/companyArchive.ts): read-only, not on the plan's count. */
        archived: o.archivedAt ? { at: o.archivedAt, reason: o.archivedReason, reasonLabel: ARCHIVE_REASON_LABEL[o.archivedReason as ArchiveReason] || null, note: o.archivedNote } : null,
        // The company master lives in a JSON column; the state is the one field
        // from it worth showing here, because it decides how every invoice the
        // company raises is taxed.
        state: head?.state || '',
        gstin: head?.gstin || '',
        pan: o.pan || '',
        since: o.createdAt,
        apps: appsByOrg.get(o.id) || [],
        people: peopleByOrg.get(o.id) || 0,
        invoices: billing.count,
        billed: billing.billed,
        /* What is still owed. Never below zero: an overpayment is not a credit
           to the company's turnover. */
        outstanding: Math.max(0, Math.round((billing.billed - billing.settled) * 100) / 100),
      };
    }),
    users: users.map((u) => ({
      id: u.id,
      name: u.fullName,
      email: u.email,
      active: u.isActive,
      lastLoginAt: u.lastLoginAt,
    })),
  });
  }));

export default accountRouter;

/** The caller's own account role, for the Workspace to decide what to show (the server still decides what to allow). */
accountRouter.get('/account/me', async (req, res) => {
  const { accountId, orgId } = req.tenant!;
  const role = await accountRoleOf(accountId, req.auth!.userId);
  /*
   * W-4.2: the apps this person can open in the company in scope, from their
   * roles — the launcher shows "Access not assigned" for a switched-on app
   * that is not among them (subscription is not personal access).
   */
  const access = await resolveAccess(accountId, orgId, req.auth!.userId);
  res.json({ accountId, role, companyAdmin: access.isAdmin, apps: appsOfPermissions(access.permissions, access.isAdmin) });
});

/** Everyone who belongs to the account, with their account role. Owners and administrators only. */
/*
 * Archive / reactivate a company (services/companyArchive.ts). Owners and
 * admins of the account; the company is named in the path, so this works on
 * an archived company that no longer accepts writes through its own routes.
 */
const archiveSchema = z.object({ reason: z.enum(ARCHIVE_REASONS), note: z.string().max(1000).optional().nullable() });

accountRouter.get('/account/companies/archive-reasons', requireAccountRole(...ACCOUNT_ADMINS), (_req, res) => {
  res.json({ reasons: ARCHIVE_REASONS.map((key) => ({ key, label: ARCHIVE_REASON_LABEL[key] })) });
});

accountRouter.post('/account/companies/:orgId/archive', requireAccountRole(...ACCOUNT_ADMINS), async (req, res) => {
  const accountId = String(req.tenant!.accountId);
  const body = archiveSchema.parse(req.body);
  try {
    const out = await archiveCompany({ accountId, orgId: String(req.params.orgId), actorUserId: req.auth!.userId, reason: body.reason, note: body.note });
    await recordAccountEvent({ accountId, actorUserId: req.auth!.userId, action: 'COMPANY_ARCHIVED', targetType: 'Org', targetId: String(req.params.orgId), message: `${out.name}: ${ARCHIVE_REASON_LABEL[body.reason]}${body.note ? ` — ${body.note}` : ''}` });
    res.json({ ok: true });
  } catch (e) {
    if (e instanceof ArchiveError) return res.status(e.status).json({ error: e.message, code: e.code });
    throw e;
  }
});

accountRouter.post('/account/companies/:orgId/reactivate', requireAccountRole(...ACCOUNT_ADMINS), async (req, res) => {
  const accountId = String(req.tenant!.accountId);
  try {
    const out = await reactivateCompany({ accountId, orgId: String(req.params.orgId), actorUserId: req.auth!.userId });
    await recordAccountEvent({ accountId, actorUserId: req.auth!.userId, action: 'COMPANY_REACTIVATED', targetType: 'Org', targetId: String(req.params.orgId), message: out.name });
    res.json({ ok: true });
  } catch (e) {
    if (e instanceof ArchiveError) return res.status(e.status).json({ error: e.message, code: e.code });
    throw e;
  }
});

accountRouter.get('/account/members', requireAccountRole(...ACCOUNT_ADMINS), async (req, res) => {
  res.json({ members: await listAccountMembers(req.tenant!.accountId) });
});

/** Change one person's account role (W-1.2): owner rules, last-owner guard, step-up and audit in setAccountRole. */
accountRouter.put('/account/members/:userId/role', requireAccountRole(...ACCOUNT_ADMINS), async (req, res) => {
  const role = req.body?.role;
  if (!isAccountRole(role)) return res.status(400).json({ error: 'Role must be OWNER, ADMIN, BILLING_ADMIN or MEMBER.', code: 'BAD_ROLE' });
  try {
    res.json(await setAccountRole(req, String(req.params.userId), role));
  } catch (e) {
    if (e instanceof AccountMembershipError) return res.status(e.status).json({ error: e.message, code: e.code });
    throw e;
  }
});

/*
 * W-3: invitations into the account. Owners and administrators only; the
 * service checks the role again and keeps every grant within the inviter's
 * authority (services/accountInvitations.ts).
 */
const invitationError = (res: import('express').Response, e: unknown) => {
  if (e instanceof InvitationError) return res.status(e.status).json({ error: e.message, code: e.code });
  throw e;
};

accountRouter.get('/account/invitations', requireAccountRole(...ACCOUNT_ADMINS), async (req, res) => {
  res.json({ invitations: await listInvitations(req.tenant!.accountId) });
});

accountRouter.post('/account/invitations', requireAccountRole(...ACCOUNT_ADMINS), async (req, res) => {
  try {
    res.status(201).json(await createInvitation(req, req.body || {}));
  } catch (e) {
    invitationError(res, e);
  }
});

accountRouter.post('/account/invitations/:id/resend', requireAccountRole(...ACCOUNT_ADMINS), async (req, res) => {
  try {
    res.json({ invitation: await resendInvitation(req, String(req.params.id)) });
  } catch (e) {
    invitationError(res, e);
  }
});

accountRouter.post('/account/invitations/:id/revoke', requireAccountRole(...ACCOUNT_ADMINS), async (req, res) => {
  try {
    res.json(await revokeInvitation(req, String(req.params.id)));
  } catch (e) {
    invitationError(res, e);
  }
});

/*
 * W-4: the account's people. Owners and administrators only; the service
 * checks again and keeps owners for owners, nobody acting on themself.
 */
const memberError = (res: import('express').Response, e: unknown) => {
  if (e instanceof AccountMembershipError) return res.status(e.status).json({ error: e.message, code: e.code });
  throw e;
};

accountRouter.get('/account/members/directory', requireAccountRole(...ACCOUNT_ADMINS), async (req, res) => {
  res.json(await memberDirectory(req.tenant!.accountId));
});

accountRouter.get('/account/members/:userId/access', requireAccountRole(...ACCOUNT_ADMINS), async (req, res) => {
  try {
    res.json(await memberAccess(req.tenant!.accountId, String(req.params.userId)));
  } catch (e) {
    memberError(res, e);
  }
});

accountRouter.post('/account/members/:userId/suspend', requireAccountRole(...ACCOUNT_ADMINS), async (req, res) => {
  try {
    res.json(await setMemberStatus(req, String(req.params.userId), 'SUSPENDED'));
  } catch (e) {
    memberError(res, e);
  }
});

accountRouter.post('/account/members/:userId/reinstate', requireAccountRole(...ACCOUNT_ADMINS), async (req, res) => {
  try {
    res.json(await setMemberStatus(req, String(req.params.userId), 'ACTIVE'));
  } catch (e) {
    memberError(res, e);
  }
});

accountRouter.delete('/account/members/:userId/companies/:orgId', requireAccountRole(...ACCOUNT_ADMINS), async (req, res) => {
  try {
    res.json(await removeFromCompany(req, String(req.params.userId), String(req.params.orgId)));
  } catch (e) {
    memberError(res, e);
  }
});

/*
 * W-7.2: the account's own audit — account roles, invitations, suspensions,
 * removals, and refused account-level writes. Owners and administrators;
 * scoped to the account of the company in scope, newest first, filterable.
 */
accountRouter.get('/account/audit', requireAccountRole(...ACCOUNT_ADMINS), async (req, res) => {
  const { accountId } = req.tenant!;
  const q = req.query as Record<string, string | undefined>;
  const take = Math.min(Math.max(Number(q.limit) || 50, 1), 200);
  const where: Record<string, unknown> = { accountId };
  if (q.action) where.action = String(q.action);
  if (q.result === 'OK' || q.result === 'DENIED') where.result = q.result;
  if (q.actor) where.actorUserId = String(q.actor);
  const range: Record<string, Date> = {};
  if (q.from && !Number.isNaN(Date.parse(q.from))) range.gte = new Date(q.from);
  if (q.to && !Number.isNaN(Date.parse(q.to))) range.lte = new Date(q.to);
  if (Object.keys(range).length) where.createdAt = range;
  const page = await outsideTenant('account audit: list', async () => {
    const rows = await platformPrisma.accountAuditEvent.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: take + 1,
      ...(q.cursor ? { cursor: { id: String(q.cursor) }, skip: 1 } : {}),
    });
    const people = await platformPrisma.user.findMany({
      where: { id: { in: [...new Set(rows.flatMap((r) => [r.actorUserId, r.targetType === 'AccountMembership' ? r.targetId : null]).filter(Boolean) as string[])] } },
      select: { id: true, fullName: true, email: true },
    });
    const who = new Map(people.map((p) => [p.id, p.fullName || p.email]));
    return {
      events: rows.slice(0, take).map((r) => ({
        id: r.id,
        at: r.createdAt,
        action: r.action,
        result: r.result,
        actor: r.actorUserId ? { id: r.actorUserId, name: who.get(r.actorUserId) || null } : null,
        targetType: r.targetType,
        targetId: r.targetId,
        targetName: r.targetType === 'AccountMembership' && r.targetId ? who.get(r.targetId) || null : null,
        message: r.message,
        metadata: (() => {
          try {
            return r.metadata ? JSON.parse(r.metadata) : null;
          } catch {
            return null;
          }
        })(),
        requestId: r.requestId,
      })),
      next: rows.length > take ? rows[take - 1].id : null,
    };
  });
  res.json(page);
});

/* W-7.1: sign a member out of every session (a lost laptop); their access stays. */
accountRouter.post('/account/members/:userId/sign-out', requireAccountRole(...ACCOUNT_ADMINS), async (req, res) => {
  try {
    res.json(await signOutMember(req, String(req.params.userId)));
  } catch (e) {
    memberError(res, e);
  }
});

/* W-7.3: the account's own name (it starts as the name of whoever signed up). Owners and administrators; audited. */
accountRouter.patch('/account', requireAccountRole(...ACCOUNT_ADMINS), async (req, res) => {
  const name = String(req.body?.name ?? '').trim();
  if (name.length < 2 || name.length > 120) return res.status(400).json({ error: 'Give the account a name of 2 to 120 characters.', code: 'BAD_NAME' });
  const { accountId } = req.tenant!;
  const before = await outsideTenant('account settings: rename', async () => {
    const was = await platformPrisma.account.findUnique({ where: { id: accountId }, select: { name: true } });
    await platformPrisma.account.update({ where: { id: accountId }, data: { name } });
    return was?.name || null;
  });
  await recordAccountEvent({ accountId, actorUserId: req.auth!.userId, action: 'ACCOUNT_RENAMED', targetType: 'Account', targetId: accountId, message: `Renamed from "${before || ''}" to "${name}"`, metadata: { from: before, to: name } });
  res.json({ account: { id: accountId, name } });
});
