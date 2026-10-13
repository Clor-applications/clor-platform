import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { buildApp } from '../app.js';

/**
 * Default roles: a fresh org must offer more than "Owner" in the user-create
 * dropdown, and the offered roles must actually enforce — a Sales User can
 * raise an invoice and cannot administer roles.
 */

/**
 * One listening server for the whole file, not one per request.
 *
 * supertest given an Express app binds a fresh ephemeral-port listener for
 * every single request; a run makes thousands of listen/close cycles, and
 * the suite's residual flake was a raw Node-level 400 "Bad Request" that
 * never reached Express (absent from both morgan and the anomaly log) —
 * socket churn, not application behaviour. Given an already-listening
 * server, supertest reuses it.
 */
const app = buildApp().listen(0);
afterAll(() => new Promise((done) => app.close(done)));
const rnd = () => Math.random().toString(36).slice(2, 8);

type Ctx = { token: string; orgId: string; branchId: string };
let owner: Ctx;

const auth = (c: Ctx) => ({
  Authorization: `Bearer ${c.token}`,
  'x-org-id': c.orgId,
  'x-branch-id': c.branchId,
});

beforeAll(async () => {
  const email = `dr.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app)
    .post('/api/auth/signup')
    .send({ email, password: 'Passw0rd!23', name: 'Roles owner' })
    .expect(200);
  const setup = await request(app)
    .post('/api/auth/setup-company')
    .set('Authorization', `Bearer ${signup.body.token}`)
    .send({ companyName: `Roles Co ${Date.now()}-${rnd()}`, state: 'Karnataka' })
    .expect(200);
  owner = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id };
}, 60_000);

describe('seeding', () => {
  it('materialises the standard roles on first listing', async () => {
    const res = await request(app).get(`/api/orgs/${owner.orgId}/roles`).set(auth(owner)).expect(200);
    const names = res.body.roles.map((r: any) => r.name);
    for (const expected of ['Administrator', 'Accountant', 'Sales User', 'Store Keeper', 'Viewer']) {
      expect(names).toContain(expected);
    }
  });

  it('does not duplicate them on a second listing', async () => {
    const first = await request(app).get(`/api/orgs/${owner.orgId}/roles`).set(auth(owner)).expect(200);
    const second = await request(app).get(`/api/orgs/${owner.orgId}/roles`).set(auth(owner)).expect(200);
    expect(second.body.roles.length).toBe(first.body.roles.length);
  });

  it('does not restore a grant an administrator has removed', async () => {
    const roles = await request(app).get(`/api/orgs/${owner.orgId}/roles`).set(auth(owner)).expect(200);
    const viewer = roles.body.roles.find((r: any) => r.name === 'Viewer');

    const before = await request(app)
      .get(`/api/orgs/${owner.orgId}/roles/${viewer.id}/permissions`)
      .set(auth(owner))
      .expect(200);
    const trimmed = before.body.permissions.filter((k: string) => !k.startsWith('REPORTS::'));
    expect(trimmed.length).toBeLessThan(before.body.permissions.length);

    await request(app)
      .put(`/api/orgs/${owner.orgId}/roles/${viewer.id}/permissions`)
      .set(auth(owner))
      .send({ permissions: trimmed })
      .expect(200);

    // Listing again must not silently put REPORTS back.
    await request(app).get(`/api/orgs/${owner.orgId}/roles`).set(auth(owner)).expect(200);
    const after = await request(app)
      .get(`/api/orgs/${owner.orgId}/roles/${viewer.id}/permissions`)
      .set(auth(owner))
      .expect(200);
    expect(after.body.permissions.some((k: string) => k.startsWith('REPORTS::'))).toBe(false);
  });
});

describe('enforcement', () => {
  it('a Sales User can raise an invoice and cannot administer roles', async () => {
    const roles = await request(app).get(`/api/orgs/${owner.orgId}/roles`).set(auth(owner)).expect(200);
    const sales = roles.body.roles.find((r: any) => r.name === 'Sales User');

    const email = `sales.${Date.now()}.${rnd()}@example.com`;
    const created = await request(app)
      .post('/api/users')
      .set(auth(owner))
      .send({
        email,
        fullName: 'Sales person',
        password: 'Passw0rd!23',
        orgIds: [owner.orgId],
        branchIdsByOrg: { [owner.orgId]: [owner.branchId] },
      })
      .expect(201);

    await request(app)
      .post(`/api/orgs/${owner.orgId}/users/${created.body.user.id}/roles`)
      .set(auth(owner))
      .send({ roleId: sales.id })
      .expect(201);

    const login = await request(app)
      .post('/api/auth/login')
      .send({ emailOrUsername: email, password: 'Passw0rd!23' })
      .expect(200);
    const salesCtx = { token: login.body.token, orgId: owner.orgId, branchId: owner.branchId };

    await request(app)
      .post(`/api/orgs/${owner.orgId}/invoices`)
      .set(auth(salesCtx))
      .send({
        date: '2026-08-18',
        customerName: 'Seeded Role Customer',
        subtotal: 100,
        gstTotal: 0,
        total: 100,
        items: [{ description: 'Test', quantity: 1, rate: 100, gstRate: 0 }],
      })
      .expect(201);

    await request(app).get(`/api/orgs/${owner.orgId}/roles`).set(auth(salesCtx)).expect(403);
  });
});

describe('role creation payload shapes', () => {
  it('accepts the catalog string form the UI sends', async () => {
    const res = await request(app)
      .post(`/api/orgs/${owner.orgId}/roles`)
      .set(auth(owner))
      .send({ name: 'String Perms Role', roleType: 'CUSTOM', permissions: ['SALES::Invoices::VIEW', 'SALES::Invoices::CREATE'] })
      .expect(201);
    expect(res.body.role.permissions.length).toBe(2);
  });
});
