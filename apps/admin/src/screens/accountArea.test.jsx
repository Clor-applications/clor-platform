import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';

const overview = vi.fn();
const entitlement = vi.fn();

vi.mock('@platform/admin/admin', () => ({ getAccountOverview: (...a) => overview(...a), listRoles: async () => ({ roles: [] }) }));
vi.mock('@ui/api/features', () => ({ getEntitlement: (...a) => entitlement(...a) }));
vi.mock('@platform/context', () => ({ orgId: () => 'o1', requestOpenApp: vi.fn() }));
vi.mock('@platform/admin/security', () => ({
  getProviders: vi.fn(async () => ({
    redirectUri: 'https://app.clor.in/api/auth/sso/callback',
    local: { name: 'Email and password' },
    providers: [{ id: 'p1', name: 'Okta', kind: 'OIDC', status: 'DISABLED', enabled: false, emailDomains: 'okta.example.in', domainVerification: { domains: [{ domain: 'okta.example.in', verified: false }], record: 'clor-verify=abc' } }],
  })),
  getScim: vi.fn(async () => ({ baseUrl: '', tokens: [] })),
  createProvider: vi.fn(), updateProvider: vi.fn(), deleteProvider: vi.fn(), verifyProviderDomains: vi.fn(), createScimToken: vi.fn(), revokeScimToken: vi.fn(),
}));

import AccountOverview from './AccountOverview';
import BillingPreview from './BillingPreview';
import SsoSettings from './SsoSettings';

const COMPANY = { id: 1, name: 'Neev Steels' };

const OVERVIEW = {
  account: { id: 'acc-1', name: 'Neev Group', since: '2026-01-01T00:00:00.000Z' },
  plan: { key: 'PRACTICE', name: 'Practice', status: 'ACTIVE', inGoodStanding: true, limits: { maxCompanies: 50, maxUsers: 25 } },
  usage: { companies: 2, users: 3 },
  companies: [
    { orgId: 'o1', name: 'Client A', slug: 'cla', state: 'Karnataka', gstin: '29AAAAA0000A1Z5', people: 2, invoices: 4, billed: 100000, outstanding: 25000 },
    { orgId: 'o2', name: 'Client B', slug: 'clb', state: 'Kerala', gstin: '', people: 1, invoices: 0, billed: 0, outstanding: 0 },
  ],
  users: [
    { id: 'u1', name: 'Suresh', email: 'suresh@example.com', active: true, lastLoginAt: '2026-09-09T00:00:00.000Z' },
    { id: 'u2', name: 'An Intern', email: 'intern@example.com', active: true, lastLoginAt: null },
  ],
};

beforeEach(() => {
  overview.mockReset().mockResolvedValue(OVERVIEW);
  entitlement.mockReset().mockResolvedValue({ plan: OVERVIEW.plan, usage: OVERVIEW.usage });
});

/*
 * Everything in this product is scoped to a company, which is right for doing
 * the work and wrong for running the business that does it. A practice with
 * twenty clients could not answer "how many companies, who has access, how
 * close to the limits" without opening each one.
 */
describe('the account overview', () => {
  it('adds up every company on the account', async () => {
    render(<AccountOverview currentCompany={COMPANY} />);
    await waitFor(() => expect(screen.getByText('Neev Group')).toBeInTheDocument());
    // Named twice on purpose: once in the table, once under its address.
    expect(screen.getAllByText('Client A').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Client B').length).toBeGreaterThan(0);
    // Billed and outstanding are summed across companies, not per company only.
    expect(screen.getAllByText(/1,00,000/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/25,000/).length).toBeGreaterThan(0);
  });

  /*
   * "8 of 10" is a number people read and do not feel. Running out of seats
   * has to be visible before somebody is refused.
   */
  it('says how much of the plan is used', async () => {
    render(<AccountOverview currentCompany={COMPANY} />);
    await waitFor(() => expect(screen.getByText('Practice')).toBeInTheDocument());
    expect(screen.getByText('2 of 50')).toBeInTheDocument();
    expect(screen.getByText('2 of 25')).toBeInTheDocument();
  });

  it('warns when a limit is nearly full', async () => {
    overview.mockResolvedValue({
      ...OVERVIEW,
      plan: { ...OVERVIEW.plan, limits: { maxCompanies: 2, maxUsers: 25 } },
    });
    render(<AccountOverview currentCompany={COMPANY} />);
    await waitFor(() => expect(screen.getByText('2 of 2 — at the limit')).toBeInTheDocument());
  });

  it('says plainly when a plan has no limit', async () => {
    overview.mockResolvedValue({ ...OVERVIEW, plan: { ...OVERVIEW.plan, limits: { maxCompanies: null, maxUsers: null } } });
    render(<AccountOverview currentCompany={COMPANY} />);
    await waitFor(() => expect(screen.getAllByText(/no limit on this plan/).length).toBe(2));
  });

  /*
   * The handles are real and unique; the routing that makes them resolve is a
   * deployment step. Saying so is cheaper than somebody sending one to a client.
   */
  it('shows each company address and says it does not resolve yet', async () => {
    render(<AccountOverview currentCompany={COMPANY} />);
    await waitFor(() => expect(screen.getByText('cla.clor.in')).toBeInTheDocument());
    expect(screen.getByText(/Preview — company subdomains is not connected yet/)).toBeInTheDocument();
  });

  it('says so when the account cannot be read', async () => {
    overview.mockRejectedValue(new Error('no'));
    render(<AccountOverview currentCompany={COMPANY} />);
    await waitFor(() => expect(screen.getByText(/could not be read/)).toBeInTheDocument());
  });
});

describe('billing', () => {
  /*
   * A screen that looks live and is not gets demonstrated to a customer, who
   * then believes the product does this today.
   */
  it('says it is not connected, and shows no invented money', async () => {
    render(<BillingPreview currentCompany={COMPANY} />);
    await waitFor(() => expect(screen.getByText(/Preview — card payment is not connected yet/)).toBeInTheDocument());
    expect(screen.queryByText(/sample/i)).toBeNull();
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.getByText(/No invoices/)).toBeInTheDocument();
  });

  /* The plan is real even though the money is not. */
  it('reads the real plan from the server', async () => {
    render(<BillingPreview currentCompany={COMPANY} />);
    await waitFor(() => expect(screen.getByText('Practice')).toBeInTheDocument());
    expect(screen.getByText(/Nothing is charged/)).toBeInTheDocument();
  });

  it('offers nothing that would take money', async () => {
    render(<BillingPreview currentCompany={COMPANY} />);
    await waitFor(() => expect(screen.getByText('Practice')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /card|pay|receipt/i })).toBeNull();
  });
});

describe('single sign-on', () => {
  /*
   * Single sign-on is real now (providers and SCIM come from the server), so
   * what matters is that the screen shows what the server holds and never
   * claims a provider is live before its domains are verified.
   */
  it('shows the server’s sign-in methods, with each provider’s real state', async () => {
    render(<SsoSettings />);
    expect(await screen.findByText('Email and password')).toBeInTheDocument();
    expect(screen.getByText('Okta')).toBeInTheDocument();
    expect(screen.getByText(/okta\.example\.in — not verified/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Verify domains' })).toBeInTheDocument();
  });

  it('adds a provider switched off, to be verified first', async () => {
    render(<SsoSettings />);
    fireEvent.click(await screen.findByRole('button', { name: 'Add a provider' }));
    expect(screen.getByText(/Added switched off until its domains are verified/)).toBeInTheDocument();
  });
});
