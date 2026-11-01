import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { buildApp } from '../app.js';

/**
 * Requirement 8, second half: realised gain or loss on settlement, and
 * revaluation of what is still open.
 *
 * A wrong sign here does not crash anything — it quietly misstates profit — so
 * the tests assert the direction of the movement and the account it lands in,
 * not merely that the entry balances.
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
const app = buildApp().listen(0, '127.0.0.1');
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
  const email = `fxs.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app)
    .post('/api/auth/signup')
    .send({ email, password: 'Passw0rd!23', name: 'FX settle owner' })
    .expect(200);
  const setup = await request(app)
    .post('/api/auth/setup-company')
    .set('Authorization', `Bearer ${signup.body.token}`)
    .send({ companyName: `FXS Co ${Date.now()}-${rnd()}`, state: 'Karnataka' })
    .expect(200);
  return { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id };
}

const setFeature = async (key: string, enabled: boolean) => {
  const current = await request(app).get(`/api/orgs/${owner.orgId}/features`).set(auth(owner)).expect(200);
  const features = { ...(current.body.features || {}), [key]: enabled };
  await request(app).put(`/api/orgs/${owner.orgId}/features`).set(auth(owner)).send({ features }).expect(200);
};

const tb = async () => {
  const res = await request(app).get(`/api/orgs/${owner.orgId}/ledger/trial-balance`).set(auth(owner)).expect(200);
  return res.body;
};

/** Net movement on the exchange gain/loss account: credit positive = a gain. */
const fxNet = (body: any) => {
  const row = body.rows.find((r: any) => r.controlKind === 'FX_GAIN_LOSS');
  return row ? Number(row.credit || 0) - Number(row.debit || 0) : 0;
};

/**
 * The org's bank account, opened on first use.
 *
 * Payment modes list only accounts the business opened, so a fresh org has
 * none until one is created — the setup control account is not a choice.
 */
let bankAccountId = '';
const bankId = async () => {
  if (bankAccountId) return bankAccountId;
  const created = await request(app)
    .post(`/api/orgs/${owner.orgId}/ledger/accounts`)
    .set(auth(owner))
    .send({ name: 'HDFC Current A/c', accountType: 'ASSET', controlKind: 'BANK' })
    .expect(201);
  bankAccountId = created.body.account.id as string;
  const res = await request(app).get(`/api/orgs/${owner.orgId}/payment-modes`).set(auth(owner)).expect(200);
  return res.body.modes.find((m: any) => m.id === bankAccountId).id as string;
};

/** A USD invoice booked at the 1 May rate of 80. */
const makeUsdInvoice = async (total: number, date = '2026-05-10') => {
  const res = await request(app)
    .post(`/api/orgs/${owner.orgId}/invoices`)
    .set(auth(owner))
    .send({
      date,
      currency: 'USD',
      exchangeRate: 80, // entered on the invoice: the 1 May rate
      customerName: 'Overseas Ltd',
      subtotal: total,
      gstTotal: 0,
      total,
      items: [{ description: 'Export', quantity: 1, rate: total, gstRate: 0 }],
    })
    .expect(201);
  return res.body.invoice;
};

beforeAll(async () => {
  owner = await makeOwner();
  await setFeature('multiCurrency', true);

  await request(app)
    .post(`/api/orgs/${owner.orgId}/currencies`)
    .set(auth(owner))
    .send({ code: 'USD', name: 'US Dollar' })
    .expect(201);

  for (const [date, rate] of [
    ['2026-05-01', 80],
    ['2026-06-01', 85],
    ['2026-07-01', 75],
  ] as const) {
    await request(app)
      .post(`/api/orgs/${owner.orgId}/exchange-rates`)
      .set(auth(owner))
      .send({ code: 'USD', date, rate })
      .expect(201);
  }
}, 60_000);

