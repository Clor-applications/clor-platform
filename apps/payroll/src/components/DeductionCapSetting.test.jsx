import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';

import { DeductionCapNotice, DeductionCapSetting } from './DeductionCapSetting';
import { getDeductionCap, saveDeductionCap } from '../api/payrollSetup';

vi.mock('../api/payrollSetup', () => ({ getDeductionCap: vi.fn(), saveDeductionCap: vi.fn() }));
vi.mock('@ui/components/ui/notify', () => ({ notify: { success: vi.fn(), error: vi.fn() } }));

beforeEach(() => vi.clearAllMocks());

it('explains the limit, refuses more than half, and saves', async () => {
  vi.mocked(getDeductionCap).mockResolvedValue({ percent: 50, countsStatutory: true });
  vi.mocked(saveDeductionCap).mockResolvedValue({ percent: 40, countsStatutory: false });
  const user = userEvent.setup();
  render(<DeductionCapSetting />);

  const share = await screen.findByRole('spinbutton', { name: /Share of wages/ });
  const statutory = screen.getByRole('checkbox', { name: /Count PF, ESI/ });
  expect(statutory).toBeChecked();
  expect(screen.getByText(/check with your adviser/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();

  await user.clear(share);
  await user.type(share, '75');
  expect(screen.getByText('A whole number from 10 to 50.')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();

  await user.clear(share);
  await user.type(share, '40');
  await user.click(statutory);
  await user.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(saveDeductionCap).toHaveBeenCalledWith({ percent: 40, countsStatutory: false }));
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
