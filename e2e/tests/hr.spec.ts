/**
 * HR scenarios (Kavya, desktop first): H1, H2, H4, H8, H11, H12.
 * Who each one changes: H1/H2 new people, H4 Meena, H8 Priya (from next
 * month), H11 Vikram; H12 changes nobody.
 */
import type { Page } from '@playwright/test';

import { dmy, iso, shortDate, todayIST } from '../support/dates';
import { expect, test } from '../support/fixtures';
import { choose } from '../support/ui';

/** First day of next month, and 30 days on, as dates. */
const firstOfNextMonth = () => {
  const d = todayIST();
  d.setHours(12, 0, 0, 0);
  d.setDate(1);
  d.setMonth(d.getMonth() + 1);
  return iso(d);
};
const daysFromNow = (n: number) => {
  const d = todayIST();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() + n);
  return iso(d);
};

async function wizardStep(page: Page, name: string) {
  await expect(page.locator('main').getByRole('form', { name })).toBeVisible();
}

test.describe('Kavya runs HR', () => {
  test('H1: add an employee through all four steps; back to step 1 and forward again', { tag: ['@H1', '@smoke'] }, async ({ asHR: kavya, w }, testInfo) => {
    const last = `Shetty${w.run}${testInfo.retry || ''}`;
    const email = `ravi.${w.run}${testInfo.retry || ''}@e2e.clor.test`;
    await kavya.goto();
    await kavya.open('Employees');
    await kavya.main.getByRole('button', { name: 'Add employee', exact: true }).click();
    await expect(kavya.title).toHaveText('Add employee');
    const page = kavya.page;
    const main = kavya.main;

    await wizardStep(page, 'Personal');
    await main.getByLabel('First name').fill('Ravi');
    await main.getByLabel('Last name').fill(last);
    await main.getByLabel('Work email').fill(email);
    await main.getByLabel('Phone', { exact: true }).first().fill('9845077665');
    await main.getByRole('button', { name: 'Continue' }).click();

    await wizardStep(page, 'Employment');
    const code = await main.getByLabel('Employee ID').inputValue();
    await main.getByLabel('Joining date').fill(dmy(daysFromNow(3)));
    await main.getByRole('button', { name: 'Continue' }).click();

    await wizardStep(page, 'Organisation');
    /* Farah's team: Rahul's stays the four the manager scenarios count. */
    await choose(main.getByLabel('Department'), 'Accounts');
    await choose(main.getByLabel('Designation'), 'Accounts assistant');
    await choose(main.getByLabel('Manager', { exact: true }), /Farah Reddy/);
    await main.getByRole('button', { name: 'Continue' }).click();

    await wizardStep(page, 'Review');
    const review = main.getByRole('form', { name: 'Review' });
    for (const text of [`Ravi ${last}`, email, code, 'Accounts', 'Accounts assistant', 'Farah Reddy']) await expect(review).toContainText(text);

    /* All the way back to step 1, and forward again: nothing typed is lost. */
    for (const step of ['Organisation', 'Employment', 'Personal']) {
      await main.getByRole('button', { name: 'Back' }).click();
      await wizardStep(page, step);
    }
    await expect(main.getByLabel('First name')).toHaveValue('Ravi');
    await expect(main.getByLabel('Last name')).toHaveValue(last);
    await expect(main.getByLabel('Work email')).toHaveValue(email);
    for (const step of ['Employment', 'Organisation', 'Review']) {
      await main.getByRole('button', { name: 'Continue' }).click();
      await wizardStep(page, step);
    }
    for (const text of [`Ravi ${last}`, email, code, 'Accounts', 'Accounts assistant', 'Farah Reddy']) await expect(review).toContainText(text);

    /* A double click makes one employee. */
    await main.getByRole('button', { name: 'Create employee' }).dblclick();
    await expect(kavya.title).toContainText(`Ravi ${last}`);
    await kavya.open('Employees');
    await kavya.main.getByRole('searchbox', { name: 'Search employees' }).fill(last);
    await expect(kavya.main.getByRole('button', { name: new RegExp(`^Ravi ${last}`) })).toHaveCount(1);
  });

  test('H2: a duplicate employee ID or email is stopped, in plain words', { tag: ['@H2'] }, async ({ asHR: kavya, w }, testInfo) => {
    const main = kavya.main;
    const toReview = async (o: { email: string; code?: string }) => {
      await kavya.goto('employeeNew');
      await expect(kavya.title).toHaveText('Add employee');
      await main.getByLabel('First name').fill('Dup');
      await main.getByLabel('Last name').fill(`Person${w.run}${testInfo.retry}`);
      await main.getByLabel('Work email').fill(o.email);
      await main.getByRole('button', { name: 'Continue' }).click();
      await wizardStep(kavya.page, 'Employment');
      if (o.code) await main.getByLabel('Employee ID').fill(o.code);
      await main.getByLabel('Joining date').fill(dmy(daysFromNow(3)));
      await main.getByRole('button', { name: 'Continue' }).click();
      await wizardStep(kavya.page, 'Organisation');
      await main.getByRole('button', { name: 'Continue' }).click();
      await wizardStep(kavya.page, 'Review');
      await main.getByRole('button', { name: 'Create employee' }).click();
    };

    /* Someone else's employee ID: said plainly, naming who has it, and it cannot be saved (the employee app signs people in by it). */
    await toReview({ email: `dup.${w.run}${testInfo.retry}@e2e.clor.test`, code: w.people.priya.code });
    /* Codes are printed with a non-breaking hyphen (AT‑004). */
    await expect(main.getByText(new RegExp(`${w.people.priya.name} \\(${w.people.priya.code.replace('-', '.')}\\)`)).first()).toBeVisible();
    await expect(main).toContainText('has the same employee ID');
    await expect(main.getByRole('button', { name: 'Create employee' })).toBeDisabled();
    const why = main.getByLabel(/Why is this a different person/);
    if (await why.isVisible()) {
      await why.fill('Testing whether a second AT-004 can be saved');
      await main.getByRole('button', { name: 'Create employee' }).click();
      await expect(main.getByRole('form', { name: 'Review' }), 'a duplicate employee ID is never saved').toBeVisible();
      await expect(main.getByText(/already|in use|taken/i).first()).toBeVisible();
    }

    /* Someone else's email: the same. */
    await toReview({ email: w.users.hr.email });
    await expect(main.getByText(/Kavya Nair/).first()).toBeVisible();
    await expect(main).toContainText(/same (work )?email/i);
  });

  test('H4: process Meena leaving: last day, reason, handover', { tag: ['@H4', '@smoke'] }, async ({ asHR: kavya, w }) => {
    const lastDay = daysFromNow(30);
    await kavya.goto();
    await kavya.openEmployee(w.people.meena.name);
    await kavya.main.getByRole('button', { name: 'Actions', exact: true }).click();
    await kavya.page.getByRole('menuitem', { name: 'Mark as left' }).click();
    const dialog = kavya.drawerNamed('Meena Iyer is leaving');
    await choose(dialog.getByLabel('Why'), 'Resigned');
    await dialog.getByLabel('Last working day').fill(dmy(lastDay));
    await dialog.getByLabel('Note').fill('Handover of Mysuru accounts to Arjun Das');
    await dialog.getByRole('button', { name: 'Record leaving' }).click();
    await expect(dialog).toBeHidden();

    /* On notice, with the last day; an exit checklist made. */
    await kavya.open('Leaving');
    const row = kavya.row('Meena Iyer');
    await expect(row).toBeVisible();
    await expect(row).toContainText(shortDate(lastDay));
    await kavya.openEmployee(w.people.meena.name);
    /* The status badge sits in the profile's summary band, beside the name (R&D profile, PEOPLE-03). */
    await expect(kavya.main.getByText('On notice', { exact: true }).first()).toBeVisible();
    await kavya.main.getByRole('tab', { name: 'Employment' }).click();
    await expect(kavya.main.getByRole('tabpanel')).toContainText(`${shortDate(lastDay)} · Resigned · Handover of Mysuru accounts to Arjun Das`);
    const steps = kavya.main.getByRole('region', { name: 'Leaving' });
    await expect(steps, 'an exit checklist is made').toBeVisible();
    await expect(steps.getByRole('listitem').first()).toBeVisible();
  });

  test('H8: change Priya’s department and manager from next month', { tag: ['@H8'] }, async ({ asHR: kavya, w }, testInfo) => {
    const from = firstOfNextMonth();
    await kavya.goto();
    await kavya.openEmployee(w.people.priya.name);

    await kavya.main.getByRole('button', { name: 'Actions', exact: true }).click();
    await kavya.page.getByRole('menuitem', { name: 'Transfer' }).click();
    let dialog = kavya.drawerNamed('Transfer: Priya Sharma');
    await choose(dialog.getByLabel('Department'), 'Sales');
    await dialog.getByLabel('Effective from').fill(dmy(from));
    await dialog.getByRole('button', { name: 'Confirm change' }).click();
    await expect(dialog).toBeHidden();

    await kavya.main.getByRole('button', { name: 'Actions', exact: true }).click();
    await kavya.page.getByRole('menuitem', { name: 'Change manager' }).click();
    dialog = kavya.drawerNamed('Change manager: Priya Sharma');
    await choose(dialog.getByLabel('New manager'), /Neha Joshi/);
    await dialog.getByLabel('Effective from').fill(dmy(from));
    await dialog.getByRole('button', { name: 'Confirm change' }).click();
    await expect(dialog).toBeHidden();

    /* Today she is still in Production under Rahul; Job changes shows both, from and to, dated. */
    await expect(kavya.main.getByRole('list', { name: 'Summary' })).toContainText('Production');
    await expect(kavya.main.getByRole('list', { name: 'Summary' })).toContainText('Rahul Menon');
    await kavya.open('Job changes');
    await expect(kavya.row('Priya Sharma', 'Department')).toContainText(/Production → Sales/);
    await expect(kavya.row('Priya Sharma', 'Department')).toContainText(shortDate(from));
    await expect(kavya.row('Priya Sharma', 'Manager')).toContainText(/Rahul Menon → Neha Joshi/);
    await expect(kavya.row('Priya Sharma', 'Manager')).toContainText(shortDate(from));
  });

  test('H11: the same employee edited in two tabs: the second save is refused', { tag: ['@H11', '@smoke'] }, async ({ asHR: kavya, w }) => {
    const second = await kavya.page.context().newPage();
    const url = `/o/${w.asha.code}/?app=people&open=employee&s.id=${w.people.vikram.id}`;
    for (const p of [kavya.page, second]) {
      await p.goto(url);
      await p.getByRole('main').getByRole('button', { name: 'Edit profile', exact: true }).click();
      await expect(p.getByRole('main').getByLabel('Preferred name')).toBeVisible();
    }
    await kavya.main.getByLabel('Preferred name').fill('Vicky');
    await kavya.main.getByRole('button', { name: 'Save' }).click();
    /*
     * The first save has landed: the form is gone and the record shows the new name.
     * Not "Save is hidden": the button reads "Saving…" while the request is out, so that
     * passed at once and the second tab's save raced the first (CI run 41184412669).
     */
    await expect(kavya.main.getByLabel('Preferred name')).toBeHidden();
    await expect(kavya.main.getByRole('tabpanel')).toContainText('Vicky');

    const other = second.getByRole('main');
    await other.getByLabel('Preferred name').fill('Vik');
    await other.getByRole('button', { name: 'Save' }).click();
    await expect(second.getByText(/someone else changed|changed by someone|changed since you opened|reload/i).filter({ visible: true }).first()).toBeVisible();

    await kavya.page.reload();
    await kavya.main.getByRole('tab', { name: 'Personal' }).click();
    await expect(kavya.main.getByRole('tabpanel')).toContainText('Vicky');
    await expect(kavya.main.getByRole('tabpanel')).not.toContainText(/\bVik\b/);
  });

  test('H12: a table\'s head row sits above its first row and sticks under the bar', { tag: ['@H12'] }, async ({ asHR: kavya }) => {
    await kavya.goto();
    /* A short window, so the page has room to scroll past the list's top with five departments. */
    await kavya.page.setViewportSize({ width: 700, height: 300 });
    await kavya.openSetting('Departments');
    const m = await kavya.page.evaluate(() => {
      window.scrollTo(0, 0);
      const th = document.querySelector('#main-content .ui-table thead th')!;
      const td = document.querySelector('#main-content .ui-table tbody tr td')!;
      const bar = document.querySelector('header')!.getBoundingClientRect().bottom;
      const top = th.getBoundingClientRect().top;
      const bottom = th.getBoundingClientRect().bottom;
      const row = td.getBoundingClientRect().top;
      window.scrollTo(0, top - bar + 8);
      return { bottom, row, bar, stuck: th.getBoundingClientRect().top, wide: th.closest('.ui-table-scroll')!.hasAttribute('data-wide') };
    });
    expect(m.wide, 'Departments fits 700px, so the page does the scrolling').toBe(false);
    expect(m.bottom, 'head row above the first row').toBeLessThanOrEqual(m.row + 1);
    expect(Math.abs(m.stuck - m.bar), 'head row stays under the bar').toBeLessThanOrEqual(2);
  });
});
