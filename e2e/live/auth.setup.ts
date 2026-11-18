/**
 * Signs every QA account in once, one after another, and saves the browser
 * session to e2e/live/.state/<label>.json. Every other spec reuses it, so no
 * two tests ever spend the same 2FA code (a code works once).
 */
import { test } from '@playwright/test';
import { accounts } from './lib/env';
import { signIn, statePath } from './lib/session';

for (const acc of accounts()) {
  test(`sign in ${acc.label}`, async ({ page }) => {
    await signIn(page, acc);
    await page.context().storageState({ path: statePath(acc) });
  });
}
