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

/** How many ticks run at once in one wake. JOBS_CONCURRENCY overrides (1 to 16). */
export const jobsAtOnce = () => {
  const n = Math.floor(Number(process.env.JOBS_CONCURRENCY));
  return Number.isFinite(n) && n >= 1 ? Math.min(16, n) : 4;
};

/**
 * Run every registered tick that is due, a few at a time, and wait for them.
 *
 * They used to start all together: about forty jobs side by side on the nine
 * database connections an instance has, several of them reading every
 * company, while customers' requests waited for a connection (audit, 17 Nov
 * 2026). Now at most `jobsAtOnce()` run at once; the rest wait their turn.
 *
 * `budgetMs` is for the whole wake. A tick still running when it ends is
 * reported as timed out; it keeps running under its lease (its heartbeat keeps
 * the lease), and the next wake skips it. A tick whose turn had not come when
 * the budget ended is not started and not marked as run, so the next wake
 * takes it first-come like any other due job.
 */
export async function runRegisteredJobs({ budgetMs = 240_000, only, now = Date.now, atOnce = jobsAtOnce() }: { budgetMs?: number; only?: string[]; now?: () => number; atOnce?: number } = {}): Promise<JobRun[]> {
  const chosen = [...jobs].filter(([name]) => !only?.length || only.includes(name));
  const deadline = Date.now() + budgetMs;
  const results: JobRun[] = new Array(chosen.length);

  const runOne = async ([name, { tick, everyMs }]: (typeof chosen)[number]): Promise<JobRun> => {
    const last = lastWoken.get(name);
    /* 5% slack: a scheduler firing every 15 minutes still wakes a 15-minute job each time. */
    if (last !== undefined && now() - last < everyMs * 0.95) return { name, ok: true, ms: 0, skipped: true };
    const left = deadline - Date.now();
    /* Its turn came too late: left for the next wake, which will find it due. A timer can fire a few
     * milliseconds before the clock reaches the deadline, so a sliver of time left counts as none. */
    if (left <= 10) return { name, ok: true, ms: 0, skipped: true };
    lastWoken.set(name, now());
    const start = Date.now();
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<'timeout'>((resolve) => {
      timer = setTimeout(() => resolve('timeout'), left);
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
  };

  let next = 0;
  const worker = async () => {
    for (let i = next++; i < chosen.length; i = next++) results[i] = await runOne(chosen[i]);
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(atOnce, chosen.length)) }, worker));
  return results;
}

/** Tests only. */
export const clearRegisteredJobs = () => {
  jobs.clear();
  lastWoken.clear();
  workers.clear();
};

/*
 * In-process timers take turns (23 Nov 2026).
 *
 * Each job started in index.ts has its own setInterval, and Cloud Run gives an
 * instance CPU only while it serves a request. Timers that came due while the
 * instance sat idle all fire the moment the next request arrives: some forty
 * ticks at once, each taking a lease and reading companies, on the same few
 * database connections the person opening a page needs. Pages took 5-40 s and
 * requests failed with "Timed out fetching a new connection from the
 * connection pool" (seen live, 23 Nov 2026).
 *
 * `jobTimersInTurn(start)` runs `start` (the block of start* calls) with the
 * timer functions wrapped, so every callback those calls schedule runs through
 * one shared queue: at most `jobTimersAtOnce()` in-process ticks at a time,
 * the rest wait. A callback that is still waiting or running when its timer
 * fires again is not queued a second time, so a slow job cannot pile up. Only
 * timers created while `start` runs synchronously are affected; a job's own
 * timers later (a lease heartbeat, a timeout race) behave as normal. The wake
 * call (runRegisteredJobs) has its own limit and is not affected.
 */

/** In-process ticks at once. JOB_TIMERS_AT_ONCE overrides (1 to 8). */
export const jobTimersAtOnce = () => {
  const n = Math.floor(Number(process.env.JOB_TIMERS_AT_ONCE));
  return Number.isFinite(n) && n >= 1 ? Math.min(8, n) : 1;
};

type Turn = () => unknown;
const waitingTurns: Array<() => void> = [];
let turnsRunning = 0;

/** Run `fn` when a turn is free; resolves with whatever it returns. */
export function inTurn<T>(fn: () => T | Promise<T>, atOnce = jobTimersAtOnce()): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const go = () => {
      turnsRunning += 1;
      Promise.resolve()
        .then(fn)
        .then(resolve, reject)
        .finally(() => {
          turnsRunning -= 1;
          waitingTurns.shift()?.();
        });
    };
    if (turnsRunning < atOnce) go();
    else waitingTurns.push(go);
  });
}

/** A timer callback that waits for its turn and is never queued twice. */
export function takingTurns(cb: Turn, name = cb.name || 'job timer'): () => void {
  let pending = false;
  return () => {
    if (pending) return;
    pending = true;
    inTurn(cb)
      .catch((e) => console.error(`[jobs] ${name} failed:`, e instanceof Error ? e.message : e)) // eslint-disable-line no-console
      .finally(() => {
        pending = false;
      });
  };
}

/** Run `start` with every timer it schedules taking turns (see above). */
export function jobTimersInTurn(start: () => void): void {
  const realInterval = globalThis.setInterval;
  const realTimeout = globalThis.setTimeout;
  const wrap = (cb: unknown, args: unknown[]) => (typeof cb === 'function' ? takingTurns(() => (cb as (...a: unknown[]) => unknown)(...args), cb.name) : cb);
  globalThis.setInterval = ((cb: unknown, ms?: number, ...args: unknown[]) => realInterval(wrap(cb, args) as () => void, ms)) as typeof setInterval;
  globalThis.setTimeout = ((cb: unknown, ms?: number, ...args: unknown[]) => realTimeout(wrap(cb, args) as () => void, ms)) as typeof setTimeout;
  try {
    start();
  } finally {
    globalThis.setInterval = realInterval;
    globalThis.setTimeout = realTimeout;
  }
}
