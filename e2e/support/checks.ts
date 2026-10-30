/**
 * The checks every page visit gets, without a test asking (wired in by
 * fixtures.ts; a test only ever sees them fail):
 *
 *   while the test runs   no console error, no uncaught exception or
 *                         unhandled rejection, no 5xx answer from the API
 *   on every screen       no horizontal scroll at phone width; axe finds no
 *   (app.open, and the    serious or critical problem that is not in the
 *    page the test ends    baseline; the page title is the menu label that
 *    on)                   is lit
 *
 * Known problems (e2e/known-issues.json) are listed per screen and check
 * ("people:approvals::sideways-scroll", "people:employees::color-contrast")
 * so they do not block day one. Each entry is a debt: fix the screen, then
 * delete its line. E2E_KNOWN_UPDATE=1 records what a run finds in
 * e2e/.state/found.jsonl instead of failing; `node e2e/scripts/known-issues.mjs`
 * folds that into the file.
 */
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import { expect, type Page, type TestInfo } from '@playwright/test';

const require = createRequire(import.meta.url);
const AXE = require.resolve('axe-core/axe.min.js');
const KNOWN_FILE = fileURLToPath(new URL('../known-issues.json', import.meta.url));
const FOUND_FILE = fileURLToPath(new URL('../.state/found.jsonl', import.meta.url));

type Known = { entries: Record<string, string> };
let knownFile: Known | null = null;
const known = () => (knownFile ??= JSON.parse(readFileSync(KNOWN_FILE, 'utf8')) as Known).entries;

/** A problem found on a screen: failed, or (E2E_KNOWN_UPDATE=1) written down, unless it is a known one. */
function report(problems: string[], key: string, check: string, text: string, device: string) {
  const id = `${key}::${check}`;
  const entries = known();
  if (entries[id] || entries[`${id}@${device}`] || entries[`*::${check}`]) return;
  if (process.env.E2E_KNOWN_UPDATE === '1') {
    mkdirSync(fileURLToPath(new URL('../.state/', import.meta.url)), { recursive: true });
    appendFileSync(FOUND_FILE, `${JSON.stringify({ id: check === 'sideways-scroll' || check === 'title-is-menu-label' ? `${id}@${device}` : id, text })}\n`);
    return;
  }
  problems.push(`${key}: ${text}`);
}

/** Which screen a page shows: People's ?open=<key>, the employee app's tab, or the path. */
export async function screenKey(page: Page) {
  const u = new URL(page.url());
  if (u.hash.startsWith('#/portal')) {
    const tab = await page.getByRole('navigation', { name: 'Portal' }).locator('[aria-current="page"], [aria-pressed="true"]').first().textContent({ timeout: 500 }).catch(() => null);
    return `portal:${(tab || 'signin').trim().toLowerCase()}`;
  }
  const app = u.searchParams.get('app');
  const open = u.searchParams.get('open');
  if (app) return `${app}:${open || 'home'}`;
  return u.pathname.replace(/\/o\/\d{10}/, '/o/:company') || '/';
}

/* ------------------------------------------------------------- live watch */

export type Watch = { problems: string[]; allowed: RegExp[] };

/** Console errors, uncaught errors and 5xx answers, on every page the context opens. */
export function watchPage(page: Page, watch: Watch) {
  const allowed = (text: string) => watch.allowed.some((re) => re.test(text));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const text = m.text();
    /* A 4xx the app expected (a refused page, a stale save) shows as a resource error; 5xx is caught below. */
    if (/Failed to load resource: the server responded with a status of 4\d\d/.test(text)) return;
    if (!allowed(text)) watch.problems.push(`console error: ${text.slice(0, 300)}`);
  });
  page.on('pageerror', (e) => {
    const text = `${e.name}: ${e.message}`;
    if (!allowed(text)) watch.problems.push(`uncaught: ${text.slice(0, 300)}`);
  });
  page.on('response', (r) => {
    if (r.status() < 500) return;
    const text = `${r.status()} ${r.request().method()} ${r.url().replace(/^https?:\/\/[^/]+/, '')}`;
    if (!allowed(text)) watch.problems.push(`server error: ${text}`);
  });
}

/* ------------------------------------------------------------- per screen */

/** The three screen checks. Called by app.open() after each screen settles, and on the page a test ends on. */
export async function auditScreen(page: Page, testInfo: TestInfo, opts: { title?: boolean } = {}) {
  if (page.isClosed() || !/^https?:/.test(page.url())) return;
  const key = await screenKey(page);
  const device = (page.viewportSize()?.width || 1440) < 768 ? 'phone' : 'desktop';
  const problems: string[] = [];

  /* 1. No sideways scroll on a phone: a wide table may scroll inside itself, the page may not. */
  const vw = page.viewportSize()?.width || 0;
  if (vw && vw < 768) {
    const wide = await page.evaluate(() => {
      const el = document.scrollingElement || document.documentElement;
      return { scroll: el.scrollWidth, client: el.clientWidth };
    });
    if (wide.scroll > wide.client + 1) report(problems, key, 'sideways-scroll', `the page scrolls sideways at ${vw}px (${wide.scroll}px wide)`, device);
  }

  /* 2. The page title is the menu label that is lit (where a menu is on screen). Not the breadcrumb (it names the
        group), and not the phone's bottom bar (it carries short labels on purpose: "Leave" for Leave requests). */
  if (opts.title !== false) {
    const lit = await page.locator('nav:not([aria-label="Breadcrumb"]):not([aria-label$="quick navigation"]) [aria-current="page"]:visible').first().textContent({ timeout: 300 }).catch(() => null);
    const h1 = await page.locator('main h1:visible').first().textContent({ timeout: 300 }).catch(() => null);
    /* Home greets the person by name instead ("Good afternoon, Rahul"), by design. */
    if (lit && h1 && lit.trim() !== 'Home' && lit.trim() !== h1.trim()) report(problems, key, 'title-is-menu-label', `the page title "${h1.trim()}" is not the menu label "${lit.trim()}"`, device);
  }

  /* 3. axe: serious and critical, minus the known list. On a still page: a fade half-way through reads as low contrast. */
  await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running'), null, { timeout: 3_000 }).catch(() => null);
  await page.addScriptTag({ path: AXE }).catch(() => null);
  const found: Array<{ id: string; impact: string; help: string; nodes: string[] }> = await page
    .evaluate(async () => {
      const axe = (window as any).axe;
      if (!axe) return [];
      const r = await axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] }, resultTypes: ['violations'] });
      return r.violations
        .filter((v: any) => (v.impact === 'serious' || v.impact === 'critical') && !v.tags.includes('experimental'))
        .map((v: any) => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.slice(0, 3).map((n: any) => String(n.target)) }));
    })
    .catch(() => []);
  for (const v of found) report(problems, key, v.id, `accessibility (${v.impact}) ${v.id} — ${v.help} at ${v.nodes.join(' | ')}`, device);

  if (problems.length) {
    await testInfo.attach(`screen checks ${key}`, { body: problems.join('\n'), contentType: 'text/plain' });
  }
  expect.soft(problems, `screen checks on ${key}`).toEqual([]);
}
