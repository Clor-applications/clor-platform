import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { buildApp } from '../app.js';

/**
 * One listening server for the whole file — see ledger.test.ts for why
 * (per-request listeners were the suite's flake source).
 */
const app = buildApp().listen(0);
afterAll(() => new Promise((done) => app.close(done)));

type Ctx = { token: string; orgId: string; branchId: string; accountId: string; userId: string };

let A: Ctx;

async function makeTenant(label: string): Promise<Ctx> {
  const email = `${label}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}@example.com`;
  const signup = await request(app)
    .post('/api/auth/signup')
    .send({ email, password: 'Passw0rd!23', name: `${label} owner` })
    .expect(200);
  const token = signup.body.token as string;
  const setup = await request(app)
    .post('/api/auth/setup-company')
    .set('Authorization', `Bearer ${token}`)
    .send({ companyName: `${label} Co ${Date.now()}`, state: 'Karnataka' })
    .expect(200);
  return {
    token,
    orgId: setup.body.company.orgId,
    branchId: setup.body.branch.id,
    accountId: signup.body.user.accountId,
    userId: signup.body.user.id,
  };
}

const auth = (c: Ctx) => ({
  Authorization: `Bearer ${c.token}`,
  'x-org-id': c.orgId,
  'x-branch-id': c.branchId,
});

const expensePayload = (over: Record<string, unknown> = {}) => ({
  date: '2026-08-18',
  partyName: 'City Landlord',
  category: 'Rent',
  description: 'August office rent',
  subtotal: 10000,
  cgstTotal: 900,
  sgstTotal: 900,
  igstTotal: 0,
  gstTotal: 1800,
  total: 11800,
  items: [{ description: 'Office rent', quantity: 1, rate: 10000, gstRate: 18 }],
  ...over,
});

beforeAll(async () => {
  A = await makeTenant('tenant-exp');
}, 60_000);

describe('expense vouchers on the server', () => {
  it('creates an expense, posts it, and the trial balance stays footed', async () => {
    const res = await request(app)
      .post(`/api/orgs/${A.orgId}/expenses`)
      .set(auth(A))
      .send(expensePayload())
      .expect(201);

    expect(res.body.document.number).toMatch(/^EXP-/);
    expect(res.body.document.category).toBe('Rent');

    const tb = await request(app).get(`/api/orgs/${A.orgId}/ledger/trial-balance`).set(auth(A)).expect(200);
    expect(tb.body.totals.balanced).toBe(true);

    const byName = new Map(tb.body.rows.map((r: any) => [r.name, r]));
    const exp = byName.get('Indirect Expenses') as any;
    const ap = byName.get('Accounts Payable') as any;
    expect(exp.debit).toBeCloseTo(10000, 2);
    expect(ap.credit).toBeCloseTo(11800, 2);
    // input GST is an asset claim, not a cost
    expect((byName.get('Input CGST') as any).debit).toBeCloseTo(900, 2);
  });

  it('deleting an expense reverses its posting instead of editing history', async () => {
    const created = await request(app)
      .post(`/api/orgs/${A.orgId}/expenses`)
      .set(auth(A))
      .send(expensePayload({ partyName: 'Cab Co', category: 'Travel', subtotal: 500, cgstTotal: 0, sgstTotal: 0, gstTotal: 0, total: 500 }))
      .expect(201);

    const before = await request(app).get(`/api/orgs/${A.orgId}/ledger/trial-balance`).set(auth(A)).expect(200);

    const del = await request(app)
      .delete(`/api/orgs/${A.orgId}/expenses/${created.body.document.id}`)
      .set(auth(A))
      .expect(200);
    expect(del.body.reversedEntries).toBe(1);

    const after = await request(app).get(`/api/orgs/${A.orgId}/ledger/trial-balance`).set(auth(A)).expect(200);
    expect(after.body.totals.balanced).toBe(true);
    // net effect of create+reverse is zero: AP net equals what it was before this voucher
    const apNet = (r: any) => {
      const row = r.body.rows.find((x: any) => x.name === 'Accounts Payable');
      return (row?.debit || 0) - (row?.credit || 0);
    };
    expect(apNet(after)).toBeCloseTo(apNet(before) + 500, 2);
  });

  it('lists expenses for the branch', async () => {
    const list = await request(app).get(`/api/orgs/${A.orgId}/expenses`).set(auth(A)).expect(200);
    expect(Array.isArray(list.body.documents)).toBe(true);
    expect(list.body.documents.length).toBeGreaterThanOrEqual(1);
  });

  it('updates the same expense and replaces its ledger posting', async () => {
    const created = await request(app)
      .post(`/api/orgs/${A.orgId}/expenses`)
      .set(auth(A))
      .send(expensePayload({ partyName: 'Professional Vendor', subtotal: 1500, cgstTotal: 0, sgstTotal: 0, gstTotal: 0, total: 1500 }))
      .expect(201);

    const id = created.body.document.id;
    const number = created.body.document.number;
    const updated = await request(app)
      .patch(`/api/orgs/${A.orgId}/expenses/${id}`)
      .set(auth(A))
      .send(expensePayload({
        number,
        partyName: 'Professional Vendor',
        description: 'Corrected professional fees',
        subtotal: 2500,
        cgstTotal: 0,
        sgstTotal: 0,
        gstTotal: 0,
        total: 2500,
        items: [{ description: 'Professional fees', quantity: 1, rate: 2500, gstRate: 0 }],
      }))
      .expect(200);

    expect(updated.body.document).toMatchObject({ id, number, total: 2500, description: 'Corrected professional fees' });

    const list = await request(app).get(`/api/orgs/${A.orgId}/expenses`).set(auth(A)).expect(200);
    expect(list.body.documents.filter((doc: any) => doc.id === id)).toHaveLength(1);
    expect(list.body.documents.find((doc: any) => doc.id === id)?.total).toBe(2500);

    const tb = await request(app).get(`/api/orgs/${A.orgId}/ledger/trial-balance`).set(auth(A)).expect(200);
    expect(tb.body.totals.balanced).toBe(true);
  });

  it('will not switch expenses off while expense entries exist', async () => {
    const current = await request(app).get(`/api/orgs/${A.orgId}/features`).set(auth(A)).expect(200);
    const res = await request(app)
      .put(`/api/orgs/${A.orgId}/features`)
      .set(auth(A))
      .send({ features: { ...current.body.features, expenses: false } })
      .expect(409);
    expect(res.body.code).toBe('FEATURE_IN_USE');
  });

  it('respects the expenses feature switch', async () => {
    // A company with no expense entries yet, so the switch is free to turn off.
    const fresh = await makeTenant('tenant-exp-switch');
    const current = await request(app).get(`/api/orgs/${fresh.orgId}/features`).set(auth(fresh)).expect(200);
    await request(app)
      .put(`/api/orgs/${fresh.orgId}/features`)
      .set(auth(fresh))
      .send({ features: { ...current.body.features, expenses: false } })
      .expect(200);
    const res = await request(app)
      .post(`/api/orgs/${fresh.orgId}/expenses`)
      .set(auth(fresh))
      .send(expensePayload({ partyName: 'Nobody' }))
      .expect(400);
    expect(String(res.body.error)).toMatch(/switched off/i);
  });
});
