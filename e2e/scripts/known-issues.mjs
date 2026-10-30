/**
 * Folds what a run with E2E_KNOWN_UPDATE=1 found (e2e/.state/found.jsonl)
 * into e2e/known-issues.json, so known screen problems stop failing tests
 * while they wait to be fixed. Existing lines are kept; new ones are added
 * with what was seen. Review the diff before committing: every line is a
 * problem someone has agreed to live with for now.
 *
 *   E2E_KNOWN_UPDATE=1 npm run e2e && node e2e/scripts/known-issues.mjs
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const file = fileURLToPath(new URL('../known-issues.json', import.meta.url));
const found = fileURLToPath(new URL('../.state/found.jsonl', import.meta.url));

const known = JSON.parse(readFileSync(file, 'utf8'));
if (!existsSync(found)) {
  console.log('Nothing found: e2e/.state/found.jsonl does not exist (run with E2E_KNOWN_UPDATE=1 first).');
  process.exit(0);
}
let added = 0;
for (const line of readFileSync(found, 'utf8').split('\n').filter(Boolean)) {
  const { id, text } = JSON.parse(line);
  if (known.entries[id]) continue;
  known.entries[id] = String(text).replace(/ at .*$/, '').slice(0, 200);
  added += 1;
}
known.entries = Object.fromEntries(Object.entries(known.entries).sort(([a], [b]) => a.localeCompare(b)));
writeFileSync(file, `${JSON.stringify(known, null, 2)}\n`);
console.log(`${added} new known issue(s) written to e2e/known-issues.json (${Object.keys(known.entries).length} in all).`);
