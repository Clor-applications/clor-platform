import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { buildApp } from '../app.js';

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
  const email = `feat.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app)
    .post('/api/auth/signup')
    .send({ email, password: 'Passw0rd!23', name: 'Feature owner' })
    .expect(200);
  const setup = await request(app)
    .post('/api/auth/setup-company')
    .set('Authorization', `Bearer ${signup.body.token}`)
    .send({ companyName: `Feature Co ${Date.now()}`, state: 'Karnataka' })
    .expect(200);
  owner = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id };
}, 60_000);

describe('feature toggles', () => {
  it('serves catalog defaults for a new org', async () => {
    const res = await request(app)
      .get(`/api/orgs/${owner.orgId}/features/catalog`)
      .set(auth(owner))
      .expect(200);

    const byKey = Object.fromEntries(res.body.features.map((f: any) => [f.key, f]));
    expect(byKey.inventory.enabled).toBe(true);
    // Off by default: these are opt-in capabilities.
    expect(byKey.multiCurrency.enabled).toBe(false);
    expect(byKey.batchSerial.enabled).toBe(false);
    expect(byKey.approvals.enabled).toBe(false);
    // The ledger cannot be switched off.
    expect(byKey.ledger.locked).toBe(true);
    expect(byKey.ledger.enabled).toBe(true);
  });

  it('persists a change and reports it to every member', async () => {
    await request(app)
      .put(`/api/orgs/${owner.orgId}/features`)
      .set(auth(owner))
      .send({ features: { warehouses: false, approvals: true } })
      .expect(200);

    const res = await request(app).get(`/api/orgs/${owner.orgId}/features`).set(auth(owner)).expect(200);
    expect(res.body.features.warehouses).toBe(false);
    expect(res.body.features.approvals).toBe(true);
  });

  it('forces dependent features off when the parent is off', async () => {
    const res = await request(app)
      .put(`/api/orgs/${owner.orgId}/features`)
      .set(auth(owner))
      .send({ features: { inventory: false, warehouses: true, stockTransfers: true, batchSerial: true } })
      .expect(200);

    // Stored as true, but inventory is off, so the effective value is false.
    expect(res.body.features.inventory).toBe(false);
    expect(res.body.features.warehouses).toBe(false);
    expect(res.body.features.stockTransfers).toBe(false);
    expect(res.body.features.batchSerial).toBe(false);

    // Turning the parent back on restores the children's own settings.
    const back = await request(app)
      .put(`/api/orgs/${owner.orgId}/features`)
      .set(auth(owner))
      .send({ features: { inventory: true } })
      .expect(200);
    expect(back.body.features.stockTransfers).toBe(true);
    expect(back.body.features.batchSerial).toBe(true);
  });

  it('rejects an unknown feature key', async () => {
    const res = await request(app)
      .put(`/api/orgs/${owner.orgId}/features`)
      .set(auth(owner))
      .send({ features: { teleporter: true } })
      .expect(400);
    expect(String(res.body.error)).toMatch(/unknown feature/i);
  });

  it('needs company-settings permission to change features', async () => {
    const role = await request(app)
      .post(`/api/orgs/${owner.orgId}/roles`)
      .set(auth(owner))
      .send({ name: `NoSettings ${rnd()}`, roleType: 'CUSTOM', permissions: [] })
      .expect(201);
    await request(app)
      .put(`/api/orgs/${owner.orgId}/roles/${role.body.role.id}/permissions`)
      .set(auth(owner))
      .send({ permissions: ['SALES::Invoices::VIEW'] })
      .expect(200);

    const email = `nf.${Date.now()}.${rnd()}@example.com`;
    const user = await request(app)
      .post('/api/users')
      .set(auth(owner))
      .send({
        email,
        fullName: 'No settings',
        password: 'Passw0rd!23',
        orgIds: [owner.orgId],
        branchIdsByOrg: { [owner.orgId]: [owner.branchId] },
      })
      .expect(201);
    await request(app)
      .post(`/api/orgs/${owner.orgId}/users/${user.body.user.id}/roles`)
      .set(auth(owner))
      .send({ roleId: role.body.role.id, branchId: null })
      .expect(201);

    const login = await request(app)
      .post('/api/auth/login')
      .send({ emailOrUsername: email, password: 'Passw0rd!23' })
      .expect(200);
    const member = { token: login.body.token, orgId: owner.orgId, branchId: owner.branchId };

    // Readable by any member so the UI can render...
    await request(app).get(`/api/orgs/${owner.orgId}/features`).set(auth(member)).expect(200);
    // ...but not changeable.
    await request(app)
      .put(`/api/orgs/${owner.orgId}/features`)
      .set(auth(member))
      .send({ features: { inventory: false } })
      .expect(403);
  });
});
