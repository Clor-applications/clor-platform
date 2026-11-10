import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

/* The customer's side of roadmap item 8: CLOR's invoices in Workspace, Billing, and how to pay one. */
const fetches = vi.hoisted(() => ({ call: vi.fn() }));
vi.mock('@platform/http', () => ({ apiFetch: (...a) => fetches.call(...a) }));
vi.mock('@platform/admin/admin', () => ({ getAccountOverview: async () => ({ usage: { companies: 1, users: 3 } }) }));
vi.mock('@ui/api/features', () => ({ getEntitlement: async () => ({ plan: { name: 'People', inGoodStanding: true } }) }));
vi.mock('@ui/utils/printElement', () => ({ printElement: vi.fn() }));

import BillingPreview from './BillingPreview';

const invoice = {
  id: 'i1', number: 'CLOR/26-27/0007', status: 'ISSUED', overdue: false, issueDate: '2026-11-10T06:00:00Z', dueDate: '2026-11-25T06:00:00Z',
  lines: [{ description: 'CLOR People, 25 users', quantity: 25, unitAmount: 9900, amount: 247500 }], subtotal: 247500, tax: { charged: false }, taxTotal: 0, total: 247500,
  buyer: { name: 'Kaveri Traders' }, seller: { legalName: 'Clor Applications Private Limited' },
  payTo: { upiId: 'clor@okaxis', qr: 'data:image/png;base64,AAA', bank: { accountName: 'CLOR Applications Pvt Ltd', accountNumber: '50200012345678', ifsc: 'HDFC0001234' } },
};

describe('invoices in Workspace, Billing', () => {
  it('lists the account’s invoices and opens one with its UPI QR and bank account', async () => {
    fetches.call.mockImplementation(async (path) => (path === '/billing/invoices' ? { invoices: [{ ...invoice }] } : invoice));
    render(<BillingPreview />);
    fireEvent.click(await screen.findByRole('button', { name: 'CLOR/26-27/0007' }));
    expect(screen.getByText(/One invoice is unpaid/)).toBeTruthy();
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByAltText('UPI QR code to pay ₹2,475.00 to clor@okaxis')).toBeTruthy();
    expect(within(dialog).getByText('50200012345678')).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: 'Print or save as PDF' })).toBeTruthy();
  });

  it('says so when there are none', async () => {
    fetches.call.mockResolvedValue({ invoices: [] });
    render(<BillingPreview />);
    expect(await screen.findByText('No invoices yet.')).toBeTruthy();
  });
});
