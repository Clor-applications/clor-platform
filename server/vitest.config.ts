import { userInfo } from 'node:os';

import dotenv from 'dotenv';
import { defineConfig } from 'vitest/config';

/* The developer's own .env names the PostgreSQL server; without loading it the
   fallback below invents a URL with no user, and Prisma fails to connect with
   an error that names nothing. */
dotenv.config();

/**
 * One database per run, with a schema per application inside it.
 *
 * The product is one PostgreSQL database whose boundary between applications
 * is the schema, so the suite is shaped the same way — a test that passes
 * against three databases proves nothing about a deployment that has one.
 *
 * The database is named for this process, so two runs — a watch and a one-off,
 * two terminals, a script — cannot reset each other mid-flight, and it is
 * dropped at the end.
 *
 * Point it somewhere else with TEST_DATABASE_URL, which is how CI aims the
 * same suite at its own server.
 */
const pgBase = () => {
  /* The admin connection the run borrows to create its own databases. Taken
     from the developer's own DATABASE_URL so the suite needs no second piece
     of configuration to find the server. */
  const from =
    process.env.TEST_PG_URL ||
    process.env.DATABASE_URL ||
    `postgresql://${encodeURIComponent(userInfo().username)}@localhost:5432/postgres`;
  const url = new URL(from);
  url.pathname = '/postgres';
  url.search = '';
  return url.toString();
};

const dbName = `clor_test_${process.pid}`;

const urlFor = (schema: string) => {
  const url = new URL(pgBase());
  url.pathname = `/${dbName}`;
  url.search = `?schema=${schema}`;
  return url.toString();
};

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL || urlFor('accounting');
const TEST_PAYROLL_DATABASE_URL = process.env.TEST_PAYROLL_DATABASE_URL || urlFor('payroll');
const TEST_PEOPLE_DATABASE_URL = process.env.TEST_PEOPLE_DATABASE_URL || urlFor('people');
const TEST_PLATFORM_DATABASE_URL = process.env.TEST_PLATFORM_DATABASE_URL || urlFor('platform');

// globalSetup runs in this same process and reads them from here.
process.env.PG_ADMIN_URL = pgBase();
process.env.DATABASE_URL = TEST_DATABASE_URL;
process.env.PAYROLL_DATABASE_URL = TEST_PAYROLL_DATABASE_URL;
process.env.PEOPLE_DATABASE_URL = TEST_PEOPLE_DATABASE_URL;
process.env.PLATFORM_DATABASE_URL = TEST_PLATFORM_DATABASE_URL;

export default defineConfig({
  test: {
    environment: 'node',
    // Kills global-agent keep-alive; see the file for the port-reuse race.
    setupFiles: ['src/__tests__/setupAgent.ts'],
    // Creates this run's three databases and pushes the schemas into them.
    globalSetup: ['src/__tests__/globalSetup.ts'],
    env: {
      PG_ADMIN_URL: pgBase(),
      DATABASE_URL: TEST_DATABASE_URL,
      PAYROLL_DATABASE_URL: TEST_PAYROLL_DATABASE_URL,
      PEOPLE_DATABASE_URL: TEST_PEOPLE_DATABASE_URL,
      PLATFORM_DATABASE_URL: TEST_PLATFORM_DATABASE_URL,
      // Deterministic and fast: rate limiting is exercised by one test that
      // enables it explicitly, and 4 bcrypt rounds keep the suite quick.
      DISABLE_RATE_LIMIT: 'true',
      BCRYPT_ROUNDS: '4',
      JWT_SECRET: 'test-secret-do-not-use-in-production',
      // CI has no .env; without these jsonwebtoken rejects sign options.
      JWT_ISSUER: 'clor',
      JWT_AUDIENCE: 'clor-web',
      // Failure-path tests point at a host that does not answer; a short
      // timeout keeps them fast instead of waiting on the OS.
      SMTP_TIMEOUT_MS: '800',
    },
    include: ['src/**/*.test.ts'],
    /*
     * Still serial, though Postgres would allow otherwise.
     *
     * Many tests assert on counts within an organisation and several seed
     * global masters; running files together makes those assertions depend on
     * what another file happened to be doing. The isolation to fix that is a
     * transaction per test, which is a change to every test rather than to
     * this file.
     */
    fileParallelism: false,
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    hookTimeout: 120_000,
    testTimeout: 60_000,
  },
});
