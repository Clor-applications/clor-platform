import React from 'react';
import { describe, expect, it, vi, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { RoleAccessList, changeWords, roleAccessList } from './round38';

vi.mock('@platform/admin/account', () => ({ openTicket: vi.fn(() => Promise.resolve({ id: 't1' })) }));
vi.mock('@ui/components/ui/notify', () => ({ notify: { success: vi.fn() }, confirmDialog: vi.fn(() => Promise.resolve(true)) }));

import { openTicket } from '@platform/admin/account';
import AskSupport, { STATUS_URL, ticketAppHere, ticketReady } from '../../../../packages/shell/AskSupport';

afterEach(cleanup);

const modules = [
  {
    key: 'PEOPLE',
    label: 'People',
    resources: [
      { key: 'Employees', label: 'Employees', actions: ['VIEW', 'CREATE', 'EDIT', 'DELETE'] },
      { key: 'Salary', label: 'Salary', actions: ['VIEW', 'EDIT'] },
      { key: 'Documents', label: 'Documents', actions: ['VIEW'] },
    ],
  },
  { key: 'PAYROLL', label: 'Payroll', resources: [{ key: 'Runs', label: 'Pay runs', actions: ['VIEW', 'APPROVE'] }] },
];

describe('round 38: what a role can see', () => {
  it('lists only screens the role reaches, with what it can change', () => {
    const granted = new Set(['PEOPLE::Employees::VIEW', 'PEOPLE::Employees::CREATE', 'PEOPLE::Employees::EDIT', 'PEOPLE::Documents::VIEW']);
    const groups = roleAccessList(modules, granted);
    expect(groups).toHaveLength(1);
    expect(groups[0].label).toBe('People');
    expect(groups[0].rows.map((r) => [r.label, r.change])).toEqual([
      ['Employees', ['add', 'edit']],
      ['Documents', []],
    ]);
  });

  it('counts a change without view as seeing the screen', () => {
    const groups = roleAccessList(modules, new Set(['PAYROLL::Runs::APPROVE']));
    expect(groups[0].rows[0]).toMatchObject({ label: 'Pay runs', see: true, change: ['approve'] });
  });

  it('joins change words in plain English', () => {
    expect(changeWords(['add'])).toBe('add');
    expect(changeWords(['add', 'edit', 'approve'])).toBe('add, edit and approve');
  });

  it('renders Can see / Can change by screen, and says when a role sees nothing', () => {
    render(<RoleAccessList modules={modules} granted={new Set(['PEOPLE::Salary::VIEW', 'PEOPLE::Salary::EDIT'])} roleName="Branch HR" />);
    expect(screen.getByRole('columnheader', { name: 'Can change' })).toBeTruthy();
    expect(screen.getByText('Yes: edit')).toBeTruthy();
    cleanup();
    render(<RoleAccessList modules={modules} granted={new Set()} roleName="Branch HR" />);
    expect(screen.getByText(/Branch HR can see nothing yet/)).toBeTruthy();
  });
});

describe('round 38: Ask CLOR support', () => {
  it('names the app from the address and needs a real question', () => {
    expect(ticketAppHere('people.clor.in')).toBe('people');
    expect(ticketAppHere('app.clor.in')).toBe(null);
    expect(ticketReady('PF', 'x')).toBe(false);
    expect(ticketReady('PF settings', 'It will not save the rate.')).toBe(true);
    expect(STATUS_URL).toBe('https://clor.in/status');
  });

  it('sends the ticket and closes', async () => {
    const onClose = vi.fn();
    render(<AskSupport onClose={onClose} />);
    const send = screen.getByRole('button', { name: /Send to CLOR/ });
    expect(send.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Subject'), { target: { value: 'PF settings will not save' } });
    fireEvent.change(screen.getByLabelText('What happened'), { target: { value: 'I set the rate to 12% and it goes back.' } });
    fireEvent.click(screen.getByRole('button', { name: /Send to CLOR/ }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(openTicket).toHaveBeenCalledWith(expect.objectContaining({ subject: 'PF settings will not save', category: 'QUESTION', urgent: false }));
  });
});
