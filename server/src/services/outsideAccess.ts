import { platformPrisma } from '../utils/platformPrisma.js';
import { outsideTenant } from '../utils/tenantScope.js';

/**
 * GAP-006: a person from another account — the accountant a client brings in,
 * an auditor — reaches a company only through an engagement the company
 * granted: recorded, scoped to some apps, possibly ending on a date, and
 * stoppable by the company at any time. Their membership alone opens nothing.
 *
 * Plan: tenant-platform-upgrade-2026-10-23/2026-10-24-gap-006-outside-access-plan.md
 */

export const OUTSIDE_APPS = ['accounting', 'payroll', 'people', 'attendance'] as const;
export type OutsideApp = (typeof OUTSIDE_APPS)[number];

type Row = Awaited<ReturnType<typeof platformPrisma.outsideAccess.findFirst>>;

export class OutsideAccessError extends Error {
  constructor(public status: number, message: string, public code?: string) {
    super(message);
  }
}

/** Why an engagement does not open the company now, or null when it does. */
export function refusalOf(row: NonNullable<Row> | null, now = new Date()) {
  if (!row) return { code: 'OUTSIDE_ACCESS_ENDED', error: 'Your access to this company was not granted by it, or has ended. Ask the company to add you again.' };
  if (row.status === 'REVOKED') return { code: 'OUTSIDE_ACCESS_ENDED', error: 'This company has ended your access.' };
  if (row.status === 'SUSPENDED') return { code: 'OUTSIDE_ACCESS_SUSPENDED', error: 'This company has paused your access.' };
  if (row.expiresAt && row.expiresAt <= now) return { code: 'OUTSIDE_ACCESS_EXPIRED', error: `Your access to this company ended on ${row.expiresAt.toISOString().slice(0, 10)}.` };
  return null;
}

export const appsOf = (row: { apps: string | null } | null) => (row?.apps ? row.apps.split(',').filter(Boolean) : null);

/**
 * For a request into `orgId` (owned by `accountId`): null when the person is the
 * company's own, the engagement when it is live, or the refusal. Read across
 * companies on purpose: it runs before the company is in scope.
 */
export async function outsideAccessFor(userId: string, orgId: string, accountId: string, now = new Date()) {
  return outsideTenant('outside access: is this person the company\'s own, or let in by it', async () => {
    const user = await platformPrisma.user.findUnique({ where: { id: userId }, select: { accountId: true } });
    if (!user || user.accountId === accountId) return { own: true as const };
    const row = await platformPrisma.outsideAccess.findUnique({ where: { orgId_userId: { orgId, userId } } });
    const refused = refusalOf(row, now);
    return refused ? { own: false as const, refused } : { own: false as const, apps: appsOf(row) };
  });
}

/** The companies (of `orgIds`) an outside person may not open now — to leave out of their lists. */
export async function closedForOutsider(userId: string, homeAccountId: string, memberships: Array<{ orgId: string; accountId: string }>, now = new Date()) {
  const foreign = memberships.filter((m) => m.accountId !== homeAccountId);
  if (!foreign.length) return new Set<string>();
  const rows = await outsideTenant('outside access: which invited companies are open', () =>
    platformPrisma.outsideAccess.findMany({ where: { userId, orgId: { in: foreign.map((m) => m.orgId) } } })
  );
  const byOrg = new Map(rows.map((r) => [r.orgId, r]));
  return new Set(foreign.filter((m) => refusalOf(byOrg.get(m.orgId) ?? null, now)).map((m) => m.orgId));
}

const cleanApps = (apps: unknown) => {
  if (apps == null) return null;
  if (!Array.isArray(apps)) throw new OutsideAccessError(400, 'Apps must be a list.');
  const list = [...new Set(apps.map(String))];
  const bad = list.filter((a) => !(OUTSIDE_APPS as readonly string[]).includes(a));
  if (bad.length) throw new OutsideAccessError(400, `No such app: ${bad.join(', ')}.`);
  if (!list.length) throw new OutsideAccessError(400, 'Choose at least one app, or end the access instead.');
  return list.join(',');
};
const cleanExpiry = (v: unknown, now = new Date()) => {
  if (v == null || v === '') return null;
  const d = new Date(String(v));
  if (Number.isNaN(d.getTime())) throw new OutsideAccessError(400, 'That is not a date.');
  if (d <= now) throw new OutsideAccessError(400, 'The end date must be in the future.');
  return d;
};

/** Checks the terms an administrator typed before anything is written; throws OutsideAccessError. */
export function checkOutsideTerms(apps: unknown, expiresAt: unknown) {
  cleanApps(apps);
  cleanExpiry(expiresAt);
}

/**
 * The company's administrator has added an outside person: their consent,
 * recorded. Re-adding someone whose access was ended or paused is a fresh grant.
 * Run in the company's scope.
 */
