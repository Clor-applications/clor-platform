import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';

import OpeningYtdSection from './OpeningYtdSection';
import OpeningYtdPanel from './OpeningYtdPanel';
import { getOpeningYtd, importOpeningYtd, listOpeningYtd, saveOpeningYtd, setFirstPayrollYear } from '../api/payrollTaxDeclarations';

vi.mock('../api/payrollTaxDeclarations', () => ({
  getOpeningYtd: vi.fn(),
  saveOpeningYtd: vi.fn(),
  deleteOpeningYtd: vi.fn(),
  listOpeningYtd: vi.fn(),
  importOpeningYtd: vi.fn(),
  setFirstPayrollYear: vi.fn(),
}));
vi.mock('@ui/components/ui/notify', () => ({ notify: { success: vi.fn(), error: vi.fn() }, confirmDialog: vi.fn().mockResolvedValue(true) }));

beforeEach(() => vi.clearAllMocks());

const meera = { employeeId: 'e1', name: 'Meera Shetty', code: 'M1', opening: null };

it('enters one person’s pay from before CLOR and saves it on its own', async () => {
  vi.mocked(getOpeningYtd).mockResolvedValue(null);
  vi.mocked(saveOpeningYtd).mockResolvedValue({ grossPay: 1080000, taxablePay: 1080000, tds: 115050, professionalTax: 0, employeePf: 0, throughMonth: '2026-09', note: null });
  const onChanged = vi.fn();
  const user = userEvent.setup();
  render(<OpeningYtdSection employeeId="e1" fy="2026-27" onChanged={onChanged} />);
  expect(screen.getByRole('region', { name: 'Earlier this year, before CLOR' })).toBeInTheDocument();
  expect(screen.getByText(/from April 2026 until payroll moved to CLOR/)).toBeInTheDocument();
  await waitFor(() => expect(screen.getByLabelText('Gross pay')).not.toBeDisabled());
  await user.type(screen.getByLabelText('Gross pay'), '1080000');
  await user.type(screen.getByLabelText('Income tax deducted'), '115050');
  await user.click(screen.getByRole('button', { name: 'Save these figures' }));
  await waitFor(() => expect(saveOpeningYtd).toHaveBeenCalledWith('e1', '2026-27', expect.objectContaining({ grossPay: '1080000', tds: '115050', taxablePay: '' })));
  expect(onChanged).toHaveBeenCalled();
  expect(await screen.findByRole('button', { name: 'Save changes' })).toBeInTheDocument();
});

it('lists who has no figures, and lets the owner say it is the first year', async () => {
  vi.mocked(listOpeningYtd).mockResolvedValue({ financialYear: '2026-27', firstPayrollYear: null, canSetFirstYear: true, people: [meera, { ...meera, employeeId: 'e2', name: 'Ravi Kumar', opening: { grossPay: 500000, tds: 0 } }] });
  vi.mocked(setFirstPayrollYear).mockResolvedValue({});
  const user = userEvent.setup();
  render(<OpeningYtdPanel fy="2026-27" />);
  await user.click(screen.getByRole('button', { name: 'Earlier this year' }));
  expect(await screen.findByRole('heading', { name: /Everyone in payroll · 1 without figures/ })).toBeInTheDocument();
  expect(screen.getByText('Not entered')).toBeInTheDocument();
  const button = screen.getByRole('button', { name: 'This is our first year' });
  expect(button).toBeDisabled();
  await user.type(screen.getByRole('combobox', { name: 'Why this is the first year' }), 'Registered in August 2026');
  await user.click(button);
  await waitFor(() => expect(setFirstPayrollYear).toHaveBeenCalledWith('2026-27', true, 'Registered in August 2026'));
});

it('offers someone who is not the owner no first-year answer', async () => {
  vi.mocked(listOpeningYtd).mockResolvedValue({ financialYear: '2026-27', firstPayrollYear: null, canSetFirstYear: false, people: [meera] });
  const user = userEvent.setup();
  render(<OpeningYtdPanel fy="2026-27" />);
  await user.click(screen.getByRole('button', { name: 'Earlier this year' }));
  expect(await screen.findByText(/the owner can say so here/)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'This is our first year' })).not.toBeInTheDocument();
});

it('shows each row the import refused, and saves nothing', async () => {
  vi.mocked(listOpeningYtd).mockResolvedValue({ financialYear: '2026-27', firstPayrollYear: null, canSetFirstYear: true, people: [meera] });
  const err = Object.assign(new Error('Nothing was saved: 1 row needs correcting.'), { data: { problems: [{ line: 3, message: 'Nobody in payroll has the code X9.' }] } });
  vi.mocked(importOpeningYtd).mockRejectedValue(err);
  const user = userEvent.setup();
  render(<OpeningYtdPanel fy="2026-27" />);
  await user.click(screen.getByRole('button', { name: 'Earlier this year' }));
  await screen.findByRole('heading', { name: /Everyone in payroll/ });
  const file = new File(['code,gross\nX9,1\n'], 'opening.csv', { type: 'text/csv' });
  await user.upload(screen.getByLabelText('Choose the file to import'), file);
  expect(await screen.findByText('Row 3: Nobody in payroll has the code X9.')).toBeInTheDocument();
  expect(importOpeningYtd).toHaveBeenCalledWith('2026-27', 'code,gross\nX9,1\n');
});
