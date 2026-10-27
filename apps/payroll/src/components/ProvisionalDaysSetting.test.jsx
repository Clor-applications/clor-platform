import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi, beforeEach } from 'vitest';

import { ProvisionalDaysNotice, ProvisionalDaysSetting } from './ProvisionalDaysSetting';
import { getProvisionalDays, saveProvisionalDays } from '../api/payrollSetup';

vi.mock('../api/payrollSetup', () => ({ getProvisionalDays: vi.fn(), saveProvisionalDays: vi.fn() }));
vi.mock('@ui/components/ui/notify', () => ({ notify: { success: vi.fn(), error: vi.fn() } }));

beforeEach(() => {
  vi.mocked(getProvisionalDays).mockReset();
  vi.mocked(saveProvisionalDays).mockReset();
});

it('is off by default and switches on with a cut-off day', async () => {
  vi.mocked(getProvisionalDays).mockResolvedValue({ enabled: false, cutoffDay: 25, attendance: true });
  vi.mocked(saveProvisionalDays).mockResolvedValue({ enabled: true, cutoffDay: 24, attendance: true });
  const user = userEvent.setup();
  render(<ProvisionalDaysSetting />);

  const box = await screen.findByRole('checkbox', { name: 'Count the days after the cut-off as present' });
  expect(box).not.toBeChecked();
  const day = screen.getByRole('spinbutton', { name: /Cut-off day of the month/ });
  expect(day).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();

  await user.click(box);
  expect(day).toBeEnabled();
  await user.clear(day);
  await user.type(day, '31');
  expect(screen.getByText('A day from 1 to 30.')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  await user.clear(day);
  await user.type(day, '24');
  expect(screen.getByText('Attendance is read up to the 24th; the rest of the month is counted as present.')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(saveProvisionalDays).toHaveBeenCalledWith({ enabled: true, cutoffDay: 24 }));
});

it('says it needs Attendance, and cannot be switched on without it', async () => {
  vi.mocked(getProvisionalDays).mockResolvedValue({ enabled: false, cutoffDay: 25, attendance: false });
  render(<ProvisionalDaysSetting />);
  expect(await screen.findByText(/Needs Attendance/)).toBeInTheDocument();
  expect(screen.getByRole('checkbox', { name: 'Count the days after the cut-off as present' })).toBeDisabled();
});

it('shows the run message the server sends, and nothing when no day was assumed', () => {
  const message = 'Days after the 25th counted as present: 3 people, 12 days; corrected next month.';
  const { rerender, container } = render(<ProvisionalDaysNotice run={{ provisionalMessage: message }} />);
  expect(screen.getByRole('status')).toHaveTextContent(message);
  rerender(<ProvisionalDaysNotice run={{ provisionalMessage: null, provisionalDays: null }} />);
  expect(container).toBeEmptyDOMElement();
});
