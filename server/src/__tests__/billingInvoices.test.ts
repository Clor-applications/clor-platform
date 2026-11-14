import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';

/**
 * CLOR's invoices to customers (roadmap item 8) and the CLOR Books connector
 * (item 10): drafts, issuing with the year's series, the UPI QR and bank
 * details on an issued invoice, Mark paid moving the subscription on,
 * cancelling, what a customer sees, and a draft raised once in CLOR's own
 * Books company.
 */
const { buildApp } = await import('../app.js');
const { codeAt, stepNow } = await import('../services/totp.js');
const { clearOfStepEdge } = await import('./totpTiming.js');
const { platformPrisma } = await import('../utils/platformPrisma.js');
const { prisma } = await import('../utils/prisma.js');
const { outsideTenant, runInTenant } = await import('../utils/tenantScope.js');
const { setSubscription, getSubscription } = await import('../services/subscriptions.js');
const { clearProviderCache } = await import('../billing/providers.js');
const { financialYear } = await import('../billing/invoicing.js');

const app = buildApp().listen(0, '127.0.0.1');
const db = <T>(fn: () => Promise<T>) => outsideTenant('test: invoices', fn);
const reset = async () => {
  await db(() => platformPrisma.billingInvoice.deleteMany({}));
  await db(() => platformPrisma.platformSetting.deleteMany({ where: { key: { in: ['billing.invoicing', 'billing.gst'] } } }));
  await db(() => platformPrisma.paymentProvider.deleteMany({}));
  await db(() => platformPrisma.paymentEvent.deleteMany({ where: { gateway: 'manual' } }));
  clearProviderCache();
};
beforeAll(reset);
afterAll(async () => {
  await reset();
  await new Promise((done) => app.close(done));
});
afterEach(() => {
  delete process.env.CLOR_OPERATOR_USER_IDS;
});

const rnd = () => Math.random().toString(36).slice(2, 8);
type Ctx = { token: string; orgId: string; branchId: string; userId: string };
const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });
const bearer = (c: Ctx) => ({ Authorization: `Bearer ${c.token}` });

async function company(name = `Inv Co ${rnd()}`): Promise<Ctx> {
  const email = `invoices.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'Owner' }).expect(200);
  const setup = await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${signup.body.token}`).send({ companyName: name, state: 'Karnataka' }).expect(200);
  const claims = jwt.decode(signup.body.token) as { userId: string };
  return { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id, userId: claims.userId };
}
const accountOf = async (c: Ctx) => (await db(() => platformPrisma.org.findUniqueOrThrow({ where: { id: c.orgId }, select: { accountId: true } }))).accountId!;
async function operator() {
  const op = await company();
  const sec = (p: string, b: unknown = {}) => request(app).post(`/api/orgs/${op.orgId}/security${p}`).set(at(op)).send(b as any);
  const { secret } = (await sec('/two-factor/setup', { password: 'Passw0rd!23' }).expect(200)).body;
  await clearOfStepEdge();
  await sec('/two-factor/enable', { code: codeAt(secret, stepNow() - 1) }).expect(200);
  process.env.CLOR_OPERATOR_USER_IDS = op.userId;
  const stepUp = (await request(app).post('/api/ops/step-up').set(bearer(op)).send({ code: codeAt(secret, stepNow()) }).expect(200)).body.token as string;
  return { op, h: { ...bearer(op), 'x-step-up': stepUp } };
}
const manual = (h: Record<string, string>) =>
  request(app)
    .put('/api/ops/payments/providers/manual')
    .set(h)
    .send({ enabled: true, manual: { upiId: 'clor@okaxis', payeeName: 'CLOR Applications', bank: { accountName: 'CLOR Applications Pvt Ltd', accountNumber: '50200012345678', ifsc: 'HDFC0001234', bankName: 'HDFC Bank' } } })
    .expect(200);
const LINES = [{ description: 'CLOR People, 25 users', appCode: 'people', quantity: 25, unitAmount: 9900 }];
const fy = financialYear(new Date());

