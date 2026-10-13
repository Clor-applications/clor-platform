/**
 * Refuse to run migrations when two datasources point at the same database.
 *
 * Each Prisma schema owns its own database. If PLATFORM_DATABASE_URL is set to the
 * accounting URL by mistake, `migrate deploy --schema platform` runs against
 * clor_main, fails on "relation Account already exists", and leaves a failed row
 * in clor_main's _prisma_migrations — which then blocks every later deploy
 * (P3009). This check runs first and stops before anything is written.
 *
 * Enforced in production. In development the platform tables may deliberately
 * share the accounting schema, so a collision is only a warning there.
 * Never prints a URL — only which variable names collide.
 */
const NAMES = ['DATABASE_URL', 'PAYROLL_DATABASE_URL', 'PEOPLE_DATABASE_URL', 'PLATFORM_DATABASE_URL'];
const strict = process.env.NODE_ENV === 'production';

const target = (raw) => {
  try {
    const u = new URL(raw);
    const host = u.hostname.replace('-pooler.', '.');
    return `${host}:${u.port || 5432}/${u.pathname.replace(/^\//, '')}#${u.searchParams.get('schema') || 'public'}`;
  } catch {
    return null;
  }
};

const problems = [];
const seen = new Map();
for (const name of NAMES) {
  const raw = process.env[name];
  if (!raw) { problems.push(`${name} is not set`); continue; }
  const t = target(raw);
  if (!t) { problems.push(`${name} is not a valid URL`); continue; }
  if (seen.has(t)) problems.push(`${name} points at the same database as ${seen.get(t)}`);
  else seen.set(t, name);
}

if (problems.length) {
  const msg = `[checkDatabaseUrls] ${problems.join('; ')}.`;
  if (strict) {
    console.error(`${msg} Refusing to run migrations. Fix the environment and redeploy.`);
    process.exit(1);
  }
  console.warn(`${msg} (development: continuing)`);
}
