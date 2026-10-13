import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { buildApp } from '../app.js';
import { dueDateFor } from '../routes/parties.js';

/**
 * Requirement 12: a document's due date comes from the party's agreed credit
 * period, computed on the server so it cannot be quietly extended in the
 * browser, and switchable per organisation like every other feature.
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

async function makeOwner(): Promise<Ctx> {
  const email = `terms.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app)
    .post('/api/auth/signup')
    .send({ email, password: 'Passw0rd!23', name: 'Terms owner' })
    .expect(200);
  const setup = await request(app)
    .post('/api/auth/setup-company')
    .set('Authorization', `Bearer ${signup.body.token}`)
    .send({ companyName: `Terms Co ${Date.now()}-${rnd()}`, state: 'Karnataka' })
    .expect(200);
  return { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id };
}

const makeCustomer = async (paymentTermDays: number) => {
  const res = await request(app)
    .post(`/api/orgs/${owner.orgId}/customers`)
    .set(auth(owner))
    .send({ name: `Terms cust ${Date.now()}-${rnd()}`, paymentTermDays })
    .expect(201);
  return res.body.party;
};

/** A complete, balanced invoice — the ledger rejects one that totals zero. */
const invoicePayload = (over: Record<string, unknown> = {}) => ({
  date: '2026-08-17',
  customerName: 'Acme Ltd',
  subtotal: 1000,
  cgstTotal: 90,
  sgstTotal: 90,
  igstTotal: 0,
  gstTotal: 180,
  total: 1180,
  items: [{ description: 'Consulting', quantity: 1, rate: 1000, gstRate: 18 }],
  ...over,
});

const setFeature = async (key: string, enabled: boolean) => {
  const current = await request(app).get(`/api/orgs/${owner.orgId}/features`).set(auth(owner)).expect(200);
  const features = { ...(current.body.features || {}), [key]: enabled };
  await request(app).put(`/api/orgs/${owner.orgId}/features`).set(auth(owner)).send({ features }).expect(200);
};

beforeAll(async () => {
  owner = await makeOwner();
}, 60_000);

describe('dueDateFor', () => {
  it('adds the credit period to the document date', () => {
    expect(dueDateFor('2026-08-17', 30)).toBe('2026-09-16');
  });

  it('returns the same day for terms of zero', () => {
    expect(dueDateFor('2026-08-17', 0)).toBe('2026-08-17');
  });

  it('crosses a month and a year boundary correctly', () => {
    expect(dueDateFor('2026-12-20', 45)).toBe('2027-02-03');
  });

  it('rejects a date it cannot parse rather than inventing one', () => {
    expect(dueDateFor('not-a-date', 30)).toBeNull();
  });
});

describe('payment terms on a party', () => {
  it('stores and returns the credit period', async () => {
    const party = await makeCustomer(45);
    expect(party.paymentTermDays).toBe(45);
  });
});

describe('invoice due date', () => {
  it("uses the customer's terms instead of the date the browser sent", async () => {
    const party = await makeCustomer(15);

    const res = await request(app)
      .post(`/api/orgs/${owner.orgId}/invoices`)
      .set(auth(owner))
      .send(
        invoicePayload({
          // Deliberately wrong: a browser must not be able to grant 300 days of
          // credit to a customer whose agreed terms are 15.
          dueDate: '2027-06-01',
          customerId: party.id,
          customerName: party.name,
        })
      )
      .expect(201);

    expect(res.body.invoice.dueDate).toBe('2026-09-01');
  });

  it('leaves the due date alone when the feature is switched off', async () => {
    const party = await makeCustomer(15);
    await setFeature('paymentTerms', false);

    try {
      const res = await request(app)
        .post(`/api/orgs/${owner.orgId}/invoices`)
        .set(auth(owner))
        .send(
          invoicePayload({
            dueDate: '2026-10-05',
            customerId: party.id,
            customerName: party.name,
          })
        )
        .expect(201);

      expect(res.body.invoice.dueDate).toBe('2026-10-05');
    } finally {
      await setFeature('paymentTerms', true);
    }
  });
});
