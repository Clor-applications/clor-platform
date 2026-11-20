import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';

import DepartmentSchedule from './DepartmentSchedule';
import { removeDepartmentSchedule } from '../api/attendance';
import { confirmDialog } from '@ui/components/ui/notify';

vi.mock('@ui/components/ui/notify', () => ({
  confirmDialog: vi.fn(),
  notify: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));
vi.mock('@ui/personnel/api', () => ({ listStructure: vi.fn().mockResolvedValue([]) }));
vi.mock('../api/attendance', () => ({
  todayIst: () => '2026-11-21',
  listShifts: vi.fn().mockResolvedValue([]),
  addDepartmentSchedule: vi.fn(),
  removeDepartmentSchedule: vi.fn().mockResolvedValue({}),
  listDepartmentSchedules: vi.fn().mockResolvedValue([
    { id: 's1', departmentId: 'd1', departmentName: 'Stores', shiftName: 'Night shift', effectiveFrom: '2026-12-09', effectiveTo: null },
  ]),
}));

beforeEach(() => vi.clearAllMocks());

/* Audit 21 Nov 2026: Remove took the schedule away on one click, with no word of who, which shift or from when. */
it('asks before removing a schedule, naming the department, the shift and the date', async () => {
  confirmDialog.mockResolvedValueOnce(false);
  render(<DepartmentSchedule />);
  const remove = await screen.findByRole('button', { name: 'Remove Stores from 9 Dec 2026' });
  fireEvent.click(remove);
  await waitFor(() => expect(confirmDialog).toHaveBeenCalledTimes(1));
  expect(confirmDialog.mock.calls[0][0]).toMatchObject({ title: 'Remove Stores from Night shift from 9 Dec 2026?', confirmLabel: 'Remove schedule' });
  expect(removeDepartmentSchedule).not.toHaveBeenCalled();

  confirmDialog.mockResolvedValueOnce(true);
  fireEvent.click(remove);
  await waitFor(() => expect(removeDepartmentSchedule).toHaveBeenCalledWith('s1'));
});
