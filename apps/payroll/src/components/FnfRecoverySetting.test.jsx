import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';

import { FnfRecoverySetting } from './FnfRecoverySetting';
import { getFnfRecoveryCap, saveFnfRecoveryCap } from '../api/payrollSetup';

vi.mock('../api/payrollSetup', () => ({ getFnfRecoveryCap: vi.fn(), saveFnfRecoveryCap: vi.fn() }));
vi.mock('@ui/components/ui/notify', () => ({ notify: { success: vi.fn(), error: vi.fn() } }));

beforeEach(() => vi.clearAllMocks());

it('explains what counts as final wages, refuses more than half, and saves for the owner', async () => {
  vi.mocked(getFnfRecoveryCap).mockResolvedValue({ percent: 50, canEdit: true });
  vi.mocked(saveFnfRecoveryCap).mockResolvedValue({ percent: 40, canEdit: true });
  const user = userEvent.setup();
  render(<FnfRecoverySetting />);
  const share = await screen.findByRole('spinbutton', { name: /Share of final wages/ });
  expect(screen.getByText(/never gratuity or reimbursements/)).toBeInTheDocument();
  expect(screen.getByText(/The rest stays owed by the person/)).toBeInTheDocument();
  expect(screen.getByText(/s\.18\(3\)/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();

  await user.clear(share);
  await user.type(share, '60');
  expect(screen.getByText('A whole number from 0 to 50.')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();

  await user.clear(share);
  await user.type(share, '40');
  await user.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(saveFnfRecoveryCap).toHaveBeenCalledWith({ percent: 40 }));
});

it('shows the share read-only to anyone who is not the owner or an admin', async () => {
  vi.mocked(getFnfRecoveryCap).mockResolvedValue({ percent: 50, canEdit: false });
  render(<FnfRecoverySetting />);
  expect(await screen.findByText(/Only the owner or an admin changes this/)).toBeInTheDocument();
  expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
});

it('says so when the setting cannot be read', async () => {
  vi.mocked(getFnfRecoveryCap).mockRejectedValue(new Error('Payroll is not switched on.'));
  render(<FnfRecoverySetting />);
  expect(await screen.findByRole('alert')).toHaveTextContent('Payroll is not switched on.');
});
