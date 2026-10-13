import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { buildApp } from '../app.js';
import { prisma } from '../utils/prisma.js';

/**
 * Three things that lived only in the browser, and why each had to stop.
 *
 * A delivery challan is a document under Rule 55: it travels with the goods, an
 * e-way bill is raised against it, and it may have to be produced. A fixed
 * asset appears on the balance sheet. A salesman is the axis of the Sales by
 * Salesman report. So none of the three was an incomplete feature — each made
 * the same company show different figures, or hold different records, on
 * different machines.
 *
 * The same argument was written here as the reason discount rules, cost centres
 * and price lists could stay in the browser, and it was wrong on the facts:
 * Cost Centers is a report — P&L by branch or project — and a price list
 * decides what rate lands on an invoice. All six now have a table.
 */

const app = buildApp().listen(0);
afterAll(() => new Promise((done) => app.close(done)));
const rnd = () => Math.random().toString(36).slice(2, 8);

type Ctx = { token: string; orgId: string; branchId: string };
let owner: Ctx;
const auth = (c: Ctx) => ({
  Authorization: `Bearer ${c.token}`,
  'x-org-id': c.orgId,
  'x-branch-id': c.branchId,
});

beforeAll(async () => {
  const email = `bom.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app)
    .post('/api/auth/signup')
    .send({ email, password: 'Passw0rd!23', name: 'BOM owner' })
    .expect(200);
  const setup = await request(app)
    .post('/api/auth/setup-company')
    .set('Authorization', `Bearer ${signup.body.token}`)
    .send({ companyName: `BOM Co ${Date.now()}-${rnd()}`, state: 'Karnataka' })
    .expect(200);
  owner = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id };
}, 60_000);

describe('delivery challans', () => {
  it('are stored, numbered and listed', async () => {
    const created = await request(app)
      .post(`/api/orgs/${owner.orgId}/delivery-challans`)
      .set(auth(owner))
      .send({
        date: '2026-08-01',
        partyName: 'Acme Traders',
        purpose: 'JOB_WORK',
        subtotal: 1000,
        total: 1000,
        items: [{ description: 'Casting', quantity: 10, rate: 100 }],
      })
      .expect(201);

    const doc = created.body.doc || created.body.estimate || created.body.document;
    expect(doc.number).toMatch(/^DC-/);
    expect(doc.status).toBe('Open'); // not Draft: a challan exists the moment goods move
    expect(doc.purpose).toBe('JOB_WORK');

    const list = await request(app)
      .get(`/api/orgs/${owner.orgId}/delivery-challans`)
      .set(auth(owner))
      .expect(200);
    const rows = list.body.docs || list.body.documents || list.body.estimates || [];
    expect(rows.some((r: any) => r.id === doc.id)).toBe(true);
  });

  /*
   * The billed-once guard. It used to live in the browser, so the same
   * consignment could be invoiced twice from a second machine.
   */
  it('remember that they have been converted', async () => {
    const made = await request(app)
      .post(`/api/orgs/${owner.orgId}/delivery-challans`)
      .set(auth(owner))
      .send({ date: '2026-08-02', partyName: 'Acme', total: 500, items: [] })
      .expect(201);
    const doc = made.body.doc || made.body.document;

    await request(app)
      .patch(`/api/orgs/${owner.orgId}/delivery-challans/${doc.id}`)
      .set(auth(owner))
      .send({ status: 'Converted', convertedInvoiceId: 'inv_123' })
      .expect(200);

    const row = await prisma.deliveryChallan.findUnique({ where: { id: doc.id } });
    expect(row?.status).toBe('Converted');
    expect(row?.convertedInvoiceId).toBe('inv_123');
  });

  it('carry an e-way bill number', async () => {
    const made = await request(app)
      .post(`/api/orgs/${owner.orgId}/delivery-challans`)
      .set(auth(owner))
      .send({ date: '2026-08-03', partyName: 'Acme', total: 900, items: [], ewayBillNo: '351234567890' })
      .expect(201);
    const doc = made.body.doc || made.body.document;
    const row = await prisma.deliveryChallan.findUnique({ where: { id: doc.id } });
    expect(row?.ewayBillNo).toBe('351234567890');
  });
});

describe('salesmen', () => {
  it('are stored and listed', async () => {
    const name = `Ravi ${rnd()}`;
    const made = await request(app)
      .post(`/api/orgs/${owner.orgId}/salesmen`)
      .set(auth(owner))
      .send({ name, code: 'S-01', phone: '9876543210', commissionRate: 2.5 })
      .expect(201);
    expect(made.body.salesman.commissionRate).toBe(2.5);

    const list = await request(app).get(`/api/orgs/${owner.orgId}/salesmen`).set(auth(owner)).expect(200);
    expect(list.body.salesmen.some((s: any) => s.name === name)).toBe(true);
  });

  /*
   * Deactivated, never deleted: documents already carry the salesman, and
   * deleting the row would leave them pointing at nothing.
   */
  it('are deactivated rather than deleted', async () => {
    const made = await request(app)
      .post(`/api/orgs/${owner.orgId}/salesmen`)
      .set(auth(owner))
      .send({ name: `Gone ${rnd()}` })
      .expect(201);

    await request(app)
      .delete(`/api/orgs/${owner.orgId}/salesmen/${made.body.salesman.id}`)
      .set(auth(owner))
      .expect(200);

    const row = await prisma.salesman.findUnique({ where: { id: made.body.salesman.id } });
    expect(row).not.toBeNull();
    expect(row?.isActive).toBe(false);
  });

  it('will not take the same name twice', async () => {
    const name = `Twice ${rnd()}`;
    await request(app).post(`/api/orgs/${owner.orgId}/salesmen`).set(auth(owner)).send({ name }).expect(201);
    await request(app).post(`/api/orgs/${owner.orgId}/salesmen`).set(auth(owner)).send({ name }).expect(409);
  });
});

describe('fixed assets', () => {
  it('are stored with what the balance sheet needs', async () => {
    const made = await request(app)
      .post(`/api/orgs/${owner.orgId}/fixed-assets`)
      .set(auth(owner))
      .send({
        name: 'Delivery van',
        category: 'Vehicles',
        purchaseDate: '2026-04-01',
        cost: 800000,
        salvageValue: 80000,
        depreciationMethod: 'WDV',
        depreciationRate: 15,
        accumulatedDepreciation: 120000,
      })
      .expect(201);

    const a = made.body.asset;
    expect(a.cost).toBe(800000);
    expect(a.depreciationMethod).toBe('WDV');
    /* Net block is derived, never stored, so it cannot drift from its parts. */
    expect(a.netBlock).toBe(680000);
  });

  it('record a disposal without losing the original cost', async () => {
    const made = await request(app)
      .post(`/api/orgs/${owner.orgId}/fixed-assets`)
      .set(auth(owner))
      .send({ name: 'Old press', purchaseDate: '2020-04-01', cost: 500000 })
      .expect(201);

    const res = await request(app)
      .patch(`/api/orgs/${owner.orgId}/fixed-assets/${made.body.asset.id}`)
      .set(auth(owner))
      .send({ status: 'DISPOSED', disposalDate: '2026-08-01', disposalValue: 60000 })
      .expect(200);

    expect(res.body.asset.status).toBe('DISPOSED');
    expect(res.body.asset.disposalValue).toBe(60000);
    expect(res.body.asset.cost).toBe(500000);
  });

  it('are listed for the company', async () => {
    const list = await request(app).get(`/api/orgs/${owner.orgId}/fixed-assets`).set(auth(owner)).expect(200);
    expect(list.body.assets.length).toBeGreaterThan(0);
    for (const a of list.body.assets) expect(a.netBlock).toBe(a.cost - a.accumulatedDepreciation);
  });
});

describe('tenant isolation holds for the new tables', () => {
  it('does not list another company\'s salesmen or assets', async () => {
    const email = `bom2.${Date.now()}.${rnd()}@example.com`;
    const signup = await request(app)
      .post('/api/auth/signup')
      .send({ email, password: 'Passw0rd!23', name: 'Other' })
      .expect(200);
    const setup = await request(app)
      .post('/api/auth/setup-company')
      .set('Authorization', `Bearer ${signup.body.token}`)
      .send({ companyName: `Other ${Date.now()}-${rnd()}`, state: 'Karnataka' })
      .expect(200);
    const other: Ctx = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id };

    const s = await request(app).get(`/api/orgs/${other.orgId}/salesmen`).set(auth(other)).expect(200);
    const a = await request(app).get(`/api/orgs/${other.orgId}/fixed-assets`).set(auth(other)).expect(200);
    expect(s.body.salesmen).toEqual([]);
    expect(a.body.assets).toEqual([]);
  });
});

/**
 * The six reference lists, through the one endpoint they share.
 *
 * They share a table because they share a life: small lists, read whole, whose
 * only difference is the shape of what hangs off a name.
 */
describe('the six reference masters', () => {
  it('stores a price list with its rates and reads them back', async () => {
    const name = `Wholesale ${rnd()}`;
    const created = await request(app)
      .post(`/api/orgs/${owner.orgId}/masters`)
      .set(auth(owner))
      .send({ kind: 'PRICE_LIST', name, data: { status: 'active', rates: { '11': 92.5 } } })
      .expect(201);
    expect(created.body.master.name).toBe(name);
    // The payload has to survive the round trip intact — a price list read
    // back without its rates is a price list that prices nothing.
    expect(created.body.master.data.rates['11']).toBe(92.5);

    const listed = await request(app)
      .get(`/api/orgs/${owner.orgId}/masters?kind=PRICE_LIST`)
      .set(auth(owner))
      .expect(200);
    const row = listed.body.masters.find((m: any) => m.id === created.body.master.id);
    expect(row.data.rates['11']).toBe(92.5);
    expect(row.kind).toBe('PRICE_LIST');
  });

  it('keeps names unique within a kind, and only within it', async () => {
    const name = `Retail ${rnd()}`;
    await request(app)
      .post(`/api/orgs/${owner.orgId}/masters`)
      .set(auth(owner))
      .send({ kind: 'PRICE_LIST', name })
      .expect(201);
    await request(app)
      .post(`/api/orgs/${owner.orgId}/masters`)
      .set(auth(owner))
      .send({ kind: 'PRICE_LIST', name })
      .expect(409);
    // A cost centre and a price list may share a name; they are different lists.
    await request(app)
      .post(`/api/orgs/${owner.orgId}/masters`)
      .set(auth(owner))
      .send({ kind: 'COST_CENTER', name })
      .expect(201);
  });

  it('filters by kind, so one screen does not load the other five', async () => {
    await request(app)
      .post(`/api/orgs/${owner.orgId}/masters`)
      .set(auth(owner))
      .send({ kind: 'UOM', name: `Nos ${rnd()}` })
      .expect(201);
    const listed = await request(app)
      .get(`/api/orgs/${owner.orgId}/masters?kind=UOM`)
      .set(auth(owner))
      .expect(200);
    expect(listed.body.masters.length).toBeGreaterThan(0);
    expect(listed.body.masters.every((m: any) => m.kind === 'UOM')).toBe(true);
  });

  it('stores a GST rate, with the rate itself in the payload', async () => {
    // A rate a company added was known only to the browser that added it, so
    // an invoice raised anywhere else could not charge it.
    const name = `GST 18% ${rnd()}`;
    const created = await request(app)
      .post(`/api/orgs/${owner.orgId}/masters`)
      .set(auth(owner))
      .send({ kind: 'GST_RATE', name, data: { rate: 18 } })
      .expect(201);
    expect(created.body.master.data.rate).toBe(18);

    const listed = await request(app)
      .get(`/api/orgs/${owner.orgId}/masters?kind=GST_RATE`)
      .set(auth(owner))
      .expect(200);
    expect(listed.body.masters.find((m: any) => m.name === name).data.rate).toBe(18);
  });

  it('rejects a kind it does not know', async () => {
    await request(app)
      .post(`/api/orgs/${owner.orgId}/masters`)
      .set(auth(owner))
      .send({ kind: 'NOT_A_KIND', name: 'x' })
      .expect(400);
  });

  it('updates the payload without losing the name', async () => {
    const name = `Bulk ${rnd()}`;
    const created = await request(app)
      .post(`/api/orgs/${owner.orgId}/masters`)
      .set(auth(owner))
      .send({ kind: 'DISCOUNT_RULE', name, data: { type: 'PCT', value: 5 } })
      .expect(201);
    const patched = await request(app)
      .patch(`/api/orgs/${owner.orgId}/masters/${created.body.master.id}`)
      .set(auth(owner))
      .send({ data: { type: 'PCT', value: 7.5 }, isActive: false })
      .expect(200);
    expect(patched.body.master.name).toBe(name);
    expect(patched.body.master.data.value).toBe(7.5);
    expect(patched.body.master.isActive).toBe(false);
  });

  /*
   * Deleted rather than deactivated: nothing points at one of these by id — a
   * document records the unit it was entered in, not a reference to the list.
   */
  it('deletes one and stops listing it', async () => {
    const created = await request(app)
      .post(`/api/orgs/${owner.orgId}/masters`)
      .set(auth(owner))
      .send({ kind: 'ITEM_CATEGORY', name: `Scrap ${rnd()}` })
      .expect(201);
    await request(app)
      .delete(`/api/orgs/${owner.orgId}/masters/${created.body.master.id}`)
      .set(auth(owner))
      .expect(200);
    const listed = await request(app)
      .get(`/api/orgs/${owner.orgId}/masters?kind=ITEM_CATEGORY`)
      .set(auth(owner))
      .expect(200);
    expect(listed.body.masters.find((m: any) => m.id === created.body.master.id)).toBeUndefined();
  });

  /*
   * Two companies inside ONE account — the CA firm case, and the one the
   * cross-account test above does not reach.
   *
   * Both orgs share an accountId, so scoping the query by account alone looks
   * correct and is not: one client's price list would appear on another
   * client's invoice form.
   */
  it('keeps one account\'s two companies apart', async () => {
    const second = await request(app)
      .post('/api/auth/setup-company')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ companyName: `BOM Co Two ${Date.now()}-${rnd()}`, state: 'Kerala' })
      .expect(200);
    const sibling: Ctx = {
      token: owner.token,
      orgId: second.body.company.orgId,
      branchId: second.body.branch.id,
    };
    expect(sibling.orgId).not.toBe(owner.orgId);

    const listName = `Client A rates ${rnd()}`;
    await request(app)
      .post(`/api/orgs/${owner.orgId}/masters`)
      .set(auth(owner))
      .send({ kind: 'PRICE_LIST', name: listName, data: { rates: { '11': 50 } } })
      .expect(201);

    const onSibling = await request(app)
      .get(`/api/orgs/${sibling.orgId}/masters?kind=PRICE_LIST`)
      .set(auth(sibling))
      .expect(200);
    expect(onSibling.body.masters.find((m: any) => m.name === listName)).toBeUndefined();
  });

  /*
   * Reading is not the only way across the boundary.
   *
   * Listing can be scoped correctly while the routes that change a row are
   * not, and those are the worse half: one company editing or deleting
   * another's price list changes what the other invoices at.
   */
  it("will not edit or delete another company's row", async () => {
    const second = await request(app)
      .post('/api/auth/setup-company')
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ companyName: `BOM Co Three ${Date.now()}-${rnd()}`, state: 'Goa' })
      .expect(200);
    const sibling: Ctx = { token: owner.token, orgId: second.body.company.orgId, branchId: second.body.branch.id };

    const created = await request(app)
      .post(`/api/orgs/${owner.orgId}/masters`)
      .set(auth(owner))
      .send({ kind: 'PRICE_LIST', name: `Guarded ${rnd()}`, data: { rates: { '11': 10 } } })
      .expect(201);
    const id = created.body.master.id;

    await request(app)
      .patch(`/api/orgs/${sibling.orgId}/masters/${id}`)
      .set(auth(sibling))
      .send({ data: { rates: { '11': 1 } } })
      .expect(404);

    await request(app).delete(`/api/orgs/${sibling.orgId}/masters/${id}`).set(auth(sibling)).expect(404);

    // Still there, still priced the way its own company priced it.
    const mine = await request(app)
      .get(`/api/orgs/${owner.orgId}/masters?kind=PRICE_LIST`)
      .set(auth(owner))
      .expect(200);
    const row = mine.body.masters.find((m: any) => m.id === id);
    expect(row.data.rates['11']).toBe(10);
  });

  /* The whole point of the table: another org must never see these. */
  it('does not leak one org\'s lists to another', async () => {
    const email = `bom2.${Date.now()}.${rnd()}@example.com`;
    const signup = await request(app)
      .post('/api/auth/signup')
      .send({ email, password: 'Passw0rd!23', name: 'Other owner' })
      .expect(200);
    const setup = await request(app)
      .post('/api/auth/setup-company')
      .set('Authorization', `Bearer ${signup.body.token}`)
      .send({ companyName: `Other Co ${Date.now()}-${rnd()}`, state: 'Kerala' })
      .expect(200);
    const other: Ctx = { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id };

    const mine = `Mine ${rnd()}`;
    await request(app)
      .post(`/api/orgs/${owner.orgId}/masters`)
      .set(auth(owner))
      .send({ kind: 'COST_CENTER', name: mine })
      .expect(201);

    const theirs = await request(app)
      .get(`/api/orgs/${other.orgId}/masters?kind=COST_CENTER`)
      .set(auth(other))
      .expect(200);
    expect(theirs.body.masters.find((m: any) => m.name === mine)).toBeUndefined();
  });
});
