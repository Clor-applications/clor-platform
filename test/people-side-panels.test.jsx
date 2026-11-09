import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

vi.mock('@ui/personnel/Employees', () => ({ Avatar: () => null }));
vi.mock('@platform/context', () => ({ orgId: () => 'org1' }));
vi.mock('@ui/personnel/api', () => ({
  CHECKLIST_OWNER: { HR: 'HR', IT: 'IT / admin' },
  listAllEmployees: vi.fn(async () => ({ employees: [] })),
  listCompanyDocuments: vi.fn(async () => []),
  listOpenChecklistTasks: vi.fn(async () => []),
}));
vi.mock('@ui/timeOff/api', () => ({
  getLeaveBalances: vi.fn(async () => ({ types: [], rows: [] })),
  getTimeOverview: vi.fn(async () => ({})),
  listHolidays: vi.fn(async () => []),
  listLeaveRequests: vi.fn(async () => []),
  /* The panels take today from India's clock; the tests build dates from the device's, so the mock matches them. */
  todayIst: () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; },
}));
vi.mock('../apps/people/src/api/approvals', () => ({ getInbox: vi.fn(async () => ({ items: [], counts: {} })) }));
vi.mock('../apps/people/src/api/desk', () => ({ listDesk: vi.fn(async () => ({ requests: [] })) }));
vi.mock('../apps/people/src/organization/api', () => ({ listItems: vi.fn(async () => []) }));

import * as timeOff from '@ui/timeOff/api';
import * as personnel from '@ui/personnel/api';
import { getInbox } from '../apps/people/src/api/approvals';
import { SideBlock, SideLine, ago } from '@ui/components/list/SidePanel';
import { EmployeesPanel } from '../apps/people/src/panels';

afterEach(() => { cleanup(); vi.clearAllMocks(); });

const iso = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

describe('the side panel beside a list', () => {
  it('draws no block that has nothing to say', () => {
    const { container } = render(<SideBlock title="Late">{null}{false}</SideBlock>);
    expect(container.innerHTML).toBe('');
  });

  it('makes a line a button only when it goes somewhere', () => {
    const go = vi.fn();
    render(<><SideLine title="Sales" meta={6} onClick={go} /><SideLine title="Nobody is off this week" /></>);
    fireEvent.click(screen.getByRole('button', { name: /Sales/ }));
    expect(go).toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: /Nobody/ })).toBeNull();
  });

  it('says how long ago in a few letters', () => {
    expect(ago(new Date(Date.now() - 3 * 3600_000))).toBe('3h');
    expect(ago(new Date(Date.now() - 2 * 86_400_000))).toBe('2d');
  });
});

describe('People list panels', () => {
  /* Leave requests and Approvals lost their side columns (People plan 8 Nov 2026, §3 rule 3): the list says it all. */
  it('Employees: a department opens the list filtered to it', async () => {
    personnel.listAllEmployees.mockResolvedValue({ employees: [
      { id: '1', name: 'A', departmentId: 'd1', department: 'Sales', reportingManagerId: 'm', workEmail: 'a@x' },
      { id: '2', name: 'B', departmentId: 'd1', department: 'Sales', reportingManagerId: 'm', workEmail: 'b@x' },
      { id: '3', name: 'C', departmentId: 'd2', department: 'Finance', reportingManagerId: null, workEmail: 'c@x' },
    ] });
    const openScreen = vi.fn();
    render(<EmployeesPanel openScreen={openScreen} />);
    await waitFor(() => expect(screen.getByRole('button', { name: /Sales/ })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /Sales/ }));
    expect(openScreen).toHaveBeenCalledWith('employees', { dept: 'd1' });
    expect(screen.getByRole('button', { name: /1 without a manager/ })).toBeTruthy();
  });
});
