import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';

import ReportsHome from './ReportsHome';

/*
 * Reports home (platform audit, 11 Nov 2026): People's own reports, the report screens on the menu and Attendance's
 * reports on one page in plain groups; a row opens its report, and nothing this person may not open is listed.
 */
const hr = vi.hoisted(() => ({ listHrReports: vi.fn() }));
vi.mock('../api/hrReports', () => hr);
const att = vi.hoisted(() => ({ listReports: vi.fn() }));
vi.mock('../../../attendance/src/api/attendance', () => att);

const OWN = [
  { id: 'headcount', group: 'Workforce', name: 'Headcount over time', description: 'How many people worked here at the end of each month.', dates: 'months', by: true },
  { id: 'gender', group: 'Workforce', name: 'Gender mix', description: 'Women, men and other answers.', dates: 'day', by: true },
  { id: 'movement', group: 'Joining and leaving', name: 'Joiners, leavers and attrition', description: 'Who joined and left each month.', dates: 'months', by: true },
  { id: 'documents', group: 'Documents and compliance', name: 'Documents expiring', description: 'Papers that have expired or are about to.', dates: 'days', by: false },
];
const ATTENDANCE = [
  { id: 'late-early', group: 'Attendance', name: 'Late Arrivals & Early Exits', description: 'Days someone came late or left early.', params: ['from', 'to'] },
  { id: 'muster', group: 'Statutory Registers', name: 'Muster Roll', description: 'Each worker, each day of the month.', params: ['month'] },
  { id: 'leave', group: 'Statutory Registers', name: 'Leave Register', description: 'Leave approved in the period.', params: ['from', 'to'] },
  { id: 'documents', group: 'People', name: 'Expiring Documents', description: 'Employee documents expiring within 90 days.', params: [] },
];
const NAV = [
  { key: 'reports', label: 'Headcount & attrition' }, { key: 'summary', label: 'Monthly attendance' }, { key: 'attendanceReports', label: 'All attendance reports' },
  { key: 'leaveRegister', label: 'Leave register' }, { key: 'registers', label: 'Statutory registers' }, { key: 'requestsReport', label: 'Requests report' },
];
const groupsShown = () => screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
const rowsUnder = (title) => [...screen.getByRole('heading', { level: 2, name: title }).closest('section').querySelectorAll('.ui-settings-row-label')].map((n) => n.textContent);

beforeEach(() => {
  vi.clearAllMocks();
  hr.listHrReports.mockResolvedValue({ reports: OWN, filters: {} });
  att.listReports.mockResolvedValue({ reports: ATTENDANCE });
});

it('lists every People and Time report in plain groups, Attendance’s among them', async () => {
  const { container } = render(<ReportsHome openScreen={vi.fn()} navItems={NAV} />);
  expect(await screen.findByText('Headcount over time')).toBeTruthy();
  expect(await screen.findByText('Late arrivals & early exits')).toBeTruthy();
  expect(groupsShown()).toEqual(['Workforce', 'Joining and leaving', 'Time and attendance', 'Leave', 'Documents and compliance', 'Requests']);
  expect(rowsUnder('Workforce')).toEqual(['Headcount over time', 'Gender mix']);
  expect(rowsUnder('Joining and leaving')).toEqual(['Joiners, leavers and attrition', 'Headcount & attrition']);
  expect(rowsUnder('Time and attendance')).toEqual(['Monthly attendance', 'Late arrivals & early exits', 'All attendance reports']);
  expect(rowsUnder('Leave')).toEqual(['Leave register', 'Leave register, statutory form']);
  /* People's own expiring-documents report stands in for Attendance's; the statutory ones sit with the registers. */
  expect(rowsUnder('Documents and compliance')).toEqual(['Documents expiring', 'Statutory registers', 'Muster roll']);
  /* A list on the page ground: no card, and no second primary action. */
  expect(container.querySelector('.ui-card')).toBeNull();
  expect(container.querySelector('.ui-btn-primary')).toBeNull();
});

it('opens a People report full page, a menu screen by its key and an Attendance report on that report', async () => {
  const openScreen = vi.fn();
  render(<ReportsHome openScreen={openScreen} navItems={NAV} />);
  fireEvent.click((await screen.findByText('Gender mix')).closest('button'));
  expect(openScreen).toHaveBeenLastCalledWith('hrReport', { report: 'gender' });
  fireEvent.click(screen.getByText('Monthly attendance').closest('button'));
  expect(openScreen).toHaveBeenLastCalledWith('summary');
  fireEvent.click((await screen.findByText('Muster roll')).closest('button'));
  expect(openScreen).toHaveBeenLastCalledWith('attendanceReports', { report: 'muster' });
});

it('leaves out what this person may not open, and a group left empty', async () => {
  hr.listHrReports.mockResolvedValue({ reports: OWN.filter((r) => r.id !== 'movement'), filters: {} });
  render(<ReportsHome openScreen={vi.fn()} navItems={[{ key: 'registers', label: 'Statutory registers' }]} />);
  expect(await screen.findByText('Headcount over time')).toBeTruthy();
  expect(groupsShown()).toEqual(['Workforce', 'Documents and compliance']);
  /* No Attendance on this person's menu: its reports are not asked for. */
  expect(att.listReports).not.toHaveBeenCalled();
  expect(screen.queryByText('All attendance reports')).toBeNull();
});

it('still lists the menu’s reports when People’s own are refused', async () => {
  hr.listHrReports.mockRejectedValue(Object.assign(new Error('Forbidden'), { status: 403 }));
  render(<ReportsHome openScreen={vi.fn()} navItems={NAV} />);
  expect(await screen.findByText('Monthly attendance')).toBeTruthy();
  expect(screen.queryByRole('heading', { level: 2, name: 'Workforce' })).toBeNull();
});

it('searches by name, by what the report says and by group', async () => {
  render(<ReportsHome openScreen={vi.fn()} navItems={NAV} />);
  await screen.findByText('Headcount over time');
  fireEvent.change(screen.getByRole('searchbox', { name: 'Search reports' }), { target: { value: 'muster' } });
  expect(await screen.findByText('Muster roll')).toBeTruthy();
  await vi.waitFor(() => expect(groupsShown()).toEqual(['Documents and compliance']));
  fireEvent.change(screen.getByRole('searchbox', { name: 'Search reports' }), { target: { value: 'zzz' } });
  expect(await screen.findByText('No report matches “zzz”.')).toBeTruthy();
});
