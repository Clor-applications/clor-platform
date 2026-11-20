import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';

import WeeklyWages from './WeeklyWages';
import { listPayGroups } from '../api/payrollCalendar';
import { approveWageSheet, editWageLine, getWageSheet, listWageRates, listWageSheets, wageMonth } from '../api/payrollWeeklyWages';

vi.mock('../api/payrollCalendar', () => ({ listPayGroups: vi.fn() }));
vi.mock('../api/payrollPeople', () => ({ listEmployees: vi.fn().mockResolvedValue({ employees: [] }) }));
vi.mock('../api/payrollWeeklyWages', () => ({
  listWageRates: vi.fn(), saveWageRate: vi.fn(), listWageSheets: vi.fn(), nextSheetStart: vi.fn().mockResolvedValue(null), getWageSheet: vi.fn(),
  makeWageSheet: vi.fn(), editWageLine: vi.fn(), refreshWageSheet: vi.fn(), approveWageSheet: vi.fn(), reopenWageSheet: vi.fn(), markWageSheetPaid: vi.fn(),
  deleteWageSheet: vi.fn(), bankFileSummary: vi.fn().mockResolvedValue(null), bankFileCsv: vi.fn(), wageSlip: vi.fn(), wageMonth: vi.fn(), wageMonthFile: vi.fn(), saveText: vi.fn(),
}));
vi.mock('@ui/components/ui/notify', () => ({ notify: { success: vi.fn(), error: vi.fn() }, confirmDialog: vi.fn() }));

const group = { id: 'g1', name: 'Site labour', frequency: 'WEEKLY' };
const sheet = { id: 's1', payGroupId: 'g1', payGroupName: 'Site labour', startDate: '2027-01-25', endDate: '2027-01-31', wageMonth: '2027-01', lastOfMonth: true, status: 'DRAFT', gross: 5200, deductions: 1035, net: 4165, workers: 1 };
const line = { id: 'l1', employeeId: 'e1', name: 'Ravi Kumar', code: 'W1', daysWorked: 6, dailyRate: 800, overtimeHours: 2, overtimeAmount: 400, gross: 5200, pfWage: 4800, pfEmployee: 576, esiEmployee: 39, ptEmployee: 0, canteen: 120, advanceRecovery: 300, net: 4165, hasBankAccount: true, explanations: [] };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listPayGroups).mockResolvedValue([group, { id: 'g2', name: 'Staff', frequency: 'MONTHLY' }]);
  vi.mocked(listWageSheets).mockResolvedValue([sheet]);
  vi.mocked(listWageRates).mockResolvedValue([{ id: 'r1', employeeId: 'e1', name: 'Ravi Kumar', code: 'W1', payGroupName: 'Site labour', dailyRate: 800, canteenPerDay: 20, advanceBalance: 700, advancePerSheet: 300, isActive: true }]);
});

it('lists wage sheets under the menu name, with one primary action', async () => {
  render(<WeeklyWages />);
  expect(await screen.findByRole('heading', { level: 1, name: 'Weekly wages' })).toBeTruthy();
  expect(await screen.findByText('25 Jan – 31 Jan 2027')).toBeTruthy();
  expect(screen.getByText('Last of the month')).toBeTruthy();
  expect(screen.getByRole('button', { name: /Make wage sheet/ })).toBeEnabled();
});

it('shows daily rates and the month', async () => {
  vi.mocked(wageMonth).mockImplementation(async (month) => ({ month, drafts: 1, rows: [{ employeeId: 'e1', name: 'Ravi Kumar', uan: '100000000001', daysWorked: 24, gross: 19600, pfWage: 19200, pfEmployee: 1800, pfEmployer: 1800, esiEmployee: 147, esiEmployer: 637, ptEmployee: 0, net: 16000 }], totals: { workers: 1, gross: 19600, pfEmployee: 1800, pfEmployer: 1800, esiEmployee: 147, esiEmployer: 637, ptEmployee: 0, net: 16000 }, missingUan: [] }));
  const user = userEvent.setup();
  render(<WeeklyWages />);
  await screen.findByText('25 Jan – 31 Jan 2027');
  await user.click(screen.getByRole('tab', { name: /Daily rates/ }));
  expect(await screen.findByRole('button', { name: 'Ravi Kumar' })).toBeTruthy();
  expect(screen.getByRole('button', { name: /Add worker/ })).toBeTruthy();
  await user.click(screen.getByRole('tab', { name: /The month/ }));
  expect(await screen.findByText(/1 draft sheet is not counted/)).toBeTruthy();
  expect(screen.getByRole('button', { name: /PF ECR file/ })).toBeEnabled();
});

it('opens a draft sheet, changes days and approves it', async () => {
  vi.mocked(getWageSheet).mockResolvedValue({ ...sheet, lines: [line] });
  vi.mocked(editWageLine).mockResolvedValue({ ...sheet, lines: [{ ...line, daysWorked: 5 }] });
  vi.mocked(approveWageSheet).mockResolvedValue({ ...sheet, status: 'APPROVED', lines: [line] });
  const user = userEvent.setup();
  render(<WeeklyWages />);
  await user.click(await screen.findByRole('button', { name: '25 Jan – 31 Jan 2027' }));
  expect(await screen.findByRole('heading', { level: 1, name: 'Wages for 25 Jan – 31 Jan 2027' })).toBeTruthy();
  const days = screen.getByRole('textbox', { name: 'Days for Ravi Kumar' });
  await user.clear(days);
  await user.type(days, '5');
  await user.tab();
  await waitFor(() => expect(editWageLine).toHaveBeenCalledWith('s1', 'l1', { daysWorked: 5 }));
  const row = screen.getByText('Ravi Kumar').closest('tr');
  expect(within(row).getByText('₹576')).toBeTruthy();
  await user.click(screen.getByRole('button', { name: /Approve/ }));
  await waitFor(() => expect(approveWageSheet).toHaveBeenCalledWith('s1'));
  expect(await screen.findByRole('button', { name: /Mark paid/ })).toBeTruthy();
});

it('says so when there is no weekly pay group', async () => {
  vi.mocked(listPayGroups).mockResolvedValue([{ id: 'g2', name: 'Staff', frequency: 'MONTHLY' }]);
  vi.mocked(listWageSheets).mockResolvedValue([]);
  vi.mocked(listWageRates).mockResolvedValue([]);
  render(<WeeklyWages />);
  expect(await screen.findByText('No weekly pay group yet')).toBeTruthy();
  expect(screen.getByRole('button', { name: /Make wage sheet/ })).toBeDisabled();
});
