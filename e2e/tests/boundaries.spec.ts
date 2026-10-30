/**
 * Boundaries for every person: B1–B3, and the employee's own E10–E11.
 */
import { PeopleWeb } from '../pages/people';
import { signInWeb } from '../pages/signIn';
import { allowNoise, expect, test } from '../support/fixtures';

const WEB = ['owner', 'hr', 'manager'] as const;

test.describe('What each person can and cannot reach', () => {
  test('E10: Priya sees her manager and her job details', { tag: ['@E10', '@smoke'] }, async ({ asEmployee: priya }) => {
    await priya.goto('Me');
    const job = priya.main.getByRole('region', { name: 'My job' });
    await expect(job).toContainText('Rahul Menon');
    await expect(job).toContainText('Weaver');
    await expect(job).toContainText('Production');
    await expect(job).toContainText('Head Office');
  });

  test('E11: Priya opens the HR pages by address: refused, nothing about anyone shown', { tag: ['@E11', '@smoke'] }, async ({ asEmployee: priya, w }, testInfo) => {
    allowNoise(testInfo, /401|Unauthorized/);
    for (const screen of ['employees', 'approvals', 'leaveRequests', 'settings']) {
      await priya.page.goto(`/o/${w.asha.code}/?app=people&open=${screen}`);
      await expect(priya.page.getByRole('heading', { level: 1, name: 'Sign in' })).toBeVisible();
      for (const p of Object.values(w.people)) await expect(priya.page.locator('body')).not.toContainText(p.name);
    }
  });

  for (const who of WEB) {
    test(`B1: Other Co's employee id in the address, as ${who}`, { tag: ['@B1', ...(who === 'manager' ? ['@smoke'] : [])] }, async ({ web, w }, testInfo) => {
      allowNoise(testInfo, /404|Not Found/);
      const person = await web(who);
      const zubin = w.otherPeople.zubin;
      await person.page.goto(`/o/${w.asha.code}/?app=people&open=employee&s.id=${zubin.id}`);
      await expect(person.main).toContainText(/not available|not found/i);
      await expect(person.page.locator('body')).not.toContainText(zubin.name);
      await expect(person.page.locator('body')).not.toContainText(w.other.name);
    });

    test(`B2: searching for an Other Co employee finds nothing, as ${who}`, { tag: ['@B2'] }, async ({ web, w }) => {
      const person = await web(who);
      const zubin = w.otherPeople.zubin;
      await person.goto();
      await person.open('Employees');
      await person.main.getByRole('searchbox', { name: 'Search employees' }).fill('Zubin');
      await expect(person.page).toHaveURL(/s\.q=Zubin/);
      await expect(person.main).not.toContainText(zubin.name);

      /* The search in the top bar too. */
      await person.page.getByRole('banner').getByRole('button', { name: /Search/ }).first().click();
      await person.page.keyboard.type('Zubin');
      await person.page.waitForTimeout(1_000);
      await expect(person.page.locator('body')).not.toContainText(zubin.name);
      await person.page.keyboard.press('Escape');
    });
  }

  test('B3: sign out, then Back: nothing shown, asked to sign in', { tag: ['@B3', '@smoke'] }, async ({ guest: page, w }, testInfo) => {
    allowNoise(testInfo, /401|Unauthorized/);
    /* A session of its own: signing out ends only this one. */
    await signInWeb(page, w.users.hr.email, w.password);
    const kavya = new PeopleWeb(page, w.asha, testInfo);
    await kavya.goto();
    await kavya.open('Employees');
    await expect(kavya.main).toContainText('Priya Sharma');

    await page.getByRole('banner').getByRole('button', { name: 'Sign out' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Sign in' })).toBeVisible();
    await page.goBack();
    await expect(page.getByRole('heading', { level: 1, name: 'Sign in' })).toBeVisible();
    await expect(page.locator('body')).not.toContainText('Priya Sharma');
    await page.reload();
    await expect(page.getByRole('heading', { level: 1, name: 'Sign in' })).toBeVisible();
    await expect(page.locator('body')).not.toContainText('Priya Sharma');
  });
});
