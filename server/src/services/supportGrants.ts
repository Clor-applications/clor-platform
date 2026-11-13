import { platformPrisma } from '../utils/platformPrisma.js';
import { outsideTenant } from '../utils/tenantScope.js';

/**
 * Support grants: the only way a member of CLOR staff reaches a customer's
 * company (docs/workspace/SUPPORT_GRANTS.md).
 *
 * Staff hold no membership in a customer company, so without a live grant they
 * open nothing. The customer approves every one — there is no self-serve path
 * and no break-glass (owner, 14 Nov 2026): if nobody answers, nobody looks.
 *
 * Every rule about who may look, for how long, and whether they may change
 * anything is decided here, so a route cannot forget one. The refusal a caller
 * gets is the same object `tenantContext` uses for the company's own rules.
 */

export type GrantScope = 'READ_ONLY' | 'READ_WRITE';
export type GrantStatus = 'PENDING' | 'ACTIVE' | 'ENDED' | 'REVOKED';

/** A day, because support happens across time zones (owner, 14 Nov 2026). */
export const DEFAULT_HOURS = 24;
/** Nobody gets a week by asking. A longer investigation is approved again. */
export const MAX_HOURS = 72;

export class SupportGrantError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const trimmed = (v: unknown, max: number) => String(v ?? '').trim().slice(0, max);

/** Hours the customer may choose: a number, within the ceiling. */
export function hoursFrom(v: unknown) {
  if (v === undefined || v === null || v === '') return DEFAULT_HOURS;
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) throw new SupportGrantError(400, 'SUPPORT_GRANT_HOURS', 'Say how many hours the grant should last.');
  if (n > MAX_HOURS) throw new SupportGrantError(400, 'SUPPORT_GRANT_HOURS', `A grant can last at most ${MAX_HOURS} hours. Ask again if the problem outlives it.`);
  return n;
}

export function scopeFrom(v: unknown): GrantScope {
  const s = String(v ?? 'READ_ONLY').toUpperCase();
  if (s !== 'READ_ONLY' && s !== 'READ_WRITE') throw new SupportGrantError(400, 'SUPPORT_GRANT_SCOPE', 'A grant is either read-only or read and write.');
  return s;
}

type Row = {
  id: string;
  status: string;
  scope: string;
  expiresAt: Date | null;
  startedAt: Date | null;
};

/** Live means approved, not ended, and not past its end. Expiry is worked out, never stored. */
export function isLive(row: Row | null | undefined, now = new Date()) {
  if (!row || row.status !== 'ACTIVE') return false;
  if (!row.expiresAt) return false;
  return row.expiresAt.getTime() > now.getTime();
}

/** What a grant row looks like to a reader, with the worked-out state spelled out. */
export function stateOf(row: Row, now = new Date()): GrantStatus | 'EXPIRED' {
  if (row.status === 'ACTIVE' && !isLive(row, now)) return 'EXPIRED';
  return row.status as GrantStatus;
}

/**
 * The live grant letting this operator into this company, or null.
 *
 * Read across companies on purpose: it runs before the company is in scope,
 * the same way an engagement is read in `outsideAccessFor`.
 */
export async function liveGrantFor(operatorUserId: string, orgId: string, now = new Date()) {
  return outsideTenant('support grant: may this member of CLOR staff open this company', async () => {
    const row = await platformPrisma.supportGrant.findFirst({
      where: { orgId, operatorUserId, status: 'ACTIVE' },
      orderBy: { approvedAt: 'desc' },
      select: { id: true, status: true, scope: true, expiresAt: true, startedAt: true, accountId: true },
    });
    return isLive(row, now) ? row : null;
  });
}

/** An operator asks. Nothing opens until the customer says yes. */
export async function requestGrant(t: {
  accountId: string;
  orgId: string;
  operatorUserId: string;
  requestedByUserId: string;
  reason: unknown;
  ticketRef?: unknown;
  scope?: unknown;
}) {
  const reason = trimmed(t.reason, 500);
  if (reason.length < 10) {
    throw new SupportGrantError(400, 'SUPPORT_GRANT_REASON', 'Say why you need to look, in a sentence the customer will read.');
  }
  const scope = scopeFrom(t.scope);
  return outsideTenant('support grant: ask the customer', async () => {
    const org = await platformPrisma.org.findUnique({ where: { id: t.orgId }, select: { accountId: true } });
    if (!org || org.accountId !== t.accountId) throw new SupportGrantError(404, 'SUPPORT_GRANT_ORG', 'No such company on this account.');

    /* One open ask at a time per operator per company: a second would leave the
       customer choosing between two identical requests. */
    const open = await platformPrisma.supportGrant.findFirst({
      where: { orgId: t.orgId, operatorUserId: t.operatorUserId, status: { in: ['PENDING', 'ACTIVE'] } },
      select: { id: true, status: true },
    });
    if (open) {
      throw new SupportGrantError(409, 'SUPPORT_GRANT_OPEN', open.status === 'PENDING' ? 'You have already asked; the customer has not answered yet.' : 'You already have a live grant for this company.');
    }

    return platformPrisma.supportGrant.create({
      data: {
        accountId: t.accountId,
        orgId: t.orgId,
        operatorUserId: t.operatorUserId,
        requestedByUserId: t.requestedByUserId,
        reason,
        ticketRef: trimmed(t.ticketRef, 60) || null,
        scope,
        status: 'PENDING',
      },
    });
  });
}

