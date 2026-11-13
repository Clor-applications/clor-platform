import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';

import HrReport from './HrReport';
import ReportChart from '../components/ReportChart';

/*
 * One People report, full page: the filters the server offers, one chart in three colours at most, the table with
 * figures to the right, "fewer than 5" where the server hid a small number, and Export as the one action, sending
 * the filters on screen.
 */
const api = vi.hoisted(() => ({ listHrReports: vi.fn(), runHrReport: vi.fn(), hrReportCsv: vi.fn() }));
vi.mock('../api/hrReports', () => api);

const CATALOGUE = {
  reports: [
    { id: 'headcount', group: 'Workforce', name: 'Headcount over time', description: 'How many people worked here at the end of each month.', dates: 'months', by: true },
    { id: 'gender', group: 'Workforce', name: 'Gender mix', description: 'Women, men and other answers.', dates: 'day', by: true },
  ],
  filters: { departments: [{ id: 'd1', name: 'Sales' }, { id: 'd2', name: 'Ops' }], branches: [{ id: 'b1', name: 'Head office' }], employeeTypes: [], grades: [] },
};
const HEADCOUNT = {
  id: 'headcount', title: 'Headcount over time', from: '2025-01-01', to: '2025-03-31', by: 'department',
  columns: [{ key: 'month', label: 'Month' }, { key: 'g:d1', label: 'Sales', align: 'right' }, { key: 'g:d2', label: 'Ops', align: 'right' }, { key: 'total', label: 'Total', align: 'right' }],
  rows: [{ month: 'Jan 2025', 'g:d1': 4, 'g:d2': 4, total: 8 }, { month: 'Feb 2025', 'g:d1': 5, 'g:d2': 3, total: 8 }],
  totals: null,
  chart: { kind: 'stacked', categories: ['Jan 2025', 'Feb 2025'], series: [{ label: 'Sales', values: [4, 5] }, { label: 'Ops', values: [4, 3] }] },
  notes: ['Headcount is everyone working here on the last day of the month (today, for this month).'], masked: false,
};
const GENDER = {
  id: 'gender', title: 'Gender mix', from: null, to: '2025-03-31', by: 'department',
  columns: [{ key: 'group', label: 'Department' }, { key: 'FEMALE', label: 'Women', align: 'right' }, { key: 'MALE', label: 'Men', align: 'right' }, { key: 'total', label: 'Total', align: 'right' }],
  rows: [{ group: 'Sales', FEMALE: 'Fewer than 5', MALE: '5 or more', total: 9 }],
  totals: { group: 'Everyone', FEMALE: 'Fewer than 5', MALE: '5 or more', total: 9 },
  chart: null, notes: ['Where a group has fewer than 5 people in a band, the figures read “fewer than 5” or “5 or more”.'], masked: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  api.listHrReports.mockResolvedValue(CATALOGUE);
  api.runHrReport.mockImplementation((id) => Promise.resolve(id === 'gender' ? GENDER : HEADCOUNT));
  api.hrReportCsv.mockResolvedValue('Month,Sales\r\nJan 2025,4');
  URL.createObjectURL = vi.fn(() => 'blob:x');
  URL.revokeObjectURL = vi.fn();
});

