import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ opsMySupportGrants: vi.fn(), opsEndSupportGrant: vi.fn() }));
vi.mock('./api', () => api);
vi.mock('@ui/components/ui/notify', () => ({ notify: { success: vi.fn(), error: vi.fn(), info: vi.fn() }, confirmDialog: vi.fn(() => Promise.resolve(true)) }));

import { AccessRequests } from './AccessRequests';
import { confirmDialog } from '@ui/components/ui/notify';

const now = new Date().toISOString();
const grants = [
  { id: 'g1', state: 'PENDING', scope: 'READ_ONLY', company: 'Sai Pharma', accountId: 'a1', reason: 'TDS mismatch on Form 16', ticketRef: 'T-4830', requestedAt: now },
  { id: 'g2', state: 'ACTIVE', scope: 'READ_WRITE', company: 'Patil Constructions', accountId: 'a2', reason: 'Series settings', requestedAt: now, expiresAt: now },
  { id: 'g3', state: 'EXPIRED', scope: 'READ_ONLY', company: 'Joshi & Sons', accountId: 'a3', reason: 'Old look', requestedAt: now },
];

beforeEach(() => {
  api.opsMySupportGrants.mockReset().mockResolvedValue({ grants });
  api.opsEndSupportGrant.mockReset().mockResolvedValue({});
});

describe('Access requests', () => {
  it('lists my requests by state, withdraws one, and opens the account', async () => {
    const openCustomer = vi.fn();
    render(<AccessRequests openCustomer={openCustomer} />);
    expect(await screen.findByText('View Sai Pharma (read-only)')).toBeInTheDocument();
    expect(screen.getByText(/#T-4830 · TDS mismatch on Form 16/)).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Waiting (1)' })).toBeInTheDocument();
    expect(screen.queryByText(/Patil Constructions/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Withdraw the request for Sai Pharma' }));
    await waitFor(() => expect(api.opsEndSupportGrant).toHaveBeenCalledWith('g1'));
    fireEvent.click(screen.getByRole('tab', { name: 'Open (1)' }));
    expect(screen.getByText(/Look at and change Patil Constructions/)).toBeInTheDocument();
    /* Closing access that is open says so first: staff lose access now. */
    fireEvent.click(screen.getByRole('button', { name: 'Close the request for Patil Constructions' }));
    await waitFor(() => expect(confirmDialog).toHaveBeenLastCalledWith(expect.objectContaining({ title: 'Close access to Patil Constructions?', message: expect.stringMatching(/CLOR staff lose access to Patil Constructions now/) })));
    await waitFor(() => expect(api.opsEndSupportGrant).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByRole('button', { name: 'Open account' }));
    expect(openCustomer).toHaveBeenCalledWith('a2');
    fireEvent.click(screen.getByRole('tab', { name: 'Ended' }));
    expect(screen.getByText('Ran out')).toBeInTheDocument();
  });
});
