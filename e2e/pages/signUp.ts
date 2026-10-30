import { expect, type Page } from '@playwright/test';

/**
 * A new person signs up and sets up a company, as from clor.in's People page
 * (/signup?app=people), and lands in People. Returns what they typed.
 */
export async function signUpForPeople(page: Page, o: { name: string; email: string; password: string; company: string; state?: string }) {
  await page.goto('/signup?app=people');
  await expect(page.getByRole('heading', { level: 1, name: 'Create your account' })).toBeVisible();
  await page.getByLabel('Your name').fill(o.name);
  await page.getByLabel('Email address').fill(o.email);
  await page.getByLabel('Password', { exact: true }).fill(o.password);
  await page.getByRole('button', { name: 'Create account' }).click();

  await page.getByLabel('Company name').fill(o.company);
  await page.getByLabel('State').selectOption(o.state || 'Karnataka');
  await page.getByRole('button', { name: 'Continue' }).click();

  /* People is already chosen, from the address. */
  await expect(page.getByRole('button', { name: /^People / })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: `Open ${o.company}` }).click();
  await expect(page).toHaveURL(/\/o\/\d{10}\//, { timeout: 30_000 });
  return o;
}
