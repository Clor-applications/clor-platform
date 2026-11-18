import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath as __f } from 'node:url';
const __dirname = __f(new URL('.', import.meta.url));
import { join } from 'node:path';
import type { Page } from '@playwright/test';

export type Issue = { kind: 'console' | 'pageerror' | 'http' | 'requestfailed' | 'render' | 'check'; where: string; detail: string };
export type Visit = { portal: string; account?: string; path: string; title: string; ms: number; ok: boolean; issues: Issue[]; screenshot?: string };

/* Noise that is not a CLOR bug: analytics blockers, browser extensions, favicons. */
const IGNORE = [/favicon/i, /chrome-extension:/, /google-analytics|googletagmanager|clarity\.ms|cloudflareinsights/i, /net::ERR_ABORTED/];

/** Records console errors, uncaught errors, 4xx/5xx and failed requests for one page. */
export function watch(page: Page) {
  let bucket: Issue[] = [];
  let where = '';
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const t = m.text();
    if (IGNORE.some((r) => r.test(t))) return;
    bucket.push({ kind: 'console', where, detail: t.slice(0, 400) });
  });
  page.on('pageerror', (e) => bucket.push({ kind: 'pageerror', where, detail: String(e.message || e).slice(0, 400) }));
  page.on('response', (r) => {
    const s = r.status();
    if (s < 400) return;
    const u = r.url();
    if (IGNORE.some((x) => x.test(u))) return;
    bucket.push({ kind: 'http', where, detail: `${s} ${r.request().method()} ${u.split('?')[0]}` });
  });
  page.on('requestfailed', (r) => {
    const f = r.failure()?.errorText || '';
    if (IGNORE.some((x) => x.test(f) || x.test(r.url()))) return;
    bucket.push({ kind: 'requestfailed', where, detail: `${f} ${r.url().split('?')[0]}` });
  });
  return {
    start(w: string) { where = w; bucket = []; },
    take(): Issue[] { const b = bucket; bucket = []; return b; },
  };
}

/** Screen-level checks every page must pass: something rendered, no crash screen. */
export async function renderIssues(page: Page, where: string): Promise<Issue[]> {
  const out: Issue[] = [];
  const text = (await page.locator('body').innerText({ timeout: 5000 }).catch(() => '')).trim();
  if (text.length < 20) out.push({ kind: 'render', where, detail: 'page is blank (under 20 characters of text)' });
  const crash = text.match(/something went wrong|unexpected error|cannot read propert|is not a function|undefined is not|failed to fetch|404 not found|page not found/i);
  if (crash) out.push({ kind: 'render', where, detail: `error text on screen: "${crash[0]}"` });
  return out;
}

const RAW = join(__dirname, '..', 'report', 'raw');
const SHOTS = join(__dirname, '..', 'report', 'shots');

export function shotPath(name: string) {
  mkdirSync(SHOTS, { recursive: true });
  return join(SHOTS, name.replace(/[^a-z0-9-]+/gi, '_').slice(0, 120) + '.png');
}

/** Each spec writes its visits here; report.mjs merges them. */
export function saveVisits(name: string, visits: Visit[]) {
  mkdirSync(RAW, { recursive: true });
  writeFileSync(join(RAW, name.replace(/[^a-z0-9-]+/gi, '_') + '.json'), JSON.stringify(visits, null, 2));
}

/** Labels the crawler never clicks: anything that removes, pays, ends or signs out. */
export const DANGER = /sign ?out|log ?out|delete|remove|cancel|void|revoke|deactivate|suspend|terminate|pay now|payment|billing|checkout|upgrade|reset|archive|end (link|access)|disable/i;
