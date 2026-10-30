/**
 * The employee app (#/portal): Today, My days, Schedule, Leave, Me, as the
 * tabs at the bottom of the phone.
 */
import { expect, type Locator, type Page, type TestInfo } from '@playwright/test';

import { auditScreen } from '../support/checks';

export type AppTab = 'Today' | 'My days' | 'Schedule' | 'Leave' | 'Me';

export class EmployeeApp {
  constructor(public readonly page: Page, private readonly testInfo: TestInfo) {}

  get main() {
    return this.page.locator('main');
  }

  async goto(tab: AppTab = 'Today') {
    /* Same address with only a hash: goto would not reload, and the screen would show what it had before. */
    if (this.page.url().includes('#/portal')) await this.page.reload();
    else await this.page.goto('/#/portal');
    await expect(this.page.getByRole('navigation', { name: 'Portal' })).toBeVisible();
    await this.tab(tab);
  }

  async tab(name: AppTab) {
    await this.page.getByRole('navigation', { name: 'Portal' }).getByRole('button', { name, exact: true }).click();
    await this.page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => null);
    await auditScreen(this.page, this.testInfo, { title: false });
  }

  /* ---------------------------------------------------------------- Leave */

  get leaveForm() {
    return this.main.getByRole('form', { name: 'Ask for leave' });
  }

  /** The balance card for one type: "Casual leave / 10 / left of 12 · 2 waiting". */
  balance(type: string): Locator {
    return this.main.locator('.ui-card').filter({ has: this.page.getByText(type, { exact: true }) }).filter({ hasText: 'left of' }).first();
  }

  /** Fills the leave form; does not send. */
  async fillLeave(o: { type: string; from: string; to?: string; reason: string; afternoonOnly?: boolean }) {
    const f = this.leaveForm;
    await f.getByLabel('Leave type').selectOption({ label: o.type });
    await f.getByLabel('First day').fill(o.from);
    await f.getByLabel('Last day').fill(o.to || o.from);
    await f.getByLabel('Reason').fill(o.reason);
    /* One day: "How much of the day" → Second half is the afternoon. */
    if (o.afternoonOnly) await f.getByLabel('How much of the day').selectOption({ label: 'Second half' });
  }

  /** What the form says about the request before it is sent. */
  get preview() {
    return this.leaveForm.getByRole('status');
  }

  async send() {
    await this.leaveForm.getByRole('button', { name: 'Send' }).click();
  }

  get requests() {
    return this.main.getByRole('region', { name: 'My requests' });
  }

  request(text: string | RegExp) {
    return this.requests.getByRole('listitem').filter({ hasText: text }).first();
  }
}
