import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ opsMe: vi.fn(), opsStartTwoFactor: vi.fn(), opsEnableTwoFactor: vi.fn() }));
vi.mock('./api', () => ({
  opsMe: () => api.opsMe(),
  opsStartTwoFactor: (p) => api.opsStartTwoFactor(p),
  opsEnableTwoFactor: (code) => api.opsEnableTwoFactor(code),
}));
/* Each screen has its own tests; here they only say which one is open. */
vi.mock('./Home', () => ({ Home: ({ go }) => <div><h1>Home screen</h1><button type="button" onClick={() => go('emailLog', { status: 'FAILED' })}>Failed emails</button></div> }));
vi.mock('./Customers', () => ({ Customers: ({ initialStatus }) => <h1>Customers screen {initialStatus}</h1>, CustomerPage: ({ id, tab }) => <h1>Customer {id} {tab}</h1> }));
vi.mock('./Staff', () => ({ Staff: () => <h1>Staff screen</h1> }));
vi.mock('./Email', () => ({ EmailAddresses: () => <h1>Addresses screen</h1>, EmailTemplates: () => <h1>Templates screen</h1>, EmailLog: ({ initialStatus }) => <h1>Log screen {initialStatus}</h1> }));
vi.mock('./AppCatalogue', () => ({ AppCatalogue: () => <h1>Catalogue screen</h1> }));
vi.mock('./AuditLog', () => ({ AuditLog: () => <h1>Audit screen</h1> }));
vi.mock('./DemoRequests', () => ({ DemoRequests: () => <h1>Demo screen</h1>, DemoRequestDetail: () => <h1>Demo detail</h1> }));
vi.mock('./Explore', () => ({ ExploreLinks: () => <h1>Links screen</h1>, SampleCompany: () => <h1>Sample screen</h1> }));
vi.mock('./Trials', () => ({ Trials: () => <h1>Trials screen</h1> }));
vi.mock('./Pricing', () => ({ Pricing: () => <h1>Pricing screen</h1> }));
vi.mock('./Payments', () => ({ Payments: () => <h1>Payments screen</h1> }));
vi.mock('./Settings', () => ({ Settings: () => <h1>Tax screen</h1> }));
vi.mock('./Invoices', () => ({ Invoices: () => <h1>Invoices screen</h1>, InvoicePage: ({ id }) => <h1>Invoice {id}</h1> }));
vi.mock('./InvoiceSettings', () => ({ InvoiceSettings: () => <h1>Invoice settings screen</h1> }));
vi.mock('./Health', () => ({ Health: ({ request }) => <h1>Health screen {request}</h1> }));
vi.mock('./OpsSearch', () => ({ OpsSearch: ({ go }) => <button type="button" onClick={() => go('health', { request: 'req-12345678' })}>Search stand-in</button> }));
const session = vi.hoisted(() => ({ value: { user: { id: 'u1' }, restoring: false, signOut: vi.fn() } }));
vi.mock('../shell/session', () => ({ useSession: () => session.value }));
vi.mock('qrcode', () => ({ default: { toDataURL: async () => 'data:image/png;base64,' } }));
vi.mock('../shell/SignIn', () => ({ default: () => <p>Sign in form</p> }));

import OpsConsole, { parseRoute, routeHash } from './OpsConsole';

beforeEach(() => {
  api.opsMe.mockReset();
  api.opsStartTwoFactor.mockReset();
  api.opsEnableTwoFactor.mockReset();
  session.value = { user: { id: 'u1' }, restoring: false, signOut: vi.fn() };
  window.history.replaceState(null, '', '/ops');
});

describe('the operator console', () => {
  it('asks a signed-out visitor to sign in', () => {
    session.value = { user: null, restoring: false };
    render(<OpsConsole />);
    expect(screen.getByText('Sign in form')).toBeInTheDocument();
  });

  it('turns away a customer with a plain page', async () => {
    api.opsMe.mockRejectedValue(Object.assign(new Error('This is for CLOR staff only.'), { code: 'OPERATOR_ONLY' }));
    render(<OpsConsole />);
    expect(await screen.findByText('This page is for CLOR staff')).toBeInTheDocument();
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
    fireEvent.click(screen.getByRole('button', { name: /open the console/ }));
    expect(await screen.findByText(/Asha/)).toBeInTheDocument();
  });

  it('shows the menu in groups, names the role, and keeps Staff and roles for the owner', async () => {
    api.opsMe.mockResolvedValue({ user: { id: 'u1', fullName: 'Asha' }, role: 'SUPPORT' });
    render(<OpsConsole />);
    expect(await screen.findByText('Asha · Support')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Home screen' })).toBeInTheDocument();
    const nav = screen.getByRole('navigation', { name: 'Operator console' });
    expect([...nav.querySelectorAll('.ops-group-label')].map((n) => n.textContent)).toEqual(['Customers', 'Money', 'Product', 'Email', 'System']);
    expect([...nav.querySelectorAll('button')].map((b) => b.textContent.trim())).toEqual([
      'Home', 'Customers', 'Trials', 'Demo requests', 'Explore links', 'Pricing', 'Invoices', 'Payments', 'Tax', 'Invoice settings', 'App catalogue', 'Sample company', 'Addresses', 'Templates', 'Log', 'System health', 'Audit log',
    ]);
    expect(screen.queryByRole('button', { name: /Staff and roles/ })).toBeNull();
  });

  it('opens the owner on Staff and roles, follows the address, and goes where Home sends it', async () => {
    api.opsMe.mockResolvedValue({ user: { id: 'u1', fullName: 'Ravi' }, role: 'SUPER_ADMIN' });
    window.history.replaceState(null, '', '/ops#/customers/a1/users');
    render(<OpsConsole />);
    expect(await screen.findByRole('heading', { name: 'Customer a1 users' })).toBeInTheDocument();
    expect(screen.getByText('Ravi · Owner')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Staff and roles/ }));
    expect(screen.getByRole('heading', { name: 'Staff screen' })).toBeInTheDocument();
    expect(window.location.hash).toBe('#/staff');
    fireEvent.click(screen.getByRole('button', { name: /^Home$/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Failed emails' }));
    expect(screen.getByRole('heading', { name: 'Log screen FAILED' })).toBeInTheDocument();
    expect(window.location.hash).toBe('#/emailLog?status=FAILED');
  });

  it('sends anybody but the owner from Staff and roles back Home', async () => {
    api.opsMe.mockResolvedValue({ user: { id: 'u1', fullName: 'Asha' }, role: 'SALES' });
    window.history.replaceState(null, '', '/ops#/staff');
    render(<OpsConsole />);
    expect(await screen.findByRole('heading', { name: 'Home screen' })).toBeInTheDocument();
  });

  it('reads and writes addresses', () => {
    expect(parseRoute('#/customers/a1/users?x=1')).toEqual({ page: 'customers', id: 'a1', tab: 'users', params: { x: '1' } });
    expect(parseRoute('')).toEqual({ page: 'home', id: '', tab: '', params: {} });
    expect(routeHash({ page: 'customers', params: { status: 'overdue', q: '' } })).toBe('#/customers?status=overdue');
  });
});