describe('realised gain and loss on settlement', () => {
  it('books a gain when the receivable is collected at a stronger rate', async () => {
    const invoice = await makeUsdInvoice(1000); // booked at 80 => INR 80,000
    const before = await tb();

    await request(app)
      .post(`/api/orgs/${owner.orgId}/payments`)
      .set(auth(owner))
      .send({
        direction: 'RECEIPT',
        date: '2026-06-10', // rate 85
        currency: 'USD',
        exchangeRate: 85,
        partyType: 'CUSTOMER',
        partyName: 'Overseas Ltd',
        ledgerAccountId: await bankId(),
        amount: 1000,
        allocations: [{ docType: 'INVOICE', docId: invoice.id, amount: 1000 }],
      })
      .expect(201);

    const after = await tb();

    // USD 1,000 at 85 is INR 85,000 into the bank, against a receivable
    // carried at 80,000 — a realised gain of 5,000.
    expect(round(fxNet(after) - fxNet(before))).toBe(5000);
    expect(after.totals.balanced).toBe(true);
    expect(after.totals.difference).toBe(0);
  });

  it('books a loss when it is collected at a weaker rate', async () => {
    const invoice = await makeUsdInvoice(1000);
    const before = await tb();

    await request(app)
      .post(`/api/orgs/${owner.orgId}/payments`)
      .set(auth(owner))
      .send({
        direction: 'RECEIPT',
        date: '2026-07-10', // rate 75
        currency: 'USD',
        exchangeRate: 75,
        partyType: 'CUSTOMER',
        partyName: 'Overseas Ltd',
        ledgerAccountId: await bankId(),
        amount: 1000,
        allocations: [{ docType: 'INVOICE', docId: invoice.id, amount: 1000 }],
      })
      .expect(201);

    const after = await tb();
    expect(round(fxNet(after) - fxNet(before))).toBe(-5000);
    expect(after.totals.balanced).toBe(true);
  });

  it('touches exchange gain/loss not at all when nothing is allocated', async () => {
    const before = await tb();

    await request(app)
      .post(`/api/orgs/${owner.orgId}/payments`)
      .set(auth(owner))
      .send({
        direction: 'RECEIPT',
        date: '2026-06-10',
        currency: 'USD',
        exchangeRate: 85,
        partyType: 'CUSTOMER',
        partyName: 'Advance payer',
        ledgerAccountId: await bankId(),
        amount: 500,
      })
      .expect(201);

    const after = await tb();
    // An advance is not a settlement: there is no booked rate to differ from.
    expect(round(fxNet(after) - fxNet(before))).toBe(0);
    expect(after.totals.balanced).toBe(true);
  });

  it('leaves a base-currency receipt alone', async () => {
    const before = await tb();
    await request(app)
      .post(`/api/orgs/${owner.orgId}/payments`)
      .set(auth(owner))
      .send({
        direction: 'RECEIPT',
        date: '2026-06-11',
        partyType: 'CUSTOMER',
        partyName: 'Local Ltd',
        ledgerAccountId: await bankId(),
        amount: 400,
      })
      .expect(201);

    const after = await tb();
    expect(round(fxNet(after) - fxNet(before))).toBe(0);
    expect(round(after.totals.debit - before.totals.debit)).toBe(400);
  });

  it('refuses a foreign-currency receipt with no conversion rate', async () => {
    const res = await request(app)
      .post(`/api/orgs/${owner.orgId}/payments`)
      .set(auth(owner))
      .send({
        direction: 'RECEIPT',
        date: '2026-01-05',
        currency: 'USD',
        partyType: 'CUSTOMER',
        partyName: 'Overseas Ltd',
        ledgerAccountId: await bankId(),
        amount: 100,
      })
      .expect(400);

    expect(String(res.body.error)).toMatch(/conversion rate/i);
  });
});

describe('revaluation of open balances', () => {
  it('previews the movement without posting anything', async () => {
    await makeUsdInvoice(2000, '2026-05-15'); // booked at 80

    const before = await tb();
    const preview = await request(app)
      .get(`/api/orgs/${owner.orgId}/fx/revaluation-preview?date=2026-06-15`)
      .set(auth(owner))
      .expect(200);
    const after = await tb();

    expect(preview.body.positions.length).toBeGreaterThan(0);
    // Nothing was written by a preview.
    expect(after.totals.debit).toBe(before.totals.debit);
  });

  it('posts an unrealised gain when the rate has risen', async () => {
    const before = await tb();

    const res = await request(app)
      .post(`/api/orgs/${owner.orgId}/fx/revalue`)
      .set(auth(owner))
      .send({ date: '2026-06-15' }) // rate 85 against invoices booked at 80
      .expect(200);

    expect(res.body.posted).toBe(true);
    expect(res.body.net).toBeGreaterThan(0);

    const after = await tb();
    expect(round(fxNet(after) - fxNet(before))).toBe(round(res.body.net));
    expect(after.totals.balanced).toBe(true);
  });

  it('ignores a fully settled invoice, whose gain was already realised', async () => {
    const invoice = await makeUsdInvoice(300, '2026-05-20');
    await request(app)
      .patch(`/api/orgs/${owner.orgId}/invoices/${invoice.id}/status`)
      .set(auth(owner))
      .send({ status: 'Paid', paidAmount: 300 })
      .expect(200);

    const preview = await request(app)
      .get(`/api/orgs/${owner.orgId}/fx/revaluation-preview?date=2026-06-15`)
      .set(auth(owner))
      .expect(200);

    expect(preview.body.positions.some((p: any) => p.invoiceId === invoice.id)).toBe(false);
  });

  it('refuses to revalue at a date with no rate rather than guessing', async () => {
    const res = await request(app)
      .post(`/api/orgs/${owner.orgId}/fx/revalue`)
      .set(auth(owner))
      .send({ date: '2026-01-02' })
      .expect(400);
    expect(String(res.body.error)).toMatch(/no exchange rate/i);
  });
});

function round(n: number) {
  return Math.round(Number(n) * 100) / 100;
}
