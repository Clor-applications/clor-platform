import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { buildApp } from '../app.js';

/**
 * The link a customer follows.
 *
 * The payment reminder carried "View invoice: …/?invoiceId=123", which only
 * worked for somebody already signed in with that company open — the business
 * itself, never the customer being chased. They landed on a login page, which
 * reads as a broken link sent by their supplier.
 *
 * Almost every test here is about the boundary, because a token in a URL is the
 * only thing standing between an address and somebody else's invoice.
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
  const email = `sh.${label}.${Date.now()}.${rnd()}@example.com`;
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

const raiseInvoice = async (c: Ctx) => {
  const res = await request(app)
    .post(`/api/orgs/${c.orgId}/invoices`)
    .set(auth(c))
    .send({
      number: `INV-${rnd()}`,
      date: '2026-09-09',
      customerName: 'Acme Traders',
      customerGstin: '29AAAAA0000A1Z5',
      subtotal: 1000,
      cgstTotal: 90,
      sgstTotal: 90,
      gstTotal: 180,
      total: 1180,
      status: 'Unpaid',
      items: [{ description: 'MS Angle 50mm', quantity: 2, rate: 500, gstRate: 18, amount: 1000 }],
    })
    .expect(201);
  return res.body.invoice;
};

let owner: Ctx;
let invoice: any;

beforeAll(async () => {
  owner = await makeOwner('main');
  invoice = await raiseInvoice(owner);
}, 60_000);

describe('sharing an invoice', () => {
  it('mints a link and serves the invoice to somebody with no account', async () => {
    const made = await request(app)
      .post(`/api/orgs/${owner.orgId}/invoices/${invoice.id}/share`)
      .set(auth(owner))
      .expect(201);
    expect(made.body.token).toBeTruthy();

    // No Authorization header, no org header — this is the customer.
    const seen = await request(app).get(`/api/public/invoice/${made.body.token}`).expect(200);
    expect(seen.body.invoice.number).toBe(invoice.number);
    expect(seen.body.to.name).toBe('Acme Traders');
    expect(seen.body.invoice.items[0].description).toBe('MS Angle 50mm');
    // The figure the reminder is about.
    expect(seen.body.invoice.dueAmount).toBe(1180);
  });

  /*
   * Re-sending a reminder must produce the same address. A fresh token each
   * time would quietly break every reminder already sent.
   */
  it('gives the same address every time', async () => {
    const a = await request(app).post(`/api/orgs/${owner.orgId}/invoices/${invoice.id}/share`).set(auth(owner));
    const b = await request(app).post(`/api/orgs/${owner.orgId}/invoices/${invoice.id}/share`).set(auth(owner));
    expect(a.body.token).toBe(b.body.token);
  });

  /*
   * What goes out is what is printed on the invoice anyway. Everything else the
   * row carries — the internal ids, the warehouse, who keyed it — stays here.
   */
  it('leaks nothing beyond the printed document', async () => {
    const made = await request(app).post(`/api/orgs/${owner.orgId}/invoices/${invoice.id}/share`).set(auth(owner));
    const seen = await request(app).get(`/api/public/invoice/${made.body.token}`).expect(200);
    const body = JSON.stringify(seen.body);
    expect(body).not.toContain(owner.orgId);
    expect(body).not.toContain(invoice.id);
    expect(seen.body.invoice.warehouseId).toBeUndefined();
    expect(seen.body.invoice.createdByUserId).toBeUndefined();
    expect(seen.body.invoice.accountId).toBeUndefined();
  });

  it('withdraws a link', async () => {
    const inv2 = await raiseInvoice(owner);
    const made = await request(app).post(`/api/orgs/${owner.orgId}/invoices/${inv2.id}/share`).set(auth(owner)).expect(201);
    await request(app).get(`/api/public/invoice/${made.body.token}`).expect(200);

    await request(app).delete(`/api/orgs/${owner.orgId}/invoices/${inv2.id}/share`).set(auth(owner)).expect(200);
    await request(app).get(`/api/public/invoice/${made.body.token}`).expect(404);
  });

  /*
   * The same answer for a wrong token, a revoked one and one that never
   * existed. Telling them apart tells somebody guessing which guesses are
   * close.
   */
  it('answers a bad token the same way as a withdrawn one', async () => {
    const short = await request(app).get('/api/public/invoice/nope').expect(404);
    const long = await request(app).get(`/api/public/invoice/${'a'.repeat(43)}`).expect(404);
    expect(short.body.error).toBeTruthy();
    expect(long.body.error).toBeTruthy();
  });

  /* A token is the only thing standing between a URL and an invoice, so it has
     to be long enough that guessing is hopeless. */
  it('mints a token long enough to be unguessable', async () => {
    const made = await request(app).post(`/api/orgs/${owner.orgId}/invoices/${invoice.id}/share`).set(auth(owner));
    expect(String(made.body.token).length).toBeGreaterThanOrEqual(40);
  });

  it("will not mint a link for another account's invoice", async () => {
    const stranger = await makeOwner('stranger');
    await request(app)
      .post(`/api/orgs/${stranger.orgId}/invoices/${invoice.id}/share`)
      .set(auth(stranger))
      .expect(404);
  });

  it('refuses an org the caller is not in', async () => {
    const stranger = await makeOwner('other');
    await request(app)
      .post(`/api/orgs/${stranger.orgId}/invoices/${invoice.id}/share`)
      .set(auth(owner))
      .expect(403);
  });

  /* Following a link must not need — or accept — a session. */
  it('needs no session at all', async () => {
    const made = await request(app).post(`/api/orgs/${owner.orgId}/invoices/${invoice.id}/share`).set(auth(owner));
    await request(app).get(`/api/public/invoice/${made.body.token}`).expect(200);
  });
});
