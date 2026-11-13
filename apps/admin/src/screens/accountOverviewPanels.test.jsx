import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const http = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock('@platform/http', () => ({ apiFetch: (...a) => http.apiFetch(...a) }));
vi.mock('@platform/context', () => ({ orgId: () => 'org1', requestOpenScreen: vi.fn() }));
vi.mock('@platform/admin/account', () => ({ renameAccount: vi.fn() }));

import AccountOverview from './AccountOverview';

/*
 * The Overview panels (Workspace plan P0, the part PR #132 held and #200 did
 * not ship). `GET /account/overview` already returned entities, dataHealth and
 * runRate; nothing on the screen read them. These tests are about what the
 * reader is told, including the cases where the honest answer is "not yet".
 */
const BASE = {
  account: { id: 'a1', code: 'C1', name: 'Anand Traders', since: '2026-01-01T00:00:00.000Z' },
  plan: { key: 'full', name: 'Full', status: 'active', inGoodStanding: true, limits: {} },
  usage: { companies: 1, archivedCompanies: 0, users: 4 },
  companies: [],
  users: [
    { id: 'u1', name: 'A', email: 'a@x.in', active: true, lastLoginAt: null },
    { id: 'u2', name: 'B', email: 'b@x.in', active: true, lastLoginAt: null },
    { id: 'u3', name: 'C', email: 'c@x.in', active: true, lastLoginAt: null },
    { id: 'u4', name: 'D', email: 'd@x.in', active: true, lastLoginAt: null },
  ],
};

const show = (extra) => {
  http.apiFetch.mockResolvedValue({ ...BASE, ...extra });
  render(<AccountOverview currentCompany={{ name: 'Anand Traders', profile: {} }} />);
};

beforeEach(() => http.apiFetch.mockReset());

describe('Workspace Overview panels', () => {
  it('counts what the account is made of, and says when a company has no GSTIN', async () => {
    show({ entities: { companies: 2, branches: 5, taxProfiles: 3, costCentres: 7, companiesWithoutGstin: 1 } });
    expect(await screen.findByText('What the account is made of')).toBeInTheDocument();
    expect(screen.getByText('GST registrations')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('Cost centres')).toBeInTheDocument();
    expect(screen.getByText('One company has no GSTIN on record.')).toBeInTheDocument();
  });

  it('never shows a run rate that looks like an answer when a line has no price', async () => {
    show({ runRate: { monthly: null, currency: 'INR', interval: 'month', status: 'active', unpriced: ['People'] } });
    expect(await screen.findByText(/not priced yet \(People\)/)).toBeInTheDocument();
  });

  it('shows the monthly run rate when every line is priced', async () => {
    show({ runRate: { monthly: 4500, currency: 'INR', interval: 'month', status: 'active', unpriced: [] } });
    expect(await screen.findByText('Monthly run rate')).toBeInTheDocument();
  });

  it('repeats what the reader-check job decided, rather than judging a second time', async () => {
    show({
      dataHealth: {
        status: 'attention',
        issues: 2,
        sources: [
          { key: 'readers', label: 'Attendance readers', total: 3, issues: 2 },
          { key: 'email', label: 'E-mail delivery', total: 9, issues: 0 },
        ],
        alerts: [{ title: 'Gate reader has stopped reporting', severity: 'high', orgId: 'org1', since: '2026-11-13T00:00:00.000Z' }],
      },
    });
    expect(await screen.findByText('Data health')).toBeInTheDocument();
    expect(screen.getByText('2 to fix')).toBeInTheDocument();
    expect(screen.getByText('2 of 3')).toBeInTheDocument();
    expect(screen.getByText('Gate reader has stopped reporting')).toBeInTheDocument();
  });

  it('says there is nothing to sync, rather than showing a reassuring tick', async () => {
    show({ dataHealth: { status: 'none', issues: 0, sources: [], alerts: [] } });
    expect(await screen.findByText(/Nothing to sync/)).toBeInTheDocument();
    expect(screen.queryByText('All sources working')).not.toBeInTheDocument();
  });

  it('names how many people still sign in with a password alone', async () => {
    show({ security: { withAuthenticator: 1, activeUsers: 4 } });
    expect(await screen.findByText('Security')).toBeInTheDocument();
    expect(screen.getByText('25%')).toBeInTheDocument();
    expect(screen.getByText(/1 of 4 active people/)).toBeInTheDocument();
  });

  it('leaves each panel out when the server sent nothing for it', async () => {
    show({});
    expect(await screen.findByText('Anand Traders')).toBeInTheDocument();
    expect(screen.queryByText('What the account is made of')).not.toBeInTheDocument();
    expect(screen.queryByText('Data health')).not.toBeInTheDocument();
    expect(screen.queryByText('Security')).not.toBeInTheDocument();
  });
});
