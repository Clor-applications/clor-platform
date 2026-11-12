import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildApp } from '../app.js';
import { clearRegisteredJobs, registerJob, registeredJobs, runRegisteredJobs } from '../services/jobRegistry.js';
import { exclusive, leaseFor } from '../services/jobLease.js';
import { startLeaveJobs } from '../services/attendance/leaveJobs.js';

/**
 * Cloud Run scales to zero and gives CPU only during a request, so the
 * background jobs run when Cloud Scheduler wakes them through
 * POST /api/internal/jobs/tick (services/jobRegistry.ts).
 */
const app = buildApp().listen(0, '127.0.0.1');
afterAll(() => app.close());
afterEach(() => {
  delete process.env.JOBS_TOKEN;
});

describe('the job registry', () => {
  beforeAll(() => clearRegisteredJobs());

  it('runs every registered tick once and reports each', async () => {
    let a = 0;
    registerJob('test.a', async () => { a += 1; });
    registerJob('test.b', async () => { throw new Error('boom'); });
    const runs = await runRegisteredJobs({ only: ['test.a', 'test.b'] });
    expect(a).toBe(1);
    expect(runs.find((r) => r.name === 'test.a')).toMatchObject({ ok: true });
    expect(runs.find((r) => r.name === 'test.b')).toMatchObject({ ok: false, error: 'boom' });
  });

  it('reports a tick that outlives its budget as timed out, without waiting for it', async () => {
    registerJob('test.slow', () => new Promise((r) => setTimeout(r, 2_000)));
    const t = Date.now();
    const [run] = await runRegisteredJobs({ only: ['test.slow'], budgetMs: 100 });
    expect(run).toMatchObject({ name: 'test.slow', ok: false, timedOut: true });
    expect(Date.now() - t).toBeLessThan(1_500);
  });

  it('a job woken twice inside its interval runs once, and again once its interval has passed', async () => {
    let runs = 0;
    const name = `test.lease.${Date.now()}`;
    registerJob(name, () => exclusive(name, leaseFor(3_600_000), async () => { runs += 1; }), 3_600_000);
    let clock = Date.now();
    await runRegisteredJobs({ only: [name], now: () => clock });
    const again = await runRegisteredJobs({ only: [name], now: () => clock + 60_000 });
    expect(again[0]).toMatchObject({ skipped: true });
    expect(runs).toBe(1);
    clock += 3_600_000;
    await runRegisteredJobs({ only: [name], now: () => clock });
    expect(runs).toBe(2);
  });

  it('another instance holding the lease stops the run, whatever this instance woke', async () => {
    const { platformPrisma } = await import('../utils/platformPrisma.js');
    const name = `test.other.${Date.now()}`;
    await platformPrisma.jobLease.create({ data: { name, holder: 'other-instance', until: new Date(Date.now() + 60_000) } });
    let runs = 0;
    registerJob(name, () => exclusive(name, leaseFor(3_600_000), async () => { runs += 1; }), 3_600_000);
    await runRegisteredJobs({ only: [name] });
    expect(runs).toBe(0);
  });

  it('a failed run is retried at the next wake, not a period later', async () => {
    let tries = 0;
    registerJob('test.retry', async () => { tries += 1; if (tries === 1) throw new Error('first fails'); }, 3_600_000);
    await runRegisteredJobs({ only: ['test.retry'] });
    await runRegisteredJobs({ only: ['test.retry'] });
    expect(tries).toBe(2);
  });

  it('the leave automation registers itself when it starts', () => {
    const stop = startLeaveJobs({ startupDelayMs: 3_600_000 });
    expect(registeredJobs()).toContain('startLeaveJobs');
    stop();
  });
});

describe('POST /api/internal/jobs/tick', () => {
  it('does not exist without JOBS_TOKEN', async () => {
    await request(app).post('/api/internal/jobs/tick').expect(404);
  });

  it('refuses a missing or wrong token', async () => {
    process.env.JOBS_TOKEN = 'right-token';
    await request(app).post('/api/internal/jobs/tick').expect(401);
    await request(app).post('/api/internal/jobs/tick').set('x-jobs-token', 'wrong').expect(401);
  });

  it('runs the jobs with the right token, and fails the call when a job threw so the scheduler retries', async () => {
    process.env.JOBS_TOKEN = 'right-token';
    let ran = 0;
    registerJob('test.route', async () => { ran += 1; });
    const ok = await request(app).post('/api/internal/jobs/tick').set('x-jobs-token', 'right-token').send({ only: ['test.route'] }).expect(200);
    expect(ok.body).toMatchObject({ ran: 1, failed: 0 });
    expect(ran).toBe(1);
    registerJob('test.route.bad', async () => { throw new Error('no'); });
    const bad = await request(app).post('/api/internal/jobs/tick').set('x-jobs-token', 'right-token').send({ only: ['test.route.bad'] }).expect(500);
    expect(bad.body.runs[0]).toMatchObject({ name: 'test.route.bad', ok: false });
  });

  it('a job woken by the scheduler reads across companies, as it does from the in-process timer', async () => {
    // The wake call is an HTTP request, and a request starts in a strict scope with no
    // company, where row security shows nothing. Jobs such as recurring invoices then
    // finished "ok" having read zero rows (platform audit, 11 Nov 2026).
    process.env.JOBS_TOKEN = 'right-token';
    const { platformPrisma } = await import('../utils/platformPrisma.js');
    const seen: string[] = [];
    registerJob('test.route.scope', async () => {
      const [row] = await platformPrisma.$queryRaw<{ b: string | null }[]>`SELECT current_setting('clor.bypass', true) AS b`;
      seen.push(String(row?.b));
    });
    await request(app).post('/api/internal/jobs/tick').set('x-jobs-token', 'right-token').send({ only: ['test.route.scope'] }).expect(200);
    await runRegisteredJobs({ only: ['test.route.scope'] });
    expect(seen).toEqual(['on', 'on']);
  });
});
