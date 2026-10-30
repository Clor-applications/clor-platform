/**
 * Writes docs/people/qa/E2E-RESULTS.md from the last run's JSON report
 * (e2e/report/results.json): one row per scenario ID, its result on desktop
 * and phone, and the note on a known app bug.
 *
 *   PASS       passed as written
 *   FLAKY      passed only on the retry (CI); look at it
 *   KNOWN BUG  marked test.fail() because the app is wrong, and still wrong
 *   FIXED?     marked test.fail() but passed: the bug may be fixed; drop the mark
 *   FAIL       failed
 *   SKIP       not run in this run
 *
 *   npm run e2e:report        (after npm run e2e or e2e:smoke)
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const reportFile = fileURLToPath(new URL('../report/results.json', import.meta.url));
const out = fileURLToPath(new URL('../../docs/people/qa/E2E-RESULTS.md', import.meta.url));
const report = JSON.parse(readFileSync(reportFile, 'utf8'));

const rows = new Map();
const walk = (suite) => {
  for (const spec of suite.specs || []) {
    for (const t of spec.tests || []) {
      if (!['desktop', 'phone'].includes(t.projectName)) continue;
      const id = (spec.tags || []).map((x) => x.replace(/^@/, '')).find((x) => /^[A-Z]+\d+$/.test(x)) || spec.title.split(':')[0];
      const last = t.results[t.results.length - 1];
      const failNote = (t.annotations || []).find((a) => a.type === 'fail')?.description || '';
      const appNotes = t.results.flatMap((r) => r.annotations || []).concat(t.annotations || []).filter((a) => a.type === 'app-note').map((a) => a.description);
      let result = 'SKIP';
      if (last && last.status !== 'skipped') {
        if (t.expectedStatus === 'failed') result = last.status === 'failed' ? 'KNOWN BUG' : 'FIXED?';
        else if (last.status === 'passed') result = t.results.length > 1 ? 'FLAKY' : 'PASS';
        else result = 'FAIL';
      }
      const key = `${id}|${spec.title}`;
      const row = rows.get(key) || { id, title: spec.title.replace(/^[A-Z]+\d+:\s*/, ''), desktop: '–', phone: '–', notes: new Set() };
      row[t.projectName] = result;
      if (failNote && result !== 'PASS') row.notes.add(failNote.replace(/^APP BUG:\s*/, ''));
      for (const n of appNotes) row.notes.add(n);
      rows.set(key, row);
    }
  }
  for (const s of suite.suites || []) walk(s);
};
for (const s of report.suites || []) walk(s);

const order = (id) => {
  const m = id.match(/^([A-Z]+)(\d+)$/);
  const group = ['E', 'M', 'H', 'A', 'B', 'T'].indexOf(m?.[1] ?? 'Z');
  return [group < 0 ? 99 : group, Number(m?.[2] || 0)];
};
const sorted = [...rows.values()].sort((a, b) => {
  const [ga, na] = order(a.id);
  const [gb, nb] = order(b.id);
  return ga - gb || na - nb || a.title.localeCompare(b.title);
});

const stats = report.stats || {};
const started = stats.startTime ? new Date(stats.startTime) : new Date();
const minutes = stats.duration ? (stats.duration / 60000).toFixed(1) : '?';
const count = (r) => sorted.reduce((n, row) => n + (row.desktop === r) + (row.phone === r), 0);

const lines = [
  '# People end-to-end results',
  '',
  `Last run: ${started.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' })} IST, ${minutes} minutes. ` +
    `Written by \`npm run e2e:report\` from the Playwright run (e2e/README.md); do not edit by hand.`,
  '',
  `PASS ${count('PASS')} · KNOWN BUG ${count('KNOWN BUG')} · FLAKY ${count('FLAKY')} · FIXED? ${count('FIXED?')} · FAIL ${count('FAIL')} (desktop and phone counted separately).`,
  '',
  'Scenario IDs are those of [PERSONA-SCENARIOS.md](PERSONA-SCENARIOS.md); T1–T4 are hiring, referrals, shift swaps and request types, which have no number there yet.',
  '',
  '| Scenario | What | Desktop | Phone | Note |',
  '|---|---|---|---|---|',
  ...sorted.map((r) => `| ${r.id} | ${r.title.replace(/\|/g, '/')} | ${r.desktop} | ${r.phone} | ${[...r.notes].join(' ').replace(/\|/g, '/')} |`),
  '',
];
writeFileSync(out, lines.join('\n'));
console.log(`Wrote docs/people/qa/E2E-RESULTS.md: ${sorted.length} scenarios.`);
