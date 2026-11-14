import { Router } from 'express';
import { z } from 'zod';

import { requireAuth } from '../middleware/auth.js';
import { requireOperator } from '../middleware/operator.js';
import { platformPrisma } from '../utils/platformPrisma.js';
import { outsideTenant } from '../utils/tenantScope.js';
import { appAccess, appStanding, getSubscription } from '../services/subscriptions.js';
import { appOfFeature, splitKeys } from '../services/entitlements.js';
import { pruneDenials } from '../services/ops/denials.js';
import { FEATURE_CATALOG } from '../constants/featureCatalog.js';
import { APP_CATALOG, SELLABLE_APP_CODES, appByCode } from '../constants/appCatalog.js';
import { customerTitle } from './ops.js';

/**
 * The operator console's lists across every account (R&D OPS-05, 06, 08, 09
 * and the account page's seats and denials, CLOR-06): every company, every
 * person who can sign in, every refusal the platform made, and every
 * switchable feature with who has it.
 *
 * Read-only, so no reason and no step-up: the same CLOR-staff gate as the
 * console's other pages (an authenticator is required to be here at all).
 * Account metadata only — never a password hash, an authenticator secret,
 * recovery codes, or anything inside a customer's books, people or payroll.
 * Every list is paged.
 */
export const opsListsRouter = Router();
opsListsRouter.use(['/ops/organisations', '/ops/users', '/ops/denials', '/ops/feature-switches', '/ops/accounts/:id/entitlements'], requireAuth, requireOperator);

const PAGE = 50;
const DAY = 86_400_000;
const page = z.coerce.number().int().min(0).max(10_000).optional();
const text = z.string().trim().max(120).optional();
const id = z.string().trim().max(64).optional();

/** Customers by the name the console shows them under (as on Accounts). */
async function accountTitles(ids: string[]) {
  const list = [...new Set(ids.filter(Boolean))];
  if (!list.length) return new Map<string, { name: string; code: string | null; suspended: boolean }>();
  const [rows, owners] = await Promise.all([
    platformPrisma.account.findMany({ where: { id: { in: list } }, select: { id: true, name: true, code: true, suspendedAt: true, orgs: { select: { name: true }, orderBy: { createdAt: 'asc' }, take: 1 } } }),
    platformPrisma.accountMembership.findMany({ where: { accountId: { in: list }, role: 'OWNER' }, select: { accountId: true, userId: true }, orderBy: { createdAt: 'asc' } }),
  ]);
  const users = owners.length ? await platformPrisma.user.findMany({ where: { id: { in: owners.map((o) => o.userId) } }, select: { id: true, fullName: true } }) : [];
  const fullName = new Map(users.map((u) => [u.id, u.fullName]));
  const owner = new Map<string, string | undefined>();
  for (const o of owners) if (!owner.has(o.accountId)) owner.set(o.accountId, fullName.get(o.userId));
  return new Map(rows.map((r) => [r.id, { name: customerTitle(r.name, owner.get(r.id), r.orgs[0]?.name), code: r.code, suspended: Boolean(r.suspendedAt) }]));
}

/* ----------------------------------------------------------- organisations */
const orgQuery = z.object({ q: text, account: id, status: z.enum(['all', 'active', 'archived', 'suspended']).optional(), page });
const APP_KEYS = ['people', 'attendance', 'payroll'] as const;

