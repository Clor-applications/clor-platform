import { Router } from 'express';
import type { Request } from 'express';
import { z } from 'zod';

import { requireAuth } from '../middleware/auth.js';
import { OPERATOR_ROLES, operatorUserIds, requireOperator, requireOperatorRole, requireOperatorToEnrol } from '../middleware/operator.js';
import { codeLimiter } from '../middleware/rateLimit.js';
import { decryptSecret, encryptSecret } from '../services/mailer.js';
import { newSecret, otpauthUri, recoveryCodes, verifyCode } from '../services/totp.js';
import { platformPrisma } from '../utils/platformPrisma.js';
import { outsideTenant } from '../utils/tenantScope.js';
import { clearAccessCache } from '../utils/accessCache.js';
import { clientIp, recordAuthEvent } from '../services/auth.js';
import { issueStepUp, requireOperatorStepUp } from '../services/stepUp.js';
import { getSubscription, inGoodStanding } from '../services/subscriptions.js';
import { useSecondFactor } from './security.js';

/**
 * The Clor operator console (W-8.2): Clor's own staff, looking across every
 * customer account from outside them.
 *
 * Who: operators only (middleware/operator.ts) — bootstrap super admins named
 * in CLOR_OPERATOR_USER_IDS, others added here by a super admin — and only
 * with an authenticator app. Every change needs a fresh authenticator code
 * (step-up) and is written to OperatorAuditEvent, append-only, and to the
 * customer's own security log, where they can see what Clor did.
 *
 * What: account metadata only — names, owners, companies, apps, plan, sign-in
 * dates. Never a customer's invoices, employees or payroll; an operator who
 * needs those asks the customer.
 *
 * Mounted ahead of every router that demands tenant headers (app.ts): an
 * operator is not a member of the accounts they look at.
 */
export const opsRouter = Router();

/*
 * Setting up the authenticator, from the console itself.
 *
 * Every other /ops route refuses an operator who has none, so these two sit
 * ahead of that gate. They are still operators only: a customer who finds
 * this address gets the same refusal as anywhere else in the console. Same
 * shape as the in-app set-up (routes/security.ts) — the secret is in force
 * only once a code from it has been typed back — without a company, because
 * an operator need not belong to one.
 */
const enrolling = (req: Request) =>
  platformPrisma.user.findUnique({ where: { id: req.auth!.userId }, select: { id: true, email: true, totpSecretEnc: true } });

opsRouter.post('/ops/two-factor/setup', requireAuth, requireOperatorToEnrol, async (req, res) => {
  const u = (await enrolling(req))!;
  const secret = newSecret();
  await platformPrisma.user.update({ where: { id: u.id }, data: { totpSecretEnc: encryptSecret(secret), totpLastStep: null } });
  res.json({ secret, uri: otpauthUri(secret, u.email) });
});

opsRouter.post('/ops/two-factor/enable', requireAuth, ...codeLimiter, requireOperatorToEnrol, async (req, res) => {
  const u = (await enrolling(req))!;
  if (!u.totpSecretEnc) return res.status(400).json({ error: 'Start the set-up first.' });
  const step = verifyCode(decryptSecret(u.totpSecretEnc), String(req.body?.code || ''), null);
  if (step == null) return res.status(400).json({ error: 'That code is not right. Check the time on your phone and try the newest code.', code: 'BAD_CODE' });
  const { codes, hashes } = recoveryCodes();
  await platformPrisma.user.update({ where: { id: u.id }, data: { totpEnabledAt: new Date(), totpLastStep: step, totpRecoveryJson: JSON.stringify(hashes) } });
  await platformPrisma.operatorAuditEvent.create({
    data: { operatorUserId: u.id, action: 'TWO_FACTOR_ENABLED', ip: clientIp(req) ?? null, userAgent: req.headers['user-agent'] ? String(req.headers['user-agent']).slice(0, 300) : null },
  });
  res.json({ enabled: true, recoveryCodes: codes });
});

opsRouter.use('/ops', requireAuth, requireOperator);

const DAY = 86_400_000;

async function audit(req: Request, action: string, target: { accountId?: string | null; userId?: string | null }, detail?: unknown) {
  await platformPrisma.operatorAuditEvent.create({
    data: {
      operatorUserId: req.auth!.userId,
      action,
      targetAccountId: target.accountId ?? null,
      targetUserId: target.userId ?? null,
      detail: detail === undefined ? undefined : (detail as any),
      ip: clientIp(req) ?? null,
      userAgent: req.headers['user-agent'] ? String(req.headers['user-agent']).slice(0, 300) : null,
    },
  });
  /* The customer sees, in their own security activity, that Clor acted on their account. */
  if (target.accountId) {
    await recordAuthEvent({
      accountId: target.accountId,
      userId: req.auth!.userId,
      eventType: `OPERATOR_${action}`,
      ip: clientIp(req),
      userAgent: req.headers['user-agent'] as string | undefined,
      detail: detail === undefined ? undefined : JSON.stringify(detail).slice(0, 1000),
    });
  }
}

