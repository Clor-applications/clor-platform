import { platformPrisma } from '../../utils/platformPrisma.js';
import { knownWorkers } from '../jobRegistry.js';
import { JOB_HEALTH_KEY, tellStaff } from './alerts.js';

/**
 * Is every registered background job still doing its work? (Platform audit,
 * 11 Nov 2026.)
 *
 * A job that throws makes the wake call answer 500, and Cloud Scheduler's own
 * alert catches that. Two failures raised nothing:
 *
 *  - a job that fails quietly. Most ticks catch their own error and log it, so
 *    the wake call answers 200 while every run is recorded FAILED; and a run
 *    that outlives the wake call is "timed out" there and then forgotten.
 *  - a job that stops. Its lease can no longer be taken, its tick returns
 *    early, the instance is always stopped mid-run: nothing fails, the work
 *    just is not done.
 *
 * This check runs at the end of every wake call (routes/internalJobs.ts), not
 * as a job of its own: it must not depend on the thing it watches. For each
 * worker a registered job runs (jobRegistry.ts `knownWorkers`) it reads the
 * run history and raises one alert for CLOR staff when
 *
 *  - its last finished-well run is older than about three of its periods, or
 *  - its last three runs all failed (or never finished).
 *
 * The alert is one row per worker while the problem lasts (the open-alert
 * index allows one), mailed once when it opens, and closed by the first check
 * that finds the worker well again.
 *
 * A worker's period is its lease (a little under the job's interval), but
 * never less than the wake interval — on Cloud Run a five-second job runs
 * when it is woken, not every five seconds — and never less than the gap it
 * has usually kept, so a job that takes its lease only on Monday mornings is
 * not called late on Tuesday.
 */
const MIN = 60_000;
const HOUR = 60 * MIN;

export const JOB_RULES = {
  /** No good run in this many periods: the job has stopped. */
  stalePeriods: 3,
  /** This many runs in a row failed: the job is failing. */
  failedRuns: 3,
};

/** How often Cloud Scheduler wakes the jobs (deploy/cloudrun.service.yaml records the schedule). */
export const wakeEveryMs = () => Math.max(MIN, Number(process.env.JOBS_WAKE_EVERY_MS) || 5 * MIN);

export type RunLine = { startedAt: Date; finishedAt: Date | null; outcome: string; error: string | null };
export type Verdict =
  | { state: 'ok' }
  /** Nothing to go on (no run on record): an alert already open stays, none is opened. */
  | { state: 'unknown' }
  | { state: 'stopped' | 'failing'; title: string; detail: string };

