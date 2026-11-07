import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';

import StatutoryGapsPanel from './StatutoryGapsPanel';
import { recordStatutoryWaiver } from '../api/payrollRuns';
import { requestOpenScreen } from '@platform/context';

vi.mock('../api/payrollRuns', () => ({ recordStatutoryWaiver: vi.fn() }));
vi.mock('@platform/context', () => ({ requestOpenScreen: vi.fn() }));
vi.mock('@ui/components/ui/notify', () => ({ notify: { success: vi.fn(), error: vi.fn() } }));

beforeEach(() => vi.clearAllMocks());

const meera = { employeeId: 'e1', name: 'Meera Shetty' };
const pf = { scheme: 'PF', name: 'Provident Fund', reason: 'OFF', mayStandWithout: true, people: [meera] };
const tds = { scheme: 'TDS', name: 'Income Tax (TDS)', reason: 'NO_RULE', mayStandWithout: false, people: [meera] };
const run = (over = {}) => ({ id: 'r1', status: 'REVIEW', statutoryWaiver: null, ...over });

it('shows nothing when every statutory line was worked out, or once approved', () => {
  const { container, rerender } = render(<StatutoryGapsPanel run={run()} gaps={[]} canWaive />);
  expect(container).toBeEmptyDOMElement();
  rerender(<StatutoryGapsPanel run={run({ status: 'APPROVED' })} gaps={[pf]} canWaive />);
  expect(container).toBeEmptyDOMElement();
});

it('says what is off and for whom, and opens Compliance', async () => {
  const user = userEvent.setup();
  render(<StatutoryGapsPanel run={run()} gaps={[pf, tds]} canWaive />);
  expect(screen.getByRole('heading', { name: 'Not ready to approve' })).toBeInTheDocument();
  expect(screen.getByText(/Provident Fund is switched off, so it shows as nil for Meera Shetty/)).toBeInTheDocument();
  expect(screen.getByText(/Income Tax \(TDS\) has no rate for this month/)).toBeInTheDocument();
  /* TDS can never be waived, so the owner is not offered it. */
  expect(screen.queryByRole('button', { name: 'Record it does not apply' })).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Open Compliance' }));
  expect(requestOpenScreen).toHaveBeenCalledWith('compliance');
});

it('lets the owner record that PF does not apply, with a reason', async () => {
  vi.mocked(recordStatutoryWaiver).mockResolvedValue({});
  const onSaved = vi.fn();
  const user = userEvent.setup();
  render(<StatutoryGapsPanel run={run()} gaps={[pf]} canWaive onSaved={onSaved} />);
  const button = screen.getByRole('button', { name: 'Record it does not apply' });
  expect(button).toBeDisabled();
  await user.type(screen.getByRole('combobox', { name: /Why PF does not apply/ }), '12 people, under 20');
  await user.click(button);
  await waitFor(() => expect(recordStatutoryWaiver).toHaveBeenCalledWith('r1', ['PF'], '12 people, under 20'));
  expect(onSaved).toHaveBeenCalled();
});

it('offers someone who is not the owner no way round it', () => {
  render(<StatutoryGapsPanel run={run()} gaps={[pf]} canWaive={false} />);
  expect(screen.getByText(/the owner can record why instead/)).toBeInTheDocument();
  expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
});

it('shows the recorded reason once it is given', () => {
  render(<StatutoryGapsPanel run={run({ statutoryWaiver: { schemes: ['PF'], reason: '12 people, under 20' } })} gaps={[pf]} canWaive />);
  expect(screen.getByRole('heading', { name: 'Provident Fund recorded as not applying to this company' })).toBeInTheDocument();
  expect(screen.getByText('12 people, under 20')).toBeInTheDocument();
});
