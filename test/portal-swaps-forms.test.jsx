import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

vi.mock('../packages/ui/src/components/ui/notify', () => ({ confirmDialog: vi.fn(async () => true), notify: { error: vi.fn(), success: vi.fn() } }));
vi.mock('../apps/attendance/src/portal/portalApi', () => ({
  SignedOut: class SignedOut extends Error {},
  todayIst: () => '2026-10-30',
  getSwaps: vi.fn(),
  swapColleagues: vi.fn(),
  askSwap: vi.fn(),
  answerSwap: vi.fn(async () => ({})),
  withdrawSwap: vi.fn(async () => ({})),
  getForms: vi.fn(),
  askFormRequest: vi.fn(async () => ({ request: { id: 'q1', status: 'WAITING' } })),
  replyFormRequest: vi.fn(async () => ({})),
  withdrawFormRequest: vi.fn(async () => ({})),
  getFormFile: vi.fn(),
}));

import * as api from '../apps/attendance/src/portal/portalApi';
import ShiftSwaps from '../apps/attendance/src/portal/ShiftSwaps';
import MyForms from '../apps/attendance/src/portal/MyForms';

/**
 * The employee app's shift swaps and requests HR set up (FEATURE-UI-AUDIT
 * gaps 24, 25): a swap asked of me is accepted or declined; asking finds the
 * colleagues for the days and sends the one chosen; my own can be withdrawn.
 * A request type is filled in and sent once; HR's question is answered.
 */
const guard = (p) => p;
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
const shift = (name, startTime, endTime) => ({ id: name, name, startTime, endTime });
const swap = (over) => ({
  id: 's1', status: 'ASKED', fromDate: '2026-11-03', toDate: '2026-11-03', reason: 'Exam', colleagueNote: null, decisionNote: null, createdAt: '2026-10-30T10:00:00Z',
  requester: { id: 'e1', name: 'Asha Rao' }, colleague: { id: 'e2', name: 'Ravi Kumar' },
  days: [{ date: '2026-11-03', requesterShift: shift('Morning', '06:00', '14:00'), colleagueShift: shift('Evening', '14:00', '22:00') }],
  ...over,
});
const RULES = { maxDays: 7, minRestHours: 8 };