/** Every company across every account: its account, GSTIN, apps on, members and state. */
opsListsRouter.get('/ops/organisations', (req, res) =>
  outsideTenant('ops: organisations', async () => {
    const parsed = orgQuery.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid query' });
    const { q = '', account, status = 'all', page: p = 0 } = parsed.data;
    const where: any = {};
    if (account) where.accountId = account;
    if (q) {
      where.OR = [
        { name: { contains: q, mode: 'insensitive' } },
        { legalName: { contains: q, mode: 'insensitive' } },
        { code: { contains: q, mode: 'insensitive' } },
        { legacyCode: { contains: q, mode: 'insensitive' } },
        { id: q },
        { branches: { some: { gstin: { contains: q, mode: 'insensitive' } } } },
        { account: { name: { contains: q, mode: 'insensitive' } } },
      ];
    }
    if (status === 'archived') where.archivedAt = { not: null };
    if (status === 'active') Object.assign(where, { archivedAt: null, account: { ...(where.account || {}), suspendedAt: null } });
    if (status === 'suspended') where.account = { suspendedAt: { not: null } };
    const [total, orgs] = await Promise.all([
      platformPrisma.org.count({ where }),
      platformPrisma.org.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: p * PAGE,
        take: PAGE,
        select: {
          id: true,
          name: true,
          code: true,
          accountId: true,
          createdAt: true,
          archivedAt: true,
          branches: { select: { gstin: true }, orderBy: { createdAt: 'asc' } },
          _count: { select: { members: true, branches: true } },
        },
      }),
    ]);
    const accountIds = [...new Set(orgs.map((o) => o.accountId))];
    const [titles, switches, access] = await Promise.all([
      accountTitles(accountIds),
      platformPrisma.featureSetting.findMany({ where: { orgId: { in: orgs.map((o) => o.id) }, key: { in: [...APP_KEYS] } }, select: { orgId: true, key: true, enabled: true } }),
      Promise.all(accountIds.map(async (a) => [a, await appAccess(a)] as const)),
    ]);
    const ownedBy = new Map(access.map(([a, x]) => [a, x.ownedApps]));
    const switchBy = new Map(switches.map((s) => [`${s.orgId}|${s.key}`, s.enabled]));
    const defaultOn = (k: string) => FEATURE_CATALOG.find((f) => f.key === k)?.defaultEnabled ?? false;
    res.json({
      total,
      page: p,
      pageSize: PAGE,
      organisations: orgs.map((o) => {
        const owned = ownedBy.get(o.accountId) || [];
        /* Apps on: owned by the account and switched on in this company (Accounting has no switch). */
        const apps = ['accounting', ...APP_KEYS].filter((k) => owned.includes(k) && (k === 'accounting' || (switchBy.get(`${o.id}|${k}`) ?? defaultOn(k))));
        const gstins = [...new Set(o.branches.map((b) => b.gstin).filter(Boolean))] as string[];
        /* The first branch is the head office (made with the company). */
        const head = o.branches[0]?.gstin || gstins[0] || null;
        const acct = titles.get(o.accountId);
        return {
          id: o.id,
          name: o.name,
          code: o.code,
          createdAt: o.createdAt,
          account: { id: o.accountId, name: acct?.name || 'A customer', code: acct?.code || null },
          gstin: head,
          otherGstins: Math.max(0, gstins.length - (head ? 1 : 0)),
          branches: o._count.branches,
          members: o._count.members,
          apps,
          status: o.archivedAt ? 'archived' : acct?.suspended ? 'suspended' : 'active',
        };
      }),
    });
  }),
);

/* ------------------------------------------------------------------ users */
const userQuery = z.object({
  q: text,
  account: id,
  status: z.enum(['all', 'active', 'locked', 'deactivated', 'never']).optional(),
  signIn: z.enum(['all', 'twofactor', 'password', 'sso']).optional(),
  page,
});
const ROLE_RANK = ['OWNER', 'ADMIN', 'BILLING_ADMIN', 'MEMBER'];