/** Who I am here. */
opsRouter.get('/ops/me', async (req, res) => {
  const u = await platformPrisma.user.findUnique({ where: { id: req.auth!.userId }, select: { id: true, fullName: true, email: true } });
  res.json({ user: u, role: res.locals.operatorRole });
});

/** A fresh authenticator code for fifteen minutes of changes (the console has no company to ask through). */
opsRouter.post('/ops/step-up', async (req, res) => {
  const u = await platformPrisma.user.findUnique({
    where: { id: req.auth!.userId },
    select: { id: true, totpSecretEnc: true, totpEnabledAt: true, totpLastStep: true, totpRecoveryJson: true },
  });
  if (!u?.totpEnabledAt || !u.totpSecretEnc) return res.status(400).json({ error: 'Set up an authenticator app first.', code: 'TWO_FACTOR_SETUP_REQUIRED' });
  const used = await useSecondFactor(u, String(req.body?.code || ''));
  if (!used) {
    await platformPrisma.operatorAuditEvent.create({ data: { operatorUserId: u.id, action: 'STEP_UP_FAILED', ip: clientIp(req) ?? null } });
    return res.status(400).json({ error: 'That code is not right, or has been used. Wait for the next one.', code: 'BAD_CODE' });
  }
  res.json(issueStepUp(u.id, req.auth!.sessionId));
});

/** The numbers on the console's first page. */
opsRouter.get('/ops/overview', (_req, res) =>
  outsideTenant('ops: overview', async () => {
    const now = Date.now();
    const since30 = new Date(now - 30 * DAY);
    const [accounts, companies, users, active7, suspended, recent, trialsEnding] = await Promise.all([
      platformPrisma.account.count(),
      platformPrisma.org.count(),
      platformPrisma.user.count({ where: { isActive: true } }),
      platformPrisma.user.count({ where: { lastLoginAt: { gte: new Date(now - 7 * DAY) } } }),
      platformPrisma.account.count({ where: { suspendedAt: { not: null } } }),
      platformPrisma.account.findMany({ where: { createdAt: { gte: since30 } }, select: { createdAt: true } }),
      platformPrisma.subscription.count({ where: { status: 'trialing', trialEndsAt: { gte: new Date(now), lte: new Date(now + 7 * DAY) } } }),
    ]);
    /* Signups per day for the last 30 days, oldest first, every day present. */
    const byDay = new Map<string, number>();
    for (let i = 29; i >= 0; i--) byDay.set(new Date(now - i * DAY).toISOString().slice(0, 10), 0);
    for (const a of recent) {
      const k = a.createdAt.toISOString().slice(0, 10);
      if (byDay.has(k)) byDay.set(k, (byDay.get(k) || 0) + 1);
    }
    res.json({
      accounts,
      companies,
      users,
      activeUsers7d: active7,
      suspended,
      trialsEndingIn7d: trialsEnding,
      signups: [...byDay.entries()].map(([day, count]) => ({ day, count })),
    });
  }),
);

const listQuery = z.object({
  q: z.string().trim().max(120).optional(),
  status: z.enum(['all', 'active', 'trialing', 'suspended', 'no-plan']).optional(),
  page: z.coerce.number().int().min(0).max(10_000).optional(),
});
const PAGE = 25;

