/**
 * Owner / admin scenarios (Suresh): A1, A3, A4, A7.
 * A1 and A7 sign a brand-new person up through the real screens; A3 and A4
 * use the seeded Asha Textiles and Vels Traders.
 */
import { PeopleWeb } from '../pages/people';
import { signUpForPeople } from '../pages/signUp';
import { dmy, shortDate, weekday } from '../support/dates';
import { allowNoise, expect, test } from '../support/fixtures';
import { choose } from '../support/ui';


const newOwner = (w: { run: string; password: string }, tag: string, retry: number) => ({
  name: 'Lalitha Rao',
  email: `${tag}.${w.run}${retry}@e2e.clor.test`,
  password: w.password,
  company: `${tag === 'solo' ? 'Lalitha Tailoring' : 'Ganga Silks'} ${w.run}${retry}`,
});

test.describe('Suresh owns the account', () => {
  test('A1: first sign-in after sign-up lands in People, ready for the first employee', { tag: ['@A1', '@smoke'] }, async ({ guest: page, w }, testInfo) => {
    const me = await signUpForPeople(page, newOwner(w, 'first', testInfo.retry));
    const people = new PeopleWeb(page, { name: me.company, orgId: '', branchId: '', code: (page.url().match(/\/o\/(\d{10})\//) || [])[1] || '' }, testInfo);
    await expect(page.getByRole('button', { name: /People: switch app/ }), 'lands in People').toBeVisible();

    /* Nothing to configure first: Add employee opens straight away and asks only for the person. */
    await people.open('Employees');
    await people.main.getByRole('button', { name: 'Add employee', exact: true }).click();
    await expect(people.title).toHaveText('Add employee');
    await expect(people.main.getByRole('form', { name: 'Personal' })).toBeVisible();
    await expect(people.main, 'no set-up step stands in the way').not.toContainText(/set up .* first|before you can add|configure/i);
  });

  test('A3: Kavya has HR access and Rahul team-manager access, and each sees exactly that', { tag: ['@A3', '@smoke'] }, async ({ asOwner: suresh, asHR: kavya, asManager: rahul }) => {
    /* Settings → Users & security opens Workspace; Access → Users lists who holds which role. */
    await suresh.goto();
    await suresh.open('Settings');
    await suresh.main.getByRole('button', { name: /^Users & security/ }).click();
    await expect(suresh.page).toHaveURL(/app=admin/);
    if (suresh.isPhone) await suresh.page.getByRole('banner').getByRole('button', { name: 'Menu' }).click();
    await suresh.page.getByRole('button', { name: 'Access', exact: true }).first().click();
    await suresh.page.getByRole('button', { name: 'Users', exact: true }).first().click();
    await suresh.settle();
    await expect(suresh.row('Kavya Nair')).toContainText('HR Manager');
    await expect(suresh.row('Rahul Menon')).toContainText('Team Manager');

    /* Kavya: everyone, and may add people. */
    await kavya.goto();
    await kavya.open('Employees');
    await expect(kavya.main.getByRole('button', { name: /Working now/ })).toContainText('12');
    await expect(kavya.main.getByRole('button', { name: 'Add employee', exact: true })).toBeVisible();

    /* Rahul: himself and his four, nothing to add, no company settings. */
    await rahul.goto();
    await rahul.open('Employees');
    await expect(rahul.main.getByRole('button', { name: /Working now/ })).toContainText('5');
    await expect(rahul.main.getByRole('tab', { name: /My team/ })).toContainText('4');
    await expect(rahul.main.getByRole('button', { name: 'Add employee', exact: true })).toHaveCount(0);
    for (const name of ['Arjun Das', 'Meena Iyer', 'Kavya Nair', 'Farah Reddy']) await expect(rahul.main).not.toContainText(name);
  });

  test('A4: switch to Vels Traders: only Vels’s people, nothing of Asha’s', { tag: ['@A4', '@smoke'] }, async ({ asOwner: suresh, w }, testInfo) => {
    allowNoise(testInfo, /404|Not Found/);
    await suresh.goto();
    await suresh.open('Employees');
    await expect(suresh.main).toContainText('Priya Sharma');

    await suresh.switchCompany(w.vels.name);
    await expect(suresh.page).toHaveURL(new RegExp(`/o/${w.vels.code}/`));
    const vels = new PeopleWeb(suresh.page, w.vels, testInfo);
    await vels.open('Employees');
    await expect(vels.main).toContainText('Velmurugan Sekar');
    await expect(vels.main).toContainText('Selvi Raman');
    for (const p of Object.values(w.people)) await expect(vels.main).not.toContainText(p.name);

    /* Search, the address, and Back: still nothing of Asha's. */
    await vels.main.getByRole('searchbox', { name: 'Search employees' }).fill('Priya');
    await expect(vels.main.getByRole('button', { name: /^Priya Sharma/ })).toHaveCount(0);
    await suresh.page.goto(`/o/${w.vels.code}/?app=people&open=employee&s.id=${w.people.priya.id}`);
    await expect(vels.main).toContainText(/not available|not found/i);
    await expect(vels.main).not.toContainText('Priya Sharma');
    await suresh.page.goBack();
    await expect(suresh.page.getByRole('banner').getByRole('combobox', { name: 'Company' })).toHaveValue(/.+/);
    await expect(vels.main).not.toContainText('Priya Sharma');
  });

  test('A7: a one-person business does everything alone', { tag: ['@A7'] }, async ({ guest: page, w }, testInfo) => {
    const me = await signUpForPeople(page, newOwner(w, 'solo', testInfo.retry));
    const code = (page.url().match(/\/o\/(\d{10})\//) || [])[1] || '';
    const people = new PeopleWeb(page, { name: me.company, orgId: '', branchId: '', code }, testInfo);

    /* She puts herself on the employee list. */
    await people.open('Employees');
    await people.main.getByRole('button', { name: 'Add employee', exact: true }).click();
    await people.main.getByLabel('First name').fill('Lalitha');
    await people.main.getByLabel('Last name').fill('Rao');
    await people.main.getByLabel('Work email').fill(me.email);
    await people.main.getByLabel('Work email').press('Tab');
    await people.main.getByRole('button', { name: 'Continue' }).click();
    await people.main.getByLabel('Joining date').fill('01/04/2024');
    await people.main.getByRole('button', { name: 'Continue' }).click();
    await people.main.getByRole('button', { name: 'Continue' }).click();
    await expect(people.main.getByRole('form', { name: 'Review' })).toContainText(me.email);
    await people.main.getByRole('button', { name: 'Create employee' }).click();
    await expect(people.title).toContainText('Lalitha Rao');

    /* A leave type of her own, from the usual ones. */
    await people.open('Settings');
    await people.main.getByRole('button', { name: /^Leave policy/ }).click();
    await expect(people.title).toHaveText('Leave policy');
    await people.main.getByRole('button', { name: 'Casual Leave', exact: true }).click();
    const typeForm = people.page.getByRole('dialog').last();
    await typeForm.getByRole('button', { name: /^(Save|Add|Create)/ }).last().click();
    await expect(people.row('Casual Leave')).toBeVisible();

    /* Her own leave: asked, and decided, with nobody else in the company. */
    const from = weekday(2 + testInfo.retry, 1);
    await people.openMine('My leave');
    /* Seen on some runs: My leave still says no file is linked right after she added herself, until the page reloads. Noted, not hidden. */
    const ask0 = people.main.getByRole('button', { name: 'Ask for leave' });
    const unlinked = people.main.getByText('No employee file is linked to your sign-in');
    await expect(ask0.or(unlinked).first()).toBeVisible();
    if (await unlinked.isVisible()) {
      testInfo.annotations.push({ type: 'app-note', description: 'My leave said "No employee file is linked" right after she added herself with her sign-in email; a reload fixed it.' });
      await people.page.reload();
    }
    await people.main.getByRole('button', { name: 'Ask for leave' }).click();
    const ask = people.drawerNamed('Ask for leave');
    await choose(ask.getByLabel('Leave type'), 'Casual Leave');
    await ask.getByLabel('First day').fill(dmy(from));
    await ask.getByLabel('Reason').fill('Supplier visit in Surat');
    await ask.getByRole('button', { name: 'Send' }).click();
    await expect(ask).toBeHidden();

    /* (A phone's list shows the date, not the reason.) */
    const mine = people.row(people.isPhone ? shortDate(from) : 'Supplier visit in Surat');
    await expect(mine).toContainText(/Waiting|Approved/);
    if (!/Approved/.test((await mine.textContent()) || '')) {
      /* Nobody above her: she decides it herself, from Approvals or from Leave requests. */
      await people.open('Approvals');
      const inbox = people.row('Lalitha Rao', /Casual Leave/);
      if (await inbox.isVisible()) {
        await (await people.approve('Lalitha Rao', /Casual Leave/)).click();
      } else {
        await people.open('Leave requests');
        /* Her request's row (Casual Leave, capitalised as the type is), not the "Recent activity" line beside the list. */
        const row = people.row('Lalitha Rao', /Casual Leave/);
        const opener = row.getByRole('button', { name: /Lalitha Rao/ });
        await ((await opener.count()) ? opener.first() : row).click();
        await people.page.getByRole('dialog').getByRole('button', { name: 'Approve' }).click();
      }
      /* Decided before moving on: the panel closes and the request leaves the waiting list. */
      await expect(people.page.getByRole('dialog')).toHaveCount(0);
      await people.settle();
      await people.openMine('My leave');
    }
    await expect(mine).toContainText('Approved');
  });
});