/** Every person who can sign in, across accounts: their accounts and companies, highest role, how they sign in, when last, and their state. */
opsListsRouter.get('/ops/users', (req, res) =>
  outsideTenant('ops: users', async () => {
    const parsed = userQuery.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid query' });
    const { q = '', account, status = 'all', signIn = 'all', page: p = 0 } = parsed.data;
    const now = new Date();
    const and: any[] = [];
    if (q) and.push({ OR: [{ email: { contains: q, mode: 'insensitive' } }, { fullName: { contains: q, mode: 'insensitive' } }, { code: { contains: q, mode: 'insensitive' } }, { id: q }] });
    if (account) {
      const members = await platformPrisma.accountMembership.findMany({ where: { accountId: account }, select: { userId: true } });
      and.push({ OR: [{ accountId: account }, { id: { in: members.map((m) => m.userId) } }] });
    }
    if (status === 'active') and.push({ isActive: true, OR: [{ lockedUntil: null }, { lockedUntil: { lte: now } }] });
    if (status === 'locked') and.push({ lockedUntil: { gt: now } });
    if (status === 'deactivated') and.push({ isActive: false });
    if (status === 'never') and.push({ lastLoginAt: null });
    if (signIn === 'twofactor') and.push({ totpEnabledAt: { not: null } });
    if (signIn === 'password') and.push({ totpEnabledAt: null });
    if (signIn === 'sso') {
      const sso = await platformPrisma.authEvent.findMany({ where: { eventType: 'LOGIN_SUCCESS', detail: { startsWith: 'SSO ' } }, distinct: ['userId'], select: { userId: true }, take: 5000 });
      and.push({ id: { in: sso.map((e) => e.userId).filter(Boolean) as string[] } });
    }
    const where = and.length ? { AND: and } : {};
    const [total, users] = await Promise.all([
      platformPrisma.user.count({ where }),
      /* Named fields only: never the password hash, the authenticator secret or recovery codes. */
      platformPrisma.user.findMany({
        where,
        orderBy: [{ lastLoginAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
        skip: p * PAGE,
        take: PAGE,
        select: { id: true, fullName: true, email: true, code: true, accountId: true, isActive: true, leftAt: true, lockedUntil: true, lastLoginAt: true, totpEnabledAt: true, emailVerifiedAt: true, createdAt: true, platformOperator: { select: { role: true } } },
      }),
    ]);
    const ids = users.map((u) => u.id);
    const [memberships, companies, logins] = await Promise.all([
      platformPrisma.accountMembership.findMany({ where: { userId: { in: ids } }, select: { userId: true, accountId: true, role: true, status: true } }),
      platformPrisma.userOrgMembership.groupBy({ by: ['userId'], where: { userId: { in: ids } }, _count: true }),
      platformPrisma.authEvent.findMany({ where: { userId: { in: ids }, eventType: 'LOGIN_SUCCESS' }, orderBy: { createdAt: 'desc' }, distinct: ['userId'], select: { userId: true, detail: true } }),
    ]);
    const titles = await accountTitles([...memberships.map((m) => m.accountId), ...users.map((u) => u.accountId)]);
    const companiesBy = new Map(companies.map((c) => [c.userId, Number(c._count) || 0]));
    const loginBy = new Map(logins.map((l) => [l.userId, l.detail]));
    res.json({
      total,
      page: p,
      pageSize: PAGE,
      users: users.map((u) => {
        const mine = memberships.filter((m) => m.userId === u.id);
        const live = mine.filter((m) => m.status !== 'SUSPENDED');
        const roles = (live.length ? live : mine).map((m) => m.role);
        const highest = ROLE_RANK.find((r) => roles.includes(r)) || roles[0] || null;
        const last = loginBy.get(u.id) || '';
        const method = last.startsWith('SSO ') ? 'sso' : 'password';
        const state = !u.isActive
          ? u.leftAt
            ? 'left'
            : 'deactivated'
          : u.lockedUntil && u.lockedUntil > now
            ? 'locked'
            : mine.length && !live.length
              ? 'suspended'
              : !mine.length
                ? 'no-membership'
                : !u.lastLoginAt
                  ? 'never'
                  : 'active';
        return {
          id: u.id,
          name: u.fullName,
          email: u.email,
          code: u.code,
          accounts: (mine.length ? mine.map((m) => m.accountId) : [u.accountId]).map((a) => ({ id: a, name: titles.get(a)?.name || 'A customer' })),
          companies: companiesBy.get(u.id) || 0,
          role: highest,
          signIn: { method, provider: method === 'sso' ? last.slice(4).trim() || null : null, twoFactor: Boolean(u.totpEnabledAt) },
          lastLoginAt: u.lastLoginAt,
          createdAt: u.createdAt,
          staff: u.platformOperator?.role || null,
          status: state,
        };
      }),
    });
  }),
);

/* ---------------------------------------------------------------- denials */
const SINCE = { hour: 3_600_000, day: DAY, week: 7 * DAY, month: 30 * DAY } as const;
const denialQuery = z.object({
  q: text,
  code: z.string().trim().max(64).optional(),
  app: z.string().trim().max(32).optional(),
  since: z.enum(['hour', 'day', 'week', 'month']).optional(),
  account: id,
  page,
});

/**
 * Every refusal the platform made (services/ops/denials.ts), newest first:
 * who, which company, the reason code and the request id, with today's
 * counts by reason above. Search a person, a company or a correlation id.
 */
opsListsRouter.get('/ops/denials', (req, res) =>
  outsideTenant('ops: entitlement denials', async () => {
    const parsed = denialQuery.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid query' });
    const { q = '', code, app, since = 'day', account, page: p = 0 } = parsed.data;
    const now = Date.now();
    await pruneDenials(now);
    const where: any = { createdAt: { gte: new Date(now - SINCE[since]) } };
    if (code) where.code = code;
    if (app) where.app = app;
    if (account) where.accountId = account;
    if (q) {
      const [people, orgs] = await Promise.all([
        platformPrisma.user.findMany({ where: { OR: [{ email: { contains: q, mode: 'insensitive' } }, { fullName: { contains: q, mode: 'insensitive' } }] }, select: { id: true }, take: 200 }),
        platformPrisma.org.findMany({ where: { OR: [{ name: { contains: q, mode: 'insensitive' } }, { code: { contains: q, mode: 'insensitive' } }] }, select: { id: true }, take: 200 }),
      ]);
      where.OR = [{ requestId: { contains: q, mode: 'insensitive' } }, { userId: { in: people.map((u) => u.id) } }, { orgId: { in: orgs.map((o) => o.id) } }, { code: { contains: q, mode: 'insensitive' } }];
    }
    const startOfDay = new Date(now - (now % DAY));
    const [total, rows, today, codes] = await Promise.all([
      platformPrisma.entitlementDenial.count({ where }),
      platformPrisma.entitlementDenial.findMany({ where, orderBy: { createdAt: 'desc' }, skip: p * PAGE, take: PAGE }),
      platformPrisma.entitlementDenial.groupBy({ by: ['code'], where: { createdAt: { gte: startOfDay }, ...(account ? { accountId: account } : {}) }, _count: { _all: true } }),
      platformPrisma.entitlementDenial.groupBy({ by: ['code'], _count: { _all: true } }),
    ]);
    const [people, orgs] = await Promise.all([
      platformPrisma.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.userId).filter(Boolean))] as string[] } }, select: { id: true, fullName: true, email: true } }),
      platformPrisma.org.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.orgId).filter(Boolean))] as string[] } }, select: { id: true, name: true } }),
    ]);
    const titles = await accountTitles(rows.map((r) => r.accountId).filter(Boolean) as string[]);
    const personBy = new Map(people.map((u) => [u.id, u]));
    const orgBy = new Map(orgs.map((o) => [o.id, o.name]));
    const byCode = Object.fromEntries(today.map((t) => [t.code, t._count._all]));
    res.json({
      total,
      page: p,
      pageSize: PAGE,
      today: { total: today.reduce((n, t) => n + t._count._all, 0), byCode },
      codes: codes.map((c) => c.code).sort(),
      denials: rows.map((r) => {
        const who = r.userId ? personBy.get(r.userId) : null;
        return {
          id: r.id,
          at: r.createdAt,
          who: who ? { id: who.id, name: who.fullName, email: who.email } : null,
          account: r.accountId ? { id: r.accountId, name: titles.get(r.accountId)?.name || 'A customer' } : null,
          org: r.orgId ? { id: r.orgId, name: orgBy.get(r.orgId) || null } : null,
          code: r.code,
          status: r.status,
          app: r.app,
          feature: r.feature,
          method: r.method,
          route: r.route,
          requestId: r.requestId,
        };
      }),
    });
  }),
);

