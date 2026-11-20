import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ opsAccount: vi.fn(), opsInvoices: vi.fn(), opsTickets: vi.fn(), opsTicket: vi.fn(), opsTicketReply: vi.fn(), opsTicketChange: vi.fn(), opsSavedReplies: vi.fn() }));
vi.mock('./api', () => ({
  opsAccount: (...a) => api.opsAccount(...a),
  opsInvoices: (...a) => api.opsInvoices(...a),
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
  /* The customer panel's three calls; a test that cares sets its own. */
  api.opsAccount.mockRejectedValue(new Error('no'));
  api.opsInvoices.mockRejectedValue(new Error('no'));
  api.opsTickets.mockRejectedValue(new Error('no'));
});

const account = {
  account: { id: 'a1', name: 'Rao Textiles', suspendedAt: null, legacyUnrestrictedAt: null },
  members: [{ userId: 'u1', role: 'OWNER' }, { userId: 'u2', role: 'MEMBER' }, { userId: 'u3', role: 'MEMBER' }],
  companies: [{ id: 'o1', name: 'Rao Textiles' }],
  subscription: { status: 'trialing', trialEndsAt: '2099-11-20T00:00:00Z', apps: ['accounting', 'people'], deal: { planName: 'Growth' } },
};

describe('operator console: tickets', () => {
  it('lists active tickets with customer, status and priority, and opens one', async () => {
    api.opsTickets.mockResolvedValue({ tickets: [T()], counts: { open: 1, waiting: 0, mine: 0 } });
    const open = vi.fn();
    render(<Tickets me={me} openTicket={open} />);
    const row = (await screen.findByText('Rao Textiles')).closest('tr');
    expect(within(row).getByText('Needs an answer')).toBeInTheDocument();
    expect(within(row).getByText('Urgent')).toBeInTheDocument();
    expect(within(row).getByText('Nobody yet')).toBeInTheDocument();
    expect(screen.getByText('1 needs an answer')).toBeInTheDocument();
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
    fireEvent.click(screen.getByRole('button', { name: 'Look up this request ID' }));
    expect(lookUp).toHaveBeenCalledWith('req_7Hk2mQ9xLp3vT8wZ');
  });

  it('shows who is asking: plan, apps, unpaid invoices and the account’s other open tickets', async () => {
    api.opsTicket.mockResolvedValue(T());
    api.opsAccount.mockResolvedValue(account);
    api.opsInvoices.mockResolvedValue({ invoices: [{ id: 'i1', status: 'ISSUED', overdue: true, total: 118000 }, { id: 'i2', status: 'ISSUED', overdue: false, total: 236000 }] });
    api.opsTickets.mockResolvedValue({ tickets: [T(), ...[2, 3, 4, 5, 6, 7].map((n) => T({ id: `t${n}`, code: `T-100${n}`, subject: `Other ${n}`, status: n === 2 ? 'WAITING' : 'OPEN' }))], counts: {} });
    const openCustomer = vi.fn();
    const openTicket = vi.fn();
    render(<TicketPage id="t1" me={me} back={() => {}} openCustomer={openCustomer} openTicket={openTicket} lookUp={() => {}} />);
    const panel = (await screen.findByRole('heading', { name: 'Customer' })).closest('section');
    expect(await within(panel).findByText('Growth')).toBeInTheDocument();
    expect(api.opsAccount).toHaveBeenCalledWith('a1');
    expect(api.opsInvoices).toHaveBeenCalledWith({ accountId: 'a1', status: 'ISSUED' });
    expect(api.opsTickets).toHaveBeenCalledWith({ accountId: 'a1', status: 'active' });
    expect(within(panel).getByText('Trial', { selector: '.ws-pill' })).toBeInTheDocument();
    expect(within(panel).getByText('trial ends 20 Nov 2099')).toBeInTheDocument();
    expect(within(panel).getByText('Books, People (with Attendance)')).toBeInTheDocument();
    expect(within(panel).getByText('Users').nextSibling).toHaveTextContent('3');
    expect(within(panel).getByText('Companies').nextSibling).toHaveTextContent('1');
    expect(await within(panel).findByText('₹3,540')).toBeInTheDocument();
    expect(within(panel).getByText('2 invoices, 1 overdue')).toBeInTheDocument();
    const others = await within(panel).findByRole('list', { name: 'Other open tickets' });
    /* Not this ticket, and no more than five. */
    expect(within(others).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['T-1002 Other 2Waiting on customer', 'T-1003 Other 3Needs an answer', 'T-1004 Other 4Needs an answer', 'T-1005 Other 5Needs an answer', 'T-1006 Other 6Needs an answer']);
    fireEvent.click(within(others).getByRole('button', { name: 'T-1003 Other 3' }));
    expect(openTicket).toHaveBeenCalledWith('t3');
    fireEvent.click(within(panel).getByRole('button', { name: 'Open account' }));
    expect(openCustomer).toHaveBeenCalledWith('a1');
    /* Fetched once: a reply does not ask again. */
    api.opsTicketReply.mockResolvedValue({ ticket: T({ status: 'WAITING' }), told: true });
    fireEvent.change(screen.getByLabelText('Reply to Meera Pillai'), { target: { value: 'Fixed.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send reply' }));
    expect(await screen.findByText('Sent. The customer has it by email.')).toBeInTheDocument();
    expect(api.opsAccount).toHaveBeenCalledTimes(1);
  });

  it('still shows the conversation and the reply box when the account cannot be read', async () => {
    api.opsTicket.mockResolvedValue(T());
    render(<TicketPage id="t1" me={me} back={() => {}} openCustomer={() => {}} lookUp={() => {}} />);
    expect(await screen.findByText('Wrong month on every payslip.')).toBeInTheDocument();
    await waitFor(() => expect(api.opsAccount).toHaveBeenCalledWith('a1'));
    expect(screen.getByLabelText('Reply to Meera Pillai')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
    const panel = screen.getByRole('heading', { name: 'Customer' }).closest('section');
    expect(within(panel).getByText('Rao Textiles')).toBeInTheDocument();
    expect(within(panel).queryByText('Apps on')).toBeNull();
    expect(within(panel).queryByText('Unpaid')).toBeNull();
    expect(within(panel).queryByText('Other open tickets')).toBeNull();
  });

  it('read-only staff read but cannot answer', async () => {
    api.opsTicket.mockResolvedValue(T());
    render(<TicketPage id="t1" me={{ role: 'READ_ONLY', user: { id: 'x' } }} back={() => {}} openCustomer={() => {}} lookUp={() => {}} />);
    expect(await screen.findByText('Only Support staff answer tickets.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Take it' })).toBeNull();
  });
});
