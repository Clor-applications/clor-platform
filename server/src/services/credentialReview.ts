import { platformPrisma } from '../utils/platformPrisma.js';
import { peoplePrisma } from '../utils/peoplePrisma.js';
import { prisma } from '../utils/prisma.js';
import { outsideTenant, runInTenant } from '../utils/tenantScope.js';
import { exclusive, leaseFor } from './jobLease.js';
import { notifyPermission, notifyUsers } from './notifications.js';
import { closing } from './principalAllowed.js';
import { recordCredentialEvent, revokeCredential, SYSTEM, type Actor } from './credentials.js';

/**
 * Keeping the company's credentials looked after (Batch 5, U6).
 *
 * - Expiry: an API key or directory-sync token about to expire is flagged in
 *   the bell 30, 7 and 1 days ahead, to the people who manage credentials and
 *   to whoever made it. An identity provider holds one pasted-in token and
 *   cannot renew it, so a silent expiry would stop provisioning unnoticed.
 * - People leaving: credentials belong to the company, not to the person who
 *   made them. When that person is switched off or removed, their machine
 *   credentials are flagged "needs review" — never revoked, which would stop
 *   an integration nobody knew depended on them.
 * - Owners gone: a credential whose own row has disappeared (older code
 *   deleting it outright) is refused already; once it is confirmed gone, read
 *   as its company, it is recorded as revoked.
 */

export const CREDENTIALS_PERMISSION = 'SETTINGS::Credentials::EDIT';
const MACHINE_KINDS = ['SCIM', 'API_KEY', 'AGENT', 'DEVICE_PUSH'];
const WARN_KINDS = ['SCIM', 'API_KEY'];
const THRESHOLDS = [30, 7, 1];
const DAY = 86_400_000;
const LINK = { app: 'admin', screen: 'credentials' };
const KIND_WORDS: Record<string, string> = { SCIM: 'directory-sync token', API_KEY: 'API key', AGENT: 'connector token', DEVICE_PUSH: 'reader push address' };

/* ------------------------------------------------------------- expiry */

export async function warnExpiring(now = new Date()) {
  let sent = 0;
  const rows = await platformPrisma.credential.findMany({
    where: { kind: { in: WARN_KINDS }, status: 'ACTIVE', expiresAt: { gt: now, lte: new Date(now.getTime() + Math.max(...THRESHOLDS) * DAY) } },
    take: 2000,
  });
  for (const c of rows) {
    const left = Math.max(1, Math.ceil((c.expiresAt!.getTime() - now.getTime()) / DAY));
    /* The most urgent threshold that applies, once — a day the job missed still warns, and never twice for one step. */
    const due = Math.min(...THRESHOLDS.filter((t) => left <= t));
    const already = await platformPrisma.credentialEvent.count({ where: { credentialId: c.id, eventType: 'expiry_warning_sent', reason: { in: THRESHOLDS.filter((t) => t <= due).map(String) } } });
    if (already) continue;
    if (await closing(c.orgId)) continue;
    const notice = {
      kind: 'credentials.expiring',
      title: `The ${KIND_WORDS[c.kind] || 'credential'} ${c.label ? `“${c.label}” ` : ''}(${c.tokenPrefix}…) expires in ${left} day${left === 1 ? '' : 's'}`,
      body: c.kind === 'SCIM'
        ? 'Extend it, or make a new one and paste it into your identity provider before then; provisioning stops when it expires.'
        : 'Extend it, or rotate it and give the new key to the system that uses it before then.',
      link: LINK,
    };
    await runInTenant(c.orgId, async () => {
      await notifyPermission(c.accountId, c.orgId, CREDENTIALS_PERMISSION, notice).catch(() => 0);
      if (c.createdByUserId) await notifyUsers(c.accountId, c.orgId, [c.createdByUserId], notice).catch(() => 0);
    });
    await recordCredentialEvent(c, 'expiry_warning_sent', SYSTEM, { reason: String(due) });
    sent += 1;
  }
  return sent;
}

/** One `expired` event per credential that has run out, for the history; nothing else changes (expiry is worked out on every check). */
export async function recordExpired(now = new Date()) {
  const rows = await platformPrisma.credential.findMany({ where: { status: { not: 'REVOKED' }, expiresAt: { lte: now } }, take: 1000 });
  let n = 0;
  for (const c of rows) {
    if (await platformPrisma.credentialEvent.count({ where: { credentialId: c.id, eventType: 'expired' } })) continue;
    await recordCredentialEvent(c, 'expired', SYSTEM);
    n += 1;
  }
  return n;
}

/* ------------------------------------------------------- owners gone */

