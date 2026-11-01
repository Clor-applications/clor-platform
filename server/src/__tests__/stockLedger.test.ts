import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { buildApp } from '../app.js';
import { prisma } from '../utils/prisma.js';
import { platformPrisma } from '../utils/platformPrisma.js';
// The browser's own stock rules, to hold the server to them.
// @ts-expect-error — plain JS from the web package
import { computeInventorySummaryByItemId } from '../../../packages/ui/src/utils/inventory.js';

/**
 * The stock ledger the database keeps.
 *
 * Stock was only ever worked out in the browser, from whatever it had loaded,
 * so nothing stopped two counters selling the last unit twice. Triggers now
 * keep a movement per document line, and a sale is checked against them
 * while its items are held.
 */

const app = buildApp().listen(0, '127.0.0.1');
afterAll(() => new Promise((done) => app.close(done)));

type Ctx = { token: string; orgId: string; branchId: string };
let owner: Ctx;
let wh = '';
const auth = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });
const rnd = () => Math.random().toString(36).slice(2, 8);

const item = async (name: string, over: Record<string, unknown> = {}) =>
  (
    await request(app)
      .post(`/api/orgs/${owner.orgId}/items`)
      .set(auth(owner))
      .send({ name: `${name} ${rnd()}`, unit: 'Nos', gstRate: 0, ...over })
      .expect(201)
  ).body.item.id as string;

const line = (itemId: string, quantity: number) => ({ itemId, description: 'x', quantity, rate: 10, amount: 10 * quantity, gstRate: 0 });

const invoice = (items: any[], over: Record<string, unknown> = {}) =>
  request(app)
    .post(`/api/orgs/${owner.orgId}/invoices`)
    .set(auth(owner))
    .send({ date: '2026-09-10', customerName: 'Walk-in', subtotal: 10, gstTotal: 0, total: 10, status: 'Unpaid', warehouseId: wh, items, ...over });

const bill = (items: any[], over: Record<string, unknown> = {}) =>
  request(app)
    .post(`/api/orgs/${owner.orgId}/bills`)
    .set(auth(owner))
    .send({ date: '2026-09-05', partyName: 'Supplier', total: 10, status: 'Unpaid', warehouseId: wh, items, ...over });

const onHand = async (itemId: string, warehouseId = wh) => {
  const res = await request(app)
    .get(`/api/orgs/${owner.orgId}/stock/on-hand?itemIds=${itemId}${warehouseId ? `&warehouseId=${warehouseId}` : ''}`)
    .set(auth(owner))
    .expect(200);
  return res.body.onHand.find((r: any) => r.itemId === itemId)?.qty ?? 0;
};

beforeAll(async () => {
  const signup = await request(app)
    .post('/api/auth/signup')
    .send({ email: `sl.${Date.now()}.${rnd()}@example.com`, password: 'Passw0rd!23', name: 'Ledger Owner' })
    .expect(200);
  const setup = await request(app)
    .post('/api/auth/setup-company')
    .set('Authorization', `Bearer ${signup.body.token}`)
    .send({ companyName: `Ledger Co ${Date.now()}-${rnd()}`, state: 'Karnataka' })
    .expect(200);
  owner = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id };
  wh = String((await request(app).get(`/api/orgs/${owner.orgId}/warehouses`).set(auth(owner)).expect(200)).body.warehouses[0].id);
}, 60_000);