/* --------------------------------------------------------- feature switches */
const switchQuery = z.object({ q: text, app: z.string().trim().max(32).optional(), changed: z.enum(['all', 'changed']).optional(), page });

/**
 * Every switchable feature, across accounts: who gets it by default, which
 * accounts CLOR added it for or turned it off for (set per account on the
 * account's Limits tab, with a reason), and how many companies switched it
 * on or off for themselves. Changing one stays on the account's Limits tab.
 */
opsListsRouter.get('/ops/feature-switches', (req, res) =>
  outsideTenant('ops: feature switches', async () => {
    const parsed = switchQuery.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid query' });
    const { q = '', app, changed = 'all', page: p = 0 } = parsed.data;
    const [rows, settings] = await Promise.all([
      platformPrisma.accountEntitlement.findMany({ where: { OR: [{ extraFeatures: { not: '' } }, { removedFeatures: { not: '' } }] }, select: { accountId: true, extraFeatures: true, removedFeatures: true } }),
      platformPrisma.featureSetting.groupBy({ by: ['key', 'enabled'], _count: { _all: true } }),
    ]);
    const added = new Map<string, string[]>();
    const removed = new Map<string, string[]>();
    for (const r of rows) {
      for (const k of splitKeys(r.extraFeatures)) added.set(k, [...(added.get(k) || []), r.accountId]);
      for (const k of splitKeys(r.removedFeatures)) removed.set(k, [...(removed.get(k) || []), r.accountId]);
    }
    const companies = new Map<string, { on: number; off: number }>();
    for (const s of settings) {
      const c = companies.get(s.key) || { on: 0, off: 0 };
      if (s.enabled) c.on += s._count._all;
      else c.off += s._count._all;
      companies.set(s.key, c);
    }
    const needle = q.toLowerCase();
    let list = FEATURE_CATALOG.map((f) => {
      const a = appOfFeature(f.key) || 'accounting';
      return { f, app: a, appSwitch: Boolean(APP_CATALOG.find((x) => x.featureKey === f.key)) };
    });
    if (needle) list = list.filter(({ f }) => f.key.toLowerCase().includes(needle) || f.label.toLowerCase().includes(needle) || f.description.toLowerCase().includes(needle));
    if (app) list = list.filter((x) => x.app === app);
    if (changed === 'changed') list = list.filter(({ f }) => added.has(f.key) || removed.has(f.key));
    const shown = list.slice(p * 100, p * 100 + 100);
    const named = await accountTitles([...new Set(shown.flatMap(({ f }) => [...(added.get(f.key) || []), ...(removed.get(f.key) || [])]))]);
    const accounts = (ids: string[] = []) => ids.slice(0, 20).map((a) => ({ id: a, name: named.get(a)?.name || 'A customer' }));
    res.json({
      total: list.length,
      page: p,
      pageSize: 100,
      accountsChanged: rows.length,
      switches: shown.map(({ f, app: a, appSwitch }) => ({
        key: f.key,
        label: f.label,
        description: f.description,
        category: f.category,
        app: a,
        appName: appByCode(a)?.name || 'Accounting',
        /* An app's own switch follows the subscription, not CLOR's per-account switches. */
        appSwitch,
        locked: Boolean(f.locked),
        defaultEnabled: f.defaultEnabled,
        addedFor: { count: added.get(f.key)?.length || 0, accounts: accounts(added.get(f.key)) },
        offFor: { count: removed.get(f.key)?.length || 0, accounts: accounts(removed.get(f.key)) },
        companies: companies.get(f.key) || { on: 0, off: 0 },
      })),
    });
  }),
);

