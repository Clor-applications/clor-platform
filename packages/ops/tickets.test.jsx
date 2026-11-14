import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ opsTickets: vi.fn(), opsTicket: vi.fn(), opsTicketReply: vi.fn(), opsTicketChange: vi.fn(), opsSavedReplies: vi.fn() }));
vi.mock('./api', () => ({
  opsTickets: (...a) => api.opsTickets(...a),
  opsTicket: (...a) => api.opsTicket(...a),
  opsTicketReply: (...a) => api.opsTicketReply(...a),
  opsSavedReplies: (...a) => api.opsSavedReplies(...a),
  opsTicketChange: (...a) => api.opsTicketChange(...a),
}));

import { TicketPage, Tickets } from './Tickets';

const me = { role: 'SUPPORT', user: { id: 'op1' } };
const T = (o = {}) => ({
  id: 't1', code: 'T-1001', subject: 'Payslips show the wrong month', category: 'PROBLEM', app: 'payroll', priority: 'URGENT', status: 'OPEN', requestId: 'req_7Hk2mQ9xLp3vT8wZ',
  account: { id: 'a1', name: 'Rao Textiles' }, openedBy: { id: 'u1', name: 'Meera Pillai', email: 'meera@rao.in', phone: null }, assignedTo: null,
  createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  messages: [{ id: 'm1', fromStaff: false, internal: false, author: 'Meera Pillai', body: 'Wrong month on every payslip.', at: new Date().toISOString() }],
  ...o,
});

beforeEach(() => {
  Object.values(api).forEach((f) => f.mockReset());
  api.opsSavedReplies.mockResolvedValue({ replies: [] });
});

describe('operator console: tickets', () => {
  it('lists active tickets with customer, status and priority, and opens one', async () => {
    api.opsTickets.mockResolvedValue({ tickets: [T()], counts: { open: 1, waiting: 0, mine: 0 } });
    const open = vi.fn();
    render(<Tickets me={me} openTicket={open} />);
    const row = (await screen.findByText('Rao Textiles')).closest('tr');
    expect(within(row).getByText('Needs an answer')).toBeInTheDocument();
    expect(within(row).getByText('Urgent')).toBeInTheDocument();
    expect(within(row).getByText('Nobody yet')).toBeInTheDocument();
    expect(screen.getByText('1 need an answer · 0 waiting on customers')).toBeInTheDocument();
    fireEvent.click(within(row).getByRole('button', { name: 'T-1001' }));
    expect(open).toHaveBeenCalledWith('t1');
    fireEvent.click(screen.getByRole('tab', { name: /Mine/ }));
    await waitFor(() => expect(api.opsTickets).toHaveBeenLastCalledWith({ status: 'active', mine: '1', q: undefined }));
  });

  it('replies, adds an internal note, takes the ticket and looks up the error code', async () => {
    api.opsTicket.mockResolvedValue(T());
    api.opsTicketReply.mockResolvedValue({ ticket: T({ status: 'WAITING' }), told: true });
    api.opsTicketChange.mockResolvedValue(T({ assignedTo: { id: 'op1', name: 'Kiran' } }));
    const lookUp = vi.fn();
    render(<TicketPage id="t1" me={me} back={() => {}} openCustomer={() => {}} lookUp={lookUp} />);
    fireEvent.change(await screen.findByLabelText('Reply to Meera Pillai'), { target: { value: 'Fixed.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send and mark solved' }));
    await waitFor(() => expect(api.opsTicketReply).toHaveBeenCalledWith('t1', { body: 'Fixed.', internal: false, solve: true }));
    expect(await screen.findByText('Sent. The customer has it by email.')).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText(/Internal note: the customer/));
    fireEvent.change(screen.getByLabelText('Internal note (CLOR only)'), { target: { value: 'Template bug.' } });
    expect(screen.queryByRole('button', { name: 'Send and mark solved' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Add note' }));
    await waitFor(() => expect(api.opsTicketReply).toHaveBeenLastCalledWith('t1', { body: 'Template bug.', internal: true, solve: false }));

    fireEvent.click(screen.getByRole('button', { name: 'Take it' }));
    await waitFor(() => expect(api.opsTicketChange).toHaveBeenCalledWith('t1', { assignedOperatorId: 'op1' }));
    fireEvent.click(screen.getByRole('button', { name: 'Look up this error code' }));
    expect(lookUp).toHaveBeenCalledWith('req_7Hk2mQ9xLp3vT8wZ');
  });

  it('read-only staff read but cannot answer', async () => {
    api.opsTicket.mockResolvedValue(T());
    render(<TicketPage id="t1" me={{ role: 'READ_ONLY', user: { id: 'x' } }} back={() => {}} openCustomer={() => {}} lookUp={() => {}} />);
    expect(await screen.findByText('Only Support staff answer tickets.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Take it' })).toBeNull();
  });
});
