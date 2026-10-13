import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { buildApp } from '../app.js';
import { prisma } from '../utils/prisma.js';

/**
 * The account, above any one company.
 *
 * Everything else is scoped to a company, which is right for doing the work and
 * wrong for running the business that does it. These check that the figures are
 * this account's and nobody else's — the screen sums money across companies, so
 * a leak here would put another firm's turnover on the page.
 */

const app = buildApp().listen(0);
afterAll(() => new Promise((done) => app.close(done)));
const rnd = () => Math.random().toString(36).slice(2, 8);

type Ctx = { token: string; orgId: string; branchId: string };
const auth = (c: Ctx) => ({
  Authorization: `Bearer ${c.token}`,
  'x-org-id': c.orgId,
  'x-branch-id': c.branchId,
});

const makeOwner = async (label: string): Promise<Ctx> => {
  const email = `ao.${label}.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app)
    .post('/api/auth/signup')
    .send({ email, password: 'Passw0rd!23', name: `${label} owner` })
    .expect(200);
  const setup = await request(app)
    .post('/api/auth/setup-company')
    .set('Authorization', `Bearer ${signup.body.token}`)
    .send({ companyName: `${label} Co ${Date.now()}-${rnd()}`, state: 'Karnataka' })
    .expect(200);
  return { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id };
};

let owner: Ctx;
let secondOrgId: string;
let secondBranchId: string;

beforeAll(async () => {
  owner = await makeOwner('main');
  const second = await request(app)
    .post('/api/auth/setup-company')
    .set('Authorization', `Bearer ${owner.token}`)
    .send({ companyName: `Client B ${Date.now()}-${rnd()}`, state: 'Kerala' })
    .expect(200);
  secondOrgId = String(second.body.company.orgId);
  secondBranchId = String(second.body.branch.id);

  await request(app)
    .post(`/api/orgs/${owner.orgId}/invoices`)
    .set(auth(owner))
    .send({
      number: `INV-${rnd()}`,
      date: '2026-09-09',
      customerName: 'Acme Traders',
      subtotal: 1000,
      cgstTotal: 90,
      sgstTotal: 90,
      gstTotal: 180,
      total: 1180,
      status: 'Unpaid',
      items: [{ description: 'MS Angle', quantity: 1, rate: 1000, gstRate: 18, amount: 1000 }],
    })
    .expect(201);
}, 60_000);

describe('the account overview', () => {
  it('lists every company on the account with its own figures', async () => {
    const res = await request(app).get('/api/account/overview').set(auth(owner)).expect(200);
    const ids = res.body.companies.map((c: any) => c.orgId);
    expect(ids).toContain(owner.orgId);
    expect(ids).toContain(secondOrgId);

    const first = res.body.companies.find((c: any) => c.orgId === owner.orgId);
    expect(first.invoices).toBe(1);
    expect(first.billed).toBe(1180);
    // Nothing paid yet, so all of it is still owed.
    expect(first.outstanding).toBe(1180);

    const second = res.body.companies.find((c: any) => c.orgId === secondOrgId);
    expect(second.invoices).toBe(0);
    expect(second.billed).toBe(0);
  });

  /*
   * Outstanding is what is still owed, not what was billed. With every invoice
   * unpaid the two are identical and the difference between them is untested —
   * so this one is part paid.
   */
  it('counts only what is still owed as outstanding', async () => {
    const inv = await request(app)
      .post(`/api/orgs/${secondOrgId}/invoices`)
      .set({ Authorization: `Bearer ${owner.token}`, 'x-org-id': secondOrgId, 'x-branch-id': secondBranchId })
      .send({
        number: `INV-${rnd()}`,
        date: '2026-09-09',
        customerName: 'Part payer',
        subtotal: 2000,
        gstTotal: 0,
        total: 2000,
        paidAmount: 500,
        status: 'Partial',
        items: [{ description: 'x', quantity: 1, rate: 2000, gstRate: 0, amount: 2000 }],
      });
    expect(inv.status).toBe(201);

    /*
     * Settled by writing the row, not by editing the invoice.
     *
     * Editing an invoice cannot set paidAmount and should not: the field is
     * stripped by the field-level permission filter, because money is recorded
     * by a receipt rather than by someone typing a number onto the document it
     * settles. Recording a whole receipt here would test that route instead of
     * this one, so the row is set directly and the overview's arithmetic is
     * what is actually under test.
     */
    await prisma.invoice.update({
      where: { id: String(inv.body.invoice.id) },
      data: { paidAmount: 500, status: 'Partial' },
    });

    const res = await request(app).get('/api/account/overview').set(auth(owner)).expect(200);
    const second = res.body.companies.find((c: any) => c.orgId === secondOrgId);
    expect(second.billed).toBe(2000);
    // Billed 2,000 against 500 received.
    expect(second.outstanding).toBe(1500);
  });

  it('reports the plan and what is used against it', async () => {
    const res = await request(app).get('/api/account/overview').set(auth(owner)).expect(200);
    expect(res.body.plan.name).toBeTruthy();
    expect(res.body.usage.companies).toBe(res.body.companies.length);
    expect(res.body.usage.users).toBeGreaterThanOrEqual(1);
  });

  /* The head-office state decides how every invoice the company raises is
     taxed, and it lives in the company master rather than a column. */
  it('reads the state out of the company master', async () => {
    const res = await request(app).get('/api/account/overview').set(auth(owner)).expect(200);
    const second = res.body.companies.find((c: any) => c.orgId === secondOrgId);
    expect(second.state).toBe('Kerala');
  });

  /*
   * The screen sums money across companies. A leak here would put another
   * firm's turnover on the page.
   */
  it("never counts another account's companies or money", async () => {
    const stranger = await makeOwner('stranger');
    await request(app)
      .post(`/api/orgs/${stranger.orgId}/invoices`)
      .set(auth(stranger))
      .send({
        number: `INV-${rnd()}`,
        date: '2026-09-09',
        customerName: 'Somebody else',
        subtotal: 999999,
        gstTotal: 0,
        total: 999999,
        status: 'Unpaid',
        items: [{ description: 'x', quantity: 1, rate: 999999, gstRate: 0, amount: 999999 }],
      })
      .expect(201);

    const res = await request(app).get('/api/account/overview').set(auth(owner)).expect(200);
    expect(res.body.companies.find((c: any) => c.orgId === stranger.orgId)).toBeUndefined();
    const billed = res.body.companies.reduce((s: number, c: any) => s + Number(c.billed || 0), 0);
    expect(billed).toBeLessThan(999999);
  });
});
