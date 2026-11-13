import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const http = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock('@platform/http', () => ({ apiFetch: (...a) => http.apiFetch(...a) }));
vi.mock('@platform/context', () => ({ orgId: () => 'org1', requestOpenScreen: vi.fn() }));

import Inbox from './Inbox';

const now = Date.now();
const iso = (hoursAgo) => new Date(now - hoursAgo * 3600000).toISOString();
const DATA = {
  rows: [
    { app: 'accounting', key: 'b1', kind: 'decide', title: 'Invoice to approve', who: 'Meera Pillai', detail: '₹12,000', since: iso(30), overdue: false, open: { app: 'accounting', screen: 'approvals' } },
    { app: 'people', key: 'p1', kind: 'decide', title: 'Casual leave', who: 'Asha Rao', detail: 'Leave · 20 Nov to 21 Nov', since: iso(2), overdue: false, open: { app: 'people', screen: 'approvals' } },
    { app: 'people', key: 't1', kind: 'task', title: 'Collect ID and address proof', who: 'Asha Rao', detail: 'Due 13 Nov', since: iso(1), overdue: false, open: { app: 'people', screen: 'approvals', params: { tab: 'tasks' } } },
  ],
  updates: [{ id: 'n1', app: 'payroll', title: 'Bank details changed', body: null, at: iso(1), read: false, open: { app: 'payroll', screen: 'bankChanges' } }],
  unanswered: [],
};

beforeEach(() => http.apiFetch.mockReset());

/* Workspace plan P1: one list of what waits on you in every app; each row opens the app that decides it. */
describe('Workspace Inbox', () => {
  it('lists what waits to be decided, filters by app, and opens the owning app', async () => {
    http.apiFetch.mockResolvedValue(DATA);
    const openApp = vi.fn();
    render(<Inbox openApp={openApp} />);
    const table = within(await screen.findByRole('table', { name: 'To decide' }));
    expect(table.getByText('Invoice to approve')).toBeInTheDocument();
    expect(table.getByText('Casual leave')).toBeInTheDocument();
    expect(table.queryByText('Collect ID and address proof')).toBeNull();
    expect(screen.getByRole('tab', { name: /To decide/ })).toHaveTextContent('2');

    fireEvent.change(screen.getByRole('combobox', { name: 'App' }), { target: { value: 'people' } });
    expect(table.queryByText('Invoice to approve')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Open Casual leave in People' }));
    expect(openApp).toHaveBeenCalledWith('people', 'approvals', {});
  });

  it('shows tasks with their due date and updates with a link, and names an app that did not answer', async () => {
    http.apiFetch.mockResolvedValue({ ...DATA, unanswered: ['payroll'] });
    const openApp = vi.fn();
    render(<Inbox openApp={openApp} />);
    expect(await screen.findByRole('status')).toHaveTextContent('Could not reach Payroll');

    fireEvent.click(screen.getByRole('tab', { name: /Your tasks/ }));
    const tasks = within(screen.getByRole('table', { name: 'Your tasks' }));
    expect(tasks.getByText('13 Nov')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('tab', { name: /Updates/ }));
    const updates = within(screen.getByRole('table', { name: 'Updates' }));
    fireEvent.click(updates.getByRole('button', { name: /Open/ }));
    expect(openApp).toHaveBeenCalledWith('payroll', 'bankChanges', {});
  });

  it('says so when nothing waits', async () => {
    http.apiFetch.mockResolvedValue({ rows: [], updates: [], unanswered: [] });
    render(<Inbox />);
    expect(await screen.findByText('Nothing waits for your decision.')).toBeInTheDocument();
  });
});
