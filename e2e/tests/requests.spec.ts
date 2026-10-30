/**
 * Talent hiring, referrals, a shift swap and a custom request (request
 * type), one task each, done by the person who would do it. These have no
 * scenario number in PERSONA-SCENARIOS.md yet; their IDs here are T1–T4.
 * (Expense claims are not on main yet: PR #77.)
 */
import { as, auth } from '../support/api';
import { auditScreen } from '../support/checks';
import { appDay, workdayFromNow } from '../support/dates';
import { expect, test } from '../support/fixtures';
import type { World } from '../support/world';

async function apiAs(w: World, who: 'hr' | 'owner' = 'hr') {
  const { token } = await auth.login(w.users[who].email, w.password);
  return as({ token, orgId: w.asha.orgId, branchId: w.asha.branchId });
}

test.describe('Hiring, referrals, swaps and requests', () => {
  test('T1: Kavya opens a job to take candidates', { tag: ['@T1', '@hiring', '@smoke'] }, async ({ asHR: kavya, w }, testInfo) => {
    const job = `Loom operator ${w.run}${testInfo.retry}`;
    await kavya.goto();
    await kavya.open('Job openings');
    await kavya.main.getByRole('button', { name: 'New opening' }).first().click();
    const sheet = kavya.drawerNamed('New opening');
    await sheet.getByRole('combobox', { name: /^Job/ }).fill(job);
    await sheet.getByLabel('Places').fill('2');
    await sheet.getByLabel('About the job').fill('Run two power looms on the day shift.');
    await sheet.getByRole('checkbox', { name: /Open it now/ }).check();
    await sheet.getByRole('button', { name: 'Open', exact: true }).click();
    await expect(sheet).toBeHidden();
    await expect(kavya.row(job)).toBeVisible();
    await expect(kavya.row(job)).toContainText(/Open/);
  });

  test('T1b: on a phone the Candidates board scrolls sideways to its last stage', { tag: ['@T1b', '@hiring'] }, async ({ asHR: kavya }, testInfo) => {
    /* 390px, the phone width the #80 review measured: only Applied and part of Screening showed, the rest clipped.
       Set before the page loads: the top bar lays itself out for the width it loads at. */
    await kavya.page.setViewportSize({ width: 390, height: 844 });
    await kavya.goto();
    await kavya.open('Candidates');
    await kavya.main.getByRole('button', { name: 'Board', exact: true }).click();
    const board = kavya.main.getByRole('region', { name: 'Candidates by stage' });
    /* The screen checks again, on the board: a box that clips what it holds is reported (clipped-list). */
    await auditScreen(kavya.page, testInfo);
    await expect(board).toHaveAttribute('data-wide', '');
    const hired = board.getByRole('region', { name: 'Hired', exact: true });
    await hired.scrollIntoViewIfNeeded();
    const m = await board.evaluate((box) => {
      const last = box.querySelector('section[aria-label="Hired"]')!.getBoundingClientRect();
      const frame = box.getBoundingClientRect();
      return { scrolled: box.scrollLeft, left: last.left, right: last.right, frameLeft: frame.left, frameRight: frame.right };
    });
    expect(m.scrolled, 'the board scrolled itself, not the page').toBeGreaterThan(0);
    expect(m.left, 'Hired shows inside the board').toBeGreaterThanOrEqual(m.frameLeft - 1);
    expect(m.right, 'Hired shows inside the board').toBeLessThanOrEqual(m.frameRight + 1);
  });

  test('T2: Priya refers a friend for an open job; Kavya sees the referral', { tag: ['@T2', '@referrals'] }, async ({ asEmployee: priya, asHR: kavya, w }, testInfo) => {
    const job = `Dyeing helper ${w.run}${testInfo.retry}`;
    const friend = `Sunil Gowda ${w.run}${testInfo.retry}`;
    const api = await apiAs(w);
    const opening = (await api.post(`/orgs/${w.asha.orgId}/people/talent/openings`, { title: job, places: 1, status: 'OPEN' })).opening;
    await api.put(`/orgs/${w.asha.orgId}/people/talent/openings/${opening.id}/referrals`, { referralOpen: true, referralBonus: 5000 });

    await priya.goto('Me');
    const jobs = priya.main.getByRole('list', { name: 'Open jobs' });
    await jobs.getByRole('button', { name: new RegExp(job) }).click();
    await priya.main.getByRole('button', { name: 'Refer someone' }).click();
    const form = priya.main.getByRole('form', { name: `Refer someone for ${job}` });
    await form.getByLabel('Their name').fill(friend);
    await form.getByLabel('Phone').fill('9845098765');
    await form.getByLabel('How you know them').fill('Neighbour');
    await form.getByRole('button', { name: 'Send referral' }).click();
    await expect(priya.main.getByRole('list', { name: 'My referrals' })).toContainText(friend);

    await kavya.goto();
    await kavya.open('Referrals');
    await expect(kavya.row(friend)).toContainText('Priya Sharma');
    await expect(kavya.row(friend)).toContainText(job);
  });

  test('T3: Priya swaps a shift with Imran; Imran accepts; Rahul approves', { tag: ['@T3', '@swaps'] }, async ({ asEmployee: priya, app, asManager: rahul, w }, testInfo) => {
    /* Setup (the owner: shifts are Attendance's): Imran on a later shift, so there is someone to swap with. */
    const api = await apiAs(w, 'owner');
    const day = workdayFromNow(8 + testInfo.retry * 2);
    const shifts = (await api.get(`/orgs/${w.asha.orgId}/attendance/shifts`)).shifts as Array<{ id: string; name: string }>;
    const shift = async (name: string, startTime: string, endTime: string) => shifts.find((s) => s.name === name) || (await api.post(`/orgs/${w.asha.orgId}/attendance/shifts`, { name, startTime, endTime })).shift;
    /* Only shifts set up in Attendance can be swapped: Priya on Day, Imran on a later one that still ends before 7 pm
       (a shift into 7 pm–6 am needs a woman's night-work consent on file, which Priya has not given: #78). */
    const dayShift = await shift('Day', '09:00', '18:00');
    const evening = await shift('Late day', '10:00', '18:30');
    await api.post(`/orgs/${w.asha.orgId}/attendance/shift-assignments`, { employeeIds: [w.people.priya.id], shiftId: dayShift.id, effectiveFrom: workdayFromNow(1) });
    await api.post(`/orgs/${w.asha.orgId}/attendance/shift-assignments`, { employeeIds: [w.people.imran.id], shiftId: evening.id, effectiveFrom: workdayFromNow(1) });

    await priya.goto('Schedule');
    await priya.main.getByRole('button', { name: 'Ask a colleague' }).click();
    await priya.main.getByRole('textbox', { name: /^Day/ }).fill(day);
    await priya.main.getByRole('radio', { name: /Imran Khan/ }).check();
    await priya.main.getByLabel('Why').fill('Exam in the morning');
    await priya.main.getByRole('button', { name: 'Ask', exact: true }).click();
    await expect(priya.main.getByRole('region', { name: 'My swaps' }).or(priya.main.locator('section[aria-labelledby="swap-mine-h"]')).first()).toContainText('Imran Khan');

    const imran = await app('imran');
    await imran.goto('Schedule');
    const ask = imran.main.getByRole('region', { name: 'Swap asked by Priya Sharma' });
    await expect(ask).toContainText(appDay(day).replace(/^\w+, /, ''));
    await ask.getByRole('button', { name: 'Accept' }).click();
    await expect(ask).toBeHidden();

    await rahul.goto();
    await rahul.open('Approvals');
    await (await rahul.approve('Priya Sharma', /swap/i)).click();
    await expect(rahul.row('Priya Sharma', /swap/i)).toHaveCount(0);

    await priya.goto('Schedule');
    await expect(priya.main.locator('section[aria-labelledby="swap-mine-h"]')).toContainText(/Approved|Agreed|Done/);
  });

  test('T4: Priya asks HR for a new ID card; Kavya approves it', { tag: ['@T4', '@requests'] }, async ({ asEmployee: priya, asHR: kavya, w }) => {
    const api = await apiAs(w);
    const forms = (await api.get(`/orgs/${w.asha.orgId}/people/request-forms`)).forms as Array<{ template: string; active: boolean }>;
    if (!forms.some((f) => f.template === 'ID_CARD' && f.active)) await api.post(`/orgs/${w.asha.orgId}/people/request-forms/templates/ID_CARD`);

    await priya.goto('Me');
    const section = priya.main.locator('section[aria-labelledby="my-forms-h"]');
    await section.getByRole('button', { name: 'ID card' }).click();
    const form = section.getByRole('form', { name: 'ID card' });
    await form.getByRole('radio', { name: 'Lost card' }).or(form.getByLabel('Why')).first().click();
    if (await form.getByLabel('Why').evaluate((el) => el.tagName === 'SELECT').catch(() => false)) await form.getByLabel('Why').selectOption('Lost card');
    await form.getByRole('button', { name: /^(Send|Ask)/ }).click();
    await expect(section.getByRole('list', { name: 'My requests to HR' })).toContainText('ID card');

    await kavya.goto();
    await kavya.open('Approvals');
    await (await kavya.approve('Priya Sharma', 'ID card')).click();
    await expect(kavya.row('Priya Sharma', 'ID card')).toHaveCount(0);

    await priya.goto('Me');
    await expect(priya.main.getByRole('list', { name: 'My requests to HR' })).toContainText(/Approved|Done/);
  });
});
