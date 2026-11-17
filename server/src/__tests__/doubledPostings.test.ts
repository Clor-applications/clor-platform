import { afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';

/**
 * Finding books the reversal-of-a-reversal fault already damaged (fixed for
 * new changes on 17 Nov 2026). The fault cannot be reached through the API
 * any more, so the damage is made the way the fault made it: the reversal a
 * bill's edit posted is itself reversed.
 */
const { buildApp } = await import('../app.js');
const { prisma } = await import('../utils/prisma.js');
const { reverseEntry } = await import('../services/ledger.js');
const { doubledDocuments, extraPostings } = await import('../services/integrity/doubledPostings.js');
const { at, opsKit } = await import('./opsTestKit.js');

const app = buildApp().listen(0, '127.0.0.1');
afterAll(async () => {
  await new Promise((done) => app.close(done));
});
const { company, staff } = opsKit(app);
type Ctx = Awaited<ReturnType<typeof company>>;

const bill = (over: Record<string, unknown> = {}) => ({
  date: '2026-04-10',
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
const newBill = async (c: Ctx) => (await request(app).post(`/api/orgs/${c.orgId}/bills`).set(at(c)).send(bill()).expect(201)).body.document;
const edit = (c: Ctx, id: string, total: number) =>
  request(app).patch(`/api/orgs/${c.orgId}/bills/${id}`).set(at(c)).send(bill({ subtotal: total, total, items: [{ description: 'Material', quantity: 1, rate: total, gstRate: 0 }] })).expect(200);

/** What the fault did on a second change: reverse the reversal the first change posted. */
async function bringBack(c: Ctx, docId: string) {
  const contra = await prisma.journalEntry.findFirstOrThrow({ where: { orgId: c.orgId, sourceDocType: 'BILL', sourceDocId: docId, reversesId: { not: null }, reversedById: null } });
  await reverseEntry({ accountId: c.accountId, orgId: c.orgId, branchId: contra.branchId, userId: c.userId, entryId: contra.id });
}

describe('how many of a document’s postings are extra', () => {
  it('counts a posting reversed an even number of times, unless it is all a live document has', () => {
    expect(extraPostings([0], true)).toBe(0);
    expect(extraPostings([1, 0], true)).toBe(0); // edited once
    expect(extraPostings([1], false)).toBe(0); // deleted
    expect(extraPostings([2, 1, 0], true)).toBe(1); // edited twice under the fault
    expect(extraPostings([2, 1], false)).toBe(1); // edited, then deleted
    expect(extraPostings([2], false)).toBe(1); // cancelled, then deleted
    expect(extraPostings([2], true)).toBe(0); // cancelled, put back, cancelled, put back
    expect(extraPostings([3], false)).toBe(0); // a third reversal took it out again
    expect(extraPostings([4, 2, 0], true)).toBe(2);
  });
});

describe('books the fault already damaged', () => {
  it('names a bill whose first amount came back, and leaves clean bills alone', async () => {
    const c = await company('dbl');
    const clean = await newBill(c);
    await edit(c, clean.id, 1200);
    const hurt = await newBill(c);
    await edit(c, hurt.id, 1200);
    expect(await doubledDocuments({ orgId: c.orgId })).toEqual([]);

    await bringBack(c, hurt.id);
    const found = await doubledDocuments({ orgId: c.orgId });
    expect(found).toEqual([{ accountId: c.accountId, orgId: c.orgId, kind: 'BILL', docId: hurt.id, extra: 1, live: true, date: '2026-04-10' }]);

    /* Deleted afterwards, the amount that came back is still there. */
    await request(app).delete(`/api/orgs/${c.orgId}/bills/${hurt.id}`).set(at(c)).expect(200);
    expect(await doubledDocuments({ orgId: c.orgId })).toEqual([expect.objectContaining({ docId: hurt.id, extra: 1, live: false })]);
  }, 90_000);

  it('Ops sees the company and the count, not the document; customers are refused', async () => {
    const c = await company('dblops');
    const hurt = await newBill(c);
    await edit(c, hurt.id, 1500);
    await bringBack(c, hurt.id);

    const ro = await staff('READ_ONLY');
    const body = (await request(app).get('/api/ops/books-check').set(ro.h).expect(200)).body;
    const row = body.companies.find((r: any) => r.orgId === c.orgId);
    expect(row).toMatchObject({ accountId: c.accountId, documents: 1, extra: 1, kinds: { BILL: 1 }, from: '2026-04-10', to: '2026-04-10' });
    expect(typeof row.company).toBe('string');
    expect(body.documents).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(body)).not.toContain(hurt.id);

    await request(app).get('/api/ops/books-check').set(at(c)).expect(403);
  }, 90_000);
});
