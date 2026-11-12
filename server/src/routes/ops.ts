import { Router } from 'express';
import type { Request } from 'express';
import { z } from 'zod';
import bcrypt from 'bcrypt';

import { requireAuth } from '../middleware/auth.js';
import { OPERATOR_ROLES, operatorUserIds, requireOperator, requireOperatorRole, requireOperatorToEnrol } from '../middleware/operator.js';
import { codeLimiter } from '../middleware/rateLimit.js';
import { decryptSecret, encryptSecret } from '../services/mailer.js';
import { newSecret, otpauthUri, recoveryCodes, verifyCode } from '../services/totp.js';
import { platformPrisma } from '../utils/platformPrisma.js';
import { accountsByPhone } from '../services/ops/phoneSearch.js';
import { outsideTenant } from '../utils/tenantScope.js';
import { clearAccessCache } from '../utils/accessCache.js';
import { clientIp, recordAuthEvent } from '../services/auth.js';
import { issueOperatorStepUp, requireOperatorStepUp } from '../services/stepUp.js';
import { getSubscription, inGoodStanding } from '../services/subscriptions.js';
import { useSecondFactor } from './security.js';
import { ensureLiveLineIndex, liveLineHealth } from '../services/payroll/liveLineIndex.js';
import { sendTemplate } from '../services/mailer.js';
import { operatorActionLabel } from '../constants/operatorActions.js';

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
  platformPrisma.user.findUnique({ where: { id: req.auth!.userId }, select: { id: true, email: true, totpSecretEnc: true, passwordHash: true } });

