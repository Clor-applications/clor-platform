import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';

import { MonthReview, MyOvertime } from './MonthAndOvertime';
import { askOvertime, cancelOvertime, confirmMonth, disputeMonth, getMonthReview, getOvertime } from './portalApi';

/*
 * Time depth, gap 18: the web employee app checks the month (confirm, or say
 * what is wrong before the cutoff) and asks for overtime, as only the Android
 * app could.
 */
vi.mock('./portalApi', () => ({
  SignedOut: class SignedOut extends Error {},
  todayIst: () => '2026-11-02',
  hm: (m) => `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`,
  getMonthReview: vi.fn(), confirmMonth: vi.fn(), disputeMonth: vi.fn(),
  getOvertime: vi.fn(), askOvertime: vi.fn(), cancelOvertime: vi.fn(),
}));
const guard = (p) => p;
const summary = { payableDays: 25, lossOfPayDays: 1, present: 22, leave: 2, absent: 1, approvedOvertimeMinutes: 90 };
const unresolved = Array.from({ length: 7 }, (_, i) => ({ date: `2026-10-${String(10 + i).padStart(2, '0')}`, kind: 'NO_PUNCHES', text: 'No punches on a working day' }));

beforeEach(() => vi.clearAllMocks());

it('confirms the month, and reloads to say so', async () => {
  getMonthReview.mockResolvedValueOnce({ month: '2026-10', summary, unresolved: [], pendingOvertime: 0, cutoff: '2026-11-03', canConfirm: true, why: null, confirmation: null })
    .mockResolvedValueOnce({ month: '2026-10', summary, unresolved: [], pendingOvertime: 0, cutoff: '2026-11-03', canConfirm: true, why: null, confirmation: { status: 'CONFIRMED', note: null } });
  confirmMonth.mockResolvedValue({});
  render(<MonthReview guard={guard} />);
  fireEvent.click(await screen.findByRole('button', { name: 'These days are right' }));
  await waitFor(() => expect(confirmMonth).toHaveBeenCalledWith('2026-10'));
  expect(await screen.findByText('Confirmed. Thank you.')).toBeTruthy();
  expect(await screen.findByText('Confirmed')).toBeTruthy();
});

it('says what is wrong only with a few words, and sends it to HR', async () => {
  getMonthReview.mockResolvedValue({ month: '2026-10', summary, unresolved, pendingOvertime: 1, cutoff: '2026-11-03', canConfirm: true, why: null, confirmation: null });
  disputeMonth.mockResolvedValue({});
  render(<MonthReview guard={guard} />);
  /* A long list shows five, then all on asking. */
  await screen.findByText('Still to sort out');
  expect(screen.getAllByText('No punches on a working day')).toHaveLength(5);
  fireEvent.click(screen.getByRole('button', { name: 'Show all 7' }));
  expect(screen.getAllByText('No punches on a working day')).toHaveLength(7);
  fireEvent.click(screen.getByRole('button', { name: 'Something is wrong' }));
  const send = screen.getByRole('button', { name: 'Send to HR' });
  expect(send.disabled).toBe(true);
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'I was on duty on the 12th' } });
  fireEvent.click(send);
  await waitFor(() => expect(disputeMonth).toHaveBeenCalledWith('2026-10', 'I was on duty on the 12th'));
});

it('shows HR’s reply on a disputed month, or that HR has not answered yet', async () => {
  const disputed = { status: 'DISPUTED', note: 'I was on duty on the 12th' };
  getMonthReview.mockResolvedValueOnce({ month: '2026-10', summary, unresolved: [], pendingOvertime: 0, cutoff: '2026-11-01', canConfirm: false, why: null, confirmation: { ...disputed, reply: { text: 'Corrected the 12th to on duty.', at: '2026-11-05T10:00:00Z' } } });
  const { unmount } = render(<MonthReview guard={guard} />);
  expect(await screen.findByText('HR’s reply')).toBeTruthy();
  expect(screen.getByText('Corrected the 12th to on duty.')).toBeTruthy();
  unmount();
  getMonthReview.mockResolvedValueOnce({ month: '2026-10', summary, unresolved: [], pendingOvertime: 0, cutoff: '2026-11-01', canConfirm: false, why: null, confirmation: { ...disputed, reply: null } });
  render(<MonthReview guard={guard} />);
  expect(await screen.findByText('HR has not answered yet.')).toBeTruthy();
});

it('after the cutoff, says why instead of offering to confirm', async () => {
  getMonthReview.mockResolvedValue({ month: '2026-10', summary, unresolved: [], pendingOvertime: 0, cutoff: '2026-11-01', canConfirm: false, why: 'The cutoff has passed. Ask HR to change anything still wrong.', confirmation: null });
  render(<MonthReview guard={guard} />);
  expect(await screen.findByText(/cutoff has passed/)).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'These days are right' })).toBeNull();
});

it('asks for overtime on a day that has it, and withdraws one still waiting', async () => {
  getOvertime.mockResolvedValue({ month: '2026-11', recordedMinutes: 160, approvedMinutes: 0, pendingMinutes: 40, policy: { overtimeRequests: true, compOff: false }, days: [
    { date: '2026-10-27', workedMinutes: 700, overtimeMinutes: 160, overtimeApproved: false, restDay: false, compOffDays: 0, overtimeRequest: null, compOffRequest: null, canAskOvertime: true, canAskCompOff: false },
    { date: '2026-10-28', workedMinutes: 580, overtimeMinutes: 40, overtimeApproved: false, restDay: false, compOffDays: 0, overtimeRequest: { id: 'o1', status: 'PENDING', note: null }, compOffRequest: null, canAskOvertime: false, canAskCompOff: false },
  ] });
  askOvertime.mockResolvedValue({});
  cancelOvertime.mockResolvedValue({});
  render(<MyOvertime guard={guard} />);
  fireEvent.click(await screen.findByRole('button', { name: 'Ask for overtime' }));
  fireEvent.change(screen.getByPlaceholderText(/stock count/), { target: { value: 'Month-end close' } });
  fireEvent.click(screen.getByRole('button', { name: 'Send' }));
  await waitFor(() => expect(askOvertime).toHaveBeenCalledWith({ date: '2026-10-27', kind: 'OVERTIME', reason: 'Month-end close' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Withdraw' }));
  await waitFor(() => expect(cancelOvertime).toHaveBeenCalledWith('o1'));
});

it('says so when there is no overtime in the month', async () => {
  getOvertime.mockResolvedValue({ month: '2026-11', recordedMinutes: 0, approvedMinutes: 0, pendingMinutes: 0, policy: {}, days: [] });
  render(<MyOvertime guard={guard} />);
  expect(await screen.findByText(/No overtime or work on a day off/)).toBeTruthy();
});
