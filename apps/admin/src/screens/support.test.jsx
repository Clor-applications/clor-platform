import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ listTickets: vi.fn(), getTicket: vi.fn(), openTicket: vi.fn(), replyTicket: vi.fn(), ticketSolved: vi.fn() }));
vi.mock('@platform/admin/account', () => ({
  listTickets: (...a) => api.listTickets(...a),
  getTicket: (...a) => api.getTicket(...a),
  openTicket: (...a) => api.openTicket(...a),
  replyTicket: (...a) => api.replyTicket(...a),
  ticketSolved: (...a) => api.ticketSolved(...a),
}));
const last = vi.hoisted(() => ({ code: null }));
vi.mock('@platform/http', () => ({ lastErrorRef: () => last.code }));

import Support from './Support';

const T = (o = {}) => ({ id: 't1', code: 'T-1001', subject: 'Payslips show the wrong month', category: 'PROBLEM', app: 'payroll', status: 'WAITING', requestId: null, openedBy: 'Meera Pillai', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), ...o });

beforeEach(() => {
  Object.values(api).forEach((f) => f.mockReset());
  last.code = null;
});

/* Ops plan P1: customers ask CLOR from the Workspace and follow the answer there. */
describe('Help and support', () => {
  it('lists tickets with plain statuses and says when CLOR is waiting for an answer', async () => {
    api.listTickets.mockResolvedValue({ wholeAccount: true, tickets: [T(), T({ id: 't2', code: 'T-1002', status: 'OPEN', subject: 'Export fails' })] });
    render(<Support />);
    const list = within(await screen.findByRole('list', { name: 'Tickets' }));
    expect(list.getByText('Waiting for you')).toBeInTheDocument();
    expect(list.getByText('With CLOR')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('CLOR replied to one ticket');
    expect(list.getAllByText(/Meera Pillai/)).toHaveLength(2);
  });

  it('opens a ticket with the error code from the last failure, then shows it', async () => {
    api.listTickets.mockResolvedValue({ wholeAccount: false, tickets: [] });
    last.code = 'req_7Hk2mQ9xLp3vT8wZ';
    api.openTicket.mockResolvedValue(T({ status: 'OPEN' }));
    api.getTicket.mockResolvedValue({ ...T({ status: 'OPEN' }), messages: [{ id: 'm1', fromStaff: false, author: 'Meera Pillai', body: 'Every payslip says September.', at: new Date().toISOString() }] });
    render(<Support />);
    expect(await screen.findByText(/No tickets yet/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /New ticket/ }));
    fireEvent.change(screen.getByLabelText('Subject'), { target: { value: 'Payslips show the wrong month' } });
    fireEvent.change(screen.getByLabelText('What happened'), { target: { value: 'Every payslip says September.' } });
    fireEvent.change(screen.getByLabelText('Which app'), { target: { value: 'payroll' } });
    fireEvent.click(screen.getByRole('button', { name: 'Use the code from the last error here' }));
    expect(screen.getByLabelText(/Error code/)).toHaveValue('req_7Hk2mQ9xLp3vT8wZ');
    fireEvent.click(screen.getByRole('button', { name: /Send to CLOR/ }));
    await waitFor(() => expect(api.openTicket).toHaveBeenCalled());
    expect(api.openTicket.mock.calls[0][0]).toMatchObject({ subject: 'Payslips show the wrong month', app: 'payroll', requestId: 'req_7Hk2mQ9xLp3vT8wZ', category: 'QUESTION', urgent: false });
    expect(await screen.findByText('Every payslip says September.')).toBeInTheDocument();
  });

  it('shows CLOR’s reply, lets the person answer or say it is solved; a closed ticket cannot be answered', async () => {
    api.listTickets.mockResolvedValue({ tickets: [T()] });
    const msgs = [
      { id: 'm1', fromStaff: false, author: 'Meera Pillai', body: 'Wrong month.', at: new Date().toISOString() },
      { id: 'm2', fromStaff: true, author: 'CLOR support', body: 'Fixed, download again.', at: new Date().toISOString() },
    ];
    api.getTicket.mockResolvedValue({ ...T(), messages: msgs });
    api.ticketSolved.mockResolvedValue({ ...T({ status: 'SOLVED' }), messages: msgs });
    render(<Support />);
    fireEvent.click(await screen.findByRole('button', { name: /T-1001/ }));
    expect(await screen.findByText('Fixed, download again.')).toBeInTheDocument();
    expect(screen.getByText('CLOR support').closest('li')).toHaveClass('ws-msg--staff');
    fireEvent.click(screen.getByRole('button', { name: 'It is solved' }));
    await waitFor(() => expect(api.ticketSolved).toHaveBeenCalledWith('t1'));
    expect(await screen.findByText(/Still not right/)).toBeInTheDocument();
  });

  it('a closed ticket says to open a new one', async () => {
    api.listTickets.mockResolvedValue({ tickets: [T({ status: 'CLOSED' })] });
    api.getTicket.mockResolvedValue({ ...T({ status: 'CLOSED' }), messages: [] });
    render(<Support />);
    fireEvent.click(await screen.findByRole('button', { name: /T-1001/ }));
    expect(await screen.findByText(/open a new ticket and mention T-1001/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Send reply/ })).toBeNull();
  });
});
