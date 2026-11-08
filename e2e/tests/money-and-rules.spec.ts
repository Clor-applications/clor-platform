/**
 * Money and attendance rules (on main since 30 Oct 2026):
 *   X1  an expense claim from the employee app, approved by the manager in Approvals   @money
 *   X2  HR pays an approved claim from People → Expenses                               @money
 *   R1  Attendance rules: who a late-marks rule hits, before it is saved              @rules
 *   R2  the missing-punch notice: Fix opens the request filled in, and it is sent      @rules
 *   R3  night work for women in warn mode: the shift is saved, the woman is listed    @rules
 *
 * Who and what this file changes (support/dates.ts): Priya's expense claims (X1),
 * Deepak's (X2); Imran's attendance last month (R1); Lakshmi's last working day,
 * marked at setup with no punch-out (R2); Farah's shift from tomorrow and the
 * company's night-work mode (R3). Nobody else's leave weeks are touched.
 */
import { appDay, iso, todayIST, workdayFromNow } from '../support/dates';
import { approvedClaim, giveShift, markDays, missedPunchDay } from '../support/seed';
import { expect, test } from '../support/fixtures';
import { apiURL, jobsToken } from '../scripts/env.mjs';

/** The Tuesday, Wednesday and Thursday of last month's second week: three working days, whatever the month. */
function lastMonthDays() {
  const d = todayIST();
  d.setHours(12, 0, 0, 0);
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  d.setDate(8);
  while (d.getDay() !== 2) d.setDate(d.getDate() + 1);
  return [0, 1, 2].map((n) => {
    const x = new Date(d);
    x.setDate(d.getDate() + n);
    return iso(x);
  });
}

const monthTitle = (isoDate: string) => new Date(`${isoDate.slice(0, 7)}-01T12:00:00`).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });

test.describe('Expense claims', () => {
  test('X1: a bill from the employee app, approved by the manager', { tag: ['@X1', '@money'] }, async ({ asEmployee: priya, asManager: rahul, w }, testInfo) => {
    const title = `Client visit to Mysuru ${w.run}${testInfo.retry ? ` (${testInfo.retry})` : ''}`;
    const merchant = `Ola cab ${w.run}${testInfo.retry ? ` ${testInfo.retry}` : ''}`;

    /* Priya adds one bill without a photo, then sends it. */
    await priya.goto('Me');
    const spent = priya.main.getByRole('region', { name: 'Spent for work' });
    await spent.getByRole('button', { name: 'Add a bill' }).click();
    const bill = spent.getByRole('form', { name: 'Add a bill' });
    await bill.getByLabel('Amount').fill('450');
    await bill.getByLabel('What it was for').selectOption({ label: 'Local conveyance' });
    await bill.getByLabel('Where').fill(merchant);
    await bill.getByRole('button', { name: 'Add bill' }).click();
    await expect(bill).toBeHidden();
    await expect(spent).toContainText(merchant);
    await expect(spent).toContainText('no bill');
    await spent.getByLabel('What for', { exact: true }).fill(title);
    await spent.getByRole('button', { name: 'Send 1 bill for approval' }).click();
    const sent = spent.getByRole('listitem').filter({ hasText: title });
    await expect(sent).toContainText('Waiting for approval');
    await expect(sent).toContainText('₹450');

    /* Rahul, her manager, sees it in Approvals and approves it (under ₹5,000: no HR step). */
    await rahul.goto();
    await rahul.open('Inbox');
    await expect(rahul.row(title)).toContainText(/Expense claim/);
    await (await rahul.approve(title)).click();
    await expect(rahul.row(title)).toHaveCount(0);

    /* Priya sees it approved, waiting to be paid. */
    await priya.goto('Me');
    await expect(priya.main.getByRole('region', { name: 'Spent for work' }).getByRole('listitem').filter({ hasText: title })).toContainText('Approved, to be paid');
  });

  test('X2: HR pays an approved claim, and the person sees it paid', { tag: ['@X2', '@money'] }, async ({ asHR: kavya, app, w }, testInfo) => {
    const title = `Courier to Surat buyer ${w.run}${testInfo.retry ? ` (${testInfo.retry})` : ''}`;
    await approvedClaim(w, 'deepak', title, 780, `DTDC ${w.run}${testInfo.retry ? ` ${testInfo.retry}` : ''}`);

    await kavya.goto();
    await kavya.open('Expenses');
    const row = kavya.row(title);
    await expect(row).toContainText('Deepak Verma');
    await expect(row).toContainText('₹780');
    await row.click();
    const drawer = kavya.drawerNamed(`Deepak Verma: ${title}`);
    await drawer.getByRole('button', { name: 'Paid now' }).click();
    await drawer.getByLabel('How').selectOption({ label: 'UPI' });
    await drawer.getByRole('button', { name: 'Mark paid' }).click();
    await expect(drawer).toBeHidden();
    /* Paid: gone from To pay. */
    await expect(kavya.row(title)).toHaveCount(0);

    const deepak = await app('deepak');
    await deepak.goto('Me');
    await expect(deepak.main.getByRole('region', { name: 'Spent for work' }).getByRole('listitem').filter({ hasText: title })).toContainText('Paid');
  });
});