it('draws the report full page: filters, one chart, the table, and Export as the one action', async () => {
  const { container } = render(<HrReport params={{ report: 'headcount' }} updateParams={vi.fn()} openScreen={vi.fn()} />);
  const table = await screen.findByRole('table', { name: 'Headcount over time' });
  expect(within(table).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Month', 'Sales', 'Ops', 'Total']);
  expect(within(table).getAllByRole('row').slice(1).map((r) => [...r.children].map((c) => c.textContent))).toEqual([['Jan 2025', '4', '4', '8'], ['Feb 2025', '5', '3', '8']]);
  /* Figures are tabular and to the right. */
  for (const td of table.querySelectorAll('tbody td')) expect(td.className).toMatch(/text-right/);
  for (const td of table.querySelectorAll('tbody td')) expect(td.className).toMatch(/tabular-nums/);
  expect(screen.getByRole('img', { name: /Headcount over time\. Jan 2025: Sales 4, Ops 4; Feb 2025: Sales 5, Ops 3/ })).toBeTruthy();
  /* One primary action; a list on the page ground. */
  expect(container.querySelectorAll('.ui-btn-primary').length).toBe(1);
  expect(screen.getByRole('button', { name: /Export/ }).className).toMatch(/ui-btn-primary/);
  expect(container.querySelector('.ui-card')).toBeNull();
  /* Only the filters the company has anything in: no employment type or grade picker here. */
  expect(screen.getByRole('textbox', { name: 'From' })).toBeTruthy();
  expect(screen.getByRole('textbox', { name: 'To' })).toBeTruthy();
  expect(api.runHrReport).toHaveBeenCalledWith('headcount', { from: '', to: '', by: '', departmentId: '', branchId: '', employeeTypeId: '', gradeId: '' });
});

it('asks the server again with the filters in the address, and exports the same ones', async () => {
  render(<HrReport params={{ report: 'headcount', departmentId: 'd1', from: '2025-01-01', to: '2025-03-31', by: 'branch' }} updateParams={vi.fn()} />);
  await screen.findByRole('table', { name: 'Headcount over time' });
  const filters = { from: '2025-01-01', to: '2025-03-31', by: 'branch', departmentId: 'd1', branchId: '', employeeTypeId: '', gradeId: '' };
  expect(api.runHrReport).toHaveBeenCalledWith('headcount', filters);
  fireEvent.click(screen.getByRole('button', { name: /Export/ }));
  await vi.waitFor(() => expect(api.hrReportCsv).toHaveBeenCalledWith('headcount', filters));
});

it('shows “fewer than 5” as the server sent it, a single day to choose, and no chart where there is none', async () => {
  render(<HrReport params={{ report: 'gender' }} updateParams={vi.fn()} />);
  const table = await screen.findByRole('table', { name: 'Gender mix' });
  expect(within(table).getAllByRole('row').slice(1).map((r) => [...r.children].map((c) => c.textContent))).toEqual([
    ['Sales', 'Fewer than 5', '5 or more', '9'],
    ['Everyone', 'Fewer than 5', '5 or more', '9'],
  ]);
  expect(screen.queryByRole('img')).toBeNull();
  expect(screen.getByRole('textbox', { name: 'As of' })).toBeTruthy();
  expect(screen.queryByRole('textbox', { name: 'From' })).toBeNull();
  expect(screen.getByText(/fewer than 5” or “5 or more”/)).toBeTruthy();
});

it('says so when nothing matches, offers to clear the filters, and has nothing to export', async () => {
  api.runHrReport.mockResolvedValue({ ...HEADCOUNT, rows: [], chart: null });
  const updateParams = vi.fn();
  render(<HrReport params={{ report: 'headcount', departmentId: 'd2' }} updateParams={updateParams} />);
  expect(await screen.findByText('Nothing in this period')).toBeTruthy();
  expect(screen.getByRole('button', { name: /Export/ }).disabled).toBe(true);
  fireEvent.click(screen.getByRole('button', { name: /Clear/ }));
  expect(updateParams).toHaveBeenCalledWith({ departmentId: null, branchId: null, employeeTypeId: null, gradeId: null }, { push: false });
});

it('a chart carries three colours at most: a fourth series is the grey “Other”', () => {
  const chart = { kind: 'stacked', categories: ['Jan'], series: [{ label: 'A', values: [4] }, { label: 'B', values: [3] }, { label: 'C', values: [2] }, { label: 'Other', values: [1], other: true }, { label: 'Stray', values: [1] }] };
  const { container } = render(<ReportChart chart={chart} label="Test" />);
  const colours = [...container.querySelectorAll('.people-chart-stack > span')].map((s) => s.style.getPropertyValue('--dept'));
  expect(colours).toEqual(['var(--dept-1)', 'var(--dept-2)', 'var(--dept-3)', 'var(--dept-0)', 'var(--dept-0)']);
  expect(new Set(colours.filter((c) => c !== 'var(--dept-0)')).size).toBeLessThanOrEqual(3);
  /* No colour of its own in the component: tokens only. */
  expect(container.innerHTML).not.toMatch(/#[0-9a-f]{3,6}\b|rgb\(\d/i);
});