/* #12: the operator's password first, so a stolen access token cannot enrol the thief's authenticator and then pass every step-up. */
opsRouter.post('/ops/two-factor/setup', requireAuth, ...codeLimiter, requireOperatorToEnrol, async (req, res) => {
  const u = (await enrolling(req))!;
  if (!(await bcrypt.compare(String(req.body?.password || ''), u.passwordHash))) {
    await platformPrisma.operatorAuditEvent.create({ data: { operatorUserId: u.id, action: 'TWO_FACTOR_SETUP_REFUSED', ip: clientIp(req) ?? null } });
    return res.status(400).json({ error: 'Your password is not correct.', code: 'BAD_PASSWORD' });
  }
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

/** What an operator did, on the append-only record, and on the customer's own security log when it is about their account. */
export async function audit(req: Request, action: string, target: { accountId?: string | null; userId?: string | null }, detail?: unknown, opts: { customerLog?: boolean } = {}) {
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
  /* Support conversation is not a security event: tickets stay out of it (opts.customerLog false). */
  if (target.accountId && opts.customerLog !== false) {
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

/** Wrong step-up codes an operator may type in a window before the console stops taking them (#9). */
export const OPS_STEP_UP_MAX_FAILURES = 5;
export const OPS_STEP_UP_WINDOW_MIN = 15;

/**
 * A fresh authenticator code for fifteen minutes of changes (the console has no company to ask through).
 *
 * #9: this unlocks changes to every customer account, so a stolen operator
 * token must not be able to walk the six digits. The shared code limiter
 * counts every try; on top of that, five wrong codes in fifteen minutes stop
 * step-up for this operator until the window has passed — counted from the
 * append-only audit, so every API instance sees the same number — and the
 * lockout is written to the operator's sign-in log as well.
 */
opsRouter.post('/ops/step-up', ...codeLimiter, async (req, res) => {
  const u = await platformPrisma.user.findUnique({
    where: { id: req.auth!.userId },
    select: { id: true, accountId: true, totpSecretEnc: true, totpEnabledAt: true, totpLastStep: true, totpRecoveryJson: true },
  });
  if (!u?.totpEnabledAt || !u.totpSecretEnc) return res.status(400).json({ error: 'Set up an authenticator app first.', code: 'TWO_FACTOR_SETUP_REQUIRED' });
  const since = new Date(Date.now() - OPS_STEP_UP_WINDOW_MIN * 60_000);
  const failures = () => platformPrisma.operatorAuditEvent.count({ where: { operatorUserId: u.id, action: 'STEP_UP_FAILED', at: { gt: since } } });
  if ((await failures()) >= OPS_STEP_UP_MAX_FAILURES) {
    return res.status(429).json({ error: `Too many wrong codes. Wait ${OPS_STEP_UP_WINDOW_MIN} minutes, then try again.`, code: 'STEP_UP_LOCKED' });
  }
  const used = await useSecondFactor(u, String(req.body?.code || ''));
  if (!used) {
    await platformPrisma.operatorAuditEvent.create({ data: { operatorUserId: u.id, action: 'STEP_UP_FAILED', ip: clientIp(req) ?? null } });
    if ((await failures()) >= OPS_STEP_UP_MAX_FAILURES) {
      await platformPrisma.operatorAuditEvent.create({ data: { operatorUserId: u.id, action: 'STEP_UP_LOCKED', ip: clientIp(req) ?? null } });
      await recordAuthEvent({ accountId: u.accountId, userId: u.id, eventType: 'OPERATOR_STEP_UP_LOCKED', ip: clientIp(req), detail: `${OPS_STEP_UP_MAX_FAILURES} wrong codes in ${OPS_STEP_UP_WINDOW_MIN} minutes` });
      console.warn('[ops] operator step-up locked after repeated wrong codes', { operatorUserId: u.id, ip: clientIp(req) });
    }
    return res.status(400).json({ error: 'That code is not right, or has been used. Wait for the next one.', code: 'BAD_CODE' });
  }
  res.json(issueOperatorStepUp(u.id, req.auth!.sessionId));
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

/*
 * Data health: one live salary payment per payslip (review of #145, S3).
 * Whether the database index is built, and which companies have a payslip in
 * two live payments, by count only (no payroll figures leave the company).
 * The build is the follow-up once their owners have cancelled the extra
 * batch; it refuses while any clash is left.
 */
opsRouter.get('/ops/data-health/payroll-payments', (_req, res) =>
  outsideTenant('ops: payroll live payment index', async () => {
    const health = await liveLineHealth();
    const orgs = health.companies.length ? await platformPrisma.org.findMany({ where: { id: { in: health.companies } }, select: { id: true, name: true, accountId: true } }) : [];
    res.json({
      indexPresent: health.indexPresent,
      companies: orgs.map((o) => ({ orgId: o.id, accountId: o.accountId, name: o.name, payslips: health.clashes.filter((c) => c.orgId === o.id).length })),
    });
  }),
);

opsRouter.post('/ops/data-health/payroll-payments/build-index', requireOperatorRole('SUPPORT'), requireOperatorStepUp, (req, res) =>
  outsideTenant('ops: build payroll live payment index', async () => {
    const r = await ensureLiveLineIndex();
    await audit(req, 'PAYROLL_LIVE_LINE_INDEX', {}, { indexPresent: r.indexPresent, built: r.built, clashes: r.clashes.length });
    if (!r.indexPresent) {
      return res.status(409).json({
        error: r.clashes.length ? `Not built: ${r.clashes.length} payslip(s) are still in two live payments. Their companies cancel the extra batch first.` : 'Not built; the server log says why.',
        code: 'LIVE_LINES_CLASH',
        companies: [...new Set(r.clashes.map((c) => c.orgId))],
      });
    }
    res.json({ indexPresent: true, built: r.built });
  }),
);

const listQuery = z.object({
  q: z.string().trim().max(120).optional(),
  status: z.enum(['all', 'active', 'trialing', 'overdue', 'suspended', 'cancelled', 'no-plan']).optional(),
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
        /* Any code a customer might read out: the account's, any company's, any person's — and the ones from before the numbers. */
        { code: { contains: q, mode: 'insensitive' } },
        { legacyCode: { contains: q, mode: 'insensitive' } },
        { users: { some: { email: { contains: q, mode: 'insensitive' } } } },
        { users: { some: { OR: [{ code: { contains: q, mode: 'insensitive' } }, { legacyCode: { contains: q, mode: 'insensitive' } }] } } },
        { orgs: { some: { name: { contains: q, mode: 'insensitive' } } } },
        { orgs: { some: { OR: [{ code: { contains: q, mode: 'insensitive' } }, { legacyCode: { contains: q, mode: 'insensitive' } }] } } },
        /* A GSTIN or a phone number read out over the phone. */
        { orgs: { some: { branches: { some: { gstin: { contains: q, mode: 'insensitive' } } } } } },
      ];
      const byPhone = await accountsByPhone(q);
      if (byPhone.length) where.OR.push({ id: { in: byPhone } });
    }
    if (status === 'suspended') where.suspendedAt = { not: null };
    const accountsAll = await platformPrisma.account.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      select: { id: true, name: true, code: true, createdAt: true, suspendedAt: true, legacyUnrestrictedAt: true, orgs: { select: { name: true }, orderBy: { createdAt: 'asc' }, take: 1 }, _count: { select: { orgs: true, users: true } } },
    });
    const ids = accountsAll.map((a) => a.id);
    const [subs, owners, last] = await Promise.all([
      platformPrisma.subscription.findMany({ where: { accountId: { in: ids } }, select: { accountId: true, status: true, trialEndsAt: true, currentPeriodEnd: true, billingInterval: true, gatewayName: true, items: { select: { appCode: true } } } }),
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
        title: customerTitle(a.name, ownerBy.get(a.id)?.name, a.orgs[0]?.name),
        code: a.code,
        createdAt: a.createdAt,
        owner: ownerBy.get(a.id) || null,
        companies: a._count.orgs,
        users: a._count.users,
        plan,
        apps: s ? s.items.map((i) => i.appCode).sort() : [],
        trialEndsAt: s?.trialEndsAt || null,
        renewsAt: s?.currentPeriodEnd || null,
        interval: s?.billingInterval || null,
        byHand: s ? !s.gatewayName : false,
        lastActiveAt: lastBy.get(a.id) || null,
        suspended: Boolean(a.suspendedAt),
      };
    });
    if (status === 'active') rows = rows.filter((r) => r.plan === 'active' || r.plan === 'legacy');
    if (status === 'trialing') rows = rows.filter((r) => r.plan === 'trialing');
    if (status === 'no-plan') rows = rows.filter((r) => r.plan === 'no-plan');
    /* Overdue: payment is late, or a trial ran out without a plan. */
    if (status === 'overdue') rows = rows.filter((r) => r.plan === 'past_due' || (r.plan === 'trialing' && r.trialEndsAt && new Date(r.trialEndsAt).getTime() < Date.now()));
    if (status === 'cancelled') rows = rows.filter((r) => r.plan === 'cancelled');
    res.json({ total: rows.length, page, pageSize: PAGE, accounts: rows.slice(page * PAGE, page * PAGE + PAGE) });
  }),
);

