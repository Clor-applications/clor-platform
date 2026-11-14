import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

/*
 * Workspace → CLOR support access (docs/workspace/SUPPORT_GRANTS.md): a
 * request waits here with its reason, the customer chooses how long and how
 * much, and an open grant can be ended at once.
 */
const api = vi.hoisted(() => ({ listSupportGrants: vi.fn(), approveSupportGrant: vi.fn(), endSupportGrant: vi.fn() }));
vi.mock('@platform/admin/supportGrants', () => api);

const { default: SupportAccess } = await import('./SupportAccess');

const g = (over) => ({
  id: 'g1', state: 'PENDING', scope: 'READ_ONLY', reason: 'Invoices from 12 Nov will not save', ticketRef: 'T-1042', staff: 'Divya',
  requestedAt: '2026-11-14T04:00:00Z', approvedAt: null, expiresAt: null, endedAt: null, endReason: null, ...over,
});
const show = (grants) => {
  api.listSupportGrants.mockResolvedValue({ grants, defaultHours: 24, maxHours: 72 });
  render(<SupportAccess />);
};

beforeEach(() => Object.values(api).forEach((f) => f.mockReset()));

describe('CLOR support access', () => {
  it('shows a request with its reason and lets the customer in for a day by default', async () => {
    api.approveSupportGrant.mockResolvedValue({ ok: true });
    show([g()]);
    expect(await screen.findByText('Invoices from 12 Nov will not save')).toBeInTheDocument();
    expect(screen.getByText(/ticket T-1042/)).toBeInTheDocument();
    expect(screen.getByText('To read only')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Let them in' }));
    await waitFor(() => expect(api.approveSupportGrant).toHaveBeenCalledWith('g1', { hours: 24, scope: 'READ_ONLY' }));
  });

  it('lets the customer narrow a request to change things down to read only', async () => {
    api.approveSupportGrant.mockResolvedValue({ ok: true });
    show([g({ scope: 'READ_WRITE' })]);
    fireEvent.click(await screen.findByLabelText('Read only'));
    fireEvent.change(screen.getByLabelText('How long Divya may look'), { target: { value: '4' } });
    fireEvent.click(screen.getByRole('button', { name: 'Let them in' }));
    await waitFor(() => expect(api.approveSupportGrant).toHaveBeenCalledWith('g1', { hours: 4, scope: 'READ_ONLY' }));
  });

  it('refuses a request', async () => {
    api.endSupportGrant.mockResolvedValue({ ok: true });
    show([g()]);
    fireEvent.click(await screen.findByRole('button', { name: 'Refuse' }));
    await waitFor(() => expect(api.endSupportGrant).toHaveBeenCalledWith('g1', null));
  });

  it('ends an open grant at once, and offers nothing on a past one', async () => {
    api.endSupportGrant.mockResolvedValue({ ok: true });
    show([g({ id: 'g2', state: 'ACTIVE', expiresAt: '2026-11-15T04:00:00Z' }), g({ id: 'g3', state: 'EXPIRED', staff: 'Arun', expiresAt: '2026-11-01T04:00:00Z' })]);
    expect(await screen.findByText('Open')).toBeInTheDocument();
    expect(screen.getByText('Ran out')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'End access for Arun' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'End access for Divya' }));
    await waitFor(() => expect(api.endSupportGrant).toHaveBeenCalledWith('g2', null));
  });

  it('says plainly when CLOR has never asked', async () => {
    show([]);
    expect(await screen.findByText(/CLOR support has never asked to look/)).toBeInTheDocument();
  });
});