export async function grantOutsideAccess(t: { accountId: string; orgId: string; userId: string; homeAccountId: string; byUserId: string; apps?: unknown; expiresAt?: unknown }) {
  const data = { status: 'ACTIVE', apps: cleanApps(t.apps), expiresAt: cleanExpiry(t.expiresAt), approvedByUserId: t.byUserId, approvedAt: new Date(), endedByUserId: null, endedAt: null, reason: null };
  return platformPrisma.outsideAccess.upsert({
    where: { orgId_userId: { orgId: t.orgId, userId: t.userId } },
    create: { accountId: t.accountId, orgId: t.orgId, userId: t.userId, homeAccountId: t.homeAccountId, ...data },
    update: data,
  });
}

async function load(orgId: string, id: string, byUserId: string) {
  const row = await platformPrisma.outsideAccess.findFirst({ where: { id, orgId } });
  if (!row) throw new OutsideAccessError(404, 'No such outside access.');
  /* Nobody widens, extends or restores their own access (05 §6). */
  if (row.userId === byUserId) throw new OutsideAccessError(403, 'Your own access is changed by somebody else in the company.', 'own_access');
  return row;
}

export async function changeOutsideAccess(orgId: string, id: string, byUserId: string, patch: { apps?: unknown; expiresAt?: unknown }) {
  const row = await load(orgId, id, byUserId);
  if (row.status === 'REVOKED') throw new OutsideAccessError(409, 'This access has ended. Add the person again to grant it afresh.');
  const data: Record<string, unknown> = {};
  if ('apps' in patch) data.apps = cleanApps(patch.apps);
  if ('expiresAt' in patch) data.expiresAt = cleanExpiry(patch.expiresAt);
  return platformPrisma.outsideAccess.update({ where: { id: row.id }, data });
}

export async function setOutsideAccessStatus(orgId: string, id: string, byUserId: string, to: 'ACTIVE' | 'SUSPENDED' | 'REVOKED', reason?: unknown) {
  const row = await load(orgId, id, byUserId);
  if (row.status === 'REVOKED') throw new OutsideAccessError(409, 'This access has ended. Add the person again to grant it afresh.');
  if (row.status === to) return row;
  const why = reason == null ? null : String(reason).trim().slice(0, 300) || null;
  return platformPrisma.outsideAccess.update({
    where: { id: row.id },
    data: to === 'ACTIVE' ? { status: 'ACTIVE', endedByUserId: null, endedAt: null, reason: null } : { status: to, endedByUserId: byUserId, endedAt: new Date(), reason: why },
  });
}

/** The company's list: who, from where, what they may use, until when, who granted and who stopped it. */
export async function listOutsideAccess(orgId: string, now = new Date()) {
  const rows = await platformPrisma.outsideAccess.findMany({ where: { orgId }, orderBy: [{ status: 'asc' }, { createdAt: 'desc' }] });
  if (!rows.length) return [];
  const people = await outsideTenant('outside access: names of the people and the companies they come from', async () => {
    const ids = [...new Set(rows.flatMap((r) => [r.userId, r.approvedByUserId, r.endedByUserId].filter(Boolean) as string[]))];
    const users = await platformPrisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, fullName: true, email: true, code: true } });
    /* "From" is the person's own firm: their account's first company, by name (the account's own name is often just the person's). */
    const homeIds = [...new Set(rows.map((r) => r.homeAccountId))];
    const [accounts, firms] = await Promise.all([
      platformPrisma.account.findMany({ where: { id: { in: homeIds } }, select: { id: true, code: true, name: true } }),
      platformPrisma.org.findMany({ where: { accountId: { in: homeIds } }, orderBy: { createdAt: 'asc' }, select: { accountId: true, name: true } }),
    ]);
    const firstFirm = new Map<string, string>();
    for (const f of firms) if (!firstFirm.has(f.accountId)) firstFirm.set(f.accountId, f.name);
    const homes = new Map(accounts.map((a) => [a.id, { code: a.code, name: firstFirm.get(a.id) || a.name }]));
    return { users: new Map(users.map((u) => [u.id, u])), homes };
  });
  return rows.map((r) => {
    const u = people.users.get(r.userId);
    const home = people.homes.get(r.homeAccountId);
    const refused = refusalOf(r, now);
    return {
      id: r.id,
      person: { id: r.userId, name: u?.fullName || null, email: u?.email || null, code: u?.code || null },
      from: home ? { code: home.code || null, name: home.name || null } : null,
      status: r.status,
      effective: refused ? refused.code.replace('OUTSIDE_ACCESS_', '') : 'ACTIVE',
      apps: appsOf(r),
      expiresAt: r.expiresAt,
      grantedBy: r.approvedByUserId ? people.users.get(r.approvedByUserId)?.fullName || 'Someone' : null,
      grantedAt: r.approvedAt,
      endedBy: r.endedByUserId ? people.users.get(r.endedByUserId)?.fullName || 'Someone' : null,
      endedAt: r.endedAt,
      reason: r.reason,
    };
  });
}
