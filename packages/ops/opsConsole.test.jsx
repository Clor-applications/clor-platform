import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ opsMe: vi.fn(), opsOverview: vi.fn() }));
vi.mock('./api', () => ({
  opsMe: () => api.opsMe(),
  opsOverview: () => api.opsOverview(),
  opsAccounts: vi.fn(), opsAccount: vi.fn(), opsSuspend: vi.fn(), opsReinstate: vi.fn(), opsExtendTrial: vi.fn(),
  opsGrantPlan: vi.fn(), opsAudit: vi.fn(), opsOperators: vi.fn(), opsAddOperator: vi.fn(), opsChangeOperator: vi.fn(),
}));
const session = vi.hoisted(() => ({ value: { user: { id: 'u1' }, restoring: false, signOut: vi.fn() } }));
vi.mock('../shell/session', () => ({ useSession: () => session.value }));
vi.mock('../shell/SignIn', () => ({ default: () => <p>Sign in form</p> }));

import OpsConsole from './OpsConsole';

beforeEach(() => {
  api.opsMe.mockReset();
  api.opsOverview.mockReset();
  session.value = { user: { id: 'u1' }, restoring: false, signOut: vi.fn() };
});

describe('the operator console', () => {
  it('asks a signed-out visitor to sign in', () => {
    session.value = { user: null, restoring: false };
    render(<OpsConsole />);
    expect(screen.getByText('Sign in form')).toBeInTheDocument();
  });

  it('turns away a customer with a plain page', async () => {
    api.opsMe.mockRejectedValue(Object.assign(new Error('This is for Clor staff only.'), { code: 'OPERATOR_ONLY' }));
    render(<OpsConsole />);
    expect(await screen.findByText('This page is for Clor staff')).toBeInTheDocument();
  });

  it('asks an operator without an authenticator to set one up', async () => {
    api.opsMe.mockRejectedValue(Object.assign(new Error('Set one up'), { code: 'TWO_FACTOR_SETUP_REQUIRED' }));
    render(<OpsConsole />);
    expect(await screen.findByText('Set up an authenticator first')).toBeInTheDocument();
  });

  it('shows a support operator the console without the Operators page', async () => {
    api.opsMe.mockResolvedValue({ user: { id: 'u1', fullName: 'Asha' }, role: 'SUPPORT' });
    api.opsOverview.mockResolvedValue({ accounts: 3, companies: 4, users: 9, activeUsers7d: 5, suspended: 0, trialsEndingIn7d: 1, signups: [{ day: '2026-10-25', count: 2 }] });
    render(<OpsConsole />);
    expect(await screen.findByText('Asha · Support')).toBeInTheDocument();
    expect(await screen.findByText('Trials ending')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Operators/ })).toBeNull();
  });
});
