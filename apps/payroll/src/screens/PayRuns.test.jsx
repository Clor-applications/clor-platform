import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';

import PayRuns, { RunPrimaryAction } from './PayRuns';
import { calculatePayrollRun, listPayrollRuns, submitRunForReview, validatePayrollRun } from '../api/payrollRuns';
import { listPayGroups, listPayrollPeriods } from '../api/payrollCalendar';

vi.mock('../api/payrollRuns', () => ({ listPayrollRuns: vi.fn(), getPayrollRun: vi.fn(), createPayrollRun: vi.fn(), setRunEmployeeIncluded: vi.fn(), saveRunInputs: vi.fn(), takeDaysFromAttendance: vi.fn(), takeDaysFromLeave: vi.fn(), validatePayrollRun: vi.fn(), calculatePayrollRun: vi.fn(), submitRunForReview: vi.fn(), approvePayrollRun: vi.fn(), rejectPayrollRun: vi.fn(), lockPayrollRun: vi.fn(), payrollTallyXml: vi.fn(), sendPayrollToTally: vi.fn(), tallyConnectors: vi.fn(), previewPayrollPosting: vi.fn(), postPayrollRun: vi.fn(), getRunLopCheck: vi.fn() }));
vi.mock('../api/payrollCalendar', () => ({ listPayrollPeriods: vi.fn(), listPayGroups: vi.fn() }));
vi.mock('@ui/components/ui/notify', () => ({ notify: { success: vi.fn(), error: vi.fn() }, confirmDialog: vi.fn() }));
vi.mock('@platform/context', () => ({ hasApp: () => false }));

/* The run screen's actions, with the workflow's own `act`: run it, and nothing else. */
const act = (_what, fn, done) => Promise.resolve(fn()).then((out) => done?.(out));
const calculated = { id: 'r1', status: 'CALCULATED', errorCount: 0, overLimit: null, stale: null };

beforeEach(() => vi.clearAllMocks());

/* QA of #82 (owner and HR), F4. */
it('a calculated run can be calculated again from the screen', async () => {
  vi.mocked(validatePayrollRun).mockResolvedValue({ canCalculate: true, errors: 0 });
  vi.mocked(calculatePayrollRun).mockResolvedValue({});
  const user = userEvent.setup();
  render(<RunPrimaryAction run={calculated} busy="" act={act} runId="r1" setIssues={() => {}} />);
  await user.click(screen.getByRole('button', { name: 'Calculate again' }));
  await waitFor(() => expect(calculatePayrollRun).toHaveBeenCalledWith('r1'));
});

it('figures changed since the calculation are not sent for review', async () => {
  const user = userEvent.setup();
  render(<RunPrimaryAction run={{ ...calculated, stale: 'Changed since it was calculated: adjustments. Calculate again before sending it on.' }} busy="" act={act} runId="r1" setIssues={() => {}} />);
  const send = screen.getByRole('button', { name: 'Send for review' });
  expect(send).toBeDisabled();
  expect(send).toHaveAttribute('title', expect.stringContaining('Calculate again'));
  await user.click(send);
  expect(submitRunForReview).not.toHaveBeenCalled();
});

/* QA: periods or pay groups refused (a role without the pay calendar) used to fail the whole screen. Each loads on its own. */
it('lists the runs when the periods or pay groups are refused, and says why a run cannot start', async () => {
  vi.mocked(listPayrollRuns).mockResolvedValue([{ id: 'r9', number: 'PR-0009', status: 'PAID', period: { name: 'October 2026' }, payrollDate: '2026-10-31', employeeCount: 3, grossTotal: 90000, netTotal: 80000 }]);
  vi.mocked(listPayrollPeriods).mockRejectedValue(new Error('Permission denied'));
  vi.mocked(listPayGroups).mockRejectedValue(new Error('Permission denied'));
  render(<PayRuns />);
  expect(await screen.findByText('PR-0009')).toBeTruthy();
  expect(screen.getByText(/Could not load the payroll periods/)).toBeTruthy();
  expect(screen.getByRole('button', { name: /Run payroll/ })).toBeDisabled();
});

it('still lists the runs and offers a run when only the pay groups are refused', async () => {
  vi.mocked(listPayrollRuns).mockResolvedValue([]);
  vi.mocked(listPayrollPeriods).mockResolvedValue([{ id: 'p1', name: 'November 2026' }]);
  vi.mocked(listPayGroups).mockRejectedValue(new Error('Permission denied'));
  render(<PayRuns />);
  expect(await screen.findByText('No payroll has been run yet')).toBeTruthy();
  expect(screen.getAllByRole('button', { name: /Run payroll/ })[0]).not.toBeDisabled();
  expect(screen.queryByRole('alert')).toBeNull();
});

/* Review of #138, S4: tax withheld without a PAN is approved only by name. */
it('approving with tax withheld without a PAN names the people and sends who was acknowledged', async () => {
  const { approvePayrollRun } = await import('../api/payrollRuns');
  const { confirmDialog } = await import('@ui/components/ui/notify');
  const refused = Object.assign(new Error('withheld without a PAN'), { code: 'NO_PAN_UNACKNOWLEDGED', data: { people: [{ employeeId: 'e7', name: 'Ravi Kumar' }] } });
  vi.mocked(approvePayrollRun).mockRejectedValueOnce(refused).mockResolvedValueOnce({ run: {} });
  vi.mocked(confirmDialog).mockResolvedValue(true);
  const user = userEvent.setup();
  render(<RunPrimaryAction run={{ ...calculated, status: 'REVIEW', number: 'PR-0001', netTotal: 100, employeeCount: 1 }} busy="" act={act} runId="r1" setIssues={() => {}} />);
  await user.click(screen.getByRole('button', { name: 'Approve payroll' }));
  await waitFor(() => expect(approvePayrollRun).toHaveBeenLastCalledWith('r1', { noPanAcknowledged: ['e7'] }));
  expect(vi.mocked(confirmDialog).mock.calls[1][0].message).toMatch(/Ravi Kumar has no valid PAN/);
});
