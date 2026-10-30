/**
 * Employee scenarios E1–E5: Priya asks for leave in the employee app.
 * Priya's weeks (support/dates.ts): E1 week 1, E2 week 2, E3 week 3, E4 weeks
 * 9–11, E5 week 5. A retry moves six weeks on, so it never meets the first
 * attempt's request.
 */
import { appLeave } from '../support/seed';
import { HOLIDAY_DAY, HOLIDAY_WEEK, shortDate, weekday } from '../support/dates';
import { inThisYear, readBalance } from '../support/leave';
import { expect, test } from '../support/fixtures';

const week = (n: number, retry: number) => n + retry * 6;

test.describe('Priya asks for leave in the employee app', () => {
  test('E1: two days of casual leave next week, with a reason', { tag: ['@E1', '@smoke'] }, async ({ asEmployee: priya, web }, testInfo) => {
    const wk = week(1, testInfo.retry);
    const from = weekday(wk, 0);
    const to = weekday(wk, 1);
    await priya.goto('Leave');
    const before = await readBalance(priya.balance('Casual leave'));

    await priya.fillLeave({ type: 'Casual leave', from, to, reason: "Cousin's wedding in Mysuru" });
    await expect(priya.preview).toContainText('2 days');
    await priya.send();

    await expect(priya.main.getByRole('status').filter({ hasText: 'Asked for 2 days of Casual leave' })).toBeVisible();
    const mine = priya.request(`${new Date(`${from}T12:00`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })}`);
    await expect(mine).toContainText('Waiting');
    await expect(mine).toContainText('2 days');
    const after = await readBalance(priya.balance('Casual leave'));
    if (inThisYear(from)) expect(after.waiting - before.waiting, 'the balance shows 2 more waiting').toBe(2);

    /* Rahul is told: the request waits in his Approvals, and his bell says so. */
    const rahul = await web('manager');
    await rahul.goto();
    await rahul.open('Approvals');
    const item = rahul.row(`${shortDate(from)} – ${shortDate(to)}`);
    await expect(item).toContainText('Priya Sharma');
    await expect(item).toContainText('Casual leave');
    /* The bell is sent from the outbox a moment later: open it again until the note is there. */
    await expect(async () => {
      await rahul.page.reload();
      await rahul.page.getByRole('banner').getByRole('button', { name: /Notifications/ }).click();
      await expect(rahul.page.getByRole('dialog', { name: 'Notifications' })).toContainText(`Priya Sharma (AT-004) asks for Casual leave, ${shortDate(from)} to ${shortDate(to)}`, { timeout: 3_000 });
    }).toPass({ timeout: 90_000 });
  });

  test('E2: half a day, the afternoon only', { tag: ['@E2'] }, async ({ asEmployee: priya }, testInfo) => {
    test.fail(true, 'APP BUG: My requests shows "0.5 days" but not which half of the day was asked for');
    const day = weekday(week(2, testInfo.retry), 2);
    await priya.goto('Leave');
    const before = await readBalance(priya.balance('Casual leave'));
    await priya.fillLeave({ type: 'Casual leave', from: day, reason: 'Bank work in the afternoon', afternoonOnly: true });
    await expect(priya.preview).toContainText(/0\.5 day|half a day/);
    await priya.send();
    await expect(priya.main.getByRole('status').filter({ hasText: /Asked for (0\.5|half a) day/ })).toBeVisible();
    const mine = priya.request(new Date(`${day}T12:00`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' }));
    await expect(mine).toContainText(/0\.5 day|half a day/);
    await expect(mine, 'the request says it is the afternoon').toContainText(/afternoon|after lunch|second half/i);
    const after = await readBalance(priya.balance('Casual leave'));
    if (inThisYear(day)) expect(after.waiting - before.waiting).toBe(0.5);
  });

  test('E3: leave over a public holiday', { tag: ['@E3', '@smoke'] }, async ({ asEmployee: priya, w }, testInfo) => {
    /* Tuesday to Thursday of the holiday's week; the holiday is the Wednesday. A retry has no holiday, so it is not retried. */
    test.skip(testInfo.retry > 0, 'the seeded holiday is in one week only');
    const from = weekday(HOLIDAY_WEEK, HOLIDAY_DAY - 1);
    const to = weekday(HOLIDAY_WEEK, HOLIDAY_DAY + 1);
    await priya.goto('Leave');
    await priya.fillLeave({ type: 'Casual leave', from, to, reason: 'Visiting family' });
    await expect(priya.preview).toContainText('2 days');
    const notCounted = priya.preview.getByRole('list', { name: 'Dates not counted' });
    await expect(notCounted).toContainText(`Holiday: ${w.leave.holiday.name}`);
    await priya.send();
    await expect(priya.main.getByRole('status').filter({ hasText: 'Asked for 2 days of Casual leave' })).toBeVisible();
  });

  test('E4: more leave than the balance is refused before sending', { tag: ['@E4', '@smoke'] }, async ({ asEmployee: priya }, testInfo) => {
    const from = weekday(week(9, testInfo.retry), 0);
    const to = weekday(week(11, testInfo.retry), 4);
    await priya.goto('Leave');
    const before = await readBalance(priya.balance('Casual leave'));
    await priya.fillLeave({ type: 'Casual leave', from, to, reason: 'Long trip' });
    await expect(priya.preview, 'said plainly, before sending').toContainText(/more than|only .* left|not enough|exceeds|balance/i);
    const send = priya.leaveForm.getByRole('button', { name: 'Send' });
    if (await send.isEnabled()) await send.click();
    /* Nothing saved: no new request, the balance as it was. */
    await expect(priya.request(new Date(`${from}T12:00`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' }))).toHaveCount(0);
    expect((await readBalance(priya.balance('Casual leave'))).waiting).toBe(before.waiting);
  });

  test('E5: withdraw a request still waiting', { tag: ['@E5', '@smoke'] }, async ({ asEmployee: priya, web, w }, testInfo) => {
    const wk = week(5, testInfo.retry);
    const from = weekday(wk, 3);
    const to = weekday(wk, 4);
    await appLeave(w, 'priya', from, to, 'Plans changed later');

    await priya.goto('Leave');
    const before = await readBalance(priya.balance('Casual leave'));
    const mine = priya.request(new Date(`${from}T12:00`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' }));
    await expect(mine).toContainText('Waiting');
    await mine.getByRole('button', { name: 'Cancel' }).click();
    const confirm = priya.page.getByRole('dialog').or(priya.page.getByRole('alertdialog'));
    if (await confirm.first().isVisible().catch(() => false)) await confirm.first().getByRole('button', { name: /withdraw|cancel (it|the request|leave)|yes/i }).first().click();

    await expect(priya.request(new Date(`${from}T12:00`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })).filter({ hasText: 'Waiting' })).toHaveCount(0);
    const after = await readBalance(priya.balance('Casual leave'));
    if (inThisYear(from)) expect(before.waiting - after.waiting, 'the balance is given back').toBe(2);

    const rahul = await web('manager');
    await rahul.goto();
    await rahul.open('Approvals');
    await expect(rahul.row(`${shortDate(from)} – ${shortDate(to)}`)).toHaveCount(0);
  });
});
