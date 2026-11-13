/**
 * Every background job's tick, by name, so something outside the process can
 * run them (routes/internalJobs.ts).
 *
 * Why: the API runs on Cloud Run, which scales to zero and gives an instance
 * CPU only while it serves a request. The jobs started in index.ts run on
 * in-process timers, so with no traffic they do not run at all: a leave
 * request is never handed on to HR, a dated change is not applied, a lapse
 * notice is not sent. Cloud Scheduler calls the wake endpoint every few
 * minutes; the endpoint runs each registered tick once and waits for it, so
 * the work happens inside a request, with CPU.
 *
 * Running a tick more often than its interval is safe: each tick takes its
 * job's lease (services/jobLease.ts `exclusive`), which is held for most of
 * the interval, so a daily job still runs once a day however often it is
 * woken. What a job does is decided from the database (what is due, what
 * was already sent), so a run after downtime catches up instead of losing
 * the days it missed.
 */
import { AsyncLocalStorage } from 'node:async_hooks';

type Tick = () => unknown;

const jobs = new Map<string, { tick: Tick; everyMs: number }>();
/* When this instance last woke each job. The lease keeps two instances from
   running a job in one period, but it lets the instance that ran it take it
   again (the five-second outbox depends on that), so the wake path keeps its
   own per-instance gate: a job is woken at most once per its interval. */
const lastWoken = new Map<string, number>();

/** Called by each job's start function with the same tick its timer runs and the timer's interval. */
export function registerJob(name: string, tick: Tick, everyMs = 0) {
  jobs.set(name, { tick, everyMs });
}

export const registeredJobs = () => [...jobs.keys()];

/*
 * Which leases a registered job takes, learnt as it is woken. A job's run
 * history (JobRun) is kept under its lease name ("people.outbox"), not the
 * name it registered with ("startPeopleOutbox"), and one job may take several
 * leases with periods of their own (a tick every 15 minutes that does a daily
 * piece of work under a day-long lease). The health check (services/ops/
 * jobHealth.ts) needs both: which workers belong to a registered job, and how
 * often each is meant to run. `exclusive` reports them here while a wake is
 * running the job; a lease taken outside a wake (a once-per-deploy backfill)
 * is nobody's to watch.
 */
const waking = new AsyncLocalStorage<string>();
const workers = new Map<string, { job: string; periodMs: number }>();

/** Called by jobLease.exclusive: this lease, held for this long, was asked for. Counts only inside a wake. */
export function noteWorker(worker: string, leaseMs: number) {
  const job = waking.getStore();
  if (job) workers.set(worker, { job, periodMs: leaseMs });
}

/** Every worker a wake on this instance has seen a registered job ask for, with its period (its lease). */
export const knownWorkers = () => [...workers].map(([worker, w]) => ({ worker, ...w }));

export type JobRun = { name: string; ok: boolean; ms: number; error?: string; timedOut?: boolean; skipped?: boolean };

/**
 * Run every registered tick once, side by side, and wait for them. A tick
 * that outlives `budgetMs` is reported as timed out; it keeps running under
 * its lease (its heartbeat keeps the lease), and the next wake skips it.
 */
export async function runRegisteredJobs({ budgetMs = 240_000, only, now = Date.now }: { budgetMs?: number; only?: string[]; now?: () => number } = {}): Promise<JobRun[]> {
  const chosen = [...jobs].filter(([name]) => !only?.length || only.includes(name));
  return Promise.all(
    chosen.map(async ([name, { tick, everyMs }]) => {
      const last = lastWoken.get(name);
      /* 5% slack: a scheduler firing every 15 minutes still wakes a 15-minute job each time. */
      if (last !== undefined && now() - last < everyMs * 0.95) return { name, ok: true, ms: 0, skipped: true };
      lastWoken.set(name, now());
      const start = Date.now();
      let timer: NodeJS.Timeout | undefined;
      const timeout = new Promise<'timeout'>((resolve) => {
        timer = setTimeout(() => resolve('timeout'), budgetMs);
      });
      try {
        const out = await Promise.race([Promise.resolve().then(() => waking.run(name, tick)), timeout]);
        return out === 'timeout' ? { name, ok: false, timedOut: true, ms: Date.now() - start } : { name, ok: true, ms: Date.now() - start };
      } catch (e) {
        /* A failed run may be retried at the next wake, not a period later. */
        lastWoken.delete(name);
        return { name, ok: false, ms: Date.now() - start, error: e instanceof Error ? e.message : String(e) };
      } finally {
        clearTimeout(timer);
      }
    }),
  );
}

/** Tests only. */
export const clearRegisteredJobs = () => {
  jobs.clear();
  lastWoken.clear();
  workers.clear();
};
