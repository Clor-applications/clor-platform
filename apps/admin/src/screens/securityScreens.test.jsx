import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  getPolicy: vi.fn(), savePolicy: vi.fn(), getProviders: vi.fn(), getMySessions: vi.fn(), getAuthEvents: vi.fn(), revokeMySessions: vi.fn(), changePassword: vi.fn(),
  listAudit: vi.fn(), listAuditFacets: vi.fn(), exportRows: vi.fn(),
}));
vi.mock('@platform/admin/security', () => ({
  getPolicy: () => api.getPolicy(), savePolicy: (p) => api.savePolicy(p), getProviders: () => api.getProviders(), getMySessions: () => api.getMySessions(),
  getAuthEvents: () => api.getAuthEvents(), revokeMySessions: () => api.revokeMySessions(), changePassword: (...a) => api.changePassword(...a),
}));
vi.mock('@ui/profile/AuthenticatorCard', () => ({ default: () => <section aria-label="Authenticator app" /> }));
vi.mock('@platform/admin/audit', () => ({ listAudit: (f) => api.listAudit(f), listAuditFacets: () => api.listAuditFacets() }));
vi.mock('@platform/context', () => ({ hasApp: () => true }));
vi.mock('@ui/components/ListToolbar', () => ({ exportRows: (a) => api.exportRows(a) }));

import SecuritySettings from './SecuritySettings';
import AuditTrail, { messageWords } from './AuditTrail';

const POLICY = { maxFailedLogins: 5, lockoutMinutes: 15, sessionDays: 30, accessTokenMinutes: 15, passwordMinLength: 10, requireAdminTwoFactor: false, makerChecker: 'AUTO' };

beforeEach(() => {
  Object.values(api).forEach((f) => f.mockReset());
  api.getPolicy.mockResolvedValue({ policy: POLICY });
  api.savePolicy.mockImplementation(async (p) => ({ policy: p }));
  api.getProviders.mockResolvedValue({ local: { name: 'Email and password' }, providers: [{ id: 'p1', name: 'Okta', kind: 'OIDC', enabled: false, emailDomains: 'neev.in' }] });
  api.getMySessions.mockResolvedValue({ sessions: [{ id: 's1', userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14.5; rv:128.0) Gecko/20100101 Firefox/128.0', ip: '10.0.0.1', createdAt: new Date().toISOString(), lastSeenAt: new Date().toISOString() }] });
  api.getAuthEvents.mockResolvedValue({ events: [{ id: 'e1', eventType: 'LOGIN_FAILED', createdAt: new Date().toISOString(), userEmail: 'a@neev.in', ip: '10.0.0.2' }] });
  api.listAuditFacets.mockResolvedValue({ entities: ['INVOICE'], actions: ['UPDATE'] });
  api.listAudit.mockResolvedValue({ entries: [{ id: 'a1', at: new Date().toISOString(), action: 'UPDATE', entity: 'INVOICE', message: 'Invoice INV-7 edited', metadata: { changes: { total: { from: 12000, to: 1200 } } }, by: { name: 'Asha', email: 'asha@neev.in' } }], nextCursor: 'c2' });
});

/* Redesign W-R7: the security pages, rebuilt on the Workspace kit, keep what they did. */
describe('sign-in and sessions', () => {
  it('saves the rules only once something changed, and shows methods, sessions and the log', async () => {
    render(<SecuritySettings openScreen={() => {}} />);
    const save = await screen.findByRole('button', { name: /Save rules/ });
    expect(save).toBeDisabled();
    expect(await screen.findByText('Okta')).toBeInTheDocument();
    expect(await screen.findByText('Firefox on Mac')).toBeInTheDocument();
    expect(await screen.findByText('Login failed')).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText(/Owners and admins must sign in/));
    expect(save).not.toBeDisabled();
    fireEvent.click(save);
    await waitFor(() => expect(api.savePolicy).toHaveBeenCalledWith(expect.objectContaining({ requireAdminTwoFactor: true })));
    await waitFor(() => expect(save).toBeDisabled());
  });

  it('refuses a password change whose two new passwords differ', async () => {
    render(<SecuritySettings />);
    await screen.findByRole('button', { name: /Save rules/ });
    fireEvent.change(screen.getByLabelText('Current password'), { target: { value: 'old-pass-1' } });
    fireEvent.change(screen.getByLabelText('New password'), { target: { value: 'new-pass-1' } });
    fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: 'new-pass-2' } });
    fireEvent.click(screen.getByRole('button', { name: /Change password/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('The new passwords do not match');
    expect(api.changePassword).not.toHaveBeenCalled();
  });
});

describe('audit trail', () => {
  it('lists entries with their diff, pages on, and exports what is shown', async () => {
    render(<AuditTrail />);
    const row = (await screen.findByText('Invoice INV-7 edited')).closest('li');
    expect(within(row).getByText('12000')).toBeInTheDocument();
    expect(within(row).getByText('Update')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Load older entries/ }));
    await waitFor(() => expect(api.listAudit).toHaveBeenLastCalledWith(expect.objectContaining({ cursor: 'c2' })));
    fireEvent.click(screen.getByRole('button', { name: /Export shown/ }));
    expect(api.exportRows.mock.calls[0][0].rows[0]).toMatchObject({ action: 'UPDATE', by: 'Asha' });
  });
});

describe('audit messages in words', () => {
  it('reads a recorded request as the change it made, and passes written messages through', () => {
    expect(messageWords('POST payroll/loans', 'PAYROLL_LOAN', 'CREATE')).toBe('Added loan');
    expect(messageWords('DELETE /people/employees/cmvlfk92n0000g9itcr6ork1k', 'EMPLOYEE', 'DELETE')).toBe('Removed employee');
    expect(messageWords('PATCH people/leave-policies/12', '', 'UPDATE')).toBe('Changed leave policy');
    expect(messageWords('Invoice INV-7 edited', 'INVOICE', 'UPDATE')).toBe('Invoice INV-7 edited');
  });
});
