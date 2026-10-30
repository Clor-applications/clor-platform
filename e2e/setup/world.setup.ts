/**
 * Builds this device's world (API, setup only) and signs every persona in
 * through the real sign-in screens once, saving each browser state for the
 * tests: owner, hr, manager on the web; app-<person> on the employee app.
 */
import { expect, test as setup } from '@playwright/test';

import { seed } from '../support/seed';
import { authFile, deviceOf } from '../support/world';
import { signInApp, signInWeb } from '../pages/signIn';

setup('build the world and sign everyone in', { tag: '@smoke' }, async ({ browser }, testInfo) => {
  setup.setTimeout(180_000);
  const device = deviceOf(testInfo.project.name);
  const w = await seed(device);

  for (const persona of ['owner', 'hr', 'manager'] as const) {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await signInWeb(page, w.users[persona].email, w.password);
    await expect(page).toHaveURL(new RegExp(`/o/${w.asha.code}/`));
    await ctx.storageState({ path: authFile(device, persona) });
    await ctx.close();
  }

  for (const who of Object.keys(w.appUsers)) {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await signInApp(page, w.appUsers[who].company, w.appUsers[who].code, w.password);
    await ctx.storageState({ path: authFile(device, `app-${who}`) });
    await ctx.close();
  }
});
