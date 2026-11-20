/**
 * One test per QA account, in one browser, signed in once:
 *   crawl (every module and screen) → scenarios for its role → forms (owners).
 * One browser per login on purpose: CLOR's refresh cookie works once, so two
 * browsers sharing a login sign each other out.
 */
import { test } from '@playwright/test';
import { accounts } from './lib/env';
import { crawlAs } from './lib/crawl';
import { formsAs, formsFor } from './lib/forms';
import { scenariosAs } from './lib/scenarios';
import { signIn } from './lib/session';

const accs = accounts();
test.skip(accs.length === 0, 'No QA_ACCOUNTS in e2e/live/.env.live');

for (const acc of accs) {
  test(`${acc.label} (${(acc as any).role || 'owner'})`, async ({ page }) => {
    test.setTimeout(90 * 60_000);
    for (let attempt = 1; ; attempt++) {
      try { await signIn(page, acc); break; } catch (e) {
        const limited = await page.getByText(/too many/i).first().isVisible().catch(() => false);
        if (!limited || attempt >= 4) throw e;
        await page.waitForTimeout(5 * 60_000);
      }
    }
    if (process.env.QA_SKIP_CRAWL !== '1') await test.step('crawl', () => crawlAs(page, acc));
    await test.step('scenarios', () => scenariosAs(page, acc));
    if (formsFor(acc)) await test.step('forms', () => formsAs(page, acc));
  });
}
