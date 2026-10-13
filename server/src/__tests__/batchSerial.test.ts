import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { buildApp } from '../app.js';

/**
 * Requirement 11: batch (lot) and serial number tracking.
 *
 * The rules worth protecting are the ones a spreadsheet cannot enforce: stock
 * cannot be issued from a lot that does not have it, the same physical unit
 * cannot be sold twice, and an item's tracking mode decides which of the two
 * applies.
 */

/**
 * One listening server for the whole file, not one per request.
 *
 * supertest given an Express app binds a fresh ephemeral-port listener for
 * every single request; a run makes thousands of listen/close cycles, and
 * the suite's residual flake was a raw Node-level 400 "Bad Request" that
 * never reached Express (absent from both morgan and the anomaly log) —
 * socket churn, not application behaviour. Given an already-listening
 * server, supertest reuses it.
 */
const app = buildApp().listen(0);
afterAll(() => new Promise((done) => app.close(done)));
const rnd = () => Math.random().toString(36).slice(2, 8);

type Ctx = { token: string; orgId: string; branchId: string; warehouseId: string };
let owner: Ctx;

const auth = (c: Ctx) => ({
  Authorization: `Bearer ${c.token}`,
  'x-org-id': c.orgId,
  'x-branch-id': c.branchId,
  'x-warehouse-id': c.warehouseId,
});

