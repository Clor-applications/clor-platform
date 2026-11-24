import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';

const apiFetch = vi.fn();
vi.mock('@platform/http', () => ({ apiFetch: (...a) => apiFetch(...a) }));
vi.mock('@platform/context', async (orig) => ({ ...(await orig()), hasApp: () => true, requireOrgId: () => 'org1', requestOpenApp: vi.fn() }));

const { HomeAttendanceTrend, HomePayRuns } = await import('./HomeTrends');
const { requestOpenApp } = await import('@platform/context');

beforeEach(() => {
  apiFetch.mockReset();
  requestOpenApp.mockReset();
});

const run = (id, month, status, netTotal, kind = 'REGULAR') => ({ id, kind, status, netTotal, period: { name: month }, payrollDate: '2026-11-30' });

/* DESIGN.md, People (25 Nov 2026): the last three regular runs, state as a word, total in rupees, each opening its run. */
it('shows the last three regular pay runs and opens one in Payroll', async () => {
  apiFetch.mockResolvedValue({
    runs: [run('r5', 'Nov 2026', 'REVIEW', 384000), run('x', 'Nov 2026', 'PAID', 9000, 'OFF_CYCLE'), run('r4', 'Oct 2026', 'PAID', 380500), run('c', 'Oct 2026', 'CANCELLED', 1), run('r3', 'Sep 2026', 'POSTED', 379000), run('r2', 'Aug 2026', 'PAID', 1)],
  });
  render(<HomePayRuns allowed />);
  expect(await screen.findByText('Nov 2026')).toBeTruthy();
  expect(screen.getByText('In review')).toBeTruthy();
  expect(screen.getByText('Paid and posted')).toBeTruthy();
  expect(screen.queryByText('Aug 2026')).toBeNull();
  expect(screen.getAllByRole('listitem')).toHaveLength(3);
  expect(screen.getByText(/3,84,000/)).toBeTruthy();
  fireEvent.click(screen.getByText('Oct 2026'));
  expect(requestOpenApp).toHaveBeenCalledWith('payroll', 'runs', { run: 'r4' });
});

it('asks nothing and shows nothing to someone who may not read pay runs', () => {
  const { container } = render(<HomePayRuns allowed={false} />);
  expect(apiFetch).not.toHaveBeenCalled();
  expect(container.textContent).toBe('');
});

it('shows the attendance rate by month with this month marked', async () => {
  apiFetch.mockResolvedValue({
    current: '2026-11',
    trend: [
      { month: '2026-06', attendanceRate: null },
      { month: '2026-09', attendanceRate: 93.5 },
      { month: '2026-10', attendanceRate: 95.1 },
      { month: '2026-11', attendanceRate: 91.2 },
    ],
  });
  render(<HomeAttendanceTrend allowed />);
  expect(await screen.findByRole('heading', { name: 'Attendance rate' })).toBeTruthy();
  expect(apiFetch.mock.calls[0][0]).toBe('/orgs/org1/attendance/reports/insights?months=6');
  /* A month CLOR was not used in has no rate and is left out, not drawn as zero. */
  expect(screen.queryByText('Jun')).toBeNull();
  expect(screen.getAllByText('91.2%').length).toBeGreaterThan(0);
});

it('stays quiet when the reader sees only their team (the report refuses)', async () => {
  apiFetch.mockRejectedValue(Object.assign(new Error('team'), { status: 403 }));
  const { container } = render(<HomeAttendanceTrend allowed />);
  await Promise.resolve();
  expect(container.textContent).toBe('');
});