/**
 * What a customer is called on the console: the business, not the person.
 * An account made without a company name was named after its owner, so when
 * the account name is just the owner's name the first company's name is used;
 * with neither, the owner's name.
 */
export function customerTitle(accountName: string | null | undefined, ownerName: string | null | undefined, firstCompany: string | null | undefined): string {
  const name = String(accountName || '').trim();
  const owner = String(ownerName || '').trim();
  if (name && name.toLowerCase() !== owner.toLowerCase()) return name;
  return String(firstCompany || '').trim() || name || owner || 'Unnamed customer';
}

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
      platformPrisma.org.findMany({
        where: { accountId: id },
        select: { id: true, name: true, code: true, createdAt: true, branches: { select: { id: true, branchName: true, branchCode: true, state: true }, orderBy: { createdAt: 'asc' } } },
        orderBy: { createdAt: 'asc' },
      }),
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
    const firstOwner = members.find((m) => m.role === 'OWNER');
    const ownerUser = firstOwner ? userBy.get(firstOwner.userId) : undefined;
    res.json({
      account: { ...account, title: customerTitle(account.name, ownerUser?.fullName, orgs[0]?.name), ownerName: ownerUser?.fullName || null },
      members: members.map((m) => {
        const u = userBy.get(m.userId);
        return { userId: m.userId, role: m.role, status: m.status, since: m.createdAt, name: u?.fullName || null, email: u?.email || null, active: u?.isActive ?? false, lastLoginAt: u?.lastLoginAt || null, authenticator: Boolean(u?.totpEnabledAt) };
      }),
      companies: orgs.map((o) => ({ id: o.id, name: o.name, code: o.code, createdAt: o.createdAt, people: peopleBy.get(o.id) || 0, branches: o.branches.map((b) => ({ id: b.id, name: b.branchName, code: b.branchCode, state: b.state })) })),
      lastActiveAt: users.reduce<Date | null>((m, u) => (u.lastLoginAt && (!m || u.lastLoginAt > m) ? u.lastLoginAt : m), null),
      subscription: sub
        ? {
            status: sub.status,
            inGoodStanding: inGoodStanding(sub),
            trialEndsAt: sub.trialEndsAt,
            currentPeriodStart: sub.currentPeriodStart,
            currentPeriodEnd: sub.currentPeriodEnd,
            billingInterval: sub.billingInterval,
            cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
            gateway: sub.gatewayName,
            createdAt: sub.createdAt,
            apps: sub.items.map((i) => i.appCode).sort(),
            items: sub.items.map((i) => ({ appCode: i.appCode, tier: i.tier, seats: i.seats, priceModel: i.priceModel })),
            /* The deal Finance set (routes/opsDeals.ts): the offer's price while it lasts, the list price after. */
            deal:
              (sub as any).periodAmount != null
                ? {
                    planName: (sub as any).planName,
                    unit: (sub as any).planUnit,
                    quantity: (sub as any).quantity,
                    listAmount: (sub as any).listAmount,
                    amount: (sub as any).offerEndsAt && (sub as any).offerEndsAt <= new Date() ? (sub as any).listAmount : (sub as any).periodAmount,
                    offerCode: (sub as any).offerCode,
                    offerEndsAt: (sub as any).offerEndsAt,
                  }
                : null,
          }
        : null,
      securityEvents: events,
      operatorEvents: opEvents.map((e) => ({ ...e, operatorName: opName.get(e.operatorUserId) || null })),
    });
  }),
);

