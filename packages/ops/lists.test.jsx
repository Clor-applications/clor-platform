import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ opsOrganisations: vi.fn(), opsUsers: vi.fn(), opsDenials: vi.fn(), opsFeatureSwitches: vi.fn() }));
vi.mock('./api', () => api);

import { Denials, FeatureSwitches, Organisations, Users } from './Lists';

beforeEach(() => Object.values(api).forEach((f) => f.mockReset()));

describe('the lists across every account', () => {
  it('Organizations: account, GSTIN, apps, members and state; the account opens', async () => {
    api.opsOrganisations.mockResolvedValue({
      total: 1,
      page: 0,
      pageSize: 50,
      organisations: [{ id: 'o1', name: 'Mehta Interiors Pvt Ltd', code: '1234567890', account: { id: 'a1', name: 'Mehta Group' }, gstin: '27AAXCM1234F1Z5', otherGstins: 0, members: 11, apps: ['accounting', 'payroll'], status: 'active' }],
    });
    const open = vi.fn();
    render(<Organisations openAccount={open} />);
    const row = (await screen.findByText('Mehta Interiors Pvt Ltd')).closest('tr');
    expect(row).toHaveTextContent('27AAXCM1234F1Z5');
    expect(row).toHaveTextContent('Books, Payroll');
    expect(row).toHaveTextContent('11');
    expect(row).toHaveTextContent('Active');
    fireEvent.click(within(row).getByRole('button', { name: 'Mehta Group' }));
    expect(open).toHaveBeenCalledWith('a1');
  });

  it('Users: role, sign-in with 2FA, last seen and state; filters ask the server', async () => {
    api.opsUsers.mockResolvedValue({
      total: 1,
      page: 0,
      pageSize: 50,
      users: [{ id: 'u1', name: 'Rahul Iyer', email: 'rahul@riyerca.in', accounts: [{ id: 'a1', name: 'A' }, { id: 'a2', name: 'B' }, { id: 'a3', name: 'C' }], companies: 4, role: 'ADMIN', signIn: { method: 'password', twoFactor: true }, lastLoginAt: null, status: 'never' }],
    });
    render(<Users openAccount={() => {}} />);
    const row = (await screen.findByText('Rahul Iyer')).closest('tr');
    expect(row).toHaveTextContent('3 accounts');
    expect(row).toHaveTextContent('Admin');
    expect(row).toHaveTextContent('Password · 2FA');
    expect(row).toHaveTextContent('Never signed in');
    fireEvent.change(screen.getByLabelText('Sign-in'), { target: { value: 'twofactor' } });
    await waitFor(() => expect(api.opsUsers).toHaveBeenLastCalledWith(expect.objectContaining({ signIn: 'twofactor', page: 0 })));
  });

  it('Entitlement denials: today’s counts, the reason code with its app, HTTP and correlation id', async () => {
    api.opsDenials.mockResolvedValue({
      total: 1,
      page: 0,
      pageSize: 50,
      today: { total: 7, byCode: { APP_NOT_SUBSCRIBED: 5 } },
      codes: ['APP_NOT_SUBSCRIBED'],
      denials: [{ id: 'd1', at: '2026-11-14T04:15:02Z', who: { id: 'u', name: 'Priya Shah', email: 'p@x.in' }, account: { id: 'a1', name: 'Mehta Group' }, org: { id: 'o1', name: 'Mehta Interiors' }, code: 'APP_NOT_SUBSCRIBED', status: 402, app: 'projects', feature: null, method: 'GET', route: '/api/orgs/:id/projects', requestId: 'c-7f2b04' }],
    });
    render(<Denials openAccount={() => {}} />);
    const row = (await screen.findByText('Priya Shah')).closest('tr');
    expect(row).toHaveTextContent('APP_NOT_SUBSCRIBED · Projects');
    expect(row).toHaveTextContent('402');
    expect(row).toHaveTextContent('c-7f2b04');
    expect(screen.getByRole('button', { name: /Denials today/ })).toHaveTextContent('7');
    fireEvent.click(screen.getByRole('button', { name: /^APP_NOT_SUBSCRIBED/ }));
    await waitFor(() => expect(api.opsDenials).toHaveBeenLastCalledWith(expect.objectContaining({ code: 'APP_NOT_SUBSCRIBED' })));
  });

  it('Feature switches: who gets it and the accounts CLOR switched it for', async () => {
    api.opsFeatureSwitches.mockResolvedValue({
      total: 1,
      page: 0,
      pageSize: 100,
      accountsChanged: 1,
      switches: [{ key: 'eInvoice', label: 'E-invoicing', app: 'accounting', appName: 'Books', appSwitch: false, locked: false, defaultEnabled: false, addedFor: { count: 0, accounts: [] }, offFor: { count: 1, accounts: [{ id: 'a9', name: 'Patil Constructions' }] }, companies: { on: 12, off: 3 } }],
    });
    const open = vi.fn();
    render(<FeatureSwitches openAccount={open} />);
    const row = (await screen.findByText('E-invoicing')).closest('tr');
    expect(row).toHaveTextContent('Off for 1');
    expect(row).toHaveTextContent('On in 12, off in 3');
    fireEvent.click(within(row).getByRole('button', { name: 'Patil Constructions' }));
    expect(open).toHaveBeenCalledWith('a9');
  });
});