/**
 * The customer says yes. The clock starts now, not when it was asked for, and
 * the scope is the customer's answer — they may grant read where read and
 * write was asked for, never the other way round.
 */
export async function approveGrant(t: { orgId: string; id: string; byUserId: string; hours?: unknown; scope?: unknown }, now = new Date()) {
  const hours = hoursFrom(t.hours);
  return outsideTenant('support grant: the customer answers', async () => {
    const row = await platformPrisma.supportGrant.findFirst({ where: { id: t.id, orgId: t.orgId }, select: { id: true, status: true, scope: true } });
    if (!row) throw new SupportGrantError(404, 'SUPPORT_GRANT_NOT_FOUND', 'No such request.');
    if (row.status !== 'PENDING') throw new SupportGrantError(409, 'SUPPORT_GRANT_ANSWERED', 'That request has already been answered.');

    /* Asked for read-only, approved as read and write? No: the customer can
       only narrow what was asked for, so nobody is surprised by what staff did. */
    const asked = row.scope as GrantScope;
    const given = t.scope === undefined ? asked : scopeFrom(t.scope);
    if (asked === 'READ_ONLY' && given === 'READ_WRITE') {
      throw new SupportGrantError(400, 'SUPPORT_GRANT_SCOPE', 'This was asked for as read-only. Ask the operator to request changes if they need them.');
    }

    const claimed = await platformPrisma.supportGrant.updateMany({
      where: { id: t.id, status: 'PENDING' },
      data: {
        status: 'ACTIVE',
        scope: given,
        approvedByUserId: t.byUserId,
        approvedAt: now,
        startedAt: now,
        expiresAt: new Date(now.getTime() + hours * 3_600_000),
      },
    });
    if (!claimed.count) throw new SupportGrantError(409, 'SUPPORT_GRANT_ANSWERED', 'That request has already been answered.');
    return platformPrisma.supportGrant.findUnique({ where: { id: t.id } });
  });
}

/**
 * Ended: by the customer at any moment, by the operator when they are done, or
 * refused before it ever opened. One door, so the audit trail reads the same
 * whoever closed it.
 */
export async function endGrant(t: { orgId: string; id: string; byUserId: string; reason?: unknown; refuse?: boolean }, now = new Date()) {
  return outsideTenant('support grant: end it', async () => {
    const row = await platformPrisma.supportGrant.findFirst({ where: { id: t.id, orgId: t.orgId }, select: { id: true, status: true } });
    if (!row) throw new SupportGrantError(404, 'SUPPORT_GRANT_NOT_FOUND', 'No such grant.');
    if (row.status === 'ENDED' || row.status === 'REVOKED') return row;

    const to = t.refuse || row.status === 'PENDING' ? 'REVOKED' : 'ENDED';
    await platformPrisma.supportGrant.updateMany({
      where: { id: t.id, status: { in: ['PENDING', 'ACTIVE'] } },
      data: { status: to, endedByUserId: t.byUserId, endedAt: now, endReason: trimmed(t.reason, 300) || null },
    });
    return platformPrisma.supportGrant.findUnique({ where: { id: t.id } });
  });
}

