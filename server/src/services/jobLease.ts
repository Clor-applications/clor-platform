import { hostname } from 'node:os';
import { randomUUID } from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';
import { platformPrisma } from '../utils/platformPrisma.js';

/**
 * One instance per tick. Clor runs on more than one API instance, and each
 * starts the same timers (recurring invoices, reminders, digests, reports,
 * HR sync, webhook retries). Without this, every job ran once per instance:
 * two recurring invoices, two reminder e-mails.
 *
 * A lease is a row: the instance that writes itself in (because the row is
 * free or expired) runs the job; the others find it taken and skip. The lease
 * is kept for most of the interval, so another instance whose timer fires a
 * little later in the same period skips too.
 *
 * What it guarantees (A-43), and why each part is there:
 *
 *  - It fails CLOSED. A lease that cannot be read is not a lease held: the
 *    job is skipped and the error logged. The one exception is a lease table
 *    that does not exist yet (P2021, a deploy mid-migration), and only for a
 *    job that says it is safe to run twice (`idempotent`).
 *  - A run never overlaps itself. Inside one instance a job still running is
 *    not started again (the in-process guard); across instances a long run
 *    renews its lease with a heartbeat, so it does not expire under it.
 *  - Every take bumps a fencing token. A run that was cut off (its heartbeat
 *    went stale and another instance took over) holds an old token, and
 *    `assertHeld()` tells it so before it does anything it cannot take back.
 *  - A run that ends releases the run: on success the period claim stays (the
 *    other instances still skip this period); on failure, or when the
 *    instance is told to stop (SIGTERM), the lease is freed at once, so the
 *    next tick anywhere can take over instead of waiting out the period.
 */
const ME = `${hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`;

export class LeaseLost extends Error {
  constructor(public job: string, why: string) {
    super(`${job}: ${why}`);
    this.name = 'LeaseLost';
  }
}

export type Lease = {
  name: string;
  token: number;
  /** Aborted when the lease is lost or the instance is stopping. */
  signal: AbortSignal;
  /** Throws LeaseLost unless this run still holds the lease and the instance is not stopping. Call before a step that cannot be undone. */
  assertHeld: () => Promise<void>;
};

/** Heartbeat often enough that three missed beats is still well inside the lease. */
const beatFor = (ttlMs: number) => Math.max(200, Math.min(60_000, Math.floor(ttlMs / 4)));
const staleFor = (ttlMs: number) => 3 * beatFor(ttlMs);

type Taken = { token: number; at: Date };

/** Take the lease if it is free, expired, ours and idle, or held by a run whose heartbeat has stopped. */
async function acquire(name: string, ttlMs: number): Promise<Taken | null> {
  const now = new Date();
  const until = new Date(now.getTime() + ttlMs);
  const stale = new Date(now.getTime() - staleFor(ttlMs));
  /* One UPDATE decides. Prisma writes and compares the zoneless column in UTC
     on both sides, which a raw NOW() comparison does not. */
  const taken = await platformPrisma.jobLease.updateMany({
    where: {
      name,
      OR: [
        { until: { lt: now } },
        { holder: ME, runningSince: null },
        { runningSince: { not: null }, heartbeatAt: { lt: stale } },
      ],
    },
    data: { holder: ME, until, token: { increment: 1 }, runningSince: now, heartbeatAt: now },
  });
  if (taken.count) {
    const row = await platformPrisma.jobLease.findUnique({ where: { name } });
    /* Somebody else's take can only land after ours expired, which it has not; still, check. */
    if (!row || row.holder !== ME || row.runningSince?.getTime() !== now.getTime()) return null;
    return { token: row.token, at: now };
  }
  try {
    /* No row yet: the primary key lets exactly one instance create it. */
    const row = await platformPrisma.jobLease.create({ data: { name, holder: ME, until, token: 1, runningSince: now, heartbeatAt: now } });
    return { token: row.token, at: now };
  } catch (e: any) {
    if (String(e?.code) === 'P2002') return null;
    throw e;
  }
}

