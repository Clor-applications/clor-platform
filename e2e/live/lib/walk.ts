import type { Page } from '@playwright/test';
import { SITES } from './env';
import { DANGER } from './monitor';

/** Visits every rail module and panel screen of one app, calling onScreen on each. */
export async function walkApp(page: Page, app: keyof typeof SITES, onScreen: (name: string) => Promise<void>) {
  await page.goto(SITES[app] + '/', { waitUntil: 'networkidle' }).catch(() => {});
  await onScreen('home');
  const rail = page.locator('nav[aria-label$="modules"] button');
  const nMods = await rail.count();
  for (let i = 0; i < nMods; i++) {
    const mod = rail.nth(i);
    const modName = (await mod.innerText().catch(() => '')).trim().split('\n')[0] || `module ${i + 1}`;
    if (DANGER.test(modName) || !(await mod.isVisible().catch(() => false))) continue;
    await mod.click().catch(() => {});
    await page.waitForLoadState('networkidle').catch(() => {});
    const screens = page.locator('nav[aria-label$="screens"] button, nav[aria-label$="screens"] a');
    const nScr = await screens.count();
    if (nScr === 0) { await onScreen(modName); continue; }
    for (let j = 0; j < nScr; j++) {
      const s = screens.nth(j);
      const sName = (await s.innerText().catch(() => '')).trim().split('\n')[0] || `screen ${j + 1}`;
      if (DANGER.test(sName) || !(await s.isVisible().catch(() => false))) continue;
      await s.click().catch(() => {});
      await page.waitForLoadState('networkidle').catch(() => {});
      await onScreen(`${modName} › ${sName}`);
    }
  }
}
