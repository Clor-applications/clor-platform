import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/*
 * Time & Leave → Attendance requests (TIME-LEAVE-DECISIONS.md, advanced
 * build): the list asks the server for one page with its tab, kind and
 * counts; a rejection needs a note; entering a request sends the kind and
 * the place; Request rules save only the kinds that changed.
 */
const api = vi.hoisted(() => ({
  pageRequests: vi.fn(),
  getRequest: vi.fn(),
  decideRequest: vi.fn(() => Promise.resolve({ request: {} })),
  cancelRequest: vi.fn(() => Promise.resolve({})),
  createRequest: vi.fn(() => Promise.resolve({ request: { id: 'new' } })),
  updateRequest: vi.fn(),
  requestUsage: vi.fn(() => Promise.resolve({ month: '2026-11', usage: { ON_DUTY: { kind: 'ON_DUTY', unit: 'days', used: 1, pending: 0, quota: 4, left: 3 } } })),
  getRequestRules: vi.fn(),
  saveRequestRules: vi.fn((body) => Promise.resolve({ rules: body })),
  listPeople: vi.fn(() => Promise.resolve([{ id: 'e1', name: 'Rekha Nair', code: 'MF-020' }])),
  bulkReviewRequests: vi.fn(() => Promise.resolve({ done: 1, failed: 0, handedOn: 0, results: [] })),
}));
const perms = vi.hoisted(() => ({ current: { isAdmin: true, permissions: new Set() } }));
vi.mock('../packages/ui/src/timeOff/api', async (orig) => ({ ...(await orig()), ...api }));
vi.mock('../packages/ui/src/timeOff/suggestions', () => ({ useSuggestions: () => [] }));
vi.mock('@ui/permissions/usePermissions', () => ({ usePermissions: () => perms.current }));
vi.mock('../packages/ui/src/permissions/usePermissions', () => ({ usePermissions: () => perms.current }));
vi.mock('@ui/components/ui/notify', () => ({ confirmDialog: vi.fn(async () => true), notify: { error: vi.fn(), success: vi.fn() } }));
vi.mock('@ui/components/ui/useUnsavedChanges', () => ({ default: () => {} }));

import AttendanceRequests from '../packages/ui/src/timeOff/AttendanceRequests';
import RequestRules from '../packages/ui/src/timeOff/RequestRules';

const RULES = {
  MISSED_PUNCH: { on: true, quotaPerMonth: 3, hoursPerMonth: null, maxMinutes: 0, backDays: 30, approval: null },
  WFH: { on: true, quotaPerMonth: 4, hoursPerMonth: null, maxMinutes: 0, backDays: 7, approval: null },
  ON_DUTY: { on: true, quotaPerMonth: null, hoursPerMonth: null, maxMinutes: 0, backDays: 7, approval: 'MANAGER' },
  PERMISSION: { on: false, quotaPerMonth: null, hoursPerMonth: 4, maxMinutes: 120, backDays: 7, approval: null },
};
const row = { id: 'r1', employeeId: 'e1', employeeName: 'Rekha Nair', employeeCode: 'MF-020', department: 'Design', kind: 'WFH', date: '2026-11-02', toDate: '2026-11-03', halfDay: null, place: null, minutes: null, checkInTime: null, checkOutTime: null, reason: 'Plumber at home', status: 'PENDING', managerApprovedAt: null, createdAt: new Date().toISOString() };

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  perms.current = { isAdmin: true, permissions: new Set() };
});

