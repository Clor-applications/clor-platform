import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ list: vi.fn(), one: vi.fn(), set: vi.fn(), create: vi.fn(), resend: vi.fn(), end: vi.fn(), team: vi.fn() }));
vi.mock('./api', () => ({
  opsDemoRequests: (p) => api.list(p),
  opsDemoRequest: (id) => api.one(id),
  opsSetDemoStatus: (id, b) => api.set(id, b),
  opsCreateDemoAccount: (id, b) => api.create(id, b),
  opsResendExplore: (id) => api.resend(id),
  opsEndExplore: (id) => api.end(id),
  opsDemoTeam: () => api.team(),
}));
vi.mock('@ui/components/ui/notify', () => ({ notify: { success: vi.fn(), error: vi.fn() }, confirmDialog: vi.fn(() => Promise.resolve(true)) }));

import { DemoRequestDetail, DemoRequests } from './DemoRequests';

const asha = {
  id: 'd1', name: 'Asha Rao', company: 'Rao Textiles', email: 'asha@rao.in', phone: '+919845012345', city: 'Mysuru',
  companySize: '11-20', users: 3, apps: ['people', 'accounting'], message: 'We pay 18 people by hand.', status: 'NEW', note: null, accountId: null, createdAt: '2026-11-09T05:00:00Z',
};

beforeEach(() => {
  Object.values(api).forEach((f) => f.mockReset());
  api.team.mockResolvedValue({ team: [{ userId: 'u-ravi', name: 'Ravi Sales', role: 'SALES' }] });
});

describe('Demo requests in the operator console', () => {
  it('lists requests with date, name, company, apps, size and users, and filters by status', async () => {
    api.list.mockResolvedValue({ total: 1, page: 0, pageSize: 25, counts: { NEW: 1 }, requests: [asha] });
    const open = vi.fn();
    render(<DemoRequests openRequest={open} />);
    expect(await screen.findByText('Rao Textiles')).toBeInTheDocument();
    expect(screen.getByText('Books, People')).toBeInTheDocument();
    expect(screen.getByText('11–20')).toBeInTheDocument();
    expect(screen.getByText('1 new')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'CONTACTED' } });
    await waitFor(() => expect(api.list).toHaveBeenLastCalledWith({ status: 'CONTACTED', page: 0 }));
    fireEvent.click(screen.getByRole('button', { name: 'Asha Rao' }));
    expect(open).toHaveBeenCalledWith('d1');
  });

  it('saves a status with a note, and creates the account with the state chosen', async () => {
    api.one.mockResolvedValue({ request: asha, account: null, history: [] });
    api.set.mockResolvedValue({});
    api.create.mockResolvedValue({ created: true, account: { id: 'a1' }, owner: { email: 'asha@rao.in' } });
    render(<DemoRequestDetail id="d1" role="SUPER_ADMIN" back={() => {}} openAccount={() => {}} />);
    expect(await screen.findByText('We pay 18 people by hand.')).toBeInTheDocument();
    fireEvent.change(screen.getByRole('combobox', { name: 'Status' }), { target: { value: 'CONTACTED' } });
    fireEvent.change(screen.getByLabelText('Note'), { target: { value: 'Demo Thursday' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.set).toHaveBeenCalledWith('d1', { status: 'CONTACTED', note: 'Demo Thursday' }));

    fireEvent.click(screen.getAllByRole('button', { name: 'Create account' })[0]);
    fireEvent.change(await screen.findByLabelText('State of the head office'), { target: { value: 'Karnataka' } });
    const buttons = screen.getAllByRole('button', { name: 'Create account' });
    fireEvent.click(buttons[buttons.length - 1]);
    await waitFor(() => expect(api.create).toHaveBeenCalledWith('d1', { state: 'Karnataka', apps: ['accounting', 'people'], trialDays: 30 }));
  });

  it('shows a made account instead of Create account, and support cannot create one', async () => {
    api.one.mockResolvedValue({ request: { ...asha, status: 'ACCOUNT_CREATED', accountId: 'a1' }, account: { id: 'a1', name: 'Rao Textiles', code: '4831920657' }, history: [] });
    const openAccount = vi.fn();
    const { unmount } = render(<DemoRequestDetail id="d1" role="BILLING" back={() => {}} openAccount={openAccount} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Open the account' }));
    expect(openAccount).toHaveBeenCalledWith('a1');
    expect(screen.queryByRole('button', { name: 'Create account' })).toBeNull();
    unmount();
    api.one.mockResolvedValue({ request: asha, account: null, history: [] });
    render(<DemoRequestDetail id="d1" role="SUPPORT" back={() => {}} openAccount={() => {}} />);
    expect(await screen.findByRole('button', { name: 'Save' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Create account' })).toBeNull();
  });

  it('shows the Explore link (sent, last used, times used, until) with Resend and End access', async () => {
    const pass = { id: 'p1', email: 'asha@rao.in', app: 'people', state: 'active', sentAt: '2026-11-09T05:00:00Z', sendCount: 1, lastUsedAt: '2026-11-09T06:00:00Z', useCount: 3, expiresAt: '2026-11-23T05:00:00Z', revokedAt: null };
    api.one.mockResolvedValue({ request: asha, account: null, explore: pass, history: [] });
    api.end.mockResolvedValue({ explore: { ...pass, state: 'ended' }, sessionsEnded: 1 });
    api.resend.mockResolvedValue({ explore: pass });
    render(<DemoRequestDetail id="d1" role="SUPPORT" back={() => {}} openAccount={() => {}} />);
    expect(await screen.findByText('Explore link')).toBeInTheDocument();
    expect(screen.getByText('Open')).toBeInTheDocument();
    expect(screen.getByText('Times used').nextElementSibling.textContent).toBe('3');
    expect(screen.getByText('23 Nov 2026')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'End access' }));
    await waitFor(() => expect(api.end).toHaveBeenCalledWith('d1'));
    fireEvent.click(screen.getByRole('button', { name: 'Resend' }));
    await waitFor(() => expect(api.resend).toHaveBeenCalledWith('d1'));
  });

  it('offers to send a link for a request that has none', async () => {
    api.one.mockResolvedValue({ request: asha, account: null, explore: null, history: [] });
    render(<DemoRequestDetail id="d1" role="BILLING" back={() => {}} openAccount={() => {}} />);
    expect(await screen.findByText('No link was sent with this request.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send a link' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'End access' })).toBeNull();
  });
});

