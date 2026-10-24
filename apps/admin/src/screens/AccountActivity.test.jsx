import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const accountAudit = vi.hoisted(() => vi.fn());
vi.mock('@platform/admin/account', () => ({ accountAudit: (...a) => accountAudit(...a) }));

import AccountActivity from './AccountActivity';

beforeEach(() => {
  accountAudit.mockReset().mockResolvedValue({
    events: [
      { id: 'e2', at: '2026-10-25T10:00:00Z', action: 'MEMBER_SUSPENDED', result: 'OK', actor: { id: 'u1', name: 'Rohit' }, targetName: 'Kavya', message: 'Suspended in the account' },
      { id: 'e1', at: '2026-10-25T09:00:00Z', action: 'ACCESS_DENIED', result: 'DENIED', actor: { id: 'u2', name: 'Kavya' }, message: 'refused', metadata: { code: 'ACCOUNT_ROLE_REQUIRED' } },
    ],
    next: 'e1',
  });
});

/* W-7.2: the account's own audit, in plain words, filterable, with details on demand. */
describe('Workspace → Account activity', () => {
  it('lists what happened and who did it, newest first, refusals marked', async () => {
    render(<AccountActivity />);
    expect(await screen.findByText('Suspended in the account: Kavya')).toBeInTheDocument();
    const list = within(screen.getByRole('list', { name: /Account activity/ }));
    expect(list.getByText('Refused: needs an account role')).toBeInTheDocument();
    expect(list.getByText('Refused')).toBeInTheDocument();
  });

  it('filters on the server and pages back', async () => {
    render(<AccountActivity />);
    await screen.findByText('Suspended in the account: Kavya');
    fireEvent.change(screen.getByLabelText('Result'), { target: { value: 'DENIED' } });
    await waitFor(() => expect(accountAudit).toHaveBeenLastCalledWith(expect.objectContaining({ result: 'DENIED' })));
    fireEvent.click(await screen.findByRole('button', { name: 'Show older' }));
    await waitFor(() => expect(accountAudit).toHaveBeenLastCalledWith(expect.objectContaining({ cursor: 'e1' })));
  });

  it('shows the details of one event when opened', async () => {
    render(<AccountActivity />);
    fireEvent.click(await screen.findByRole('button', { name: /Refused: needs an account role/ }));
    expect(screen.getByText('{"code":"ACCOUNT_ROLE_REQUIRED"}')).toBeInTheDocument();
  });
});