/** Take a job's lease for this period (no run is started; for tests and one-off use). */
export async function takeLease(name: string, ttlMs: number) {
  const t = await acquire(name, ttlMs);
  if (!t) return false;
  await platformPrisma.jobLease.updateMany({ where: { name, holder: ME, token: t.token }, data: { runningSince: null } });
  return true;
}

/* ---- This instance's own runs ---- */

const running = new Map<string, { controller: AbortController; token: number }>();
const scope = new AsyncLocalStorage<Lease>();
let stopping = false;

/** The lease of the job this code is running inside, if any. */
export const currentLease = () => scope.getStore() || null;
/** True once the instance has been told to stop: no new job, and no new destructive step. */
export const shuttingDown = () => stopping;

const log = (msg: string, e?: unknown) => console.error(`[job-lease] ${msg}`, e === undefined ? '' : e instanceof Error ? e.message : e); // eslint-disable-line no-console

async function release(name: string, token: number, keepPeriod: Date | null) {
  const now = new Date();
  try {
    await platformPrisma.jobLease.updateMany({
      where: { name, holder: ME, token },
      /* Kept: the claim on this period stays, nothing is running. Freed: the next tick anywhere may take it. */
      data: keepPeriod && keepPeriod > now ? { runningSince: null, heartbeatAt: now, until: keepPeriod } : { runningSince: null, heartbeatAt: now, until: new Date(now.getTime() - 1) },
    });
  } catch (e) {
    log(`${name}: release failed (the lease will expire on its own)`, e);
  }
}

export type ExclusiveOptions = {
  /** Safe to run twice in a period: only then may it run without a lease table (P2021, mid-migration). */
  idempotent?: boolean;
};

/**
 * Run `fn` only if this instance takes the job's lease for this period;
 * otherwise skip and return null. `fn` can reach its lease with currentLease().
 */
export async function exclusive<T>(name: string, ttlMs: number, fn: () => Promise<T>, opts: ExclusiveOptions = {}): Promise<T | null> {
  if (stopping) return null;
  /* In-process guard: a run still going in this instance is never started again. */
  if (running.has(name)) return null;
  const controller = new AbortController();
  running.set(name, { controller, token: 0 });
  try {
    let taken: Taken | null = null;
    let leaseless = false;
    try {
      taken = await acquire(name, ttlMs);
    } catch (e: any) {
      if (String(e?.code) === 'P2021' && opts.idempotent) {
        log(`${name}: no lease table yet; running anyway (idempotent job)`, e);
        leaseless = true;
      } else {
        log(`${name}: lease could not be taken; skipped`, e);
        return null;
      }
    }
    if (!taken && !leaseless) return null;
    const token = taken?.token ?? 0;
    running.set(name, { controller, token });

    const lease: Lease = {
      name,
      token,
      signal: controller.signal,
      assertHeld: async () => {
        if (stopping) throw new LeaseLost(name, 'the instance is stopping');
        if (controller.signal.aborted) throw new LeaseLost(name, String(controller.signal.reason?.message || 'lease lost'));
        if (leaseless) return;
        const row = await platformPrisma.jobLease.findUnique({ where: { name } });
        if (!row || row.holder !== ME || row.token !== token) {
          controller.abort(new LeaseLost(name, 'another instance holds the lease now'));
          throw new LeaseLost(name, 'another instance holds the lease now');
        }
      },
    };

    /* Heartbeat: a long run keeps its lease; a run that cannot renew it stops. */
    let lastBeat = Date.now();
    const periodEnd = taken ? new Date(taken.at.getTime() + ttlMs) : null;
    const beat = leaseless
      ? null
      : setInterval(async () => {
          const now = new Date();
          try {
            const r = await platformPrisma.jobLease.updateMany({
              where: { name, holder: ME, token },
              data: { heartbeatAt: now, until: new Date(Math.max(periodEnd!.getTime(), now.getTime() + staleFor(ttlMs))) },
            });
            if (!r.count) controller.abort(new LeaseLost(name, 'another instance holds the lease now'));
            else lastBeat = now.getTime();
          } catch (e) {
            if (now.getTime() - lastBeat > staleFor(ttlMs)) controller.abort(new LeaseLost(name, 'the lease could not be renewed'));
            log(`${name}: heartbeat failed`, e);
          }
        }, beatFor(ttlMs));
    beat?.unref?.();

    const runId = await startRun(name, token);
    let ok = false;
    let out: T | undefined;
    let failure: unknown = null;
    try {
      out = await scope.run(lease, fn);
      ok = !controller.signal.aborted;
      return out;
    } catch (e) {
      failure = e;
      throw e;
    } finally {
      if (beat) clearInterval(beat);
      if (!leaseless) await release(name, token, ok ? periodEnd : null);
      await finishRun(runId, failure ? (failure instanceof LeaseLost ? 'STOPPED' : 'FAILED') : ok ? 'OK' : 'STOPPED', out, failure ?? controller.signal.reason ?? null);
    }
  } finally {
    running.delete(name);
  }
}

