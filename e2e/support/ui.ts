import { expect, type Locator } from '@playwright/test';

/**
 * Picks an option in a select, whether it is a native <select> or the app's own pop-up list.
 *
 * Waits for what a person waits for: the field to be usable (a form keeps it
 * disabled while its choices load) and, for the pop-up list, the option to be
 * there; a list opened before its choices arrived is opened again. On a busy
 * runner the choices came after the click and the option never showed (M8).
 */
export async function choose(field: Locator, label: string | RegExp) {
  await expect(field).toBeEnabled();
  const tag = await field.evaluate((el) => el.tagName);
  if (tag === 'SELECT') {
    if (typeof label === 'string') {
      await expect(field.locator('option', { hasText: label }).first()).toBeAttached();
      await field.selectOption({ label });
    } else {
      await expect.poll(async () => (await field.locator('option').allTextContents()).some((o) => label.test(o)), { message: `an option matching ${label}` }).toBe(true);
      const options = await field.locator('option').allTextContents();
      await field.selectOption({ label: options.find((o) => label.test(o))! });
    }
    return;
  }
  const page = field.page();
  const option = page.getByRole('option', { name: label }).first();
  /* Pressed again only when its list is shut: pressing an open list closes it. */
  const isOpen = async () => (await field.getAttribute('aria-expanded')) === 'true' || (await page.getByRole('listbox').first().isVisible());
  await expect(async () => {
    if (!(await option.isVisible()) && !(await isOpen())) await field.click();
    await expect(option).toBeVisible({ timeout: 3_000 });
  }).toPass({ timeout: 20_000 });
  await option.click();
}