describe('shift swaps in the employee app', () => {
  it('a swap asked of me shows the shift I would work, and Accept sends it', async () => {
    api.getSwaps.mockResolvedValue({ mine: [], askedOfMe: [swap()], rules: RULES });
    render(<ShiftSwaps guard={guard} />);
    const card = await screen.findByRole('region', { name: 'Swap asked by Asha Rao' });
    expect(within(card).getByText(/06:00–14:00/)).toBeTruthy();
    expect(within(card).getByText(/“Exam”/)).toBeTruthy();
    fireEvent.click(within(card).getByRole('button', { name: 'Accept' }));
    await waitFor(() => expect(api.answerSwap).toHaveBeenCalledWith('s1', true, null));
  });

  it('declining sends the reason', async () => {
    api.getSwaps.mockResolvedValue({ mine: [], askedOfMe: [swap()], rules: RULES });
    render(<ShiftSwaps guard={guard} />);
    const card = await screen.findByRole('region', { name: 'Swap asked by Asha Rao' });
    fireEvent.click(within(card).getByRole('button', { name: 'Decline' }));
    fireEvent.change(within(card).getByLabelText('Why not'), { target: { value: 'Travelling' } });
    fireEvent.click(within(card).getByRole('button', { name: 'Decline' }));
    await waitFor(() => expect(api.answerSwap).toHaveBeenCalledWith('s1', false, 'Travelling'));
  });

  it('asking finds colleagues for the day and sends the one chosen', async () => {
    api.getSwaps.mockResolvedValue({ mine: [], askedOfMe: [], rules: RULES });
    api.swapColleagues.mockResolvedValue({ colleagues: [{ employeeId: 'e2', name: 'Ravi Kumar', code: 'E2', days: [{ date: '2026-11-03', shift: 'Evening', startTime: '14:00', endTime: '22:00' }] }] });
    api.askSwap.mockResolvedValue({ swap: swap() });
    render(<ShiftSwaps guard={guard} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Ask a colleague' }));
    fireEvent.change(screen.getByLabelText('Day *'), { target: { value: '2026-11-03' } });
    await waitFor(() => expect(api.swapColleagues).toHaveBeenCalledWith('2026-11-03', '2026-11-03'));
    fireEvent.click(await screen.findByRole('radio', { name: /Ravi Kumar/ }));
    fireEvent.change(screen.getByLabelText('Why'), { target: { value: 'Exam' } });
    fireEvent.click(screen.getByRole('button', { name: 'Ask' }));
    await waitFor(() => expect(api.askSwap).toHaveBeenCalledWith({ colleagueEmployeeId: 'e2', fromDate: '2026-11-03', toDate: '2026-11-03', reason: 'Exam' }));
  });

  it('says so when nobody can swap those days', async () => {
    api.getSwaps.mockResolvedValue({ mine: [], askedOfMe: [], rules: RULES });
    api.swapColleagues.mockResolvedValue({ colleagues: [] });
    render(<ShiftSwaps guard={guard} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Ask a colleague' }));
    fireEvent.change(screen.getByLabelText('Day *'), { target: { value: '2026-11-03' } });
    expect(await screen.findByText(/Nobody works another shift/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Ask' }).disabled).toBe(true);
  });

  it('my own waiting swap can be withdrawn; one asked of me cannot', async () => {
    api.getSwaps.mockResolvedValue({ mine: [swap({ status: 'WAITING' })], askedOfMe: [swap({ id: 's2', status: 'APPROVED', requester: { id: 'e3', name: 'Sunil Das' } })], rules: RULES });
    render(<ShiftSwaps guard={guard} />);
    const list = await screen.findByRole('region', { name: 'My swaps' });
    expect(within(list).getByText('Waiting for approval')).toBeTruthy();
    expect(within(list).getByText('With Sunil Das')).toBeTruthy();
    expect(within(list).getAllByRole('button', { name: 'Withdraw' })).toHaveLength(1);
    fireEvent.click(within(list).getByRole('button', { name: 'Withdraw' }));
    await waitFor(() => expect(api.withdrawSwap).toHaveBeenCalledWith('s1'));
  });
});

const FORM = { id: 'f1', name: 'Salary certificate', description: 'For a bank', slaDays: 2, fields: [{ key: 'purpose', label: 'Purpose', type: 'CHOICE', required: true, options: ['Bank loan', 'Visa'] }, { key: 'to', label: 'Addressed to', type: 'TEXT', required: true }] };

describe('requests to HR in the employee app', () => {
  it('is hidden when HR set none up and nothing was asked', async () => {
    api.getForms.mockResolvedValue({ forms: [], requests: [] });
    const { container } = render(<MyForms guard={guard} />);
    await waitFor(() => expect(api.getForms).toHaveBeenCalled());
    expect(container.textContent).toBe('');
  });

  it('fills a request in, says what is missing, and sends it once with a key', async () => {
    api.getForms.mockResolvedValue({ forms: [FORM], requests: [] });
    render(<MyForms guard={guard} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Salary certificate' }));
    fireEvent.change(screen.getByLabelText('Purpose *'), { target: { value: 'Visa' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send to HR' }));
    expect(await screen.findByText('Addressed to is needed.')).toBeTruthy();
    expect(api.askFormRequest).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('Addressed to *'), { target: { value: 'Consulate' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send to HR' }));
    await waitFor(() => expect(api.askFormRequest).toHaveBeenCalledWith('f1', expect.objectContaining({ answers: { purpose: 'Visa', to: 'Consulate' }, files: {}, idempotencyKey: expect.any(String) })));
  });

  it('answers HR when they ask for more, and withdraws', async () => {
    api.getForms.mockResolvedValue({ forms: [FORM], requests: [{ id: 'q1', formName: 'Salary certificate', status: 'MORE_INFO', askedAt: '2026-10-30T10:00:00Z', lines: [{ label: 'Purpose', value: 'Visa' }], files: [], said: 'Which country?', replies: [] }] });
    render(<MyForms guard={guard} />);
    const list = await screen.findByRole('list', { name: 'My requests to HR' });
    expect(within(list).getByText('HR asks for more')).toBeTruthy();
    fireEvent.click(within(list).getByRole('button', { name: /Salary certificate/ }));
    expect(within(list).getByText('Which country?')).toBeTruthy();
    fireEvent.change(within(list).getByLabelText('Your answer'), { target: { value: 'Germany' } });
    fireEvent.click(within(list).getByRole('button', { name: 'Send answer' }));
    await waitFor(() => expect(api.replyFormRequest).toHaveBeenCalledWith('q1', 'Germany'));
    fireEvent.click(within(list).getByRole('button', { name: 'Withdraw' }));
    await waitFor(() => expect(api.withdrawFormRequest).toHaveBeenCalledWith('q1'));
  });
});