const reasonBody = z.object({ reason: z.string().trim().min(3).max(500) });

/** Stop every company in the account, for everybody, until reinstated. */
opsRouter.post('/ops/accounts/:id/suspend', requireOperatorRole('SUPPORT', 'BILLING'), requireOperatorStepUp, (req, res) =>
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

opsRouter.post('/ops/accounts/:id/reinstate', requireOperatorRole('SUPPORT', 'BILLING'), requireOperatorStepUp, (req, res) =>
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
opsRouter.post('/ops/accounts/:id/extend-trial', requireOperatorRole('BILLING', 'SALES'), requireOperatorStepUp, (req, res) =>
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

/* ------------------------------------------------------------------ audit */

const auditQuery = z.object({
  operatorId: z.string().trim().max(64).optional(),
  action: z.string().trim().max(64).optional(),
  accountId: z.string().trim().max(64).optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  page: z.coerce.number().int().min(0).max(10_000).optional(),
});

/** The audit log's filters, as a where clause. Dates are whole days, India time. */
function auditWhere(q: z.infer<typeof auditQuery>) {
  const where: any = {};
  if (q.operatorId) where.operatorUserId = q.operatorId;
  if (q.action) where.action = q.action;
  if (q.accountId) where.targetAccountId = q.accountId;
  if (q.from || q.to) {
    where.at = {};
    if (q.from) where.at.gte = new Date(`${q.from}T00:00:00+05:30`);
    if (q.to) where.at.lt = new Date(new Date(`${q.to}T00:00:00+05:30`).getTime() + DAY);
  }
  return where;
}

/** Names for the people and accounts a page of audit rows mentions. */
async function auditNames(rows: { operatorUserId: string; targetAccountId: string | null; targetUserId: string | null }[]) {
  const userIds = [...new Set(rows.flatMap((r) => [r.operatorUserId, r.targetUserId]).filter(Boolean) as string[])];
  const [people, accounts] = await Promise.all([
    platformPrisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, fullName: true, email: true } }),
    platformPrisma.account.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.targetAccountId).filter(Boolean) as string[])] } }, select: { id: true, name: true } }),
  ]);
  const who = new Map<string, { id: string; fullName: string | null; email: string }>(people.map((p) => [p.id, p]));
  /* Jobs that act on their own (billing/renewals.ts) write as SYSTEM_OPERATOR. */
  who.set(SYSTEM_OPERATOR, { id: SYSTEM_OPERATOR, fullName: 'CLOR, automatically', email: '' });
  return { who, acct: new Map(accounts.map((a) => [a.id, a.name])) };
}

