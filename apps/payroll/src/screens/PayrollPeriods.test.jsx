import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';

import PayrollPeriods, { closeWords } from './PayrollPeriods';
import { listPayrollPeriods, setPayrollPeriodLock } from '../api/payrollCalendar';
import { listPayrollRuns } from '../api/payrollRuns';
import { confirmDialog } from '@ui/components/ui/notify';

vi.mock('../api/payrollCalendar', () => ({ listPayrollPeriods: vi.fn(), createPayrollPeriod: vi.fn(), updatePayrollPeriod: vi.fn(), setPayrollPeriodLock: vi.fn(), deletePayrollPeriod: vi.fn() }));
vi.mock('../api/payrollRuns', () => ({ listPayrollRuns: vi.fn() }));
vi.mock('@ui/components/ui/notify', () => ({ notify: { success: vi.fn(), error: vi.fn() }, confirmDialog: vi.fn() }));

const november = { id: 'p1', name: 'November 2026', frequency: 'MONTHLY', startDate: '2026-11-01', endDate: '2026-11-30', paymentDate: '2026-11-30', isLocked: false, usage: { runs: 2, total: 2 } };

beforeEach(() => vi.clearAllMocks());

/* Design audit, Batch 1: closing a period used to happen on one click. */
it('closing a period asks first, naming the period, its runs and their net pay', async () => {
  vi.mocked(listPayrollPeriods).mockResolvedValue([november]);
  vi.mocked(listPayrollRuns).mockResolvedValue([
    { id: 'r1', periodId: 'p1', status: 'PAID', netTotal: 80000 },
    { id: 'r2', periodId: 'p1', status: 'LOCKED', netTotal: 1200.5 },
    { id: 'r3', periodId: 'p1', status: 'CANCELLED', netTotal: 5000 },
    { id: 'r4', periodId: 'p9', status: 'PAID', netTotal: 9000 },
  ]);
  vi.mocked(confirmDialog).mockResolvedValue(false);
  const user = userEvent.setup();
  render(<PayrollPeriods />);
  await user.click(await screen.findByRole('button', { name: 'Close November 2026' }));
  await waitFor(() => expect(confirmDialog).toHaveBeenCalledTimes(1));
  const asked = vi.mocked(confirmDialog).mock.calls[0][0];
  expect(asked.title).toBe('Close November 2026?');
  expect(asked.message).toMatch(/^2 pay runs, ₹81,200\.50 net pay in all\./);
  expect(setPayrollPeriodLock).not.toHaveBeenCalled();
});

it('closes the period once confirmed', async () => {
  vi.mocked(listPayrollPeriods).mockResolvedValue([november]);
  vi.mocked(listPayrollRuns).mockResolvedValue([]);
  vi.mocked(confirmDialog).mockResolvedValue(true);
  vi.mocked(setPayrollPeriodLock).mockResolvedValue({});
  const user = userEvent.setup();
  render(<PayrollPeriods />);
  await user.click(await screen.findByRole('button', { name: 'Close November 2026' }));
  await waitFor(() => expect(setPayrollPeriodLock).toHaveBeenCalledWith('p1', true));
});

it('still asks when the runs cannot be listed, with the count it has', () => {
  expect(closeWords(november, null).message).toMatch(/^2 pay runs\. Once closed/);
});
