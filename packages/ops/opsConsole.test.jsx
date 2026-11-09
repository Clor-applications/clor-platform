import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ opsMe: vi.fn(), opsOverview: vi.fn(), opsStartTwoFactor: vi.fn(), opsEnableTwoFactor: vi.fn() }));
vi.mock('./api', () => ({
  opsMe: () => api.opsMe(),
  opsOverview: () => api.opsOverview(),
  opsStartTwoFactor: (p) => api.opsStartTwoFactor(p),
  opsEnableTwoFactor: (code) => api.opsEnableTwoFactor(code),
  opsAccounts: vi.fn(), opsAccount: vi.fn(), opsSuspend: vi.fn(), opsReinstate: vi.fn(), opsExtendTrial: vi.fn(),
  opsGrantPlan: vi.fn(), opsAudit: vi.fn(), opsOperators: vi.fn(), opsAddOperator: vi.fn(), opsChangeOperator: vi.fn(),
  opsDemoRequests: vi.fn(), opsDemoRequest: vi.fn(), opsSetDemoStatus: vi.fn(), opsCreateDemoAccount: vi.fn(),
  opsPricing: vi.fn(), opsPriceBook: vi.fn(), opsSamplePlans: vi.fn(), opsPricePreview: vi.fn(), opsNewPriceBook: vi.fn(), opsSavePriceBook: vi.fn(),
  opsPublishPriceBook: vi.fn(), opsArchivePriceBook: vi.fn(), opsRollBackPriceBook: vi.fn(), opsTax: vi.fn(), opsSaveTax: vi.fn(),
  opsPayments: vi.fn(), opsSaveProvider: vi.fn(), opsProviderMode: vi.fn(), opsActivateProvider: vi.fn(), opsTestProvider: vi.fn(), opsPaymentEvents: vi.fn(), opsRetryPaymentEvent: vi.fn(), opsPaymentAccounts: vi.fn(), opsRecordPayment: vi.fn(),
}));
const session = vi.hoisted(() => ({ value: { user: { id: 'u1' }, restoring: false, signOut: vi.fn() } }));
vi.mock('../shell/session', () => ({ useSession: () => session.value }));
vi.mock('qrcode', () => ({ default: { toDataURL: async () => 'data:image/png;base64,' } }));
vi.mock('../shell/SignIn', () => ({ default: () => <p>Sign in form</p> }));

import OpsConsole from './OpsConsole';

beforeEach(() => {
  api.opsMe.mockReset();
  api.opsOverview.mockReset();
  api.opsStartTwoFactor.mockReset();
  api.opsEnableTwoFactor.mockReset();
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

  it('lets an operator without an authenticator set one up right there, then opens the console', async () => {
    api.opsMe.mockRejectedValueOnce(Object.assign(new Error('Set one up'), { code: 'TWO_FACTOR_SETUP_REQUIRED' }));
    api.opsStartTwoFactor.mockResolvedValue({ secret: 'ABCDEF', uri: 'otpauth://totp/x' });
    api.opsEnableTwoFactor.mockResolvedValue({ enabled: true, recoveryCodes: ['AAAA-BBBB', 'CCCC-DDDD'] });
    render(<OpsConsole />);
    expect(await screen.findByText('Set up your authenticator')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Set up an authenticator app/ })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Your password'), { target: { value: 'my-password' } });
    fireEvent.click(screen.getByRole('button', { name: /Set up an authenticator app/ }));
    fireEvent.change(await screen.findByLabelText('Code from the app'), { target: { value: '123456' } });
    expect(api.opsStartTwoFactor).toHaveBeenCalledWith('my-password');
    fireEvent.click(screen.getByRole('button', { name: 'Turn on' }));
    expect(await screen.findByText('AAAA-BBBB')).toBeInTheDocument();
    expect(api.opsEnableTwoFactor).toHaveBeenCalledWith('123456');
    api.opsMe.mockResolvedValue({ user: { id: 'u1', fullName: 'Asha' }, role: 'SUPER_ADMIN' });
    api.opsOverview.mockResolvedValue({ accounts: 0, companies: 0, users: 0, activeUsers7d: 0, suspended: 0, trialsEndingIn7d: 0, signups: [] });
    fireEvent.click(screen.getByRole('button', { name: /open the console/ }));
    expect(await screen.findByText(/Asha/)).toBeInTheDocument();
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
