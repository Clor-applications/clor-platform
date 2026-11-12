import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ opsOperators: vi.fn(), opsAddOperator: vi.fn(), opsChangeOperator: vi.fn(), opsRemoveOperator: vi.fn(), opsWithdrawInvite: vi.fn() }));
vi.mock('./api', () => api);
const notify = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('@ui/components/ui/notify', () => ({ notify }));

import { Staff } from './Staff';

const me = { user: { id: 'u1', fullName: 'Ravi' }, role: 'SUPER_ADMIN' };
const list = {
  bootstrap: [{ userId: 'u1', email: 'ravi@clor.in', name: 'Ravi', role: 'SUPER_ADMIN', authenticator: true, lastLoginAt: null }],
  operators: [{ userId: 'u2', email: 'meena@clor.in', name: 'Meena', role: 'SUPPORT', active: true, authenticator: false, lastLoginAt: null }],
  invites: [{ id: 'i1', email: 'new@clor.in', role: 'SALES', since: '2026-11-09T00:00:00Z' }],
};
const reason = (text) => fireEvent.change(screen.getByPlaceholderText('One sentence, for the audit log'), { target: { value: text } });

beforeEach(() => {
  Object.values(api).forEach((f) => f.mockReset());
  api.opsOperators.mockResolvedValue(list);
});

describe('Staff and roles', () => {
  it('lists staff with role, authenticator and invitations, and says what each role can do', async () => {
    render(<Staff me={me} />);
    expect(await screen.findByText('Meena')).toBeInTheDocument();
    expect(screen.getByText('set by engineering')).toBeInTheDocument();
    expect(screen.getByText('Not yet')).toBeInTheDocument();
    expect(screen.getByText('new@clor.in')).toBeInTheDocument();
    expect(screen.getByText('Read-only', { selector: 'dt' })).toBeInTheDocument();
    expect(screen.getByText('Sees what the others see. Changes nothing.')).toBeInTheDocument();
  });

  it('invites by email with a role and a reason', async () => {
    api.opsAddOperator.mockResolvedValue({ invite: { id: 'i2' } });
    render(<Staff me={me} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Invite staff' }));
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'kiran@clor.in' } });
    fireEvent.click(screen.getByRole('radio', { name: /Finance/ }));
    reason('New accountant');
    fireEvent.click(screen.getByRole('button', { name: 'Send invitation' }));
    await waitFor(() => expect(api.opsAddOperator).toHaveBeenCalledWith({ email: 'kiran@clor.in', role: 'BILLING', reason: 'New accountant' }));
    expect(notify.success).toHaveBeenCalledWith(expect.stringMatching(/^Invitation sent to kiran@clor.in/));
  });

  it('changes a role and removes somebody, each with a reason', async () => {
    api.opsChangeOperator.mockResolvedValue({});
    api.opsRemoveOperator.mockResolvedValue({});
    render(<Staff me={me} />);
    fireEvent.change(await screen.findByLabelText('Role of meena@clor.in'), { target: { value: 'READ_ONLY' } });
    expect(screen.getByText(/Meena becomes Read-only/)).toBeInTheDocument();
    reason('Moved to audit');
    fireEvent.click(screen.getAllByRole('button', { name: 'Change role' }).at(-1));
    await waitFor(() => expect(api.opsChangeOperator).toHaveBeenCalledWith('u2', { role: 'READ_ONLY', reason: 'Moved to audit' }));

    fireEvent.click(await screen.findByRole('button', { name: 'Remove' }));
    reason('Left CLOR');
    fireEvent.click(screen.getAllByRole('button', { name: 'Remove' }).at(-1));
    await waitFor(() => expect(api.opsRemoveOperator).toHaveBeenCalledWith('u2', 'Left CLOR'));
  });
});
