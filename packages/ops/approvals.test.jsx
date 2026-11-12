import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ opsApprovals: vi.fn(), opsApprovalStep: vi.fn(), opsApprovalLimit: vi.fn() }));
vi.mock('./api', () => Object.fromEntries(Object.keys(api).map((k) => [k, (...a) => api[k](...a)])));
vi.mock('@ui/components/ui/notify', () => ({ notify: { success: vi.fn(), error: vi.fn() } }));

import { Approvals } from './Approvals';

const base = { kind: 'DEAL', accountId: 'acc', customer: 'Meridian Facilities', summary: 'Growth, 25 users, monthly, ₹6,000 instead of ₹10,000 (HALF: 40% off)', discountPercent: 40, reason: 'Matching a rival quote', status: 'PENDING', statusWord: 'Waiting', createdAt: '2026-11-11T05:00:00Z', expiresAt: '2026-11-14T05:00:00Z', decidedBy: null, result: null };
const page = (approvals, extra = {}) => ({ limit: 20, expiresHours: 72, waiting: approvals.length, canChangeLimit: false, approvals, ...extra });

beforeEach(() => Object.values(api).forEach((f) => f.mockReset()));

describe('operator console: approvals', () => {
  it('approves a colleague’s request with a note, and cannot approve one’s own', async () => {
    api.opsApprovals.mockResolvedValue(
      page([
        { ...base, id: 'a1', askedBy: 'Priya Raman', mine: false, canDecide: true, canWithdraw: false },
        { ...base, id: 'a2', customer: 'Kaveri Traders', askedBy: 'Me', mine: true, canDecide: false, canWithdraw: true },
      ]),
    );
    api.opsApprovalStep.mockResolvedValue({ status: 'APPROVED' });
    render(<Approvals openCustomer={() => {}} />);
    expect(await screen.findByText(/Deals over 20% off wait here/)).toBeTruthy();
    expect(screen.getByText(/You cannot approve your own request/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Approve the request for Kaveri Traders' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Approve the request for Meridian Facilities' }));
    fireEvent.change(screen.getByLabelText('Why'), { target: { value: 'Fine for a year' } });
    const btns = screen.getAllByRole('button', { name: 'Approve' });
    fireEvent.click(btns[btns.length - 1]);
    await waitFor(() => expect(api.opsApprovalStep).toHaveBeenCalledWith('a1', 'approve', 'Fine for a year'));
    fireEvent.click(screen.getByRole('button', { name: 'Withdraw the request for Kaveri Traders' }));
    await waitFor(() => expect(api.opsApprovalStep).toHaveBeenCalledWith('a2', 'withdraw'));
  });

  it('lets the owner change the limit, with a reason', async () => {
    api.opsApprovals.mockResolvedValue(page([], { canChangeLimit: true }));
    api.opsApprovalLimit.mockResolvedValue({ discountPercent: 30 });
    render(<Approvals openCustomer={() => {}} />);
    expect(await screen.findByText(/Nothing is waiting/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Change the limit' }));
    fireEvent.change(screen.getByLabelText(/Ask a second person when a subscription takes off more than/), { target: { value: '30' } });
    fireEvent.change(screen.getByLabelText('Why'), { target: { value: 'Festival season' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(api.opsApprovalLimit).toHaveBeenCalledWith(30, 'Festival season'));
  });
});