/* ---- Run history (A-48) ---- */

/** What a run did, for the record: a number, or the numeric parts of an object, or how many items. */
const summarize = (out: unknown): string | null => {
  if (out == null) return null;
  if (typeof out === 'number') return JSON.stringify({ count: out });
  if (Array.isArray(out)) return JSON.stringify({ items: out.length });
  if (typeof out === 'object') {
    const nums = Object.fromEntries(Object.entries(out as Record<string, unknown>).filter(([, v]) => typeof v === 'number'));
    return Object.keys(nums).length ? JSON.stringify(nums).slice(0, 2000) : null;
  }
  return null;
};

/* Recording a run never stops the job: a history row that cannot be written is logged and the work goes on. */
async function startRun(worker: string, token: number) {
  try {
    return (await platformPrisma.jobRun.create({ data: { worker, holder: ME, token }, select: { id: true } })).id;
  } catch (e) {
    log(`${worker}: run not recorded`, e);
    return null;
  }
}

async function finishRun(id: string | null, outcome: string, out: unknown, error: unknown) {
  if (!id) return;
  try {
    await platformPrisma.jobRun.update({
      where: { id },
      data: { outcome, finishedAt: new Date(), counts: summarize(out), error: error ? String(error instanceof Error ? error.message : error).slice(0, 1000) : null },
    });
  } catch (e) {
    log(`run ${id}: outcome not recorded`, e);
  }
}

/** The latest run of each worker: an old one, or a string of failures, is a scheduler that has stopped. */
export async function lastJobRuns() {
  const rows = await platformPrisma.jobRun.findMany({ orderBy: { startedAt: 'desc' }, take: 500 });
  const latest = new Map<string, (typeof rows)[number]>();
  for (const r of rows) if (!latest.has(r.worker)) latest.set(r.worker, r);
  return [...latest.values()];
}

/** Run history is for spotting a stopped scheduler, not an archive: a month is plenty. */
export const pruneJobRuns = async (days = 30) => (await platformPrisma.jobRun.deleteMany({ where: { startedAt: { lt: new Date(Date.now() - days * 86_400_000) } } })).count;

/**
 * SIGTERM: start nothing new, tell every run to stop, and free their leases so
 * another instance can take over at its next tick rather than after the period.
 */
export async function stopJobs() {
  stopping = true;
  const runs = [...running.entries()];
  for (const [, r] of runs) r.controller.abort(new LeaseLost('job', 'the instance is stopping'));
  await Promise.all(runs.filter(([, r]) => r.token).map(([name, r]) => release(name, r.token, null)));
  return runs.map(([name]) => name);
}

/** A lease a little shorter than the interval, so the next tick can take it again. */
export const leaseFor = (intervalMs: number) => Math.max(30_000, Math.floor(intervalMs * 0.9));
export const leaseHolder = () => ME;

/** For tests: forget a stop, so later tests in the same process can run jobs. */
export const _resetForTests = () => {
  stopping = false;
};