/** The operator id a job writes in the audit log when no person acted. */
export const SYSTEM_OPERATOR = 'system';

/** The one line a person reads for what was done: the reason if one was given, else the change. */
export function auditSummary(detail: any): string {
  if (!detail || typeof detail !== 'object') return '';
  if (detail.reason) return String(detail.reason);
  if (detail.note) return String(detail.note);
  const parts: string[] = [];
  for (const [k, v] of Object.entries(detail)) {
    if (v == null || typeof v === 'object') continue;
    parts.push(`${k}: ${v}`);
  }
  return parts.join(', ').slice(0, 300);
}

/** What every operator did, newest first, by operator, action, customer and date. */
opsRouter.get('/ops/audit', (req, res) =>
  outsideTenant('ops: audit', async () => {
    const parsed = auditQuery.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: 'Those filters are not right.' });
    const page = parsed.data.page || 0;
    const rows = await platformPrisma.operatorAuditEvent.findMany({ where: auditWhere(parsed.data), orderBy: { at: 'desc' }, skip: page * 50, take: 51 });
    const { who, acct } = await auditNames(rows);
    res.json({
      hasMore: rows.length > 50,
      events: rows.slice(0, 50).map((r) => ({
        ...r,
        label: operatorActionLabel(r.action),
        summary: auditSummary(r.detail),
        operator: who.get(r.operatorUserId) || null,
        targetUser: r.targetUserId ? who.get(r.targetUserId) || null : null,
        accountName: r.targetAccountId ? acct.get(r.targetAccountId) || null : null,
      })),
    });
  }),
);

/** The choices for the audit log's filters: every operator who acted, every action recorded. */
opsRouter.get('/ops/audit/filters', (_req, res) =>
  outsideTenant('ops: audit filters', async () => {
    const [ops, actions] = await Promise.all([
      platformPrisma.operatorAuditEvent.groupBy({ by: ['operatorUserId'], _count: true }),
      platformPrisma.operatorAuditEvent.groupBy({ by: ['action'], _count: true }),
    ]);
    const people = await platformPrisma.user.findMany({ where: { id: { in: ops.map((o) => o.operatorUserId) } }, select: { id: true, fullName: true, email: true } });
    res.json({
      operators: people.map((p) => ({ id: p.id, name: p.fullName || p.email })).sort((a, b) => a.name.localeCompare(b.name)),
      actions: actions.map((a) => ({ action: a.action, label: operatorActionLabel(a.action) })).sort((a, b) => a.label.localeCompare(b.label)),
    });
  }),
);

