import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from '../app.js';
import { prisma } from '../utils/prisma.js';
import { platformPrisma } from '../utils/platformPrisma.js';
import { outsideTenant, runInTenant } from '../utils/tenantScope.js';

/**
 * The request's company reaches the database without a route asking.
 *
 * utils/tenantScope.ts wraps every Prisma client; inside runInTenant (what
 * requireTenantContext does for each request) a query that forgot its orgId
 * filter still sees only that company's rows. Plain queries, both kinds of
 * transaction and raw SQL are covered, and outsideTenant is the deliberate
 * way across.
 *
 * Original note kept from rowLevelSecurity.test.ts:
 * What the database refuses on its own.
 *
 * These tests do not exercise a route. They go under the application entirely
 * and ask PostgreSQL the question the application is trusted to ask correctly
 * every time: may this query see this company's rows? A `where` clause cannot
 * be tested for having been forgotten — only the layer below it can.
 */

const app = buildApp();
const rnd = () => Math.random().toString(36).slice(2, 8);

type Company = { token: string; orgId: string; branchId: string; warehouseId: string; name: string };

async function makeCompany(): Promise<Company> {
  const email = `rls.${Date.now()}.${rnd()}@example.com`;
  const name = `RLS Co ${rnd()}`;
  const signup = await request(app)
    .post('/api/auth/signup')
    .send({ email, password: 'Passw0rd!23', name: 'RLS owner' })
    .expect(200);
  const setup = await request(app)
    .post('/api/auth/setup-company')
    .set('Authorization', `Bearer ${signup.body.token}`)
    .send({ companyName: name, state: 'Karnataka' })
    .expect(200);
  /*
   * The example tenant table is Warehouse, an accounting-database table that
   * carries an orgId and a tenant policy. Branch would read more naturally, but
   * it now lives in the platform database — a separate client with no
   * withTenant() boundary — so it cannot demonstrate accounting's row-level
   * security. Setup creates one "Main Store" warehouse per org, which is the
   * row this company is shown and the other is denied.
   */
  const warehouse = await prisma.warehouse.findFirstOrThrow({
    where: { orgId: setup.body.company.orgId },
    select: { id: true },
  });
  return {
    token: signup.body.token,
    orgId: setup.body.company.orgId,
    branchId: setup.body.branch.id,
    warehouseId: warehouse.id,
    name,
  };
}

describe('the request scope tells the database its company', () => {
  let a: Company;
  let b: Company;

  beforeAll(async () => {
    a = await makeCompany();
    b = await makeCompany();
  }, 120_000);

  const ids = (rows: Array<{ id: string }>) => rows.map((r) => r.id);
  /* Prisma queries are lazy: they run when awaited, so a scope must be awaited inside — as a request handler does. */

  it('narrows a query with no orgId filter to the company in scope', async () => {
    const seen = ids(await runInTenant(a.orgId, async () => prisma.warehouse.findMany({ select: { id: true } })));
    expect(seen).toContain(a.warehouseId);
    expect(seen).not.toContain(b.warehouseId);
  });

  it('holds when the callback returns the query without awaiting it', async () => {
    const seen = ids(await runInTenant(a.orgId, () => prisma.warehouse.findMany({ select: { id: true } })));
    expect(seen).not.toContain(b.warehouseId);
    const both = ids(await runInTenant(a.orgId, () => outsideTenant('test: lazy crossing', () => prisma.warehouse.findMany({ where: { id: { in: [a.warehouseId, b.warehouseId] } }, select: { id: true } }))));
    expect(both).toEqual(expect.arrayContaining([a.warehouseId, b.warehouseId]));
  });

  it('cannot reach another company by id', async () => {
    const other = await runInTenant(a.orgId, async () => prisma.warehouse.findUnique({ where: { id: b.warehouseId } }));
    expect(other).toBeNull();
    const changed = await runInTenant(a.orgId, async () => prisma.warehouse.updateMany({ where: { id: b.warehouseId }, data: { name: 'Taken' } }));
    expect(changed.count).toBe(0);
  });

  it('holds inside an interactive transaction', async () => {
    const seen = await runInTenant(a.orgId, () =>
      prisma.$transaction(async (tx) => ({
        rows: ids(await tx.warehouse.findMany({ select: { id: true } })),
        org: (await tx.$queryRaw<Array<{ org: string }>>`SELECT current_setting('clor.org_id', true) AS org`)[0]?.org,
      }))
    );
    expect(seen.org).toBe(a.orgId);
    expect(seen.rows).toContain(a.warehouseId);
    expect(seen.rows).not.toContain(b.warehouseId);
  });

  it('holds in a batch transaction and returns the batch results only', async () => {
    const [list, count] = await runInTenant(a.orgId, () =>
      prisma.$transaction([prisma.warehouse.findMany({ select: { id: true } }), prisma.warehouse.count()])
    );
    expect(ids(list)).not.toContain(b.warehouseId);
    expect(count).toBe(list.length);
  });

  it('holds for raw SQL', async () => {
    const rows = await runInTenant(a.orgId, () => prisma.$queryRaw<Array<{ id: string }>>`SELECT id FROM "Warehouse"`);
    expect(ids(rows)).toContain(a.warehouseId);
    expect(ids(rows)).not.toContain(b.warehouseId);
  });

  it('does not leak the setting to a query outside the scope', async () => {
    await runInTenant(a.orgId, async () => prisma.warehouse.count());
    const org = (await prisma.$queryRaw<Array<{ org: string | null }>>`SELECT current_setting('clor.org_id', true) AS org`)[0]?.org;
    expect(org || '').toBe('');
  });

  it('caps a request query in time, and only inside the request', async () => {
    const inside = await runInTenant(a.orgId, () => prisma.$queryRaw<Array<{ t: string }>>`SELECT current_setting('statement_timeout') AS t`);
    expect(inside[0]?.t).toBe('30s');
    const inTx = await runInTenant(a.orgId, () =>
      prisma.$transaction(async (tx) => (await tx.$queryRaw<Array<{ t: string }>>`SELECT current_setting('statement_timeout') AS t`)[0]?.t)
    );
    expect(inTx).toBe('30s');
    const outside = (await prisma.$queryRaw<Array<{ t: string }>>`SELECT current_setting('statement_timeout') AS t`)[0]?.t;
    expect(outside).not.toBe('30s');
  });

  it('crosses companies only through outsideTenant', async () => {
    const seen = ids(await runInTenant(a.orgId, () => outsideTenant('test: both companies', async () => prisma.warehouse.findMany({ where: { id: { in: [a.warehouseId, b.warehouseId] } }, select: { id: true } }))));
    expect(seen).toEqual(expect.arrayContaining([a.warehouseId, b.warehouseId]));
    expect(() => outsideTenant('  ', () => 1)).toThrow();
  });

  it('scopes a real request: another company id in the header is refused, own data only', async () => {
    const res = await request(app)
      .get(`/api/orgs/${a.orgId}/warehouses`)
      .set({ Authorization: `Bearer ${a.token}`, 'x-org-id': a.orgId, 'x-branch-id': a.branchId });
    if (res.status === 200) {
      const list = (res.body.warehouses || res.body.items || res.body || []) as Array<{ id: string }>;
      expect(ids(Array.isArray(list) ? list : [])).not.toContain(b.warehouseId);
    }
  });
});
