import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';

import { buildApp } from '../app.js';
import { prisma } from '../utils/prisma.js';
import { platformPrisma } from '../utils/platformPrisma.js';
import { currentTenant, withTenant, withoutTenantBoundary } from '../utils/tenantDb.js';

/**
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

describe('row-level security', () => {
  let a: Company;
  let b: Company;

  beforeAll(async () => {
    a = await makeCompany();
    b = await makeCompany();
  }, 120_000);

  it('is switched on, and forced even for the owner', async () => {
    /* Without FORCE the policies exist and apply to nobody, because the
       application connects as the table's owner. */
    const rows = await prisma.$queryRaw<Array<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>>`
      SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = 'Org'
    `;
    expect(rows[0]?.relrowsecurity).toBe(true);
    expect(rows[0]?.relforcerowsecurity).toBe(true);
  });

  it('shows a company its own rows', async () => {
    const seen = await withTenant(a.orgId, (db) => db.warehouse.findMany({ select: { id: true } }));
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.map((r) => r.id)).toContain(a.warehouseId);
  });

  it('hides another company’s rows even when the query asks for them by id', async () => {
    /*
     * The failure this guards: a handler that takes an id from the URL and
     * forgets to scope it. The query below is exactly that mistake, written
     * deliberately — and the database returns nothing.
     */
    const stolen = await withTenant(a.orgId, (db) => db.warehouse.findFirst({ where: { id: b.warehouseId } }));
    expect(stolen).toBeNull();
  });

  it('hides another company’s rows from a raw query too', async () => {
    /* Below the ORM, where a `where` clause is whatever somebody typed. */
    const rows = await withTenant(a.orgId, (db) =>
      db.$queryRawUnsafe<Array<{ id: string }>>(`SELECT id FROM "Warehouse" WHERE id = '${b.warehouseId}'`)
    );
    expect(rows).toHaveLength(0);
  });

  it('refuses to write a row into another company', async () => {
    const other = await platformPrisma.org.findFirstOrThrow({ where: { id: b.orgId }, select: { accountId: true } });

    /* WITH CHECK, not USING: this is a row the query is trying to create in
       somebody else's company, and the database declines rather than trusting
       the caller to have scoped its own insert. */
    await expect(
      withTenant(a.orgId, (db) =>
        db.warehouse.create({
          data: {
            accountId: other.accountId,
            orgId: b.orgId,
            branchId: b.branchId,
            name: 'Smuggled',
            createdByUserId: 'rls-test',
          } as any,
        })
      )
    ).rejects.toThrow();
  });

  it('carries the company only for the length of the transaction', async () => {
    /*
     * SET LOCAL, not SET. A plain SET belongs to the connection, and a pooled
     * connection is handed to whoever asks next — so the setting would outlive
     * the request that made it and the next company would inherit it. That is
     * not a rare race under PgBouncer in transaction mode; it is the ordinary
     * case.
     */
    await withTenant(a.orgId, async (db) => {
      const inside = await db.$queryRaw<Array<{ org: string }>>`SELECT current_setting('clor.org_id', true) AS org`;
      expect(inside[0]?.org).toBe(a.orgId);
    });
    expect(await currentTenant()).toBe('');
  });

  it('lets a caller cross the boundary only by saying so', async () => {
    const all = await withoutTenantBoundary('a test asserting the escape hatch works', (db) =>
      db.warehouse.findMany({ where: { id: { in: [a.warehouseId, b.warehouseId] } }, select: { id: true } })
    );
    expect(all.map((r) => r.id).sort()).toEqual([a.warehouseId, b.warehouseId].sort());
  });

  it('will not cross the boundary without a reason', async () => {
    await expect(withoutTenantBoundary('', async () => 1)).rejects.toThrow(/reason/i);
  });

  it('refuses a query that names no company at all', async () => {
    await expect(withTenant('', async () => 1)).rejects.toThrow(/company/i);
  });
});
