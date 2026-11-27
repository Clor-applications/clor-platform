import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

import PayrollReadiness from './PayrollReadiness';
import { getPayrollReadiness } from '../api/attendance';

/* Payroll readiness is the whole company's; a team-scoped role is told so plainly, not shown an error to retry. */
vi.mock('../api/attendance', () => ({
  getPayrollReadiness: vi.fn(),
  todayIst: () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10),
}));

it('tells a team-scoped role it covers the whole company, and points to month close', async () => {
  const refused = Object.assign(new Error('Payroll readiness covers the whole company. Month close shows your team’s days.'), { status: 403, data: { code: 'TEAM_SCOPED' } });
  getPayrollReadiness.mockRejectedValue(refused);
  const openScreen = vi.fn();
  render(<PayrollReadiness openScreen={openScreen} />);
  expect(await screen.findByText('Payroll readiness covers the whole company')).toBeTruthy();
  expect(screen.getByText('Your role sees your own team. Month close shows your team’s open days.')).toBeTruthy();
  expect(screen.queryByRole('button', { name: /More/ })).toBeNull();
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Open month close' }));
  expect(openScreen).toHaveBeenCalledWith('monthClose', expect.objectContaining({ month: expect.stringMatching(/^\d{4}-\d{2}$/) }));
});

it('still says when the check itself failed', async () => {
  getPayrollReadiness.mockRejectedValue(Object.assign(new Error('The server could not complete that (500). Nothing was saved.'), { status: 500 }));
  render(<PayrollReadiness />);
  expect(await screen.findByText('The server could not complete that (500). Nothing was saved.')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
});

/* Shared with People, whose menu calls it "Ready for payroll?": the page title follows the menu (design audit 19 Nov 2026). */
it('takes its title from the menu label it was opened from', async () => {
  getPayrollReadiness.mockRejectedValue(Object.assign(new Error('x'), { status: 500 }));
  const { unmount } = render(<PayrollReadiness menuLabel="Ready for payroll?" />);
  expect(await screen.findByRole('heading', { level: 1, name: 'Ready for payroll?' })).toBeTruthy();
  unmount();
  render(<PayrollReadiness />);
  expect(await screen.findByRole('heading', { level: 1, name: 'Payroll readiness' })).toBeTruthy();
});

it('keeps the selected month when an earlier response arrives late and hides restricted pay amounts', async () => {
  let resolveEarlier;
  getPayrollReadiness.mockImplementationOnce(() => new Promise(resolve => { resolveEarlier = resolve; }));
  const monthData = { ready: false, score: 50, people: { total: 4, blocking: 1 }, payVisible: false, blockers: [],
    issues: [{ key: 'punch', title: 'Selected month missing punch', count: 1, money: 1250, blocks: true, screen: 'records' }] };
  getPayrollReadiness.mockResolvedValueOnce(monthData);
  render(<PayrollReadiness />);
  await waitFor(() => expect(resolveEarlier).toBeTypeOf('function'));
  const month = screen.getByLabelText('Month');
  fireEvent.change(month, { target: { value: month.value === '2026-10' ? '2026-09' : '2026-10' } });
  const issue = await screen.findByRole('heading', { name: /Selected month missing punch/ });
  expect(issue.textContent).not.toContain('1,250');
  await act(async () => resolveEarlier({ ...monthData, issues: [] }));
  expect(screen.getByRole('heading', { name: /Selected month missing punch/ })).toBeTruthy();
  expect(screen.queryByRole('heading', { name: 'Ready for payroll' })).toBeNull();
});

it('opens correction blockers inside People and payroll blockers through the app switcher', async () => {
  const base = { count: 1, blocks: true };
  getPayrollReadiness.mockResolvedValue({
    ready: false, score: 0, people: { total: 4, blocking: 2 }, payVisible: false, blockers: [],
    issues: [
      { ...base, key: 'corrections', title: 'Corrections pending', app: 'attendance', screen: 'requests' },
      { ...base, key: 'salary', title: 'Salary missing', app: 'payroll', screen: 'assignments' },
    ],
  });
  const openScreen = vi.fn();
  const openApp = vi.fn();
  render(<PayrollReadiness peopleTimePage openApp={openApp} openScreen={openScreen} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Review issue' }));
  expect(openScreen).toHaveBeenCalledWith('attendanceRequests', undefined);
  fireEvent.click(screen.getByRole('button', { name: 'Fix in Payroll' }));
  expect(openApp).toHaveBeenCalledWith('payroll', 'assignments');
});
