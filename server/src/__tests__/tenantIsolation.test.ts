import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { buildApp } from '../app.js';
import { prisma } from '../utils/prisma.js';
import { platformPrisma } from '../utils/platformPrisma.js';

/**
 * One tenant must not be able to reach another tenant's records.
 *
 * CLOR is pooled: one database, every row carrying an orgId, every query
 * expected to filter on it. That is the right model for this product and the
 * cheap one — and its single failure mode is a query that forgets the filter.
 *
 * An audit of the source found no live leak. Every operation that acts on a
 * bare id is preceded by a tenant-scoped lookup and a 404. But that is a
 * convention, and a convention gives no signal to the person who adds a route
 * next week and does it differently. So the rule is asserted from the outside
 * instead: two tenants, and every id of the first attempted with the session of
 * the second.
 *
 * The assertion is deliberately "not 2xx" rather than a specific code. 403 and
 * 404 are both correct answers — 404 is arguably better, since confirming that
 * an id exists is itself a small leak — and pinning one would make the test
 * about the wording rather than the isolation.
 */

const app = buildApp().listen(0);
afterAll(() => new Promise((done) => app.close(done)));
const rnd = () => Math.random().toString(36).slice(2, 8);

type Tenant = {
  token: string;
  orgId: string;
  branchId: string;
  warehouseId: string;
  invoiceId: string;
  partyId: string;
  roleId: string;
};

const headers = (t: Tenant, orgId = t.orgId, branchId = t.branchId) => ({
  Authorization: `Bearer ${t.token}`,
  'x-org-id': orgId,
  'x-branch-id': branchId,
});

async function makeTenant(label: string): Promise<Tenant> {
  const email = `iso.${label}.${Date.now()}.${rnd()}@example.com`;
  const signup = await request(app)
    .post('/api/auth/signup')
    .send({ email, password: 'Passw0rd!23', name: `${label} owner` })
    .expect(200);
  const token = signup.body.token as string;
  const setup = await request(app)
    .post('/api/auth/setup-company')
    .set('Authorization', `Bearer ${token}`)
    .send({ companyName: `Iso ${label} ${Date.now()}-${rnd()}`, state: 'Karnataka' })
    .expect(200);

  const orgId = setup.body.company.orgId as string;
  const branchId = setup.body.branch.id as string;
  const auth = { Authorization: `Bearer ${token}`, 'x-org-id': orgId, 'x-branch-id': branchId };

  const warehouse = await prisma.warehouse.findFirst({ where: { orgId }, select: { id: true } });

  const invoice = await request(app)
    .post(`/api/orgs/${orgId}/invoices`)
    .set(auth)
    .send({
      date: '2026-08-01',
      customerName: `${label} buyer`,
      subtotal: 1000,
      cgstTotal: 90,
      sgstTotal: 90,
      gstTotal: 180,
      total: 1180,
      items: [{ description: 'Widget', quantity: 1, rate: 1000, gstRate: 18 }],
    })
    .expect(201);

  const party = await request(app)
    .post(`/api/orgs/${orgId}/parties`)
    .set(auth)
    .send({ partyType: 'CUSTOMER', displayName: `${label} customer`, state: 'Karnataka' });

  const role = await platformPrisma.role.findFirst({ where: { orgId }, select: { id: true } });

  return {
    token,
    orgId,
    branchId,
    warehouseId: warehouse!.id,
    invoiceId: invoice.body.invoice.id,
    partyId: party.body?.party?.id || '',
    roleId: role?.id || '',
  };
}

let alice: Tenant;
let mallory: Tenant;

beforeAll(async () => {
  [alice, mallory] = await Promise.all([makeTenant('alice'), makeTenant('mallory')]);
}, 120_000);

const denied = (status: number) => status >= 400;

describe('a tenant cannot reach another tenant by asking for its org', () => {
  /*
   * The first and most important control: the org id on the request is checked
   * against a membership row, so naming somebody else's org is not enough.
   */
  it('refuses a session pointed at an org it is not a member of', async () => {
    const res = await request(app)
      .get(`/api/orgs/${alice.orgId}/invoices`)
      .set(headers(mallory, alice.orgId, alice.branchId));
    expect(denied(res.status)).toBe(true);
  });

  it('refuses even when the caller keeps its own branch header', async () => {
    const res = await request(app)
      .get(`/api/orgs/${alice.orgId}/invoices`)
      .set(headers(mallory, alice.orgId, mallory.branchId));
    expect(denied(res.status)).toBe(true);
  });
});