describe('invoices to customers', () => {
  it('are for operators; changes need a fresh authenticator code', async () => {
    const c = await company();
    expect((await request(app).get('/api/ops/invoices').set(bearer(c)).expect(403)).body.code).toBe('OPERATOR_ONLY');
    const { op } = await operator();
    await request(app).get('/api/ops/invoices').set(bearer(op)).expect(200);
    expect((await request(app).post('/api/ops/invoices').set(bearer(op)).send({ accountId: 'x', lines: LINES }).expect(403)).body.code).toBe('STEP_UP_REQUIRED');
  });

  it('start from the subscription’s apps and the customer’s head office', async () => {
    const { h } = await operator();
    const cust = await company('Kaveri Traders');
    const accountId = await accountOf(cust);
    await db(() => setSubscription(accountId, { apps: [{ appCode: 'people', seats: 25, unitAmount: 9900 }] } as any));
    const s = await request(app).get(`/api/ops/invoices/start?accountId=${accountId}`).set(h).expect(200);
    expect(s.body.buyer.name).toBe('Kaveri Traders');
    expect(s.body.buyer.stateCode).toBe('29');
    expect(s.body.lines).toEqual([expect.objectContaining({ appCode: 'people', quantity: 25, unitAmount: 9900, amount: 247500 })]);
  });

  it('draft, issue with the year’s number and a UPI QR carrying the amount, then Mark paid moves the subscription on', async () => {
    const { op, h } = await operator();
    await manual(h);
    const cust = await company();
    const accountId = await accountOf(cust);
    await db(() => setSubscription(accountId, { apps: [{ appCode: 'people', seats: 25, unitAmount: 9900 }], trialDays: 14 } as any));

    const bad = await request(app).post('/api/ops/invoices').set(h).send({ accountId, lines: [{ description: '', quantity: 0, unitAmount: 100 }] }).expect(400);
    expect(bad.body.problems).toEqual(expect.arrayContaining(['Line 1: say what it is for.', 'Line 1: the quantity is a whole number from 1.']));

    const d = await request(app).post('/api/ops/invoices').set(h).send({ accountId, lines: LINES, months: 1 }).expect(201);
    expect(d.body).toMatchObject({ status: 'DRAFT', number: null, subtotal: 247500, taxTotal: 0, total: 247500 });
    expect(d.body.tax.charged).toBe(false);
    /* A customer never sees a draft. */
    expect((await request(app).get('/api/billing/invoices').set(at(cust)).expect(200)).body.invoices).toEqual([]);

    const changed = await request(app).patch(`/api/ops/invoices/${d.body.id}`).set(h).send({ lines: [{ ...LINES[0], quantity: 20 }] }).expect(200);
    expect(changed.body.total).toBe(198000);

    const i = await request(app).post(`/api/ops/invoices/${d.body.id}/issue`).set(h).expect(200);
    expect(i.body).toMatchObject({ status: 'ISSUED', number: `CLOR/${fy}/0001`, total: 198000 });
    expect(i.body.payTo.upiLink).toContain('am=1980.00');
    expect(i.body.payTo.upiLink).toContain(encodeURIComponent(`CLOR/${fy}/0001`));
    expect(i.body.payTo.qr).toMatch(/^data:image\/png;base64,/);
    expect(i.body.payTo.bank.accountNumber).toBe('50200012345678');
    await request(app).patch(`/api/ops/invoices/${d.body.id}`).set(h).send({ note: 'x' }).expect(409);

    /* The customer sees it, with how to pay. */
    const mine = await request(app).get(`/api/billing/invoices/${d.body.id}`).set(at(cust)).expect(200);
    expect(mine.body).toMatchObject({ number: `CLOR/${fy}/0001`, status: 'ISSUED' });
    expect(mine.body.payTo.upiId).toBe('clor@okaxis');
    expect(mine.body.issuedByUserId).toBeUndefined();
    /* Another customer does not. */
    const other = await company();
    await request(app).get(`/api/billing/invoices/${d.body.id}`).set(at(other)).expect(404);

    const p = await request(app).post(`/api/ops/invoices/${d.body.id}/mark-paid`).set(h).send({ reference: 'UTR123456789012', paidOn: new Date().toISOString().slice(0, 10) }).expect(200);
    expect(p.body).toMatchObject({ status: 'PAID', paidAmount: 198000, paymentReference: 'UTR123456789012' });
    expect((await getSubscription(accountId))?.status).toBe('active');
    expect(p.body.paidUntil).toBeTruthy();
    await request(app).post(`/api/ops/invoices/${d.body.id}/mark-paid`).set(h).send({ reference: 'UTR999999999999', paidOn: new Date().toISOString().slice(0, 10) }).expect(409);
    await request(app).post(`/api/ops/invoices/${d.body.id}/void`).set(h).send({ reason: 'mistake' }).expect(409);
    expect((await request(app).get(`/api/billing/invoices/${d.body.id}`).set(at(cust)).expect(200)).body.payTo).toBeNull();

    const log = await db(() => platformPrisma.operatorAuditEvent.findMany({ where: { operatorUserId: op.userId, action: { startsWith: 'INVOICE_' } }, orderBy: { at: 'asc' } }));
    expect(log.map((e) => e.action)).toEqual(['INVOICE_DRAFTED', 'INVOICE_DRAFT_CHANGED', 'INVOICE_ISSUED', 'INVOICE_MARKED_PAID']);
  });

  it('numbers run on without a gap: a discarded draft takes none, a cancelled invoice keeps its own', async () => {
    const { h } = await operator();
    const accountId = await accountOf(await company());
    const draft = () => request(app).post('/api/ops/invoices').set(h).send({ accountId, lines: LINES }).expect(201);
    const gone = await draft();
    await request(app).delete(`/api/ops/invoices/${gone.body.id}`).set(h).expect(200);
    const a = await draft();
    const ia = await request(app).post(`/api/ops/invoices/${a.body.id}/issue`).set(h).expect(200);
    await request(app).delete(`/api/ops/invoices/${a.body.id}`).set(h).expect(409);
    const v = await request(app).post(`/api/ops/invoices/${a.body.id}/void`).set(h).send({ reason: 'Wrong number of users' }).expect(200);
    expect(v.body.status).toBe('VOID');
    const b = await draft();
    const ib = await request(app).post(`/api/ops/invoices/${b.body.id}/issue`).set(h).expect(200);
    const n = (s: string) => Number(s.split('/').pop());
    expect(n(ib.body.number)).toBe(n(ia.body.number) + 1);
    const list = await request(app).get('/api/ops/invoices?status=VOID').set(h).expect(200);
    expect(list.body.invoices.map((r: any) => r.id)).toContain(a.body.id);
  });

  it('settings set the prefix, the next number and when payment is due; GST shows once CLOR is registered', async () => {
    const { h } = await operator();
    await request(app).put('/api/ops/invoicing').set(h).send({ prefix: 'CL-1', nextNumber: 1 }).expect(400);
    await request(app).put('/api/ops/invoicing').set(h).send({ prefix: 'CLR', nextNumber: 41, dueDays: 7, address: 'Bengaluru 560001' }).expect(200);
    const s = await request(app).get('/api/ops/invoicing').set(h).expect(200);
    expect(s.body).toMatchObject({ prefix: 'CLR', dueDays: 7, nextNumber: `CLR/${fy}/0041` });
    await request(app)
      .put('/api/ops/settings/tax')
      .set(h)
      .send({ registered: true, gstin: '29AABCU9603R1ZJ', legalName: 'Clor Applications Pvt Ltd', state: 'Karnataka', sac: '998314', ratePercent: 18 })
      .expect(200);
    const cust = await company();
    const accountId = await accountOf(cust);
    const d = await request(app)
      .post('/api/ops/invoices')
      .set(h)
      .send({ accountId, lines: [{ description: 'CLOR Books', quantity: 1, unitAmount: 100000 }], periodStart: '2026-11-01', periodEnd: '2026-11-30' })
      .expect(201);
    expect(d.body.tax).toMatchObject({ kind: 'CGST_SGST', cgst: 9000, sgst: 9000 });
    const i = await request(app).post(`/api/ops/invoices/${d.body.id}/issue`).set(h).expect(200);
    expect(i.body).toMatchObject({ number: `CLR/${fy}/0041`, total: 118000 });
    /* The customer's list carries the taxable value, the GST and the period, for its own columns. */
    const listed = (await request(app).get('/api/billing/invoices').set(at(cust)).expect(200)).body.invoices;
    expect(listed[0]).toMatchObject({ id: d.body.id, subtotal: 100000, taxTotal: 18000, total: 118000, periodStart: '2026-11-01', periodEnd: '2026-11-30' });
    expect(i.body.seller).toMatchObject({ gstin: '29AABCU9603R1ZJ', sac: '998314', address: 'Bengaluru 560001' });
    expect(new Date(i.body.dueDate).getTime() - new Date(i.body.issueDate).getTime()).toBe(7 * 86400000);
    await request(app).put('/api/ops/invoicing').set(h).send({ nextNumber: 41 }).expect(400);
  });
});