test.describe('Attendance rules', () => {
  test('R1: a late-marks rule shows whom it would hit before it is saved', { tag: ['@R1', '@rules'] }, async ({ asOwner: suresh, w }) => {
    /* Imran came in late (09:45 on a 09:00 shift) three days last month. */
    const days = lastMonthDays();
    /* Out at 19:00, so each is a whole present day (a short day is a half day, and a half day is never a late mark too). */
    await markDays(w, 'imran', days, '09:45', '19:00');

    await suresh.goto();
    await suresh.open('Settings');
    await suresh.main.getByRole('button', { name: /^Attendance rules/ }).click();
    await expect(suresh.title).toHaveText('Attendance rules');
    await suresh.settle();
    const marks = suresh.main.getByRole('group', { name: 'Late marks and early exits' });
    /* Late marks cost pay, so they start off. */
    await expect(marks.getByRole('checkbox', { name: 'On', exact: true })).not.toBeChecked();
    await marks.getByRole('checkbox', { name: 'On', exact: true }).check();
    await expect(marks.getByRole('checkbox', { name: 'Count late arrivals' })).toBeChecked();

    /* A company new to late marks cuts the time actually missed (DECISIONS.md 1, Code on Wages s.20): 3 × 45 min. */
    const cuts = marks.getByLabel('Each mark cuts');
    await expect(cuts).toHaveValue('TIME_MISSED');
    const ask = marks.getByRole('button', { name: `Who this hits in ${monthTitle(days[0])}` });
    await ask.click();
    const preview = marks.getByRole('table', { name: `Penalties in ${monthTitle(days[0])}` });
    const imran = preview.getByRole('row').filter({ hasText: 'Imran Khan' });
    await expect(imran.getByRole('cell').nth(1)).toHaveText('3');
    await expect(imran).toContainText('2 h 15 min');
    await expect(imran).not.toContainText('½ day');

    /* Every 3 late marks = ½ day: the same three marks now cost half a day. */
    await cuts.selectOption({ label: 'Every few marks, half or a full day' });
    await expect(marks.getByRole('spinbutton', { name: /^Every.*late marks/ })).toHaveValue('3');
    await expect(marks.getByLabel('Costs')).toHaveValue('0.5');
    /* A changed rule clears the old answer; asked again, it is worked out under the new one. */
    await expect(preview).toHaveCount(0);
    await ask.click();
    await expect(imran.getByRole('cell').nth(1)).toHaveText('3');
    await expect(imran).toContainText('½ day');
    await expect(marks).toContainText('Nothing is saved until you press Save.');

    /* Undone, nothing was saved: the rule is still off. */
    await suresh.main.getByRole('button', { name: 'Undo changes' }).click();
    await expect(marks.getByRole('checkbox', { name: 'On', exact: true })).not.toBeChecked();
  });

  test('R2: the missing-punch notice opens the fix, filled in, and it is sent', { tag: ['@R2', '@rules'] }, async ({ app }, testInfo) => {
    test.skip(!jobsToken, 'needs E2E_JOBS_TOKEN to wake the missing-punch job on this target');
    /* The request it sends clears the notice: a retry has nothing left to fix. */
    test.skip(testInfo.retry > 0, 'the seeded missing punch is fixed by the first attempt');
    const day = missedPunchDay();

    /* The hourly job, woken now. It covers every company: a second wake within the hour (the other width) is skipped by the server, and the first one already found both worlds' missing punch (seeded at setup). */
    const woke = await fetch(`${apiURL}/internal/jobs/tick`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-jobs-token': jobsToken }, body: JSON.stringify({ only: ['startPunchNudges'] }) });
    expect(woke.status, 'the job wake call').toBe(200);

    const lakshmi = await app('lakshmi');
    const fix = lakshmi.main.getByRole('region', { name: 'To fix' }).getByRole('button', { name: `Fix ${appDay(day)}` });
    await expect(async () => {
      await lakshmi.goto('Today');
      await expect(fix).toBeVisible({ timeout: 3_000 });
    }).toPass({ timeout: 90_000 });
    await expect(lakshmi.main.getByRole('region', { name: 'To fix' })).toContainText('No punch-out');

    /* Fix: My days, the missed-punch request already filled in. */
    await fix.click();
    const ask = lakshmi.main.getByRole('form', { name: 'Ask' });
    /* The fix opens as a missed-punch request (no kind to choose): the day and the punch-in it has are filled in. */
    await expect(ask.getByLabel('In', { exact: true })).toHaveValue('09:20');
    await expect(ask).toContainText('Missed-punch requests this month');
    await expect(ask.getByLabel('Day', { exact: true })).toHaveValue(day);
    await ask.getByRole('button', { name: 'Send' }).click();
    await expect(ask.getByRole('status')).toContainText('Sent for approval.');
    await expect(lakshmi.main.getByRole('region', { name: 'My requests' })).toContainText('Missed punch');

    /* Asked for, so no longer to fix. */
    await lakshmi.goto('Today');
    await expect(fix).toHaveCount(0);
  });

  test('R3: night work without consent, in warn mode: the shift is saved and she is listed', { tag: ['@R3', '@rules'] }, async ({ asOwner: suresh, w }) => {
    /* The company chooses "save it and warn" over refusing the shift. */
    await suresh.goto();
    await suresh.open('Settings');
    await suresh.main.getByRole('button', { name: /^Attendance rules/ }).click();
    await expect(suresh.title).toHaveText('Attendance rules');
    await suresh.settle();
    const night = suresh.main.getByRole('group', { name: 'Night work for women' });
    await expect(night.getByRole('checkbox', { name: 'On', exact: true })).toBeChecked();
    const mode = night.getByLabel('Without consent');
    if ((await mode.inputValue()) !== 'WARN') {
      await mode.selectOption({ label: 'Save it and warn' });
      await suresh.main.getByRole('button', { name: 'Save', exact: true }).click();
      await expect(suresh.main.getByRole('button', { name: 'Save', exact: true })).toBeDisabled();
    }

    /* Farah is given an evening shift into the night (to 22:00) with no consent on file: saved, not refused. */
    await giveShift(w, 'farah', { name: `Evening ${w.run}`, startTime: '14:00', endTime: '22:00' }, workdayFromNow(1));

    await suresh.open('Night work');
    await expect(suresh.main).toContainText('shifts are saved with a warning');
    await expect(suresh.main).toContainText(/\d+ on night shifts without consent/);
    const farah = suresh.row('Farah Reddy');
    await expect(farah).toContainText('None on file');
    await expect(farah).toContainText(/night shifts in the next 30 days|\d+/);
  });
});