const csvCell = (v: unknown) => {
  const s = v == null ? '' : String(v);
  /* A leading = + - @ is a formula to a spreadsheet: keep it text. */
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

/** The audit log, as filtered, as a CSV file (up to 10,000 lines). Downloading it is itself recorded. */
opsRouter.get('/ops/audit/export', (req, res) =>
  outsideTenant('ops: audit export', async () => {
    const parsed = auditQuery.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: 'Those filters are not right.' });
    const rows = await platformPrisma.operatorAuditEvent.findMany({ where: auditWhere(parsed.data), orderBy: { at: 'desc' }, take: 10_000 });
    const { who, acct } = await auditNames(rows);
    const lines = [['When (UTC)', 'Staff member', 'Staff email', 'What they did', 'Action code', 'Customer', 'Customer ID', 'Person', 'Detail', 'IP address'].join(',')];
    for (const r of rows) {
      const op = who.get(r.operatorUserId);
      const target = r.targetUserId ? who.get(r.targetUserId) : null;
      lines.push(
        [r.at.toISOString(), op?.fullName || '', op?.email || r.operatorUserId, operatorActionLabel(r.action), r.action, r.targetAccountId ? acct.get(r.targetAccountId) || '' : '', r.targetAccountId || '', target?.email || '', auditSummary(r.detail), r.ip || '']
          .map(csvCell)
          .join(','),
      );
    }
    await audit(req, 'AUDIT_EXPORTED', {}, { rows: rows.length, filters: parsed.data });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="clor-audit-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.send(`﻿${lines.join('\r\n')}\r\n`);
  }),
);

/* ------------------------------------------------------------------ home */

/** Today's numbers, each a way into its list. */
opsRouter.get('/ops/home', (_req, res) =>
  outsideTenant('ops: home', async () => {
    const now = Date.now();
    const startOfDay = new Date(`${new Date(now + 5.5 * 3_600_000).toISOString().slice(0, 10)}T00:00:00+05:30`);
    const weekAgo = new Date(now - 7 * DAY);
    const [newDemos, demosToday, trialsEnding, failedPayments, failedEmails, suspended, overdue, alertsOpen, alertsCritical, ticketsOpen] = await Promise.all([
      platformPrisma.demoRequest.count({ where: { status: 'NEW' } }),
      platformPrisma.demoRequest.count({ where: { createdAt: { gte: startOfDay } } }),
      platformPrisma.subscription.count({ where: { status: 'trialing', trialEndsAt: { gte: new Date(now), lte: new Date(now + 7 * DAY) } } }),
      /* A payment the gateway told us about that could not be applied, this week. */
      platformPrisma.paymentEvent.count({ where: { processed: false, receivedAt: { gte: weekAgo } } }),
      platformPrisma.emailOutbox.count({ where: { status: 'FAILED', createdAt: { gte: weekAgo } } }),
      platformPrisma.account.count({ where: { suspendedAt: { not: null } } }),
      platformPrisma.subscription.count({ where: { OR: [{ status: 'past_due' }, { status: 'trialing', trialEndsAt: { lt: new Date(now) } }] } }),
      platformPrisma.opsAlert.count({ where: { resolvedAt: null } }),
      platformPrisma.opsAlert.count({ where: { resolvedAt: null, severity: 'critical' } }),
      platformPrisma.supportTicket.count({ where: { status: 'OPEN' } }),
    ]);
    res.json({ newDemos, demosToday, trialsEnding, failedPayments, failedEmails, suspended, overdue, alertsOpen, alertsCritical, ticketsOpen });
  }),
);

/* ------------------------------------------------------------- operators */

