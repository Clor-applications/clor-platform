import { hostname } from 'node:os';
import { randomUUID } from 'node:crypto';
import { platformPrisma } from '../utils/platformPrisma.js';

/**
 * One instance per tick. Clor runs on more than one API instance, and each
 * starts the same timers (recurring invoices, reminders, digests, reports,
 * HR sync, webhook retries). Without this, every job ran once per instance:
 * two recurring invoices, two reminder e-mails.
 *
 * A lease is a row: the instance that writes itself in (because the row is
 * free or expired, or already its own) runs the job; the others find it taken
 * and skip. The lease is kept for most of the interval, so another instance
 * whose timer fires a little later in the same period skips too. A crashed
 * instance's lease simply expires.
 */
const ME = `${hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`;

export async function takeLease(name: string, ttlMs: number) {
  const now = new Date();
  const until = new Date(now.getTime() + ttlMs);
  /* One UPDATE: free (expired) or already ours becomes ours. Prisma writes and compares the zoneless
     column in UTC on both sides, which a raw NOW() comparison does not. */
  const taken = await platformPrisma.jobLease.updateMany({
    where: { name, OR: [{ until: { lt: now } }, { holder: ME }] },
    data: { holder: ME, until },
  });
  if (taken.count) return true;
  try {
    /* No row yet: the primary key lets exactly one instance create it. */
    await platformPrisma.jobLease.create({ data: { name, holder: ME, until } });
    return true;
  } catch (e: any) {
    if (String(e?.code) === 'P2002') return false;
    throw e;
  }
}

/** Run `fn` only if this instance holds the job's lease for this period; otherwise skip and return null. */
export async function exclusive<T>(name: string, ttlMs: number, fn: () => Promise<T>): Promise<T | null> {
  let mine = false;
  try {
    mine = await takeLease(name, ttlMs);
  } catch (e) {
    /* No lease table yet (a deploy mid-migration): run, as before this existed. */
    console.error(`[job-lease] ${name}:`, e instanceof Error ? e.message : e); // eslint-disable-line no-console
    mine = true;
  }
  if (!mine) return null;
  return fn();
}

/** A lease a little shorter than the interval, so the next tick can take it again. */
export const leaseFor = (intervalMs: number) => Math.max(30_000, Math.floor(intervalMs * 0.9));
export const leaseHolder = () => ME;
