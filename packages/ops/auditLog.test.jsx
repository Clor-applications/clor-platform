import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ opsAudit: vi.fn(), opsAuditFilters: vi.fn(), opsAuditExport: vi.fn(), opsAccounts: vi.fn() }));
vi.mock('./api', () => api);
const notify = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('@ui/components/ui/notify', () => ({ notify }));

import { AuditLog } from './AuditLog';

const event = { id: 'e1', at: '2026-11-10T05:00:00Z', action: 'ACCOUNT_SUSPENDED', label: 'Suspended a customer', summary: 'Unpaid', operator: { fullName: 'Ravi' }, targetAccountId: 'a1', accountName: 'Rao Textiles', targetUser: null };
beforeEach(() => {
  Object.values(api).forEach((f) => f.mockReset());
  api.opsAuditFilters.mockResolvedValue({ operators: [{ id: 'u1', name: 'Ravi' }], actions: [{ action: 'ACCOUNT_SUSPENDED', label: 'Suspended a customer' }] });
  api.opsAudit.mockResolvedValue({ hasMore: false, events: [event] });
});

describe('Audit log', () => {
  it('shows what staff did in words, and filters by staff member, action, customer and date', async () => {
    const openCustomer = vi.fn();
    render(<AuditLog openCustomer={openCustomer} />);
    expect(await screen.findByText('Unpaid')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Rao Textiles' }));
    expect(openCustomer).toHaveBeenCalledWith('a1');
    await screen.findByRole('option', { name: 'Ravi' });
    fireEvent.change(screen.getByLabelText('Staff member'), { target: { value: 'u1' } });
    fireEvent.change(screen.getByLabelText('What they did'), { target: { value: 'ACCOUNT_SUSPENDED' } });
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-11-01' } });
    await waitFor(() => expect(api.opsAudit).toHaveBeenLastCalledWith({ operatorId: 'u1', action: 'ACCOUNT_SUSPENDED', accountId: '', from: '2026-11-01', to: '', page: 0 }));
    api.opsAccounts.mockResolvedValue({ accounts: [{ id: 'a1', name: 'Rao Textiles', code: '4831920657' }] });
    fireEvent.change(screen.getByLabelText('Customer'), { target: { value: 'rao' } });
    fireEvent.click(await screen.findByRole('option', { name: /Rao Textiles/ }));
    await waitFor(() => expect(api.opsAudit).toHaveBeenLastCalledWith(expect.objectContaining({ accountId: 'a1' })));
  });

  it('downloads what is shown as CSV', async () => {
    api.opsAuditExport.mockResolvedValue('When (UTC),Staff member\r\n');
    URL.createObjectURL = vi.fn(() => 'blob:x');
    URL.revokeObjectURL = vi.fn();
    render(<AuditLog openCustomer={() => {}} />);
    await screen.findByText('Unpaid');
    fireEvent.click(screen.getByRole('button', { name: 'Download CSV' }));
    await waitFor(() => expect(api.opsAuditExport).toHaveBeenCalledWith({ operatorId: '', action: '', accountId: '', from: '', to: '' }));
    await waitFor(() => expect(notify.success).toHaveBeenCalled());
  });
});