describe('movements follow the documents', () => {
  it('a bill brings stock in and a sale takes it out; drafts and cancellations move nothing', async () => {
    const id = await item('Mango');
    await bill([line(id, 10)]).expect(201);
    expect(await onHand(id)).toBe(10);

    await invoice([line(id, 3)], { status: 'Draft' }).expect(201);
    expect(await onHand(id)).toBe(10);

    const sold = await invoice([line(id, 3)]).expect(201);
    expect(await onHand(id)).toBe(7);

    await request(app)
      .patch(`/api/orgs/${owner.orgId}/invoices/${sold.body.invoice.id}/status`)
      .set(auth(owner))
      .send({ status: 'Cancelled' })
      .expect(200);
    expect(await onHand(id)).toBe(10);
  });

  it('counts opening stock, follows an edit of it, and ignores services', async () => {
    const id = await item('Rice', { openingQty: 5, openingWarehouseId: wh });
    expect(await onHand(id)).toBe(5);
    await request(app).patch(`/api/orgs/${owner.orgId}/items/${id}`).set(auth(owner)).send({ openingQty: 8 }).expect(200);
    expect(await onHand(id)).toBe(8);

    const svc = await item('Repair', { itemType: 'SERVICE', openingQty: 4 });
    expect(await onHand(svc)).toBe(0);
  });

  it('opening stock that names no warehouse counts in any warehouse', async () => {
    const id = await item('Legacy', { openingQty: 6 });
    expect(await onHand(id, wh)).toBe(6);
    expect(await onHand(id, '')).toBe(6);
  });

  it('adjustments and transfers move stock by their status', async () => {
    const id = await item('Bolt', { openingQty: 20, openingWarehouseId: wh });
    const put = (kind: string, uid: string, body: any) =>
      request(app).put(`/api/orgs/${owner.orgId}/stock-documents/${kind}/${uid}`).set(auth(owner)).send(body);
    await put('ADJUSTMENT', `adj-${rnd()}${rnd()}`, {
      date: '2026-09-11',
      warehouseId: wh,
      payload: { itemBackendId: id, qtyDelta: -2, createdAt: new Date().toISOString() },
    }).expect(201);
    expect(await onHand(id)).toBe(18);

    const other = (
      await request(app).post(`/api/orgs/${owner.orgId}/warehouses`).set(auth(owner)).send({ branchId: owner.branchId, name: `Store ${rnd()}` })
    ).body.warehouse?.id;
    expect(other).toBeTruthy();
    const uid = `trf-${rnd()}${rnd()}`;
    const transfer = (status: string, received?: number) =>
      put('TRANSFER', uid, {
        date: '2026-09-12',
        status,
        warehouseId: wh,
        targetWarehouseId: other,
        payload: { lines: [{ itemBackendId: id, qty: 5, ...(received !== undefined ? { receivedQty: received } : {}) }], createdAt: new Date().toISOString() },
      });
    await transfer('Draft').expect(201);
    expect(await onHand(id)).toBe(18);
    await transfer('Transferred Out').expect(200);
    expect(await onHand(id)).toBe(13);
    expect(await onHand(id, other)).toBe(0);
    await transfer('Short Received', 4).expect(200);
    expect(await onHand(id, other)).toBe(4);
    expect(await onHand(id, '')).toBe(17); // one lost in transit
  });

  it('a malformed stored document moves nothing rather than failing its write', async () => {
    const id = await item('Odd');
    await prisma.invoice.create({
      data: {
        id: randomUUID(),
        accountId: (await platformPrisma.org.findUniqueOrThrow({ where: { id: owner.orgId } })).accountId,
        orgId: owner.orgId,
        branchId: owner.branchId,
        number: `ODD-${rnd()}`,
        date: '2026-09-10',
        customerName: 'x',
        status: 'Unpaid',
        itemsJson: 'not json',
        createdByUserId: 'test',
      },
    });
    expect(await onHand(id)).toBe(0);
  });
});

