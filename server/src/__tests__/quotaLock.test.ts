import { describe, it, expect, afterAll } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';

/*
 * Workspace W-6.1: a plan's company and user limits hold when requests arrive
 * at the same moment. Before, each request counted and then created, so a
 * burst could all see room and all create.
 */
const { buildApp } = await import('../app.js');
const { platformPrisma } = await import('../utils/platformPrisma.js');
const { outsideTenant } = await import('../utils/tenantScope.js');
const { PLAN_CATALOG } = await import('../constants/planCatalog.js');

const app = buildApp().listen(0, '127.0.0.1');
afterAll(() => new Promise((done) => app.close(done)));
const rnd = () => Math.random().toString(36).slice(2, 8);
const PASSWORD = 'Passw0rd!23';

async function owner(label: string) {
  const email = `quota.${label}.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: PASSWORD, name: label }).expect(200);
  const setup = await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${signup.body.token}`).send({ companyName: `Q ${label} ${Date.now()}-${rnd()}`, state: 'Karnataka' }).expect(200);
  const claims = jwt.decode(signup.body.token) as any;
  return { token: signup.body.token as string, orgId: setup.body.company.orgId as string, branchId: setup.body.branch.id as string, accountId: claims.accountId as string };
}
const plan = (accountId: string, planKey: string) =>
  outsideTenant('test: plan', () => platformPrisma.accountEntitlement.upsert({ where: { accountId }, update: { planKey }, create: { accountId, planKey } }));
const limited = (pick: (l: any) => number | null) => {
  const p = (PLAN_CATALOG as any[]).find((x) => { const n = pick(x.limits || {}); return n != null && n >= 2 && n <= 10; });
  if (!p) throw new Error('No plan with a small limit in the catalogue');
  return p;
};

describe('plan limits under simultaneous requests', () => {
  it('lets exactly the plan’s number of companies be made by a burst', async () => {
    const o = await owner('companies');
    const p = limited((l) => l.maxCompanies);
    await plan(o.accountId, p.key);
    const burst = 5;
    const results = await Promise.all(
      Array.from({ length: burst }, (_, i) =>
        request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${o.token}`).send({ companyName: `Q burst ${i} ${Date.now()}-${rnd()}`, state: 'Karnataka' })
      )
    );
    const made = results.filter((r) => r.status === 200).length;
    expect(made).toBe(p.limits.maxCompanies - 1);
    expect(results.filter((r) => r.status !== 200).every((r) => r.body.code === 'COMPANY_LIMIT')).toBe(true);
    const count = await outsideTenant('test', () => platformPrisma.org.count({ where: { accountId: o.accountId } }));
    expect(count).toBe(p.limits.maxCompanies);
  });

  it('lets exactly the plan’s number of users be added by a burst', async () => {
    const o = await owner('users');
    const p = limited((l) => l.maxUsers);
    await plan(o.accountId, p.key);
    const burst = p.limits.maxUsers + 2;
    const results = await Promise.all(
      Array.from({ length: burst }, (_, i) =>
        request(app)
          .post('/api/users')
          .set({ Authorization: `Bearer ${o.token}`, 'x-org-id': o.orgId, 'x-branch-id': o.branchId })
          .send({ email: `quota.u${i}.${Date.now()}.${rnd()}@example.com`, fullName: `U${i}`, password: PASSWORD, orgIds: [o.orgId], branchIdsByOrg: { [o.orgId]: [o.branchId] } })
      )
    );
    expect(results.filter((r) => r.status === 201).length).toBe(p.limits.maxUsers - 1);
    const active = await outsideTenant('test', () => platformPrisma.user.count({ where: { accountId: o.accountId, isActive: true } }));
    expect(active).toBe(p.limits.maxUsers);
    /* The lock is released whatever the outcome. */
    expect(await outsideTenant('test', () => platformPrisma.accountQuotaLock.count({ where: { accountId: o.accountId } }))).toBe(0);
  });
});
