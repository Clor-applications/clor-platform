#!/usr/bin/env node
/** Merges e2e/live/report/raw/*.json into e2e/live/report/REPORT.md (plain words, for the owner). */
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const raw = join(here, 'report', 'raw');
const visits = existsSync(raw) ? readdirSync(raw).filter((f) => f.endsWith('.json')).flatMap((f) => JSON.parse(readFileSync(join(raw, f), 'utf8'))) : [];
const failed = visits.filter((v) => !v.ok);
const by = (arr, k) => arr.reduce((m, x) => ((m[x[k]] ||= []).push(x), m), {});

/* Group identical problems (same kind + detail) so one broken API shows once with every screen it broke. */
const problems = {};
for (const v of failed) for (const i of v.issues) {
  const key = `${i.kind}|${i.detail.replace(/\/\d{6,}/g, '/:id')}`;
  (problems[key] ||= { kind: i.kind, detail: i.detail, where: new Set() }).where.add(`${v.portal}${v.account ? ` (${v.account})` : ''}: ${v.path}`);
}
const ranked = Object.values(problems).sort((a, b) => b.where.size - a.where.size);

let md = `# CLOR live QA report\n\n${new Date().toISOString().replace('T', ' ').slice(0, 16)} UTC\n\n`;
md += `**${visits.length - failed.length} of ${visits.length} checks passed, ${failed.length} failed, ${ranked.length} distinct problems.**\n\n`;
md += `| Portal | Checks | Failed |\n|---|---:|---:|\n`;
for (const [p, vs] of Object.entries(by(visits, 'portal'))) md += `| ${p} | ${vs.length} | ${vs.filter((v) => !v.ok).length} |\n`;
md += `\n## Problems (most widespread first)\n\n`;
if (!ranked.length) md += 'None.\n';
for (const p of ranked) {
  md += `- **${p.kind}**: \`${p.detail}\`\n  - on ${p.where.size}: ${[...p.where].slice(0, 8).join('; ')}${p.where.size > 8 ? ' …' : ''}\n`;
}
md += `\n## Every check\n\n| | Portal | Where | ms | Screenshot |\n|---|---|---|---:|---|\n`;
for (const v of visits) md += `| ${v.ok ? 'pass' : 'FAIL'} | ${v.portal}${v.account ? ` (${v.account})` : ''} | ${v.path} | ${v.ms} | ${v.screenshot ? `[shot](${relative(join(here, 'report'), v.screenshot)})` : ''} |\n`;
writeFileSync(join(here, 'report', 'REPORT.md'), md);
console.log(`Report: e2e/live/report/REPORT.md — ${visits.length - failed.length}/${visits.length} passed, ${ranked.length} problems`);
