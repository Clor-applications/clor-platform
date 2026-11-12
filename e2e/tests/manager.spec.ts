/**
 * Manager scenarios (Rahul, team-limited): M1–M4, M6–M8, M11.
 * Requests come from Rahul's other reports, so Priya's balance stays the
 * employee scenarios' own: Imran (M1, M4), Lakshmi (M2, M4), Deepak (M3).
 */
import { appLeave, decideLeave } from '../support/seed';
import { appDay, dmy, iso, todayIST, webSpan, weekday, workdayFromNow } from '../support/dates';
import { expectBalance, readBalance } from '../support/leave';
import { allowNoise, expect, test } from '../support/fixtures';
import { choose } from '../support/ui';

const todayMonth = () => iso(todayIST()).slice(0, 7);


test.describe('Rahul manages his team', () => {
  test('M1: approve a team member’s leave from Approvals', { tag: ['@M1', '@smoke'] }, async ({ asManager: rahul, app, w }, testInfo) => {
    const day = workdayFromNow(2 + testInfo.retry);
    await appLeave(w, 'imran', day, day, 'Doctor’s appointment');
    const imran = await app('imran');
    await imran.goto('Leave');
    const before = await readBalance(imran.balance('Casual leave'));

    await rahul.goto();
    await rahul.open('Inbox');
    await (await rahul.approve(webSpan(day), 'Imran Khan')).click();
    /*
     * The app saying it is done, then the row gone. The row alone was not enough: on a busy
     * runner the list refreshed and dropped it ~0.2 s after the click, while the approval was
     * still on its way (0.7 s), and Imran's page was read too soon and said Waiting.
     */
    await expect(rahul.toast(/Approved/)).toBeVisible();
    await expect(rahul.row(webSpan(day), 'Imran Khan')).toHaveCount(0);

    /* Imran sees it approved and his balance moved from waiting to taken. */
    await imran.goto('Leave');
    await expect(imran.request(appDay(day))).toContainText('Approved');
    await expectBalance(imran.balance('Casual leave'), { left: before.left, waiting: before.waiting - 1 });

    /* Who's away shows him. */
    await rahul.open("Who's away");
    await expect(rahul.main.getByRole('region', { name: /Next 7 days|Away today/ }).filter({ hasText: 'Imran Khan' }).first()).toBeVisible();
  });

  test('M2: reject with a reason', { tag: ['@M2', '@smoke'] }, async ({ asManager: rahul, app, w }, testInfo) => {
    const from = weekday(1 + testInfo.retry * 6, 2);
    const to = weekday(1 + testInfo.retry * 6, 3);
    await appLeave(w, 'lakshmi', from, to, 'Trip to Hampi');
    const lakshmi = await app('lakshmi');
    await lakshmi.goto('Leave');
    const before = await readBalance(lakshmi.balance('Casual leave'));

    await rahul.goto();
    await rahul.open('Inbox');
    const item = rahul.row(webSpan(from, to), 'Lakshmi Patil');
    /*
     * The name opens the request (a button on a desktop row; the whole item on a phone).
     * The row first: count() does not wait, so on a slow list it said "no button" and the
     * row itself was clicked, which opens nothing on a desktop (CI run 41181371877).
     */
    await expect(item).toBeVisible();
    const opener = item.getByRole('button', { name: /Lakshmi Patil/ });
    await ((await opener.count()) ? opener.first() : item).click();
    const panel = rahul.drawerNamed('Lakshmi Patil: Casual leave');
    await panel.getByLabel('Note to them').fill('Dyeing batch due that week; please pick the week after.');
    await panel.getByRole('button', { name: 'Reject' }).click();
    /* Done when the app says so (see M1), not when the row first goes. */
    await expect(rahul.toast(/Rejected|Not approved/)).toBeVisible();
    await expect(rahul.row(webSpan(from, to))).toHaveCount(0);

    await lakshmi.goto('Leave');
    const mine = lakshmi.request(appDay(from));
    await expect(mine).toContainText(/Rejected|Not approved|Declined/);
    await expect(mine, 'she sees the reason').toContainText('Dyeing batch due that week');
    await expectBalance(lakshmi.balance('Casual leave'), { left: before.left + 2, waiting: before.waiting - 2 }, 'nothing taken: the two days are back');
  });

  test('M3: two waiting items, approved once each even on a double tap', { tag: ['@M3'] }, async ({ asManager: rahul, app, w }, testInfo) => {
    const wk = 1 + testInfo.retry * 6;
    const a = weekday(wk, 4);
    const b = weekday(wk + 1, 0);
    await appLeave(w, 'deepak', a, a, 'Festival at home');
    await appLeave(w, 'deepak', b, b, 'Travel back');
    const deepak = await app('deepak');
    await deepak.goto('Leave');
    const before = await readBalance(deepak.balance('Casual leave'));

    await rahul.goto();
    await rahul.open('Inbox');
    for (const day of [a, b]) {
      await (await rahul.approve(webSpan(day), 'Deepak Verma')).dblclick();
      await expect(rahul.row(webSpan(day), 'Deepak Verma')).toHaveCount(0);
    }

    await deepak.goto('Leave');
    await expect(deepak.request(appDay(a))).toContainText('Approved');
    await expect(deepak.request(appDay(b))).toContainText('Approved');
    const after = await readBalance(deepak.balance('Casual leave'));
    expect(after.waiting).toBe(before.waiting - 2);
    expect(after.left, 'two days taken once each: nothing more comes off').toBe(before.left);
  });

  test('M4: who is away this week, only my team, clashes flagged', { tag: ['@M4'] }, async ({ asManager: rahul, w }, testInfo) => {
    const day = workdayFromNow(4 + testInfo.retry);
    const one = await appLeave(w, 'imran', day, day, 'Wedding');
    const two = await appLeave(w, 'lakshmi', day, day, 'Wedding');
    const outside = await appLeave(w, 'arjun', day, day, 'Wedding');
    await decideLeave(w, w.users.manager.email, one.id, 'approve');
    await decideLeave(w, w.users.manager.email, two.id, 'approve');
    await decideLeave(w, w.users.owner.email, outside.id, 'approve');

    await rahul.goto();
    await rahul.open("Who's away");
    const soon = rahul.main.getByRole('region', { name: /Next 7 days/ });
    await expect(soon).toContainText('Imran Khan');
    await expect(soon).toContainText('Lakshmi Patil');
    await expect(rahul.main, 'only my team').not.toContainText('Arjun Das');
    /* Any count: another scenario in the same run may have a team member away that day too (nightly 4 Nov 2026 read "3 people away the same day"). */
    await expect(rahul.main, 'two of the team away the same day is flagged').toContainText(/clash|overlap|\d+ (people )?away|both away|at the same time/i);
    const together = rahul.main.getByRole('region', { name: 'Away the same day' });
    await expect(together).toContainText('Imran Khan');
    await expect(together).toContainText('Lakshmi Patil');
    await expect(together).not.toContainText('Arjun Das');

    /* The Leave calendar flags the same day, in that day's month. */
    await rahul.open('Leave calendar');
    if (day.slice(0, 7) !== todayMonth()) await rahul.main.getByRole('button', { name: 'Next month' }).click();
    const flagged = rahul.main.getByRole('list', { name: 'Away the same day' });
    await expect(flagged).toContainText(/\d+ people away the same day/);
    await expect(flagged).toContainText(/Imran Khan, Lakshmi Patil/);
  });

  test('M11: Home, Who’s away and the Leave calendar open without a refusal', { tag: ['@M11', '@smoke'] }, async ({ asManager: rahul }) => {
    /* What a manager's screens ask for is what a manager may read: no 403 behind the screens (holidays, announcements, events, the set-up list). */
    const refused: string[] = [];
    rahul.page.on('response', (r) => { if (r.status() === 403 && r.url().includes('/api/')) refused.push(`${r.request().method()} ${r.url().replace(/^https?:\/\/[^/]+/, '')}`); });
    await rahul.goto();
    await expect(rahul.title).toBeVisible();
    await rahul.settle();
    await rahul.open("Who's away");
    await rahul.open('Leave calendar');
    await rahul.open('Inbox');
    expect(refused, 'API calls refused while a manager used his own screens').toEqual([]);
  });

  test('M6: a team member’s profile shows work, not pay or private details', { tag: ['@M6', '@smoke'] }, async ({ asManager: rahul, w }) => {
    await rahul.goto();
    await rahul.openEmployee(w.people.priya.name);
    await expect(rahul.title).toContainText('Priya Sharma');
    await expect(rahul.main).toContainText('Weaver');
    await expect(rahul.main).toContainText('Production');
    await expect(rahul.main).toContainText('Rahul Menon');
    const tabs = rahul.main.getByRole('tablist', { name: 'Priya Sharma sections' });
    for (const tab of await tabs.getByRole('tab').all()) {
      const name = (await tab.textContent())?.trim();
      await tab.click();
      const panel = rahul.main.getByRole('tabpanel');
      await expect(panel).toBeVisible();
      await rahul.settle();
      /* No field for pay, bank, PAN or health, and none of her private details (seeded: address, birthday, emergency contact). */
      const labels = (await panel.locator('dt').allTextContents()).join(' | ');
      expect(labels, `${name} tab: field labels`).not.toMatch(/\bPAN\b|Bank|IFSC|Salary|CTC|Blood|Medical|Health|Date of birth|Address|Emergency/i);
      const text = await panel.innerText();
      expect(text, `${name} tab`).not.toMatch(/Temple Road|Chamundipuram|Anita Sharma|9845011122|14 May 1996/);
    }
  });

  test('M7: someone outside my team is not listed and not reachable by address', { tag: ['@M7', '@smoke'] }, async ({ asManager: rahul, w }, testInfo) => {
    allowNoise(testInfo, /404|Not Found|No such employee/i);
    await rahul.goto();
    await rahul.open('Employees');
    await rahul.main.getByRole('searchbox', { name: 'Search employees' }).fill('Arjun');
    await expect(rahul.main.getByRole('button', { name: /^Arjun Das/ })).toHaveCount(0);

    await rahul.page.goto(`/o/${w.asha.code}/?app=people&open=employee&s.id=${w.people.arjun.id}`);
    await expect(rahul.main).not.toContainText('Arjun Das', { timeout: 5_000 });
    await expect(rahul.main).not.toContainText(w.people.arjun.code);
    await expect(rahul.main).toContainText(/not available|not found|no access/i);
  });

  test('M8: my own leave goes to my manager, never to me', { tag: ['@M8', '@smoke'] }, async ({ asManager: rahul, asOwner: suresh, w }, testInfo) => {
    const wk = 2 + testInfo.retry * 6;
    const from = weekday(wk, 0);
    const to = weekday(wk, 1);
    await rahul.goto();
    await rahul.openMine('My leave');
    await rahul.main.getByRole('button', { name: 'Ask for leave' }).click();
    const ask = rahul.drawerNamed('Ask for leave');
    await choose(ask.getByLabel('Leave type'), 'Casual leave');
    await ask.getByLabel('First day').fill(dmy(from));
    await ask.getByLabel('Last day').fill(dmy(to));
    await ask.getByLabel('Reason').fill('School admission for my son');
    await ask.getByRole('button', { name: 'Send' }).click();
    await expect(ask).toBeHidden();
    await expect(rahul.row('School admission for my son').or(rahul.row(webSpan(from, to)))).toContainText(/Waiting/);

    await rahul.open('Inbox');
    await expect(rahul.row(webSpan(from, to)), 'not in my own Approvals').toHaveCount(0);

    await suresh.goto();
    await suresh.open('Inbox');
    await expect(suresh.row(webSpan(from, to))).toContainText('Rahul Menon');
  });
});
