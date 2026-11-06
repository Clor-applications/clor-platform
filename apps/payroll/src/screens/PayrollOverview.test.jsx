import React from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';

import PayrollOverview from './PayrollOverview';
import { getPayrollOverview } from '../api/payrollOverview';
import { getPayrollSetup } from '../api/payrollSetup';

vi.mock('../api/payrollOverview', () => ({ getPayrollOverview: vi.fn() }));
vi.mock('../api/payrollSetup', () => ({ getPayrollSetup: vi.fn() }));

const period = { id: 'p1', name: 'November 2026', startDate: '2026-11-01', endDate: '2026-11-30', paymentDate: '2026-11-30' };
const statutory = [
  { code: 'PF', output: 'PF ECR', enabled: true, period: 'October 2026', periodId: 'p0', dueDate: '2026-11-15', people: 4, amount: 7200, problems: 1, screen: 'reports' },
  { code: 'ESI', output: 'ESI contributions', enabled: true, period: 'October 2026', dueDate: '2026-11-15', people: 3, amount: 1200, problems: 0, screen: 'reports' },
  { code: 'PT', output: 'PT returns', enabled: false, period: 'October 2026', dueDate: null, people: 0, amount: 0, problems: 0, screen: 'reports' },
  { code: 'TDS', output: 'TDS 24Q', enabled: true, period: 'Q3 FY 2026-27', dueDate: '2027-01-31', people: 0, amount: 0, problems: 0, screen: 'taxDeclarations' },
  { code: 'FORM16', output: 'Form 16', enabled: true, period: 'FY 2025-26', dueDate: '2026-06-15', people: 2, amount: 50000, problems: 0, screen: 'taxDeclarations' },
];
const overview = (patch = {}) => ({
  currentPeriod: period,
  currentRun: { id: 'r1', number: 'PR-0004', status: 'APPROVED', stage: 'Approved, not paid', employeeCount: 4, gross: 200000, deductions: 20000, net: 180000, employerCost: 215000 },
  people: { headcount: 5, inPayroll: 4, onHold: 0, withoutSalary: 0, orphaned: 0 },
  previous: null,
  latest: null,
  trend: [],
  pending: { adjustments: 0, adjustmentValue: 0, unapprovedAdjustments: 0, loans: 0, loanOutstanding: 0, revisions: 0 },
  salaries: { structures: 2, onStructure: 4, withoutSalary: 0, slips: 4, slipsFinal: 4 },
  payouts: { runId: 'r1', net: 180000, paid: 90000, paidCount: 2, failedCount: 1, inProgress: 0, batches: 1 },
  settlements: { drafts: 1, approved: 1, overdue: 1, payable: 42000, notStarted: 2 },
  statutory,
  bankChanges: 1,
  blockers: [
    { code: 'PAYOUTS_FAILED', message: '1 payment came back from the bank unpaid, and those people have not been paid.', count: 1 },
    { code: 'ORPHANED_PAYROLL_PROFILES', message: '1 payroll record belongs to somebody who is no longer in the staff directory.', count: 1 },
  ],
  ...patch,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getPayrollSetup).mockResolvedValue({ ready: true, done: 6, total: 6 });
});

it('shows where the run is as steps, with the one it is on marked', async () => {
  vi.mocked(getPayrollOverview).mockResolvedValue(overview());
  render(<PayrollOverview />);
  const steps = await screen.findByRole('list', { name: 'Where this payroll is' });
  const items = within(steps).getAllByRole('listitem');
  expect(items.map((li) => li.textContent)).toEqual(['Calculated', 'Checked', 'Approved', '4Paid', '5In the books']);
  expect(items[3]).toHaveAttribute('aria-current', 'step');
});

it('opens the screen that deals with each thing in the way, and leaves one with no screen as words', async () => {
  vi.mocked(getPayrollOverview).mockResolvedValue(overview());
  const openScreen = vi.fn();
  const user = userEvent.setup();
  render(<PayrollOverview openScreen={openScreen} />);
  const list = (await screen.findByText('What is in the way')).parentElement;
  const fixes = within(list).getAllByRole('button');
  expect(fixes.map((b) => b.textContent)).toEqual(['Payments']);
  await user.click(fixes[0]);
  expect(openScreen).toHaveBeenCalledWith('payments', undefined);
});

