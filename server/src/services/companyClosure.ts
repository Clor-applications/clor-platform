import { Prisma as AccountingPrisma } from '@prisma/client';

import { prisma } from '../utils/prisma.js';
import { platformPrisma } from '../utils/platformPrisma.js';
import { peoplePrisma } from '../utils/peoplePrisma.js';
import { payrollPrisma } from '../utils/payrollPrisma.js';
import { Prisma as PlatformPrisma } from '../generated/platform/index.js';
import { Prisma as PeoplePrisma } from '../generated/people/index.js';
import { Prisma as PayrollPrisma } from '../generated/payroll/index.js';
import { outsideTenant, runInTenant } from '../utils/tenantScope.js';
import { currentLease, exclusive, leaseFor, LeaseLost, shuttingDown } from './jobLease.js';
import { userIsAdmin } from './roleGuards.js';
import { getGateway } from '../billing/gateway.js';
import { fileStore } from './fileStore.js';

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

/**
 * Who may close a company, or stop its closure: an administrator of the whole
 * company (A-21). It used to be whoever created it — a creator later demoted
 * or moved on could still close it, and a company whose creator had left
 * could never be closed by the people now running it.
 */
export const mayClose = (accountId: string, orgId: string, userId: string) => userIsAdmin(accountId, orgId, userId);

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
  const org = await platformPrisma.org.findFirst({ where: { id: orgId, accountId }, select: { name: true, code: true } });
  if (!org) throw new ClosureError('No such company.', 404, 'NOT_FOUND');
  if (!(await mayClose(accountId, orgId, userId))) throw new ClosureError('Only an administrator of this company can close it.', 403, 'ADMIN_ONLY');
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
    /* Kept after deletion: the code is never issued again (displayCodes.ts). */
    orgCode: org.code ?? null,
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

export async function cancelClosure(args: { accountId: string; orgId: string; userId: string; now?: Date }) {
  const now = args.now || new Date();
  if (!(await mayClose(args.accountId, args.orgId, args.userId))) throw new ClosureError('Only an administrator of this company can cancel its closure.', 403, 'ADMIN_ONLY');
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
/** Tables whose rows are never edited or deleted except by this purge (prisma/people/migrations/20261025020000_change_log_purge). */
const APPEND_ONLY = new Set(['people.ChangeLog']);

async function purgeDatabase(client: any, dmmf: Dmmf, prefix: string, orgId: string) {
  const models = dmmf.datamodel.models.filter((m) => !KEEP.has(m.name) && m.fields.some((f) => f.name === 'orgId'));
  const counts: Record<string, number> = {};
  const lastError: Record<string, string> = {};
  let pending = models.map((m) => m.name);
  /* Append-only tables refuse deleteMany by trigger; a purge is the one time their rows go, under clor.purge for this statement only. */
  for (const name of pending.filter((n) => APPEND_ONLY.has(`${prefix}.${n}`))) {
    try {
      const r = await client.$transaction(async (tx: any) => {
        await tx.$executeRawUnsafe(`SELECT set_config('clor.purge', 'on', true)`);
        return tx.$executeRawUnsafe(`DELETE FROM "${name}" WHERE "orgId" = $1`, orgId);
      });
      if (r) counts[`${prefix}.${name}`] = (counts[`${prefix}.${name}`] || 0) + Number(r);
      pending = pending.filter((n) => n !== name);
    } catch (e) {
      lastError[name] = String(e instanceof Error ? e.message : e).split('\n').filter(Boolean).slice(-1)[0]?.slice(0, 200) || 'unknown error';
    }
  }
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
      } catch (e) {
        next.push(name); // still referenced by a row not yet deleted — or a real failure, kept for the report
        lastError[name] = String(e instanceof Error ? e.message : e).split('\n').filter(Boolean).slice(-1)[0]?.slice(0, 200) || 'unknown error';
      }
    }
    pending = next;
    if (pending.length && !progressed) break;
  }
  if (pending.length) throw new Error(`${prefix}: could not delete ${pending.map((n) => `${n} (${lastError[n]})`).join(', ')}`);
  return counts;
}

/** The stores a company is deleted from, in this order; each is a checkpoint. */
/* `files`: the company's documents, selfies and evidence in object storage (R2 plan, S5); nothing to do without a store. */
export const PURGE_STEPS = ['files', 'people', 'payroll', 'accounting', 'platform', 'org'] as const;
type Step = (typeof PURGE_STEPS)[number];
type Progress = { done: Step[]; counts: Record<string, number> };

