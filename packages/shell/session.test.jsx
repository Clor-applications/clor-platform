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
  return <><output data-testid="company">{session.tenant?.id || ''}</output><output data-testid="denied">{session.deniedCode || ''}</output><button onClick={() => session.setTenantId('second')}>Switch company</button></>;
}
const payload = { user: { id: 'qa-user' }, activeOrgId: 'first', orgs: [{ orgId: 'first', org: { name: 'First', code: 'FRST-C100' } }, { orgId: 'second', org: { name: 'Second', code: 'SCND-C100' } }] };
/* Each test is a fresh tab at a bare address: this tab's choice (sessionStorage) and the address both start empty. */
beforeEach(() => { cleanup(); localStorage.clear(); sessionStorage.clear(); window.history.replaceState(null, '', '/'); localStorage.setItem('token', 'qa-token'); me.mockResolvedValue(payload); });
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

describe('the company in the address (A-26)', () => {
  it('opens the company the address names, over the one this browser used last', async () => {
    localStorage.setItem('clor.tenant.qa-user', 'first');
    window.history.replaceState(null, '', '/o/scnd-c100/');
    render(<SessionProvider><Probe /></SessionProvider>);
    await waitFor(() => expect(screen.getByTestId('company').textContent).toBe('second'));
  });

  it('writes the company into a bare address, and switching is a new history entry', async () => {
    render(<SessionProvider><Probe /></SessionProvider>);
    await waitFor(() => expect(window.location.pathname).toBe('/o/FRST-C100/'));
    const before = window.history.length;
    fireEvent.click(screen.getByRole('button', { name: 'Switch company' }));
    await waitFor(() => expect(window.location.pathname).toBe('/o/SCND-C100/'));
    expect(window.history.length).toBe(before + 1);
  });

  it('opens no company for a code that is not one of yours', async () => {
    window.history.replaceState(null, '', '/o/ZZZZ-C999/');
    render(<SessionProvider><Probe /></SessionProvider>);
    await waitFor(() => expect(screen.getByTestId('denied').textContent).toBe('ZZZZ-C999'));
    expect(screen.getByTestId('company').textContent).toBe('');
  });

  it("keeps this tab's company when another tab switched since", async () => {
    sessionStorage.setItem('clor.tab.tenant.qa-user', 'first');
    localStorage.setItem('clor.tenant.qa-user', 'second');
    render(<SessionProvider><Probe /></SessionProvider>);
    await waitFor(() => expect(screen.getByTestId('company').textContent).toBe('first'));
  });
});

describe('a new company starts with the apps picked (B2)', () => {
  it('sends the picked apps with the company and switches nothing else on afterwards', async () => {
    const auth = await import('@platform/auth');
    auth.setupCompany.mockClear();
    auth.setFeature.mockClear();
    auth.setupCompany.mockResolvedValue({ company: { orgId: 'first' }, branch: { id: 'b1' } });
    /* A button that runs createCompany from inside the provider, so the test needs no handle on the session. */
    function Make() {
      const { tenant, createCompany } = useSession();
      return (
        <button type="button" data-testid="make" data-tenant={tenant?.id || ''} onClick={() => createCompany({ name: 'First', state: 'Karnataka', apps: ['attendance'] })}>
          make
        </button>
      );
    }
    render(<SessionProvider><Make /></SessionProvider>);
    await waitFor(() => expect(screen.getByTestId('make').dataset.tenant).toBe('first'));
    screen.getByTestId('make').click();
    await waitFor(() => expect(auth.setupCompany).toHaveBeenCalled());
    expect(auth.setupCompany).toHaveBeenCalledWith(expect.objectContaining({ companyName: 'First', state: 'Karnataka', apps: ['attendance'] }));
    expect(auth.setFeature).not.toHaveBeenCalled();
  });
});
