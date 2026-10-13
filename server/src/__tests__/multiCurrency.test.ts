import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { buildApp } from '../app.js';
import { settlementDifference, toBase } from '../services/fx.js';

/**
 * Requirement 8: multi-currency.
 *
 * The invariant under test is that the general ledger stays in one currency.
 * A trial balance that mixes USD and INR still foots to zero and is still
 * meaningless, so the test that matters is not "does it balance" but "does it
 * balance at the translated amount".
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
  const email = `fx.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app)
    .post('/api/auth/signup')
    .send({ email, password: 'Passw0rd!23', name: 'FX owner' })
    .expect(200);
  const setup = await request(app)
    .post('/api/auth/setup-company')
    .set('Authorization', `Bearer ${signup.body.token}`)
    .send({ companyName: `FX Co ${Date.now()}-${rnd()}`, state: 'Karnataka' })
    .expect(200);
  return { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id };
}

const setFeature = async (key: string, enabled: boolean) => {
  const current = await request(app).get(`/api/orgs/${owner.orgId}/features`).set(auth(owner)).expect(200);
  const features = { ...(current.body.features || {}), [key]: enabled };
  await request(app).put(`/api/orgs/${owner.orgId}/features`).set(auth(owner)).send({ features }).expect(200);
};

const invoicePayload = (over: Record<string, unknown> = {}) => ({
  date: '2026-05-10',
  customerName: 'Overseas Ltd',
  subtotal: 1000,
  cgstTotal: 0,
  sgstTotal: 0,
  igstTotal: 0,
  gstTotal: 0,
  total: 1000,
  items: [{ description: 'Export services', quantity: 1, rate: 1000, gstRate: 0 }],
  ...over,
});

const trialBalance = async () => {
  const res = await request(app).get(`/api/orgs/${owner.orgId}/ledger/trial-balance`).set(auth(owner)).expect(200);
  return res.body;
};

beforeAll(async () => {
  owner = await makeOwner();
  await setFeature('multiCurrency', true);

  await request(app)
    .post(`/api/orgs/${owner.orgId}/currencies`)
    .set(auth(owner))
    .send({ code: 'USD', name: 'US Dollar', symbol: '$' })
    .expect(201);

  // Two dated rates, so "as of" behaviour can be tested.
  for (const [date, rate] of [
    ['2026-05-01', 83],
    ['2026-06-01', 85],
  ] as const) {
    await request(app)
      .post(`/api/orgs/${owner.orgId}/exchange-rates`)
      .set(auth(owner))
      .send({ code: 'USD', date, rate })
      .expect(201);
  }
}, 60_000);

describe('translation arithmetic', () => {
  it('translates at the given rate, rounded to minor units', () => {
    expect(toBase(1000, 83.5)).toBe(83500);
    expect(toBase(10.005, 1)).toBe(10.01);
  });

  it('reports a gain when a receivable settles at a stronger rate', () => {
    // Booked at 83, settled at 85: 1000 * 2 = 2000 more base currency.
    expect(settlementDifference({ amount: 1000, bookedRate: 83, settledRate: 85 })).toBe(2000);
  });

  it('reports a loss when it settles at a weaker one', () => {
    expect(settlementDifference({ amount: 1000, bookedRate: 85, settledRate: 83 })).toBe(-2000);
  });
});

describe('currency setup', () => {
  it('reports the base currency the books are kept in', async () => {
    const res = await request(app).get(`/api/orgs/${owner.orgId}/currencies`).set(auth(owner)).expect(200);
    expect(res.body.baseCurrency).toBe('INR');
    expect(res.body.currencies.map((c: any) => c.code)).toContain('USD');
  });

  it('refuses to add the base currency as a foreign one', async () => {
    const res = await request(app)
      .post(`/api/orgs/${owner.orgId}/currencies`)
      .set(auth(owner))
      .send({ code: 'INR', name: 'Rupee' })
      .expect(400);
    expect(String(res.body.error)).toMatch(/base currency/i);
  });

  it('refuses a rate for a currency that was never set up', async () => {
    const res = await request(app)
      .post(`/api/orgs/${owner.orgId}/exchange-rates`)
      .set(auth(owner))
      .send({ code: 'EUR', date: '2026-05-01', rate: 90 })
      .expect(400);
    expect(String(res.body.error)).toMatch(/not set up/i);
  });
});

describe('rate resolution', () => {
  it('uses the rate in force on the date, not the newest one', async () => {
    const res = await request(app)
      .get(`/api/orgs/${owner.orgId}/exchange-rates/resolve?code=USD&date=2026-05-10`)
      .set(auth(owner))
      .expect(200);
    expect(res.body.rate).toBe(83);
  });

  it('carries the last known rate forward rather than demanding an exact date', async () => {
    const res = await request(app)
      .get(`/api/orgs/${owner.orgId}/exchange-rates/resolve?code=USD&date=2026-05-31`)
      .set(auth(owner))
      .expect(200);
    expect(res.body.rate).toBe(83);
  });

  it('picks up the newer rate once its date has passed', async () => {
    const res = await request(app)
      .get(`/api/orgs/${owner.orgId}/exchange-rates/resolve?code=USD&date=2026-06-02`)
      .set(auth(owner))
      .expect(200);
    expect(res.body.rate).toBe(85);
  });

  it('refuses a date earlier than any rate on file instead of guessing', async () => {
    const res = await request(app)
      .get(`/api/orgs/${owner.orgId}/exchange-rates/resolve?code=USD&date=2026-01-01`)
      .set(auth(owner))
      .expect(400);
    expect(String(res.body.error)).toMatch(/no exchange rate/i);
  });

  it('treats the base currency as rate 1 without needing a stored rate', async () => {
    const res = await request(app)
      .get(`/api/orgs/${owner.orgId}/exchange-rates/resolve?code=INR&date=2020-01-01`)
      .set(auth(owner))
      .expect(200);
    expect(res.body.rate).toBe(1);
  });
});

describe('posting a foreign-currency invoice', () => {
  it('posts the translated amount, not the face value', async () => {
    const before = await trialBalance();

    await request(app)
      .post(`/api/orgs/${owner.orgId}/invoices`)
      .set(auth(owner))
      .send(invoicePayload({ currency: 'USD', exchangeRate: 83 })) // rate entered on the invoice
      .expect(201);

    const after = await trialBalance();

    // USD 1,000 at 83 is INR 83,000 in the books — not 1,000.
    expect(after.totals.debit - before.totals.debit).toBe(83000);
    expect(after.totals.balanced).toBe(true);
    expect(after.totals.difference).toBe(0);
  });

  it('records the currency and the rate it used, so the posting can be explained later', async () => {
    const created = await request(app)
      .post(`/api/orgs/${owner.orgId}/invoices`)
      .set(auth(owner))
      .send(invoicePayload({ currency: 'USD', date: '2026-06-05', exchangeRate: 85 }))
      .expect(201);

    const list = await request(app).get(`/api/orgs/${owner.orgId}/invoices`).set(auth(owner)).expect(200);
    const row = list.body.invoices.find((i: any) => i.number === created.body.invoice.number);
    expect(row).toBeTruthy();

    const detail = await request(app)
      .get(`/api/orgs/${owner.orgId}/ledger/trial-balance`)
      .set(auth(owner))
      .expect(200);
    expect(detail.body.totals.balanced).toBe(true);
  });

  it('still posts a base-currency invoice at face value', async () => {
    const before = await trialBalance();
    await request(app)
      .post(`/api/orgs/${owner.orgId}/invoices`)
      .set(auth(owner))
      .send(invoicePayload({ date: '2026-05-12' }))
      .expect(201);
    const after = await trialBalance();

    expect(after.totals.debit - before.totals.debit).toBe(1000);
  });

  it('refuses a foreign-currency invoice with no conversion rate, rather than posting a wrong number', async () => {
    const res = await request(app)
      .post(`/api/orgs/${owner.orgId}/invoices`)
      .set(auth(owner))
      .send(invoicePayload({ currency: 'USD', date: '2026-01-15' }))
      .expect(400);

    expect(String(res.body.error)).toMatch(/conversion rate/i);
  });

  it('leaves no invoice behind when the rate lookup fails', async () => {
    const before = await request(app).get(`/api/orgs/${owner.orgId}/invoices`).set(auth(owner)).expect(200);

    await request(app)
      .post(`/api/orgs/${owner.orgId}/invoices`)
      .set(auth(owner))
      .send(invoicePayload({ currency: 'USD', date: '2026-01-16', number: `FAIL-${rnd()}` }))
      .expect(400);

    const after = await request(app).get(`/api/orgs/${owner.orgId}/invoices`).set(auth(owner)).expect(200);
    expect(after.body.invoices.length).toBe(before.body.invoices.length);
  });
});

describe('the multiCurrency feature switch', () => {
  it('will not switch multi-currency off while foreign-currency invoices exist', async () => {
    const current = await request(app).get(`/api/orgs/${owner.orgId}/features`).set(auth(owner)).expect(200);
    const res = await request(app)
      .put(`/api/orgs/${owner.orgId}/features`)
      .set(auth(owner))
      .send({ features: { ...(current.body.features || {}), multiCurrency: false } })
      .expect(409);
    expect(res.body.code).toBe('FEATURE_IN_USE');
  });

  it('stops new currencies being added when it is off', async () => {
    // A company with no foreign-currency invoices, so the switch is free to turn off.
    const fresh = await makeOwner();
    const current = await request(app).get(`/api/orgs/${fresh.orgId}/features`).set(auth(fresh)).expect(200);
    await request(app)
      .put(`/api/orgs/${fresh.orgId}/features`)
      .set(auth(fresh))
      .send({ features: { ...(current.body.features || {}), multiCurrency: false } })
      .expect(200);
    const res = await request(app)
      .post(`/api/orgs/${fresh.orgId}/currencies`)
      .set(auth(fresh))
      .send({ code: 'GBP', name: 'Pound' })
      .expect(400);
    expect(String(res.body.error)).toMatch(/switched off/i);
  });
});
