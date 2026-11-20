/**
 * Public surface of live CLOR, no sign-in: API health, every page of the
 * marketing site (followed link by link), and each portal's front door.
 */
import { expect, test } from '@playwright/test';
import { SITES } from './lib/env';
import { renderIssues, saveVisits, shotPath, watch, type Issue, type Visit } from './lib/monitor';

const MAX_PAGES = Number(process.env.QA_MAX_PAGES || 120);

test('API: health and safe refusals', async ({ request }) => {
  const visits: Visit[] = [];
  const checks: Array<[string, number[]]> = [
    ['/ready', [200]],
    ['/health', [200]],
    ['/api/auth/me', [401]],
    ['/api/does-not-exist-qa', [401, 404]],
  ];
  for (const [path, want] of checks) {
    const t0 = Date.now();
    const r = await request.get(SITES.api + path, { failOnStatusCode: false });
    const issues: Issue[] = [];
    if (!want.includes(r.status())) issues.push({ kind: 'http', where: path, detail: `got ${r.status()}, expected ${want.join(' or ')}` });
    if (path === '/ready') {
      const body = await r.json().catch(() => ({}));
      for (const [k, v] of Object.entries(body.checks || {})) if (v !== true) issues.push({ kind: 'check', where: path, detail: `${k} not ready` });
    }
    const ms = Date.now() - t0;
    if (ms > 3000) issues.push({ kind: 'check', where: path, detail: `slow: ${ms} ms` });
    visits.push({ portal: 'api', path, title: String(r.status()), ms, ok: issues.length === 0, issues });
  }
  saveVisits('public-api', visits);
  expect(visits.filter((v) => !v.ok).map((v) => v.issues)).toEqual([]);
});

test('Marketing site: every page reachable by links', async ({ page }) => {
  const w = watch(page);
  const host = new URL(SITES.marketing).host;
  const queue = [SITES.marketing + '/'];
  const seen = new Set<string>();
  const visits: Visit[] = [];
  while (queue.length && visits.length < MAX_PAGES) {
    const url = queue.shift()!;
    const key = url.replace(/#.*$/, '').replace(/\/$/, '');
    if (seen.has(key)) continue;
    seen.add(key);
    const path = new URL(url).pathname;
    w.start(path);
    const t0 = Date.now();
    const resp = await page.goto(url, { waitUntil: 'networkidle' }).catch((e) => e as Error);
    const ms = Date.now() - t0;
    const issues: Issue[] = [];
    if (resp instanceof Error) issues.push({ kind: 'http', where: path, detail: resp.message.split('\n')[0] });
    else if (resp && resp.status() >= 400) issues.push({ kind: 'http', where: path, detail: `page returned ${resp.status()}` });
    issues.push(...(await renderIssues(page, path)), ...w.take());
    const shot = shotPath(`marketing${path}`);
    await page.screenshot({ path: shot, fullPage: false }).catch(() => {});
    visits.push({ portal: 'marketing', path, title: await page.title().catch(() => ''), ms, ok: issues.length === 0, issues, screenshot: shot });
    const links = await page.$$eval('a[href]', (as) => as.map((a) => (a as HTMLAnchorElement).href)).catch(() => [] as string[]);
    for (const l of links) {
      try {
        const u = new URL(l);
        if (u.host === host && !/\.(pdf|png|jpe?g|svg|zip)$/i.test(u.pathname) && !seen.has(l.replace(/#.*$/, '').replace(/\/$/, ''))) queue.push(u.origin + u.pathname);
      } catch { /* mailto:, tel: */ }
    }
  }
  saveVisits('public-marketing', visits);
  expect(visits.length).toBeGreaterThan(3);
});

const PORTALS: Array<[string, string]> = [
  ['app', SITES.app], ['app /signin', SITES.app + '/signin'], ['books', SITES.books], ['ops', SITES.ops],
  ['people', SITES.people], ['payroll', SITES.payroll], ['attendance', SITES.attendance],
];

test('Portals: front door loads and offers a sign-in', async ({ page }) => {
  const w = watch(page);
  const visits: Visit[] = [];
  for (const [name, url] of PORTALS) {
    w.start(name);
    const t0 = Date.now();
    await page.goto(url, { waitUntil: 'load' }).catch(() => {});
    await page.waitForTimeout(4000);
    const ms = Date.now() - t0;
    const issues = [...(await renderIssues(page, name))];
    const hasForm = await page.locator('input[type="password"], input[type="email"], button:has-text("Sign in"), a:has-text("Sign in")').first().isVisible().catch(() => false);
    if (!hasForm) issues.push({ kind: 'check', where: name, detail: `no sign-in form or link on ${page.url()}` });
    /* Signed out, every app asks "who am I?" and is told no: expected, not a bug. */
    issues.push(...w.take().filter((i) => !/auth\/(me|refresh)|status of 40[01]/.test(i.detail)));
    const shot = shotPath(`portal-${name}`);
    await page.screenshot({ path: shot }).catch(() => {});
    visits.push({ portal: name.split(' ')[0], path: new URL(page.url()).pathname, title: await page.title(), ms, ok: issues.length === 0, issues, screenshot: shot });
  }
  saveVisits('public-portals', visits);
});
