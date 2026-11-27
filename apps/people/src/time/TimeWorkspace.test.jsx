import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { getInbox } from '../api/approvals';
import { listUnmatchedPunches, getPayrollReadiness } from '../../../attendance/src/api/attendance';
import TimeWorkspace from './TimeWorkspace';

vi.mock('../api/approvals', () => ({ getInbox: vi.fn() }));
vi.mock('@ui/timeOff/api', async (original) => ({ ...(await original()), getMyDays: vi.fn().mockResolvedValue({ records: [] }) }));
vi.mock('../../../attendance/src/api/attendance', () => ({ listUnmatchedPunches: vi.fn(), getPayrollReadiness: vi.fn(), listExceptions: vi.fn() }));
vi.mock('../screens/usePeopleUpdates', () => ({ usePeopleUpdates: () => {} }));

it('shows counts only for queues the person can access and opens the selected queue', async () => {
  getInbox.mockResolvedValue({ counts: { OVERTIME: 2, LEAVE: 3 } });
  const openScreen = vi.fn();
  render(<TimeWorkspace overviewModule={{ items: [{ key: 'overtime', label: 'Overtime & comp-off' }] }} openScreen={openScreen} />);
  fireEvent.click(await screen.findByRole('button', { name: /Overtime & comp-off.*2 waiting/ }));
  expect(openScreen).toHaveBeenCalledWith('overtime', undefined);
  expect(screen.queryByText('Leave requests')).toBeNull();
});

it('offers personal pages without fetching approval counts for a self-service role', async () => {
  getInbox.mockClear();
  render(<TimeWorkspace overviewModule={{ items: [{ key: 'myDays', label: 'My attendance' }] }} />);
  expect(await screen.findByText('No check-in recorded today')).toBeTruthy();
  expect(screen.queryByText('Waiting for review')).toBeNull();
  expect(getInbox).not.toHaveBeenCalled();
  expect(getPayrollReadiness).not.toHaveBeenCalled();
});

it('shows the punch count and reader site even when another summary is unavailable', async () => {
  listUnmatchedPunches.mockResolvedValue([{ pin: '1051', areaName: 'North gate', punches: 3 }]);
  getPayrollReadiness.mockRejectedValue(new Error('Unavailable'));
  const pages = [{ key: 'unmatched', label: 'Match punches' }, { key: 'payrollReadiness', label: 'Check payroll' }];
  render(<TimeWorkspace overviewModule={{ items: pages, shortcuts: pages }} />);
  expect(await screen.findByText('ID 1051 · North gate · 3 punches')).toBeTruthy();
  expect(screen.getByText('1 reader ID')).toBeTruthy();
  expect(await screen.findByText('Summary unavailable. Open to review.')).toBeTruthy();
});