const jobName = (w: string) => w.replace(/^start(?=[A-Z])/, '').replace(/[._-]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().trim();
const span = (ms: number) => (ms >= 48 * HOUR ? `${Math.round(ms / (24 * HOUR))} days` : ms >= 2 * HOUR ? `${Math.round(ms / HOUR)} hours` : `${Math.max(1, Math.round(ms / MIN))} minutes`);

/**
 * One worker, from its newest runs (newest first) and the start of its last
 * good run. Pure, so the rules can be read and tested without a database.
 */
export function judgeWorker(spec: { worker: string; job: string; periodMs: number }, runs: RunLine[], lastOkAt: Date | null, now = Date.now(), wakeMs = wakeEveryMs()): Verdict {
  if (!runs.length) return { state: 'unknown' };
  const gaps: number[] = [];
  for (let i = 0; i + 1 < runs.length; i += 1) gaps.push(runs[i].startedAt.getTime() - runs[i + 1].startedAt.getTime());
  gaps.sort((a, b) => a - b);
  const usualGap = gaps.length ? gaps[Math.floor(gaps.length / 2)] : 0;
  const period = Math.max(spec.periodMs, wakeMs, usualGap);
  const name = jobName(spec.worker);

  /* A run still RUNNING long after it began was cut off (the instance went away) or is hung: it did not do its work. */
  const stuck = (r: RunLine) => r.outcome === 'RUNNING' && now - r.startedAt.getTime() > Math.max(period, HOUR);
  /* Not evidence either way: a run under way now, and one stopped because its instance was shutting down. */
  const counted = runs.filter((r) => r.outcome === 'OK' || r.outcome === 'FAILED' || stuck(r));
  const lastFew = counted.slice(0, JOB_RULES.failedRuns);
  if (lastFew.length === JOB_RULES.failedRuns && lastFew.every((r) => r.outcome !== 'OK')) {
    const why = lastFew.find((r) => r.error)?.error || (lastFew.some(stuck) ? 'Its runs start and never finish.' : 'No reason was recorded.');
    return {
      state: 'failing',
      title: `Background job keeps failing: ${name}`,
      detail: `Its last ${JOB_RULES.failedRuns} runs did not finish well. Last error: ${String(why).slice(0, 300)}${lastOkAt ? ` Last good run ${span(now - lastOkAt.getTime())} ago.` : ''} Tell engineering.`,
    };
  }

  /* With no good run on record, the clock starts at the oldest run we can see. */
  const since = lastOkAt ?? runs[runs.length - 1].startedAt;
  const quiet = now - since.getTime();
  if (quiet > JOB_RULES.stalePeriods * period) {
    return {
      state: 'stopped',
      title: `Background job has stopped: ${name}`,
      detail: `${lastOkAt ? `Its last good run was ${span(quiet)} ago` : `It has not finished a run in ${span(quiet)}`}; it should run about every ${span(period)}. Check the scheduler that wakes the jobs, then tell engineering.`,
    };
  }
  return { state: 'ok' };
}

/** How many of a worker's newest runs are read: enough for three failures and a usual gap. */
const RECENT = 8;

async function historyOf(worker: string) {
  const runs = await platformPrisma.jobRun.findMany({ where: { worker }, orderBy: { startedAt: 'desc' }, take: RECENT, select: { startedAt: true, finishedAt: true, outcome: true, error: true } });
  const recentOk = runs.find((r) => r.outcome === 'OK');
  const lastOk = recentOk ?? (runs.length ? await platformPrisma.jobRun.findFirst({ where: { worker, outcome: 'OK' }, orderBy: { startedAt: 'desc' }, select: { startedAt: true } }) : null);
  return { runs, lastOkAt: lastOk?.startedAt ?? null };
}

/** An alert nobody has vouched for in this long belongs to a job that is no longer registered anywhere. */
const ORPHAN_MS = 24 * HOUR;

/**
 * Judge every known worker and bring the job-health alerts in line. Callers
 * run it outside any company (it reads platform tables only).
 */
export async function checkJobHealth(now = Date.now(), specs = knownWorkers()) {
  const verdicts = new Map<string, Verdict>();
  for (const spec of specs) {
    const { runs, lastOkAt } = await historyOf(spec.worker);
    verdicts.set(spec.worker, judgeWorker(spec, runs, lastOkAt, now));
  }

  const at = new Date(now);
  const open = await platformPrisma.opsAlert.findMany({ where: { resolvedAt: null, key: { startsWith: JOB_HEALTH_KEY } } });
  const openByKey = new Map(open.map((a) => [a.key, a]));
  const opened: typeof open = [];
  const unhealthy: Array<{ worker: string; state: string }> = [];

  for (const [worker, v] of verdicts) {
    const key = `${JOB_HEALTH_KEY}${worker}`;
    const was = openByKey.get(key);
    if (v.state === 'unknown') {
      if (was) await platformPrisma.opsAlert.update({ where: { id: was.id }, data: { lastSeenAt: at } });
      continue;
    }
    if (v.state === 'ok') continue;
    unhealthy.push({ worker, state: v.state });
    const data = { kind: 'worker', severity: 'critical', audience: 'SUPPORT', title: v.title, detail: v.detail, link: { page: 'health' } as any, lastSeenAt: at };
    if (was) {
      await platformPrisma.opsAlert.update({ where: { id: was.id }, data });
      continue;
    }
    try {
      opened.push(await platformPrisma.opsAlert.create({ data: { key, firstSeenAt: at, ...data } }));
    } catch (e: any) {
      /* Another instance opened it a moment ago (one open alert per key); it mails. */
      if (e?.code !== 'P2002') throw e;
    }
  }

  /* Closed: the worker is well again, or no instance has seen its job registered for a day. */
  const cleared = open
    .filter((a) => {
      const v = verdicts.get(a.key.slice(JOB_HEALTH_KEY.length));
      return v ? v.state === 'ok' : now - a.lastSeenAt.getTime() > ORPHAN_MS;
    })
    .map((a) => a.id);
  if (cleared.length) await platformPrisma.opsAlert.updateMany({ where: { id: { in: cleared }, resolvedAt: null }, data: { resolvedAt: at } });

  const told = await tellStaff(opened).catch(() => 0);
  return { checked: verdicts.size, unhealthy, opened: opened.length, cleared: cleared.length, told };
}
