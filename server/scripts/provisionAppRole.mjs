#!/usr/bin/env node
/**
 * The role the application connects as.
 *
 * Row-level security is not enforced against a superuser. Not "usually not" —
 * never: PostgreSQL skips policies entirely for a superuser or a role with
 * BYPASSRLS, whatever the table says, FORCE or not. A local install typically
 * makes your own account a superuser, so a development database can carry a
 * full set of policies, pass a hand-written check, and be protecting nothing.
 * That is precisely what happened here: the policies were applied, and a query
 * with a deliberately wrong company still returned every row.
 *
 * So the application gets its own role, which owns nothing and bypasses
 * nothing. Migrations keep running as the owner, because a role that cannot
 * bypass RLS also cannot conveniently alter the tables it is being kept out
 * of.
 *
 *   node scripts/provisionAppRole.mjs
 *
 * Idempotent: run it after a migration that adds tables, or whenever the
 * grants look wrong. Reads PGADMIN_URL (the owner) and CLOR_APP_PASSWORD.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const env = (() => {
  try {
    const text = readFileSync(new URL('../.env', import.meta.url), 'utf8');
    const out = {};
    for (const line of text.split('\n')) {
      const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
      if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
    return out;
  } catch {
    return {};
  }
})();

const adminUrl = process.env.PGADMIN_URL || env.PGADMIN_URL;
const password = process.env.CLOR_APP_PASSWORD || env.CLOR_APP_PASSWORD;
const role = process.env.CLOR_APP_ROLE || env.CLOR_APP_ROLE || 'clor_app';

if (!adminUrl) {
  console.error('PGADMIN_URL is not set. It is the owner connection, used for grants.');
  process.exit(1);
}
if (!password) {
  console.error('CLOR_APP_PASSWORD is not set. The application role needs one.');
  process.exit(1);
}

const databases = (process.env.CLOR_DATABASES || env.CLOR_DATABASES || 'clor')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

/* One schema per application, inside the one database. The grants are per
   schema for the same reason the apps are: a role that can read every schema
   by default would make the boundary a convention again. */
const schemas = (process.env.CLOR_SCHEMAS || env.CLOR_SCHEMAS || 'accounting,payroll,people')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const psql = (db, sql) => {
  const url = new URL(adminUrl);
  url.pathname = `/${db}`;
  execFileSync('psql', ['-v', 'ON_ERROR_STOP=1', '-q', '-d', url.toString(), '-c', sql], { stdio: 'inherit' });
};

const literal = (s) => `'${String(s).replace(/'/g, "''")}'`;

/*
 * The role is cluster-wide, so it is created once against any database.
 *
 * Its attributes are set at CREATE and never re-asserted afterwards. Only a
 * superuser may change the SUPERUSER or BYPASSRLS attribute of a role — even
 * to turn them off, and even on a role it created itself — so an unconditional
 * `ALTER ROLE ... NOSUPERUSER NOBYPASSRLS` fails for the very owner role this
 * script is meant to be run as, on every run after the first. The attributes
 * are checked below instead, which is what was wanted: a statement that says
 * "make it so" and a statement that says "it is so" are worth the same when
 * they pass and very different when they do not.
 */
psql(
  databases[0],
  `DO $$
   BEGIN
     IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${role}') THEN
       EXECUTE format(
         'CREATE ROLE %I LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE PASSWORD %L',
         '${role}', ${literal(password)}
       );
     ELSE
       EXECUTE format('ALTER ROLE %I LOGIN PASSWORD %L', '${role}', ${literal(password)});
     END IF;
   END $$;`
);

/*
 * And then the part that matters, verified rather than assumed.
 *
 * Row-level security is not enforced against a superuser or a role with
 * BYPASSRLS — not "usually not": PostgreSQL skips policies entirely, whatever
 * the table says. A role that has quietly acquired either attribute turns
 * every policy in this database into decoration, and nothing else in the
 * system would notice. Fixing it needs a superuser, so this says so rather
 * than trying and failing obscurely.
 */
psql(
  databases[0],
  `DO $$
   DECLARE r record;
   BEGIN
     SELECT rolsuper, rolbypassrls INTO r FROM pg_roles WHERE rolname = '${role}';
     IF r.rolsuper OR r.rolbypassrls THEN
       RAISE EXCEPTION
         'The application role % is a superuser or has BYPASSRLS, so row-level security does not apply to it. Fix with: ALTER ROLE % NOSUPERUSER NOBYPASSRLS; (as a superuser)',
         '${role}', '${role}';
     END IF;
   END $$;`
);

for (const db of databases) {
  const perSchema = schemas
    .map(
      (schema) => `
     CREATE SCHEMA IF NOT EXISTS "${schema}";
     GRANT USAGE ON SCHEMA "${schema}" TO "${role}";
     GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA "${schema}" TO "${role}";
     GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA "${schema}" TO "${role}";
     /* Tables a later migration adds, so this does not have to be remembered. */
     ALTER DEFAULT PRIVILEGES IN SCHEMA "${schema}"
       GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO "${role}";
     ALTER DEFAULT PRIVILEGES IN SCHEMA "${schema}"
       GRANT USAGE, SELECT ON SEQUENCES TO "${role}";`
    )
    .join('\n');

  psql(db, `GRANT CONNECT ON DATABASE "${db}" TO "${role}";${perSchema}`);
  console.log(`  ${db}: ${role} may read and write ${schemas.join(', ')}, and may not bypass a policy`);
}