describe('selling what is not there', () => {
  it('refuses an invoice that would take a warehouse below nothing, and keeps nothing', async () => {
    const id = await item('Last unit');
    await bill([line(id, 2)]).expect(201);
    const before = await prisma.invoice.count({ where: { orgId: owner.orgId } });
    const res = await invoice([line(id, 3)]).expect(409);
    expect(res.body.code).toBe('insufficient_stock');
    expect(res.body.error).toMatch(/Last unit/);
    expect(await prisma.invoice.count({ where: { orgId: owner.orgId } })).toBe(before);
    expect(await onHand(id)).toBe(2);
  });

  it('lets exactly one of two counters sell the same last units', async () => {
    const id = await item('Contested');
    await bill([line(id, 10)]).expect(201);
    const results = await Promise.all([invoice([line(id, 6)]), invoice([line(id, 6)])]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await onHand(id)).toBe(4);
  });

  it('refuses finalising a draft, or a larger edit, past what is on hand', async () => {
    const id = await item('Draft stock');
    await bill([line(id, 5)]).expect(201);
    const draft = await invoice([line(id, 8)], { status: 'Draft' }).expect(201);
    const fin = await request(app)
      .patch(`/api/orgs/${owner.orgId}/invoices/${draft.body.invoice.id}/status`)
      .set(auth(owner))
      .send({ status: 'Unpaid' })
      .expect(409);
    expect(fin.body.code).toBe('insufficient_stock');
  });

  it('never blocks an edit that does not make an existing shortage worse', async () => {
    const id = await item('Already short');
    // Written past the check, as data from before it existed would be.
    const accountId = (await platformPrisma.org.findUniqueOrThrow({ where: { id: owner.orgId } })).accountId;
    const inv = await prisma.invoice.create({
      data: {
        id: randomUUID(),
        accountId,
        orgId: owner.orgId,
        branchId: owner.branchId,
        warehouseId: wh,
        number: `OLD-${rnd()}`,
        date: '2026-09-10',
        customerName: 'x',
        status: 'Draft',
        itemsJson: JSON.stringify([line(id, 4)]),
        createdByUserId: 'test',
      },
    });
    await prisma.invoice.update({ where: { id: inv.id }, data: { status: 'Unpaid' } });
    expect(await onHand(id)).toBe(-4);
    await request(app).patch(`/api/orgs/${owner.orgId}/invoices/${inv.id}`).set(auth(owner)).send({ refNo: 'PO-9' }).expect(200);
  });

  it('refuses a counter sale and a debit note past what is on hand', async () => {
    const id = await item('Counter');
    await bill([line(id, 1)]).expect(201);
    const cash = await request(app)
      .post(`/api/orgs/${owner.orgId}/ledger/accounts`)
      .set(auth(owner))
      .send({ name: `Till ${rnd()}`, accountType: 'ASSET', controlKind: 'CASH' })
      .expect(201);
    await request(app)
      .put(`/api/orgs/${owner.orgId}/pos/tender-accounts`)
      .set(auth(owner))
      .send({ tender: 'CASH', ledgerAccountId: cash.body.account.id })
      .expect(200);
    const pos = await request(app)
      .post(`/api/orgs/${owner.orgId}/pos/checkout`)
      .set(auth(owner))
      .send({ checkoutId: randomUUID(), tender: 'CASH', date: '2026-09-10', subtotal: 20, gstTotal: 0, total: 20, warehouseId: wh, items: [line(id, 2)] });
    expect(pos.status).toBe(409);
    expect(pos.body.code).toBe('POS_OUT_OF_STOCK');

    const dn = await request(app)
      .post(`/api/orgs/${owner.orgId}/debit-notes`)
      .set(auth(owner))
      .send({ date: '2026-09-10', partyName: 'Supplier', total: 20, warehouseId: wh, items: [line(id, 2)] });
    expect(dn.status).toBe(409);
    expect(dn.body.code).toBe('insufficient_stock');
  });
});

describe('agreeing with the browser', () => {
  it('gives the same closing stock the inventory screen works out from the same documents', async () => {
    const a = await item('Parity A', { openingQty: 3, openingWarehouseId: wh });
    const b = await item('Parity B');
    await bill([line(a, 7), line(b, 4)]).expect(201);
    await invoice([line(a, 2), line(b, 1)]).expect(201);
    await invoice([line(b, 9)], { status: 'Draft' }).expect(201);

    const g = (path: string) => request(app).get(`/api/orgs/${owner.orgId}/${path}`).set(auth(owner)).expect(200);
    const items = (await g('items')).body.items;
    const invoices = (await g('invoices')).body.invoices;
    const bills = (await g('bills')).body.documents;
    const C = 1;
    const db = {
      items: items.map((i: any) => ({
        id: i.id,
        companyId: C,
        type: i.itemType === 'SERVICE' ? 'Service' : 'Goods',
        openingQty: i.openingQty,
        openingWarehouseId: i.openingWarehouseId || '',
      })),
      invoices: invoices.map((d: any) => ({ ...d, companyId: C, items: d.items || JSON.parse(d.itemsJson || '[]') })),
      bills: bills.map((d: any) => ({ ...d, companyId: C, items: d.items || JSON.parse(d.itemsJson || '[]') })),
    };
    const browser = computeInventorySummaryByItemId({ db, companyId: C, warehouseId: wh });
    for (const id of [a, b]) expect(await onHand(id)).toBe(browser.get(id).closingQty);
  });
});

describe('row-level security', () => {
  it('is switched on and forced for the ledger', async () => {
    const rows = await prisma.$queryRaw<Array<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>>`
      SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = 'StockMovement'
    `;
    expect(rows[0]).toMatchObject({ relrowsecurity: true, relforcerowsecurity: true });
  });
});
