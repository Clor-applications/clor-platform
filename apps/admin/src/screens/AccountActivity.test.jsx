import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const accountAudit = vi.hoisted(() => vi.fn());
vi.mock('@platform/admin/account', () => ({ accountAudit: (...a) => accountAudit(...a) }));

import AccountActivity from './AccountActivity';

beforeEach(() => {
  accountAudit.mockReset().mockResolvedValue({
    events: [
      { id: 'e2', at: '2026-10-25T10:00:00Z', action: 'MEMBER_SUSPENDED', result: 'OK', actor: { id: 'u1', name: 'Rohit' }, targetName: 'Kavya', message: 'Suspended in the account' },
      { id: 'e1', at: '2026-10-25T09:00:00Z', action: 'ACCESS_DENIED', result: 'DENIED', actor: { id: 'u2', name: 'Kavya' }, message: 'refused', metadata: { code: 'ACCOUNT_ROLE_REQUIRED', email: 'kavya@x.in' } },
    ],
    next: 'e1',
  });
});

/* W-7.2: the account's own audit, in plain words, filterable, with details on demand. */
describe('Workspace → Audit log', () => {
  it('lists what happened and who did it, newest first, refusals marked', async () => {
    render(<AccountActivity />);
    const table = within(await screen.findByRole('table', { name: /Audit log/ }));
    expect(await table.findByText('Suspended in the account')).toBeInTheDocument();
    expect(table.getAllByText('Kavya').length).toBeGreaterThan(0);
    expect(table.getByText('Refused: needs an account role')).toBeInTheDocument();
    expect(table.getByText('Refused')).toBeInTheDocument();
  });

  it('filters on the server and pages back', async () => {
    render(<AccountActivity />);
    await screen.findByText('Suspended in the account');
    fireEvent.click(screen.getByRole('button', { name: /^Result:/ }));
    fireEvent.click(await screen.findByRole('menuitemradio', { name: 'Refused' }));
    await waitFor(() => expect(accountAudit).toHaveBeenLastCalledWith(expect.objectContaining({ result: 'DENIED' })));
    fireEvent.click(await screen.findByRole('button', { name: 'Show older' }));
    await waitFor(() => expect(accountAudit).toHaveBeenLastCalledWith(expect.objectContaining({ cursor: 'e1' })));
  });

  it('shows the details of one event when opened', async () => {
    render(<AccountActivity />);
    fireEvent.click(await screen.findByRole('button', { name: /Refused: needs an account role/ }));
    /* Known keys as labelled rows; codes and raw JSON stay off the page. */
    expect(screen.getByText('Email')).toBeInTheDocument();
    expect(screen.getByText('kavya@x.in')).toBeInTheDocument();
    expect(screen.queryByText(/ACCOUNT_ROLE_REQUIRED/)).toBeNull();
  });

  it('a failed load offers a retry instead of "Nothing here yet"', async () => {
    accountAudit.mockRejectedValueOnce(new Error('down'));
    render(<AccountActivity />);
    const retry = await screen.findByRole('button', { name: 'Try again' });
    expect(screen.queryByText(/Nothing here/)).toBeNull();
    fireEvent.click(retry);
    expect(await screen.findByText('Suspended in the account')).toBeInTheDocument();
  });

  it('holds Show older while the older page is out', async () => {
    render(<AccountActivity />);
    await screen.findByText('Suspended in the account');
    accountAudit.mockImplementationOnce(() => new Promise(() => {}));
    fireEvent.click(screen.getByRole('button', { name: 'Show older' }));
    expect(await screen.findByRole('button', { name: 'Loading older…' })).toBeDisabled();
  });

  it('searches 250ms after the last key', async () => {
    render(<AccountActivity />);
    await screen.findByText('Suspended in the account');
    fireEvent.change(screen.getByPlaceholderText('Search by person, action or detail'), { target: { value: 'refused' } });
    expect(screen.getByText('Suspended in the account')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText('Suspended in the account')).toBeNull());
    expect(screen.getByText('Refused: needs an account role')).toBeInTheDocument();
  });
});