describe('Demo requests as a pipeline', () => {
  it('filters to mine, due and nobody’s, by source, and shows who looks after each and when to call', async () => {
    const due = { ...asha, assignedToUserId: 'u-ravi', assignedToName: 'Ravi Sales', followUpAt: '2020-01-02T18:30:00Z', source: 'google' };
    api.list.mockResolvedValue({ total: 1, page: 0, pageSize: 25, counts: { NEW: 1 }, views: { due: 1, mine: 1, unassigned: 0 }, sources: [{ source: 'google', count: 1 }], requests: [due] });
    render(<DemoRequests openRequest={vi.fn()} />);
    expect(await screen.findByText('Ravi Sales')).toBeInTheDocument();
    expect(screen.getByText('Mysuru · google')).toBeInTheDocument();
    expect(screen.getByText('3 Jan 2020')).toHaveClass('ws-pill--warn');
    fireEvent.change(screen.getByLabelText('Whose'), { target: { value: 'due' } });
    await waitFor(() => expect(api.list).toHaveBeenLastCalledWith({ status: 'all', page: 0, view: 'due' }));
    fireEvent.change(screen.getByLabelText('Source'), { target: { value: 'google' } });
    await waitFor(() => expect(api.list).toHaveBeenLastCalledWith({ status: 'all', page: 0, view: 'due', source: 'google' }));
  });

  it('gives a lead to someone and sets the follow-up day, sent as that day in India', async () => {
    api.one.mockResolvedValue({ request: { ...asha, source: 'linkedin.com', sourceDetail: { utm_campaign: 'nov', landing: '/people' } }, account: null, explore: null, history: [] });
    api.set.mockResolvedValue({});
    render(<DemoRequestDetail id="d1" role="SALES" back={vi.fn()} openAccount={vi.fn()} />);
    expect(await screen.findByText('linkedin.com')).toBeInTheDocument();
    expect(screen.getByText('First page: clor.in/people')).toBeInTheDocument();
    await screen.findByRole('option', { name: 'Ravi Sales' });
    fireEvent.change(screen.getByLabelText('Looked after by'), { target: { value: 'u-ravi' } });
    fireEvent.change(screen.getByLabelText('Follow up on'), { target: { value: '2026-11-20' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.set).toHaveBeenCalledWith('d1', { status: 'NEW', note: null, assignedToUserId: 'u-ravi', followUpAt: '2026-11-20T00:00:00+05:30' }));
  });
});
