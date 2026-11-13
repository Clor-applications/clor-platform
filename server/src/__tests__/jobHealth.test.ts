import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';

/**
 * The job-health check (services/ops/jobHealth.ts): a registered job that has
 * stopped, or whose runs keep failing, raises one alert for CLOR staff from
 * the wake call, and the alert closes when the job is well again.
 */
const mails: Array<{ key: string; to: string; data: any }> = [];
vi.mock('../services/mailer.js', async (importOriginal) => {
  const real: any = await importOriginal();
  return { ...real, sendTemplate: async (o: any) => { mails.push({ key: o.templateKey, to: o.to, data: o.data }); return { status: 'SENT' }; } };
});

const { buildApp } = await import('../app.js');
const { platformPrisma } = await import('../utils/platformPrisma.js');
const { outsideTenant } = await import('../utils/tenantScope.js');
const { registerJob, runRegisteredJobs, knownWorkers } = await import('../services/jobRegistry.js');
const { exclusive, leaseFor } = await import('../services/jobLease.js');
const { checkJobHealth, judgeWorker, JOB_RULES } = await import('../services/ops/jobHealth.js');
const { collectFindings, syncAlerts, JOB_HEALTH_KEY } = await import('../services/ops/alerts.js');
const { opsKit, rnd } = await import('./opsTestKit.js');

const app = buildApp().listen(0, '127.0.0.1');
afterAll(() => new Promise((done) => app.close(done)));
afterEach(() => {
  delete process.env.JOBS_TOKEN;
});
const { staff } = opsKit(app);
const db = <T>(fn: () => Promise<T>) => outsideTenant('test: job health', fn);
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

const run = (agoMs: number, outcome = 'OK', error: string | null = null, now = Date.now()) => ({ startedAt: new Date(now - agoMs), finishedAt: outcome === 'RUNNING' ? null : new Date(now - agoMs + 500), outcome, error });
const spec = (periodMs: number, worker = 'test.worker') => ({ worker, job: 'startTest', periodMs });
const alertsFor = (worker: string) => db(() => platformPrisma.opsAlert.findMany({ where: { key: `${JOB_HEALTH_KEY}${worker}` }, orderBy: { firstSeenAt: 'asc' } }));
const seed = (worker: string, rows: ReturnType<typeof run>[]) => db(() => platformPrisma.jobRun.createMany({ data: rows.map((r) => ({ worker, holder: 'test', ...r })) }));

describe('judging one worker from its run history', () => {
  const now = Date.now();
  const wake = 5 * MIN;

  it('is well while its last good run is inside three periods', () => {
    expect(judgeWorker(spec(HOUR), [run(2 * HOUR), run(3 * HOUR), run(4 * HOUR)], new Date(now - 2 * HOUR), now, wake)).toEqual({ state: 'ok' });
  });

  it('has stopped when its last good run is older than three periods', () => {
    const v = judgeWorker(spec(HOUR), [run(4 * HOUR), run(5 * HOUR), run(6 * HOUR)], new Date(now - 4 * HOUR), now, wake);
    expect(v).toMatchObject({ state: 'stopped' });
    expect((v as any).title).toBe('Background job has stopped: test worker');
    expect((v as any).detail).toMatch(/last good run was 4 hours ago/);
  });

  it('a five-second job is measured against the wake interval, not five seconds', () => {
    const s = spec(4_500);
    expect(judgeWorker(s, [run(10 * MIN), run(15 * MIN)], new Date(now - 10 * MIN), now, wake)).toEqual({ state: 'ok' });
    expect(judgeWorker(s, [run(40 * MIN), run(45 * MIN)], new Date(now - 40 * MIN), now, wake)).toMatchObject({ state: 'stopped' });
  });

  it('a job that takes its lease once a day is not late the same afternoon, whatever its tick interval', () => {
    const daily = [run(8 * HOUR), run(32 * HOUR), run(56 * HOUR), run(80 * HOUR)];
    expect(judgeWorker(spec(15 * MIN), daily, new Date(now - 8 * HOUR), now, wake)).toEqual({ state: 'ok' });
    /* ...and is, once three of its usual days have gone by. */
    const gone = daily.map((r) => run(now - r.startedAt.getTime() + 3 * DAY));
    expect(judgeWorker(spec(15 * MIN), gone, gone[0].startedAt, now, wake)).toMatchObject({ state: 'stopped' });
  });

  it('is failing when its last three runs all failed, with the error said', () => {
    const v = judgeWorker(spec(HOUR), [run(10 * MIN, 'FAILED', 'relation "X" does not exist'), run(70 * MIN, 'FAILED', 'x'), run(130 * MIN, 'FAILED', 'x'), run(190 * MIN)], new Date(now - 190 * MIN), now, wake);
    expect(v).toMatchObject({ state: 'failing', title: 'Background job keeps failing: test worker' });
    expect((v as any).detail).toMatch(/relation "X" does not exist/);
    expect(JOB_RULES.failedRuns).toBe(3);
  });

  it('two failures and then a good run is not failing; nor is one stopped because its instance was shutting down', () => {
    expect(judgeWorker(spec(HOUR), [run(10 * MIN), run(70 * MIN, 'FAILED', 'x'), run(130 * MIN, 'FAILED', 'x')], new Date(now - 10 * MIN), now, wake)).toEqual({ state: 'ok' });
    expect(judgeWorker(spec(HOUR), [run(5 * MIN, 'STOPPED'), run(10 * MIN, 'STOPPED'), run(20 * MIN, 'STOPPED'), run(70 * MIN)], new Date(now - 70 * MIN), now, wake)).toEqual({ state: 'ok' });
  });

  it('runs that start and never finish (the wake call timed out, the instance went away) count as failed', () => {
    const v = judgeWorker(spec(HOUR), [run(2 * HOUR, 'RUNNING'), run(3 * HOUR, 'RUNNING'), run(4 * HOUR, 'RUNNING'), run(5 * HOUR)], new Date(now - 5 * HOUR), now, wake);
    expect(v).toMatchObject({ state: 'failing' });
    expect((v as any).detail).toMatch(/start and never finish/);
    /* A run under way right now is not one of them. */
    expect(judgeWorker(spec(HOUR), [run(2 * MIN, 'RUNNING'), run(HOUR), run(2 * HOUR)], new Date(now - HOUR), now, wake)).toEqual({ state: 'ok' });
  });

  it('with no run on record there is nothing to judge', () => {
    expect(judgeWorker(spec(HOUR), [], null, now, wake)).toEqual({ state: 'unknown' });
  });
});

