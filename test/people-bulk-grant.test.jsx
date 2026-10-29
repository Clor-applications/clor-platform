import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

/*
 * Leave balances → Grant leave to many (owner, 29 Oct 2026, from ERPNext's
 * Leave Control Panel): the drawer asks the server who it goes to before
 * anything is saved, and grants to those people with one reason.
 */
const api = vi.hoisted(() => ({
  bulkGrantLeave: vi.fn(),
}));
vi.mock('../packages/ui/src/timeOff/api', async (orig) => ({ ...(await orig()), ...api }));
vi.mock('../packages/ui/src/timeOff/suggestions', () => ({ useSuggestions: () => [] }));
vi.mock('@ui/personnel/api', async (orig) => ({ ...(await orig()), listStructure: vi.fn((k) => Promise.resolve(k === 'departments' ? [{ id: 'd1', name: 'Stores' }] : [{ id: 'k1', name: 'Permanent' }])) }));
vi.mock('@ui/components/ui/notify', () => ({ confirmDialog: vi.fn(async () => true), notify: { error: vi.fn(), success: vi.fn() } }));

import BulkGrant from '../packages/ui/src/timeOff/BulkGrant';

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('Grant leave to many', () => {
  it('shows who it goes to and who is left out, then grants to them', async () => {
    api.bulkGrantLeave.mockImplementation((body) => Promise.resolve(body.preview
      ? { count: 2, names: ['Asha Rao', 'Ravi Kumar'], skipped: [{ employeeId: 'e3', name: 'Nina Das', why: 'not eligible for Casual leave' }] }
      : { granted: 2 }));
    const done = vi.fn();
    const user = userEvent.setup();
    render(<BulkGrant types={[{ id: 't1', name: 'Casual leave' }]} year={2026} label="2026" onClose={() => {}} onDone={done} />);
    await user.click(screen.getByRole('combobox', { name: 'Leave type *' }));
    await user.click(await screen.findByRole('option', { name: 'Casual leave' }));
    await user.type(screen.getByLabelText('Days each *'), '2');
    await user.click(await screen.findByRole('button', { name: 'Stores' }));
    expect(await screen.findByText(/Asha Rao, Ravi Kumar/)).toBeInTheDocument();
    expect(screen.getByText(/Nina Das: not eligible/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Grant to 2' })).toBeDisabled();
    await user.type(screen.getByLabelText('Reason *'), 'Diwali bonus days');
    await user.click(screen.getByRole('button', { name: 'Grant to 2' }));
    await waitFor(() => expect(api.bulkGrantLeave).toHaveBeenLastCalledWith({ leaveTypeId: 't1', year: 2026, days: 2, reason: 'Diwali bonus days', departmentIds: ['d1'], employeeTypeIds: [] }));
    await waitFor(() => expect(done).toHaveBeenCalled());
  });
});