describe('Attendance requests', () => {
  beforeEach(() => {
    api.pageRequests.mockResolvedValue({ requests: [row], total: 1, counts: { PENDING: 1, APPROVED: 6, REJECTED: 0, CANCELLED: 0, all: 7 } });
    api.getRequest.mockResolvedValue({
      request: row,
      history: [{ at: new Date().toISOString(), by: 'u1', byName: 'Rekha Nair', what: 'Asked' }],
      usage: { kind: 'WFH', unit: 'days', used: 2, pending: 2, quota: 4, left: 0 },
      rule: RULES.WFH, chain: 'HR', days: [], waitingForManager: null, ownRequest: false,
    });
    api.getRequestRules.mockResolvedValue({ rules: RULES, kinds: Object.keys(RULES), chains: ['HR', 'MANAGER', 'MANAGER_THEN_HR'], defaults: RULES });
  });

  it('asks the server for one page of the Waiting tab, with the kind filter, and shows the tab counts', async () => {
    render(<AttendanceRequests params={{ kind: 'ON_DUTY' }} updateParams={() => {}} />);
    await screen.findAllByText('Rekha Nair');
    expect(api.pageRequests).toHaveBeenCalledWith(expect.objectContaining({ status: 'PENDING', kind: 'ON_DUTY', limit: 25, offset: 0 }));
    expect(screen.getByRole('tab', { name: /Approved/ })).toHaveTextContent('6');
    expect(screen.getAllByText('Work from home').length).toBeGreaterThan(0);
  });

  it('several waiting requests can be chosen and decided at once; rejecting them needs one note', async () => {
    const user = userEvent.setup();
    render(<AttendanceRequests params={{}} updateParams={() => {}} />);
    await screen.findAllByText('Rekha Nair');
    await user.click(screen.getAllByRole('checkbox', { name: 'Choose Rekha Nair' })[0]);
    const bar = await screen.findByRole('region', { name: 'Decide the chosen requests' });
    expect(bar).toHaveTextContent('1 chosen');
    expect(within(bar).getByRole('button', { name: /Reject/ })).toBeDisabled();
    await user.type(within(bar).getByLabelText('Note to them'), 'Office day');
    expect(within(bar).getByRole('button', { name: /Reject/ })).toBeEnabled();
    await user.click(within(bar).getByRole('button', { name: /Approve/ }));
    await waitFor(() => expect(api.bulkReviewRequests).toHaveBeenCalledWith(['r1'], true, 'Office day'));
  });

  it('a rejection needs a note; the drawer says how much of the month is used', async () => {
    const user = userEvent.setup();
    render(<AttendanceRequests params={{ id: 'r1' }} updateParams={() => {}} />);
    expect(await screen.findByText('2 of 4 work-from-home days used, 2 waiting')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Reject/ }));
    expect(await screen.findByText('Say why. They see this with the decision.')).toBeInTheDocument();
    expect(api.decideRequest).not.toHaveBeenCalled();
    await user.type(screen.getByLabelText('Note to them'), 'The month is full');
    await user.click(screen.getByRole('button', { name: /Reject/ }));
    await waitFor(() => expect(api.decideRequest).toHaveBeenCalledWith('r1', false, 'The month is full'));
  });

  it('Enter request offers only the kinds that are on, and sends the kind and the place', async () => {
    const user = userEvent.setup();
    render(<AttendanceRequests params={{}} updateParams={() => {}} />);
    await screen.findAllByText('Rekha Nair');
    await user.click(screen.getByRole('button', { name: 'Enter request' }));
    await user.click(await screen.findByRole('combobox', { name: 'Employee *' }));
    await user.click(await screen.findByRole('option', { name: /Rekha Nair/ }));
    await user.click(screen.getByRole('combobox', { name: 'Kind *' }));
    expect(await screen.findByRole('option', { name: 'On duty' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Permission' })).toBeNull();
    await user.click(screen.getByRole('option', { name: 'On duty' }));
    const first = screen.getByLabelText('First day');
    fireEvent.change(first, { target: { value: '02/11/2026' } });
    fireEvent.blur(first);
    await user.type(screen.getByLabelText('Place *'), 'Client office, Whitefield');
    await user.type(screen.getByLabelText('Reason *'), 'Site visit');
    expect(await screen.findByText(/1 of 4 on-duty days used/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.createRequest).toHaveBeenCalledWith(expect.objectContaining({ employeeId: 'e1', kind: 'ON_DUTY', date: '2026-11-02', toDate: null, place: 'Client office, Whitefield', reason: 'Site visit' })));
  });

  it('a shift change asks for the shift to work, with its hours, and no half day', async () => {
    api.getRequestRules.mockResolvedValue({ rules: { ...RULES, SHIFT_CHANGE: { on: true, quotaPerMonth: null, hoursPerMonth: null, maxMinutes: 0, backDays: 0, approval: null } }, shifts: [{ id: 's2', name: 'Late', startTime: '14:00', endTime: '22:00' }] });
    const user = userEvent.setup();
    render(<AttendanceRequests params={{}} updateParams={() => {}} />);
    await screen.findAllByText('Rekha Nair');
    await user.click(screen.getByRole('button', { name: 'Enter request' }));
    await user.click(await screen.findByRole('combobox', { name: 'Employee *' }));
    await user.click(await screen.findByRole('option', { name: /Rekha Nair/ }));
    await user.click(screen.getByRole('combobox', { name: 'Kind *' }));
    await user.click(await screen.findByRole('option', { name: 'Shift change' }));
    const first = screen.getByLabelText('First day');
    fireEvent.change(first, { target: { value: '16/11/2026' } });
    fireEvent.blur(first);
    expect(screen.queryByRole('combobox', { name: 'Day' })).toBeNull();
    await user.type(screen.getByLabelText('Reason *'), 'Covering the late counter');
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    await user.click(screen.getByRole('combobox', { name: 'Shift to work *' }));
    await user.click(await screen.findByRole('option', { name: 'Late, 14:00–22:00' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.createRequest).toHaveBeenCalledWith(expect.objectContaining({ employeeId: 'e1', kind: 'SHIFT_CHANGE', date: '2026-11-16', shiftId: 's2', halfDay: null, place: null })));
  });
});

describe('Request rules', () => {
  beforeEach(() => {
    api.getRequestRules.mockResolvedValue({ rules: RULES, kinds: Object.keys(RULES), chains: ['HR', 'MANAGER', 'MANAGER_THEN_HR'], defaults: RULES });
  });

  it('saves only the kinds that changed, once something changed', async () => {
    render(<RequestRules />);
    const save = await screen.findByRole('button', { name: 'Save' });
    expect(save).toBeDisabled();
    const days = screen.getAllByLabelText('Days a month');
    fireEvent.change(days[0], { target: { value: '6' } });
    expect(save).toBeEnabled();
    fireEvent.click(save);
    await waitFor(() => expect(api.saveRequestRules).toHaveBeenCalledWith({ WFH: { on: true, quotaPerMonth: 6, backDays: 7, approval: null } }));
  });

  it('is read only without the right to decide requests', async () => {
    perms.current = { isAdmin: false, permissions: new Set(['ATTENDANCE::Attendance Requests::VIEW']) };
    render(<RequestRules />);
    await screen.findByText('Work from home');
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
    expect(screen.getAllByLabelText('Days a month')[0]).toBeDisabled();
  });
});
