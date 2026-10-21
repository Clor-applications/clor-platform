import { Prisma as AccountingPrisma } from '@prisma/client';

import { prisma } from '../utils/prisma.js';
import { platformPrisma } from '../utils/platformPrisma.js';
import { peoplePrisma } from '../utils/peoplePrisma.js';
import { payrollPrisma } from '../utils/payrollPrisma.js';
import { Prisma as PlatformPrisma } from '../generated/platform/index.js';
import { Prisma as PeoplePrisma } from '../generated/people/index.js';
import { Prisma as PayrollPrisma } from '../generated/payroll/index.js';
import { outsideTenant, runInTenant } from '../utils/tenantScope.js';
import { exclusive, leaseFor } from './jobLease.js';

/**
 * Closing a company (LX-07 part 2). Policy, in words a client can read:
 * docs/compliance/DATA_DELETION_AND_CLOSURE.md.
 *
 *  1. The owner (the person who created the company) asks, after taking a
 *     full export of its data (Company data export, scope=all, within the
 *     last 24 hours).
 *  2. Notice period: COMPANY_CLOSURE_NOTICE_DAYS (default 30). The company
 *     keeps working; the owner can cancel.
 *  3. After it, the daily purge deletes every row the company has in every
 *     database — Accounting, Payroll, People/Attendance and the platform
 *     (users' memberships, roles, settings, notifications, audit log) — and
 *     the company itself. CLOR keeps nothing of it: keeping statutory
 *     records for their legal periods is then the company's own duty, from
 *     its export. Only the OrgClosure row stays, as the record of the
 *     closure (who asked, when, what was deleted).
 *
 * Sign-in identities (User, Account) are not company data and stay: a person
 * may belong to other companies. Database backups age out on their own
 * schedule (Cloud SQL: 7 days of backups and point-in-time recovery).
 */

export const noticeDays = () => {
  const n = Number(process.env.COMPANY_CLOSURE_NOTICE_DAYS || 30);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 30;
};
/** How recent the export must be when the owner asks to close. */
export const EXPORT_FRESH_MS = 24 * 60 * 60 * 1000;

export class ClosureError extends Error {
  constructor(message: string, public status = 400, public code = 'CLOSURE_REFUSED') {
    super(message);
  }
}

const isOwner = async (orgId: string, userId: string) => {
  const org = await platformPrisma.org.findUnique({ where: { id: orgId }, select: { createdByUserId: true } });
  return org?.createdByUserId === userId;
};

export async function closureStatus(orgId: string) {
  return platformPrisma.orgClosure.findUnique({ where: { orgId } });
}

/** The latest full export of this company, from the audit log the export route writes. */
export async function lastFullExport(orgId: string) {
  return platformPrisma.auditLog.findFirst({
    where: { orgId, entity: 'Company', action: 'EXPORT_ALL' },
    orderBy: { createdAt: 'desc' },
    select: { createdAt: true, createdByUserId: true },
  });
}

export async function scheduleClosure(args: { accountId: string; orgId: string; userId: string; confirmName: string; reason?: string | null; now?: Date }) {
  const { accountId, orgId, userId } = args;
  const now = args.now || new Date();
  const org = await platformPrisma.org.findFirst({ where: { id: orgId, accountId }, select: { name: true } });
  if (!org) throw new ClosureError('No such company.', 404, 'NOT_FOUND');
  if (!(await isOwner(orgId, userId))) throw new ClosureError('Only the person who created this company can close it.', 403, 'OWNER_ONLY');
  if (String(args.confirmName || '').trim().toLowerCase() !== org.name.trim().toLowerCase()) {
    throw new ClosureError(`Type ${org.name} exactly to confirm.`, 400, 'CONFIRM_NAME');
  }
  const exported = await lastFullExport(orgId);
  if (!exported || now.getTime() - exported.createdAt.getTime() > EXPORT_FRESH_MS) {
    throw new ClosureError('Download a full export of the company first (within the last 24 hours). After the closure nothing can be recovered.', 409, 'EXPORT_FIRST');
  }
  const existing = await platformPrisma.orgClosure.findUnique({ where: { orgId } });
  if (existing?.status === 'SCHEDULED') throw new ClosureError(`Closure is already scheduled for ${existing.deleteAfter.toISOString().slice(0, 10)}.`, 409, 'ALREADY_SCHEDULED');
  const deleteAfter = new Date(now.getTime() + noticeDays() * 86_400_000);
  const data = {
    accountId,
    orgName: org.name,
    status: 'SCHEDULED',
    reason: args.reason ? String(args.reason).slice(0, 1000) : null,
    requestedByUserId: userId,
    requestedAt: now,
    deleteAfter,
    cancelledByUserId: null,
    cancelledAt: null,
  };
  return platformPrisma.orgClosure.upsert({ where: { orgId }, create: { orgId, ...data }, update: data });
}

