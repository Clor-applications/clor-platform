#!/usr/bin/env node
/**
 * The server test files a pull request should run (CI server-tests-related).
 *
 * `vitest related` follows imports all the way, and nearly every test loads
 * the whole app (app.ts imports every router), so it picks almost the full
 * suite. This picks what a person would: for each changed file under
 * server/src,
 *  - a changed test file itself;
 *  - tests that import the file directly (its path, without extension);
 *  - tests whose name contains the file's name (routes/opsDeals.ts →
 *    opsDeals.test.ts), since routes are tested through HTTP, not imports.
 * app.ts and index.ts are left out: they only wire pieces together, and
 * every test loads them.
 * Prints the test paths relative to server/, one per line. Nothing found
 * prints nothing; the nightly full run covers the rest.
 *
 * Usage: node scripts/ci/related-server-tests.mjs <changed paths relative to the repo root>...
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';

const root = new URL('../../', import.meta.url).pathname;
const testsDir = join(root, 'server/src/__tests__');
const tests = readdirSync(testsDir).filter((f) => /\.test\.(ts|mts)$/.test(f));
const bodies = new Map(tests.map((f) => [f, readFileSync(join(testsDir, f), 'utf8')]));

const picked = new Set();
for (const changed of process.argv.slice(2)) {
  if (!changed.startsWith('server/src/') || !existsSync(join(root, changed))) continue;
  const rel = changed.slice('server/src/'.length);
  if (rel.startsWith('__tests__/')) {
    const file = rel.slice('__tests__/'.length);
    if (/\.test\.(ts|mts)$/.test(file)) picked.add(file);
    else {
      /* A shared test helper (opsTestKit.ts): the tests that use it. */
      const helper = `./${file.replace(/\.(ts|mts|js)$/, '')}.js`;
      for (const f of tests) if (bodies.get(f).includes(helper)) picked.add(f);
    }
    continue;
  }
  /* Wiring only (a router mounted, a job started): every test loads it, and the new piece's own test covers it. */
  if (rel === 'app.ts' || rel === 'index.ts') continue;
  const stem = rel.replace(/\.(ts|mts|js)$/, '');
  const name = basename(stem).toLowerCase();
  const generic = ['index', 'app', 'types', 'utils', 'helpers'].includes(name);
  for (const f of tests) {
    const body = bodies.get(f);
    if (body.includes(`/${stem}.js'`) || body.includes(`/${stem}'`) || body.includes(`/${stem}.js"`)) picked.add(f);
    else if (!generic && name.length >= 4 && f.toLowerCase().includes(name)) picked.add(f);
  }
}
for (const f of [...picked].sort()) console.log(`src/__tests__/${f}`);