/* ------------------------------------------------- one account: seats, denials */
/**
 * The account page's entitlement panel (CLOR-06): per app, whether the
 * account owns it, on which tier, seats bought and (for Accounting, whose
 * seats are users) used, and its standing — good, lapsed, or "402 if called"
 * for an app it does not own; and the most recent refusals for the account.
 */
opsListsRouter.get('/ops/accounts/:id/entitlements', (req, res) =>
  outsideTenant('ops: account entitlements', async () => {
    const accountId = String(req.params.id);
    const account = await platformPrisma.account.findUnique({ where: { id: accountId }, select: { id: true, legacyUnrestrictedAt: true } });
    if (!account) return res.status(404).json({ error: 'No such account' });
    const [sub, access, users, denials] = await Promise.all([
      getSubscription(accountId),
      appAccess(accountId),
      platformPrisma.user.count({ where: { accountId, isActive: true } }),
      platformPrisma.entitlementDenial.findMany({ where: { accountId }, orderBy: { createdAt: 'desc' }, take: 10 }),
    ]);
    const apps = await Promise.all(
      /* Every app sold, and Projects (not sold yet): a call to it is refused with 402. */
      [...SELLABLE_APP_CODES, 'projects'].map(async (code) => {
        const item = sub?.items.find((i) => i.appCode === code);
        const owned = access.ownedApps.includes(code);
        const standing = owned ? await appStanding(accountId, code) : { state: 'none' as const };
        return {
          app: code,
          name: appByCode(code)?.name || code,
          owned,
          tier: item?.tier ?? null,
          seatsBought: item?.seats ?? null,
          /* Accounting's seats are the account's users; the other apps count employees inside their own data, not read here. */
          seatsUsed: code === 'accounting' && owned ? users : null,
          standing: standing.state,
          reason: standing.state === 'lapsed' ? standing.reason : null,
        };
      }),
    );
    const [people, orgs] = await Promise.all([
      platformPrisma.user.findMany({ where: { id: { in: [...new Set(denials.map((d) => d.userId).filter(Boolean))] as string[] } }, select: { id: true, fullName: true, email: true } }),
      platformPrisma.org.findMany({ where: { id: { in: [...new Set(denials.map((d) => d.orgId).filter(Boolean))] as string[] } }, select: { id: true, name: true } }),
    ]);
    const personBy = new Map(people.map((u) => [u.id, u]));
    const orgBy = new Map(orgs.map((o) => [o.id, o.name]));
    res.json({
      explicit: Boolean(sub),
      legacyFailOpen: !sub && Boolean(account.legacyUnrestrictedAt),
      planName: sub?.planName ?? null,
      interval: sub?.billingInterval ?? null,
      apps,
      denials: denials.map((d) => ({
        id: d.id,
        at: d.createdAt,
        who: d.userId && personBy.get(d.userId) ? { name: personBy.get(d.userId)!.fullName, email: personBy.get(d.userId)!.email } : null,
        org: d.orgId ? orgBy.get(d.orgId) || null : null,
        code: d.code,
        status: d.status,
        app: d.app,
        feature: d.feature,
        requestId: d.requestId,
      })),
    });
  }),
);