/** Every customer account: who owns it, how big, what plan, when last used. */
opsRouter.get('/ops/accounts', (req, res) =>
  outsideTenant('ops: accounts', async () => {
    const parsed = listQuery.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid query' });
    const { q = '', status = 'all', page = 0 } = parsed.data;
    const where: any = {};
    if (q) {
      where.OR = [
        { name: { contains: q, mode: 'insensitive' } },
        { code: { contains: q, mode: 'insensitive' } },
        { users: { some: { email: { contains: q, mode: 'insensitive' } } } },
        { orgs: { some: { name: { contains: q, mode: 'insensitive' } } } },
      ];
    }
    if (status === 'suspended') where.suspendedAt = { not: null };
    const accountsAll = await platformPrisma.account.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      select: { id: true, name: true, code: true, createdAt: true, suspendedAt: true, legacyUnrestrictedAt: true, _count: { select: { orgs: true, users: true } } },
    });
    const ids = accountsAll.map((a) => a.id);
    const [subs, owners, last] = await Promise.all([
      platformPrisma.subscription.findMany({ where: { accountId: { in: ids } }, select: { accountId: true, status: true, trialEndsAt: true, currentPeriodEnd: true, items: { select: { appCode: true } } } }),
      platformPrisma.accountMembership.findMany({ where: { accountId: { in: ids }, role: 'OWNER' }, select: { accountId: true, userId: true }, orderBy: { createdAt: 'asc' } }),
      platformPrisma.user.groupBy({ by: ['accountId'], where: { accountId: { in: ids } }, _max: { lastLoginAt: true } }),
    ]);
    const ownerUsers = await platformPrisma.user.findMany({ where: { id: { in: owners.map((o) => o.userId) } }, select: { id: true, email: true, fullName: true } });
    const userById = new Map(ownerUsers.map((u) => [u.id, u]));
    const ownerBy = new Map<string, { email: string; name: string }>();
    for (const o of owners) if (!ownerBy.has(o.accountId) && userById.get(o.userId)) ownerBy.set(o.accountId, { email: userById.get(o.userId)!.email, name: userById.get(o.userId)!.fullName });
    const subBy = new Map(subs.map((s) => [s.accountId, s]));
    const lastBy = new Map(last.map((l) => [l.accountId, l._max.lastLoginAt]));

    let rows = accountsAll.map((a) => {
      const s = subBy.get(a.id);
      const plan = a.suspendedAt ? 'suspended' : s ? s.status : a.legacyUnrestrictedAt ? 'legacy' : 'no-plan';
      return {
        id: a.id,
        name: a.name,
        code: a.code,
        createdAt: a.createdAt,
        owner: ownerBy.get(a.id) || null,
        companies: a._count.orgs,
        users: a._count.users,
        plan,
        apps: s ? s.items.map((i) => i.appCode).sort() : [],
        trialEndsAt: s?.trialEndsAt || null,
        lastActiveAt: lastBy.get(a.id) || null,
        suspended: Boolean(a.suspendedAt),
      };
    });
    if (status === 'active') rows = rows.filter((r) => r.plan === 'active' || r.plan === 'legacy');
    if (status === 'trialing') rows = rows.filter((r) => r.plan === 'trialing');
    if (status === 'no-plan') rows = rows.filter((r) => r.plan === 'no-plan');
    res.json({ total: rows.length, page, pageSize: PAGE, accounts: rows.slice(page * PAGE, page * PAGE + PAGE) });
  }),
);

/** One account: owners and members, companies, subscription, recent security events. Metadata only. */
opsRouter.get('/ops/accounts/:id', (req, res) =>
  outsideTenant('ops: one account', async () => {
    const id = String(req.params.id);
    const account = await platformPrisma.account.findUnique({
      where: { id },
      select: { id: true, name: true, code: true, createdAt: true, suspendedAt: true, suspendedReason: true, legacyUnrestrictedAt: true },
    });
    if (!account) return res.status(404).json({ error: 'No such account' });
    const [members, orgs, sub, events, opEvents] = await Promise.all([
      platformPrisma.accountMembership.findMany({ where: { accountId: id }, select: { userId: true, role: true, status: true, createdAt: true }, orderBy: { createdAt: 'asc' } }),
      platformPrisma.org.findMany({ where: { accountId: id }, select: { id: true, name: true, code: true, createdAt: true }, orderBy: { createdAt: 'asc' } }),
      getSubscription(id),
      platformPrisma.authEvent.findMany({ where: { accountId: id }, orderBy: { createdAt: 'desc' }, take: 20, select: { eventType: true, createdAt: true, email: true } }),
      platformPrisma.operatorAuditEvent.findMany({ where: { targetAccountId: id }, orderBy: { at: 'desc' }, take: 20 }),
    ]);
    const users = await platformPrisma.user.findMany({
      where: { id: { in: members.map((m) => m.userId) } },
      select: { id: true, email: true, fullName: true, isActive: true, lastLoginAt: true, totpEnabledAt: true },
    });
    const userBy = new Map(users.map((u) => [u.id, u]));
    const peopleBy = new Map(
      (await platformPrisma.userOrgMembership.groupBy({ by: ['orgId'], where: { accountId: id }, _count: true })).map((g) => [g.orgId, Number(g._count) || 0]),
    );
    const opUsers = await platformPrisma.user.findMany({ where: { id: { in: [...new Set(opEvents.map((e) => e.operatorUserId))] } }, select: { id: true, fullName: true } });
    const opName = new Map(opUsers.map((u) => [u.id, u.fullName]));
    res.json({
      account,
      members: members.map((m) => {
        const u = userBy.get(m.userId);
        return { userId: m.userId, role: m.role, status: m.status, since: m.createdAt, name: u?.fullName || null, email: u?.email || null, active: u?.isActive ?? false, lastLoginAt: u?.lastLoginAt || null, authenticator: Boolean(u?.totpEnabledAt) };
      }),
      companies: orgs.map((o) => ({ id: o.id, name: o.name, code: o.code, createdAt: o.createdAt, people: peopleBy.get(o.id) || 0 })),
      subscription: sub
        ? {
            status: sub.status,
            inGoodStanding: inGoodStanding(sub),
            trialEndsAt: sub.trialEndsAt,
            currentPeriodEnd: sub.currentPeriodEnd,
            gateway: sub.gatewayName,
            apps: sub.items.map((i) => i.appCode).sort(),
          }
        : null,
      securityEvents: events,
      operatorEvents: opEvents.map((e) => ({ ...e, operatorName: opName.get(e.operatorUserId) || null })),
    });
  }),
);

