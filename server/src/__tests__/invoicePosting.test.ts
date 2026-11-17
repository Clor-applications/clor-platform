import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';

/**
 * When an invoice is in the books (audit, 17 Nov 2026):
 *  - a draft is not; it enters when it is finalised;
 *  - cancelled, it leaves; put back, it enters again, once;
 *  - freight and other charges are income, not a rounding difference.
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
  c = await company('post');
}, 60_000);

const tb = async () => (await request(app).get(`/api/orgs/${c.orgId}/ledger/trial-balance`).set(at(c)).expect(200)).body;
/** Net on a control account, debit positive. */
const net = (body: any, kind: string) => {
  const row = body.rows.find((r: any) => r.controlKind === kind);
  return row ? Math.round((Number(row.debit || 0) - Number(row.credit || 0)) * 100) / 100 : 0;
};
const moved = (before: any, after: any, kind: string) => Math.round((net(after, kind) - net(before, kind)) * 100) / 100;
const body = (over: Record<string, unknown> = {}) => ({
  date: '2026-10-10',
  customerName: 'Asha Traders',
  items: [{ description: 'Work', quantity: 1, rate: 1000, gstRate: 18, taxableAmount: 1000, gstAmount: 180 }],
  subtotal: 1000,
  cgstTotal: 90,
  sgstTotal: 90,
  igstTotal: 0,
  gstTotal: 180,
  total: 1180,
  ...over,
});
const make = async (over: Record<string, unknown> = {}) => (await request(app).post(`/api/orgs/${c.orgId}/invoices`).set(at(c)).send(body(over)).expect(201)).body.invoice;
const setStatus = (id: string, status: string) => request(app).patch(`/api/orgs/${c.orgId}/invoices/${id}/status`).set(at(c)).send({ status });
const standing = (id: string) => prisma.journalEntry.count({ where: { orgId: c.orgId, sourceDocType: 'INVOICE', sourceDocId: id, status: 'POSTED', reversesId: null } });

describe('when an invoice is in the books', () => {
  it('a draft is not; finalised, it is, once', async () => {
    const before = await tb();
    const inv = await make({ status: 'Draft' });
    expect(inv.status).toBe('Draft');
    expect(await prisma.journalEntry.count({ where: { orgId: c.orgId, sourceDocId: inv.id } })).toBe(0);
    expect(moved(before, await tb(), 'AR')).toBe(0);

    await setStatus(inv.id, 'Unpaid').expect(200);
    let after = await tb();
    expect(moved(before, after, 'AR')).toBe(1180);
    expect(moved(before, after, 'SALES')).toBe(-1000);
    expect(moved(before, after, 'CGST_OUT')).toBe(-90);
    /* Said again, nothing more is posted. */
    await setStatus(inv.id, 'Unpaid').expect(200);
    after = await tb();
    expect(moved(before, after, 'AR')).toBe(1180);
    expect(await standing(inv.id)).toBe(1);
  }, 120_000);

  it('raised as issued, it is in the books at once, as before', async () => {
    const before = await tb();
    const inv = await make({ status: 'Unpaid' });
    expect(moved(before, await tb(), 'AR')).toBe(1180);
    expect(await standing(inv.id)).toBe(1);
  }, 120_000);

  it('cancelled it leaves, put back it returns once, cancelled again it leaves', async () => {
    const before = await tb();
    const inv = await make({ status: 'Unpaid' });
    await setStatus(inv.id, 'Cancelled').expect(200);
    expect(moved(before, await tb(), 'AR')).toBe(0);
    expect(await standing(inv.id)).toBe(0);

    await setStatus(inv.id, 'Unpaid').expect(200);
    const back = await tb();
    expect(moved(before, back, 'AR')).toBe(1180);
    expect(moved(before, back, 'SALES')).toBe(-1000);
    expect(await standing(inv.id)).toBe(1);

    await setStatus(inv.id, 'Cancelled').expect(200);
    const gone = await tb();
    for (const kind of ['AR', 'SALES', 'CGST_OUT', 'SGST_OUT']) expect(moved(before, gone, kind), kind).toBe(0);
    expect(await standing(inv.id)).toBe(0);
  }, 120_000);

  it('a draft that is cancelled, or deleted, never touched the books', async () => {
    const before = await tb();
    const a = await make({ status: 'Draft' });
    await setStatus(a.id, 'Cancelled').expect(200);
    const b = await make({ status: 'Draft' });
    await request(app).delete(`/api/orgs/${c.orgId}/invoices/${b.id}`).set(at(c)).expect(200);
    const after = await tb();
    for (const kind of ['AR', 'SALES', 'CGST_OUT']) expect(moved(before, after, kind), kind).toBe(0);
    expect(await prisma.journalEntry.count({ where: { orgId: c.orgId, sourceDocId: { in: [a.id, b.id] } } })).toBe(0);
  }, 120_000);
});

describe('freight and other charges', () => {
  it('are income with their tax, and nothing goes to Rounding', async () => {
    const before = await tb();
    await make({
      status: 'Unpaid',
      otherCharges: [{ label: 'Freight', amount: 100, gstRate: 18, taxableAmount: 100, gstAmount: 18 }],
      otherChargesTotal: 100,
      cgstTotal: 99,
      sgstTotal: 99,
      gstTotal: 198,
      total: 1298,
    });
    const after = await tb();
    expect(moved(before, after, 'AR')).toBe(1298);
    expect(moved(before, after, 'SALES')).toBe(-1100);
    expect(moved(before, after, 'CGST_OUT')).toBe(-99);
    expect(moved(before, after, 'SGST_OUT')).toBe(-99);
    expect(moved(before, after, 'ROUNDING')).toBe(0);
  }, 120_000);

  it('a total rounded off to the rupee still goes to Rounding', async () => {
    const before = await tb();
    await make({ status: 'Unpaid', total: 1181 });
    const after = await tb();
    expect(moved(before, after, 'AR')).toBe(1181);
    expect(moved(before, after, 'ROUNDING')).toBe(-1);
  }, 120_000);
});
