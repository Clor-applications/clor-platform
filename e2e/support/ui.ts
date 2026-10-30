import { expect, type Locator } from '@playwright/test';

/** Picks an option in a select, whether it is a native <select> or the app's own pop-up list. */
export async function choose(field: Locator, label: string | RegExp) {
  const tag = await field.evaluate((el) => el.tagName);
  if (tag === 'SELECT') {
    if (typeof label === 'string') await field.selectOption({ label });
    else {
      const options = await field.locator('option').allTextContents();
      const hit = options.find((o) => label.test(o));
      expect(hit, `an option matching ${label}`).toBeTruthy();
      await field.selectOption({ label: hit! });
    }
    return;
  }
  await field.click();
  await field.page().getByRole('option', { name: label }).first().click();
}