async function makeOwner(): Promise<Ctx> {
  const email = `bs.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app)
    .post('/api/auth/signup')
    .send({ email, password: 'Passw0rd!23', name: 'BS owner' })
    .expect(200);
  const setup = await request(app)
    .post('/api/auth/setup-company')
    .set('Authorization', `Bearer ${signup.body.token}`)
    .send({ companyName: `BS Co ${Date.now()}-${rnd()}`, state: 'Karnataka' })
    .expect(200);

  const base = {
    token: signup.body.token as string,
    orgId: setup.body.company.orgId as string,
    branchId: setup.body.branch.id as string,
  };

  const headers = { Authorization: `Bearer ${base.token}`, 'x-org-id': base.orgId, 'x-branch-id': base.branchId };

  // Company setup may already have made one; only create if it did not.
  const existing = await request(app).get(`/api/orgs/${base.orgId}/warehouses`).set(headers);
  let warehouseId = String(existing.body?.warehouses?.[0]?.id || '');

  if (!warehouseId) {
    const wh = await request(app)
      .post(`/api/orgs/${base.orgId}/warehouses`)
      .set(headers)
      .send({ name: `WH ${rnd()}`, code: `W${rnd()}`, branchId: base.branchId })
      .expect(201);
    warehouseId = String(wh.body.warehouse.id);
  }

  return { ...base, warehouseId };
}

const makeItem = async (trackBy: 'NONE' | 'BATCH' | 'SERIAL') => {
  const res = await request(app)
    .post(`/api/orgs/${owner.orgId}/items`)
    .set(auth(owner))
    .send({ name: `Item ${trackBy} ${Date.now()}-${rnd()}`, unit: 'Pcs', trackBy });
  if (res.status !== 201) throw new Error(`item create ${res.status}: ${JSON.stringify(res.body)}`);
  return res.body.item;
};

const setFeature = async (key: string, enabled: boolean) => {
  const current = await request(app).get(`/api/orgs/${owner.orgId}/features`).set(auth(owner)).expect(200);
  const features = { ...(current.body.features || {}), [key]: enabled };
  await request(app).put(`/api/orgs/${owner.orgId}/features`).set(auth(owner)).send({ features }).expect(200);
};

beforeAll(async () => {
  owner = await makeOwner();
  await setFeature('batchSerial', true);
}, 60_000);

describe('batches', () => {
  it('receives a lot and reports it on hand', async () => {
    const item = await makeItem('BATCH');
    const res = await request(app)
      .post(`/api/orgs/${owner.orgId}/batches`)
      .set(auth(owner))
      .send({ itemId: item.id, batchNo: 'LOT-A', qty: 100, expiryDate: '2027-01-31' })
      .expect(201);

    expect(res.body.batch.batchNo).toBe('LOT-A');
    expect(res.body.batch.qtyOnHand).toBe(100);
  });

  it('adds to the existing lot rather than creating a second row for it', async () => {
    const item = await makeItem('BATCH');
    await request(app)
      .post(`/api/orgs/${owner.orgId}/batches`)
      .set(auth(owner))
      .send({ itemId: item.id, batchNo: 'LOT-B', qty: 40 })
      .expect(201);
    const second = await request(app)
      .post(`/api/orgs/${owner.orgId}/batches`)
      .set(auth(owner))
      .send({ itemId: item.id, batchNo: 'LOT-B', qty: 60 })
      .expect(201);

    expect(second.body.batch.qtyOnHand).toBe(100);

    const list = await request(app)
      .get(`/api/orgs/${owner.orgId}/batches?itemId=${item.id}`)
      .set(auth(owner))
      .expect(200);
    expect(list.body.batches.filter((b: any) => b.batchNo === 'LOT-B')).toHaveLength(1);
  });

  it('refuses to issue more than the lot holds', async () => {
    const item = await makeItem('BATCH');
    const created = await request(app)
      .post(`/api/orgs/${owner.orgId}/batches`)
      .set(auth(owner))
      .send({ itemId: item.id, batchNo: 'LOT-C', qty: 10 })
      .expect(201);

    const res = await request(app)
      .post(`/api/orgs/${owner.orgId}/batches/${created.body.batch.id}/issue`)
      .set(auth(owner))
      .send({ qty: 11 })
      .expect(400);

    expect(String(res.body.error)).toMatch(/only 10 left/i);
  });

  it('issues down to zero and leaves the lot at zero, not negative', async () => {
    const item = await makeItem('BATCH');
    const created = await request(app)
      .post(`/api/orgs/${owner.orgId}/batches`)
      .set(auth(owner))
      .send({ itemId: item.id, batchNo: 'LOT-D', qty: 5 })
      .expect(201);

    const res = await request(app)
      .post(`/api/orgs/${owner.orgId}/batches/${created.body.batch.id}/issue`)
      .set(auth(owner))
      .send({ qty: 5 })
      .expect(200);

    expect(res.body.batch.qtyOnHand).toBe(0);
  });

  it('lists soonest expiry first, because that is the order stock should leave in', async () => {
    const item = await makeItem('BATCH');
    for (const [batchNo, expiryDate] of [
      ['LATE', '2028-12-31'],
      ['SOON', '2026-09-30'],
      ['MID', '2027-06-30'],
    ]) {
      await request(app)
        .post(`/api/orgs/${owner.orgId}/batches`)
        .set(auth(owner))
        .send({ itemId: item.id, batchNo, qty: 10, expiryDate })
        .expect(201);
    }

    const list = await request(app)
      .get(`/api/orgs/${owner.orgId}/batches?itemId=${item.id}`)
      .set(auth(owner))
      .expect(200);

    expect(list.body.batches.map((b: any) => b.batchNo)).toEqual(['SOON', 'MID', 'LATE']);
  });

  it('rejects an expiry date before the manufacturing date', async () => {
    const item = await makeItem('BATCH');
    await request(app)
      .post(`/api/orgs/${owner.orgId}/batches`)
      .set(auth(owner))
      .send({ itemId: item.id, batchNo: 'LOT-E', qty: 1, mfgDate: '2026-05-01', expiryDate: '2026-04-01' })
      .expect(400);
  });

  it('refuses a lot against an item that is not batch tracked', async () => {
    const item = await makeItem('NONE');
    const res = await request(app)
      .post(`/api/orgs/${owner.orgId}/batches`)
      .set(auth(owner))
      .send({ itemId: item.id, batchNo: 'LOT-X', qty: 1 })
      .expect(400);

    expect(String(res.body.error)).toMatch(/not tracked by batch/i);
  });
});

describe('serial numbers', () => {
  it('registers units and lists them in stock', async () => {
    const item = await makeItem('SERIAL');
    const res = await request(app)
      .post(`/api/orgs/${owner.orgId}/serials`)
      .set(auth(owner))
      .send({ itemId: item.id, serialNos: ['SN-1', 'SN-2', 'SN-3'] })
      .expect(201);

    expect(res.body.count).toBe(3);

    const list = await request(app)
      .get(`/api/orgs/${owner.orgId}/serials?itemId=${item.id}&status=IN_STOCK`)
      .set(auth(owner))
      .expect(200);
    expect(list.body.serials).toHaveLength(3);
  });

  it('rejects the whole request when a serial repeats within it', async () => {
    const item = await makeItem('SERIAL');
    await request(app)
      .post(`/api/orgs/${owner.orgId}/serials`)
      .set(auth(owner))
      .send({ itemId: item.id, serialNos: ['DUP', 'DUP'] })
      .expect(400);

    const list = await request(app)
      .get(`/api/orgs/${owner.orgId}/serials?itemId=${item.id}`)
      .set(auth(owner))
      .expect(200);
    expect(list.body.serials).toHaveLength(0);
  });

  it('refuses to register a serial that already exists for the item', async () => {
    const item = await makeItem('SERIAL');
    await request(app)
      .post(`/api/orgs/${owner.orgId}/serials`)
      .set(auth(owner))
      .send({ itemId: item.id, serialNos: ['SN-KEEP'] })
      .expect(201);

    await request(app)
      .post(`/api/orgs/${owner.orgId}/serials`)
      .set(auth(owner))
      .send({ itemId: item.id, serialNos: ['SN-KEEP'] })
      .expect(409);
  });

  it('issues a unit once and refuses to sell the same one twice', async () => {
    const item = await makeItem('SERIAL');
    await request(app)
      .post(`/api/orgs/${owner.orgId}/serials`)
      .set(auth(owner))
      .send({ itemId: item.id, serialNos: ['SN-SOLD'] })
      .expect(201);

    await request(app)
      .post(`/api/orgs/${owner.orgId}/serials/issue`)
      .set(auth(owner))
      .send({ serialNos: ['SN-SOLD'], docType: 'INVOICE', docId: 'inv-1' })
      .expect(200);

    const again = await request(app)
      .post(`/api/orgs/${owner.orgId}/serials/issue`)
      .set(auth(owner))
      .send({ serialNos: ['SN-SOLD'] })
      .expect(409);

    expect(String(again.body.error)).toMatch(/not in stock/i);
  });

  it('keeps a sold unit searchable, for warranty and recall', async () => {
    const item = await makeItem('SERIAL');
    await request(app)
      .post(`/api/orgs/${owner.orgId}/serials`)
      .set(auth(owner))
      .send({ itemId: item.id, serialNos: ['SN-TRACE'] })
      .expect(201);
    await request(app)
      .post(`/api/orgs/${owner.orgId}/serials/issue`)
      .set(auth(owner))
      .send({ serialNos: ['SN-TRACE'], docType: 'INVOICE', docId: 'inv-9' })
      .expect(200);

    const found = await request(app)
      .get(`/api/orgs/${owner.orgId}/serials?serialNo=SN-TRACE`)
      .set(auth(owner))
      .expect(200);

    expect(found.body.serials).toHaveLength(1);
    expect(found.body.serials[0].status).toBe('SOLD');
    expect(found.body.serials[0].issuedDocId).toBe('inv-9');
  });

  it('reports which serials were never registered rather than failing vaguely', async () => {
    const res = await request(app)
      .post(`/api/orgs/${owner.orgId}/serials/issue`)
      .set(auth(owner))
      .send({ serialNos: ['GHOST-1'] })
      .expect(404);

    expect(String(res.body.error)).toMatch(/GHOST-1/);
  });
});

describe('the batchSerial feature switch', () => {
  it('will not switch batch/serial off while batches or serials exist', async () => {
    const current = await request(app).get(`/api/orgs/${owner.orgId}/features`).set(auth(owner)).expect(200);
    const res = await request(app)
      .put(`/api/orgs/${owner.orgId}/features`)
      .set(auth(owner))
      .send({ features: { ...(current.body.features || {}), batchSerial: false } })
      .expect(409);
    expect(res.body.code).toBe('FEATURE_IN_USE');
  });

  it('turns the whole area off for a company with no batches yet', async () => {
    const fresh = await makeOwner();
    const current = await request(app).get(`/api/orgs/${fresh.orgId}/features`).set(auth(fresh)).expect(200);
    await request(app)
      .put(`/api/orgs/${fresh.orgId}/features`)
      .set(auth(fresh))
      .send({ features: { ...(current.body.features || {}), batchSerial: false } })
      .expect(200);
    const res = await request(app).get(`/api/orgs/${fresh.orgId}/batches`).set(auth(fresh)).expect(400);
    expect(String(res.body.error)).toMatch(/switched off/i);
  });
});
