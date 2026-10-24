import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';

/*
 * Batch 5, U7: Company admin → Credentials shows each credential's state in
 * words (never colour alone), why a blocked one does not work, only the
 * actions its state allows, and a new key exactly once.
 */

const api = {
  listCredentials: vi.fn(),
  createApiKey: vi.fn(),
  extendCredential: vi.fn(),
  markCredentialReviewed: vi.fn(),
  resumeCredential: vi.fn(),
  revokeCredential: vi.fn(),
  rotateCredential: vi.fn(),
  suspendCredential: vi.fn(),
};
vi.mock('@platform/admin/credentials', () => api);
vi.mock('@platform/context', async (importOriginal) => ({ ...(await importOriginal()), requestOpenApp: vi.fn() }));

const { default: Credentials } = await import('./Credentials');
const { actionsFor } = await import('./credentialsModel');

const row = (over) => ({
  id: 'c1', kind: 'API_KEY', label: 'Tally bridge', tokenPrefix: 'clor_abc1234', status: 'ACTIVE', effective: 'ACTIVE',
  expiresAt: '2027-10-24T00:00:00Z', lastUsedAt: null, createdAt: '2026-10-24T00:00:00Z', createdBy: 'Asha', needsReviewReason: null,
  owner: { name: 'Tally bridge', where: null }, scopes: ['attendance:read'], ...over,
});

beforeEach(() => {
  Object.values(api).forEach((f) => f.mockReset());
});

describe('the list', () => {
  it('says what each credential can do now, and why not', async () => {
    api.listCredentials.mockResolvedValue({
      credentials: [
        row(),
        row({ id: 'c2', kind: 'AGENT', label: 'Office server', tokenPrefix: 'clora_x', effective: 'OWNER_OFF', scopes: undefined }),
        row({ id: 'c3', label: 'Old key', status: 'SUSPENDED', effective: 'SUSPENDED', needsReviewReason: 'The person who made it was removed from this company' }),
      ],
      links: { shareLinks: 4, payLinks: 1 },
      mayCreateApiKey: true,
    });
    render(<Credentials />);
    await waitFor(() => expect(screen.getByText('Tally bridge')).toBeTruthy());
    expect(screen.getByText('Active')).toBeTruthy();
    expect(screen.getByText('Blocked')).toBeTruthy();
    expect(screen.getByText('Switched off where it is set up')).toBeTruthy();
    expect(screen.getByText('Paused')).toBeTruthy();
    expect(screen.getByText('Needs review')).toBeTruthy();
    expect(screen.getByText(/4 invoice links and 1 open payment link/)).toBeTruthy();
  });

  it('cannot make a key while Attendance is off, and says why', async () => {
    api.listCredentials.mockResolvedValue({ credentials: [], links: null, mayCreateApiKey: false, createBlockedReason: 'API keys work only while Attendance is on for this company.' });
    render(<Credentials />);
    await waitFor(() => expect(screen.getByText('API keys work only while Attendance is on for this company.')).toBeTruthy());
    expect(screen.getByRole('button', { name: /New API key/ }).disabled).toBe(true);
  });

  it('shows a new key once', async () => {
    api.listCredentials.mockResolvedValue({ credentials: [], links: null, mayCreateApiKey: true, scopes: ['attendance:read'] });
    api.createApiKey.mockResolvedValue({ token: 'clor_secret_value_123' });
    render(<Credentials />);
    await waitFor(() => expect(screen.getByRole('button', { name: /New API key/ }).disabled).toBe(false));
    fireEvent.click(screen.getByRole('button', { name: /New API key/ }));
    fireEvent.change(screen.getByPlaceholderText(/What uses it/), { target: { value: 'Payroll export' } });
    fireEvent.click(screen.getByRole('button', { name: 'Make the key' }));
    await waitFor(() => expect(screen.getByText('clor_secret_value_123')).toBeTruthy());
    expect(api.createApiKey.mock.calls[0][0]).toMatchObject({ name: 'Payroll export', scopes: ['attendance:read'] });
    fireEvent.click(screen.getByRole('button', { name: 'I have copied it' }));
    expect(screen.queryByText('clor_secret_value_123')).toBeNull();
  });
});

describe('what may be done', () => {
  it('follows the stored state', () => {
    expect(actionsFor(row())).toEqual(['suspend', 'extend', 'rotate', 'revoke']);
    expect(actionsFor(row({ status: 'SUSPENDED', effective: 'SUSPENDED' }))).toEqual(['resume', 'extend', 'rotate', 'revoke']);
    expect(actionsFor(row({ effective: 'EXPIRED' }))).toEqual(['extend', 'rotate', 'revoke']);
    expect(actionsFor(row({ status: 'REVOKED', effective: 'REVOKED' }))).toEqual([]);
    expect(actionsFor(row({ needsReviewReason: 'x' }))[0]).toBe('review');
  });

  it('a revoked row offers nothing', async () => {
    api.listCredentials.mockResolvedValue({ credentials: [row({ status: 'REVOKED', effective: 'REVOKED' })], links: null, mayCreateApiKey: true });
    render(<Credentials />);
    await waitFor(() => expect(screen.getByText('Revoked')).toBeTruthy());
    const r = screen.getByText('Tally bridge').closest('tr');
    expect(within(r).queryAllByRole('button')).toHaveLength(0);
  });
});