describe('which workers are watched', () => {
  it('a lease taken by a registered job during a wake is learnt, with its period; one taken outside a wake is not', async () => {
    const worker = `test.learn.${rnd()}`;
    registerJob(`start.${worker}`, () => exclusive(worker, leaseFor(HOUR), async () => 1), HOUR);
    await exclusive(`test.oneoff.${worker}`, 30_000, async () => 1);
    expect(knownWorkers().find((w) => w.worker === worker)).toBeUndefined();
    await db(() => runRegisteredJobs({ only: [`start.${worker}`] }));
    expect(knownWorkers().find((w) => w.worker === worker)).toEqual({ worker, job: `start.${worker}`, periodMs: leaseFor(HOUR) });
    expect(knownWorkers().some((w) => w.worker === `test.oneoff.${worker}`)).toBe(false);
  });
});

describe('the alert', () => {
  it('opens once for a job that has stopped, is mailed once, stays one row, and closes when the job runs again', async () => {
    const sup = await staff('SUPPORT');
    const worker = `test.stopped.${rnd()}`;
    const s = [{ worker, job: 'startStopped', periodMs: HOUR }];
    await seed(worker, [run(5 * HOUR), run(6 * HOUR), run(7 * HOUR)]);
    mails.length = 0;

    const first = await db(() => checkJobHealth(Date.now(), s));
    expect(first).toMatchObject({ checked: 1, opened: 1, unhealthy: [{ worker, state: 'stopped' }] });
    const [a] = await alertsFor(worker);
    expect(a).toMatchObject({ kind: 'worker', severity: 'critical', audience: 'SUPPORT', resolvedAt: null });
    expect(a.title).toMatch(/has stopped/);
    const mine = mails.filter((m) => m.key === 'ops.alerts_opened' && m.to === sup.email);
    expect(mine).toHaveLength(1);
    expect(mine[0].data.list).toMatch(/has stopped/);

    /* Still stopped at the next wake: the same alert, refreshed, and no second mail. */
    const second = await db(() => checkJobHealth(Date.now() + 5 * MIN, s));
    expect(second).toMatchObject({ opened: 0, cleared: 0 });
    expect(await alertsFor(worker)).toHaveLength(1);
    expect(mails.filter((m) => m.to === sup.email)).toHaveLength(1);

    /* The alerts job, which closes what it did not find, leaves it alone and does not raise its own for the worker. */
    const findings = await db(() => collectFindings(Date.now()));
    expect(findings.some((f) => f.key === `worker-late:${worker}` || f.key === `worker:${worker}`)).toBe(false);
    const others = (await db(() => platformPrisma.opsAlert.findMany({ where: { resolvedAt: null, NOT: { key: { startsWith: JOB_HEALTH_KEY } } } }))).map((x) => ({ key: x.key, kind: x.kind as any, severity: x.severity as any, audience: x.audience as any, title: x.title }));
    await db(() => syncAlerts(others));
    expect((await alertsFor(worker))[0].resolvedAt).toBeNull();

    /* It runs again. */
    await seed(worker, [run(MIN)]);
    const third = await db(() => checkJobHealth(Date.now(), s));
    expect(third).toMatchObject({ unhealthy: [], cleared: 1 });
    expect((await alertsFor(worker))[0].resolvedAt).not.toBeNull();

    /* And if it stops again later, that is a new alert. */
    const later = await db(() => checkJobHealth(Date.now() + 2 * DAY, s));
    expect(later.opened).toBe(1);
    expect(await alertsFor(worker)).toHaveLength(2);
    await db(() => platformPrisma.opsAlert.updateMany({ where: { key: `${JOB_HEALTH_KEY}${worker}` }, data: { resolvedAt: new Date() } }));
    await db(() => platformPrisma.jobRun.deleteMany({ where: { worker } }));
  }, 60_000);

  it('two checks at the same moment open one alert', async () => {
    const worker = `test.race.${rnd()}`;
    const s = [{ worker, job: 'startRace', periodMs: HOUR }];
    await seed(worker, [run(9 * HOUR), run(10 * HOUR)]);
    const both = await Promise.all([db(() => checkJobHealth(Date.now(), s)), db(() => checkJobHealth(Date.now(), s))]);
    expect(both[0].opened + both[1].opened).toBe(1);
    expect(await alertsFor(worker)).toHaveLength(1);
    await db(() => platformPrisma.opsAlert.updateMany({ where: { key: `${JOB_HEALTH_KEY}${worker}` }, data: { resolvedAt: new Date() } }));
    await db(() => platformPrisma.jobRun.deleteMany({ where: { worker } }));
  });

  it('an open alert is kept while its worker has no history to judge, and closed a day after its job is no longer registered', async () => {
    const worker = `test.orphan.${rnd()}`;
    const s = [{ worker, job: 'startOrphan', periodMs: HOUR }];
    await seed(worker, [run(9 * HOUR), run(10 * HOUR)]);
    await db(() => checkJobHealth(Date.now(), s));
    /* The history is pruned away while the job is still stopped: the alert must not close itself. */
    await db(() => platformPrisma.jobRun.deleteMany({ where: { worker } }));
    expect(await db(() => checkJobHealth(Date.now() + HOUR, s))).toMatchObject({ cleared: 0, opened: 0 });
    expect((await alertsFor(worker))[0].resolvedAt).toBeNull();
    /* No instance registers the job any more. */
    expect((await db(() => checkJobHealth(Date.now() + 2 * HOUR, []))).cleared).toBe(0);
    expect((await db(() => checkJobHealth(Date.now() + 2 * DAY, []))).cleared).toBeGreaterThanOrEqual(1);
    expect((await alertsFor(worker))[0].resolvedAt).not.toBeNull();
  });
});

