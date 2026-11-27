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
  expect(await screen.findByText('No pay runs yet')).toBeTruthy();
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
  await user.click(screen.getByRole('button', { name: 'Approve pay run' }));
  await waitFor(() => expect(approvePayrollRun).toHaveBeenLastCalledWith('r1', { noPanAcknowledged: ['e7'] }));
  expect(vi.mocked(confirmDialog).mock.calls[1][0].message).toMatch(/Ravi Kumar has no valid PAN/);
});

/* Design audit, Batch 1: a second click while the first request is on its way must not start a second run. */
it('starting a pay run cannot be sent twice', async () => {
  const { createPayrollRun } = await import('../api/payrollRuns');
  vi.mocked(listPayrollRuns).mockResolvedValue([]);
  vi.mocked(listPayrollPeriods).mockResolvedValue([{ id: 'p1', name: 'November 2026' }]);
  vi.mocked(listPayGroups).mockResolvedValue([]);
  let finish;
  vi.mocked(createPayrollRun).mockReturnValue(new Promise((resolve) => { finish = resolve; }));
  const user = userEvent.setup();
  render(<PayRuns />);
  await screen.findByText('No pay runs yet');
  await user.click(screen.getAllByRole('button', { name: /Run payroll/ })[0]);
  await user.click(await screen.findByRole('button', { name: 'Start pay run' }));
  const busy = await screen.findByRole('button', { name: /Starting/ });
  await user.click(busy);
  await user.click(busy);
  expect(createPayrollRun).toHaveBeenCalledTimes(1);
  expect(busy).toHaveAttribute('aria-busy', 'true');
  finish({ run: { id: 'r1', number: 'PR-0001', kind: 'REGULAR' }, eligible: 3 });
});

/* Design audit, Batch 1: posting writes to the books, so it asks first and names the debit total. */
it('post to accounts asks first with the debit total, and posts nothing when declined', async () => {
  const { confirmDialog } = await import('@ui/components/ui/notify');
  const { previewPayrollPosting, postPayrollRun } = await import('../api/payrollRuns');
  vi.mocked(previewPayrollPosting).mockResolvedValue({ balanced: true, problems: [], lines: [], totalDebit: 125000.5, totalCredit: 125000.5 });
  vi.mocked(confirmDialog).mockResolvedValueOnce(false).mockResolvedValueOnce(true);
  vi.mocked(postPayrollRun).mockResolvedValue({});
  const user = userEvent.setup();
  render(<RunPrimaryAction run={{ ...calculated, status: 'LOCKED', number: 'PR-0002', period: { name: 'November 2026' } }} busy="" act={act} runId="r1" setIssues={() => {}} />);
  await user.click(screen.getByRole('button', { name: 'Post to accounts' }));
  await waitFor(() => expect(confirmDialog).toHaveBeenCalledTimes(1));
  const asked = vi.mocked(confirmDialog).mock.calls[0][0];
  expect(asked.title).toBe('Post PR-0002 to accounts?');
  expect(asked.message).toMatch(/₹1,25,000\.50 debit/);
  expect(postPayrollRun).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: 'Post to accounts' }));
  await waitFor(() => expect(postPayrollRun).toHaveBeenCalledWith('r1'));
});

it('locking names the net pay and the head count', async () => {
  const { lockWords } = await import('../components/round59');
  const words = lockWords({ period: { name: 'November 2026', endDate: '2026-11-30' }, netTotal: 80000, employeeCount: 3 });
  expect(words.message).toMatch(/^₹80,000.00 net pay to 3 people\. After locking/);
});

it('opens a run with the keyboard and records the selected run in the address state', async () => {
  vi.mocked(listPayrollRuns).mockResolvedValue([{ id: 'r9', number: 'PR-0009', status: 'PAID', period: { name: 'October 2026' } }]);
  vi.mocked(listPayrollPeriods).mockResolvedValue([]);
  vi.mocked(listPayGroups).mockResolvedValue([]);
  const updateParams = vi.fn();
  const user = userEvent.setup();
  render(<PayRuns updateParams={updateParams} />);
  const run = await screen.findByRole('button', { name: 'PR-0009' });
  run.focus();
  await user.keyboard('{Enter}');
  expect(updateParams).toHaveBeenCalledTimes(1);
  expect(updateParams).toHaveBeenCalledWith({ runId: 'r9' }, { push: true });
});

it('loads a pay run directly from its address state', async () => {
  const { getPayrollRun } = await import('../api/payrollRuns');
  vi.mocked(getPayrollRun).mockRejectedValue(new Error('Access refused'));
  render(<PayRuns params={{ runId: 'direct-run' }} updateParams={vi.fn()} />);
  await waitFor(() => expect(getPayrollRun).toHaveBeenCalledWith('direct-run'));
});

it('starts on the selected open period when opened from payroll overview', async () => {
  vi.mocked(listPayrollRuns).mockResolvedValue([]);
  vi.mocked(listPayrollPeriods).mockResolvedValue([
    { id: 'p1', name: 'October 2026' },
    { id: 'p2', name: 'November 2026' },
  ]);
  vi.mocked(listPayGroups).mockResolvedValue([]);
  render(<PayRuns params={{ startPeriod: 'p2' }} updateParams={vi.fn()} />);
  expect(await screen.findByLabelText('Period')).toHaveValue('p2');
});
