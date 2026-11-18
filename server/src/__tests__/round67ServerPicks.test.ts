import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';

/**
 * Round 67 picks on the server: purchase order numbers printed on invoices,
 * TDS a customer deducted and the certificate chased, proformas turned into
 * invoices, CLOR's vendor documents for procurement, the Ops breach record
 * that emails customer admins, and What's new release notes.
 */
const { buildApp } = await import('../app.js');
const { codeAt, stepNow } = await import('../services/totp.js');
const { clearOfStepEdge } = await import('./totpTiming.js');
const { platformPrisma } = await import('../utils/platformPrisma.js');
const { outsideTenant } = await import('../utils/tenantScope.js');
const { setSubscription } = await import('../services/subscriptions.js');
const { clearProviderCache } = await import('../billing/providers.js');

const app = buildApp().listen(0, '127.0.0.1');
const db = <T>(fn: () => Promise<T>) => outsideTenant('test: round 67', fn);
const reset = async () => {
  await db(() => platformPrisma.billingProforma.deleteMany({}));
  await db(() => platformPrisma.billingPurchaseOrder.deleteMany({}));
  await db(() => platformPrisma.vendorDocument.deleteMany({}));
  await db(() => platformPrisma.opsBreach.deleteMany({}));
  await db(() => platformPrisma.billingInvoice.deleteMany({}));
  await db(() => platformPrisma.platformSetting.deleteMany({ where: { key: { in: ['billing.invoicing', 'billing.gst', 'billing.proforma'] } } }));
  await db(() => platformPrisma.paymentProvider.deleteMany({}));
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
type Ctx = { token: string; orgId: string; branchId: string; userId: string; email: string };
const at = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });
const bearer = (c: Ctx) => ({ Authorization: `Bearer ${c.token}` });
const today = () => new Date().toISOString().slice(0, 10);

