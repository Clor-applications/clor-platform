/**
 * The API for a local end-to-end run: a fresh database, migrated the way
 * production is (`prisma migrate deploy`, all four schemas), then the server.
 *
 * Started by Playwright's webServer (e2e/playwright.config.mjs) and stopped by
 * it at the end. The database is dropped and built again at every start, so a
 * run never sees the last one's data; it is left in place afterwards for
 * looking into a failure (CI drops it in its own step).
 *
 * Only this run's database and port are touched. Nothing else is stopped.
 */
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { apiPort, baseURL, dbName, dbUrl, jobsToken, pgAdminUrl } from './env.mjs';

const server = fileURLToPath(new URL('../../server/', import.meta.url));

const env = {
  ...process.env,
  NODE_ENV: 'development',
  PORT: String(apiPort),
  DATABASE_URL: dbUrl('accounting'),
  PAYROLL_DATABASE_URL: dbUrl('payroll'),
  PEOPLE_DATABASE_URL: dbUrl('people'),
  PLATFORM_DATABASE_URL: dbUrl('platform'),
  /* Local test values for this throwaway database only. */
  JWT_SECRET: process.env.E2E_JWT_SECRET || 'e2e-local-jwt-secret-not-for-any-real-use-000000',
  JWT_ISSUER: 'clor',
  JWT_AUDIENCE: 'clor-web',
  MAIL_SECRET_KEY: process.env.E2E_MAIL_SECRET_KEY || Buffer.alloc(32, 7).toString('base64'),
  APP_URL: baseURL,
  CORS_ORIGIN: baseURL,
  /* Six people sign in at the start of every run, from one address. */
  DISABLE_RATE_LIMIT: 'true',
  BCRYPT_ROUNDS: '4',
  /* The world's owners and admins have no authenticator app; production keeps this on for new companies (services/policy.ts). */
  NEW_COMPANY_ADMIN_TWO_FACTOR: 'off',
  /* Sign-ins saved once at the start stay good for the whole run, so parallel tests never race to refresh one session. */
  JWT_EXPIRES_IN: '12h',
  PRISMA_HIDE_UPDATE_MESSAGE: '1',
  RECURRING_SCHEDULER: 'off',
  /* Lets a scenario wake a background job now (e2e/tests/money-and-rules.spec.ts, R2). */
  JOBS_TOKEN: jobsToken,
};

const run = (cmd, args, opts = {}) => {
  const r = spawnSync(cmd, args, { cwd: server, env, stdio: 'inherit', ...opts });
  if (r.status !== 0) {
    console.error(`[e2e api] ${cmd} ${args.join(' ')} failed (${r.status})`);
    process.exit(r.status || 1);
  }
};

const psql = (sql) => run('psql', [pgAdminUrl, '-v', 'ON_ERROR_STOP=1', '-qc', sql]);

const started = Date.now();
if (process.env.E2E_KEEP_DB !== '1') {
  console.log(`[e2e api] fresh database ${dbName}`);
  psql(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
  psql(`CREATE DATABASE "${dbName}"`);
}
if (process.env.E2E_SKIP_GENERATE !== '1') run('npm', ['run', '--silent', 'prisma:generate'], { stdio: ['ignore', 'ignore', 'inherit'] });
for (const schema of ['prisma/schema.prisma', 'prisma/payroll/schema.prisma', 'prisma/people/schema.prisma', 'prisma/platform/schema.prisma']) {
  run('npx', ['prisma', 'migrate', 'deploy', '--schema', schema], { stdio: ['ignore', 'ignore', 'inherit'] });
}
console.log(`[e2e api] migrated in ${Math.round((Date.now() - started) / 1000)}s; starting on ${apiPort}`);

const child = spawn('npx', ['tsx', 'src/index.ts'], { cwd: server, env, stdio: 'inherit' });
const stop = (signal) => () => child.kill(signal);
process.on('SIGTERM', stop('SIGTERM'));
process.on('SIGINT', stop('SIGINT'));
child.on('exit', (code) => process.exit(code ?? 0));
