import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ opsSupportGrants: vi.fn(), opsAskSupportGrant: vi.fn(), opsEndSupportGrant: vi.fn() }));
vi.mock('./api', () => ({
  opsSupportGrants: (...a) => api.opsSupportGrants(...a),
  opsAskSupportGrant: (...a) => api.opsAskSupportGrant(...a),
  opsEndSupportGrant: (...a) => api.opsEndSupportGrant(...a),
}));

import { SupportAccess } from './SupportAccess';

const companies = [{ id: 'o1', name: 'Rao Textiles', code: '4831920657' }, { id: 'o2', name: 'Rao Exports', code: '4831920658' }];
beforeEach(() => Object.values(api).forEach((f) => f.mockReset()));

describe('operator console: support access', () => {
  it('asks the customer, read-only unless changes are asked for', async () => {
    api.opsSupportGrants.mockResolvedValue({ grants: [] });
    api.opsAskSupportGrant.mockResolvedValue({ grant: { id: 'g1' } });
    render(<SupportAccess id="a1" companies={companies} role="SUPPORT" />);
    expect(await screen.findByText(/Nobody from CLOR has asked/)).toBeInTheDocument();
    const ask = screen.getByRole('button', { name: 'Ask the customer' });
    expect(ask).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Company'), { target: { value: 'o2' } });
    fireEvent.change(screen.getByLabelText('Why you need to look'), { target: { value: 'Series settings look wrong' } });
    fireEvent.click(ask);
    await waitFor(() => expect(api.opsAskSupportGrant).toHaveBeenCalledWith('a1', { orgId: 'o2', reason: 'Series settings look wrong', ticketRef: undefined, scope: 'READ_ONLY' }));
  });

  it('does not offer to ask to a role that may not', async () => {
    api.opsSupportGrants.mockResolvedValue({ grants: [] });
    render(<SupportAccess id="a1" companies={companies} role="SALES" />);
    await screen.findByText(/Nobody from CLOR has asked/);
    expect(screen.queryByRole('button', { name: 'Ask the customer' })).not.toBeInTheDocument();
  });

  it('opens the company in the app on an open grant of your own, and closes it when done', async () => {
    api.opsSupportGrants.mockResolvedValue({
      grants: [{ id: 'g1', orgId: 'o1', state: 'ACTIVE', scope: 'READ_ONLY', reason: 'Series settings', staff: 'Divya', mine: true, requestedAt: '2026-11-14T04:00:00Z', expiresAt: '2026-11-15T04:00:00Z' }],
    });
    api.opsEndSupportGrant.mockResolvedValue({ ok: true });
    render(<SupportAccess id="a1" companies={companies} role="SUPPORT" />);
    const open = await screen.findByRole('link', { name: 'Open in the app' });
    expect(open.getAttribute('href')).toMatch(/\/o\/4831920657$/);
    fireEvent.click(screen.getByRole('button', { name: 'Done, close it' }));
    await waitFor(() => expect(api.opsEndSupportGrant).toHaveBeenCalledWith('g1'));
  });
});
