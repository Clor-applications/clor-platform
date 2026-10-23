import { describe, it, expect, afterAll, vi } from 'vitest';

/**
 * A-43: the lease that keeps a background job to one instance at a time.
 *
 * It failed open on any error (the job ran with no lease at all), had no
 * fencing, and let its own holder take it again while the first run was still
 * going — so a run longer than its lease, or a tick that fired while the last
 * one was still busy, ran the same job twice at once.
 *
 * A second API instance is a second copy of the module: resetting the module
 * registry gives it its own holder id and its own in-process state, exactly as
 * another process would have.
 */
const instance = async () => {
  vi.resetModules();
  const lease = await import('../services/jobLease.js');
  const { platformPrisma } = await import('../utils/platformPrisma.js');
  return { ...lease, platformPrisma };
};

const a = await instance();
const b = await instance();
afterAll(async () => {
  await a.platformPrisma.$disconnect();
  await b.platformPrisma.$disconnect();
});

const name = () => `test.safety.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A job that records how many copies of itself run at once. */
const probe = () => {
  let now = 0;
  let max = 0;
  let runs = 0;
  return {
    get max() { return max; },
    get runs() { return runs; },
    job: (ms: number) => async () => {
      now += 1;
      runs += 1;
      max = Math.max(max, now);
      await sleep(ms);
      now -= 1;
      return runs;
    },
  };
};

describe('A-43: a job lease', () => {
  it('fails closed: a lease that cannot be read is not a lease held', async () => {
    const job = name();
    const spy = vi.spyOn(a.platformPrisma.jobLease, 'updateMany').mockRejectedValueOnce(Object.assign(new Error('connection reset'), { code: 'P1017' }));
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    let ran = 0;
    try {
      expect(await a.exclusive(job, 60_000, async () => ++ran)).toBeNull();
      expect(ran).toBe(0);
    } finally {
      spy.mockRestore();
      quiet.mockRestore();
    }
  });

  it('runs an idempotent job when the lease table does not exist yet (P2021), and no other job', async () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const missing = () => Object.assign(new Error('The table `JobLease` does not exist'), { code: 'P2021' });
    const spy = vi.spyOn(a.platformPrisma.jobLease, 'updateMany').mockRejectedValueOnce(missing()).mockRejectedValueOnce(missing());
    try {
      let ran = 0;
      expect(await a.exclusive(name(), 60_000, async () => ++ran, { idempotent: true })).toBe(1);
      expect(await a.exclusive(name(), 60_000, async () => ++ran)).toBeNull();
      expect(ran).toBe(1);
    } finally {
      spy.mockRestore();
      quiet.mockRestore();
    }
  });

  it('never runs the same job twice at once in one instance', async () => {
    const job = name();
    const p = probe();
    const out = await Promise.all([a.exclusive(job, 60_000, p.job(400)), a.exclusive(job, 60_000, p.job(400))]);
    expect(p.max).toBe(1);
    expect(out.filter((x) => x === null)).toHaveLength(1);
  });

  it('keeps a run longer than its lease to one instance: the heartbeat renews it', async () => {
    const job = name();
    const p = probe();
    const ttl = 1_000;
    const first = a.exclusive(job, ttl, p.job(2_600));
    /* Past the lease the long run started with: on the old code it had expired and B took it. */
    await sleep(1_600);
    const second = await b.exclusive(job, ttl, p.job(100));
    await first;
    expect(second).toBeNull();
    expect(p.max).toBe(1);
    expect(p.runs).toBe(1);
  });

  it('fences: a run cut off by a takeover is told before its next irreversible step', async () => {
    const job = name();
    let lost: unknown = null;
    let tokenSeen = 0;
    await a.exclusive(job, 60_000, async () => {
      const lease = a.currentLease()!;
      tokenSeen = lease.token;
      await lease.assertHeld();
      /* Another instance takes over (as it would after this one's heartbeat went stale). */
      await a.platformPrisma.jobLease.update({ where: { name: job }, data: { holder: 'other-instance', token: { increment: 1 } } });
      try {
        await lease.assertHeld();
      } catch (e) {
        lost = e;
      }
    });
    expect(tokenSeen).toBeGreaterThan(0);
    expect(lost).toBeInstanceOf(a.LeaseLost);
    /* The newcomer's lease is untouched by the loser finishing. */
    expect((await a.platformPrisma.jobLease.findUniqueOrThrow({ where: { name: job } })).holder).toBe('other-instance');
  });

  it('bumps the fencing token on every take', async () => {
    const job = name();
    const tokens: number[] = [];
    const take = () => a.exclusive(job, 60_000, async () => { tokens.push(a.currentLease()!.token); });
    await take();
    await take();
    expect(tokens).toHaveLength(2);
    expect(tokens[1]).toBeGreaterThan(tokens[0]);
  });

  it('keeps the period after a successful run, so another instance skips it', async () => {
    const job = name();
    let ran = 0;
    expect(await a.exclusive(job, 60_000, async () => ++ran)).toBe(1);
    expect(await b.exclusive(job, 60_000, async () => ++ran)).toBeNull();
    expect(ran).toBe(1);
  });

  it('frees the lease when a run fails, so another instance can try at once', async () => {
    const job = name();
    await expect(a.exclusive(job, 60_000, async () => { throw new Error('boom'); })).rejects.toThrow('boom');
    let ran = 0;
    expect(await b.exclusive(job, 60_000, async () => ++ran)).toBe(1);
  });

  it('on SIGTERM: stops the run before its next step, starts nothing new and gives the lease back', async () => {
    const c = await instance();
    try {
      const job = name();
      const steps: string[] = [];
      const run = c.exclusive(job, 60_000, async () => {
        const lease = c.currentLease()!;
        for (const step of ['people', 'payroll', 'accounting', 'platform']) {
          await lease.assertHeld();
          steps.push(step);
          await sleep(150);
        }
      });
      await sleep(200);
      await c.stopJobs();
      await expect(run).rejects.toBeInstanceOf(c.LeaseLost);
      expect(steps.length).toBeLessThan(4);
      expect(await c.exclusive(name(), 60_000, async () => 1)).toBeNull();
      /* Another instance takes it at its next tick, not after the 60-second period. */
      let ran = 0;
      expect(await b.exclusive(job, 60_000, async () => ++ran)).toBe(1);
    } finally {
      await c.platformPrisma.$disconnect();
    }
  });
});
