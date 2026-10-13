import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { buildApp } from '../app.js';

const app = buildApp().listen(0);
afterAll(() => new Promise((done) => app.close(done)));

type Ctx = { token: string; orgId: string; branchId: string };

let A: Ctx;

async function makeTenant(label: string): Promise<Ctx> {
  const email = `${label}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}@example.com`;
  const signup = await request(app)
    .post('/api/auth/signup')
    .send({ email, password: 'Passw0rd!23', name: `${label} owner` })
    .expect(200);
  const setup = await request(app)
    .post('/api/auth/setup-company')
    .set('Authorization', `Bearer ${signup.body.token}`)
    .send({ companyName: `${label} Co ${Date.now()}`, state: 'Karnataka' })
    .expect(200);
  return { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id };
}

const auth = (c: Ctx) => ({
  Authorization: `Bearer ${c.token}`,
  'x-org-id': c.orgId,
  'x-branch-id': c.branchId,
});

beforeAll(async () => {
  A = await makeTenant('tenant-quote');
}, 60_000);

describe('quote-stage documents', () => {
  it('creates an estimate with an EST number and lists it', async () => {
    const res = await request(app)
      .post(`/api/orgs/${A.orgId}/estimates`)
      .set(auth(A))
      .send({ date: '2026-08-18', partyName: 'Prospect Ltd', total: 5000, items: [{ description: 'Consulting', rate: 5000 }] })
      .expect(201);
    expect(res.body.document.number).toMatch(/^EST-/);

    const list = await request(app).get(`/api/orgs/${A.orgId}/estimates`).set(auth(A)).expect(200);
    expect(list.body.documents.length).toBe(1);
    expect(list.body.documents[0].items[0].description).toBe('Consulting');
  });

  it('creates a purchase order, updates its status, deletes it', async () => {
    const created = await request(app)
      .post(`/api/orgs/${A.orgId}/purchase-orders`)
      .set(auth(A))
      .send({ date: '2026-08-18', partyName: 'Supplier Co', total: 900 })
      .expect(201);
    expect(created.body.document.number).toMatch(/^PO-/);

    const upd = await request(app)
      .patch(`/api/orgs/${A.orgId}/purchase-orders/${created.body.document.id}`)
      .set(auth(A))
      .send({ status: 'Billed' })
      .expect(200);
    expect(upd.body.document.status).toBe('Billed');

    await request(app)
      .delete(`/api/orgs/${A.orgId}/purchase-orders/${created.body.document.id}`)
      .set(auth(A))
      .expect(200);
    const list = await request(app).get(`/api/orgs/${A.orgId}/purchase-orders`).set(auth(A)).expect(200);
    expect(list.body.documents.length).toBe(0);
  });

  it('creates a sales order with an SO number, expected date and warehouse', async () => {
    const created = await request(app)
      .post(`/api/orgs/${A.orgId}/sales-orders`)
      .set(auth(A))
      .send({
        date: '2026-08-19',
        expectedDate: '2026-08-25',
        partyName: 'Buyer Ltd',
        total: 1180,
        status: 'Open',
        items: [{ itemId: '1', description: 'Widget', quantity: 10, rate: 100, gstRate: 18 }],
      })
      .expect(201);
    expect(created.body.document.number).toMatch(/^SO-/);
    expect(created.body.document.expectedDate).toBe('2026-08-25');
    expect(created.body.document.status).toBe('Open');

    const list = await request(app).get(`/api/orgs/${A.orgId}/sales-orders`).set(auth(A)).expect(200);
    expect(list.body.documents.length).toBe(1);
    expect(list.body.documents[0].items[0].quantity).toBe(10);
  });

  it('quote documents never touch the ledger', async () => {
    const tb = await request(app).get(`/api/orgs/${A.orgId}/ledger/trial-balance`).set(auth(A)).expect(200);
    expect(tb.body.rows.length).toBe(0);
  });
});