describe('from the wake call', () => {
  it('a job whose tick swallows its own failures answers 200 each time, and the third wake raises the alert', async () => {
    process.env.JOBS_TOKEN = 'right-token';
    const worker = `test.quiet.${rnd()}`;
    const job = `start.${worker}`;
    let healthy = false;
    /* As most jobs are written: the tick catches and logs, so the wake call never sees the error. */
    registerJob(job, () => exclusive(worker, 1, async () => { if (!healthy) throw new Error('cannot reach the mail server'); return 1; }).catch(() => null), 0);
    const wake = () => request(app).post('/api/internal/jobs/tick').set('x-jobs-token', 'right-token').send({ only: [job] });

    const r1 = await wake().expect(200);
    expect(r1.body.health).toMatchObject({ unhealthy: [] });
    await wake().expect(200);
    const r3 = await wake().expect(200);
    expect(r3.body.health.unhealthy).toContainEqual({ worker, state: 'failing' });
    const [a] = await alertsFor(worker);
    expect(a.title).toMatch(/keeps failing/);
    expect(a.detail).toMatch(/cannot reach the mail server/);

    healthy = true;
    const r4 = await wake().expect(200);
    expect(r4.body.health.unhealthy.some((u: any) => u.worker === worker)).toBe(false);
    expect((await alertsFor(worker))[0].resolvedAt).not.toBeNull();
  }, 60_000);
});
