import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';

import { RunPrimaryAction } from './PayRuns';
import { calculatePayrollRun, submitRunForReview, validatePayrollRun } from '../api/payrollRuns';

vi.mock('../api/payrollRuns', () => ({ listPayrollRuns: vi.fn(), getPayrollRun: vi.fn(), createPayrollRun: vi.fn(), setRunEmployeeIncluded: vi.fn(), saveRunInputs: vi.fn(), takeDaysFromAttendance: vi.fn(), takeDaysFromLeave: vi.fn(), validatePayrollRun: vi.fn(), calculatePayrollRun: vi.fn(), submitRunForReview: vi.fn(), approvePayrollRun: vi.fn(), rejectPayrollRun: vi.fn(), lockPayrollRun: vi.fn(), payrollTallyXml: vi.fn(), sendPayrollToTally: vi.fn(), tallyConnectors: vi.fn(), previewPayrollPosting: vi.fn(), postPayrollRun: vi.fn(), getRunLopCheck: vi.fn() }));
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
