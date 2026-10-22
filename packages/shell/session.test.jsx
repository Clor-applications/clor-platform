import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
const { me } = vi.hoisted(() => ({ me: vi.fn() }));
vi.mock('@platform/auth', () => ({
  APP_FEATURE: {}, appsFromFeatures: () => ['people'], visibleApps: (apps) => apps,
  featuresFor: async () => ({ features: {} }), billingFor: async () => ({}),
  login: vi.fn(), loginTwoFactor: vi.fn(), logout: vi.fn(), me, setFeature: vi.fn(), setupCompany: vi.fn(), signup: vi.fn(),
}));
vi.mock('./appHosts', () => ({ appFromHost: () => null }));
import { SessionProvider, useSession } from './session';
function Probe() {
  const session = useSession();
  return <><output data-testid="company">{session.tenant?.id || ''}</output><button onClick={() => session.setTenantId('second')}>Switch company</button></>;
}
const payload = { user: { id: 'qa-user' }, activeOrgId: 'first', orgs: [{ orgId: 'first', org: { name: 'First' } }, { orgId: 'second', org: { name: 'Second' } }] };
beforeEach(() => { cleanup(); localStorage.clear(); localStorage.setItem('token', 'qa-token'); me.mockResolvedValue(payload); });
describe('company selection across reloads', () => {
  it('restores a switched company after remount instead of jumping to the first', async () => {
    const view = render(<SessionProvider><Probe /></SessionProvider>);
    await waitFor(() => expect(screen.getByTestId('company').textContent).toBe('first'));
    fireEvent.click(screen.getByRole('button', { name: 'Switch company' }));
    expect(screen.getByTestId('company').textContent).toBe('second');
    view.unmount();
    render(<SessionProvider><Probe /></SessionProvider>);
    await waitFor(() => expect(screen.getByTestId('company').textContent).toBe('second'));
  });
  it('ignores a remembered company the user no longer belongs to', async () => {
    localStorage.setItem('clor.tenant.qa-user', 'foreign');
    render(<SessionProvider><Probe /></SessionProvider>);
    await waitFor(() => expect(screen.getByTestId('company').textContent).toBe('first'));
  });
});
