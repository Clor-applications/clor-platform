import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { teamBalanceRows, teamCounts, teamCsv, teamDue } from './round65';

const listEmployees = vi.fn();
const getLeaveBalances = vi.fn();
const downloadText = vi.fn();
vi.mock('./api', () => ({ listEmployees: (...a) => listEmployees(...a), downloadText: (...a) => downloadText(...a) }));
vi.mock('@ui/timeOff/api', () => ({ getLeaveBalances: (...a) => getLeaveBalances(...a), thisYear: () => 2026 }));
vi.mock('@ui/utils/dates', () => ({ todayIst: () => '2026-11-18', plusDaysIso: () => '2026-11-19' }));

const { default: MyTeamPanel } = await import('./MyTeamPanel');

const TODAY = '2026-11-18';
const team = [
  { id: 'e1', name: 'Ravi Kumar', code: 'E1', designation: 'Sales executive', department: 'Sales', phone: '98400 11111', status: 'ACTIVE', dateOfJoining: '2023-11-25' },
  { id: 'e2', name: 'Meena Iyer', code: 'E2', designation: 'Analyst', status: 'ACTIVE', dateOfJoining: '2026-06-01', probationEndDate: '2026-11-30' },
  { id: 'e3', name: 'Arun Das', status: 'ON_NOTICE', dateOfJoining: '2022-01-10', contractEndDate: '2026-11-20' },
  { id: 'e4', name: 'Kavya Rao', status: 'ACTIVE', dateOfJoining: '2026-12-01' },
  { id: 'e5', name: 'Old Hand', status: 'ACTIVE', dateOfJoining: '2020-11-02' },
];
const balances = {
  types: [{ id: 'cl', name: 'Casual leave', code: 'CL' }, { id: 'sl', name: 'Sick leave', code: 'SL' }],
  rows: [
    { employeeId: 'e1', name: 'Ravi Kumar', balances: { cl: { available: 4 }, sl: { available: 6 } } },
    { employeeId: 'e2', name: 'Meena Iyer', balances: { cl: { available: 1 }, sl: { available: 3 } } },
    { employeeId: 'zz', name: 'Not in team', balances: { cl: { available: 9 } } },
  ],
};

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('round 65 team sums (teamcount A, teamdue A, teambalances A, teamexport A)', () => {
  it('counts people here, joining later and on notice', () => {
    expect(teamCounts(team, TODAY)).toEqual({ people: 4, joining: 1, leaving: 1 });
  });

  it('lists what falls due from today to month end, earliest first', () => {
    const due = teamDue(team, TODAY);
    expect(due.map((d) => d.text)).toEqual(['Arun’s contract ends', 'Ravi completes 3 years', 'Meena’s probation ends']);
    expect(due.find((d) => d.kind === 'probation').action).toBe('Give your view');
    /* An anniversary earlier this month has passed; a confirmed probation is not due. */
    expect(teamDue([{ ...team[1], confirmedOn: '2026-11-01' }], TODAY)).toEqual([]);
  });

  it('keeps only the team in the balance table and sorts by the chosen type', () => {
    expect(teamBalanceRows(balances, ['e1', 'e2'], 'cl').map((r) => r.name)).toEqual(['Ravi Kumar', 'Meena Iyer']);
    expect(teamBalanceRows(balances, ['e1', 'e2'], '').map((r) => r.name)).toEqual(['Meena Iyer', 'Ravi Kumar']);
  });

  it('writes the team as CSV with leave left per type', () => {
    const csv = teamCsv(team.slice(0, 2), balances);
    const [head, ravi] = csv.replace('﻿', '').trim().split('\n');
    expect(head).toBe('Name,Employee ID,Role,Department,Phone,Work email,Casual leave left,Sick leave left');
    expect(ravi).toBe('Ravi Kumar,E1,Sales executive,Sales,98400 11111,,4,6');
  });
});

describe('My team panel', () => {
  it('shows the count line, due list and leave table; links filter and open records', async () => {
    listEmployees.mockResolvedValue({ employees: team, total: team.length });
    getLeaveBalances.mockResolvedValue(balances);
    const onFilter = vi.fn();
    const openScreen = vi.fn();
    render(<MyTeamPanel onFilter={onFilter} openScreen={openScreen} />);
    expect(await screen.findByRole('button', { name: '4 people' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '1 joining' }));
    expect(onFilter).toHaveBeenCalledWith({ status: null, from: '2026-11-19' });
    fireEvent.click(screen.getByRole('button', { name: '1 leaving' }));
    expect(onFilter).toHaveBeenCalledWith({ status: 'ON_NOTICE', from: null });
    fireEvent.click(screen.getByRole('button', { name: 'Give your view' }));
    expect(openScreen).toHaveBeenCalledWith('employee', { id: 'e2' });
    const table = await screen.findByRole('table');
    expect(within(table).queryByText('Not in team')).toBeNull();
    expect(within(table).getByText('Ravi Kumar')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Download team/ }));
    expect(downloadText).toHaveBeenCalledWith(expect.stringContaining('Ravi Kumar'), 'my-team-2026-11-18.csv');
  });

  it('leaves out the leave table when balances cannot be read, and draws nothing for an empty team', async () => {
    listEmployees.mockResolvedValue({ employees: team, total: team.length });
    getLeaveBalances.mockRejectedValue(new Error('No access'));
    render(<MyTeamPanel onFilter={vi.fn()} openScreen={vi.fn()} />);
    await screen.findByRole('button', { name: '4 people' });
    expect(screen.queryByRole('table')).toBeNull();
    cleanup();
    listEmployees.mockResolvedValue({ employees: [], total: 0 });
    getLeaveBalances.mockResolvedValue(balances);
    const { container } = render(<MyTeamPanel onFilter={vi.fn()} openScreen={vi.fn()} />);
    await new Promise((r) => setTimeout(r, 0));
    expect(container.textContent).toBe('');
  });
});
