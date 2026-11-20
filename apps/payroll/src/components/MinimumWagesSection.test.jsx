import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';

import MinimumWagesSection, { MinimumWageReminder } from './MinimumWagesSection';
import { inForceIds } from './minimumWageText';
import { addMinimumWage, getMinimumWages, importMinimumWages } from '../api/payrollMinimumWages';
import { requestOpenScreen } from '@platform/context';

vi.mock('../api/payrollMinimumWages', () => ({ getMinimumWages: vi.fn(), addMinimumWage: vi.fn(), importMinimumWages: vi.fn(), removeMinimumWage: vi.fn() }));
vi.mock('@ui/components/ui/notify', () => ({ notify: { success: vi.fn(), error: vi.fn() }, confirmDialog: vi.fn(() => Promise.resolve(true)) }));
vi.mock('@platform/context', () => ({ requestOpenScreen: vi.fn() }));

beforeEach(() => vi.clearAllMocks());

/* Test figures only, not a state's notified rates. */
const row = (id, effectiveFrom, monthlyRate, zone = '') => ({ id, state: 'KARNATAKA', stateLabel: 'Karnataka', zone, skill: 'SEMI_SKILLED', skillLabel: 'semi-skilled', effectiveFrom, monthlyRate, note: '' });

it('marks the rate in force per state, zone and skill level', () => {
  const ids = inForceIds([row('a', '2026-04-01', 1), row('b', '2026-10-01', 2), row('c', '2027-04-01', 3), row('z', '2026-04-01', 4, 'Zone I')], '2026-11-19');
  expect([...ids].sort()).toEqual(['b', 'z']);
});

it('ships empty, saying where the rates come from, and adds one', async () => {
  getMinimumWages.mockResolvedValue({ rates: [], reminder: null, columns: [] });
  addMinimumWage.mockResolvedValue({ id: 'n1', replaced: false });
  render(<MinimumWagesSection />);
  expect(await screen.findByText(/CLOR does not supply minimum wage rates/)).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Chief Labour Commissioner' })).toHaveAttribute('href', 'https://clc.gov.in/');
  await userEvent.click(screen.getByRole('button', { name: 'Add a rate' }));
  await userEvent.selectOptions(screen.getByLabelText('State'), 'Karnataka');
  await userEvent.selectOptions(screen.getByLabelText('Skill level'), 'SEMI_SKILLED');
  await userEvent.type(screen.getByLabelText('Applies from'), '2026-10-01');
  await userEvent.type(screen.getByLabelText('Monthly rate'), '15,500');
  await userEvent.click(screen.getByRole('button', { name: 'Save rate' }));
  await waitFor(() => expect(addMinimumWage).toHaveBeenCalledWith(expect.objectContaining({ state: 'Karnataka', skill: 'SEMI_SKILLED', effectiveFrom: '2026-10-01', monthlyRate: 15500 })));
});

it('lists the lines a CSV import refused', async () => {
  getMinimumWages.mockResolvedValue({ rates: [row('a', '2026-04-01', 15000)], reminder: { message: 'States revise minimum wages in April and October. No October 2026 rates yet for Karnataka: add them from the state’s notification.' } });
  const err = Object.assign(new Error('Nothing was saved: one line needs fixing.'), { data: { errors: [{ line: 3, error: 'Monthly rate is an amount above zero.' }] } });
  importMinimumWages.mockRejectedValue(err);
  const { container } = render(<MinimumWagesSection />);
  expect(await screen.findByText(/No October 2026 rates yet for Karnataka/)).toBeInTheDocument();
  expect(screen.getByText('In force')).toBeInTheDocument();
  const input = container.querySelector('input[type="file"]');
  await userEvent.upload(input, new File(['state,skill,effective_from,monthly_rate\n'], 'rates.csv', { type: 'text/csv' }));
  expect(await screen.findByText('Line 3: Monthly rate is an amount above zero.')).toBeInTheDocument();
});

it('reminds on the overview and opens the rates', async () => {
  getMinimumWages.mockResolvedValue({ rates: [], reminder: { message: 'States revise minimum wages in April and October.' } });
  render(<MinimumWageReminder />);
  await userEvent.click(await screen.findByRole('button', { name: 'Update rates' }));
  expect(requestOpenScreen).toHaveBeenCalledWith('compliance', { scheme: 'MINWAGE' });
});
