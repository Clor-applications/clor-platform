import React from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import PayrollReports from './PayrollReports';

/*
 * Server picks, theme C: the salary register opens short (gross, deductions,
 * take-home), a row opens into its parts, and "Show every part" lays out the
 * full table. Same payslip figures throughout; nothing is worked out again.
 */
const REGISTER = {
  periods: [{ id: 'period-1', name: 'October 2026' }],
  columns: [
    { code: 'BASIC', name: 'Basic', type: 'EARNING', displayOrder: 1 },
    { code: 'HRA', name: 'House rent', type: 'EARNING', displayOrder: 2 },
    { code: 'PF', name: 'Provident fund', type: 'DEDUCTION', displayOrder: 3 },
  ],
  rows: [
    { slipId: 's1', employeeName: 'Asha', employeeCode: 'E1', amounts: { BASIC: 20000, HRA: 8000, PF: 1800 }, grossEarnings: 28000, totalDeductions: 1800, netPay: 26200 },
    { slipId: 's2', employeeName: 'Ravi', employeeCode: 'E2', amounts: { BASIC: 15000, PF: 1800 }, grossEarnings: 15000, totalDeductions: 1800, netPay: 13200 },
  ],
  totals: { amounts: { BASIC: 35000, HRA: 8000, PF: 3600 }, grossEarnings: 43000, totalDeductions: 3600, netPay: 39400 },
};

vi.mock('../api/payrollCalendar', () => ({ listPayrollPeriods: vi.fn().mockResolvedValue([{ id: 'period-1', name: 'October 2026' }]) }));
vi.mock('../api/payrollReports', () => ({
  getSalaryRegister: vi.fn(async () => REGISTER),
  getStatutoryReport: vi.fn(), getVarianceReport: vi.fn(), getCostReport: vi.fn(), getFilings: vi.fn(),
}));
vi.mock('@ui/components/ui/notify', () => ({ notify: { success: vi.fn(), error: vi.fn() }, confirmDialog: vi.fn() }));
vi.mock('@platform/context', async (orig) => ({ ...(await orig()), requestOpenScreen: vi.fn() }));

it('opens short, a row opens into its parts, and every part shows the full table', async () => {
  const user = userEvent.setup();
  render(<PayrollReports />);
  const asha = await screen.findByRole('button', { name: /Asha/ });
  const table = screen.getByRole('table');
  expect(within(table).queryByRole('columnheader', { name: 'Basic' })).toBeNull();
  expect(within(table).getByRole('columnheader', { name: 'Take-home' })).toBeTruthy();
  expect(within(table).getByText('2 people')).toBeTruthy();

  expect(asha.getAttribute('aria-expanded')).toBe('false');
  await user.click(asha);
  expect(asha.getAttribute('aria-expanded')).toBe('true');
  expect(within(screen.getByLabelText('Asha earnings')).getByText('House rent')).toBeTruthy();
  expect(within(screen.getByLabelText('Asha deductions')).getByText('Provident fund')).toBeTruthy();
  expect(screen.queryByLabelText('Ravi earnings')).toBeNull();

  await user.click(screen.getByRole('button', { name: 'Show every part' }));
  expect(screen.getByRole('columnheader', { name: 'Basic' })).toBeTruthy();
  expect(screen.getByRole('columnheader', { name: 'House rent' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Show the short register' })).toBeTruthy();
});

it('checks the PF and ESI files before download, and Fix opens the person (round 26 and 44)', async () => {
  const { getFilings } = await import('../api/payrollReports');
  const { requestOpenScreen } = await import('@platform/context');
  getFilings.mockResolvedValue({
    slips: 3,
    waiting: 0,
    ecr: {
      text: 'x', rows: [{ uan: '1' }, { uan: '2' }], totals: { members: 2, epfWages: 1, employee: 1, eps: 1, epf: 1 },
      problems: [{ employeeId: 'e3', name: 'Nobody Uan', kind: 'NO_UAN', message: 'No UAN on file, so they are left out of the ECR.' }],
      checklist: { ready: 2, leftOut: 1, byKind: { NO_UAN: 1 } },
    },
    esic: { rows: [], totals: { people: 0, wages: 0, employee: 0, employer: 0 }, problems: [], checklist: { ready: 0, leftOut: 0, byKind: {} } },
    pt: { states: [], rows: [], problems: [] },
    lwf: { states: [], rows: [], problems: [] },
  });
  const user = userEvent.setup();
  render(<PayrollReports />);
  await screen.findByRole('button', { name: /Asha/ });
  await user.selectOptions(document.getElementById('report-kind'), 'filings');
  expect(await screen.findByText('2 ready · 1 without a UAN')).toBeTruthy();
  expect(screen.getByRole('button', { name: /Download ECR/ })).toBeTruthy();
  expect(screen.getByRole('button', { name: /Download ESIC file/ }).hasAttribute('disabled')).toBe(true);
  await user.click(screen.getByRole('button', { name: 'Fix Nobody Uan' }));
  expect(requestOpenScreen).toHaveBeenCalledWith('assignments', { employeeId: 'e3', tab: 'details' });
});