/** Who works on the console, and who has been invited and not come in yet. Owners only. */
opsRouter.get('/ops/operators', requireOperatorRole(), (_req, res) =>
  outsideTenant('ops: operators', async () => {
    const rows = await platformPrisma.platformOperator.findMany({ orderBy: { createdAt: 'asc' }, include: { user: { select: { email: true, fullName: true, totpEnabledAt: true, lastLoginAt: true } } } });
    const boot = [...operatorUserIds()];
    const bootUsers = await platformPrisma.user.findMany({ where: { id: { in: boot } }, select: { id: true, email: true, fullName: true, totpEnabledAt: true, lastLoginAt: true } });
    const invites = await platformPrisma.operatorInvite.findMany({ where: { claimedAt: null, revokedAt: null }, orderBy: { createdAt: 'desc' } });
    res.json({
      bootstrap: bootUsers.map((u) => ({ userId: u.id, email: u.email, name: u.fullName, role: 'SUPER_ADMIN', authenticator: Boolean(u.totpEnabledAt), lastLoginAt: u.lastLoginAt })),
      operators: rows
        .filter((r) => !boot.includes(r.userId))
        .map((r) => ({ userId: r.userId, email: r.user.email, name: r.user.fullName, role: r.role, active: r.active, note: r.note, since: r.createdAt, authenticator: Boolean(r.user.totpEnabledAt), lastLoginAt: r.user.lastLoginAt })),
      invites: invites.map((i) => ({ id: i.id, email: i.email, role: i.role, note: i.note, since: i.createdAt })),
    });
  }),
);

const reasonField = z.string().trim().max(500).optional();
const addOperator = z.object({ email: z.string().trim().email(), role: z.enum(OPERATOR_ROLES as [string, ...string[]]), note: z.string().trim().max(200).optional(), reason: reasonField });
const OPS_URL = () => (process.env.OPS_URL || 'https://ops.clor.in').replace(/\/$/, '');
const ROLE_WORDS: Record<string, string> = { SUPER_ADMIN: 'Owner', SALES: 'Sales', SUPPORT: 'Support', BILLING: 'Finance', READ_ONLY: 'Read-only' };

/**
 * Invite a staff member by email. Owners only. Somebody who already signs in
 * to CLOR with that address is an operator at once; anybody else gets an
 * invitation, and becomes one the first time they open the console with that
 * address, confirmed. Either way they set up an authenticator before it opens.
 */
opsRouter.post('/ops/operators', requireOperatorRole(), requireOperatorStepUp, (req, res) =>
  outsideTenant('ops: add operator', async () => {
    const parsed = addOperator.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'An email and a role.' });
    const email = parsed.data.email.toLowerCase();
    const inviter = await platformPrisma.user.findUnique({ where: { id: req.auth!.userId }, select: { fullName: true, email: true } });
    const users = await platformPrisma.user.findMany({ where: { email: { equals: email, mode: 'insensitive' }, isActive: true }, select: { id: true } });
    if (users.length > 1) return res.status(409).json({ error: 'More than one login uses that email. Ask engineering which one is the staff member.' });
    const mail = (invited: boolean) =>
      sendTemplate({
        templateKey: 'ops.staff_invited',
        to: email,
        transactional: true,
        relatedType: 'OperatorInvite',
        data: {
          inviterName: inviter?.fullName || inviter?.email || 'The CLOR owner',
          role: ROLE_WORDS[parsed.data.role] || parsed.data.role,
          opsUrl: OPS_URL(),
          firstStep: invited
            ? `First make your CLOR login with this address at ${(process.env.APP_URL || 'https://app.clor.in').replace(/\/$/, '')} and confirm it from the email we send.`
            : 'You already have a CLOR login with this address; use it.',
        },
      }).catch(() => null);
    if (users.length === 1) {
      const userId = users[0].id;
      const row = await platformPrisma.platformOperator.upsert({
        where: { userId },
        create: { userId, role: parsed.data.role, note: parsed.data.note, createdByUserId: req.auth!.userId },
        update: { role: parsed.data.role, active: true, note: parsed.data.note },
      });
      await platformPrisma.operatorInvite.updateMany({ where: { email, claimedAt: null, revokedAt: null }, data: { claimedAt: new Date(), claimedByUserId: userId } });
      await audit(req, 'OPERATOR_ADDED', { userId }, { email, role: row.role, reason: parsed.data.reason || undefined });
      await mail(false);
      return res.status(201).json({ operator: { userId, role: row.role, active: row.active } });
    }
    const invite = await platformPrisma.operatorInvite.upsert({
      where: { email },
      create: { email, role: parsed.data.role, note: parsed.data.note, invitedByUserId: req.auth!.userId },
      update: { role: parsed.data.role, note: parsed.data.note, invitedByUserId: req.auth!.userId, claimedAt: null, claimedByUserId: null, revokedAt: null },
    });
    await audit(req, 'OPERATOR_INVITED', {}, { email, role: invite.role, reason: parsed.data.reason || undefined });
    await mail(true);
    res.status(201).json({ invite: { id: invite.id, email, role: invite.role } });
  }),
);