export async function cancelClosure(args: { orgId: string; userId: string; now?: Date }) {
  const now = args.now || new Date();
  if (!(await isOwner(args.orgId, args.userId))) throw new ClosureError('Only the person who created this company can cancel its closure.', 403, 'OWNER_ONLY');
  const c = await platformPrisma.orgClosure.findUnique({ where: { orgId: args.orgId } });
  if (!c || c.status !== 'SCHEDULED') throw new ClosureError('No closure is scheduled.', 409, 'NOT_SCHEDULED');
  if (c.deleteAfter.getTime() <= now.getTime()) throw new ClosureError('The notice period has ended; the company is being deleted.', 409, 'TOO_LATE');
  return platformPrisma.orgClosure.update({ where: { orgId: args.orgId }, data: { status: 'CANCELLED', cancelledByUserId: args.userId, cancelledAt: now } });
}

type Dmmf = { datamodel: { models: Array<{ name: string; fields: Array<{ name: string }> }> } };
const delegateKey = (model: string) => model.charAt(0).toLowerCase() + model.slice(1);
/** Kept: the record of the closure itself. */
const KEEP = new Set(['OrgClosure']);

/**
 * Delete every row with this orgId in one database. Foreign keys decide the
 * order, and the schema does not say it in a usable form, so: delete what
 * can be deleted, and go round again while anything is left and the last
 * round made progress. A round that deletes nothing while rows remain means
 * something outside the company still points at them — stop and report.
 */
async function purgeDatabase(client: any, dmmf: Dmmf, prefix: string, orgId: string) {
  const models = dmmf.datamodel.models.filter((m) => !KEEP.has(m.name) && m.fields.some((f) => f.name === 'orgId'));
  const counts: Record<string, number> = {};
  let pending = models.map((m) => m.name);
  for (let round = 0; round < 20 && pending.length; round += 1) {
    const next: string[] = [];
    let progressed = false;
    for (const name of pending) {
      const delegate = client[delegateKey(name)];
      if (!delegate?.deleteMany) continue;
      try {
        const r = await delegate.deleteMany({ where: { orgId } });
        if (r.count) {
          counts[`${prefix}.${name}`] = (counts[`${prefix}.${name}`] || 0) + r.count;
          progressed = true;
        }
      } catch {
        next.push(name); // still referenced by a row not yet deleted
      }
    }
    pending = next;
    if (pending.length && !progressed) break;
  }
  if (pending.length) throw new Error(`${prefix}: could not delete ${pending.join(', ')} (still referenced)`);
  return counts;
}

/** Delete one company everywhere. Inside its own tenant scope, so row security confines every delete to it. */
export async function deleteCompanyData(orgId: string) {
  return runInTenant(orgId, async () => {
    const counts: Record<string, number> = {};
    Object.assign(counts, await purgeDatabase(peoplePrisma, PeoplePrisma.dmmf as any, 'people', orgId));
    Object.assign(counts, await purgeDatabase(payrollPrisma, PayrollPrisma.dmmf as any, 'payroll', orgId));
    Object.assign(counts, await purgeDatabase(prisma, AccountingPrisma.dmmf as any, 'accounting', orgId));
    Object.assign(counts, await purgeDatabase(platformPrisma, PlatformPrisma.dmmf as any, 'platform', orgId));
    const org = await platformPrisma.org.deleteMany({ where: { id: orgId } });
    counts['platform.Org'] = org.count;
    return counts;
  });
}

/** The daily job: every closure whose notice period has ended. */
export async function purgeClosedCompanies(now = new Date()) {
  const due = await outsideTenant('closure purge: find companies whose notice ended', () =>
    platformPrisma.orgClosure.findMany({ where: { status: 'SCHEDULED', deleteAfter: { lte: now } }, select: { orgId: true, orgName: true } })
  );
  const done: Array<{ orgId: string; rows: number }> = [];
  for (const c of due) {
    try {
      const counts = await deleteCompanyData(c.orgId);
      await outsideTenant('closure purge: record the deletion', () =>
        platformPrisma.orgClosure.update({ where: { orgId: c.orgId }, data: { status: 'DELETED', deletedAt: new Date(), deletedCounts: JSON.stringify(counts) } })
      );
      done.push({ orgId: c.orgId, rows: Object.values(counts).reduce((a, b) => a + b, 0) });
      // eslint-disable-next-line no-console
      console.log(`[closure] deleted company ${c.orgId} (${c.orgName}):`, counts);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error(`[closure] deleting ${c.orgId} failed; will retry tomorrow:`, e instanceof Error ? e.message : e);
    }
  }
  return done;
}

export function startClosurePurge() {
  if (String(process.env.COMPANY_CLOSURE_PURGE || '').toLowerCase() === 'off') return () => {};
  const run = () => exclusive('closure.purge', leaseFor(24 * 60 * 60 * 1000), () => purgeClosedCompanies()).catch((e) => {
    // eslint-disable-next-line no-console
    console.error('[closure] purge failed:', e instanceof Error ? e.message : e);
  });
  const first = setTimeout(run, 90_000);
  const timer = setInterval(run, 24 * 60 * 60 * 1000);
  first.unref?.();
  timer.unref?.();
  return () => {
    clearTimeout(first);
    clearInterval(timer);
  };
}
