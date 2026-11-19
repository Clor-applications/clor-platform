import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';

import ExtraPayStage from './ExtraPayStage';
import { saveExtraPay } from '../api/payrollRuns';

vi.mock('../api/payrollRuns', () => ({ saveExtraPay: vi.fn(), setRunEmployeeIncluded: vi.fn() }));
vi.mock('../api/payrollPeople', () => ({
  listEmployees: vi.fn().mockResolvedValue({ employees: [{ id: 'e1', name: 'Anika Rao', code: 'E1' }, { id: 'e2', name: 'Chitra Menon', code: 'E2' }] }),
}));
vi.mock('../api/payrollComponents', () => ({
  listSalaryComponents: vi.fn().mockResolvedValue([{ id: 'c-bonus', name: 'Performance bonus', type: 'EARNING' }]),
}));
vi.mock('@ui/components/ui/notify', () => ({ notify: { success: vi.fn(), error: vi.fn() } }));

beforeEach(() => vi.clearAllMocks());

const data = {
  employees: [
    {
      employeeId: 'e1',
      inclusion: 'INCLUDED',
      pays: 'EXTRA',
      employee: { name: 'Anika Rao', code: 'E1' },
      extraPay: [{ id: 'x1', componentId: 'c-bonus', amount: 50000, reason: 'Q4 bonus' }],
    },
  ],
};

it('shows what each person is paid and saves a changed amount', async () => {
  vi.mocked(saveExtraPay).mockResolvedValue({ ok: true });
  const onChanged = vi.fn();
  const user = userEvent.setup();
  render(<ExtraPayStage data={data} editable runId="r9" onChanged={onChanged} />);
  expect(screen.getByText('Anika Rao')).toBeInTheDocument();
  expect(screen.getByLabelText('Pays', { selector: '#pays-e1' })).toHaveValue('EXTRA');
  const amount = screen.getByLabelText('Amount');
  expect(amount).toHaveValue('50000');
  await user.clear(amount);
  await user.type(amount, '60000');
  await user.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() =>
    expect(saveExtraPay).toHaveBeenCalledWith('r9', { employeeId: 'e1', pays: 'EXTRA', items: [{ componentId: 'c-bonus', amount: 60000, reason: 'Q4 bonus' }] }),
  );
  expect(onChanged).toHaveBeenCalled();
});

it('adds somebody not yet in the run, for their salary', async () => {
  vi.mocked(saveExtraPay).mockResolvedValue({ ok: true });
  const user = userEvent.setup();
  render(<ExtraPayStage data={data} editable runId="r9" onChanged={() => {}} />);
  const person = screen.getByLabelText('Add a person');
  await waitFor(() => expect(person.querySelectorAll('option')).toHaveLength(2));
  await user.selectOptions(person, 'e2');
  await user.selectOptions(screen.getByLabelText('Pays', { selector: '#extra-add-pays' }), 'SALARY');
  await user.click(screen.getByRole('button', { name: 'Add' }));
  await waitFor(() => expect(saveExtraPay).toHaveBeenCalledWith('r9', { employeeId: 'e2', pays: 'SALARY', items: [] }));
});

it('changes nothing once the run is approved', () => {
  render(<ExtraPayStage data={data} editable={false} runId="r9" onChanged={() => {}} />);
  expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
  expect(screen.queryByLabelText('Add a person')).toBeNull();
  expect(screen.getByLabelText('Amount')).toBeDisabled();
});
