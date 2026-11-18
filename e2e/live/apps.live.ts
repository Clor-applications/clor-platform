/**
 * Signed-in crawl: for every QA account in .env.live, sign in once, then open
 * each app it can use and click every module in the rail and every screen in
 * the module's panel. Records console errors, failed API calls, blank or crashed
 * screens, and a screenshot of each. Never clicks anything outside navigation,
 * and never a control whose label matches DANGER.
 */
import { test } from '@playwright/test';
import { accounts, SITES } from './lib/env';
import { DANGER, renderIssues, saveVisits, shotPath, watch, type Visit } from './lib/monitor';
import { signIn } from './lib/session';

const accs = accounts();
const DEFAULT_APPS = ['app', 'people', 'payroll', 'attendance', 'books'] as const;

test.skip(accs.length === 0, 'No QA_ACCOUNTS in e2e/live/.env.live: signed-in crawl skipped');

for (const acc of accs) {
  test(`Crawl as ${acc.label}`, async ({ page }) => {
    const w = watch(page);
    const visits: Visit[] = [];
    w.start('sign-in');
    await signIn(page, acc);
    const apps = (acc as any).apps || (acc.site === 'ops' ? ['ops'] : DEFAULT_APPS);
    for (const app of apps) {
      const base = SITES[app as keyof typeof SITES];
      w.start(`${app} home`);
      const t0 = Date.now();
      await page.goto(base + '/', { waitUntil: 'networkidle' }).catch(() => {});
      await record(app, 'home', t0);
      const rail = page.locator('nav[aria-label$="modules"] button');
      const nMods = await rail.count();
      for (let i = 0; i < nMods; i++) {
        const mod = rail.nth(i);
        const modName = (await mod.innerText().catch(() => '')).trim().split('\n')[0] || `module ${i + 1}`;
        if (DANGER.test(modName) || !(await mod.isVisible().catch(() => false))) continue;
        w.start(`${app} › ${modName}`);
        const t1 = Date.now();
        await mod.click().catch(() => {});
        await page.waitForLoadState('networkidle').catch(() => {});
        await record(app, modName, t1);
        const screens = page.locator('nav[aria-label$="screens"] button, nav[aria-label$="screens"] a');
        const nScr = await screens.count();
        for (let j = 0; j < nScr; j++) {
          const s = screens.nth(j);
          const sName = (await s.innerText().catch(() => '')).trim().split('\n')[0] || `screen ${j + 1}`;
          if (DANGER.test(sName) || !(await s.isVisible().catch(() => false))) continue;
          w.start(`${app} › ${modName} › ${sName}`);
          const t2 = Date.now();
          await s.click().catch(() => {});
          await page.waitForLoadState('networkidle').catch(() => {});
          await record(app, `${modName} › ${sName}`, t2);
        }
      }
    }
    saveVisits(`crawl-${acc.label}`, visits);

    async function record(app: string, name: string, t0: number) {
      const ms = Date.now() - t0;
      await page.waitForTimeout(400);
      const where = `${app} › ${name}`;
      const issues = [...(await renderIssues(page, where)), ...w.take()];
      if (ms > 8000) issues.push({ kind: 'check', where, detail: `slow screen: ${ms} ms` });
      const shot = shotPath(`${acc.label}-${app}-${name}`);
      await page.screenshot({ path: shot }).catch(() => {});
      visits.push({ portal: app, account: acc.label, path: name, title: new URL(page.url()).pathname, ms, ok: issues.length === 0, issues, screenshot: shot });
    }
  });
}
