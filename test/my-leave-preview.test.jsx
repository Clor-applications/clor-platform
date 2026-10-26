import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

/*
 * My leave (People → Time & Leave, and Attendance): asking for leave shows,
 * before sending, the days it takes, the dates it skips and why, the balance
 * after, and what stops it; a request across the leave-period end is sent as
 * a split; a private type needs no reason.
 */
const att = vi.hoisted(() => ({
  getMyLeave: vi.fn(),
  applyLeave: vi.fn(),
  cancelMyLeave: vi.fn(),
  explainMyLeave: vi.fn(() => Promise.resolve({})),
}));
const http = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock('../apps/attendance/src/api/attendance', () => ({ ...att, LEAVE_STATUS: { PENDING: 'ui-pill-warn', APPROVED: 'ui-pill-pos', REJECTED: 'ui-pill-neg', CANCELLED: 'ui-pill-neutral' } }));
vi.mock('@platform/http', () => ({ apiFetch: http.apiFetch, API_BASE: '/api' }));
vi.mock('@platform/context', () => ({ orgId: () => 'org1', currentUser: () => null }));
vi.mock('../packages/ui/src/components/ui/notify', () => ({ confirmDialog: vi.fn(async () => true), notify: { error: vi.fn(), success: vi.fn() } }));
vi.mock('@ui/components/ui/notify', () => ({ confirmDialog: vi.fn(async () => true), notify: { error: vi.fn(), success: vi.fn() } }));

const casual = { id: 't1', name: 'Casual leave', isPaid: true, available: 5, allocated: 12, used: 7, pending: 0 };
const sick = { id: 't2', name: 'Sick leave', isPaid: true, available: 6, allocated: 6, used: 0, pending: 0 };

const preview = (over = {}) => ({
  ok: true,
  type: { id: 't1', name: 'Casual leave', isPaid: true, isPrivate: false, allowHalfDay: true },
  total: 3,
  split: false,
  parts: [{ year: 2026, label: '2026–27', from: '2026-12-11', to: '2026-12-15', days: 3, balance: { before: 5, after: 2 }, dates: [
    { date: '2026-12-11', counted: true, why: null },
    { date: '2026-12-12', counted: false, why: 'Weekly off' },
    { date: '2026-12-13', counted: false, why: 'Holiday: Diwali' },
    { date: '2026-12-14', counted: true, why: null },
    { date: '2026-12-15', counted: true, why: null },
  ] }],
  problems: [],
  reasonNeeded: true,
  ...over,
});

async function openForm() {
  const { default: MyLeave } = await import('../apps/attendance/src/screens/MyLeave');
  render(<MyLeave />);
  fireEvent.click(await screen.findByRole('button', { name: /Ask for leave/ }));
  return screen.findByRole('dialog', { name: 'Ask for leave' });
}
async function pickType(name) {
  fireEvent.click(screen.getByRole('combobox', { name: 'Leave type *' }));
  fireEvent.click(await screen.findByRole('option', { name: new RegExp(name) }));
}
function typeDate(id, text) {
  const input = document.getElementById(id);
  fireEvent.change(input, { target: { value: text } });
  fireEvent.blur(input);
}

describe('My leave: the preview before sending', () => {
  afterEach(() => { cleanup(); vi.clearAllMocks(); });

  it('shows the days, the dates skipped and why, and the balance after; sends what was previewed', async () => {
    att.getMyLeave.mockResolvedValue({ year: 2026, today: '2026-10-26', employee: { id: 'e1', name: 'Asha' }, types: [casual, sick], requests: [] });
    http.apiFetch.mockResolvedValue(preview());
    att.applyLeave.mockResolvedValue({ request: { days: 3, leaveTypeName: 'Casual leave' } });
    await openForm();
    await pickType('Casual leave');
    typeDate('ml-from', '11/12/2026');
    typeDate('ml-to', '15/12/2026');

    expect(await screen.findByText('3 days')).toBeTruthy();
    expect(screen.getByText(/Weekly off/)).toBeTruthy();
    expect(screen.getByText(/Holiday: Diwali/)).toBeTruthy();
    expect(screen.getByText(/left after this/).textContent).toMatch(/2/);
    expect(http.apiFetch).toHaveBeenCalledWith('/orgs/org1/attendance/me/leave/preview', expect.objectContaining({ method: 'POST', body: { leaveTypeId: 't1', fromDate: '2026-12-11', toDate: '2026-12-15', halfDay: null } }));

    const send = screen.getByRole('button', { name: 'Send' });
    expect(send.disabled).toBe(true); /* the reason is still empty */
    fireEvent.change(screen.getByLabelText('Reason *'), { target: { value: 'Family wedding' } });
    expect(send.disabled).toBe(false);
    fireEvent.click(send);
    await waitFor(() => expect(att.applyLeave).toHaveBeenCalledWith({ leaveTypeId: 't1', fromDate: '2026-12-11', toDate: '2026-12-15', halfDay: null, reason: 'Family wedding' }));
  });

  it('a problem in the preview holds Send back, in plain words', async () => {
    att.getMyLeave.mockResolvedValue({ year: 2026, today: '2026-10-26', employee: { id: 'e1', name: 'Asha' }, types: [casual], requests: [] });
    http.apiFetch.mockResolvedValue(preview({ ok: false, problems: [{ code: 'NO_BALANCE', message: 'Only 5 days of Casual leave are left this year; this is 8.' }] }));
    await openForm();
    await pickType('Casual leave');
    typeDate('ml-from', '11/12/2026');
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByText(/Only 5 days of Casual leave are left/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Reason *'), { target: { value: 'Family wedding' } });
    expect(screen.getByRole('button', { name: 'Send' }).disabled).toBe(true);
  });

  it('across the period end it says two requests and sends split; a private type needs no reason', async () => {
    att.getMyLeave.mockResolvedValue({ year: 2026, today: '2026-10-26', employee: { id: 'e1', name: 'Asha' }, types: [sick], requests: [] });
    http.apiFetch.mockResolvedValue(preview({
      type: { id: 't2', name: 'Sick leave', isPaid: true, isPrivate: true, allowHalfDay: false },
      total: 3,
      split: true,
      reasonNeeded: false,
      parts: [
        { year: 2026, label: '2026–27', from: '2027-03-30', to: '2027-03-31', days: 2, balance: { before: 6, after: 4 }, dates: [] },
        { year: 2027, label: '2027–28', from: '2027-04-01', to: '2027-04-01', days: 1, balance: { before: 6, after: 5 }, dates: [] },
      ],
    }));
    att.applyLeave.mockResolvedValue({ request: { days: 2, leaveTypeName: 'Sick leave' }, requests: [{ days: 2 }, { days: 1 }] });
    await openForm();
    await pickType('Sick leave');
    typeDate('ml-from', '30/03/2027');
    typeDate('ml-to', '01/04/2027');
    expect(await screen.findByText(/saved as two requests, one per leave period/)).toBeTruthy();
    expect(screen.getByText(/2027–28: 1 day/)).toBeTruthy();
    expect(screen.getByLabelText('Reason')).toBeTruthy();
    const send = screen.getByRole('button', { name: 'Send' });
    expect(send.disabled).toBe(false);
    fireEvent.click(send);
    await waitFor(() => expect(att.applyLeave).toHaveBeenCalledWith(expect.objectContaining({ leaveTypeId: 't2', fromDate: '2027-03-30', toDate: '2027-04-01', reason: '', split: true })));
  });
});
