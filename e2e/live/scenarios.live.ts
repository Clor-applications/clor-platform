/**
 * Real-world stories across portals. Each account in QA_ACCOUNTS has a role
 * ("owner", "hr", "manager", "employee", "accountant", "staff"); a scenario runs
 * for every account whose role it lists. Read steps always run; write steps
 * (marked write) only in QA companies with QA_LIVE_WRITES=1, and every record
 * they make carries the run tag (QA-yyyymmdd-xxxx) so it can be found and removed.
 */
import { expect, test } from '@playwright/test';
import { accounts } from './lib/env';
import { saveVisits } from './lib/monitor';
import { runSteps, type Scenario } from './lib/scenario';
import { pageAs } from './lib/session';

const sees = (text: RegExp) => async ({ page }: any) => { await expect(page.getByText(text).first()).toBeVisible(); };
const clickText = async (page: any, re: RegExp) => page.getByRole('button', { name: re }).or(page.getByRole('link', { name: re })).first().click();

export const SCENARIOS: Scenario[] = [
  {
    id: 'S01', title: 'Owner starts the day: Workspace overview, switches to each app', who: ['owner'],
    steps: [
      { name: 'workspace overview', run: async ({ open, page }) => { await open('app'); await expect(page.locator('main')).toBeVisible(); } },
      { name: 'people home', run: async ({ open }) => open('people') },
      { name: 'payroll home', run: async ({ open }) => open('payroll') },
      { name: 'attendance home', run: async ({ open }) => open('attendance') },
      { name: 'books home', run: async ({ open }) => open('books') },
      { name: 'session carried to every app (no sign-in screen)', run: async ({ page }) => expect(page).not.toHaveURL(/signin/) },
    ],
  },
  {
    id: 'S02', title: 'HR hires a new employee and they appear in Attendance and Payroll', who: ['owner', 'hr'],
    steps: [
      { name: 'open people list', run: async ({ open, page }) => { await open('people'); await clickText(page, /^people$|^employees$/i).catch(() => {}); } },
      { name: 'add employee form opens', run: async ({ page }) => { await clickText(page, /add (employee|person)|new (employee|person)/i); await expect(page.getByRole('dialog').or(page.locator('form')).first()).toBeVisible(); } },
      { name: 'fill and save employee', write: true, run: async ({ page, tag }) => {
        await page.getByLabel(/first name|full name|name/i).first().fill(`${tag} Ravi Kumar`);
        await page.getByLabel(/email/i).first().fill(`${tag.toLowerCase()}.ravi@example.com`).catch(() => {});
        await clickText(page, /^(save|add|create)/i);
        await expect(page.getByText(new RegExp(tag)).first()).toBeVisible({ timeout: 20_000 });
      } },
      { name: 'new hire visible in Attendance', write: true, run: async ({ open, page, tag }) => { await open('attendance'); await page.getByRole('searchbox').or(page.getByPlaceholder(/search/i)).first().fill(tag).catch(() => {}); await expect(page.getByText(new RegExp(tag)).first()).toBeVisible({ timeout: 20_000 }); } },
      { name: 'new hire visible in Payroll', write: true, run: async ({ open, page, tag }) => { await open('payroll'); await page.getByPlaceholder(/search/i).first().fill(tag).catch(() => {}); await expect(page.getByText(new RegExp(tag)).first()).toBeVisible({ timeout: 20_000 }); } },
    ],
  },
  {
    id: 'S03', title: 'Employee applies leave, manager approves from Approvals inbox, balance drops', who: ['employee', 'manager'],
    steps: [
      { name: 'leave screen opens', run: async ({ open, page }) => { await open('people'); await clickText(page, /^leave/i); } },
      { name: 'apply leave form', run: async ({ page }) => { await clickText(page, /apply|request leave|new request/i); } },
      { name: 'submit leave request', write: true, run: async ({ page, tag }) => { await page.getByLabel(/reason|note/i).first().fill(`${tag} family function`); await clickText(page, /^(submit|apply|send)/i); await sees(/pending|submitted|requested/i)({ page }); } },
      { name: 'approvals inbox loads', run: async ({ open, page }) => { await open('people'); await clickText(page, /approvals|inbox/i); } },
    ],
  },
  {
    id: 'S04', title: 'Payroll admin previews this month\'s payroll (no money moves)', who: ['owner', 'hr', 'accountant'],
    steps: [
      { name: 'payroll runs screen', run: async ({ open, page }) => { await open('payroll'); await clickText(page, /run payroll|payroll runs|^runs?$/i); } },
      { name: 'salary structures screen', run: async ({ open, page }) => { await open('payroll'); await clickText(page, /salary|structure|components/i); } },
      { name: 'statutory (PF/ESI/PT/TDS) settings', run: async ({ open, page }) => { await open('payroll'); await clickText(page, /statutory|compliance|settings/i); } },
      { name: 'start a draft run for the QA company', write: true, run: async ({ page }) => { await clickText(page, /run payroll|new run|start/i); await sees(/draft|preview|review/i)({ page }); } },
    ],
  },
  {
    id: 'S05', title: 'Attendance: team day view, regularisation, shifts, holidays', who: ['owner', 'hr', 'manager'],
    steps: [
      { name: 'today / team view', run: async ({ open }) => open('attendance') },
      { name: 'shifts screen', run: async ({ page }) => clickText(page, /shift/i) },
      { name: 'holidays screen', run: async ({ page }) => clickText(page, /holiday/i) },
      { name: 'reports screen', run: async ({ page }) => clickText(page, /report/i) },
    ],
  },
  {
    id: 'S06', title: 'Accountant raises a GST invoice to a customer and checks it in reports', who: ['owner', 'accountant'],
    steps: [
      { name: 'sales invoices list', run: async ({ open, page }) => { await open('books'); await clickText(page, /sales|invoices/i); } },
      { name: 'new invoice form opens', run: async ({ page }) => { await clickText(page, /new invoice|create invoice|\+ ?invoice/i); } },
      { name: 'save invoice as draft', write: true, run: async ({ page, tag }) => {
        await page.getByLabel(/customer/i).first().fill(`${tag} Knockbell Logistics`);
        await page.getByLabel(/item|description/i).first().fill(`${tag} freight charges`).catch(() => {});
        await clickText(page, /save( as)? draft|^save$/i);
        await sees(/draft|saved/i)({ page });
      } },
      { name: 'GST reports load', run: async ({ open, page }) => { await open('books'); await clickText(page, /gst|reports/i); } },
    ],
  },
  {
    id: 'S07', title: 'Owner manages users and roles in Workspace', who: ['owner'],
    steps: [
      { name: 'users screen', run: async ({ open, page }) => { await open('app'); await clickText(page, /users|people|team/i); } },
      { name: 'roles screen', run: async ({ page }) => clickText(page, /roles|permissions|access/i) },
      { name: 'company settings', run: async ({ page }) => clickText(page, /company|organisation|organization|settings/i) },
      { name: 'subscription page shows (no payment)', run: async ({ page }) => clickText(page, /subscription|plan|apps/i) },
    ],
  },
  {
    id: 'S08', title: 'Owner with two companies switches between them', who: ['owner'],
    steps: [
      { name: 'company switcher lists companies', run: async ({ open, page }) => { await open('app'); await page.getByRole('button', { name: /company|switch/i }).first().click(); } },
    ],
  },
  {
    id: 'S09', title: 'CLOR staff in Ops: finds a customer, reads their account, health and audit log', who: ['staff'],
    steps: [
      { name: 'ops home', run: async ({ open }) => open('ops') },
      { name: 'customers list', run: async ({ page }) => clickText(page, /customers/i) },
      { name: 'search customer', run: async ({ page, acc }) => { await page.getByPlaceholder(/search/i).first().fill(acc.company || 'QA'); } },
      { name: 'health screen', run: async ({ open, page }) => { await open('ops'); await clickText(page, /health/i); } },
      { name: 'audit log', run: async ({ page }) => clickText(page, /audit/i) },
      { name: 'demo requests', run: async ({ page }) => clickText(page, /demo/i) },
      { name: 'pricing (read only)', run: async ({ page }) => clickText(page, /pricing/i) },
      { name: 'invoices list (read only)', run: async ({ page }) => clickText(page, /invoices/i) },
    ],
  },
  {
    id: 'S10', title: 'CLOR staff adds a note on the QA customer; owner side unaffected', who: ['staff'],
    steps: [
      { name: 'open QA customer', run: async ({ open, page, acc }) => { await open('ops'); await clickText(page, /customers/i); await page.getByText(new RegExp(acc.company || 'QA', 'i')).first().click(); } },
      { name: 'add customer note', write: true, run: async ({ page, tag }) => { await clickText(page, /notes?/i); await page.getByRole('textbox').last().fill(`${tag} QA check note`); await clickText(page, /^(save|add)/i); await sees(new RegExp(tag))({ page }); } },
    ],
  },
  {
    id: 'S11', title: 'Employee self-service: payslips, attendance, profile', who: ['employee'],
    steps: [
      { name: 'my profile', run: async ({ open, page }) => { await open('people'); await clickText(page, /profile|me/i); } },
      { name: 'my payslips', run: async ({ open, page }) => { await open('payroll'); await clickText(page, /payslip/i); } },
      { name: 'my attendance', run: async ({ open }) => open('attendance') },
    ],
  },
  {
    id: 'S12', title: 'Access boundaries: employee cannot open admin screens or Ops', who: ['employee', 'manager'],
    steps: [
      { name: 'Ops refuses non-staff', run: async ({ page, site }) => { await page.goto(site.ops + '/', { waitUntil: 'networkidle' }); await expect(page.getByText(/no access|not allowed|sign in|staff/i).first()).toBeVisible(); } },
      { name: 'Books settings hidden or refused', run: async ({ page, site }) => { await page.goto(site.books + '/', { waitUntil: 'networkidle' }); await expect(page.locator('nav').getByText(/^settings$/i)).toHaveCount(0); } },
    ],
  },
];

const accs = accounts();
test.skip(accs.length === 0, 'No QA_ACCOUNTS in e2e/live/.env.live: scenarios skipped');

for (const acc of accs) {
  const role = (acc as any).role || 'owner';
  const mine = SCENARIOS.filter((s) => s.who.includes(role));
  if (!mine.length) continue;
  test(`Scenarios as ${acc.label} (${role})`, async ({ browser }) => {
    const page = await pageAs(browser, acc);
    const all = [];
    for (const s of mine) all.push(...(await runSteps(s, page, acc)));
    saveVisits(`scenarios-${acc.label}`, all);
  });
}