const reasonBody = z.object({ reason: z.string().trim().min(3).max(500) });

/** Stop every company in the account, for everybody, until reinstated. */
opsRouter.post('/ops/accounts/:id/suspend', requireOperatorRole('SUPPORT'), requireOperatorStepUp, (req, res) =>
  outsideTenant('ops: suspend account', async () => {
    const id = String(req.params.id);
    const parsed = reasonBody.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Say why, in a sentence.' });
    const a = await platformPrisma.account.findUnique({ where: { id }, select: { id: true, suspendedAt: true } });
    if (!a) return res.status(404).json({ error: 'No such account' });
    if (a.suspendedAt) return res.status(409).json({ error: 'Already suspended.' });
    await platformPrisma.account.update({ where: { id }, data: { suspendedAt: new Date(), suspendedReason: parsed.data.reason } });
    clearAccessCache();
    await audit(req, 'ACCOUNT_SUSPENDED', { accountId: id }, { reason: parsed.data.reason });
    res.json({ suspended: true });
  }),
);

opsRouter.post('/ops/accounts/:id/reinstate', requireOperatorRole('SUPPORT'), requireOperatorStepUp, (req, res) =>
  outsideTenant('ops: reinstate account', async () => {
    const id = String(req.params.id);
    const parsed = reasonBody.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Say why, in a sentence.' });
    const a = await platformPrisma.account.findUnique({ where: { id }, select: { id: true, suspendedAt: true } });
    if (!a) return res.status(404).json({ error: 'No such account' });
    if (!a.suspendedAt) return res.status(409).json({ error: 'Not suspended.' });
    await platformPrisma.account.update({ where: { id }, data: { suspendedAt: null, suspendedReason: null } });
    clearAccessCache();
    await audit(req, 'ACCOUNT_REINSTATED', { accountId: id }, { reason: parsed.data.reason });
    res.json({ suspended: false });
  }),
);

const trialBody = z.object({ days: z.number().int().min(1).max(90), reason: z.string().trim().min(3).max(500) });

/** Give a trial more days, from today or from its current end, whichever is later. */
opsRouter.post('/ops/accounts/:id/extend-trial', requireOperatorRole('BILLING'), requireOperatorStepUp, (req, res) =>
  outsideTenant('ops: extend trial', async () => {
    const id = String(req.params.id);
    const parsed = trialBody.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Between 1 and 90 days, and say why.' });
    const sub = await platformPrisma.subscription.findUnique({ where: { accountId: id }, select: { status: true, trialEndsAt: true } });
    if (!sub) return res.status(409).json({ error: 'This account has no subscription to extend. Grant a plan first.' });
    if (sub.status !== 'trialing') return res.status(409).json({ error: 'Only a trial can be extended.' });
    const from = Math.max(Date.now(), sub.trialEndsAt ? sub.trialEndsAt.getTime() : 0);
    const until = new Date(from + parsed.data.days * DAY);
    await platformPrisma.subscription.update({ where: { accountId: id }, data: { trialEndsAt: until } });
    clearAccessCache();
    await audit(req, 'TRIAL_EXTENDED', { accountId: id }, { from: sub.trialEndsAt, to: until, days: parsed.data.days, reason: parsed.data.reason });
    res.json({ trialEndsAt: until });
  }),
);

