#!/usr/bin/env node
/**
 * Fails when a schema.prisma and its migrations have drifted apart (O-12).
 *
 * For each of the four schemas it replays the migrations into a throwaway
 * shadow database and asks Prisma what it would take to reach the schema file:
 *
 *   prisma migrate diff --from-migrations <dir> --to-schema-datamodel <schema>
 *                       --shadow-database-url <url> --exit-code
 *
 * Exit 0 is clean. Anything else is drift: a column, default or index one side
 * has and the other does not, which `migrate deploy` would never fix and
 * `db push` (the test suite) would paper over.
 *
 * One known difference is allowed, and only that one: the accounting schema's
 * migrations still create the platform tables (accounts, organisations, users,
 * branches…) that moved to the platform schema. Their old copies are retained
 * for recovery on purpose (migration 20261022130000_platform_reference_boundary),
 * so the diff's DROP TABLE for them, and the DROP CONSTRAINT between them, is
 * expected. Any other statement in that diff still fails the check.
 *
 * Usage: SHADOW_DATABASE_URL=postgresql://user:pass@host:5432/db node scripts/checkMigrationDrift.mjs
 * The database is reset by Prisma; point it at one that holds nothing.
 */
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const server = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const base = process.env.SHADOW_DATABASE_URL || process.argv[2];
if (!base) {
  console.error('Set SHADOW_DATABASE_URL (or pass it as the first argument) to an empty PostgreSQL database.');
  process.exit(1);
}

const schemas = [
  { name: 'accounting', migrations: 'prisma/migrations', schema: 'prisma/schema.prisma' },
  { name: 'payroll', migrations: 'prisma/payroll/migrations', schema: 'prisma/payroll/schema.prisma' },
  { name: 'people', migrations: 'prisma/people/migrations', schema: 'prisma/people/schema.prisma' },
  { name: 'platform', migrations: 'prisma/platform/migrations', schema: 'prisma/platform/schema.prisma' },
];

/* Platform tables whose stale accounting copies are kept for recovery. */
const RETAINED_IN_ACCOUNTING = new Set([
  'Account', 'AccountEntitlement', 'AuditLog', 'AuthEvent', 'AuthPolicy', 'AuthProvider', 'Branch',
  'EmailOutbox', 'EmailSetting', 'EmailVerificationToken', 'FeatureSetting', 'NotificationSetting', 'Org',
  'PasswordResetToken', 'Permission', 'Role', 'RolePermission', 'RoleProfile', 'RoleProfileRole', 'Session',
  'User', 'UserBranchMembership', 'UserOrgMembership', 'UserPermission', 'UserRoleAssignment', 'UserRoleProfile',
  'UserWarehouseAccess',
]);

const allowed = (name, statement) => {
  if (name !== 'accounting') return false;
  const m = statement.match(/^(?:DROP TABLE "([^"]+)"|ALTER TABLE "([^"]+)" DROP CONSTRAINT "[^"]+")$/);
  return Boolean(m && RETAINED_IN_ACCOUNTING.has(m[1] || m[2]));
};

const withSchema = (url, schema) => {
  const u = new URL(url);
  u.searchParams.set('schema', schema);
  return u.toString();
};

let failed = false;
for (const s of schemas) {
  const run = spawnSync(
    resolve(server, 'node_modules/.bin/prisma'),
    ['migrate', 'diff', '--from-migrations', s.migrations, '--to-schema-datamodel', s.schema, '--shadow-database-url', withSchema(base, s.name), '--script', '--exit-code'],
    { cwd: server, encoding: 'utf8' }
  );
  if (run.status === 0) {
    console.log(`${s.name}: schema and migrations agree`);
    continue;
  }
  if (run.status !== 2) {
    failed = true;
    console.error(`${s.name}: prisma migrate diff failed (exit ${run.status})\n${run.stderr || run.stdout}`);
    continue;
  }
  const statements = run.stdout
    .replace(/^\s*--.*$/gm, '')
    .split(';')
    .map((x) => x.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  const drift = statements.filter((x) => !allowed(s.name, x));
  if (!drift.length) {
    console.log(`${s.name}: schema and migrations agree (retained legacy tables only)`);
    continue;
  }
  failed = true;
  console.error(`${s.name}: schema.prisma and ${s.migrations} have drifted. To bring the database to the schema it would take:\n${drift.map((x) => `  ${x};`).join('\n')}\nAdd a migration, or fix schema.prisma, so they agree.`);
}
process.exit(failed ? 1 : 0);