describe("a tenant cannot reach another tenant's records through its own org", () => {
  /*
   * The subtler attack, and the one a forgotten `where` actually exposes: a
   * valid session, its own org in the path, and somebody else's record id.
   */
  const cases: { name: string; run: () => Promise<{ status: number }> }[] = [
    {
      name: "reads another tenant's invoice",
      run: () => request(app).get(`/api/orgs/${mallory.orgId}/invoices/${alice.invoiceId}`).set(headers(mallory)),
    },
    {
      name: "edits another tenant's invoice",
      run: () =>
        request(app)
          .patch(`/api/orgs/${mallory.orgId}/invoices/${alice.invoiceId}`)
          .set(headers(mallory))
          .send({ date: '2026-08-02', customerName: 'Taken', subtotal: 1, total: 1, items: [] }),
    },
    {
      name: "changes the status of another tenant's invoice",
      run: () =>
        request(app)
          .patch(`/api/orgs/${mallory.orgId}/invoices/${alice.invoiceId}/status`)
          .set(headers(mallory))
          .send({ status: 'Cancelled' }),
    },
    {
      name: "deletes another tenant's invoice",
      run: () => request(app).delete(`/api/orgs/${mallory.orgId}/invoices/${alice.invoiceId}`).set(headers(mallory)),
    },
    {
      name: "edits another tenant's warehouse",
      run: () =>
        request(app)
          .patch(`/api/orgs/${mallory.orgId}/warehouses/${alice.warehouseId}`)
          .set(headers(mallory))
          .send({ name: 'Taken' }),
    },
    {
      name: "deletes another tenant's warehouse",
      run: () => request(app).delete(`/api/orgs/${mallory.orgId}/warehouses/${alice.warehouseId}`).set(headers(mallory)),
    },
    {
      name: "edits another tenant's branch",
      run: () =>
        request(app)
          .patch(`/api/orgs/${mallory.orgId}/branches/${alice.branchId}`)
          .set(headers(mallory))
          .send({ branchName: 'Taken' }),
    },
    {
      name: "deletes another tenant's branch",
      run: () => request(app).delete(`/api/orgs/${mallory.orgId}/branches/${alice.branchId}`).set(headers(mallory)),
    },
    {
      name: "edits another tenant's role",
      run: () =>
        request(app)
          .patch(`/api/orgs/${mallory.orgId}/roles/${alice.roleId}`)
          .set(headers(mallory))
          .send({ name: 'Taken' }),
    },
  ];

  for (const c of cases) {
    it(`refuses when it ${c.name}`, async () => {
      const res = await c.run();
      expect(`${c.name}:${denied(res.status)}`).toBe(`${c.name}:true`);
    });
  }

  /* And nothing was changed on the way to being refused. */
  it('leaves the other tenant\'s records exactly as they were', async () => {
    const invoice = await prisma.invoice.findUnique({ where: { id: alice.invoiceId } });
    expect(invoice).not.toBeNull();
    expect(invoice?.orgId).toBe(alice.orgId);
    expect(String(invoice?.customerName)).toContain('alice');

    const branch = await platformPrisma.branch.findUnique({ where: { id: alice.branchId } });
    expect(branch?.branchName).toBe('Head Office');

    const warehouse = await prisma.warehouse.findUnique({ where: { id: alice.warehouseId } });
    expect(warehouse?.name).not.toBe('Taken');
  });
});

describe('listings never carry another tenant', () => {
  it('lists only its own invoices', async () => {
    const res = await request(app).get(`/api/orgs/${mallory.orgId}/invoices`).set(headers(mallory)).expect(200);
    const rows = res.body.invoices || res.body.rows || [];
    for (const row of rows) {
      expect(`${row.id}:${row.id === alice.invoiceId}`).toBe(`${row.id}:false`);
    }
  });
});
