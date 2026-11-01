import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { buildApp } from '../app.js';

/**
 * What may be cancelled, deleted or changed once something leans on it.
 *
 * A paid invoice could be cancelled and a paid bill deleted: the sale or
 * purchase left the ledger while the receipt or payment stayed, allocated
 * against nothing. And an expense could not be changed at all — the form
 * sent its edit to a route that did not exist.
 */

const app = buildApp().listen(0, '127.0.0.1');
afterAll(() => new Promise((done) => app.close(done)));
const rnd = () => Math.random().toString(36).slice(2, 8);

type Ctx = { token: string; orgId: string; branchId: string };
let owner: Ctx;
let bankId: string;

const auth = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });

beforeAll(async () => {
  const email = `settled.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name: 'Settled owner' }).expect(200);
  const setup = await request(app)
    .post('/api/auth/setup-company')
    .set('Authorization', `Bearer ${signup.body.token}`)
    .send({ companyName: `Settled Co ${Date.now()}-${rnd()}`, state: 'Karnataka' })
    .expect(200);
  owner = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id };

  const current = await request(app).get(`/api/orgs/${owner.orgId}/features`).set(auth(owner)).expect(200);
  const features = { ...(current.body.features || {}), creditNotes: true, debitNotes: true, expenses: true };
  await request(app).put(`/api/orgs/${owner.orgId}/features`).set(auth(owner)).send({ features }).expect(200);

  const bank = await request(app)
    .post(`/api/orgs/${owner.orgId}/ledger/accounts`)
    .set(auth(owner))
    .send({ name: `Bank ${rnd()}`, accountType: 'ASSET', controlKind: 'BANK' })
    .expect(201);
  bankId = bank.body.account.id;
}, 60_000);

const invoiceBody = () => ({
  date: '2026-07-10',
  customerName: 'Acme Traders',
  subtotal: 1000,
  gstTotal: 0,
  total: 1000,
  items: [{ description: 'Service', quantity: 1, rate: 1000, gstRate: 0 }],
});

const docBody = (over: Record<string, unknown> = {}) => ({
  date: '2026-07-12',
  partyName: 'Supplier Co',
  subtotal: 1000,
  cgstTotal: 0,
  sgstTotal: 0,
  igstTotal: 0,
  gstTotal: 0,
  total: 1000,
  items: [{ description: 'Material', quantity: 1, rate: 1000, gstRate: 0 }],
  ...over,
});

const pay = (direction: 'RECEIPT' | 'PAYMENT', docType: 'INVOICE' | 'BILL', docId: string, amount: number) =>
  request(app)
    .post(`/api/orgs/${owner.orgId}/payments`)
    .set(auth(owner))
    .send({
      direction,
      date: '2026-07-20',
      partyType: direction === 'RECEIPT' ? 'CUSTOMER' : 'VENDOR',
      partyName: direction === 'RECEIPT' ? 'Acme Traders' : 'Supplier Co',
      ledgerAccountId: bankId,
      amount,
      allocations: [{ docType, docId, amount }],
    });

const cancel = (id: string) =>
  request(app).patch(`/api/orgs/${owner.orgId}/invoices/${id}/status`).set(auth(owner)).send({ status: 'Cancelled' });

describe('cancelling an invoice', () => {
  it('is refused while a receipt is allocated to it, and allowed once the receipt is reversed', async () => {
    const inv = await request(app).post(`/api/orgs/${owner.orgId}/invoices`).set(auth(owner)).send(invoiceBody()).expect(201);
    const id = inv.body.invoice.id;
    const receipt = await pay('RECEIPT', 'INVOICE', id, 400).expect(201);

    const refused = await cancel(id).expect(409);
    expect(refused.body.code).toBe('document_settled');
    expect(refused.body.error).toMatch(/Reverse the receipt first/);

    await request(app).post(`/api/orgs/${owner.orgId}/payments/${receipt.body.payment.id}/reverse`).set(auth(owner)).expect(200);
    await cancel(id).expect(200);
  });

  it('is refused while a credit note is raised against it', async () => {
    const inv = await request(app).post(`/api/orgs/${owner.orgId}/invoices`).set(auth(owner)).send(invoiceBody()).expect(201);
    await request(app)
      .post(`/api/orgs/${owner.orgId}/credit-notes`)
      .set(auth(owner))
      .send(docBody({ partyName: 'Acme Traders', total: 200, subtotal: 200, againstDocId: inv.body.invoice.id }))
      .expect(201);
    const refused = await cancel(inv.body.invoice.id).expect(409);
    expect(refused.body.error).toMatch(/credit note/i);
  });

  it('still cancels an invoice nothing leans on', async () => {
    const inv = await request(app).post(`/api/orgs/${owner.orgId}/invoices`).set(auth(owner)).send(invoiceBody()).expect(201);
    await cancel(inv.body.invoice.id).expect(200);
  });
});

describe('deleting a bill', () => {
  it('is refused while a payment is allocated to it', async () => {
    const bill = await request(app).post(`/api/orgs/${owner.orgId}/bills`).set(auth(owner)).send(docBody()).expect(201);
    await pay('PAYMENT', 'BILL', bill.body.document.id, 300).expect(201);
    const refused = await request(app).delete(`/api/orgs/${owner.orgId}/bills/${bill.body.document.id}`).set(auth(owner)).expect(409);
    expect(refused.body.error).toMatch(/Reverse the payment first/);
  });

  it('is refused while a debit note is raised against it', async () => {
    const bill = await request(app).post(`/api/orgs/${owner.orgId}/bills`).set(auth(owner)).send(docBody()).expect(201);
    await request(app)
      .post(`/api/orgs/${owner.orgId}/debit-notes`)
      .set(auth(owner))
      .send(docBody({ total: 100, subtotal: 100, againstDocId: bill.body.document.id }))
      .expect(201);
    await request(app).delete(`/api/orgs/${owner.orgId}/bills/${bill.body.document.id}`).set(auth(owner)).expect(409);
  });

  it('still deletes a bill nothing leans on', async () => {
    const bill = await request(app).post(`/api/orgs/${owner.orgId}/bills`).set(auth(owner)).send(docBody()).expect(201);
    await request(app).delete(`/api/orgs/${owner.orgId}/bills/${bill.body.document.id}`).set(auth(owner)).expect(200);
  });
});

describe('cancelling a bill', () => {
  const payable = async () => {
    const res = await request(app).get(`/api/orgs/${owner.orgId}/ledger/trial-balance`).set(auth(owner)).expect(200);
    const row = res.body.rows.find((r: any) => r.controlKind === 'AP');
    return row ? Math.round((Number(row.credit || 0) - Number(row.debit || 0)) * 100) / 100 : 0;
  };

  it('reverses its entry and keeps it, marked Cancelled — once', async () => {
    const before = await payable();
    const bill = await request(app).post(`/api/orgs/${owner.orgId}/bills`).set(auth(owner)).send(docBody()).expect(201);
    expect(await payable()).toBeCloseTo(before + 1000, 2);
    const res = await request(app).post(`/api/orgs/${owner.orgId}/bills/${bill.body.document.id}/cancel`).set(auth(owner)).expect(200);
    expect(res.body.document.status).toBe('Cancelled');
    expect(await payable()).toBeCloseTo(before, 2);
    await request(app).post(`/api/orgs/${owner.orgId}/bills/${bill.body.document.id}/cancel`).set(auth(owner)).expect(409);
  });

  it('is refused while a payment is allocated to it', async () => {
    const bill = await request(app).post(`/api/orgs/${owner.orgId}/bills`).set(auth(owner)).send(docBody()).expect(201);
    await pay('PAYMENT', 'BILL', bill.body.document.id, 200).expect(201);
    const res = await request(app).post(`/api/orgs/${owner.orgId}/bills/${bill.body.document.id}/cancel`).set(auth(owner)).expect(409);
    expect(res.body.error).toMatch(/then cancel it/);
  });
});

describe('changing a saved expense or bill', () => {
  const tbPayable = async () => {
    const res = await request(app).get(`/api/orgs/${owner.orgId}/ledger/trial-balance`).set(auth(owner)).expect(200);
    const row = res.body.rows.find((r: any) => r.controlKind === 'AP');
    return row ? Math.round((Number(row.credit || 0) - Number(row.debit || 0)) * 100) / 100 : 0;
  };

  it('reverses the old posting and posts the new one, so the books move by the difference', async () => {
    const before = await tbPayable();
    const exp = await request(app).post(`/api/orgs/${owner.orgId}/expenses`).set(auth(owner)).send(docBody()).expect(201);
    expect(await tbPayable()).toBeCloseTo(before + 1000, 2);

    const changed = await request(app)
      .patch(`/api/orgs/${owner.orgId}/expenses/${exp.body.document.id}`)
      .set(auth(owner))
      .send(docBody({ subtotal: 1500, total: 1500 }))
      .expect(200);
    expect(Number(changed.body.document.total)).toBe(1500);
    expect(changed.body.document.number).toBe(exp.body.document.number);
    expect(await tbPayable()).toBeCloseTo(before + 1500, 2);
  });

  it('refuses to reduce a paid bill below what was paid', async () => {
    const bill = await request(app).post(`/api/orgs/${owner.orgId}/bills`).set(auth(owner)).send(docBody()).expect(201);
    await pay('PAYMENT', 'BILL', bill.body.document.id, 1000).expect(201);
    const refused = await request(app)
      .patch(`/api/orgs/${owner.orgId}/bills/${bill.body.document.id}`)
      .set(auth(owner))
      .send(docBody({ total: 900, subtotal: 900 }))
      .expect(409);
    // A paid bill may still be changed, but not reduced below what was paid.
    expect(refused.body.error).toMatch(/Reverse the payment before reducing its total/);
  });

  it('refuses to change a document in a locked period, and leaves it untouched', async () => {
    const exp = await request(app).post(`/api/orgs/${owner.orgId}/expenses`).set(auth(owner)).send(docBody({ date: '2026-05-05' })).expect(201);
    await request(app)
      .post(`/api/orgs/${owner.orgId}/ledger/fiscal-years/2026-27/lock`)
      .set(auth(owner))
      .send({ lockedThrough: '2026-05-31' })
      .expect(200);
    try {
      await request(app)
        .patch(`/api/orgs/${owner.orgId}/expenses/${exp.body.document.id}`)
        .set(auth(owner))
        .send(docBody({ date: '2026-05-05', total: 2000, subtotal: 2000 }))
        .expect(409);
      const list = await request(app).get(`/api/orgs/${owner.orgId}/expenses`).set(auth(owner)).expect(200);
      const row = (list.body.documents || list.body.expenses || []).find((d: any) => d.id === exp.body.document.id);
      expect(Number(row.total)).toBe(1000);
    } finally {
      await request(app)
        .post(`/api/orgs/${owner.orgId}/ledger/fiscal-years/2026-27/lock`)
        .set(auth(owner))
        .send({ lockedThrough: null })
        .expect(200);
    }
  });
});
