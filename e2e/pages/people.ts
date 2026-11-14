/**
 * The People web app, the way a person moves around it: by the labels on the
 * menu, at desktop width (a rail and a screen list) and at phone width (the
 * same lists inside the Menu drawer).
 */
import { expect, type Locator, type Page, type TestInfo } from '@playwright/test';

import { auditScreen } from '../support/checks';
import type { Company } from '../support/world';

/** Each screen's menu label → the module it sits under (apps/people/manifest.jsx `modules`). */
/** Rail modules that hold a single screen: the rail button opens it, with no list. */
const ONE_SCREEN = new Set(['Home']);

/* A screen whose menu item reads differently from its title: Settings is "All settings" in its list. */
const ITEM: Record<string, string> = { Settings: 'All settings' };

/* The rail names a module in one word; its screen list may carry the long name (R&D menu, 14 Nov 2026). */
const PANEL: Record<string, string> = { Time: 'Leave & attendance' };

/* A menu item may carry a count after its label ("Employees 10", "Inbox 3"). */
const itemName = (label: string) => new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?: ?\\d+\\+?)?$`);

/** A rail button by its module label; its name carries a count when something waits ("Inbox 3 waiting"). */
const railButton = (rail: Locator, module: string) => rail.getByRole('button', { name: new RegExp(`^${module}(?: |$)`) });

export const MENU: Record<string, string> = {
  Home: 'Home',
  Inbox: 'Home',
  Employees: 'Employees',
  'Org chart': 'Employees',
  Documents: 'Employees',
  Joining: 'Employees',
  Offers: 'Employees',
  'Job changes': 'Employees',
  Leaving: 'Employees',
  Tasks: 'Employees',
  'Salary revisions': 'Employees',
  Benefits: 'Employees',
  Assets: 'Employees',
  Expenses: 'Employees',
  "Who's away": 'Time',
  'Leave requests': 'Time',
  'Leave calendar': 'Time',
  'Leave balances': 'Time',
  'Leave register': 'Time',
  'Daily attendance': 'Time',
  'Attendance fixes': 'Time',
  'Shift swaps': 'Time',
  'Late marks': 'Time',
  'Absent without leave': 'Time',
  'Night work': 'Time',
  'Job openings': 'Hiring',
  Candidates: 'Hiring',
  Interviews: 'Hiring',
  Referrals: 'Hiring',
  Goals: 'Performance',
  Reviews: 'Performance',
  'One-on-ones': 'Performance',
  'Improvement plans': 'Performance',
  Training: 'Performance',
  Announcements: 'Engage',
  Events: 'Engage',
  'Help desk': 'Engage',
  Policies: 'Engage',
  'Confidential cases': 'Engage',
  'Headcount & attrition': 'Insights',
  'Requests report': 'Insights',
  'Statutory registers': 'Insights',
  Settings: 'Settings',
};

export class PeopleWeb {
  constructor(public readonly page: Page, private readonly company: Company, private readonly testInfo: TestInfo) {}

  get isPhone() {
    return (this.page.viewportSize()?.width || 1440) < 768;
  }

  get main() {
    return this.page.locator('main');
  }

  /** The page title (h1). */
  get title() {
    return this.main.getByRole('heading', { level: 1 }).first();
  }

  /** People's home for this company, as a bookmarked address would open it. */
  async goto(screen?: string) {
    await this.page.goto(`/o/${this.company.code}/?app=people${screen ? `&open=${screen}` : ''}`);
    await expect(this.page.getByRole('button', { name: /People: switch app/ })).toBeVisible();
  }

  private async drawer() {
    if (!this.isPhone) return this.page;
    const dialog = this.page.getByRole('dialog', { name: 'People navigation' });
    if (!(await dialog.isVisible())) await this.page.getByRole('banner').getByRole('button', { name: 'Menu' }).click();
    await expect(dialog).toBeVisible();
    return dialog;
  }

  /** The labels on the module rail this person can see. */
  async modules() {
    const root = await this.drawer();
    const labels = await root.getByRole('navigation', { name: 'People modules' }).getByRole('button').allTextContents();
    if (this.isPhone) await this.page.keyboard.press('Escape');
    /* A waiting count sits inside the button ("Inbox3"): the label is the words before it. */
    return labels.map((s) => s.trim().replace(/\d+\+?$/, '')).filter((s) => s && s !== 'More apps');
  }

  /** The screen labels under one module. */
  async screensUnder(module: string) {
    const root = await this.drawer();
    const rail = root.getByRole('navigation', { name: 'People modules' });
    const list = root.getByRole('navigation', { name: `${PANEL[module] || module} screens` });
    if (!(await list.isVisible().catch(() => false))) await railButton(rail, module).click();
    const labels = (await list.isVisible().catch(() => false)) ? await list.getByRole('button').allTextContents() : [];
    if (this.isPhone && (await this.page.getByRole('dialog', { name: 'People navigation' }).isVisible())) await this.page.keyboard.press('Escape');
    return labels.map((s) => s.trim()).filter((s) => s && !/^(Close|More apps)/.test(s));
  }

  /**
   * Opens a screen by its menu label, as a person would: the module on the
   * rail, then the screen. Waits for the page title to be that label and runs
   * the screen checks (support/checks.ts).
   */
  async open(label: string, opts: { title?: string } = {}) {
    const module = MENU[label];
    if (!module) throw new Error(`No menu entry "${label}" in pages/people.ts MENU`);
    const root = await this.drawer();
    const rail = root.getByRole('navigation', { name: 'People modules' });
    const list = root.getByRole('navigation', { name: `${PANEL[module] || module} screens` });
    const button = railButton(rail, module);
    if (ONE_SCREEN.has(label)) {
      /* Home opens straight from the rail (Inbox now sits under it). */
      await button.click();
    } else {
      /* The rail button toggles its list: press it only when that list is not already open. */
      /* (A press can land while the panel is still settling: try again until the list shows.) */
      await expect(async () => {
        if (!(await list.isVisible())) await button.click();
        await expect(list).toBeVisible({ timeout: 2_000 });
      }).toPass({ timeout: 15_000 });
      await list.getByRole('button', { name: itemName(ITEM[label] || label) }).click();
    }
    if (this.isPhone && (await this.page.getByRole('dialog', { name: 'People navigation' }).isVisible())) await this.page.keyboard.press('Escape');
    await expect(this.title).toHaveText(opts.title || label);
    await this.settle();
    await auditScreen(this.page, this.testInfo);
  }

  /** A page under Settings (Departments, Delegates, Compliance calendar…): the Settings page, then its row. */
  async openSetting(label: string) {
    await this.open('Settings');
    await this.main.getByRole('button', { name: new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`) }).click();
    await expect(this.title).toHaveText(label);
    await this.settle();
    await auditScreen(this.page, this.testInfo);
  }

  /** My leave, My attendance, My requests: under My profile, not the admin menu. */
  async openMine(label: 'My leave' | 'My attendance' | 'My requests') {
    await this.page.getByRole('banner').getByRole('button', { name: 'My profile' }).click();
    await this.main.getByRole('navigation', { name: 'Your pages' }).getByRole('button', { name: label, exact: true }).click();
    await expect(this.title).toHaveText(label);
    await this.settle();
    await auditScreen(this.page, this.testInfo);
  }

  /**
   * Loading placeholders gone: the screen marks what is still loading aria-busy.
   * Not "network idle": it says nothing about this screen, and on a busy
   * runner a People screen's ~20 requests outlast its 10 s, so open() waited
   * the 10 s and then went on regardless.
   */
  async settle() {
    /*
     * A screen that never finishes loading is a failure to look at, not something to step past.
     * 30 s, not 20: under heavy local load (load average 48 on 12 cores) Employees took over 20 s
     * and was still finishing (2 parts loading, then 1).
     */
    await expect(this.main.locator('[aria-busy="true"]'), 'the screen finished loading').toHaveCount(0, { timeout: 30_000 });
  }

  /** The last toast the app showed. */
  toast(text?: string | RegExp): Locator {
    const t = this.page.locator('[data-sonner-toast]');
    return text ? t.filter({ hasText: text }).first() : t.last();
  }

  /** A side panel or dialog by its name. */
  drawerNamed(name: string | RegExp) {
    return this.page.getByRole('dialog', { name });
  }

  /** The row (desktop table) or list item (phone list) that holds every one of these texts. */
  row(...texts: Array<string | RegExp>): Locator {
    /* Not the side column's lists ("Recent activity", "Waiting longest"), which repeat names. */
    let rows = this.main.locator(':is(tr, li):not(aside *, [role="complementary"] *)');
    for (const t of texts) rows = rows.filter({ hasText: t });
    /* A phone shows a list where a desktop shows a table; both may be in the page, one hidden. */
    return rows.filter({ visible: true }).first();
  }

  /**
   * Approves the item in Approvals that holds these texts: the row's own
   * Approve on a desktop; on a phone the item opens and Approve is in it.
   */
  async approve(...texts: Array<string | RegExp>) {
    const item = this.row(...texts);
    await expect(item).toBeVisible();
    const inline = item.getByRole('button', { name: 'Approve', exact: true });
    if (await inline.count()) return inline.first();
    await item.click();
    return this.page.getByRole('dialog').getByRole('button', { name: 'Approve', exact: true }).first();
  }

  /** Employees → a person's record, found the way HR finds one: by searching the name. */
  async openEmployee(name: string) {
    await this.open('Employees');
    await this.main.getByRole('searchbox', { name: 'Search employees' }).fill(name);
    /* Wait for the list to narrow to that person before clicking, so the click lands on the row that stays. */
    const hit = this.main.getByRole('button', { name: new RegExp(`^${name}\\b`) });
    await expect(hit).toHaveCount(1);
    /* The search is written to the address a moment later; a click before that is overwritten by it. */
    await expect(this.page).toHaveURL(/[?&]s\.q=/);
    await hit.click();
    await expect(this.title).toContainText(name);
    await this.settle();
    await auditScreen(this.page, this.testInfo, { title: false });
  }

  /** The company switcher in the top bar. */
  /** The company picker in the bar; on a phone it is in the app menu ("People ⌄"), the bar having no room for it. */
  async switchCompany(name: string) {
    const bar = this.page.getByRole('banner');
    if (!this.isPhone) return bar.getByRole('combobox', { name: 'Company' }).selectOption({ label: name });
    await this.companyMenuOpener().click();
    await bar.getByRole('group', { name: 'Company' }).getByRole('menuitemradio', { name, exact: true }).click();
  }

  /** On a phone: the app menu ("People ⌄"), or where the bar has none (the Workspace) the "Company: …" button. */
  private companyMenuOpener() {
    return this.page.getByRole('banner').getByRole('button', { name: /: switch app$|^Company: / }).first();
  }

  /** The company in use, as the bar (or a phone's app menu) shows it. */
  async companyInUse() {
    const bar = this.page.getByRole('banner');
    if (!this.isPhone) {
      const select = bar.getByRole('combobox', { name: 'Company' });
      return select.locator('option:checked').textContent();
    }
    await this.companyMenuOpener().click();
    const name = await bar.getByRole('group', { name: 'Company' }).getByRole('menuitemradio', { checked: true }).textContent();
    await this.page.keyboard.press('Escape');
    return name;
  }
}
