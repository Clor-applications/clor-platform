import { describe, it, expect, afterAll } from 'vitest';

/**
 * Background jobs run once per period across every API instance: the
 * instance holding a job's lease runs it, the others skip, and an expired
 * lease (a crashed instance) is taken over.
 */
const { platformPrisma } = await import('../utils/platformPrisma.js');
const { exclusive, takeLease } = await import('../services/jobLease.js');
afterAll(async () => { await platformPrisma.$disconnect(); });

const name = () => `test.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`;

describe('job leases', () => {
  it('runs a job, and runs it again in the same instance next period', async () => {
    const job = name();
    let runs = 0;
    expect(await exclusive(job, 60_000, async () => ++runs)).toBe(1);
    expect(await exclusive(job, 60_000, async () => ++runs)).toBe(2);
  });

  it('skips a job another instance holds, and takes it once that lease expires', async () => {
    const job = name();
    await platformPrisma.jobLease.create({ data: { name: job, holder: 'other-instance', until: new Date(Date.now() + 60_000) } });
    let runs = 0;
    expect(await exclusive(job, 60_000, async () => ++runs)).toBeNull();
    expect(runs).toBe(0);
    await platformPrisma.jobLease.update({ where: { name: job }, data: { until: new Date(Date.now() - 1000) } });
    expect(await takeLease(job, 60_000)).toBe(true);
    expect((await platformPrisma.jobLease.findUniqueOrThrow({ where: { name: job } })).holder).not.toBe('other-instance');
  });
});

describe('readiness', () => {
  it('reports each database, separately from liveness', async () => {
    const request = (await import('supertest')).default;
    const { buildApp } = await import('../app.js');
    const app = buildApp();
    expect((await request(app).get('/health').expect(200)).body).toEqual({ ok: true });
    const r = await request(app).get('/ready').expect(200);
    expect(r.body).toEqual({ ok: true, checks: { accounting: true, payroll: true, people: true, platform: true } });
  });
});

describe('request ids', () => {
  it('gives every response an id, keeping a sane one the caller sent', async () => {
    const request = (await import('supertest')).default;
    const { buildApp } = await import('../app.js');
    const app = buildApp();
    const a = await request(app).get('/health').expect(200);
    expect(a.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    const b = await request(app).get('/health').set('X-Request-Id', 'abc12345-from-proxy').expect(200);
    expect(b.headers['x-request-id']).toBe('abc12345-from-proxy');
    const c = await request(app).get('/health').set('X-Request-Id', 'bad id with spaces <script>').expect(200);
    expect(c.headers['x-request-id']).not.toContain('script');
  });
});