const STORES: Record<Exclude<Step, 'org' | 'files'>, [any, Dmmf]> = {
  people: [peoplePrisma, PeoplePrisma.dmmf as any],
  payroll: [payrollPrisma, PayrollPrisma.dmmf as any],
  accounting: [prisma, AccountingPrisma.dmmf as any],
  platform: [platformPrisma, PlatformPrisma.dmmf as any],
};

/**
 * Delete one company everywhere. Inside its own tenant scope, so row security confines every delete to it.
 *
 * A-47: one store at a time, with a checkpoint after each. The purge used to
 * run all four databases in one go; cut off half-way (a deploy's SIGTERM gives
 * eight seconds) it started again from the top the next day with no record of
 * how far it had got, and a failure was a log line nobody saw. Now:
 *  - `beforeStep` is asked before each store and may refuse (the instance is
 *    stopping, or the job's lease was lost): no store is begun that will not
 *    be finished by this run;
 *  - after each store its counts and name are written to the closure record;
 *  - a later run skips the stores already done and carries their counts on.
 */
export async function deleteCompanyData(
  orgId: string,
  opts: { progress?: Progress; beforeStep?: (step: Step) => Promise<void>; checkpoint?: (p: Progress) => Promise<void> } = {}
) {
  return runInTenant(orgId, async () => {
    const progress: Progress = { done: [...(opts.progress?.done || [])], counts: { ...(opts.progress?.counts || {}) } };
    for (const step of PURGE_STEPS) {
      if (progress.done.includes(step)) continue;
      await opts.beforeStep?.(step);
      if (step === 'files') {
        const store = fileStore();
        if (store) progress.counts['files.objects'] = (progress.counts['files.objects'] || 0) + (await store.deleteAll(orgId));
      } else if (step === 'org') {
        const org = await platformPrisma.org.deleteMany({ where: { id: orgId } });
        progress.counts['platform.Org'] = (progress.counts['platform.Org'] || 0) + org.count;
      } else {
        const [client, dmmf] = STORES[step];
        for (const [k, n] of Object.entries(await purgeDatabase(client, dmmf, step, orgId))) progress.counts[k] = (progress.counts[k] || 0) + n;
      }
      progress.done.push(step);
      await opts.checkpoint?.(progress);
    }
    return progress.counts;
  });
}

const readProgress = (raw: string | null): Progress => {
  try {
    const p = JSON.parse(raw || '{}');
    return { done: Array.isArray(p.done) ? p.done.filter((x: string) => (PURGE_STEPS as readonly string[]).includes(x)) : [], counts: p.counts && typeof p.counts === 'object' ? p.counts : {} };
  } catch {
    return { done: [], counts: {} };
  }
};

/** Refuse to begin a destructive step once the instance is stopping or the job's lease is gone. */
async function mayContinue() {
  if (shuttingDown()) throw new LeaseLost('closure.purge', 'the instance is stopping');
  await currentLease()?.assertHeld();
}

/** The job: every closure whose notice period has ended. Resumes a purge that was cut off. */
/**
 * An account whose last company has just been deleted (A-40).
 *
 * The purge removed the company and left the account as it was: an active
 * subscription — still billable — and an entitlement for an account with
 * nothing in it. Sign-in identities stay, as the closure policy says (a
 * person may belong to other companies), and CLOR's own billing records stay
 * (they are CLOR's tax records). The subscription is cancelled at once, the
 * gateway told to stop charging, and the entitlement closed. A gateway that
 * cannot be reached is recorded and alerted, not swallowed: somebody must stop
 * that charge by hand.
 */
export async function closeEmptyAccount(accountId: string, now = new Date()) {
  return outsideTenant('closure purge: the account above the company', async () => {
    if (await platformPrisma.org.count({ where: { accountId } })) return { closed: false as const };
    const sub = await platformPrisma.subscription.findUnique({ where: { accountId } });
    let gatewayError: string | null = null;
    if (sub && sub.status !== 'cancelled') {
      if (sub.gatewaySubscriptionId) {
        try {
          await getGateway().cancelSubscription(sub.gatewaySubscriptionId, false);
        } catch (e) {
          gatewayError = String(e instanceof Error ? e.message : e).slice(0, 300);
          // eslint-disable-next-line no-console
          console.error(`[closure] ALERT the gateway did not cancel the subscription of account ${accountId}; stop it by hand:`, gatewayError);
        }
      }
      await platformPrisma.subscription.update({ where: { accountId }, data: { status: 'cancelled', cancelAtPeriodEnd: false, currentPeriodEnd: now } });
    }
    await platformPrisma.accountEntitlement.updateMany({ where: { accountId }, data: { status: 'CLOSED', validUntil: now } });
    await platformPrisma.authEvent.create({
      data: {
        accountId,
        eventType: 'ACCOUNT_EMPTIED',
        detail: JSON.stringify({ reason: 'Its last company was deleted after closure.', subscription: sub ? 'cancelled' : 'none', gatewayError }).slice(0, 1000),
      },
    });
    return { closed: true as const, gatewayError };
  });
}

