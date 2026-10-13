#!/usr/bin/env node
/**
 * Puts the generated Prisma clients where the compiled code looks for them.
 *
 * Accounting's client is a package — `@prisma/client` — and needs nothing.
 * Payroll's and People's are not: each schema generates into
 * `src/generated/<app>`, because two clients cannot share one package name,
 * and `src/utils/payrollPrisma.ts` imports `../generated/payroll/index.js`.
 *
 * That import compiles to `dist/utils/payrollPrisma.js` reaching for
 * `dist/generated/payroll/index.js` — and tsc does not put it there. tsc
 * compiles TypeScript; the generated client is JavaScript that was never
 * TypeScript, so it is not in `include`, not emitted, and not copied. The
 * build therefore succeeded, the tests passed (they run the TypeScript
 * directly through tsx) and the API died on its first import in production:
 *
 *   ERR_MODULE_NOT_FOUND  file:///opt/clor/server/dist/generated/payroll/index.js
 *
 * A build that cannot start is a build that did not finish, so finishing it
 * is part of `npm run build` rather than a step in the deploy — the deploy is
 * not the only thing that builds.
 */

import { cpSync, existsSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SERVER_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FROM = join(SERVER_ROOT, 'src/generated');
const TO = join(SERVER_ROOT, 'dist/generated');

if (!existsSync(FROM)) {
  console.error(
    'No src/generated — run `npm run prisma:generate` before building, or the API will start without\n' +
      'a payroll client and fail on the first payroll request.'
  );
  process.exit(1);
}

const apps = readdirSync(FROM, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name);

if (!apps.length) {
  console.error('src/generated is empty. Run `npm run prisma:generate`.');
  process.exit(1);
}

/* Replaced rather than merged: a client left over from a schema that has
   since changed is worse than none, because it runs. */
cpSync(FROM, TO, { recursive: true, force: true });

console.log(`  generated clients copied into dist: ${apps.join(', ')}`);
