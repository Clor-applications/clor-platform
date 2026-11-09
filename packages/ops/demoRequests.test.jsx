import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ list: vi.fn(), one: vi.fn(), set: vi.fn(), create: vi.fn() }));
vi.mock('./api', () => ({
  opsDemoRequests: (p) => api.list(p),
  opsDemoRequest: (id) => api.one(id),
  opsSetDemoStatus: (id, b) => api.set(id, b),
  opsCreateDemoAccount: (id, b) => api.create(id, b),
}));
vi.mock('@ui/components/ui/notify', () => ({ notify: { success: vi.fn(), error: vi.fn() } }));

import { DemoRequestDetail, DemoRequests } from './DemoRequests';

const asha = {
  id: 'd1', name: 'Asha Rao', company: 'Rao Textiles', email: 'asha@rao.in', phone: '+919845012345', city: 'Mysuru',
  companySize: '11-20', users: 3, apps: ['people', 'accounting'], message: 'We pay 18 people by hand.', status: 'NEW', note: null, accountId: null, createdAt: '2026-11-09T05:00:00Z',
};

beforeEach(() => {
  Object.values(api).forEach((f) => f.mockReset());
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
});
