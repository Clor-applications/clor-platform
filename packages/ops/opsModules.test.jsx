import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() =>
  Object.fromEntries(
    ['opsNotes', 'opsAddNote', 'opsChangeNote', 'opsRemoveNote', 'opsAddTag', 'opsRemoveTag', 'opsTags', 'opsStatusPosts', 'opsPostStatus', 'opsUpdateStatus', 'opsRemoveStatus', 'opsAssignStatus', 'opsAccounts', 'opsSavedReplies', 'opsSaveSavedReply', 'opsRemoveSavedReply', 'opsInsights', 'opsSwitches', 'opsSetSwitch'].map((k) => [k, vi.fn()]),
  ),
);
vi.mock('./api', () => api);
vi.mock('@ui/components/ui/notify', () => ({ notify: { success: vi.fn(), error: vi.fn() } }));

import { CustomerNotes } from './CustomerNotes';
import { StatusPage } from './StatusPage';
import { SavedReplyPicker } from './SavedReplies';
import { Insights } from './Insights';
import { Switches } from './Switches';

beforeEach(() => Object.values(api).forEach((f) => f.mockReset()));

describe('operator console: notes and tags', () => {
  it('shows pinned notes first, adds a note and a tag, and lets only the writer change one', async () => {
    api.opsTags.mockResolvedValue({ tags: [{ tag: 'pilot', customers: 3 }] });
    api.opsNotes.mockResolvedValue({
      tags: ['CA firm'],
      notes: [
        { id: 'n1', body: 'Wrong e-invoice password.', pinned: true, author: 'Ravi', mine: false, mayChange: false, createdAt: '2026-11-12T05:00:00Z', updatedAt: '2026-11-12T05:00:00Z' },
        { id: 'n2', body: 'Asked about payroll.', pinned: false, author: 'Asha', mine: true, mayChange: true, createdAt: '2026-11-13T05:00:00Z', updatedAt: '2026-11-13T05:00:00Z' },
      ],
    });
    api.opsAddNote.mockResolvedValue({});
    api.opsAddTag.mockResolvedValue({});
    render(<CustomerNotes id="a1" role="SUPPORT" />);
    expect(await screen.findByText('Wrong e-invoice password.')).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Tags on this customer' })).toHaveTextContent('CA firm');
    expect(screen.getAllByRole('button', { name: 'Remove' })).toHaveLength(1);

    fireEvent.change(screen.getByPlaceholderText(/Called the owner/), { target: { value: 'Will call back Monday.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save note' }));
    await waitFor(() => expect(api.opsAddNote).toHaveBeenCalledWith('a1', { body: 'Will call back Monday.', pinned: false }));

    fireEvent.change(screen.getByPlaceholderText('e.g. pilot'), { target: { value: 'pilot' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add tag' }));
    await waitFor(() => expect(api.opsAddTag).toHaveBeenCalledWith('a1', 'pilot'));
  });

  it('is read-only for a read-only operator', async () => {
    api.opsTags.mockResolvedValue({ tags: [] });
    api.opsNotes.mockResolvedValue({ tags: [], notes: [] });
    render(<CustomerNotes id="a1" role="READ_ONLY" />);
    expect(await screen.findByText(/No notes yet/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save note' })).toBeNull();
  });
});

describe('operator console: status page', () => {
  it('lists open posts with their updates and posts a new incident', async () => {
    const post = { id: 'i1', title: 'E-invoices failing', kind: 'INCIDENT', parts: ['accounting'], impact: 'MAJOR', state: 'INVESTIGATING', startsAt: '2026-11-14T05:00:00Z', endsAt: null, resolvedAt: null, updates: [{ id: 'u1', state: 'INVESTIGATING', body: 'Portal not answering.', createdAt: '2026-11-14T05:00:00Z' }] };
    api.opsStatusPosts.mockResolvedValue({ open: [post], resolved: [] });
    api.opsPostStatus.mockResolvedValue({});
    render(<StatusPage me={{ role: 'SUPPORT' }} />);
    const item = (await screen.findByText('E-invoices failing')).closest('li');
    expect(item).toHaveTextContent('Major');
    expect(item).toHaveTextContent('Books');
    expect(item).toHaveTextContent('Portal not answering.');

    fireEvent.click(screen.getByRole('button', { name: 'New post' }));
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Payroll is slow' } });
    fireEvent.change(screen.getByLabelText('First update'), { target: { value: 'Payslips take a minute to open.' } });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Payroll' }));
    fireEvent.click(screen.getByRole('button', { name: 'Post notice' }));
    await waitFor(() => expect(api.opsPostStatus).toHaveBeenCalledWith(expect.objectContaining({ kind: 'INCIDENT', title: 'Payroll is slow', parts: ['payroll'], impact: 'MINOR' })));
  });
});

describe('operator console: who handles a post and which customers it hits', () => {
  const post = { id: 'i1', title: 'Payslips not opening', kind: 'INCIDENT', parts: ['payroll'], impact: 'MINOR', state: 'INVESTIGATING', startsAt: '2026-11-14T05:00:00Z', endsAt: null, resolvedAt: null, updates: [], owner: { userId: 's1', name: 'Asha Rao' }, accounts: [{ id: 'a1', name: 'Kaveri Traders', code: '4831920657' }] };
  const staffList = [{ userId: 's1', name: 'Asha Rao' }, { userId: 's2', name: 'Vikram Shah' }];

  it('names the handler, opens a hit customer, and flags a post nobody handles', async () => {
    api.opsStatusPosts.mockResolvedValue({ open: [post, { ...post, id: 'i2', title: 'Sign-in slow', owner: null, accounts: [] }], resolved: [], staff: staffList });
    const openCustomer = vi.fn();
    render(<StatusPage me={{ role: 'SUPPORT' }} openCustomer={openCustomer} />);
    const item = (await screen.findByText('Payslips not opening')).closest('li');
    expect(item).toHaveTextContent('Handled by Asha Rao');
    expect(item).not.toHaveTextContent('Nobody is handling this');
    fireEvent.click(within(item).getByRole('button', { name: 'Kaveri Traders' }));
    expect(openCustomer).toHaveBeenCalledWith('a1');
    expect(screen.getByText('Sign-in slow').closest('li')).toHaveTextContent('Nobody is handling this');
  });

  it('hands the post over and adds a customer found by name', async () => {
    api.opsStatusPosts.mockResolvedValue({ open: [post], resolved: [], staff: staffList });
    api.opsAccounts.mockResolvedValue({ accounts: [{ id: 'a1', title: 'Kaveri Traders', code: '4831920657' }, { id: 'a2', title: 'Nila Foods', code: '5920013344' }] });
    api.opsAssignStatus.mockResolvedValue({});
    render(<StatusPage me={{ role: 'SUPPORT' }} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Handler and customers' }));
    fireEvent.change(screen.getByLabelText('Handled by'), { target: { value: 's2' } });
    fireEvent.change(screen.getByLabelText('Customers it hits'), { target: { value: 'nila' } });
    const found = await screen.findByRole('list', { name: 'Customers found' });
    /* The one already on the post is not offered again. */
    expect(found).not.toHaveTextContent('Kaveri Traders');
    fireEvent.click(within(found).getByRole('button', { name: /Nila Foods/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.opsAssignStatus).toHaveBeenCalledWith('i1', { ownerUserId: 's2', accountIds: ['a1', 'a2'] }));
  });

  it('a read-only colleague sees the handler and has no button to change it', async () => {
    api.opsStatusPosts.mockResolvedValue({ open: [post], resolved: [], staff: staffList });
    render(<StatusPage me={{ role: 'READ_ONLY' }} />);
    expect((await screen.findByText('Payslips not opening')).closest('li')).toHaveTextContent('Handled by Asha Rao');
    expect(screen.queryByRole('button', { name: 'Handler and customers' })).toBeNull();
  });
});

describe('operator console: saved replies in a ticket', () => {
  it('fills the reply box with the chosen reply, already addressed', async () => {
    api.opsSavedReplies.mockResolvedValue({ replies: [{ id: 'r1', title: 'Forgot password', body: 'Hi {name}', filled: 'Hi Asha' }] });
    const onPick = vi.fn();
    render(<SavedReplyPicker ticketId="t1" onPick={onPick} />);
    fireEvent.change(await screen.findByRole('combobox'), { target: { value: 'r1' } });
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ id: 'r1', filled: 'Hi Asha' }));
    expect(api.opsSavedReplies).toHaveBeenCalledWith('t1');
  });
});

describe('operator console: insights', () => {
  it('shows recurring revenue in rupees and the months newest first', async () => {
    api.opsInsights.mockResolvedValue({
      mrr: 1_250_000,
      arr: 15_000_000,
      paying: 5,
      averagePerCustomer: 250_000,
      trialsEndingSoon: 2,
      byState: { trialing: 7, active: 5, past_due: 1, cancelled: 2 },
      byApp: [{ app: 'people', customers: 9, mrr: 800_000 }],
      byPlan: [{ plan: 'Growth', customers: 5, mrr: 1_250_000 }],
      months: [
        { month: '2026-10', signups: 4, collected: 500_000, cancellations: 0 },
        { month: '2026-11', signups: 6, collected: 900_000, cancellations: 1 },
      ],
      asOf: '2026-11-14T05:00:00Z',
    });
    render(<Insights />);
    expect((await screen.findAllByText('₹12,500')).length).toBeGreaterThan(0);
    const months = within(screen.getByRole('table', { name: /last twelve months/ })).getAllByRole('row');
    expect(months[1]).toHaveTextContent('Nov 2026');
    expect(months[1]).toHaveTextContent('₹9,000');
  });
});

describe('operator console: forms on clor.in', () => {
  it('the owner pauses trials with a message; others only read', async () => {
    const open = { name: 'signups', label: 'Free trials from clor.in', help: 'Visitors can start a trial.', open: true, message: 'New trials are paused.', updatedAt: null };
    api.opsSwitches.mockResolvedValue({ switches: [open] });
    api.opsSetSwitch.mockResolvedValue({ switches: [{ ...open, open: false, message: 'Back Monday.' }] });
    const { unmount } = render(<Switches me={{ role: 'SUPER_ADMIN' }} />);
    fireEvent.change(await screen.findByLabelText(/Message while paused/), { target: { value: 'Back Monday.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    await waitFor(() => expect(api.opsSetSwitch).toHaveBeenCalledWith('signups', { open: false, message: 'Back Monday.' }));
    expect(await screen.findByText(/Visitors read: “Back Monday.”/)).toBeInTheDocument();
    unmount();

    render(<Switches me={{ role: 'SUPPORT' }} />);
    expect(await screen.findByText('Free trials from clor.in')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Pause' })).toBeNull();
  });
});