/** Every grant on a company, newest first, with the worked-out state. */
export async function listGrants(orgId: string, now = new Date()) {
  return outsideTenant('support grant: what the customer should see', async () => {
    const rows = await platformPrisma.supportGrant.findMany({ where: { orgId }, orderBy: { requestedAt: 'desc' }, take: 50 });
    const staff = await platformPrisma.user.findMany({
      where: { id: { in: [...new Set(rows.map((r) => r.operatorUserId))] } },
      select: { id: true, fullName: true, email: true },
    });
    const byId = new Map<string, { fullName: string | null; email: string }>(
      staff.map((u: { id: string; fullName: string | null; email: string }) => [u.id, { fullName: u.fullName, email: u.email }]),
    );
    return rows.map((r: typeof rows[number]) => ({
      id: r.id,
      state: stateOf(r, now),
      scope: r.scope,
      reason: r.reason,
      ticketRef: r.ticketRef,
      staff: byId.get(r.operatorUserId)?.fullName || byId.get(r.operatorUserId)?.email || 'CLOR support',
      requestedAt: r.requestedAt,
      approvedAt: r.approvedAt,
      expiresAt: r.expiresAt,
      endedAt: r.endedAt,
      endReason: r.endReason,
    }));
  });
}

/**
 * A line in the customer's own audit log about a grant. Never fails the action
 * it records — the same rule as `recordAudit` — but says so when it could not
 * be written.
 */
export async function grantAudit(e: { accountId: string; orgId: string; grantId: string; action: string; byUserId: string; message: string; metadata?: Record<string, unknown> }) {
  try {
    await outsideTenant('support grant: write the customer audit line', () =>
      platformPrisma.auditLog.create({
        data: {
          accountId: e.accountId,
          orgId: e.orgId,
          branchId: '',
          entity: 'SupportGrant',
          entityId: e.grantId,
          action: e.action,
          message: e.message.slice(0, 500),
          metadata: e.metadata ? JSON.stringify(e.metadata).slice(0, 4000) : null,
          createdByUserId: e.byUserId,
        },
      }),
    );
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`[support grant] ${e.action} on ${e.grantId} not recorded:`, err instanceof Error ? err.message : err);
  }
}

/* The same page asks for the same list several times while it loads; one line a minute per path is the record. */
const recentUse = new Map<string, number>();
const USE_WINDOW_MS = 60_000;

/**
 * Every request staff make under a grant, in the customer's audit log: what
 * they opened and what they changed, so the customer reads it without CLOR
 * having to tell them. A repeat read of one path within a minute is one line.
 */
export function recordGrantUse(t: { accountId: string; orgId: string; grantId: string; userId: string; method: string; path: string }, now = Date.now()) {
  const write = !['GET', 'HEAD', 'OPTIONS'].includes(t.method);
  if (t.method === 'OPTIONS' || t.method === 'HEAD') return;
  const key = `${t.grantId}|${t.method}|${t.path}`;
  if (!write) {
    const last = recentUse.get(key);
    if (last && now - last < USE_WINDOW_MS) return;
    recentUse.set(key, now);
    if (recentUse.size > 5000) for (const [k, at] of recentUse) if (now - at >= USE_WINDOW_MS) recentUse.delete(k);
  }
  void grantAudit({
    accountId: t.accountId,
    orgId: t.orgId,
    grantId: t.grantId,
    action: write ? 'CHANGED' : 'VIEWED',
    byUserId: t.userId,
    message: `CLOR support ${write ? 'made a change' : 'opened'}: ${t.method} ${t.path.replace(/^\/api/, '')}`,
  });
}

/**
 * The companies a member of CLOR staff may open right now, for the app's
 * company list: each live grant, with the company's first branch. Shown, not
 * trusted — every request is checked again in `tenantContext`.
 */
export async function grantedCompanies(operatorUserId: string, now = new Date()) {
  return outsideTenant('support grant: the companies staff may open now', async () => {
    const rows = await platformPrisma.supportGrant.findMany({ where: { operatorUserId, status: 'ACTIVE', expiresAt: { gt: now } }, select: { id: true, orgId: true, accountId: true, scope: true, expiresAt: true } });
    if (!rows.length) return [];
    const orgIds = rows.map((r) => r.orgId);
    const [orgs, branches] = await Promise.all([
      platformPrisma.org.findMany({ where: { id: { in: orgIds } }, select: { id: true, name: true, slug: true, code: true, legacyCode: true, archivedAt: true, profileJson: true } }),
      platformPrisma.branch.findMany({ where: { orgId: { in: orgIds } }, select: { id: true, orgId: true }, orderBy: { createdAt: 'asc' } }),
    ]);
    const firstBranch = new Map<string, string>();
    for (const b of branches) if (!firstBranch.has(b.orgId)) firstBranch.set(b.orgId, b.id);
    const byId = new Map(orgs.map((o) => [o.id, o]));
    return rows
      .filter((r) => byId.has(r.orgId))
      .map((r) => ({ grant: { id: r.id, scope: r.scope as GrantScope, expiresAt: r.expiresAt }, accountId: r.accountId, branchId: firstBranch.get(r.orgId) || null, org: byId.get(r.orgId)! }));
  });
}
