import React from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi, beforeEach } from 'vitest';

import { LopCheckPanel, ProvisionalNotice } from './RunGuards';
import { openMonthsOf, provisionalWarning } from './runGuardText';
import { getRunLopCheck, lockPayrollRun } from '../api/payrollRuns';

vi.mock('../api/payrollRuns', () => ({ getRunLopCheck: vi.fn(), lockPayrollRun: vi.fn() }));
vi.mock('@ui/components/ui/notify', () => ({ notify: { success: vi.fn(), error: vi.fn() } }));

const mismatch = {
  employeeId: 'e-1', name: 'Asha Rao', code: 'E001',
  leaveDays: 2, recordsLeaveDays: 1, recordsLossOfPay: 1, inputLwpDays: 2, inputSource: 'LEAVE',
  problems: ['Approved unpaid leave is 2 days, but the days carry 1.', 'The run has 2 days of loss of pay; the days say 1. Take the days again.'],
};

beforeEach(() => {
  vi.mocked(getRunLopCheck).mockReset();
  vi.mocked(lockPayrollRun).mockReset();
});

it('says plainly that an open month can still change', () => {
  expect(provisionalWarning(['2026-09'])).toBe('September is not closed in Attendance; these figures can still change.');
  expect(provisionalWarning(['2026-12', '2027-01'])).toBe('December 2026 and January 2027 are not closed in Attendance; these figures can still change.');
  const run = { attendanceSnapshots: [{ month: '2026-09', version: null, closed: false }] };
  render(<ProvisionalNotice openMonths={openMonthsOf(run)} />);
  expect(screen.getByRole('status')).toHaveTextContent('September is not closed in Attendance; these figures can still change.');
});

it('shows nothing when every month was closed', () => {
  const { container } = render(<ProvisionalNotice openMonths={openMonthsOf({ attendanceSnapshots: [{ month: '2026-09', version: 1, closed: true }] })} />);
  expect(container).toBeEmptyDOMElement();
});

it('lists each person with all three figures, and locks only with an acknowledgement and a reason', async () => {
  vi.mocked(getRunLopCheck).mockResolvedValue({ checked: 3, source: 'LEAVE', mismatches: [mismatch], provisional: false, openMonths: [], snapshotChanged: null });
  vi.mocked(lockPayrollRun).mockResolvedValue({ run: { status: 'LOCKED' } });
  const onLocked = vi.fn();
  const user = userEvent.setup();
  render(<LopCheckPanel runId="run-1" run={{ status: 'APPROVED' }} onLocked={onLocked} />);

  const row = (await screen.findByText('Asha Rao')).closest('tr');
  const cells = within(row).getAllByRole('cell');
  expect(cells[1]).toHaveTextContent('2');
  expect(cells[2]).toHaveTextContent('1');
  expect(cells[3]).toHaveTextContent('2');
  expect(cells[3]).toHaveTextContent('From leave');
  expect(row).toHaveTextContent('the days carry 1');
  expect(screen.getByText(/1 to check/)).toBeInTheDocument();

  /* No reason field until the differences are acknowledged; no lock until the reason is long enough. */
  expect(screen.queryByRole('button', { name: 'Lock with this reason' })).not.toBeInTheDocument();
  await user.click(screen.getByRole('checkbox', { name: /I have seen these differences/ }));
  const lock = screen.getByRole('button', { name: 'Lock with this reason' });
  expect(lock).toBeDisabled();
  await user.type(screen.getByRole('textbox', { name: /Why/ }), 'ok');
  expect(lock).toBeDisabled();
  await user.type(screen.getByRole('textbox', { name: /Why/ }), ' — fixed in October');
  expect(lock).toBeEnabled();
  await user.click(lock);
  await waitFor(() => expect(lockPayrollRun).toHaveBeenCalledWith('run-1', { acknowledge: true, reason: 'ok — fixed in October' }));
  expect(onLocked).toHaveBeenCalled();
});

it('says when everything agrees, and offers no lock path for a run not yet approved', async () => {
  vi.mocked(getRunLopCheck).mockResolvedValue({ checked: 4, mismatches: [], openMonths: ['2026-09'], snapshotChanged: null });
  render(<LopCheckPanel runId="run-1" run={{ status: 'REVIEW' }} />);
  expect(await screen.findByText(/Loss of pay agrees for all 4 people/)).toBeInTheDocument();
  expect(screen.getByRole('status')).toHaveTextContent('September is not closed in Attendance; these figures can still change.');
  expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
});

it('names a month reopened since the pull', async () => {
  vi.mocked(getRunLopCheck).mockResolvedValue({
    checked: 1, mismatches: [], openMonths: [],
    snapshotChanged: { month: '2026-09', reason: 'REOPENED', message: 'September 2026 was reopened in Attendance after these days were taken. Take the figures from Attendance again.' },
  });
  render(<LopCheckPanel runId="run-1" run={{ status: 'APPROVED' }} />);
  expect(await screen.findByRole('alert')).toHaveTextContent('September 2026 was reopened');
});