async function ownerExists(kind: string, ownerId: string) {
  switch (kind) {
    case 'API_KEY':
      return !!(await peoplePrisma.apiClient.findUnique({ where: { id: ownerId }, select: { id: true } }));
    case 'AGENT':
      return !!(await peoplePrisma.siteAgent.findUnique({ where: { id: ownerId }, select: { id: true } }));
    case 'DEVICE_PUSH':
      return !!(await peoplePrisma.attendanceDevice.findUnique({ where: { id: ownerId }, select: { id: true } }));
    case 'SCIM':
      return !!(await platformPrisma.scimToken.findUnique({ where: { id: ownerId }, select: { id: true } }));
    case 'PAY_LINK':
      return !!(await prisma.paymentRequest.findUnique({ where: { id: ownerId }, select: { id: true } }));
    case 'SHARE_LINK':
      return !!(await prisma.documentShareLink.findUnique({ where: { id: ownerId }, select: { id: true } }));
    default:
      return true;
  }
}

/** A live credential whose own row is gone, confirmed by reading as its company, is recorded as revoked (KTD4). */
export async function retireOrphans() {
  let cursor: string | null = null;
  let n = 0;
  for (;;) {
    const rows: Awaited<ReturnType<typeof platformPrisma.credential.findMany>> = await platformPrisma.credential.findMany({
      where: { status: { not: 'REVOKED' }, ...(cursor ? { id: { gt: cursor } } : {}) },
      orderBy: { id: 'asc' },
      take: 500,
    });
    if (!rows.length) break;
    for (const c of rows) {
      const there = await runInTenant(c.orgId, () => ownerExists(c.kind, c.ownerId));
      if (!there) {
        await revokeCredential(c.id, c.orgId, SYSTEM, 'owner_missing');
        n += 1;
      }
    }
    cursor = rows[rows.length - 1].id;
  }
  return n;
}

export async function runCredentialChecks(now = new Date()) {
  return outsideTenant('credentials: daily expiry and orphan checks across companies', async () => ({
    warned: await warnExpiring(now),
    expired: await recordExpired(now),
    retired: await retireOrphans(),
  }));
}

export function startCredentialChecks({ intervalMs = 24 * 3_600_000, startupDelayMs = 300_000 } = {}) {
  if (process.env.NODE_ENV === 'test' || process.env.VITEST) return () => {};
  const tick = () =>
    exclusive('credentials.daily', leaseFor(intervalMs), () => runCredentialChecks(), { idempotent: true }).catch((e) =>
      console.error('[credentials] daily checks failed:', e instanceof Error ? e.message : e)
    );
  const t = setTimeout(() => {
    tick();
    const i = setInterval(tick, intervalMs);
    i.unref?.();
  }, startupDelayMs);
  t.unref?.();
  return () => clearTimeout(t);
}

/* -------------------------------------------------------- people leaving */

/**
 * The person who made some of the company's machine credentials has been
 * switched off or removed: flag those credentials for review in the companies
 * concerned and tell the people who manage credentials, once per company.
 */
export async function flagCreatorRemoved(t: { accountId: string; userId: string; orgIds: string[] | 'ALL' }, reason: string, actor: Actor) {
  return outsideTenant('credentials: what this person made, in each company', async () => {
    const rows = await platformPrisma.credential.findMany({
      where: {
        accountId: t.accountId,
        createdByUserId: t.userId,
        kind: { in: MACHINE_KINDS },
        status: { not: 'REVOKED' },
        needsReviewReason: null,
        ...(t.orgIds === 'ALL' ? {} : { orgId: { in: t.orgIds } }),
      },
    });
    if (!rows.length) return 0;
    const byOrg = new Map<string, typeof rows>();
    for (const c of rows) byOrg.set(c.orgId, [...(byOrg.get(c.orgId) || []), c]);
    const who = await platformPrisma.user.findUnique({ where: { id: t.userId }, select: { fullName: true, email: true } });
    for (const [orgId, list] of byOrg) {
      await runInTenant(orgId, () => platformPrisma.credential.updateMany({ where: { id: { in: list.map((c) => c.id) } }, data: { needsReviewReason: reason } }));
      for (const c of list) await recordCredentialEvent(c, 'flagged', actor, { reason });
      await runInTenant(orgId, () =>
        notifyPermission(t.accountId, orgId, CREDENTIALS_PERMISSION, {
          kind: 'credentials.review',
          title: `${list.length} credential${list.length === 1 ? '' : 's'} made by ${who?.fullName || who?.email || 'someone'} need${list.length === 1 ? 's' : ''} a look`,
          body: `${reason}. They still work: check each is still wanted, then mark it reviewed, or revoke it.`,
          link: LINK,
        }).catch(() => 0)
      );
    }
    return rows.length;
  });
}