it('the main action opens the pay run, not a dead link', async () => {
  vi.mocked(getPayrollOverview).mockResolvedValue(overview());
  const openScreen = vi.fn();
  const user = userEvent.setup();
  render(<PayrollOverview openScreen={openScreen} />);
  await user.click(await screen.findByRole('button', { name: /Open this payroll/ }));
  expect(openScreen).toHaveBeenCalledWith('runs', undefined);
});

it('reads each module from its own figures', async () => {
  vi.mocked(getPayrollOverview).mockResolvedValue(overview());
  render(<PayrollOverview />);

  const salaries = await screen.findByRole('region', { name: 'Salaries and payslips' });
  expect(within(salaries).getByText('4 of 4')).toBeInTheDocument();
  expect(within(salaries).getByText('4, approved')).toBeInTheDocument();

  const payouts = screen.getByRole('region', { name: 'Bank payouts' });
  expect(within(payouts).getByText('Sent back by the bank').nextSibling).toHaveTextContent('1');
  expect(within(payouts).getByText('Bank detail changes waiting')).toBeInTheDocument();

  const fnf = screen.getByRole('region', { name: 'Full and final' });
  expect(within(fnf).getByText('Left, not started').nextSibling).toHaveTextContent('2');
  expect(within(fnf).getByText('Past the due date').nextSibling).toHaveTextContent('1');
});

it('says what each return would carry, and never that it was filed', async () => {
  vi.mocked(getPayrollOverview).mockResolvedValue(overview());
  const openScreen = vi.fn();
  const user = userEvent.setup();
  render(<PayrollOverview openScreen={openScreen} />);
  const returns = await screen.findByRole('region', { name: 'Statutory returns' });
  const row = (name) => within(returns).getByRole('button', { name }).closest('tr');

  expect(within(row('PF ECR')).getByText('1 left out')).toBeInTheDocument();
  expect(within(row('PF ECR')).getByText('15/11/2026')).toBeInTheDocument();
  expect(within(row('ESI contributions')).getByText('Ready')).toBeInTheDocument();
  expect(within(row('PT returns')).getByText('Not switched on')).toBeInTheDocument();
  expect(within(row('TDS 24Q')).getByText('Nothing due')).toBeInTheDocument();
  expect(within(returns).queryByText(/filed/i)).toBeNull();

  await user.click(within(returns).getByRole('button', { name: 'PF ECR' }));
  expect(openScreen).toHaveBeenLastCalledWith('reports', { report: 'filings', periodId: 'p0' });
  await user.click(within(returns).getByRole('button', { name: 'PT returns' }));
  expect(openScreen).toHaveBeenLastCalledWith('compliance', undefined);
  await user.click(within(returns).getByRole('button', { name: 'TDS 24Q' }));
  expect(openScreen).toHaveBeenLastCalledWith('taxDeclarations', undefined);
});

it('has nothing to pay before the month is run', async () => {
  vi.mocked(getPayrollOverview).mockResolvedValue(
    overview({ currentRun: null, payouts: { runId: null, net: 0, paid: 0, paidCount: 0, failedCount: 0, inProgress: 0, batches: 0 }, blockers: [] })
  );
  render(<PayrollOverview />);
  const payouts = await screen.findByRole('region', { name: 'Bank payouts' });
  expect(within(payouts).getByText('Nothing to pay until November 2026 is run.')).toBeInTheDocument();
  expect(screen.queryByRole('list', { name: 'Where this payroll is' })).toBeNull();
});

it('keeps the figure marks by meaning', async () => {
  vi.mocked(getPayrollOverview).mockResolvedValue(overview());
  const { container } = render(<PayrollOverview />);
  await screen.findByText('In payroll');
  expect([...container.querySelectorAll('[data-tint]')].map((n) => n.dataset.tint)).toEqual(['sky', 'lilac', 'peach', 'mint']);
});
