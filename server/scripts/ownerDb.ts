/**
 * The connection an operator's script should use.
 *
 * Every tenant table carries a row-level security policy keyed on
 * `clor.org_id`, the company the current request is for, and the application
 * role is subject to those policies — which is the point of it. A script run
 * by an operator is not a request and belongs to no company, so asked "how
 * many companies are there" as the application role, PostgreSQL answers
 * truthfully and unhelpfully: none.
 *
 * That answer is the dangerous kind. `backfillOwnerPermissions` found no
 * companies and reported "nothing to do" — which is exactly what it prints
 * when everything is in order, so a database missing hundreds of grants and a
 * database in perfect health produced the same line.
 *
 * So maintenance scripts connect as the owner, from PGADMIN_URL, and say so
 * where they print. The owner is not exempt by accident; it is the role that
 * exists to see across tenants, and nothing serving a request ever uses it.
 */
import { PrismaClient } from '@prisma/client';

/** Which schema the application URL points at — the app's own, by definition. */
export const appSchema = (fallback = 'accounting') => {
  try {
    return new URL(String(process.env.DATABASE_URL)).searchParams.get('schema') || fallback;
  } catch {
    return fallback;
  }
};

/**
 * PGADMIN_URL, pointed at the application's database and schema.
 *
 * The database name comes from the application's URL rather than from
 * PGADMIN_URL, which points at `postgres` — the maintenance database every
 * cluster has, and the last place a company's rows are.
 *
 * Undefined where PGADMIN_URL is not set, which leaves the caller on its
 * default connection. That is the right behaviour for a development machine
 * whose own account owns the tables anyway.
 */
export const ownerUrl = () => {
  const admin = String(process.env.PGADMIN_URL || '').trim();
  const runtime = String(process.env.DATABASE_URL || '').trim();
  if (!admin || !runtime) return undefined;
  const url = new URL(admin);
  url.pathname = new URL(runtime).pathname;
  url.search = `?schema=${appSchema()}`;
  return url.toString();
};

/** A client that sees every tenant. Never used to serve a request. */
export const ownerClient = () => {
  const url = ownerUrl();
  return new PrismaClient(url ? { datasources: { db: { url } } } : undefined);
};
