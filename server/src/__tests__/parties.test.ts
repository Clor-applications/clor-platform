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
  const email = `party.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app)
    .post('/api/auth/signup')
    .send({ email, password: 'Passw0rd!23', name: 'Party owner' })
    .expect(200);
  const setup = await request(app)
    .post('/api/auth/setup-company')
    .set('Authorization', `Bearer ${signup.body.token}`)
    .send({ companyName: `Party Co ${Date.now()}-${rnd()}`, state: 'Karnataka' });
  if (setup.status !== 200) {
    // eslint-disable-next-line no-console
    console.log('SETUP FAILED', setup.status, JSON.stringify(setup.body), 'signup was', signup.status);
  }
  expect(setup.status).toBe(200);
  return { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id };
}

beforeAll(async () => {
  owner = await makeOwner();
}, 60_000);

describe('customers and vendors', () => {
  it('creates and lists a customer', async () => {
    const created = await request(app)
      .post(`/api/orgs/${owner.orgId}/customers`)
      .set(auth(owner))
      .send({ name: `Acme ${rnd()}`, phone: '9876543210', billingState: 'Karnataka', paymentTermDays: 30 })
      .expect(201);

    expect(created.body.party.partyType).toBe('CUSTOMER');
    expect(created.body.party.paymentTermDays).toBe(30);

    const list = await request(app).get(`/api/orgs/${owner.orgId}/customers`).set(auth(owner)).expect(200);
    expect(list.body.customers.some((c: any) => c.id === created.body.party.id)).toBe(true);
  });

  it('keeps customers and vendors in separate lists, and BOTH in each', async () => {
    const vendorName = `Supplier ${rnd()}`;
    await request(app)
      .post(`/api/orgs/${owner.orgId}/vendors`)
      .set(auth(owner))
      .send({ name: vendorName })
      .expect(201);

    const bothName = `Trader ${rnd()}`;
    await request(app)
      .post(`/api/orgs/${owner.orgId}/customers`)
      .set(auth(owner))
      .send({ name: bothName, alsoOtherType: true })
      .expect(201);

    const customers = await request(app).get(`/api/orgs/${owner.orgId}/customers`).set(auth(owner)).expect(200);
    const vendors = await request(app).get(`/api/orgs/${owner.orgId}/vendors`).set(auth(owner)).expect(200);

    const cNames = customers.body.customers.map((c: any) => c.name);
    const vNames = vendors.body.vendors.map((v: any) => v.name);

    expect(cNames).not.toContain(vendorName);
    expect(vNames).toContain(vendorName);
    // A party marked BOTH appears in both lists.
    expect(cNames).toContain(bothName);
    expect(vNames).toContain(bothName);
  });

  it('rejects an invalid GSTIN', async () => {
    const res = await request(app)
      .post(`/api/orgs/${owner.orgId}/customers`)
      .set(auth(owner))
      .send({ name: `Bad GST ${rnd()}`, gstin: '29ABCDE1234F1Z9', billingState: 'Karnataka' })
      .expect(400);
    expect(String(res.body.error)).toMatch(/gstin/i);
  });

  it('searches by name and phone', async () => {
    const unique = rnd().toUpperCase();
    await request(app)
      .post(`/api/orgs/${owner.orgId}/customers`)
      .set(auth(owner))
      .send({ name: `Findable ${unique}`, phone: `99${unique.slice(0, 6)}` })
      .expect(201);

    const byName = await request(app)
      .get(`/api/orgs/${owner.orgId}/customers?search=${unique}`)
      .set(auth(owner))
      .expect(200);
    expect(byName.body.customers).toHaveLength(1);
  });

  it('computes the invoice due date from the customer payment terms', async () => {
    const customer = await request(app)
      .post(`/api/orgs/${owner.orgId}/customers`)
      .set(auth(owner))
      .send({ name: `Terms ${rnd()}`, paymentTermDays: 45 })
      .expect(201);

    const invoice = await request(app)
      .post(`/api/orgs/${owner.orgId}/invoices`)
      .set(auth(owner))
      .send({
        number: `DUE-${rnd().toUpperCase()}`,
        date: '2026-08-17',
        customerId: customer.body.party.id,
        customerName: 'Terms',
        subtotal: 100,
        total: 100,
        items: [],
        // Deliberately wrong: the server must overrule it.
        dueDate: '2026-08-18',
      })
      .expect(201);

    expect(invoice.body.invoice.dueDate).toBe('2026-10-01');
  });

  it('deactivates rather than deletes a customer that has invoices', async () => {
    const customer = await request(app)
      .post(`/api/orgs/${owner.orgId}/customers`)
      .set(auth(owner))
      .send({ name: `Used ${rnd()}` })
      .expect(201);

    await request(app)
      .post(`/api/orgs/${owner.orgId}/invoices`)
      .set(auth(owner))
      .send({
        number: `USE-${rnd().toUpperCase()}`,
        date: '2026-08-17',
        customerId: customer.body.party.id,
        customerName: 'Used',
        subtotal: 10,
        total: 10,
        items: [],
      })
      .expect(201);

    const del = await request(app)
      .delete(`/api/orgs/${owner.orgId}/customers/${customer.body.party.id}`)
      .set(auth(owner))
      .expect(200);

    expect(del.body.deactivated).toBe(true);

    // Gone from the default list, still fetchable by id so old invoices resolve.
    const list = await request(app).get(`/api/orgs/${owner.orgId}/customers`).set(auth(owner)).expect(200);
    expect(list.body.customers.some((c: any) => c.id === customer.body.party.id)).toBe(false);
    await request(app)
      .get(`/api/orgs/${owner.orgId}/customers/${customer.body.party.id}`)
      .set(auth(owner))
      .expect(200);
  });

  it('hard-deletes a customer with no documents', async () => {
    const customer = await request(app)
      .post(`/api/orgs/${owner.orgId}/customers`)
      .set(auth(owner))
      .send({ name: `Unused ${rnd()}` })
      .expect(201);

    const del = await request(app)
      .delete(`/api/orgs/${owner.orgId}/customers/${customer.body.party.id}`)
      .set(auth(owner))
      .expect(200);
    expect(del.body.deactivated).toBe(false);

    await request(app)
      .get(`/api/orgs/${owner.orgId}/customers/${customer.body.party.id}`)
      .set(auth(owner))
      .expect(404);
  });

  it('does not leak another org customers', async () => {
    const other = await makeOwner();
    await request(app)
      .post(`/api/orgs/${other.orgId}/customers`)
      .set(auth(other))
      .send({ name: `Secret ${rnd()}` })
      .expect(201);

    const mine = await request(app).get(`/api/orgs/${owner.orgId}/customers`).set(auth(owner)).expect(200);
    expect(mine.body.customers.some((c: any) => /^Secret/.test(c.name))).toBe(false);

    await request(app).get(`/api/orgs/${other.orgId}/customers`).set(auth(owner)).expect(403);
  });
});
