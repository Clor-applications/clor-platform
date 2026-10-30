import { expect, type Page } from '@playwright/test';

/** The CLOR sign-in screen (/signin), as a person uses it. */
export async function signInWeb(page: Page, email: string, password: string) {
  await page.goto('/signin');
  await page.getByLabel('Email or username').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/o\/\d{10}\//, { timeout: 30_000 });
}

/**
 * The employee app's sign-in (#/portal): company code, employee code,
 * password. The privacy notice is read once, the first time, as an employee
 * would; it is not shown again after that.
 */
export async function signInApp(page: Page, company: string, employeeCode: string, password: string) {
  await page.goto('/#/portal');
  await page.getByLabel('Company code').fill(company);
  await page.getByLabel('Employee code').fill(employeeCode);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  const tabs = page.getByRole('navigation', { name: 'Portal' });
  await expect(tabs).toBeVisible({ timeout: 30_000 });
  const notice = page.getByRole('button', { name: 'I have read this' });
  if (await notice.isVisible()) {
    await notice.click();
    await expect(notice).toBeHidden();
  }
}