describe('the CLOR Books connector', () => {
  it('is off until a company is chosen; then sends each invoice once, as a Books draft with the same number', async () => {
    const { h } = await operator();
    const clor = await company('Clor Applications');
    const clorAccount = await accountOf(clor);
    const accountId = await accountOf(await company('Godavari Foods'));
    const d = await request(app).post('/api/ops/invoices').set(h).send({ accountId, lines: LINES }).expect(201);
    const i = await request(app).post(`/api/ops/invoices/${d.body.id}/issue`).set(h).expect(200);
    expect(i.body.books).toBeNull();
    expect((await request(app).post(`/api/ops/invoices/${d.body.id}/books`).set(h).expect(409)).body.error).toMatch(/connector is off/);

    await request(app).put('/api/ops/invoicing/books').set(h).send({ enabled: true }).expect(400);
    const choices = await request(app).get('/api/ops/invoicing/books/choices?q=Clor Applications').set(h).expect(200);
    const mine = choices.body.accounts.find((a: any) => a.id === clorAccount);
    expect(mine.companies[0].branches[0].id).toBe(clor.branchId);
    await request(app).put('/api/ops/invoicing/books').set(h).send({ enabled: true, accountId: clorAccount, orgId: clor.orgId, branchId: clor.branchId }).expect(200);
    const t = await request(app).post('/api/ops/invoicing/books/test').set(h).expect(200);
    expect(t.body.ok).toBe(true);
    expect(t.body.message).toMatch(/holds 0 invoices/);

    const s1 = await request(app).post(`/api/ops/invoices/${d.body.id}/books`).set(h).expect(200);
    expect(s1.body.booksStatus).toBe('SENT');
    const s2 = await request(app).post(`/api/ops/invoices/${d.body.id}/books`).set(h).expect(200);
    expect(s2.body.booksInvoiceId).toBe(s1.body.booksInvoiceId);
    const inBooks = await runInTenant(clor.orgId, () => prisma.invoice.findMany({ where: { orgId: clor.orgId, sourceSystem: 'clor-billing' } }));
    expect(inBooks).toHaveLength(1);
    expect(inBooks[0]).toMatchObject({ number: i.body.number, status: 'Draft', customerName: 'Godavari Foods' });
    expect(Number(inBooks[0].total)).toBe(i.body.total / 100);
    expect(Number(inBooks[0].gstTotal)).toBe(i.body.taxTotal / 100);
    const party = await runInTenant(clor.orgId, () => prisma.party.findFirst({ where: { orgId: clor.orgId, name: 'Godavari Foods' } }));
    expect(party?.partyType).toBe('CUSTOMER');

    /* Sent by itself on issue, once switched on. */
    await request(app).put('/api/ops/invoicing/books').set(h).send({ autoSend: true }).expect(200);
    const d2 = await request(app).post('/api/ops/invoices').set(h).send({ accountId, lines: LINES }).expect(201);
    const i2 = await request(app).post(`/api/ops/invoices/${d2.body.id}/issue`).set(h).expect(200);
    expect(i2.body.books.ok).toBe(true);
    expect(i2.body.booksStatus).toBe('SENT');
    expect(await runInTenant(clor.orgId, () => prisma.party.count({ where: { orgId: clor.orgId, name: 'Godavari Foods' } }))).toBe(1);
  });
});
