import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { buildApp } from '../app.js';
import { prisma } from '../utils/prisma.js';

/**
 * Stock adjustments and transfers, kept on the server.
 *
 * They lived only in the browser that raised them. These routes store them
 * for every device, and check what a server can: who may raise them, in which
 * warehouses, and on which dates.
 */

const app = buildApp().listen(0);
afterAll(() => new Promise((done) => app.close(done)));

type Ctx = { token: string; orgId: string; branchId: string; userId?: string };
let owner: Ctx;
let other: Ctx;
let warehouseId: string;
let otherWarehouseId: string;

const auth = (c: Ctx) => ({ Authorization: `Bearer ${c.token}`, 'x-org-id': c.orgId, 'x-branch-id': c.branchId });
const rnd = () => Math.random().toString(36).slice(2, 8);
const uid = () => `adj-${Date.now().toString(36)}-${rnd()}`;

async function makeOwner(name: string): Promise<Ctx> {
  const email = `stock.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app).post('/api/auth/signup').send({ email, password: 'Passw0rd!23', name }).expect(200);
  const setup = await request(app)
    .post('/api/auth/setup-company')
    .set('Authorization', `Bearer ${signup.body.token}`)
    .send({ companyName: `${name} ${Date.now()}-${rnd()}`, state: 'Karnataka' })
    .expect(200);
  return { token: signup.body.token, orgId: setup.body.company.orgId, branchId: setup.body.branch.id };
}

async function firstWarehouse(c: Ctx) {
  const res = await request(app).get(`/api/orgs/${c.orgId}/warehouses`).set(auth(c)).expect(200);
  return String(res.body.warehouses[0].id);
}

async function memberWith(roleName: string): Promise<Ctx> {
  const roles = await request(app).get(`/api/orgs/${owner.orgId}/roles`).set(auth(owner)).expect(200);
  const role = roles.body.roles.find((r: any) => r.name === roleName);
  const email = `m.${Date.now()}.${rnd()}@example.com`;
  const user = await request(app)
    .post('/api/users')
    .set(auth(owner))
    .send({ email, fullName: roleName, password: 'Passw0rd!23', orgIds: [owner.orgId], branchIdsByOrg: { [owner.orgId]: [owner.branchId] } })
    .expect(201);
  await request(app).post(`/api/orgs/${owner.orgId}/users/${user.body.user.id}/roles`).set(auth(owner)).send({ roleId: role.id }).expect(201);
  await request(app)
    .post(`/api/orgs/${owner.orgId}/users/${user.body.user.id}/warehouses`)
    .set(auth(owner))
    .send({ warehouseIds: [warehouseId] });
  const login = await request(app).post('/api/auth/login').send({ emailOrUsername: email, password: 'Passw0rd!23' }).expect(200);
  return { token: login.body.token, orgId: owner.orgId, branchId: owner.branchId, userId: user.body.user.id };
}

const adjustment = (over: Record<string, unknown> = {}) => ({
  number: 'ADJ-0001',
  date: '2026-09-10',
  status: 'Posted',
  warehouseId,
  payload: { id: 1, itemId: 5, itemBackendId: 'itm-1', qtyDelta: -2, reason: 'Damaged', createdAt: new Date().toISOString() },
  ...over,
});

const put = (c: Ctx, kind: string, id: string, body: any) =>
  request(app).put(`/api/orgs/${c.orgId}/stock-documents/${kind}/${id}`).set(auth(c)).send(body);

beforeAll(async () => {
  owner = await makeOwner('Stock owner');
  other = await makeOwner('Other company');
  await request(app).get(`/api/orgs/${owner.orgId}/roles`).set(auth(owner)).expect(200); // seeds stock roles
  warehouseId = await firstWarehouse(owner);
  otherWarehouseId = await firstWarehouse(other);
}, 60_000);

describe('keeping a stock adjustment on the server', () => {
  it('stores it, lists it back with its payload, updates it and deletes it', async () => {
    const id = uid();
    const created = await put(owner, 'ADJUSTMENT', id, adjustment()).expect(201);
    expect(created.body.document).toMatchObject({ kind: 'ADJUSTMENT', uid: id, number: 'ADJ-0001', warehouseId, branchId: owner.branchId });

    const list = await request(app).get(`/api/orgs/${owner.orgId}/stock-documents?kind=ADJUSTMENT`).set(auth(owner)).expect(200);
    const row = list.body.documents.find((d: any) => d.uid === id);
    expect(row.payload).toMatchObject({ itemBackendId: 'itm-1', qtyDelta: -2 });

    const updated = await put(owner, 'ADJUSTMENT', id, adjustment({ payload: { ...adjustment().payload, qtyDelta: -3 } })).expect(200);
    expect(updated.body.document.payload.qtyDelta).toBe(-3);

    await request(app).delete(`/api/orgs/${owner.orgId}/stock-documents/ADJUSTMENT/${id}`).set(auth(owner)).expect(200);
    const after = await request(app).get(`/api/orgs/${owner.orgId}/stock-documents?kind=ADJUSTMENT`).set(auth(owner)).expect(200);
    expect(after.body.documents.some((d: any) => d.uid === id)).toBe(false);
  });

  it('refuses a warehouse from another company, and a malformed document', async () => {
    const res = await put(owner, 'ADJUSTMENT', uid(), adjustment({ warehouseId: otherWarehouseId })).expect(400);
    expect(res.body.error).toMatch(/not in this company/);
    await put(owner, 'ADJUSTMENT', uid(), adjustment({ date: '10/09/2026' })).expect(400);
    await put(owner, 'NONSENSE', uid(), adjustment()).expect(404);
    await put(owner, 'ADJUSTMENT', 'x', adjustment()).expect(400);
  });
});

describe('who may raise them', () => {
  it('lets a Store Keeper raise an adjustment, a Viewer read it, and a Sales User neither write nor delete', async () => {
    const keeper = await memberWith('Store Keeper');
    const id = uid();
    await put(keeper, 'ADJUSTMENT', id, adjustment()).expect(201);

    const viewer = await memberWith('Viewer');
    const seen = await request(app).get(`/api/orgs/${owner.orgId}/stock-documents?kind=ADJUSTMENT`).set(auth(viewer)).expect(200);
    expect(seen.body.documents.some((d: any) => d.uid === id)).toBe(true);
    await put(viewer, 'ADJUSTMENT', uid(), adjustment()).expect(403);

    const sales = await memberWith('Sales User');
    await put(sales, 'ADJUSTMENT', uid(), adjustment()).expect(403);
    await request(app).delete(`/api/orgs/${owner.orgId}/stock-documents/ADJUSTMENT/${id}`).set(auth(sales)).expect(403);
  });

  it("never shows one company's documents to another", async () => {
    const id = uid();
    await put(owner, 'ADJUSTMENT', id, adjustment()).expect(201);
    const theirs = await request(app).get(`/api/orgs/${other.orgId}/stock-documents`).set(auth(other)).expect(200);
    expect(theirs.body.documents.some((d: any) => d.uid === id)).toBe(false);
    await request(app).delete(`/api/orgs/${other.orgId}/stock-documents/ADJUSTMENT/${id}`).set(auth(other)).expect(404);
  });
});

describe('closed periods', () => {
  const lock = (through: string | null) =>
    request(app).post(`/api/orgs/${owner.orgId}/ledger/fiscal-years/2026-27/lock`).set(auth(owner)).send({ lockedThrough: through }).expect(200);

  it('refuses a new document, a change or a removal on or before the lock', async () => {
    const id = uid();
    await put(owner, 'ADJUSTMENT', id, adjustment({ date: '2026-06-10' })).expect(201);
    await lock('2026-06-30');
    try {
      const fresh = await put(owner, 'ADJUSTMENT', uid(), adjustment({ date: '2026-06-12' })).expect(409);
      expect(fresh.body.code).toBe('period_locked');
      await put(owner, 'ADJUSTMENT', id, adjustment({ date: '2026-06-10', payload: { ...adjustment().payload, qtyDelta: -9 } })).expect(409);
      await request(app).delete(`/api/orgs/${owner.orgId}/stock-documents/ADJUSTMENT/${id}`).set(auth(owner)).expect(409);
      // Moving a locked document out of the period is still changing it.
      await put(owner, 'ADJUSTMENT', id, adjustment({ date: '2026-07-10' })).expect(409);
      // After the lock date, business as usual.
      await put(owner, 'ADJUSTMENT', uid(), adjustment({ date: '2026-07-02' })).expect(201);
    } finally {
      await lock(null);
    }
  });

  it('accepts the first upload of a document raised before the books were closed', async () => {
    const raisedEarlier = new Date(Date.now() - 60_000).toISOString();
    await lock('2026-05-31');
    try {
      await put(owner, 'ADJUSTMENT', uid(), adjustment({ date: '2026-05-20', payload: { ...adjustment().payload, createdAt: raisedEarlier } })).expect(201);
      // Raised after the close: refused.
      const later = new Date(Date.now() + 60_000).toISOString();
      await put(owner, 'ADJUSTMENT', uid(), adjustment({ date: '2026-05-21', payload: { ...adjustment().payload, createdAt: later } })).expect(409);
    } finally {
      await lock(null);
    }
  });
});

describe('transfers', () => {
  it('are stored with both ends, visible from the receiving branch too', async () => {
    const id = `trf-${Date.now().toString(36)}-${rnd()}`;
    const res = await put(owner, 'TRANSFER', id, {
      number: 'TRF-0001',
      date: '2026-09-11',
      status: 'Out',
      warehouseId,
      targetWarehouseId: warehouseId,
      payload: { lines: [{ itemId: 5, itemBackendId: 'itm-1', qty: 4 }], createdAt: new Date().toISOString() },
    }).expect(201);
    expect(res.body.document).toMatchObject({ targetBranchId: owner.branchId, status: 'Out' });
    await put(owner, 'TRANSFER', id, { ...res.body.document, status: 'In', payload: res.body.document.payload }).expect(200);
  });
});

describe('row-level security', () => {
  it('is switched on and forced for the new table', async () => {
    const rows = await prisma.$queryRaw<Array<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>>`
      SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = 'StockDocument'
    `;
    expect(rows[0]?.relrowsecurity).toBe(true);
    expect(rows[0]?.relforcerowsecurity).toBe(true);
  });
});