async function company(name = `R67 Co ${rnd()}`): Promise<Ctx> {
  const email = `r67.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'Owner' }).expect(200);
  const setup = await request(app).post('/api/auth/setup-company').set('Authorization', `Bearer ${signup.body.token}`).send({ companyName: name, state: 'Karnataka' }).expect(200);
  const claims = jwt.decode(signup.body.token) as { userId: string };
  return { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id, userId: claims.userId, email };
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
const LINES = [{ description: 'CLOR People, 25 users', appCode: 'people', quantity: 25, unitAmount: 9900 }];
/* The smallest file that passes the PDF check. */
const PDF = `data:application/pdf;base64,${Buffer.from('%PDF-1.4\n%%EOF\n').toString('base64')}`;

describe('purchase orders on invoices', () => {
  it('a customer keeps PO numbers; the one covering the period prints on the issued invoice', async () => {
    const { h } = await operator();
    const cust = await company();
    const accountId = await accountOf(cust);

    const bad = await request(app).post('/api/billing/purchase-orders').set(at(cust)).send({ number: '', fromDate: '2026-12-01', toDate: '2026-01-01' }).expect(400);
    expect(bad.body.problems).toEqual(expect.arrayContaining(['Enter the purchase order number.']));

    const y = new Date().getFullYear();
    const po = await request(app).post('/api/billing/purchase-orders').set(at(cust)).send({ number: 'PO/4471', poDate: `${y}-01-02`, fromDate: `${y - 1}-01-01`, toDate: `${y + 1}-12-31` }).expect(201);
    const old = await request(app).post('/api/billing/purchase-orders').set(at(cust)).send({ number: 'PO/OLD', fromDate: '2020-01-01', toDate: '2020-12-31' }).expect(201);
    const list = await request(app).get('/api/billing/purchase-orders').set(at(cust)).expect(200);
    expect(list.body.mayChange).toBe(true);
    expect(list.body.purchaseOrders.map((p: any) => p.number)).toEqual(['PO/4471', 'PO/OLD']);
    await request(app).delete(`/api/billing/purchase-orders/${old.body.id}`).set(at(cust)).expect(204);
    /* Another customer cannot remove it. */
    const other = await company();
    await request(app).delete(`/api/billing/purchase-orders/${po.body.id}`).set(at(other)).expect(404);

    const d = await request(app).post('/api/ops/invoices').set(h).send({ accountId, lines: LINES }).expect(201);
    const i = await request(app).post(`/api/ops/invoices/${d.body.id}/issue`).set(h).expect(200);
    expect(i.body).toMatchObject({ poNumber: 'PO/4471', poDate: `${y}-01-02` });
    const mine = await request(app).get(`/api/billing/invoices/${d.body.id}`).set(at(cust)).expect(200);
    expect(mine.body.poNumber).toBe('PO/4471');
  });
});

describe('TDS on CLOR invoices', () => {
  it('Mark paid takes the TDS; the certificate is chased until it comes in', async () => {
    const { h } = await operator();
    const cust = await company('Tds Traders');
    const accountId = await accountOf(cust);
    const d = await request(app).post('/api/ops/invoices').set(h).send({ accountId, lines: LINES }).expect(201);
    await request(app).post(`/api/ops/invoices/${d.body.id}/issue`).set(h).expect(200);
    const total = d.body.total as number;

    await request(app).post(`/api/ops/invoices/${d.body.id}/mark-paid`).set(h).send({ reference: 'UTR111122223333', paidOn: today(), tdsDeducted: total }).expect(400);
    const p = await request(app).post(`/api/ops/invoices/${d.body.id}/mark-paid`).set(h).send({ reference: 'UTR111122223333', paidOn: today(), tdsDeducted: 24750 }).expect(200);
    expect(p.body).toMatchObject({ status: 'PAID', paidAmount: total - 24750, tdsDeducted: 24750, tdsCertificateAt: null });

    const due = await request(app).get('/api/ops/invoicing/tds-due').set(h).expect(200);
    expect(due.body.invoices).toEqual([expect.objectContaining({ id: d.body.id, tdsDeducted: 24750, accountName: 'Tds Traders' })]);

    const got = await request(app).post(`/api/ops/invoices/${d.body.id}/tds-certificate`).set(h).send({ receivedOn: today() }).expect(200);
    expect(got.body.tdsCertificateAt).toBeTruthy();
    await request(app).post(`/api/ops/invoices/${d.body.id}/tds-certificate`).set(h).send({}).expect(409);
    expect((await request(app).get('/api/ops/invoicing/tds-due').set(h).expect(200)).body.invoices).toEqual([]);
    const mine = await request(app).get(`/api/billing/invoices/${d.body.id}`).set(at(cust)).expect(200);
    expect(mine.body.tdsDeducted).toBe(24750);
  });
});

describe('proformas', () => {
  it('need a priced plan; are valid 15 days; Ops turns one into a draft invoice once', async () => {
    const { h } = await operator();
    const cust = await company();
    const accountId = await accountOf(cust);
    expect((await request(app).post('/api/billing/proformas').set(at(cust)).expect(409)).body.error).toMatch(/no price/);

    await db(() => setSubscription(accountId, { apps: [{ appCode: 'people', seats: 10, unitAmount: 9900 }] } as any));
    const pf = await request(app).post('/api/billing/proformas').set(at(cust)).expect(201);
    expect(pf.body.number).toMatch(/^PF\/.+\/0001$/);
    expect(pf.body.subtotal).toBe(99000);
    expect(pf.body.expired).toBe(false);
    const days = (new Date(pf.body.validUntil).getTime() - new Date(pf.body.createdAt).getTime()) / 86400000;
    expect(Math.round(days)).toBe(15);
    expect((await request(app).get('/api/billing/proformas').set(at(cust)).expect(200)).body.proformas).toHaveLength(1);
    await request(app).get(`/api/billing/proformas/${pf.body.id}`).set(at(cust)).expect(200);
    const other = await company();
    await request(app).get(`/api/billing/proformas/${pf.body.id}`).set(at(other)).expect(404);

    expect((await request(app).get('/api/ops/invoicing/proformas').set(h).expect(200)).body.proformas.some((p: any) => p.id === pf.body.id)).toBe(true);
    const inv = await request(app).post(`/api/ops/invoicing/proformas/${pf.body.id}/invoice`).set(h).expect(201);
    expect(inv.body).toMatchObject({ status: 'DRAFT', accountId, subtotal: 99000 });
    expect(inv.body.note).toContain(pf.body.number);
    await request(app).post(`/api/ops/invoicing/proformas/${pf.body.id}/invoice`).set(h).expect(409);
    expect((await request(app).get(`/api/billing/proformas/${pf.body.id}`).set(at(cust)).expect(200)).body.invoiced).toBe(true);
  });
});

describe('vendor documents', () => {
  it('Ops uploads PDFs; customers list and download them; other files are refused', async () => {
    const { h } = await operator();
    const cust = await company();
    await request(app).post('/api/ops/invoicing/vendor-documents').set(h).send({ kind: 'GST', dataUrl: 'data:text/html;base64,PGh0bWw+', fileName: 'x.html' }).expect(400);
    await request(app).post('/api/ops/invoicing/vendor-documents').set(h).send({ kind: 'GST', dataUrl: `data:application/pdf;base64,${Buffer.from('not a pdf').toString('base64')}`, fileName: 'x.pdf' }).expect(400);
    await request(app).post('/api/ops/invoicing/vendor-documents').set(h).send({ kind: 'NOPE', dataUrl: PDF, fileName: 'x.pdf' }).expect(400);
    const doc = await request(app).post('/api/ops/invoicing/vendor-documents').set(h).send({ kind: 'GST', dataUrl: PDF, fileName: 'gst "cert".pdf', validUntil: '2030-03-31' }).expect(201);
    expect(doc.body).toMatchObject({ kind: 'GST', validUntil: '2030-03-31' });

    const list = await request(app).get('/api/billing/vendor-documents').set(at(cust)).expect(200);
    expect(list.body.documents).toEqual([expect.objectContaining({ id: doc.body.id, kind: 'GST' })]);
    expect(list.body.documents[0].content).toBeUndefined();
    const file = await request(app).get(`/api/billing/vendor-documents/${doc.body.id}/file`).set(at(cust)).expect(200);
    expect(file.body.contentType).toBe('application/pdf');
    expect(file.body.fileName).not.toContain('"');
    expect(Buffer.from(file.body.dataUrl.split(',')[1], 'base64').subarray(0, 4).toString()).toBe('%PDF');
    await request(app).get(`/api/ops/invoicing/vendor-documents/${doc.body.id}/file`).set(h).expect(200);

    await request(app).delete(`/api/ops/invoicing/vendor-documents/${doc.body.id}`).set(h).expect(204);
    expect((await request(app).get('/api/billing/vendor-documents').set(at(cust)).expect(200)).body.documents).toEqual([]);
  });
});

describe('Ops breach record', () => {
  it('records a breach and emails each customer’s admins once', async () => {
    const { op, h } = await operator();
    const a = await company('Breach One');
    const b = await company('Breach Two');
    const ids = [await accountOf(a), await accountOf(b)];
    const body = { what: 'A support export was shared with the wrong person.', dataKinds: 'Names and work emails', stepsTaken: 'The link was revoked within an hour.', happenedOn: today(), foundOn: today(), accountIds: ids };

    await request(app).post('/api/ops/breaches').set(bearer(op)).send(body).expect(403);
    await request(app).post('/api/ops/breaches').set(h).send({ ...body, foundOn: '2020-01-01' }).expect(400);
    await request(app).post('/api/ops/breaches').set(h).send({ ...body, accountIds: ['nope'] }).expect(400);
    const r = await request(app).post('/api/ops/breaches').set(h).send(body).expect(201);
    expect(r.body.accounts.map((x: any) => x.name).sort()).toEqual(['Breach One', 'Breach Two']);
    expect(r.body.notifiedAt).toBeNull();
    /* A customer cannot see it. */
    await request(app).get('/api/ops/breaches').set(at(a)).expect(403);

    const n = await request(app).post(`/api/ops/breaches/${r.body.id}/notify`).set(h).expect(200);
    expect(n.body.notifiedCount).toBe(2);
    const mails = await db(() => platformPrisma.emailOutbox.findMany({ where: { templateKey: 'platform.breach_notice', toEmail: { in: [a.email, b.email] } } }));
    expect(mails).toHaveLength(2);
    await request(app).post(`/api/ops/breaches/${r.body.id}/notify`).set(h).expect(409);
    const list = await request(app).get('/api/ops/breaches').set(h).expect(200);
    expect(list.body.breaches[0]).toMatchObject({ id: r.body.id, notifiedCount: 2 });
  });
});

describe('What’s new', () => {
  it('release notes stay out of the banner and show under Help until seen', async () => {
    const { h } = await operator();
    const cust = await company();
    const made = await request(app).post('/api/ops/announcements').set(h).send({ title: 'Proformas in Billing', body: 'Get a proforma with GST from Billing, valid 15 days.', kind: 'release' }).expect(201);
    await request(app).post(`/api/ops/announcements/${made.body.announcement.id}/publish`).set(h).send({}).expect(200);

    const banner = await request(app).get('/api/announcements').set(at(cust)).expect(200);
    expect(JSON.stringify(banner.body)).not.toContain(made.body.announcement.id);

    const w = await request(app).get('/api/announcements/whats-new').set(at(cust)).expect(200);
    expect(w.body.unseen).toBeGreaterThanOrEqual(1);
    expect(w.body.notes.find((n: any) => n.id === made.body.announcement.id)).toMatchObject({ title: 'Proformas in Billing', seen: false });
    await request(app).post('/api/announcements/whats-new/seen').set(at(cust)).expect(200);
    const after = await request(app).get('/api/announcements/whats-new').set(at(cust)).expect(200);
    expect(after.body.unseen).toBe(0);
    expect(after.body.notes.find((n: any) => n.id === made.body.announcement.id).seen).toBe(true);

    await db(() => platformPrisma.announcement.deleteMany({ where: { id: made.body.announcement.id } }));
  });
});
