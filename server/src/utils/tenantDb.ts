import { PrismaClient } from '@prisma/client';

import { prisma } from './prisma.js';

/**
 * Row-level security: the database's own opinion about which company a query
 * may see.
 *
 * Every tenant-scoped route already filters by `orgId`, and every one of them
 * is correct today. The problem with that sentence is the word "today": there
 * are 52 route files and one forgotten `where` clause shows another company's
 * invoices, with nothing between the mistake and the customer. Application
 * filtering is a convention, and a convention cannot be enforced.
 *
 * PostgreSQL can enforce it. Each tenant table carries a policy that compares
 * its `orgId` against a setting on the connection, and a query that has not
 * declared which company it is for sees nothing at all — not an error, an
 * empty table. The check is below the ORM, so it holds for a raw query, a
 * migration script, a psql session, and code nobody has written yet.
 *
 * Two things make this work rather than merely exist:
 *
 * **`SET LOCAL`, inside an explicit transaction.** A plain `SET` belongs to
 * the connection, and a pooled connection is handed to the next request when
 * this one finishes — so the setting outlives the request that made it and the
 * next company inherits it. Under PgBouncer in transaction mode that is not a
 * risk, it is the normal case. `SET LOCAL` is undone when the transaction ends,
 * which is exactly the lifetime wanted.
 *
 * **`FORCE ROW LEVEL SECURITY`.** A table's owner is exempt from its own
 * policies unless forced, and the application connects as the owner in
 * development. Without FORCE the policies would be real, enforced against
 * nobody, and comfortable to believe in.
 */

/** The setting a policy reads. Namespaced, or PostgreSQL rejects it. */
export const TENANT_SETTING = 'clor.org_id';

type TenantClient = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;

/**
 * Runs `fn` with the database told which company it is working for.
 *
 * Everything inside is one transaction, which is what makes the setting safe
 * and also what makes it correct: a request that reads a ledger and writes an
 * entry should do both, or neither, against the same company.
 */
export async function withTenant<T>(orgId: string, fn: (db: TenantClient) => Promise<T>): Promise<T> {
  const id = String(orgId || '').trim();
  if (!id) throw new Error('withTenant needs a company. An empty one would see nothing, which is not what any caller means.');

  return prisma.$transaction(async (tx) => {
    /*
     * set_config with `true` is SET LOCAL. Passed as a parameter rather than
     * interpolated: an org id arrives from a request header, and the one place
     * a tenant boundary is established is the last place to build SQL from a
     * string.
     */
    await tx.$executeRaw`SELECT set_config(${TENANT_SETTING}, ${id}, true)`;
    return fn(tx as unknown as TenantClient);
  });
}

/**
 * The same, for a caller that must see across companies: a platform
 * administrator, a migration, a report over every tenant.
 *
 * It is deliberately awkward to reach and deliberately named. Crossing the
 * boundary should be a decision somebody made, and a reviewer can find every
 * one of them by searching for this.
 */
export async function withoutTenantBoundary<T>(reason: string, fn: (db: TenantClient) => Promise<T>): Promise<T> {
  if (!reason.trim()) throw new Error('Crossing the tenant boundary needs a reason, for whoever reads this next.');
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config(${TENANT_SETTING}, '', true)`;
    return fn(tx as unknown as TenantClient);
  });
}

/** Which company the current connection believes it is working for. */
export async function currentTenant(): Promise<string> {
  const rows = await prisma.$queryRaw<Array<{ org: string | null }>>`
    SELECT current_setting(${TENANT_SETTING}, true) AS org
  `;
  return rows[0]?.org || '';
}
