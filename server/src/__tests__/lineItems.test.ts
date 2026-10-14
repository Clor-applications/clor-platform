import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { buildApp } from '../app.js';
import { resolveLegacyItem } from '../services/legacyLineItems.js';

/**
 * A document line names an item by the server's id, or not at all.
 *
 * Lines used to carry the browser's own item number, handed out afresh on
 * every load in name order. Adding "Apple" after an invoice for "Mango" made
 * that invoice read as an Apple sale on the next reload. The server now
 * refuses a line naming anything it does not hold.
 */

const app = buildApp().listen(0);
afterAll(() => new Promise((done) => app.close(done)));

type Ctx = { token: string; orgId: string; branchId: string };
let owner: Ctx;
let other: Ctx;
let mango = '';
let theirs = '';

const auth = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });
const rnd = () => Math.random().toString(36).slice(2, 8);

async function makeOwner(name: string): Promise<Ctx> {
  const signup = await request(app)
    .post('/api/auth/signup')
    .send({ email: `li.${Date.now()}.${rnd()}@example.com`, password: 'Passw0rd!23', name })
    .expect(200);
  const setup = await request(app)
    .post('/api/auth/setup-company')
    .set('Authorization', `Bearer ${signup.body.token}`)
    .send({ companyName: `${name} ${Date.now()}-${rnd()}`, state: 'Karnataka' })
    .expect(200);
  return { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id };
}

const item = async (c: Ctx, name: string) =>
  (await request(app).post(`/api/orgs/${c.orgId}/items`).set(auth(c)).send({ name, unit: 'Kg', gstRate: 0, openingQty: 100 }).expect(201)).body.item.id as string;

const invoice = (c: Ctx, items: any[]) =>
  request(app)
    .post(`/api/orgs/${c.orgId}/invoices`)
    .set(auth(c))
    .send({ date: '2026-09-10', customerName: 'Walk-in', subtotal: 200, gstTotal: 0, total: 200, status: 'Unpaid', items });

beforeAll(async () => {
  owner = await makeOwner('Fruit Co');
  other = await makeOwner('Other Co');
  mango = await item(owner, 'Mango');
  theirs = await item(other, 'Mango');
}, 60_000);

describe('an invoice line', () => {
  it('is taken when it names an item of this company, or none', async () => {
    await invoice(owner, [{ itemId: mango, description: 'Mango', quantity: 2, rate: 100, amount: 200 }]).expect(201);
    await invoice(owner, [{ description: 'Delivery charge', quantity: 1, rate: 200, amount: 200 }]).expect(201);
  });

  it('is refused when it names a browser number, or another company’s item', async () => {
    const stale = await invoice(owner, [{ itemId: '1', description: 'Mango', quantity: 2, rate: 100, amount: 200 }]).expect(400);
    expect(stale.body.code).toBe('unknown_item');
    expect(stale.body.error).toMatch(/Line 1 \(Mango\)/);
    await invoice(owner, [{ itemId: theirs, description: 'Mango', quantity: 2, rate: 100, amount: 200 }]).expect(400);
  });
});

describe('the other ways a line gets in', () => {
  it('refuses a stale item on a bill, a quote, a recurring template and a counter sale', async () => {
    const line = { itemId: '7', description: 'Mango', quantity: 1, rate: 100, gstRate: 0 };
    const bill = await request(app)
      .post(`/api/orgs/${owner.orgId}/bills`)
      .set(auth(owner))
      .send({ date: '2026-09-10', partyName: 'Orchard', total: 100, status: 'Unpaid', items: [line] });
    expect(bill.status).toBe(400);
    expect(bill.body.code).toBe('unknown_item');

    const est = await request(app)
      .post(`/api/orgs/${owner.orgId}/estimates`)
      .set(auth(owner))
      .send({ date: '2026-09-10', partyName: 'Buyer', total: 100, status: 'Draft', items: [line] });
    expect(est.status).toBe(400);

    const rec = await request(app)
      .post(`/api/orgs/${owner.orgId}/recurring`)
      .set(auth(owner))
      .send({ name: 'Monthly mango', partyName: 'Buyer', nextRunDate: '2026-10-01', template: { items: [line], total: 100 } });
    expect(rec.status).toBe(400);

    const pos = await request(app)
      .post(`/api/orgs/${owner.orgId}/pos/checkout`)
      .set(auth(owner))
      .send({ checkoutId: `c-${rnd()}`, tender: 'CASH', date: '2026-09-10', subtotal: 100, gstTotal: 0, total: 100, items: [line] });
    expect(pos.status).toBe(400);
    expect(pos.body.code).toBe('POS_UNKNOWN_ITEM');
  });
});

describe('repairing lines written before the fix', () => {
  const at = (d: string) => new Date(`${d}T00:00:00Z`);
  const items = [
    { id: 'itm-mango', name: 'Mango', hsnSac: '0804', gstRate: 0, createdAt: at('2026-09-01') },
    { id: 'itm-apple', name: 'Apple', hsnSac: '0808', gstRate: 0, createdAt: at('2026-09-20') },
    { id: 'itm-bolt-a', name: 'Bolt', hsnSac: '7318', gstRate: 18, createdAt: at('2026-09-01') },
    { id: 'itm-bolt-b', name: 'bolt', hsnSac: '7318', gstRate: 18, createdAt: at('2026-09-02') },
  ];

  it('finds the item by its name when exactly one item has it', () => {
    expect(resolveLegacyItem({ itemId: '1', description: 'mango ' }, items, at('2026-09-10'))).toEqual({ id: 'itm-mango', how: 'name' });
  });

  it('finds it by the number the browser gave it then, only when HSN and rate agree', () => {
    // On 10 Sep the list was Bolt, bolt, Mango: number 3 was Mango. Apple came later.
    const line = { itemId: '3', description: 'Fresh fruit', hsnSac: '0804', gstRate: 0 };
    expect(resolveLegacyItem(line, items, at('2026-09-10'))).toEqual({ id: 'itm-mango', how: 'position' });
    expect(resolveLegacyItem({ ...line, hsnSac: '9999' }, items, at('2026-09-10'))).toBeNull();
  });

  it('leaves a line it cannot tell for certain', () => {
    expect(resolveLegacyItem({ itemId: '9', description: 'Bolt' }, items, at('2026-09-10'))).toBeNull();
  });
});
