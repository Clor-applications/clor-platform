import { platformPrisma } from '../utils/platformPrisma.js';
import { outsideTenant } from '../utils/tenantScope.js';
import { companyLimitReason } from './entitlements.js';

/**
 * A company that has stopped trading but whose books must be kept.
 *
 * Deleting is the 30-day closure (companyClosure.ts) and cannot be undone
 * after it. Most businesses that stop need the opposite: GST and income-tax
 * records kept for years, read now and then, never added to. Archiving is
 * that, and it is reversible:
 *
 *  - read-only: tenantContext refuses every write with COMPANY_ARCHIVED
 *    (reading and exporting still work; closure can still be scheduled);
 *  - quiet: appLive refuses machine access (portal, readers, API keys,
 *    recurring invoices) and the mailer suppresses its email;
 *  - free: it does not count against the plan's company limit;
 *  - a reason is required, and both directions are in the account log.
 *
 * The last active company of an account cannot be archived: there would be
 * nowhere left to work.
 */

export const ARCHIVE_REASONS = ['STOPPED_TRADING', 'MERGED', 'SOLD', 'DUPLICATE', 'NOT_NEEDED', 'OTHER'] as const;
export type ArchiveReason = (typeof ARCHIVE_REASONS)[number];
export const ARCHIVE_REASON_LABEL: Record<ArchiveReason, string> = {
  STOPPED_TRADING: 'Stopped trading',
  MERGED: 'Merged into another company',
  SOLD: 'Business sold',
  DUPLICATE: 'Created by mistake / duplicate',
  NOT_NEEDED: 'No longer needed in Clor',
  OTHER: 'Other',
};

export class ArchiveError extends Error {
  constructor(public status: number, message: string, public code: string) {
    super(message);
  }
}

/* Read per request but cached briefly: tenantContext and the mailer ask on every call. */
const cache = new Map<string, { archived: boolean; at: number }>();
const TTL_MS = 30_000;

export async function isArchived(orgId: string): Promise<boolean> {
  if (!orgId) return false;
  const hit = cache.get(orgId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.archived;
  const row = await outsideTenant('archive: is this company archived', () => platformPrisma.org.findUnique({ where: { id: orgId }, select: { archivedAt: true } }));
  const archived = Boolean(row?.archivedAt);
  cache.set(orgId, { archived, at: Date.now() });
  return archived;
}

export async function archiveCompany(args: { accountId: string; orgId: string; actorUserId: string; reason: ArchiveReason; note?: string | null }) {
  if (!ARCHIVE_REASONS.includes(args.reason)) throw new ArchiveError(400, 'Choose why the company is being archived.', 'BAD_REASON');
  return outsideTenant('archive: archive a company', async () => {
    const org = await platformPrisma.org.findFirst({ where: { id: args.orgId, accountId: args.accountId }, select: { id: true, name: true, archivedAt: true } });
    if (!org) throw new ArchiveError(404, 'Company not found in this account.', 'NOT_FOUND');
    if (org.archivedAt) throw new ArchiveError(409, 'This company is already archived.', 'ALREADY_ARCHIVED');
    const othersActive = await platformPrisma.org.count({ where: { accountId: args.accountId, archivedAt: null, NOT: { id: org.id } } });
    if (!othersActive) throw new ArchiveError(409, 'This is your only active company. Add or reactivate another before archiving it.', 'LAST_ACTIVE_COMPANY');
    await platformPrisma.org.update({
      where: { id: org.id },
      data: { archivedAt: new Date(), archivedReason: args.reason, archivedNote: args.note ? String(args.note).slice(0, 1000) : null, archivedByUserId: args.actorUserId },
    });
    cache.delete(org.id);
    return { name: org.name };
  });
}

export async function reactivateCompany(args: { accountId: string; orgId: string; actorUserId: string }) {
  return outsideTenant('archive: reactivate a company', async () => {
    const org = await platformPrisma.org.findFirst({ where: { id: args.orgId, accountId: args.accountId }, select: { id: true, name: true, archivedAt: true } });
    if (!org) throw new ArchiveError(404, 'Company not found in this account.', 'NOT_FOUND');
    if (!org.archivedAt) throw new ArchiveError(409, 'This company is not archived.', 'NOT_ARCHIVED');
    const full = await companyLimitReason(args.accountId);
    if (full) throw new ArchiveError(409, `${full} Archive another company or move to a larger plan first.`, 'COMPANY_LIMIT');
    await platformPrisma.org.update({ where: { id: org.id }, data: { archivedAt: null, archivedReason: null, archivedNote: null, archivedByUserId: null } });
    cache.delete(org.id);
    return { name: org.name };
  });
}

/** For tests and the reactivate path in other processes: forget what was cached. */
export const forgetArchived = (orgId?: string) => (orgId ? cache.delete(orgId) : cache.clear());
