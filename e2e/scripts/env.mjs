/**
 * Where the end-to-end run points, read from the environment once.
 *
 * Two targets:
 *   local (default)  the run boots its own API and web app on E2E_API_PORT and
 *                    E2E_WEB_PORT against a database of its own (dropped and
 *                    migrated fresh at the start of every run).
 *   staging          E2E_TARGET=staging, E2E_BASE_URL and E2E_API_URL name a
 *                    deployed app; nothing is booted. Credentials only ever
 *                    come from environment variables (see e2e/README.md).
 */
import { userInfo } from 'node:os';

const env = process.env;

export const target = env.E2E_TARGET === 'staging' ? 'staging' : 'local';
export const isCI = Boolean(env.CI);

export const webPort = Number(env.E2E_WEB_PORT || 5196);
export const apiPort = Number(env.E2E_API_PORT || 4016);

/** The database a local run builds. Postgres 5432 locally; CI passes its own (5434). */
export const dbName = env.E2E_DB_NAME || 'clor_e2e';
export const pgAdminUrl = env.E2E_PGADMIN_URL || `postgresql://${encodeURIComponent(userInfo().username)}@localhost:5432/postgres`;

export const dbUrl = (schema) => {
  const u = new URL(pgAdminUrl);
  u.pathname = `/${dbName}`;
  u.search = '';
  /* Several coders and CI shards share one Postgres: keep this run's pool small. */
  return `${u.toString()}?schema=${schema}&connection_limit=5&pool_timeout=20`;
};

export const baseURL = target === 'staging' ? required('E2E_BASE_URL') : `http://127.0.0.1:${webPort}`;

/* The run signs up accounts and changes data: never against production by mistake. */
if (target === 'staging' && !/staging/.test(baseURL) && env.E2E_ALLOW_HOST !== new URL(baseURL).host) {
  throw new Error(`E2E_BASE_URL ${baseURL} does not look like staging. Set E2E_ALLOW_HOST=${new URL(baseURL).host} if it really is a test environment.`);
}
/** The API, for test-data setup only (TEAM.md: never to check a result). */
export const apiURL = target === 'staging' ? required('E2E_API_URL') : `http://127.0.0.1:${apiPort}/api`;

/**
 * The wake call for background jobs (POST /internal/jobs/tick), so a scenario that
 * waits on an hourly job (the missing-punch notice, R2) runs it now. A local run sets
 * its own throwaway value on the API it boots; staging only with E2E_JOBS_TOKEN.
 */
export const jobsToken = env.E2E_JOBS_TOKEN || (target === 'local' ? 'e2e-local-jobs-token-not-for-any-real-use' : '');

function required(name) {
  const v = env[name];
  if (!v) throw new Error(`${name} must be set for E2E_TARGET=staging (see e2e/README.md).`);
  return v.replace(/\/+$/, '');
}
