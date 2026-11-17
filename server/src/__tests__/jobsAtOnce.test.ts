import { afterEach, describe, expect, it } from 'vitest';

import { clearRegisteredJobs, jobsAtOnce, registerJob, runRegisteredJobs } from '../services/jobRegistry.js';

/**
 * One wake runs the due jobs a few at a time, not all together (audit, 17 Nov
 * 2026: about forty side by side on nine database connections).
 */
afterEach(() => {
  clearRegisteredJobs();
  delete process.env.JOBS_CONCURRENCY;
});

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('how many jobs run at once', () => {
  it('never more than the limit, and every job still runs, reported in order', async () => {
    let running = 0;
    let most = 0;
    const ran: string[] = [];
    for (let i = 0; i < 12; i += 1) {
      registerJob(`job${i}`, async () => {
        running += 1;
        most = Math.max(most, running);
        await wait(15);
        ran.push(`job${i}`);
        running -= 1;
      }, 60_000);
    }
    const out = await runRegisteredJobs({ atOnce: 3 });
    expect(most).toBe(3);
    expect(ran).toHaveLength(12);
    expect(out.map((r) => r.name)).toEqual(Array.from({ length: 12 }, (_, i) => `job${i}`));
    expect(out.every((r) => r.ok && !r.skipped)).toBe(true);
  });

  it('a job that fails does not stop the ones behind it', async () => {
    const ran: string[] = [];
    registerJob('a', async () => { throw new Error('boom'); }, 60_000);
    registerJob('b', async () => { ran.push('b'); }, 60_000);
    registerJob('c', async () => { ran.push('c'); }, 60_000);
    const out = await runRegisteredJobs({ atOnce: 1 });
    expect(out[0]).toMatchObject({ name: 'a', ok: false, error: 'boom' });
    expect(ran).toEqual(['b', 'c']);
  });

  it('a job whose turn comes after the budget is left for the next wake, which runs it', async () => {
    const ran: string[] = [];
    registerJob('slow', async () => { await wait(60); ran.push('slow'); }, 60_000);
    registerJob('late', async () => { ran.push('late'); }, 60_000);
    const first = await runRegisteredJobs({ atOnce: 1, budgetMs: 20 });
    expect(first[0]).toMatchObject({ name: 'slow', ok: false, timedOut: true });
    expect(first[1]).toMatchObject({ name: 'late', skipped: true });
    expect(ran).not.toContain('late');
    await wait(60);
    const second = await runRegisteredJobs({ atOnce: 1 });
    expect(second.find((r) => r.name === 'late')).toMatchObject({ ok: true });
    expect(second.find((r) => r.name === 'late')?.skipped).toBeUndefined();
    expect(ran).toContain('late');
  });

  it('is four unless set, and stays between 1 and 16', () => {
    expect(jobsAtOnce()).toBe(4);
    process.env.JOBS_CONCURRENCY = '2';
    expect(jobsAtOnce()).toBe(2);
    process.env.JOBS_CONCURRENCY = '500';
    expect(jobsAtOnce()).toBe(16);
    process.env.JOBS_CONCURRENCY = '0';
    expect(jobsAtOnce()).toBe(4);
    process.env.JOBS_CONCURRENCY = 'many';
    expect(jobsAtOnce()).toBe(4);
  });
});
