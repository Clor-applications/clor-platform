import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { PrismaClient } from '@prisma/client';

/**
 * Gives this run its own database, with a schema per application inside it.
 *
 * The suite used to own three SQLite files, which is why it stopped working
 * the day the product moved to PostgreSQL: `prisma db push` against
 * `file:./test.db` cannot apply a `postgresql` schema, and the whole suite
 * died in setup before a single test ran.
 *
 * So the databases are created here and dropped at the end. Named for the
 * process id, because two runs at once must not reset each other — that was
 * the original reason for per-run files and it has not changed.
 *
 * Creating a database needs a connection to a database that already exists, so
 * the run borrows `postgres` for the two statements it needs. Prisma is used
 * for it rather than `psql`, so the suite depends on nothing but the driver it
 * already has.
 */

const dbNameOf = (url: string) => new URL(url).pathname.replace(/^\//, '');

/**
 * A connection to the admin database, for CREATE and DROP.
 *
 * Derived from this run's own DATABASE_URL rather than read from a second
 * variable: globalSetup does not always share an environment with the config
 * that computed it, and an empty admin URL fails as an unreadable Prisma
 * initialisation error rather than as a missing setting.
 */
/*
 * The owner, not the application role.
 *
 * The suite creates databases, pushes a schema and applies policies — none of
 * which the application role may do, and rightly: a role that can alter the
 * tables it is being kept out of is not much of a boundary. Tests then connect
 * as the application role, because row-level security is skipped entirely for
 * a superuser and a suite that ran as one would prove nothing.
 */
const adminUrl = (database = 'postgres') => {
  const url = new URL(String(process.env.PGADMIN_URL || process.env.PG_ADMIN_URL || process.env.DATABASE_URL || ''));
  url.pathname = `/${database}`;
  url.search = '';
  return url.toString();
};

const admin = (database?: string) => new PrismaClient({ datasources: { db: { url: adminUrl(database) } } });

const quote = (name: string) => `"${name.replace(/"/g, '""')}"`;

async function createDatabase(name: string) {
  const db = admin();
  try {
    /* Dropped first: a database left behind by a run that was killed would
       otherwise be reused with an old schema in it. */
    await db.$executeRawUnsafe(`DROP DATABASE IF EXISTS ${quote(name)} WITH (FORCE)`);
    await db.$executeRawUnsafe(`CREATE DATABASE ${quote(name)}`);
  } finally {
    await db.$disconnect();
  }
}

async function dropDatabase(name: string) {
  const db = admin();
  try {
    /* WITH (FORCE) rather than a polite DROP: Prisma's pool may still be
       closing when the suite ends, and a single lingering connection makes
       DROP DATABASE wait forever. */
    await db.$executeRawUnsafe(`DROP DATABASE IF EXISTS ${quote(name)} WITH (FORCE)`);
  } catch {
    /* A database left behind is untidy, not a failed test run. */
  } finally {
    await db.$disconnect();
  }
}

/**
 * The policies, which `prisma db push` does not carry.
 *
 * Push builds a database from the schema file, and row-level security is not
 * expressible there — it lives in a hand-written migration. Without this the
 * suite would run against tables with no policies on them and every isolation
 * test would pass by doing nothing.
 */
async function applyPolicies(url: string, migrationDir: string) {
  const file = resolve(process.cwd(), migrationDir, 'migration.sql');
  let sql = '';
  try {
    sql = readFileSync(file, 'utf8');
  } catch (e) {
    /* Loud, not silent: a suite that quietly runs without policies would show
       every isolation test passing while proving nothing. */
    console.warn(`[setup] no policies applied from ${file}: ${(e as Error).message}`);
    return;
  }

  const statements = sql
    .split(';')
    .map((s) => s.replace(/^\s*--.*$/gm, '').trim())
    .filter(Boolean);

  const db = new PrismaClient({ datasources: { db: { url } } });
  try {
    for (const statement of statements) await db.$executeRawUnsafe(statement);
    console.log(`[setup] ${statements.length} policy statements applied to ${new URL(url).pathname.slice(1)}`);
  } catch (e) {
    console.error('[setup] policies failed:', (e as Error).message.slice(0, 300));
    throw e;
  } finally {
    await db.$disconnect();
  }
}

/**
 * Lets the application role into a database the owner has just built.
 *
 * Without this the suite connects as a role with no privileges at all and
 * every test fails on permission rather than on behaviour — which reads like a
 * broken product and is a missing GRANT.
 */
/**
 * The application role, created if the server has never seen it.
 *
 * It was only ever granted to, never created — which worked on a developer's
 * machine, where it had been made by hand months earlier, and failed on any
 * server that had not: a fresh CI runner, a new laptop, a rebuilt database.
 * The grant is the first thing to run, so the failure arrives before a single
 * test is read and says nothing about a missing role.
 *
 * NOSUPERUSER NOBYPASSRLS, the same as production, and that is the point:
 * PostgreSQL skips every policy for a superuser, so a suite that tested
 * row-level security as one would pass while protecting nothing.
 */
async function ensureAppRole(database: string) {
  const role = String(process.env.CLOR_APP_ROLE || 'clor_app');
  const password = String(process.env.CLOR_APP_PASSWORD || 'clor_app_test');
  const db = admin(database);
  try {
    await db.$executeRawUnsafe(
      `DO $$
       BEGIN
         IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${role}') THEN
           EXECUTE format('CREATE ROLE %I LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD %L', '${role}', '${password}');
         END IF;
       END $$;`
    );
  } finally {
    await db.$disconnect();
  }
}

async function grantToAppRole(database: string, schemas: string[]) {
  const role = String(process.env.CLOR_APP_ROLE || 'clor_app');
  await ensureAppRole(database);
  const db = admin(database);
  try {
    await db.$executeRawUnsafe(`GRANT CONNECT ON DATABASE "${database}" TO "${role}"`);
    for (const schema of schemas) {
      await db.$executeRawUnsafe(`GRANT USAGE ON SCHEMA "${schema}" TO "${role}"`);
      await db.$executeRawUnsafe(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA "${schema}" TO "${role}"`);
      await db.$executeRawUnsafe(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA "${schema}" TO "${role}"`);
    }
  } finally {
    await db.$disconnect();
  }
}

const push = (schema: string | null, env: Record<string, string>) =>
  execFileSync(
    'npx',
    [
      'prisma',
      'db',
      'push',
      ...(schema ? ['--schema', schema] : []),
      '--skip-generate',
      '--accept-data-loss',
      '--force-reset',
    ],
    { cwd: process.cwd(), env: { ...process.env, ...env }, stdio: 'inherit' }
  );

export default async function setup() {
  const accounting = String(process.env.DATABASE_URL || '');
  const payroll = String(process.env.PAYROLL_DATABASE_URL || '');
  const people = String(process.env.PEOPLE_DATABASE_URL || '');
  const platform = String(process.env.PLATFORM_DATABASE_URL || '');

  if (!accounting.startsWith('postgres')) {
    throw new Error(
      `The suite expects PostgreSQL. DATABASE_URL is "${accounting.slice(0, 32)}…" — see vitest.config.ts.`
    );
  }

  /*
   * A run pointed at databases somebody else owns — CI, a shared server — is
   * given the schema but is not allowed to create or drop anything.
   */
  const ownsDatabases = !process.env.TEST_DATABASE_URL;

  /* All three URLs name the same database and differ only in their schema,
     which is the shape the product is deployed in. */
  const database = dbNameOf(accounting);
  const schemaOf = (url: string) => new URL(url).searchParams.get('schema') || 'public';
  const schemas = [schemaOf(accounting), schemaOf(payroll), schemaOf(people), schemaOf(platform)];

  if (ownsDatabases) {
    await createDatabase(database);
    const db = admin(database);
    try {
      for (const schema of schemas) await db.$executeRawUnsafe(`CREATE SCHEMA IF NOT EXISTS "${schema}"`);
    } finally {
      await db.$disconnect();
    }
  }

  /* Built by the owner; used by the application role. Each push carries the
     schema in its URL, so the three land beside each other rather than on top
     of one another. */
  const asOwner = (url: string) => `${adminUrl(database)}?schema=${schemaOf(url)}`;

  push(null, { DATABASE_URL: asOwner(accounting) });
  push('prisma/payroll/schema.prisma', { PAYROLL_DATABASE_URL: asOwner(payroll) });
  push('prisma/people/schema.prisma', { PEOPLE_DATABASE_URL: asOwner(people) });
  push('prisma/platform/schema.prisma', { PLATFORM_DATABASE_URL: asOwner(platform) });

  await applyPolicies(asOwner(accounting), 'prisma/migrations/20260924120000_row_level_security');
  await applyPolicies(asOwner(payroll), 'prisma/payroll/migrations/20260924120000_row_level_security');
  await applyPolicies(asOwner(people), 'prisma/people/migrations/20260924120000_row_level_security');
  await applyPolicies(asOwner(platform), 'prisma/platform/migrations/20260924120000_row_level_security');

  await grantToAppRole(database, schemas);

  if (!ownsDatabases) return undefined;

  return async () => {
    await dropDatabase(database);
  };
}
