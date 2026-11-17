import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';

/**
 * A document whose figures disagree with its lines is refused where it is
 * saved, and nothing of it is kept: no row, no ledger entry, no number used.
 */
const { buildApp } = await import('../app.js');
const { prisma } = await import('../utils/prisma.js');
const { at, opsKit } = await import('./opsTestKit.js');

const app = buildApp().listen(0, '127.0.0.1');
afterAll(async () => {
  await new Promise((done) => app.close(done));
});
const { company } = opsKit(app);
type Ctx = Awaited<ReturnType<typeof company>>;
let c: Ctx;
beforeAll(async () => {
  c = await company('tot');
}, 60_000);

const line = { description: 'Work', quantity: 1, rate: 1000, gstRate: 18, taxableAmount: 1000, gstAmount: 180 };
const figures = { subtotal: 1000, cgstTotal: 90, sgstTotal: 90, igstTotal: 0, gstTotal: 180, total: 1180 };
const invoice = (over: Record<string, unknown> = {}) => ({ date: '2026-10-10', customerName: 'Asha Traders', items: [line], ...figures, ...over });
const bill = (over: Record<string, unknown> = {}) => ({ date: '2026-10-10', partyName: 'Supplier Co', items: [line], ...figures, ...over });
const entries = () => prisma.journalEntry.count({ where: { orgId: c.orgId } });

describe('saving a document whose figures do not add up', () => {
  it('an invoice: refused with the figure named, nothing kept, and the next good one takes the next number', async () => {
    const first = (await request(app).post(`/api/orgs/${c.orgId}/invoices`).set(at(c)).send(invoice()).expect(201)).body.invoice;
    const before = { rows: await prisma.invoice.count({ where: { orgId: c.orgId } }), entries: await entries() };

    const r = await request(app).post(`/api/orgs/${c.orgId}/invoices`).set(at(c)).send(invoice({ total: 118 })).expect(422);
    expect(r.body).toMatchObject({ code: 'TOTALS_MISMATCH', field: 'total', sent: 118, worked: 1180 });
    expect(r.body.error).toMatch(/^Not saved: the figures do not add up\./);
    await request(app).post(`/api/orgs/${c.orgId}/invoices`).set(at(c)).send(invoice({ cgstTotal: 0, sgstTotal: 0, gstTotal: 0, total: 1000 })).expect(422);
    expect({ rows: await prisma.invoice.count({ where: { orgId: c.orgId } }), entries: await entries() }).toEqual(before);

    const next = (await request(app).post(`/api/orgs/${c.orgId}/invoices`).set(at(c)).send(invoice()).expect(201)).body.invoice;
    const n = (s: string) => Number(String(s).match(/(\d+)\D*$/)![1]);
    expect(n(next.number)).toBe(n(first.number) + 1);
  }, 120_000);

  it('editing an invoice: figures that disagree are refused; a note alone is not checked', async () => {
    const made = (await request(app).post(`/api/orgs/${c.orgId}/invoices`).set(at(c)).send(invoice({ status: 'Draft' })).expect(201)).body.invoice;
    const bad = await request(app).patch(`/api/orgs/${c.orgId}/invoices/${made.id}`).set(at(c)).send({ total: 9999 }).expect(422);
    expect(bad.body).toMatchObject({ code: 'TOTALS_MISMATCH', field: 'total' });
    expect(Number((await prisma.invoice.findUniqueOrThrow({ where: { id: made.id } })).total)).toBe(1180);

    /* An invoice saved before this rule, with figures that do not agree, can still have its reference changed. */
    await prisma.invoice.update({ where: { id: made.id }, data: { total: 5 } });
    await request(app).patch(`/api/orgs/${c.orgId}/invoices/${made.id}`).set(at(c)).send({ refNo: 'PO-77' }).expect(200);
    /* And is put right by sending figures that agree. */
    await request(app).patch(`/api/orgs/${c.orgId}/invoices/${made.id}`).set(at(c)).send({ items: [{ ...line, rate: 2000, taxableAmount: 2000, gstAmount: 360 }], subtotal: 2000, cgstTotal: 180, sgstTotal: 180, gstTotal: 360, total: 2360 }).expect(200);
  }, 120_000);

  it('a bill, an expense, a credit note and a debit note: the same', async () => {
    const current = await request(app).get(`/api/orgs/${c.orgId}/features`).set(at(c)).expect(200);
    await request(app).put(`/api/orgs/${c.orgId}/features`).set(at(c)).send({ features: { ...(current.body.features || {}), creditNotes: true, debitNotes: true } }).expect(200);
    const before = await entries();
    for (const path of ['bills', 'expenses', 'credit-notes', 'debit-notes']) {
      const r = await request(app).post(`/api/orgs/${c.orgId}/${path}`).set(at(c)).send(bill({ subtotal: 100, total: 280 }));
      expect(r.status, path).toBe(422);
      expect(r.body.code, path).toBe('TOTALS_MISMATCH');
    }
    expect(await entries()).toBe(before);

    const made = (await request(app).post(`/api/orgs/${c.orgId}/bills`).set(at(c)).send(bill()).expect(201)).body.document;
    const edit = await request(app).patch(`/api/orgs/${c.orgId}/bills/${made.id}`).set(at(c)).send(bill({ total: 1 })).expect(422);
    expect(edit.body.field).toBe('total');
    expect(Number((await prisma.bill.findUniqueOrThrow({ where: { id: made.id } })).total)).toBe(1180);
  }, 120_000);
});
