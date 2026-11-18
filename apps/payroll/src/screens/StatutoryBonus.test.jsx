import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import StatutoryBonus from './StatutoryBonus';
import { REGISTER_COLUMNS, yearOf } from '../components/bonusText';
import { approveBonus, getBonusRegister, getBonusYear, saveBonusSettings, workOutBonus } from '../api/payrollBonus';
import { downloadCsv } from '@ui/utils/csv';

const RULES = { eligibilityCeiling: 21000, calculationCeiling: 7000, minimumWage: 0, minPercent: 8.33, maxPercent: 20, minimumAmount: 100, minDays: 30 };
const NOTES = Object.fromEntries(Object.keys(RULES).map((k) => [k, `Payment of Bonus Act note for ${k}. Check the current rule.`]));

vi.mock('../api/payrollBonus', () => ({
  getBonusYear: vi.fn(),
  getBonusSettings: vi.fn(() => Promise.resolve({ rules: RULES, defaults: RULES, notes: NOTES })),
  saveBonusSettings: vi.fn(() => Promise.resolve({})),
  workOutBonus: vi.fn(),
  approveBonus: vi.fn(),
  cancelBonus: vi.fn(),
  getBonusRegister: vi.fn(),
}));
vi.mock('../api/payrollCalendar', () => ({ listPayrollPeriods: vi.fn().mockResolvedValue([{ id: 'period-nov', name: 'November 2027', isLocked: false }]) }));
vi.mock('@ui/utils/csv', () => ({ downloadCsv: vi.fn() }));
vi.mock('@ui/components/ui/notify', () => ({ notify: { success: vi.fn(), error: vi.fn() }, confirmDialog: vi.fn() }));
vi.mock('@ui/components/ui/Drawer', () => ({ default: ({ open, title, children, footer }) => (open ? <aside aria-label={title}>{children}{footer}</aside> : null) }));

const line = (o) => ({ id: o.employeeId, code: '', designation: '', months: [], adjustmentId: null, reason: '', bonusWages: 0, ...o });
const draft = {
  id: 'run-1', financialYear: '2026-27', status: 'DRAFT', ratePercent: 8.33, rules: RULES, totalAmount: 1166.2, eligibleCount: 1,
  lines: [
    line({ employeeId: 'asha', name: 'Asha Rao', code: 'B101', daysWorked: 61, wages: 20000, bonusWages: 14000, amount: 1166.2, eligible: true }),
    line({ employeeId: 'bala', name: 'Bala Nair', daysWorked: 61, wages: 50000, amount: 0, eligible: false, reason: 'Basic + DA was above ₹21,000 a month all year.' }),
  ],
};

beforeEach(() => vi.clearAllMocks());

it('reads the financial year from a date', () => {
  expect(yearOf(new Date(2027, 2, 31))).toBe('2026-27');
  expect(yearOf(new Date(2027, 3, 1))).toBe('2027-28');
  expect(REGISTER_COLUMNS.map((c) => c.label)).toContain('Days worked in the year');
});

it('works out a year with no bonus yet at the share given', async () => {
  vi.mocked(getBonusYear).mockResolvedValue({ financialYear: '2026-27', rules: RULES, run: null, history: [] });
  vi.mocked(workOutBonus).mockResolvedValue({ run: draft });
  const user = userEvent.setup();
  render(<StatutoryBonus />);
  expect(await screen.findByRole('heading', { name: 'Statutory bonus' })).toBeTruthy();
  expect(await screen.findByText(/No bonus worked out/)).toBeTruthy();
  expect(screen.getByRole('note').textContent).toMatch(/check the current rule/);
  const share = screen.getByLabelText('Bonus share (%)');
  await user.clear(share);
  await user.type(share, '12');
  await user.click(screen.getByRole('button', { name: /Work out bonus/ }));
  await waitFor(() => expect(workOutBonus).toHaveBeenCalledWith(expect.objectContaining({ ratePercent: 12 })));
});

it('lists who qualifies first, says why the rest do not, and approves into a month', async () => {
  vi.mocked(getBonusYear).mockResolvedValue({ financialYear: '2026-27', rules: RULES, run: draft, history: [] });
  vi.mocked(approveBonus).mockResolvedValue({ earnings: 1, waiting: 0, periodName: 'November 2027' });
  const user = userEvent.setup();
  render(<StatutoryBonus />);
  const rows = await screen.findAllByRole('row');
  expect(within(rows[1]).getByText('Asha Rao')).toBeTruthy();
  expect(within(rows[2]).getByText('Does not qualify')).toBeTruthy();
  expect(within(rows[2]).getByText(/above ₹21,000/)).toBeTruthy();
  await user.click(screen.getByRole('button', { name: 'Approve bonus' }));
  const panel = await screen.findByRole('complementary', { name: 'Approve bonus' });
  await waitFor(() => expect(within(panel).getByRole('combobox')).toHaveValue('period-nov'));
  await user.click(within(panel).getByRole('button', { name: 'Approve bonus' }));
  await waitFor(() => expect(approveBonus).toHaveBeenCalledWith('run-1', 'period-nov'));
});

it('downloads the Form C register for an approved run', async () => {
  vi.mocked(getBonusYear).mockResolvedValue({ financialYear: '2026-27', rules: RULES, run: { ...draft, status: 'APPROVED' }, history: [] });
  vi.mocked(getBonusRegister).mockResolvedValue({ run: { ...draft, status: 'APPROVED' }, rows: [{ serial: 1, name: 'Asha Rao' }] });
  const user = userEvent.setup();
  render(<StatutoryBonus />);
  await user.click(await screen.findByRole('button', { name: /Download register/ }));
  await waitFor(() => expect(downloadCsv).toHaveBeenCalled());
  const arg = vi.mocked(downloadCsv).mock.calls[0][0];
  expect(arg.prefixRows[0][0]).toMatch(/^Form C/);
  expect(arg.columns.map((c) => c.key)).toEqual(expect.arrayContaining(['fatherName', 'daysWorked', 'bonusPayable', 'netPayable', 'paidOn']));
});

it('keeps the Act figures editable, each with its note', async () => {
  vi.mocked(getBonusYear).mockResolvedValue({ financialYear: '2026-27', rules: RULES, run: null, history: [] });
  const user = userEvent.setup();
  render(<StatutoryBonus />);
  await user.click(await screen.findByRole('button', { name: /Rules/ }));
  const panel = await screen.findByRole('complementary', { name: 'Bonus rules' });
  const ceiling = await within(panel).findByLabelText('Counts up to (basic + DA a month)');
  expect(within(panel).getAllByText(/Check the current rule/).length).toBe(7);
  await user.clear(ceiling);
  await user.type(ceiling, '25000');
  expect(within(panel).getByText(/figure as last checked: 21000/)).toBeTruthy();
  await user.click(within(panel).getByRole('button', { name: 'Save rules' }));
  await waitFor(() => expect(saveBonusSettings).toHaveBeenCalledWith(expect.objectContaining({ eligibilityCeiling: 25000, minDays: 30 })));
});
