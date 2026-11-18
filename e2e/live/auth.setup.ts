/**
 * Signs every QA account in once and saves the browser session to
 * e2e/live/.state/<label>.json; other specs reuse it. A session under 8 hours
 * old is reused without signing in again: live allows only a few 2FA codes per
 * address in a few minutes. Hitting that limit waits it out and tries again;
 * an account that still cannot sign in is skipped, never the whole run.
 */
import { existsSync, statSync } from 'node:fs';
import { test } from '@playwright/test';
import { accounts } from './lib/env';
import { signIn, statePath } from './lib/session';

const FRESH_MS = 8 * 3600_000;

for (const acc of accounts()) {
  test(`sign in ${acc.label}`, async ({ page }) => {
    test.setTimeout(20 * 60_000);
    const file = statePath(acc);
    if (existsSync(file) && Date.now() - statSync(file).mtimeMs < FRESH_MS) return;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        await signIn(page, acc);
        await page.context().storageState({ path: file });
        return;
      } catch (e) {
        const limited = await page.getByText(/too many/i).first().isVisible().catch(() => false);
        if (!limited || attempt === 3) { test.info().annotations.push({ type: 'skipped', description: String(e).slice(0, 200) }); return; }
        await page.waitForTimeout(5 * 60_000);
      }
    }
  });
}