/**
 * `only` limits the run to these companies — for a test sharing its database
 * with others, whose own scheduled closures are not its business. The job
 * passes nothing and purges every company whose notice has ended.
 */
export async function purgeClosedCompanies(now = new Date(), opts: { only?: string[] } = {}) {
  const due = await outsideTenant('closure purge: find companies whose notice ended', () =>
    platformPrisma.orgClosure.findMany({ where: { status: 'SCHEDULED', deleteAfter: { lte: now }, ...(opts.only ? { orgId: { in: opts.only } } : {}) }, select: { orgId: true, orgName: true, accountId: true, purgeProgress: true } })
  );
  const done: Array<{ orgId: string; rows: number }> = [];
  const record = (orgId: string, data: Record<string, unknown>) =>
    outsideTenant('closure purge: record progress', () => platformPrisma.orgClosure.update({ where: { orgId }, data }));
  for (const c of due) {
    try {
      await mayContinue();
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error(`[closure] not starting ${c.orgId}:`, e instanceof Error ? e.message : e);
      break;
    }
    await record(c.orgId, { purgeAttempts: { increment: 1 }, lastPurgeAt: new Date() });
    try {
      const counts = await deleteCompanyData(c.orgId, {
        progress: readProgress(c.purgeProgress),
        beforeStep: () => mayContinue(),
        checkpoint: (p) => record(c.orgId, { purgeProgress: JSON.stringify(p), purgeError: null }).then(() => undefined),
      });
      await record(c.orgId, { status: 'DELETED', deletedAt: new Date(), deletedCounts: JSON.stringify(counts), purgeError: null });
      /* The account's last company: stop its billing (A-40). Not a reason to undo the purge if it fails. */
      await closeEmptyAccount(c.accountId).catch((e) =>
        console.error(`[closure] ALERT could not close the empty account ${c.accountId}:`, e instanceof Error ? e.message : e) // eslint-disable-line no-console
      );
      done.push({ orgId: c.orgId, rows: Object.values(counts).reduce((a, b) => a + b, 0) });
      // eslint-disable-next-line no-console
      console.log(`[closure] deleted company ${c.orgId} (${c.orgName}):`, counts);
    } catch (e) {
      const stopped = e instanceof LeaseLost;
      const why = String(e instanceof Error ? e.message : e).slice(0, 1000);
      await record(c.orgId, { purgeError: stopped ? `Stopped before the next store (${why}); resumes on the next run.` : why }).catch((err) =>
        console.error(`[closure] ALERT could not record the failure for ${c.orgId}:`, err instanceof Error ? err.message : err) // eslint-disable-line no-console
      );
      if (stopped) {
        // eslint-disable-next-line no-console
        console.error(`[closure] purge of ${c.orgId} stopped part-way; resumes on the next run:`, why);
        break;
      }
      /* A half-deleted company is an incident: say so loudly, every run, until it is resolved. */
      // eslint-disable-next-line no-console
      console.error(`[closure] ALERT deleting ${c.orgId} (${c.orgName}) failed; resumes from its checkpoint on the next run:`, why);
    }
  }
  return done;
}

/**
 * Hourly, so a purge cut off by a deploy resumes within the hour rather than
 * the next day; the work itself is only the closures whose notice has ended.
 */
export function startClosurePurge({ intervalMs = 60 * 60 * 1000 } = {}) {
  if (String(process.env.COMPANY_CLOSURE_PURGE || '').toLowerCase() === 'off') return () => {};
  const run = () => exclusive('closure.purge', leaseFor(intervalMs), () => purgeClosedCompanies()).catch((e) => {
    // eslint-disable-next-line no-console
    console.error('[closure] ALERT purge failed:', e instanceof Error ? e.message : e);
  });
  const first = setTimeout(run, 90_000);
  const timer = setInterval(run, intervalMs);
  first.unref?.();
  timer.unref?.();
  return () => {
    clearTimeout(first);
    clearInterval(timer);
  };
}
