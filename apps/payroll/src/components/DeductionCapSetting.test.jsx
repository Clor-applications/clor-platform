import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';

import { DeductionCapNotice, DeductionCapSetting, OverLimitPanel } from './DeductionCapSetting';
import { getDeductionCap, saveDeductionCap } from '../api/payrollSetup';
import { recordOverLimitReason } from '../api/payrollRuns';

vi.mock('../api/payrollSetup', () => ({ getDeductionCap: vi.fn(), saveDeductionCap: vi.fn() }));
vi.mock('../api/payrollRuns', () => ({ recordOverLimitReason: vi.fn() }));
vi.mock('@ui/components/ui/notify', () => ({ notify: { success: vi.fn(), error: vi.fn() } }));

beforeEach(() => vi.clearAllMocks());

it('explains the limit, refuses more than half, and saves', async () => {
  vi.mocked(getDeductionCap).mockResolvedValue({ percent: 50, countsStatutory: true, countsPenalties: true });
  vi.mocked(saveDeductionCap).mockResolvedValue({ percent: 40, countsStatutory: false, countsPenalties: false });
  const user = userEvent.setup();
  render(<DeductionCapSetting />);

  const share = await screen.findByRole('spinbutton', { name: /Share of wages/ });
  const statutory = screen.getByRole('checkbox', { name: /Count PF, ESI/ });
  expect(statutory).toBeChecked();
  expect(screen.getByText(/check with your adviser/)).toBeInTheDocument();
  const penalties = screen.getByRole('checkbox', { name: /late-mark penalties/ });
  expect(penalties).toBeChecked();
  expect(screen.getByText(/limited to 3% of wages \(s\.19\)/)).toBeInTheDocument();
  expect(screen.getByText(/s\.18\(3\)/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();

  await user.clear(share);
  await user.type(share, '75');
  expect(screen.getByText('A whole number from 10 to 50.')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();

  await user.clear(share);
  await user.type(share, '40');
  await user.click(statutory);
  await user.click(penalties);
  await user.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(saveDeductionCap).toHaveBeenCalledWith({ percent: 40, countsStatutory: false, countsPenalties: false }));
});

it('says so when the setting cannot be read', async () => {
  vi.mocked(getDeductionCap).mockRejectedValue(new Error('No access'));
  render(<DeductionCapSetting />);
  expect(await screen.findByRole('alert')).toHaveTextContent('No access');
});

it('shows the run message the server sends, and nothing otherwise', () => {
  const message = 'Deductions held to 50% of wages for 1 person: ₹5,000 carried to next month.';
  const { rerender, container } = render(<DeductionCapNotice run={{ deductionCapMessage: message }} />);
  expect(screen.getByRole('status')).toHaveTextContent(message);
  rerender(<DeductionCapNotice run={{ deductionCapMessage: null }} />);
  expect(container).toBeEmptyDOMElement();
});

it('lists who passes the limit, takes a reason, and shows it once recorded', async () => {
  vi.mocked(recordOverLimitReason).mockResolvedValue({});
  const onSaved = vi.fn();
  const user = userEvent.setup();
  const people = [{ employeeId: 'e1', name: 'Tanmay', counted: 6000, limit: 5000, percent: 10 }];
  const { rerender } = render(<OverLimitPanel run={{ id: 'r1', status: 'CALCULATED', overLimit: { people, reason: null } }} onSaved={onSaved} />);
  expect(screen.getByRole('heading', { name: 'Deductions pass 10% of wages for 1 person' })).toBeInTheDocument();
  expect(screen.getByText('₹6,000 of ₹5,000 allowed')).toBeInTheDocument();
  const record = screen.getByRole('button', { name: 'Record reason' });
  expect(record).toBeDisabled();
  await user.type(screen.getByRole('combobox', { name: /Why do they stand/ }), 'Signed damage agreement');
  await user.click(record);
  await waitFor(() => expect(recordOverLimitReason).toHaveBeenCalledWith('r1', 'Signed damage agreement'));
  expect(onSaved).toHaveBeenCalled();
  rerender(<OverLimitPanel run={{ id: 'r1', status: 'CALCULATED', overLimit: { people, reason: 'Signed damage agreement' } }} />);
  expect(screen.getByText('Recorded why they stand: Signed damage agreement')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Record reason' })).toBeNull();
});

it('shows nothing when nobody passes the limit', () => {
  const { container } = render(<OverLimitPanel run={{ id: 'r1', status: 'CALCULATED', overLimit: null }} />);
  expect(container).toBeEmptyDOMElement();
});