/** What every operator did, newest first. */
opsRouter.get('/ops/audit', (req, res) =>
  outsideTenant('ops: audit', async () => {
    const page = Math.max(0, Math.min(10_000, Number(req.query.page) || 0));
    const accountId = req.query.accountId ? String(req.query.accountId) : undefined;
    const rows = await platformPrisma.operatorAuditEvent.findMany({
      where: accountId ? { targetAccountId: accountId } : {},
      orderBy: { at: 'desc' },
      skip: page * 50,
      take: 51,
    });
    const people = await platformPrisma.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.operatorUserId))] } }, select: { id: true, fullName: true, email: true } });
    const who = new Map(people.map((p) => [p.id, p]));
    const accounts = await platformPrisma.account.findMany({ where: { id: { in: rows.map((r) => r.targetAccountId).filter(Boolean) as string[] } }, select: { id: true, name: true } });
    const acct = new Map(accounts.map((a) => [a.id, a.name]));
    res.json({
      hasMore: rows.length > 50,
      events: rows.slice(0, 50).map((r) => ({ ...r, operator: who.get(r.operatorUserId) || null, accountName: r.targetAccountId ? acct.get(r.targetAccountId) || null : null })),
    });
  }),
);

/* ------------------------------------------------------------- operators */

opsRouter.get('/ops/operators', requireOperatorRole(), (_req, res) =>
  outsideTenant('ops: operators', async () => {
    const rows = await platformPrisma.platformOperator.findMany({ orderBy: { createdAt: 'asc' }, include: { user: { select: { email: true, fullName: true, totpEnabledAt: true } } } });
    const boot = [...operatorUserIds()];
    const bootUsers = await platformPrisma.user.findMany({ where: { id: { in: boot } }, select: { id: true, email: true, fullName: true, totpEnabledAt: true } });
    res.json({
      bootstrap: bootUsers.map((u) => ({ userId: u.id, email: u.email, name: u.fullName, role: 'SUPER_ADMIN', authenticator: Boolean(u.totpEnabledAt) })),
      operators: rows.map((r) => ({ userId: r.userId, email: r.user.email, name: r.user.fullName, role: r.role, active: r.active, note: r.note, since: r.createdAt, authenticator: Boolean(r.user.totpEnabledAt) })),
    });
  }),
);

const addOperator = z.object({ email: z.string().trim().email(), role: z.enum(OPERATOR_ROLES as [string, ...string[]]), note: z.string().trim().max(200).optional() });

/** Make an existing Clor user an operator. Super admins only. */
opsRouter.post('/ops/operators', requireOperatorRole(), requireOperatorStepUp, (req, res) =>
  outsideTenant('ops: add operator', async () => {
    const parsed = addOperator.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'An email and a role.' });
    const users = await platformPrisma.user.findMany({ where: { email: { equals: parsed.data.email, mode: 'insensitive' }, isActive: true }, select: { id: true } });
    if (users.length !== 1) return res.status(404).json({ error: users.length ? 'More than one user has that email; ask engineering.' : 'Nobody signs in with that email. They need a Clor login first.' });
    const userId = users[0].id;
    const row = await platformPrisma.platformOperator.upsert({
      where: { userId },
      create: { userId, role: parsed.data.role, note: parsed.data.note, createdByUserId: req.auth!.userId },
      update: { role: parsed.data.role, active: true, note: parsed.data.note },
    });
    await audit(req, 'OPERATOR_ADDED', { userId }, { role: row.role });
    res.status(201).json({ operator: { userId, role: row.role, active: row.active } });
  }),
);

const changeOperator = z.object({ role: z.enum(OPERATOR_ROLES as [string, ...string[]]).optional(), active: z.boolean().optional() });

opsRouter.patch('/ops/operators/:userId', requireOperatorRole(), requireOperatorStepUp, (req, res) =>
  outsideTenant('ops: change operator', async () => {
    const userId = String(req.params.userId);
    if (userId === req.auth!.userId) return res.status(409).json({ error: 'Another super admin changes your own access.' });
    const parsed = changeOperator.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid change' });
    const before = await platformPrisma.platformOperator.findUnique({ where: { userId } });
    if (!before) return res.status(404).json({ error: 'Not an operator (bootstrap operators are changed in the server settings).' });
    const row = await platformPrisma.platformOperator.update({ where: { userId }, data: parsed.data });
    await audit(req, 'OPERATOR_CHANGED', { userId }, { before: { role: before.role, active: before.active }, after: { role: row.role, active: row.active } });
    res.json({ operator: { userId, role: row.role, active: row.active } });
  }),
);
