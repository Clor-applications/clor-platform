/**
 * Applies outstanding migrations to every schema, as the owner.
 *
 * Two things this has to get right, and both are about who is connected.
 *
 * **The role.** The application connects as `clor_app`, which owns nothing and
 * cannot bypass row-level security — that is the whole point of it. A role
 * that cannot bypass RLS also cannot conveniently alter the tables it is being
 * kept out of, so migrations run as the owner instead, built here from
 * PGADMIN_URL. Running them as the application role fails halfway through with
 * a permission error, which is a worse way to learn this than a sentence.
 *
 * **The schema.** One database, one schema per application. Prisma is told
 * which schema through the connection URL, so "apply the payroll migrations"
 * means running with an owner URL that carries `?schema=payroll` — not with
 * whatever `PAYROLL_DATABASE_URL` happens to say, which is the application's
 * credentials.
 *
 * Safe on a brand-new database and on one already migrated: `migrate deploy`
 * applies what is missing and says so when there is nothing to do. Run after
 * this, not before: scripts/provisionAppRole.mjs, which grants the application
 * role access to whatever the migrations have just created.
 */
import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// This package is ESM, so __dirname has to be derived.
const HERE = dirname(fileURLToPath(import.meta.url));
const SERVER_ROOT = resolve(HERE, '..');

/** The applications, in the order a failure should stop at. */
const APPS = [
  { name: 'accounting', schemaFile: 'prisma/schema.prisma', runtimeVar: 'DATABASE_URL' },
  { name: 'payroll', schemaFile: 'prisma/payroll/schema.prisma', runtimeVar: 'PAYROLL_DATABASE_URL' },
  { name: 'people', schemaFile: 'prisma/people/schema.prisma', runtimeVar: 'PEOPLE_DATABASE_URL' },
] as const;

const need = (name: string, why: string) => {
  const value = String(process.env[name] || '').trim();
  if (!value) {
    console.error(`${name} is not set. ${why}`);
    process.exit(1);
  }
  return value;
};

/**
 * The owner's connection, pointed at one application's schema.
 *
 * The database name is taken from the application's own URL rather than from
 * PGADMIN_URL, which points at `postgres` — the maintenance database every
 * cluster has, and the one place a migration must not land.
 */
const ownerUrlFor = (admin: string, runtime: string, schema: string) => {
  const url = new URL(admin);
  url.pathname = new URL(runtime).pathname;
  url.search = `?schema=${schema}`;
  return url.toString();
};

function main() {
  const admin = need(
    'PGADMIN_URL',
    'It is the owner connection — the role that may create tables. The application role cannot.'
  );

  for (const app of APPS) {
    const runtime = need(
      app.runtimeVar,
      `${app.name} keeps its tables in its own schema — add it to the environment file (see server/.env.example).`
    );

    /*
     * A schema Prisma has not been given is a schema it creates on first
     * connect, unowned by anything the grants know about. Saying it here means
     * the failure is "no such schema" at migration time rather than an empty
     * set of books at run time.
     */
    const declared = new URL(runtime).searchParams.get('schema');
    if (declared !== app.name) {
      console.error(
        `${app.runtimeVar} points at schema "${declared || '(none)'}", not "${app.name}". ` +
          'One schema per application is the boundary between them.'
      );
      process.exit(1);
    }

    console.log(`\nApplying ${app.name} migrations.`);
    if (app.name === 'accounting') {
      /*
       * The first production attempt of this migration reached PostgreSQL with
       * SQLite SQL and Prisma recorded it as failed before any data changed.
       * Clear only that known record so the corrected, transactional migration
       * below can run. Once applied, `resolve --rolled-back` exits non-zero and
       * is deliberately ignored on later deployments.
       */
      try {
        execFileSync(
          'npx',
          ['prisma', 'migrate', 'resolve', '--rolled-back', '20260926000000_resequence_customer_codes', '--schema', app.schemaFile],
          {
            cwd: SERVER_ROOT,
            stdio: 'pipe',
            env: {
              ...process.env,
              DATABASE_URL: ownerUrlFor(admin, runtime, app.name),
            },
          }
        );
        console.log('Recovered the interrupted customer-code migration.');
      } catch {
        // No failed record exists; normal deploy handling continues below.
      }
    }
    execFileSync('npx', ['prisma', 'migrate', 'deploy', '--schema', app.schemaFile], {
      cwd: SERVER_ROOT,
      stdio: 'inherit',
      env: {
        ...process.env,
        /* Prisma reads the URL named in the datasource block of each schema
           file, so all three are set to this one application's owner URL —
           the other two are not used by this invocation. */
        DATABASE_URL: ownerUrlFor(admin, runtime, app.name),
        PAYROLL_DATABASE_URL: ownerUrlFor(admin, runtime, app.name),
        PEOPLE_DATABASE_URL: ownerUrlFor(admin, runtime, app.name),
      },
    });
  }

  console.log('\nEvery schema is up to date.');
}

main();