/** Withdraw an invitation nobody has taken up. */
opsRouter.delete('/ops/operators/invites/:id', requireOperatorRole(), requireOperatorStepUp, (req, res) =>
  outsideTenant('ops: withdraw operator invite', async () => {
    const id = String(req.params.id);
    const done = await platformPrisma.operatorInvite.updateMany({ where: { id, claimedAt: null, revokedAt: null }, data: { revokedAt: new Date() } });
    if (!done.count) return res.status(404).json({ error: 'That invitation has already been taken up or withdrawn.' });
    const row = await platformPrisma.operatorInvite.findUnique({ where: { id }, select: { email: true } });
    await audit(req, 'OPERATOR_INVITE_REVOKED', {}, { email: row?.email, reason: typeof req.body?.reason === 'string' ? req.body.reason.slice(0, 500) : undefined });
    res.json({ withdrawn: true });
  }),
);

const changeOperator = z.object({ role: z.enum(OPERATOR_ROLES as [string, ...string[]]).optional(), active: z.boolean().optional(), reason: reasonField });

opsRouter.patch('/ops/operators/:userId', requireOperatorRole(), requireOperatorStepUp, (req, res) =>
  outsideTenant('ops: change operator', async () => {
    const userId = String(req.params.userId);
    if (userId === req.auth!.userId) return res.status(409).json({ error: 'Another owner changes your own access.' });
    const parsed = changeOperator.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid change' });
    const before = await platformPrisma.platformOperator.findUnique({ where: { userId } });
    if (!before) return res.status(404).json({ error: 'Not an operator (bootstrap operators are changed in the server settings).' });
    const { reason, ...data } = parsed.data;
    const row = await platformPrisma.platformOperator.update({ where: { userId }, data });
    await audit(req, 'OPERATOR_CHANGED', { userId }, { before: { role: before.role, active: before.active }, after: { role: row.role, active: row.active }, reason: reason || undefined });
    res.json({ operator: { userId, role: row.role, active: row.active } });
  }),
);

/** Take somebody off the console. Their CLOR login stays; the console is closed to them at once. */
opsRouter.delete('/ops/operators/:userId', requireOperatorRole(), requireOperatorStepUp, (req, res) =>
  outsideTenant('ops: remove operator', async () => {
    const userId = String(req.params.userId);
    if (userId === req.auth!.userId) return res.status(409).json({ error: 'Another owner removes you, not you.' });
    if (operatorUserIds().has(userId)) return res.status(409).json({ error: 'This owner is set by engineering in the server settings; ask them to remove it.' });
    const before = await platformPrisma.platformOperator.findUnique({ where: { userId }, include: { user: { select: { email: true } } } });
    if (!before) return res.status(404).json({ error: 'Not on the staff list.' });
    await platformPrisma.platformOperator.delete({ where: { userId } });
    await audit(req, 'OPERATOR_REMOVED', { userId }, { email: before.user.email, role: before.role, reason: typeof req.body?.reason === 'string' ? req.body.reason.slice(0, 500) : undefined });
    res.json({ removed: true });
  }),
);
