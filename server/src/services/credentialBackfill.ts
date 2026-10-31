import { peoplePrisma } from '../utils/peoplePrisma.js';
import { platformPrisma } from '../utils/platformPrisma.js';
import { prisma } from '../utils/prisma.js';
import { hashAllLegacyLinks } from './shareLinks.js';
import { exclusive, leaseFor } from './jobLease.js';
import { registerLegacy, type CredentialKind, type LegacyHit } from './credentials.js';

/**
 * Registers every credential issued before the registry existed (Batch 5,
 * KTD11). Tokens are also registered on first use, but a token used once a
 * month would otherwise stay off the Credentials page until then.
 *
 * Runs outside any request (maintenance scope), one instance at a time, and is
 * safe to run again: a token already registered is left as it is. Each source
 * is walked in id order a page at a time.
 */

const PAGE = 200;

type Source = { kind: CredentialKind; page: (after: string | null) => Promise<Array<{ id: string; hash: string; hit: LegacyHit }>> };

const after = (id: string | null) => (id ? { id: { gt: id } } : {});

/** Every kind CLOR issues. */
export const SOURCES: Source[] = [
  {
    kind: 'SHARE_LINK',
    page: async (id) =>
      (await prisma.documentShareLink.findMany({ where: { ...after(id), tokenHash: { not: null }, revokedAt: null }, orderBy: { id: 'asc' }, take: PAGE })).map((l) => ({
        id: l.id,
        hash: l.tokenHash!,
        hit: { ownerId: l.id, accountId: l.accountId, orgId: l.orgId, tokenPrefix: l.tokenHash!.slice(0, 8), createdByUserId: l.createdByUserId, label: `${l.docType} ${l.docId}`, expiresAt: l.expiresAt },
      })),
  },
  {
    kind: 'PAY_LINK',
    page: async (id) =>
      (await prisma.paymentRequest.findMany({ where: { ...after(id), status: { not: 'CANCELLED' } }, orderBy: { id: 'asc' }, take: PAGE })).map((r) => ({
        id: r.id,
        hash: r.tokenHash,
        hit: { ownerId: r.id, accountId: r.accountId, orgId: r.orgId, tokenPrefix: r.tokenPrefix, createdByUserId: r.createdByUserId, label: r.docNumber ? `Invoice ${r.docNumber}` : 'Payment', expiresAt: r.expiresAt },
      })),
  },
  {
    kind: 'SCIM',
    page: async (id) => {
      const rows = await platformPrisma.scimToken.findMany({ where: { ...after(id), revokedAt: null }, orderBy: { id: 'asc' }, take: PAGE });
      /* An agent's token names its agent, so the agent's state governs it from the start (KTD11). */
      const agents = await peoplePrisma.siteAgent.findMany({ where: { scimTokenId: { in: rows.map((r) => r.id) } }, select: { id: true, scimTokenId: true, name: true } });
      const agentOf = new Map(agents.map((a) => [a.scimTokenId!, a]));
      return rows.map((t) => ({
        id: t.id,
        hash: t.tokenHash,
        hit: {
          ownerId: t.id,
          accountId: t.accountId,
          orgId: t.orgId,
          tokenPrefix: t.tokenPrefix,
          createdByUserId: t.createdByUserId,
          parentOwnerId: agentOf.get(t.id)?.id ?? null,
          label: agentOf.get(t.id) ? `Directory sync for ${agentOf.get(t.id)!.name}` : 'Directory sync',
        },
      }));
    },
  },
  {
    kind: 'API_KEY',
    page: async (id) =>
      (await peoplePrisma.apiClient.findMany({ where: { ...after(id), isActive: true, revokedAt: null }, orderBy: { id: 'asc' }, take: PAGE })).map((r) => ({
        id: r.id,
        hash: r.tokenHash,
        hit: { ownerId: r.id, accountId: r.accountId, orgId: r.orgId, tokenPrefix: r.tokenPrefix, createdByUserId: r.createdByUserId, label: r.name },
      })),
  },
  {
    kind: 'AGENT',
    page: async (id) =>
      (await peoplePrisma.siteAgent.findMany({ where: after(id), orderBy: { id: 'asc' }, take: PAGE })).map((a) => ({
        id: a.id,
        hash: a.tokenHash,
        hit: { ownerId: a.id, accountId: a.accountId, orgId: a.orgId, tokenPrefix: a.tokenPrefix, createdByUserId: a.createdByUserId, label: a.name },
      })),
  },
  {
    kind: 'DEVICE_PUSH',
    page: async (id) =>
      (await peoplePrisma.attendanceDevice.findMany({ where: { ...after(id), pushTokenHash: { not: null } }, orderBy: { id: 'asc' }, take: PAGE })).map((d) => ({
        id: d.id,
        hash: d.pushTokenHash!,
        hit: { ownerId: d.id, accountId: d.accountId, orgId: d.orgId, tokenPrefix: d.pushTokenPrefix || d.pushTokenHash!.slice(0, 12), createdByUserId: d.createdByUserId, label: d.name },
      })),
  },
];

/** Register everything; returns how many rows each kind added or confirmed. */
export async function backfillCredentials(sources: Source[] = SOURCES) {
  const counts: Record<string, number> = {};
  /* Links stored before A-32 get their hash first, so the pass below finds them. */
  if (sources.some((x) => x.kind === 'SHARE_LINK')) counts.SHARE_LINK_HASHED = await hashAllLegacyLinks();
  for (const s of sources) {
    let cursor: string | null = null;
    for (;;) {
      const rows = await s.page(cursor);
      if (!rows.length) break;
      for (const r of rows) {
        await registerLegacy(s.kind, r.hash, r.hit, { type: 'SYSTEM' }, 'registered at deploy');
        counts[s.kind] = (counts[s.kind] || 0) + 1;
      }
      cursor = rows[rows.length - 1].id;
    }
  }
  return counts;
}

/** Once, shortly after boot, on one instance. */
export function startCredentialBackfill({ delayMs = 60_000 } = {}) {
  if (process.env.NODE_ENV === 'test' || process.env.VITEST) return () => {};
  const t = setTimeout(() => {
    exclusive('credentials.backfill', leaseFor(6 * 3_600_000), async () => {
      const counts = await backfillCredentials();
      console.log('[credentials] backfill:', JSON.stringify(counts)); // eslint-disable-line no-console
    }, { idempotent: true }).catch((e) => console.error('[credentials] backfill failed:', e instanceof Error ? e.message : e));
  }, delayMs);
  t.unref?.();
  return () => clearTimeout(t);
}
