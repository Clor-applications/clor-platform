import { describe, it, expect, afterAll, vi } from 'vitest';
import request from 'supertest';

/*
 * A-30: routes that learn their company from a token — directory sync,
 * readers, push sources, share and pay links — ran with no company in scope,
 * so row-level security was no backstop behind them.
 * A-37: inside one client's interactive transaction, queries through the
 * other three clients (and through the same client outside `tx`) were
 * marked "in a transaction" and sent with no company at all.
 */

const seen: string[] = [];
vi.mock('../services/attendance/punches.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../services/attendance/punches.js')>();
  const { currentOrg } = await import('../utils/tenantScope.js');
  return {
    ...real,
    ingestPunches: (...args: Parameters<typeof real.ingestPunches>) => {
      seen.push(currentOrg());
      return real.ingestPunches(...args);
    },
  };
});

const { buildApp } = await import('../app.js');
const { enterTenant, currentOrg, runInTenant } = await import('../utils/tenantScope.js');
const { prisma } = await import('../utils/prisma.js');
const { payrollPrisma } = await import('../utils/payrollPrisma.js');
const { peoplePrisma } = await import('../utils/peoplePrisma.js');
const { platformPrisma } = await import('../utils/platformPrisma.js');

const app = buildApp().listen(0, '127.0.0.1');
afterAll(() => new Promise((done) => app.close(done)));
const rnd = () => Math.random().toString(36).slice(2, 8);

/** The company the database itself was told, read back on the connection that ran the query. */
const settingVia = async (client: any) => ((await client.$queryRaw`SELECT current_setting('clor.org_id', true) AS v`) as Array<{ v: string | null }>)[0]?.v || '';

describe('a route that learns its company from a token (A-30)', () => {
  it('runs the rest of the request as that company', async () => {
    const email = `tb.${Date.now()}.${rnd()}@example.com`;
    const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'TB owner' }).expect(200);
    const setup = await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${signup.body.token}`).send({ companyName: `TB Co ${Date.now()}-${rnd()}`, state: 'Karnataka' }).expect(200);
    const c = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id };
    const at = { Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId };
    await request(app).put(`/api/orgs/${c.orgId}/features`).set(at).send({ features: { people: true, attendance: true } }).expect(200);
    const made = (await request(app).post(`/api/orgs/${c.orgId}/attendance/devices`).set(at).send({ vendor: 'HTTP_PUSH', name: 'Turnstile', direction: 'both' }).expect(201)).body;
    await request(app).put(`/api/orgs/${c.orgId}/attendance/devices/${made.device.id}`).set(at).send({ name: 'Turnstile', direction: 'both', mapping: { employeeCode: 'code', timestamp: 'time' } }).expect(200);
    seen.length = 0;
    await request(app).post(`/ingest/${made.pushToken}`).set('Content-Type', 'application/json').send({ code: '77', time: '2026-09-01 09:00:00' }).expect(200);
    expect(seen).toEqual([c.orgId]);
  });

  it('enters the company for the rest of that request only', async () => {
    const other: string[] = [];
    const mine = (async () => {
      await Promise.resolve();
      enterTenant('org-token');
      await new Promise((r) => setTimeout(r, 5));
      return currentOrg();
    })();
    const theirs = (async () => {
      await new Promise((r) => setTimeout(r, 1));
      other.push(currentOrg());
    })();
    expect(await mine).toBe('org-token');
    await theirs;
    expect(other).toEqual(['']);
  });
});

describe('inside an interactive transaction (A-37)', () => {
  it('still tells the database the company, on every client', async () => {
    const got = await runInTenant('org-a37', () =>
      payrollPrisma.$transaction(async (tx: any) => ({
        tx: await settingVia(tx),
        sameClientOutsideTx: await settingVia(payrollPrisma),
        people: await settingVia(peoplePrisma),
        platform: await settingVia(platformPrisma),
        accounting: await settingVia(prisma),
      }))
    );
    expect(got).toEqual({ tx: 'org-a37', sameClientOutsideTx: 'org-a37', people: 'org-a37', platform: 'org-a37', accounting: 'org-a37' });
  });

  it('still runs a batch, its queries inside the batch after the setting', async () => {
    const [n, m] = await runInTenant('org-batch', () =>
      prisma.$transaction([prisma.invoice.count({ where: { orgId: 'org-batch' } }), prisma.bill.count({ where: { orgId: 'org-batch' } })])
    );
    expect([n, m]).toEqual([0, 0]);
  });
});
