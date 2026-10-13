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

async function makeOwner(): Promise<Ctx> {
  const email = `item.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app)
    .post('/api/auth/signup')
    .send({ email, password: 'Passw0rd!23', name: 'Item owner' })
    .expect(200);
  const setup = await request(app)
    .post('/api/auth/setup-company')
    .set('Authorization', `Bearer ${signup.body.token}`)
    .send({ companyName: `Item Co ${Date.now()}-${rnd()}`, state: 'Karnataka' })
    .expect(200);
  return { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id };
}

beforeAll(async () => {
  owner = await makeOwner();
}, 60_000);

describe('items', () => {
  it('creates, lists and searches', async () => {
    const unique = rnd().toUpperCase();
    await request(app)
      .post(`/api/orgs/${owner.orgId}/items`)
      .set(auth(owner))
      .send({ name: `Widget ${unique}`, unit: 'Pcs', hsnSac: '8471', gstRate: 18, salePrice: 250 })
      .expect(201);

    const list = await request(app).get(`/api/orgs/${owner.orgId}/items`).set(auth(owner)).expect(200);
    const found = list.body.items.find((i: any) => i.name === `Widget ${unique}`);
    expect(found.gstRate).toBe(18);
    expect(found.salePrice).toBe(250);

    const search = await request(app)
      .get(`/api/orgs/${owner.orgId}/items?search=${unique}`)
      .set(auth(owner))
      .expect(200);
    expect(search.body.items).toHaveLength(1);
  });

  it('refuses batch tracking on a service item', async () => {
    const res = await request(app)
      .post(`/api/orgs/${owner.orgId}/items`)
      .set(auth(owner))
      .send({ name: `Consulting ${rnd()}`, itemType: 'SERVICE', trackBy: 'BATCH' })
      .expect(400);
    expect(String(res.body.error)).toMatch(/service item/i);
  });

  it('treats name and unit together as the identity', async () => {
    const name = `Rope ${rnd()}`;
    await request(app).post(`/api/orgs/${owner.orgId}/items`).set(auth(owner)).send({ name, unit: 'Metre' }).expect(201);
    // Same name, different unit is a different item.
    await request(app).post(`/api/orgs/${owner.orgId}/items`).set(auth(owner)).send({ name, unit: 'Roll' }).expect(201);
    // Same name and unit is not.
    await request(app).post(`/api/orgs/${owner.orgId}/items`).set(auth(owner)).send({ name, unit: 'Roll' }).expect(409);
  });

  it('does not leak items across organisations', async () => {
    const other = await makeOwner();
    await request(app)
      .post(`/api/orgs/${other.orgId}/items`)
      .set(auth(other))
      .send({ name: `Secret ${rnd()}` })
      .expect(201);

    const mine = await request(app).get(`/api/orgs/${owner.orgId}/items`).set(auth(owner)).expect(200);
    expect(mine.body.items.some((i: any) => /^Secret/.test(i.name))).toBe(false);
  });
});

describe('number series', () => {
  it('previews the next number without consuming it', async () => {
    const org = await makeOwner();
    const a = await request(app).get(`/api/orgs/${org.orgId}/number-series/next/INVOICE`).set(auth(org)).expect(200);
    const b = await request(app).get(`/api/orgs/${org.orgId}/number-series/next/INVOICE`).set(auth(org)).expect(200);
    expect(a.body.number).toBe(b.body.number);
    // Fiscal year is part of the number, so it never repeats across years.
    expect(a.body.number).toMatch(/^INV-\d{4}-\d{5}$/);
  });

  it('allocates sequentially when the client sends no number', async () => {
    const org = await makeOwner();

    const first = await request(app)
      .post(`/api/orgs/${org.orgId}/invoices`)
      .set(auth(org))
      .send({ date: '2026-08-17', customerName: 'A', subtotal: 100, total: 100, items: [] })
      .expect(201);

    const second = await request(app)
      .post(`/api/orgs/${org.orgId}/invoices`)
      .set(auth(org))
      .send({ date: '2026-08-17', customerName: 'B', subtotal: 100, total: 100, items: [] })
      .expect(201);

    expect(first.body.invoice.number).toBe('INV-2627-00001');
    expect(second.body.invoice.number).toBe('INV-2627-00002');
  });

  it('never issues the same number twice under concurrency', async () => {
    const org = await makeOwner();

    // Ten invoices raised at once, as two browsers would.
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        request(app)
          .post(`/api/orgs/${org.orgId}/invoices`)
          .set(auth(org))
          .send({ date: '2026-08-17', customerName: `C${i}`, subtotal: 10, total: 10, items: [] })
      )
    );

    const created = results.filter((r) => r.status === 201).map((r) => r.body.invoice.number);
    expect(created.length).toBeGreaterThan(0);
    expect(new Set(created).size).toBe(created.length);
  });

  it('still accepts a number the client supplies', async () => {
    const org = await makeOwner();
    const res = await request(app)
      .post(`/api/orgs/${org.orgId}/invoices`)
      .set(auth(org))
      .send({ number: 'MANUAL-7', date: '2026-08-17', customerName: 'D', subtotal: 10, total: 10, items: [] })
      .expect(201);
    expect(res.body.invoice.number).toBe('MANUAL-7');
  });

  it('restarts numbering in a new fiscal year', async () => {
    const org = await makeOwner();
    await request(app)
      .post(`/api/orgs/${org.orgId}/invoices`)
      .set(auth(org))
      .send({ date: '2026-08-17', customerName: 'FY1', subtotal: 10, total: 10, items: [] })
      .expect(201);

    // 1 April starts the next Indian fiscal year.
    const nextYear = await request(app)
      .post(`/api/orgs/${org.orgId}/invoices`)
      .set(auth(org))
      .send({ date: '2027-04-02', customerName: 'FY2', subtotal: 10, total: 10, items: [] })
      .expect(201);

    // Counter restarts, but the year in the number keeps it unique.
    expect(nextYear.body.invoice.number).toBe('INV-2728-00001');
  });
});
